// T-1139 (kullanıcı kararı 31 Ekim 2026, "eski yöntem olmasın"): migration 0068 eski e-posta + parola yöntemiyle kurulmuş Paraşüt
// bağlantılarını keser. Kanıtlar:
//  (1) ayrı scratch veritabanında gerçek migration koşusu: eski biçimli bağlantı (CONNECTED ve ERROR) DISCONNECTED + LEGACY_METHOD_REMOVED,
//      kimlik kutusu ve webhook anahtarları silinir, bağlantı başına bir audit (via migration_0068, I-12); OAuth biçimli bağlantılar (ortak
//      uygulama + kendi uygulaması) ve zaten kesik bağlantı DOKUNULMAZ; müşteri verisi (ürün, eşleme, kuyruk, stok, akış tercihi) yerinde;
//      down belgeli no-op (silinen kimlik geri gelmez), up yeniden uygulanınca yeni satır/audit yok;
//  (2) ana test veritabanında GERÇEK domain OAuth akışıyla kurulmuş bağlantılar (ortak + kendi uygulaması) 0068 seçicisine girmez (dosyadaki
//      sorgunun kendisi, tenant bağlamında, salt okunur); eski biçimli bağlantıya 0068 kesme bloğu (dosyadaki blok, tenant bağlamında) uygulanınca
//      eşitleme/zamanlayıcı/webhook araması/koşu isteği reddedilir, ekran AUTH "Yeniden bağlan" gösterir; başka kiracı etkilenmez ve görmez;
//      OAuth ile yeniden bağlanınca kod temizlenir, akış tercihleri korunur, Paraşüt'te kalan eski webhook kaydı silinir.
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, withSystemTenant } from "../../../packages/db/src/index.ts";
import type { DbClient } from "../../../packages/db/src/client.ts";
import { migrateDown, migrateUp } from "../../../packages/db/src/migrate.ts";
import { createSealer } from "../../../packages/shared/src/seal.ts";
import {
  LEGACY_METHOD_REMOVED,
  ParasutClient,
  SHARED_OAUTH_CONFIG_VERSION,
  checkIntegration,
  enqueueScheduledIntegrations,
  getIntegrationOverview,
  registerParasutWebhooks,
  requestIntegrationRun,
  runIntegrationSync,
} from "../../../packages/domain/src/integrations/index.ts";
import { startFakeParasut, type FakeParasut } from "../fixtures/fake-parasut.ts";
import { seedLegacyParasutConnection } from "../fixtures/legacy-parasut.ts";
import { connectParasutOAuth } from "../fixtures/parasut-oauth.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";

const env = readIntEnv(process.env);
const sealer = createSealer(randomBytes(32).toString("hex"));
const UP = readFileSync(path.resolve(import.meta.dirname, "../../../packages/db/migrations/0068_integration_legacy_cut.up.sql"), "utf8");
/** Dosyadaki seçici (tek kaynak): `FOR r IN SELECT ... FOR UPDATE OF i` arası. */
const SELECTOR = (/FOR r IN\s+(SELECT[\s\S]+?)\s+FOR UPDATE OF i/.exec(UP)?.[1] ?? "").trim();
/** Dosyadaki kesme bloğu (tek kaynak). */
const CUT = /DO \$cut\$[\s\S]+?\$cut\$;/.exec(UP)?.[0] ?? "";
const URI = "https://wms.example.test/api/integrations/parasut/webhook";

async function inTenant<T extends pg.QueryResultRow = Record<string, unknown>>(c: pg.Client, tenantId: string, text: string, params: unknown[] = []): Promise<T[]> {
  await c.query("BEGIN");
  try {
    await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
    const r = await c.query<T>(text, params);
    await c.query("COMMIT");
    return r.rows;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}

it("migration dosyası: seçici ve kesme bloğu bulunur; sorgu yalnız PARASUT ve kesilmemiş bağlantıları ve tamamlanmış OAuth denemesini okur", () => {
  expect(SELECTOR).toMatch(/^SELECT i\.tenant_id, i\.id, i\.provider/);
  expect(SELECTOR).toContain("i.provider = 'PARASUT'");
  expect(SELECTOR).toContain("i.status <> 'DISCONNECTED'");
  expect(SELECTOR).toContain("a.phase = 'COMPLETE'");
  expect(CUT).toContain("'LEGACY_METHOD_REMOVED'");
  expect(CUT).toContain("'migration_0068'");
});

// --- (1) gerçek migration koşusu (scratch veritabanı) -------------------------------------------------------------------------------
async function scratch(run: (url: string, adm: pg.Client) => Promise<void>): Promise<void> {
  const name = `wms_t1139_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: env.databaseUrlDirect });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const u = new URL(env.databaseUrlDirect);
  u.pathname = `/${name}`;
  const url = u.toString();
  const adm = new pg.Client({ connectionString: url });
  try {
    await adm.connect();
    await migrateUp({ url });
    await run(url, adm);
  } finally {
    await adm.end();
    await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.end();
  }
}

/** OAuth bağlantısının DB biçimi (oauth.ts ile aynı): bağlanma transaction'ında COMPLETE'e geçen, bağlanmadan en çok 10 dk önce açılmış deneme. */
async function seedOAuthShaped(adm: pg.Client, w: TenantWorld, version: string): Promise<string> {
  const id = await seedLegacyParasutConnection(adm, w, sealer, { flowsOn: ["PRODUCTS"] });
  await inTenant(adm, w.tenantId, "UPDATE public.integrations SET connected_at = now() WHERE tenant_id = $1 AND id = $2", [w.tenantId, id]);
  await inTenant(
    adm,
    w.tenantId,
    `INSERT INTO public.integration_oauth_attempts (tenant_id, id, user_id, membership_id, state_hash, nonce_hash, client_id, config_version)
     VALUES ($1, $2, $3, $4, $5, $6, 'cid', $7::uuid)`,
    [w.tenantId, randomUUID(), w.ownerUserId, w.ownerMembershipId, randomBytes(32).toString("hex"), randomBytes(32).toString("hex"), version],
  );
  // Deneme bağlanmadan 3 dk önce açıldı (oluşturma zamanı istemciden yazılamaz; sahip rolüyle geriye alınır), sonra COMPLETE.
  await inTenant(adm, w.tenantId, "UPDATE public.integration_oauth_attempts SET created_at = now() - interval '3 minutes', expires_at = now() + interval '7 minutes', phase = 'COMPLETE' WHERE tenant_id = $1", [w.tenantId]);
  return id;
}

it("0068 up: eski yöntem bağlantıları kesilir (audit, kimlik + webhook anahtarı silinir, veri yerinde); OAuth ve kesik bağlantı dokunulmaz; down no-op; yeniden up idempotent", async () => {
  await scratch(async (url, adm) => {
    expect((await migrateDown({ url, to: "0067", wmsEnv: "staging" })).reverted).toEqual(["0070", "0069", "0068"]);
    const reg = newRegistry();
    const L = await seedWorld(adm, reg, "LC1");
    const E = await seedWorld(adm, reg, "LC2");
    const S = await seedWorld(adm, reg, "LC3");
    const P = await seedWorld(adm, reg, "LC4");
    const D = await seedWorld(adm, reg, "LC5");
    const lId = await seedLegacyParasutConnection(adm, L, sealer, { flowsOn: ["PRODUCTS", "SHIPMENTS"], webhooks: true });
    const eId = await seedLegacyParasutConnection(adm, E, sealer, { status: "ERROR" });
    await seedOAuthShaped(adm, S, SHARED_OAUTH_CONFIG_VERSION);
    const appVersion = randomUUID();
    await inTenant(adm, P.tenantId, `INSERT INTO public.integration_oauth_apps (tenant_id, version, credentials) VALUES ($1, $2, '{"v":2,"kid":"s","iv":"s","tag":"s","ct":"s"}')`, [P.tenantId, appVersion]);
    await seedOAuthShaped(adm, P, appVersion);
    const dId = await seedLegacyParasutConnection(adm, D, sealer);
    await inTenant(adm, D.tenantId, "UPDATE public.integrations SET status = 'DISCONNECTED', credentials = NULL WHERE tenant_id = $1 AND id = $2", [D.tenantId, dId]);
    // Eski bağlantının müşteri verisi: dış eşleme + bekleyen irsaliye kuyruğu (kesmeden sonra aynen kalmalı).
    await inTenant(adm, L.tenantId, "INSERT INTO public.external_refs (tenant_id, system, entity_type, entity_id, external_id) VALUES ($1, 'PARASUT', 'ITEM', $2, '7001')", [L.tenantId, L.itemId]);
    await inTenant(adm, L.tenantId, "INSERT INTO public.integration_outbox (tenant_id, integration_id, flow, entity_type, entity_id) VALUES ($1, $2, 'SHIPMENTS', 'DOCUMENT', $3)", [L.tenantId, lId, L.documentId]);
    const snapshot = async (w: TenantWorld) => ({
      items: (await inTenant<{ n: number }>(adm, w.tenantId, "SELECT count(*)::int AS n FROM public.items WHERE tenant_id = $1", [w.tenantId]))[0]?.n,
      parties: (await inTenant<{ n: number }>(adm, w.tenantId, "SELECT count(*)::int AS n FROM public.parties WHERE tenant_id = $1", [w.tenantId]))[0]?.n,
      warehouses: (await inTenant<{ n: number }>(adm, w.tenantId, "SELECT count(*)::int AS n FROM public.warehouses WHERE tenant_id = $1", [w.tenantId]))[0]?.n,
      ledger: (await inTenant<{ n: string }>(adm, w.tenantId, "SELECT coalesce(sum(quantity), 0)::text AS n FROM public.stock_ledger WHERE tenant_id = $1", [w.tenantId]))[0]?.n,
      documents: (await inTenant<{ n: number }>(adm, w.tenantId, "SELECT count(*)::int AS n FROM public.documents WHERE tenant_id = $1", [w.tenantId]))[0]?.n,
      refs: await inTenant(adm, w.tenantId, "SELECT entity_type, external_id FROM public.external_refs WHERE tenant_id = $1 ORDER BY external_id", [w.tenantId]),
      outbox: await inTenant(adm, w.tenantId, "SELECT flow, status FROM public.integration_outbox WHERE tenant_id = $1", [w.tenantId]),
      flows: await inTenant(adm, w.tenantId, "SELECT flow, enabled, direction FROM public.integration_flows WHERE tenant_id = $1 ORDER BY flow", [w.tenantId]),
    });
    const conn = async (w: TenantWorld) =>
      (await inTenant<{ status: string; creds: boolean; code: string | null; ref: string; label: string; wh: string; connected: boolean }>(adm, w.tenantId, "SELECT status, credentials IS NOT NULL AS creds, last_error_code AS code, account_ref AS ref, account_label AS label, webhook_status AS wh, connected_at IS NOT NULL AS connected FROM public.integrations WHERE tenant_id = $1", [w.tenantId]))[0];
    const before = { L: await snapshot(L), S: await snapshot(S), P: await snapshot(P), sConn: await conn(S), pConn: await conn(P), dConn: await conn(D) };
    const credsOf = async (w: TenantWorld) => (await inTenant<{ c: unknown }>(adm, w.tenantId, "SELECT credentials AS c FROM public.integrations WHERE tenant_id = $1", [w.tenantId]))[0]?.c;
    const sCreds = await credsOf(S);
    const pCreds = await credsOf(P);

    expect((await migrateUp({ url })).applied).toEqual(["0068", "0069", "0070"]);

    // Eski yöntem: kesildi, kimlik silindi, kod yazıldı; şirket eşlemesi (account_ref) ve bağlanma anı korunur (yeniden bağlanma kuralları).
    expect(await conn(L)).toEqual({ status: "DISCONNECTED", creds: false, code: LEGACY_METHOD_REMOVED, ref: "115", label: "Eski Muhasebe", wh: "OFF", connected: true });
    expect(await conn(E)).toEqual({ status: "DISCONNECTED", creds: false, code: LEGACY_METHOD_REMOVED, ref: "115", label: "Eski Muhasebe", wh: "OFF", connected: true });
    expect(await inTenant(adm, L.tenantId, "SELECT DISTINCT status, key_box FROM public.integration_webhooks WHERE tenant_id = $1", [L.tenantId])).toEqual([{ status: "DELETED", key_box: null }]);
    // Müşteri verisi ve akış tercihleri aynen.
    expect(await snapshot(L)).toEqual(before.L);
    // OAuth (ortak + kendi uygulaması) ve zaten kesik bağlantı: hiçbir alan değişmedi.
    expect(await conn(S)).toEqual(before.sConn);
    expect(await conn(P)).toEqual(before.pConn);
    expect(await conn(D)).toEqual(before.dConn);
    expect(await credsOf(S)).toEqual(sCreds);
    expect(await credsOf(P)).toEqual(pCreds);
    expect(await snapshot(S)).toEqual(before.S);
    expect(await snapshot(P)).toEqual(before.P);
    // Bağlantı başına bir audit (I-12), yalnız kesilen kiracılarda; sır/şirket adı yok.
    const audit = async () =>
      (await adm.query<{ tenant_id: string; entity_id: string; actor: string | null; s: Record<string, unknown> }>("SELECT tenant_id, entity_id, actor_user_id AS actor, change_summary AS s FROM public.audit_logs WHERE action = 'integration.disconnected' AND change_summary->>'via' = 'migration_0068' ORDER BY entity_id")).rows;
    const cut = await audit();
    expect(cut.map((a) => a.entity_id).sort()).toEqual([lId, eId].sort());
    expect(cut.find((a) => a.entity_id === lId)).toEqual({ tenant_id: L.tenantId, entity_id: lId, actor: null, s: { provider: "PARASUT", via: "migration_0068", reason: "LEGACY_METHOD_REMOVED", webhooks_removed: 2, flows_kept: ["PRODUCTS", "SHIPMENTS"] } });
    expect(cut.find((a) => a.entity_id === eId)?.s).toEqual({ provider: "PARASUT", via: "migration_0068", reason: "LEGACY_METHOD_REMOVED", webhooks_removed: 0, flows_kept: [] });
    expect(JSON.stringify(cut)).not.toMatch(/legacy-client-secret|legacy-refresh|legacy-access|Eski Muhasebe/);
    for (const t of ["integrations", "integration_flows", "integration_webhooks", "integration_oauth_attempts", "audit_logs"]) {
      expect((await adm.query<{ f: boolean }>("SELECT relforcerowsecurity AS f FROM pg_class WHERE oid = ('public.' || $1)::regclass", [t])).rows[0]?.f, t).toBe(true);
    }

    // down: belgeli no-op — silinen kimlik geri gelmez, satırlar değişmez; up yeniden uygulanınca yeni satır/audit yok.
    expect((await migrateDown({ url, to: "0067", wmsEnv: "staging" })).reverted).toEqual(["0070", "0069", "0068"]);
    expect(await conn(L)).toEqual({ status: "DISCONNECTED", creds: false, code: LEGACY_METHOD_REMOVED, ref: "115", label: "Eski Muhasebe", wh: "OFF", connected: true });
    expect(await conn(S)).toEqual(before.sConn);
    expect((await migrateUp({ url })).applied).toEqual(["0068", "0069", "0070"]);
    expect(await audit()).toEqual(cut);
    expect(await conn(S)).toEqual(before.sConn);
  });
}, 180_000);

// --- (2) gerçek domain OAuth bağlantıları + kesme bloğu (ana test veritabanı, tenant bağlamında) ------------------------------------
describe("gerçek OAuth bağlantıları ve kesilen eski bağlantının davranışı", () => {
  const reg = newRegistry();
  const prior = process.env.BETTER_AUTH_URL;
  let db: DbClient;
  let adm: pg.Client;
  let appPg: pg.Client;
  let fake: FakeParasut;
  const params = (w: TenantWorld) => ({ db, principal: { userId: w.ownerUserId, mfaVerified: true }, tenantSlug: w.slug, recentAuth: async () => undefined });
  const client = () => new ParasutClient({ baseUrl: fake.url, sleep: async () => undefined });
  const deps = () => ({ client: client(), sealer });
  const sys = (w: TenantWorld) => <T,>(fn: (tx: never) => Promise<T>) => withSystemTenant(db, w.tenantId, "test.t1139", fn as never) as Promise<T>;
  // Test veritabanının migration rolü RLS'i aşar ve başka test dosyaları ortak tabloyu paylaşır: seçici burada uygulama rolüyle (wms_app,
  // FORCE RLS) ve tek kiracının bağlamında koşar → yalnız o kiracının satırları görünür (tenant izolasyonu da böylece sınanır).
  const asAppTenant = async <T extends pg.QueryResultRow = Record<string, unknown>>(tenantId: string, text: string): Promise<T[]> => {
    await adm.query("BEGIN");
    try {
      await adm.query("SET LOCAL ROLE wms_app");
      await adm.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
      const r = await adm.query<T>(text);
      await adm.query("COMMIT");
      return r.rows;
    } catch (e) {
      await adm.query("ROLLBACK");
      throw e;
    }
  };
  const selected = async (w: TenantWorld) => (await asAppTenant<{ id: string }>(w.tenantId, SELECTOR)).map((r) => r.id);

  beforeAll(async () => {
    process.env.BETTER_AUTH_URL = "https://wms.example.test";
    db = createDbClient({ url: env.databaseUrl, poolMax: 4, prepare: false });
    adm = new pg.Client({ connectionString: env.databaseUrlDirect });
    await adm.connect();
    appPg = new pg.Client({ connectionString: env.databaseUrl });
    await appPg.connect();
  }, 120_000);
  afterAll(async () => {
    await fake?.close();
    await appPg?.end();
    await adm?.end();
    await db?.close();
    if (prior === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = prior;
  });
  beforeEach(async () => {
    await fake?.close();
    fake = await startFakeParasut();
  });

  it("ortak uygulama ve kendi uygulamasıyla kurulan bağlantılar seçiciye girmez; eski biçimli girer; seçici başka kiracıyı görmez", async () => {
    const S = await seedWorld(adm, reg, "LR1");
    const P = await seedWorld(adm, reg, "LR2");
    const L = await seedWorld(adm, reg, "LR3");
    expect(await connectParasutOAuth(params(S), deps(), fake)).toEqual({ ok: true, label: fake.opts.companyName });
    expect(await connectParasutOAuth(params(P), deps(), fake, { ownApp: true })).toEqual({ ok: true, label: fake.opts.companyName });
    expect((await inTenant<{ n: number }>(adm, P.tenantId, "SELECT count(*)::int AS n FROM public.integration_oauth_apps WHERE tenant_id = $1", [P.tenantId]))[0]?.n).toBe(1);
    const lId = await seedLegacyParasutConnection(adm, L, sealer);
    expect(await selected(S)).toEqual([]);
    expect(await selected(P)).toEqual([]);
    expect(await selected(L)).toEqual([lId]);
    // Yeniden OAuth bağlanma (aynı şirket) de seçiciye girmez (yeni COMPLETE deneme, yeni bağlanma anı).
    expect(await connectParasutOAuth(params(S), deps(), fake)).toMatchObject({ ok: true });
    expect(await selected(S)).toEqual([]);
  });

  it("kesilen eski bağlantı: eşitleme, zamanlayıcı, koşu isteği, sınama ve webhook araması reddedilir; ekran AUTH; başka kiracı etkilenmez; OAuth ile yeniden bağlanınca tercihler korunur ve eski webhook silinir", async () => {
    const L = await seedWorld(adm, reg, "LR4");
    const O = await seedWorld(adm, reg, "LR5");
    const lId = await seedLegacyParasutConnection(adm, L, sealer, { flowsOn: ["PRODUCTS", "SHIPMENTS"], webhooks: true });
    expect(await connectParasutOAuth(params(O), deps(), fake)).toMatchObject({ ok: true });
    const oBefore = await inTenant(adm, O.tenantId, "SELECT status, credentials, last_error_code FROM public.integrations WHERE tenant_id = $1", [O.tenantId]);
    // Paraşüt'te eski bağlantının kayıtları duruyor (migration ağ çağrısı yapamaz).
    for (const [eid, action] of [["9001", "create"], ["9002", "update"]] as const) fake.webhooks.push({ id: eid, attributes: { model: "product", action, uri: URI, encryption_key: "old" } });

    // Kesme bloğu (dosyadaki, yalnız L kiracısıyla sınırlanmış; ortak test veritabanında başka dosyaların satırlarına dokunmasın — migration'ın
    // bütün kiracılardaki davranışı yukarıdaki scratch testinde). audit_logs'a doğrudan yazım yalnız sahip rolündedir (migration ile aynı).
    const scoped = CUT.replace("WHERE i.provider = 'PARASUT'", `WHERE i.tenant_id = '${L.tenantId}'::uuid AND i.provider = 'PARASUT'`);
    expect(scoped).not.toBe(CUT);
    await adm.query(scoped);
    expect(await inTenant(adm, O.tenantId, "SELECT status, credentials, last_error_code FROM public.integrations WHERE tenant_id = $1", [O.tenantId])).toEqual(oBefore);
    expect((await inTenant<{ n: number }>(adm, O.tenantId, "SELECT count(*)::int AS n FROM public.audit_logs WHERE tenant_id = $1 AND change_summary->>'via' = 'migration_0068'", [O.tenantId]))[0]?.n).toBe(0);

    // Eşitleme ve her giriş yolu reddedilir.
    expect(await runIntegrationSync({ inTenant: sys(L), client: client(), sealer }, { integrationId: lId, trigger: "SCHEDULE" }, null)).toEqual({ kind: "skipped", reason: "NOT_CONNECTED" });
    const jobs: unknown[] = [];
    const queue = { enqueue: async (_tx: unknown, j: unknown) => (jobs.push(j), { jobId: randomUUID() }) };
    expect(await withSystemTenant(db, L.tenantId, "test.t1139", (tx) => enqueueScheduledIntegrations(tx as never, L.tenantId, queue as never))).toBe(0);
    expect(jobs).toEqual([]);
    expect(await requestIntegrationRun(params(L), { provider: "PARASUT" }, { queue: queue as never })).toEqual({ ok: false, reason: "NOT_CONNECTED" });
    expect(await checkIntegration(params(L), { provider: "PARASUT" }, deps())).toEqual({ ok: false, reason: "NOT_CONNECTED" });
    expect((await appPg.query("SELECT tenant_id FROM wms_probe.integration_webhook_lookup('PARASUT', '115')")).rows.filter((r) => r.tenant_id === L.tenantId)).toEqual([]);
    expect(fake.requests.filter((r) => r.authorization === "Bearer legacy-access")).toEqual([]);

    // Ekran: bağlı değil + tek AUTH bandı; akış tercihleri okunur.
    const o = await getIntegrationOverview(params(L));
    const pv = o.providers.find((p) => p.provider === "PARASUT");
    expect(pv?.connection).toBeNull();
    expect(o.health).toEqual({ level: "error", cause: "AUTH", next: "RECONNECT", flow: null, since: null, code: LEGACY_METHOD_REMOVED });
    expect(pv?.flows.filter((f) => f.enabled).map((f) => f.flow).sort()).toEqual(["PRODUCTS", "SHIPMENTS"]);
    // Başka kiracının görünümü bu bağlantıyı ve bandı içermez.
    expect((await getIntegrationOverview(params(O))).health).toMatchObject({ level: "ok" });

    // OAuth ile yeniden bağlan: kod temizlenir, akışlar olduğu gibi (ilk bağlantı varsayılanı yeniden uygulanmaz), sağlık ok.
    expect(await connectParasutOAuth(params(L), deps(), fake)).toEqual({ ok: true, label: fake.opts.companyName });
    expect(await inTenant(adm, L.tenantId, "SELECT id, status, last_error_code, credentials IS NOT NULL AS creds FROM public.integrations WHERE tenant_id = $1", [L.tenantId])).toEqual([{ id: lId, status: "CONNECTED", last_error_code: null, creds: true }]);
    const after = await getIntegrationOverview(params(L));
    expect(after.providers.find((p) => p.provider === "PARASUT")?.flows.filter((f) => f.enabled).map((f) => f.flow).sort()).toEqual(["PRODUCTS", "SHIPMENTS"]);
    expect(after.health?.cause).not.toBe("AUTH");
    expect(await selected(L)).toEqual([]);
    // Webhook kaydı: Paraşüt'te kalan eski kayıtlar (DELETED satırın kimliği) silinir, yenileri kurulur.
    expect(await registerParasutWebhooks({ inTenant: sys(L), client: client(), sealer, callbackUrl: URI }, lId)).toEqual({ kind: "ok", created: 6, kept: 0 });
    expect(fake.webhooks.map((w) => w.id)).not.toContain("9001");
    expect(fake.webhooks.map((w) => w.id)).not.toContain("9002");
    expect(fake.webhooks).toHaveLength(6);
  });
});
