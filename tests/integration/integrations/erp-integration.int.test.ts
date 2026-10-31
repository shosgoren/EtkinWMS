// T-991 (0055): ERP entegrasyonu — gerçek wms_app bağlantısı + sahte Paraşüt sunucusu (gerçek ağ yok). Kanıtlar: RLS (başka kiracı göremez /
// yazamaz), yetkisiz kullanıcı, demo reddi, sırrın DB'de mühürlü / audit'te ve dönüşte olmaması, yön kuralı (domain + DB CHECK), idempotency (aynı
// kayıt iki kez gelmez / gitmez), stok değişmez (ERP kartı stok yazmaz), irsaliyede kör yeniden gönderim yok, bağlayan yetkisini kaybedince durur,
// belirteç yenileme dönüşümü.
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, withSystemTenant } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { AppError } from "../../../packages/shared/src/errors.ts";
import { createSealer } from "../../../packages/shared/src/seal.ts";
import {
  ParasutClient,
  beginParasutOAuth,
  checkIntegration,
  completeParasutOAuth,
  disconnectIntegration,
  getIntegrationOverview,
  requestIntegrationRun,
  runIntegrationSync,
  setIntegrationFlow,
  getProductSourceInfo,
  getProductBarcodeSetting,
  selectParasutOAuthCompany,
  setProductBarcodeSetting,
} from "../../../packages/domain/src/integrations/index.ts";
import { startFakeParasut, type FakeParasut } from "../fixtures/fake-parasut.ts";
import { connectParasutOAuth, fakeSharedOAuth } from "../fixtures/parasut-oauth.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv, redactErrorChain } from "../harness/env.ts";

const env = readIntEnv(process.env);
const reg = newRegistry();
const sealer = createSealer(randomBytes(32).toString("hex"));

let app: DbClient;
let adm: pg.Client;
let appPg: pg.Client;
let A: TenantWorld;
let B: TenantWorld;
let fake: FakeParasut;

beforeAll(async () => {
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  appPg = new pg.Client({ connectionString: env.databaseUrl });
  appPg.on("error", () => undefined);
  try {
    await adm.connect();
    await appPg.connect();
  } catch (e) {
    throw new Error(`connect failed: ${redactErrorChain(e, [env.databaseUrl, env.databaseUrlDirect])}`);
  }
  A = await seedWorld(adm, reg, "ERPA");
  B = await seedWorld(adm, reg, "ERPB");
}, 120_000);

afterAll(async () => {
  await appPg.end();
  await adm.end();
  await app.close();
}, 120_000);

beforeEach(async () => {
  if (fake !== undefined) await fake.close();
  fake = await startFakeParasut();
});

const admin = (w: TenantWorld) => ({ db: app, principal: { userId: w.ownerUserId, mfaVerified: true }, tenantSlug: w.slug, recentAuth: async () => undefined });
const picker = (w: TenantWorld) => ({ db: app, principal: { userId: w.memberUserId, mfaVerified: true }, tenantSlug: w.slug });
const deps = () => ({ client: new ParasutClient({ baseUrl: fake.url, sleep: async () => undefined }), sealer });
const sync = (w: TenantWorld, integrationId: string, opts: { flow?: string; now?: () => number; trigger?: "MANUAL" | "SCHEDULE" } = {}) =>
  runIntegrationSync(
    { inTenant: (fn) => withSystemTenant(app, w.tenantId, "test.integration", fn), client: new ParasutClient({ baseUrl: fake.url, sleep: async () => undefined }), sealer, ...(opts.now === undefined ? {} : { now: opts.now }) },
    { integrationId, flow: opts.flow as never, trigger: opts.trigger ?? "MANUAL" },
    w.ownerUserId,
  );
async function q<T extends pg.QueryResultRow = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await adm.query<T>(text, params)).rows;
}
async function integrationId(w: TenantWorld): Promise<string> {
  const r = await q<{ id: string }>("SELECT id FROM public.integrations WHERE tenant_id = $1 AND provider = 'PARASUT'", [w.tenantId]);
  return r[0]?.id as string;
}
// T-1139: bağlantı yalnız OAuth ile; bu dosyanın testleri bütün akışlar kapalı başlangıçtan çalışır (ilk OAuth'un ürün çekmesi kapatılır).
async function connect(w: TenantWorld): Promise<string> {
  const r = await connectParasutOAuth(admin(w), deps(), fake, { productsOff: true });
  expect(r).toEqual({ ok: true, label: fake.opts.companyName });
  return integrationId(w);
}
async function fail(p: Promise<unknown>): Promise<AppError> {
  const e = await p.then(() => undefined, (x: unknown) => x);
  expect(e).toBeInstanceOf(AppError);
  return e as AppError;
}
/** wms_app olarak tek transaction; daima ROLLBACK. */
async function asApp(tenant: string, sql: string, params: unknown[] = []): Promise<{ ok: true; rows: unknown[]; rowCount: number } | { ok: false; code?: string }> {
  await appPg.query("BEGIN");
  try {
    await appPg.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenant]);
    const r = await appPg.query(sql, params);
    return { ok: true, rows: r.rows, rowCount: r.rowCount ?? 0 };
  } catch (e) {
    return { ok: false, code: (e as { code?: string }).code };
  } finally {
    await appPg.query("ROLLBACK");
  }
}
const stockFingerprint = async (w: TenantWorld) =>
  (await q<{ l: string; b: string; n: number }>("SELECT (SELECT coalesce(sum(quantity),0)::text FROM public.stock_ledger WHERE tenant_id=$1) AS l, (SELECT coalesce(sum(quantity),0)::text FROM public.stock_balances WHERE tenant_id=$1) AS b, (SELECT count(*)::int FROM public.stock_ledger WHERE tenant_id=$1) AS n", [w.tenantId]))[0];

describe("katalog: RLS ve yetkiler (0055)", () => {
  const TABLES = ["integrations", "integration_flows", "integration_runs", "integration_outbox", "integration_stock_marks"];
  it("ENABLE + FORCE RLS; wms_app DELETE yalnız koşu günlüğünde; mühürsüz kimlik bilgisi CHECK'te reddedilir", async () => {
    for (const t of TABLES) {
      const r = await q<{ rls: boolean; force: boolean; del: boolean }>(
        "SELECT relrowsecurity AS rls, relforcerowsecurity AS force, has_table_privilege('wms_app', oid, 'DELETE') AS del FROM pg_class WHERE oid = ('public.' || $1)::regclass",
        [t],
      );
      // T-1135 (0066): koşu günlüğü budaması için yalnız integration_runs'ta DELETE (silme bekçisi yakın geçmişi korur).
      expect(r[0], t).toEqual({ rls: true, force: true, del: t === "integration_runs" });
    }
    const plain = await asApp(A.tenantId, "INSERT INTO public.integrations (tenant_id, provider, status, credentials, connected_by, connected_membership_id, connected_at) VALUES ($1, 'LOGO', 'CONNECTED', '{\"password\":\"x\"}'::jsonb, $2, $3, now())", [A.tenantId, A.ownerUserId, A.ownerMembershipId]);
    expect(plain).toMatchObject({ ok: false, code: "23514" });
    const extra = await asApp(A.tenantId, "INSERT INTO public.integrations (tenant_id, provider, status, credentials, connected_by, connected_membership_id, connected_at) VALUES ($1, 'LOGO', 'CONNECTED', '{\"v\":2,\"kid\":\"a\",\"iv\":\"b\",\"tag\":\"c\",\"ct\":\"d\",\"secret\":\"x\"}'::jsonb, $2, $3, now())", [A.tenantId, A.ownerUserId, A.ownerMembershipId]);
    expect(extra).toMatchObject({ ok: false, code: "23514" });
  });

  it("yön kuralı DB'de: stok ve irsaliye ERP'den Etkin'e akmaz (I-04)", async () => {
    const id = await connect(A);
    for (const [flow, dir] of [["STOCK", "PULL"], ["STOCK", "BOTH"], ["SHIPMENTS", "PULL"], ["SALES_ORDERS", "PUSH"]]) {
      const r = await asApp(A.tenantId, "UPDATE public.integration_flows SET direction = $3 WHERE tenant_id = $1 AND integration_id = $2 AND flow = $4", [A.tenantId, id, dir, flow]);
      expect(r, `${flow}/${dir}`).toMatchObject({ ok: false, code: "23514" });
    }
  });

  it("başka kiracı A'nın bağlantısını göremez ve değiştiremez", async () => {
    await connect(A);
    for (const t of TABLES) {
      const seen = await asApp(B.tenantId, `SELECT count(*)::int AS n FROM public.${t} WHERE tenant_id = $1`, [A.tenantId]);
      expect(seen.ok && (seen.rows[0] as { n: number }).n, t).toBe(0);
    }
    const upd = await asApp(B.tenantId, "UPDATE public.integrations SET status = 'DISCONNECTED', credentials = NULL WHERE tenant_id = $1", [A.tenantId]);
    expect(upd).toMatchObject({ ok: true, rowCount: 0 });
    const ov = await getIntegrationOverview(admin(B));
    expect(ov.providers.find((p) => p.provider === "PARASUT")?.connection).toBeNull();
  });
});

describe("yetki ve demo", () => {
  it("yetkisiz (PICKER) okuyamaz, bağlanamaz, akış açamaz, kesemez", async () => {
    expect((await fail(getIntegrationOverview(picker(A)))).code).toBe("FORBIDDEN");
    expect((await fail(beginParasutOAuth({ ...picker(A), recentAuth: async () => undefined }, { ...deps(), oauth: fakeSharedOAuth(fake) }))).code).toBe("FORBIDDEN");
    expect((await fail(setIntegrationFlow(picker(A), { provider: "PARASUT", flow: "PRODUCTS", enabled: true, direction: "PULL" }))).code).toBe("FORBIDDEN");
    expect((await fail(disconnectIntegration({ ...picker(A), recentAuth: async () => undefined }, { provider: "PARASUT" }))).code).toBe("FORBIDDEN");
    // Yakın zamanda giriş bağlanmadan bağlan / kes çağrılamaz.
    const noRecent = { db: app, principal: { userId: A.ownerUserId, mfaVerified: true }, tenantSlug: A.slug };
    expect((await fail(beginParasutOAuth(noRecent, { ...deps(), oauth: fakeSharedOAuth(fake) }))).detail).toBe("RECENT_AUTH_REQUIRED");
    expect((await fail(disconnectIntegration(noRecent, { provider: "PARASUT" }))).detail).toBe("RECENT_AUTH_REQUIRED");
    expect((await fail(requestIntegrationRun(picker(A), { provider: "PARASUT" }, { queue: { enqueue: async () => ({ jobId: "x" }) } }))).code).toBe("FORBIDDEN");
    // Sahte sağlayıcıya hiç istek gitmedi (yetki ağdan önce).
    expect(fake.requests).toHaveLength(0);
  });

  it("demo alanında bağlantı kurulmaz (sağlayıcıya istek gitmez)", async () => {
    const D = await seedWorld(adm, reg, "ERPD");
    await adm.query("UPDATE public.tenants SET is_demo = true WHERE id = $1", [D.tenantId]);
    expect(await connectParasutOAuth(admin(D), deps(), fake)).toEqual({ ok: false, reason: "DEMO" });
    expect(fake.requests).toHaveLength(0);
  });
});

describe("bağlan / sına / kes ve sır", () => {
  it("sır DB'de mühürlü; audit ve okuma dönüşü sır taşımaz; ilk OAuth yalnız ürün çekmeyi açar; parola hiçbir istekte yok", async () => {
    const W = await seedWorld(adm, reg, "ERPS");
    const r = await connectParasutOAuth(admin(W), deps(), fake);
    expect(r).toEqual({ ok: true, label: fake.opts.companyName });
    const id = await integrationId(W);
    const row = (await q<{ status: string; account_label: string; account_ref: string; c: Record<string, unknown>; t: string }>("SELECT status, account_label, account_ref, credentials AS c, i::text AS t FROM public.integrations i WHERE id = $1", [id]))[0];
    expect(row?.status).toBe("CONNECTED");
    expect(row?.account_ref).toBe("115");
    expect(Object.keys(row?.c ?? {}).sort()).toEqual(["ct", "iv", "kid", "tag", "v"]);
    const everything = [
      row?.t ?? "",
      JSON.stringify(await q("SELECT change_summary FROM public.audit_logs WHERE tenant_id = $1", [W.tenantId])),
      JSON.stringify(await getIntegrationOverview(admin(W))),
    ].join("\n");
    for (const secret of [fake.opts.clientSecret, fake.opts.clientId, fake.accessToken, fake.refreshToken, fake.opts.username]) expect(everything).not.toContain(secret);
    expect((await q<{ action: string }>("SELECT action FROM public.audit_logs WHERE tenant_id = $1 AND action LIKE 'integration.%'", [W.tenantId])).map((a) => a.action).sort()).toEqual(["integration.connected", "integration.flow_changed", "integration.oauth_started"]);
    // T-1139: hiçbir istek parola akışı ya da kullanıcı adı/parola taşımaz; istemci sırrı yalnız token ucuna gider.
    expect(fake.requests.some((x) => /grant_type=password|(^|&)password=|(^|&)username=/.test(x.body))).toBe(false);
    expect([...new Set(fake.requests.filter((x) => x.body.includes(fake.opts.clientSecret)).map((x) => x.path))]).toEqual(["/oauth/token"]);
    // İlk OAuth bağlantısı: yalnız ürün çekme açık; diğerleri kapalı, kullanıcı kararındaki yönler.
    const flows = await q<{ flow: string; enabled: boolean; direction: string }>("SELECT flow, enabled, direction FROM public.integration_flows WHERE integration_id = $1 ORDER BY flow", [id]);
    expect(Object.fromEntries(flows.map((f) => [f.flow, `${f.enabled}/${f.direction}`]))).toEqual({ CONTACTS: "false/PULL", PRODUCTS: "true/PULL", SALES_ORDERS: "false/PULL", SHIPMENTS: "false/PUSH", STOCK: "false/PUSH", WAREHOUSES: "false/PULL" });
    expect(await checkIntegration(admin(W), { provider: "PARASUT" }, deps())).toEqual({ ok: true, label: fake.opts.companyName });
    expect(await disconnectIntegration(admin(W), { provider: "PARASUT" })).toEqual({ changed: true });
    expect((await q("SELECT status, credentials FROM public.integrations WHERE id = $1", [id]))[0]).toEqual({ status: "DISCONNECTED", credentials: null });
    expect((await getIntegrationOverview(admin(W))).providers.find((p) => p.provider === "PARASUT")?.connection).toBeNull();
  });

  it("hatalı yetki kodu / seçimden önce kaybolan şirket / bozuk şirket no: kayıt açılmaz, nedeni döner", async () => {
    const W = await seedWorld(adm, reg, "ERPF");
    expect(await connectParasutOAuth(admin(W), deps(), fake, { code: "yanlis-yetki-kodu" })).toEqual({ ok: false, reason: "AUTH_FAILED" });
    // İki şirket → seçim; seçilen şirket Paraşüt'te artık yoksa bağlantı açılmaz (yazma anında yeniden doğrulanır).
    fake.companies.push({ id: "116", name: "Öteki şirket" });
    const d = { ...deps(), oauth: fakeSharedOAuth(fake) };
    const b = await beginParasutOAuth(admin(W), d);
    if (!b.ok) throw new Error("begin failed");
    const sel = await completeParasutOAuth(admin(W), { binding: b.binding, code: fake.mintAuthorizationCode() }, d);
    expect(sel.ok && sel.status).toBe("SELECT");
    fake.companies.splice(0, 1);
    expect(await selectParasutOAuthCompany(admin(W), { binding: b.binding, companyId: fake.opts.companyId }, d)).toEqual({ ok: false, reason: "COMPANY_NOT_FOUND" });
    expect(await q("SELECT 1 FROM public.integrations WHERE tenant_id = $1", [W.tenantId])).toEqual([]);
    expect((await fail(selectParasutOAuthCompany(admin(W), { binding: b.binding, companyId: "11/../5" }, d))).code).toBe("VALIDATION_FAILED");
  });

  it("akış: Paraşüt'te olmayan akış ve yön reddedilir; açılınca ilk koşu kuyruğa girer; audit", async () => {
    const W = await seedWorld(adm, reg, "ERPL");
    await connect(W);
    // T-1139: bağlantı kurulumunun (OAuth ilk bağlantı ürün çekmeyi açar, kurulum kapatır) audit satırları bu testin konusu değil.
    const setup = (await q<{ id: string }>("SELECT id::text AS id FROM public.audit_logs WHERE tenant_id = $1", [W.tenantId])).map((r) => r.id);
    const jobs: unknown[] = [];
    const queue = { enqueue: async (_tx: unknown, job: unknown) => (jobs.push(job), { jobId: randomUUID() }) };
    expect(await setIntegrationFlow(admin(W), { provider: "PARASUT", flow: "SALES_ORDERS", enabled: true, direction: "PULL" }, { queue })).toEqual({ ok: false, reason: "UNSUPPORTED" });
    expect(await setIntegrationFlow(admin(W), { provider: "PARASUT", flow: "STOCK", enabled: true, direction: "PULL" }, { queue })).toEqual({ ok: false, reason: "UNSUPPORTED" });
    expect(await setIntegrationFlow(admin(W), { provider: "LOGO", flow: "PRODUCTS", enabled: true, direction: "PULL" }, { queue })).toEqual({ ok: false, reason: "UNSUPPORTED" });
    expect(await setIntegrationFlow(admin(W), { provider: "PARASUT", flow: "PRODUCTS", enabled: true, direction: "BOTH" }, { queue })).toEqual({ ok: true, enabled: true, direction: "BOTH", changed: true, queued: true });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ type: "integration.sync", payload: { flow: "PRODUCTS", trigger: "MANUAL" } });
    expect(await setIntegrationFlow(admin(W), { provider: "PARASUT", flow: "PRODUCTS", enabled: true, direction: "BOTH" }, { queue })).toMatchObject({ ok: true, changed: false, queued: false });
    const f = (await q<{ enabled_at: Date | null }>("SELECT enabled_at FROM public.integration_flows WHERE tenant_id = $1 AND flow = 'PRODUCTS'", [W.tenantId]))[0];
    expect(f?.enabled_at).not.toBeNull();
    expect((await q("SELECT change_summary->>'flow' AS f FROM public.audit_logs WHERE tenant_id = $1 AND action = 'integration.flow_changed' AND NOT (id::text = ANY($2::text[]))", [W.tenantId, setup]))).toEqual([{ f: "PRODUCTS" }]);
  });
});

describe("senkron", () => {
  it("ERP -> Etkin ürün/cari/depo: idempotent (ikinci koşuda yeni kayıt yok), stok değişmez, eşleme çift değil", async () => {
    const W = await seedWorld(adm, reg, "ERPP");
    const id = await connect(W);
    // Fikstürde yalnız ADET/KOLI var; Paraşüt "Kg" birimi Etkin KG birimine eşlenir (yoksa kart atlanır).
    await adm.query("INSERT INTO public.units (tenant_id, code, name) VALUES ($1, 'KG', 'Kilogram')", [W.tenantId]);
    fake.products.push({ id: "499", attributes: { code: "PRS-BIRIMSIZ", name: "Bilinmeyen birim", unit: "Varil" } });
    for (let i = 1; i <= 30; i++) fake.products.push({ id: String(500 + i), attributes: { code: `PRS-K${i}`, name: `Paraşüt ürünü ${i}`, unit: i % 2 ? "Adet" : "Kg", stock_count: 99, initial_stock_count: 50 } });
    fake.contacts.push({ id: "701", attributes: { name: "Müşteri A.Ş", account_type: "customer", tax_number: "1234567890", email: "a@example.test", short_name: "Müşteri", district: "Kadıköy" } });
    fake.contacts.push({ id: "702", attributes: { name: "Tedarikçi Ltd", account_type: "supplier" } });
    fake.warehouses.push({ id: "801", attributes: { name: "Merkez Depo" } });
    for (const flow of ["PRODUCTS", "CONTACTS", "WAREHOUSES"]) await setIntegrationFlow(admin(W), { provider: "PARASUT", flow, enabled: true, direction: "PULL" });
    const before = await stockFingerprint(W);
    const r1 = await sync(W, id);
    expect(r1.kind).toBe("ran");
    const counts = (r: typeof r1) => (r.kind === "ran" ? Object.fromEntries(r.flows.map((f) => [f.flow, [f.status, f.counts.created, f.counts.linked, f.counts.failed]])) : r);
    expect(counts(r1)).toEqual({ WAREHOUSES: ["SUCCESS", 1, 0, 0], PRODUCTS: ["PARTIAL", 30, 0, 1], CONTACTS: ["SUCCESS", 2, 0, 0] });
    // Tanınmayan birim reddedilir; stok miktarı yine yazılmaz.
    expect((await q<{ code: string }>("SELECT u.code FROM public.items i JOIN public.units u ON u.tenant_id = i.tenant_id AND u.id = i.base_unit_id WHERE i.tenant_id = $1 AND i.code = 'PRS-K2'", [W.tenantId]))[0]?.code).toBe("KG");
    const r2 = await sync(W, id);
    expect(counts(r2)).toEqual({ WAREHOUSES: ["SUCCESS", 0, 0, 0], PRODUCTS: ["PARTIAL", 0, 0, 1], CONTACTS: ["SUCCESS", 0, 0, 0] });
    expect((await q<{ n: number }>("SELECT count(*)::int AS n FROM public.items WHERE tenant_id = $1 AND code LIKE 'PRS-K%'", [W.tenantId]))[0]?.n).toBe(30);
    expect((await q<{ n: number }>("SELECT count(*)::int AS n FROM public.items WHERE tenant_id = $1 AND code = 'PRS-BIRIMSIZ'", [W.tenantId]))[0]?.n).toBe(0);
    expect((await q<{ n: number }>("SELECT count(*)::int AS n FROM public.external_refs WHERE tenant_id = $1 AND system = 'PARASUT' AND entity_type = 'ITEM'", [W.tenantId]))[0]?.n).toBe(30);
    // T-1117: Paraşüt kısa ad / ilçe cari kartına gelir; teslimat varsayılan (kendi personelim).
    expect((await q("SELECT kind, tax_no, short_name, district, delivery_mode FROM public.parties WHERE tenant_id = $1 AND code LIKE 'PRS-%' ORDER BY code", [W.tenantId]))).toEqual([
      { kind: "CUSTOMER", tax_no: "1234567890", short_name: "Müşteri", district: "Kadıköy", delivery_mode: "OWN" },
      { kind: "SUPPLIER", tax_no: null, short_name: null, district: null, delivery_mode: "OWN" },
    ]);
    // I-04: ERP'den gelen stok_count / initial_stock_count hiçbir stok satırı yazmadı.
    expect(await stockFingerprint(W)).toEqual(before);
    // Ad değişimi güncellenir, kod/eşleme aynı kalır.
    (fake.products[1] as { attributes: Record<string, unknown> }).attributes.name = "Yeni ad";
    const r3 = await sync(W, id, { flow: "PRODUCTS" });
    expect(r3.kind === "ran" && r3.flows[0]?.counts.updated).toBe(1);
    // Koşu günlüğü + her koşu audit'te.
    expect((await q<{ n: number }>("SELECT count(*)::int AS n FROM public.integration_runs WHERE tenant_id = $1 AND status = 'SUCCESS'", [W.tenantId]))[0]?.n).toBe(4);
    expect((await q<{ n: number }>("SELECT count(*)::int AS n FROM public.audit_logs WHERE tenant_id = $1 AND action = 'integration.synced'", [W.tenantId]))[0]?.n).toBe(7);
    // T-1111: değişiklik getirmeyen başarılı zamanlı koşu audit'e yazılmaz (koşu günlüğünde var); satır hatası olan (PARTIAL) yazılır.
    const r4 = await sync(W, id, { trigger: "SCHEDULE" });
    expect(counts(r4)).toEqual({ WAREHOUSES: ["SUCCESS", 0, 0, 0], PRODUCTS: ["PARTIAL", 0, 0, 1], CONTACTS: ["SUCCESS", 0, 0, 0] });
    // T-1135: değişiklik getirmeyen başarılı zamanlı koşu koşu günlüğünde de satır bırakmaz (iki boş SUCCESS satırı yok; PARTIAL yazılır).
    expect((await q<{ n: number }>("SELECT count(*)::int AS n FROM public.integration_runs WHERE tenant_id = $1 AND status = 'SUCCESS'", [W.tenantId]))[0]?.n).toBe(4);
    expect((await q<{ n: number }>("SELECT count(*)::int AS n FROM public.audit_logs WHERE tenant_id = $1 AND action = 'integration.synced'", [W.tenantId]))[0]?.n).toBe(8);
    // Biten koşu kaydı değişmez.
    const done = await asApp(W.tenantId, "UPDATE public.integration_runs SET status = 'RUNNING' WHERE tenant_id = $1", [W.tenantId]);
    expect(done).toMatchObject({ ok: false, code: "55000" });
  });

  it("ürün aktarımı KG hassasiyetini korur; kod veya bağlı kart birim uyuşmazlığında hiçbir kartı değiştirmez", async () => {
    const W = await seedWorld(adm, reg, "ERPU");
    const id = await connect(W);
    await adm.query("INSERT INTO public.units (tenant_id, code, name) VALUES ($1, 'KG', 'Kilogram')", [W.tenantId]);
    fake.products.push({ id: "901", attributes: { code: "UNIT-SAFE", name: "Granül", unit: "KG", stock_count: "125.50" } });
    await setIntegrationFlow(admin(W), { provider: "PARASUT", flow: "PRODUCTS", enabled: true, direction: "PULL" });
    const before = await stockFingerprint(W);
    const first = await sync(W, id);
    expect(first.kind === "ran" && first.flows[0]?.counts.created).toBe(1);
    expect(await q("SELECT quantity_scale, name FROM public.items WHERE tenant_id=$1 AND code='UNIT-SAFE'", [W.tenantId])).toEqual([{ quantity_scale: 6, name: "Granül" }]);
    fake.products[0] = { id: "901", attributes: { code: "UNIT-SAFE", name: "Yanlış değişim", unit: "Adet" } };
    const changed = await sync(W, id);
    expect(changed.kind === "ran" && changed.flows[0]?.status).toBe("PARTIAL");
    expect(changed.kind === "ran" && changed.flows[0]?.counts.failed).toBe(1);
    expect(await q("SELECT quantity_scale, name FROM public.items WHERE tenant_id=$1 AND code='UNIT-SAFE'", [W.tenantId])).toEqual([{ quantity_scale: 6, name: "Granül" }]);
    // Aynı kodlu ama henüz bağlanmamış kartta da birim kontrolü gerekir.
    await adm.query("INSERT INTO public.items (tenant_id, code, name, base_unit_id) SELECT $1, 'UNLINKED-UNIT', 'Mevcut', id FROM public.units WHERE tenant_id=$1 AND code='ADET'", [W.tenantId]);
    fake.products.splice(0, 1, { id: "902", attributes: { code: "UNLINKED-UNIT", name: "Farklı birim", unit: "KG" } });
    const linked = await sync(W, id);
    expect(linked.kind === "ran" && linked.flows[0]?.counts.failed).toBe(1);
    expect(await q("SELECT external_id FROM public.external_refs WHERE tenant_id=$1 AND system='PARASUT' AND external_id='902'", [W.tenantId])).toEqual([]);
    expect(await stockFingerprint(W)).toEqual(before);
  });

  it("barkod tercihi tenant/yetki korumalıdır; kapalıyken dahili, açıkken alternatif, tekrarında aynı etiket", async () => {
    const W = await seedWorld(adm, reg, "ERPBAR");
    const id = await connect(W);
    expect(await getProductBarcodeSetting(admin(W))).toBe(false);
    expect((await fail(setProductBarcodeSetting(picker(W), { enabled: true }))).code).toBe("FORBIDDEN");
    fake.products.push({ id: "931", attributes: { code: "BAR-SAFE", name: "Etiketli ürün", unit: "Adet", barcode: "EXT-BAR-931" } });
    await setIntegrationFlow(admin(W), { provider: "PARASUT", flow: "PRODUCTS", enabled: true, direction: "PULL" });
    const before = await stockFingerprint(W);
    await sync(W, id);
    const barcodes = () => q<{ barcode: string }>("SELECT b.barcode FROM public.item_barcodes b JOIN public.items i ON i.tenant_id=b.tenant_id AND i.id=b.item_id WHERE i.tenant_id=$1 AND i.code='BAR-SAFE' ORDER BY b.barcode", [W.tenantId]);
    const internal = await barcodes();
    expect(internal).toHaveLength(1);
    expect(internal[0]?.barcode).toMatch(/^EWMS-ITEM-[0-9a-f-]{36}$/);
    await sync(W, id);
    expect(await barcodes()).toEqual(internal);
    expect(await setProductBarcodeSetting(admin(W), { enabled: true })).toEqual({ changed: true });
    expect(await getProductBarcodeSetting(admin(W))).toBe(true);
    expect(await getProductBarcodeSetting(admin(A))).toBe(false);
    await sync(W, id);
    expect(await barcodes()).toEqual([...internal, { barcode: "EXT-BAR-931" }]);
    await setProductBarcodeSetting(admin(W), { enabled: false });
    fake.products[0] = { id: "931", attributes: { code: "BAR-SAFE", name: "Etiketli ürün", unit: "Adet", barcode: "EXT-NEW-931" } };
    await sync(W, id);
    expect(await barcodes()).toEqual([...internal, { barcode: "EXT-BAR-931" }]);
    await setProductBarcodeSetting(admin(W), { enabled: true });
    fake.products.push({ id: "932", attributes: { code: "BAR-CONFLICT", name: "Çakışan", unit: "Adet", barcode: "EXT-BAR-931" } });
    const conflict = await sync(W, id);
    expect(conflict.kind === "ran" && conflict.flows[0]?.counts.failed).toBe(1);
    expect(await q("SELECT id FROM public.items WHERE tenant_id=$1 AND code='BAR-CONFLICT'", [W.tenantId])).toEqual([]);
    expect(await stockFingerprint(W)).toEqual(before);
  });

  it("ürün aktarımı ayrılmış WMS paket QR alanını reddeder ve satırı bütünüyle geri alır", async () => {
    const W = await seedWorld(adm, reg, "ERPRQR");
    const id = await connect(W);
    await setIntegrationFlow(admin(W), { provider: "PARASUT", flow: "PRODUCTS", enabled: true, direction: "PULL" });
    await setProductBarcodeSetting(admin(W), { enabled: true });
    const before = await stockFingerprint(W);
    fake.products.push({ id: "941", attributes: { code: "RESERVED-QR", name: "Paketle karışmamalı", unit: "Adet", barcode: `EWMS:PKG:1:${randomUUID()}` } });
    const result = await sync(W, id);
    expect(result.kind === "ran" && result.flows[0]?.counts).toMatchObject({ created: 0, failed: 1 });
    expect(await q("SELECT id FROM public.items WHERE tenant_id=$1 AND code='RESERVED-QR'", [W.tenantId])).toEqual([]);
    expect(await q("SELECT external_id FROM public.external_refs WHERE tenant_id=$1 AND system='PARASUT' AND external_id='941'", [W.tenantId])).toEqual([]);
    expect(await stockFingerprint(W)).toEqual(before);
  });

  it.each([
    ["96385074", "00000096385074"],
    ["00000096385074", "96385074"],
  ])("GTIN-8 eşdeğerliği aktarım sırasından bağımsızdır: %s → %s", async (first, second) => {
    const W = await seedWorld(adm, reg, "ERPGTIN");
    const id = await connect(W);
    await setIntegrationFlow(admin(W), { provider: "PARASUT", flow: "PRODUCTS", enabled: true, direction: "PULL" });
    await setProductBarcodeSetting(admin(W), { enabled: true });
    fake.products.push({ id: "951", attributes: { code: "GTIN-FIRST", name: "İlk ürün", unit: "Adet", barcode: first } });
    const accepted = await sync(W, id);
    expect(accepted.kind === "ran" && accepted.flows[0]?.counts.created).toBe(1);
    fake.products.push({ id: "952", attributes: { code: "GTIN-SECOND", name: "İkinci ürün", unit: "Adet", barcode: second } });
    const rejected = await sync(W, id);
    expect(rejected.kind === "ran" && rejected.flows[0]?.counts).toMatchObject({ created: 0, failed: 1 });
    expect(await q("SELECT id FROM public.items WHERE tenant_id=$1 AND code='GTIN-SECOND'", [W.tenantId])).toEqual([]);
    expect(await q("SELECT barcode FROM public.item_barcodes WHERE tenant_id=$1 AND barcode=ANY($2::text[])", [W.tenantId, [first, second]])).toEqual([{ barcode: first }]);
  });

  it("kaynak kategori/GTİP miktar ve fiyat olmadan alınır; WMS kuralları, tenant sınırı ve tekrar güvenliği korunur", async () => {
    const W = await seedWorld(adm, reg, "ERPINFO");
    const id = await connect(W);
    await setIntegrationFlow(admin(W), { provider: "PARASUT", flow: "PRODUCTS", enabled: true, direction: "PULL" });
    await adm.query("INSERT INTO public.items (tenant_id,code,name,base_unit_id,tracking_mode,card_type) SELECT $1, 'INFO-SAFE', 'Kaynak ürünü', id, 'LOT', 'HM' FROM public.units WHERE tenant_id=$1 AND code='ADET'", [W.tenantId]);
    fake.categories.push({ id: "42", attributes: { name: "Hammaddeler", category_type: "Product" } });
    fake.products.push({ id: "961", attributes: { code: "INFO-SAFE", name: "Kaynak ürünü", unit: "Adet", gtip: "4008.21", archived: false, inventory_tracking: true, list_price: 120, buying_price: 100, currency: "TRY", stock_count: 999 }, relationships: { category: { data: { id: "42", type: "item_categories" } } } });
    const before = await stockFingerprint(W);
    await sync(W, id);
    const itemId = (await q<{ id: string }>("SELECT id FROM public.items WHERE tenant_id=$1 AND code='INFO-SAFE'", [W.tenantId]))[0]?.id as string;
    const expected = { PARASUT: { unit: "Adet", gtip: "4008.21", archived: false, inventoryTracking: true, categoryId: "42", categoryName: "Hammaddeler" } };
    expect(await getProductSourceInfo(admin(W), itemId)).toEqual(expected);
    expect((await fail(getProductSourceInfo(admin(A), itemId))).code).toBe("NOT_FOUND");
    const otherTenant = await asApp(A.tenantId, "UPDATE public.items SET source_product_info='{}'::jsonb WHERE id=$1", [itemId]);
    expect(otherTenant).toMatchObject({ ok: true, rowCount: 0 });
    const unchanged = await sync(W, id);
    expect(unchanged.kind === "ran" && unchanged.flows[0]?.counts.updated).toBe(0);
    // Kaynak bayrağı (takip) WMS kartını takipsiz yapmaz; boşalan kaynak alanı boşalır.
    fake.products[0] = { id: "961", attributes: { code: "INFO-SAFE", name: "Kaynak ürünü", unit: "Adet", archived: false, inventory_tracking: false, gtip: null }, relationships: { category: { data: null } } };
    await sync(W, id);
    expect(await getProductSourceInfo(admin(W), itemId)).toEqual({ PARASUT: { ...expected.PARASUT, inventoryTracking: false, gtip: null, categoryId: null, categoryName: null } });
    expect(await q("SELECT status,tracking_mode,card_type FROM public.items WHERE tenant_id=$1 AND id=$2", [W.tenantId, itemId])).toEqual([{ status: "ACTIVE", tracking_mode: "LOT", card_type: "HM" }]);
    // T-1139: bağlantı OAuth olduğundan ürün yaşam döngüsü (T-1067) açıktır: kaynakta arşiv yalnız yaşam döngüsü kuralıyla işlenir — stoksuz ve
    // açık işi olmayan kart arşivlenir (kullanıcı kararı 28 Ekim); takip modu ve kart türü aynı kalır, stok değişmez.
    fake.products[0] = { id: "961", attributes: { code: "INFO-SAFE", name: "Kaynak ürünü", unit: "Adet", archived: true, inventory_tracking: false, gtip: null }, relationships: { category: { data: null } } };
    await sync(W, id);
    expect(await getProductSourceInfo(admin(W), itemId)).toEqual({ PARASUT: { ...expected.PARASUT, archived: true, inventoryTracking: false, gtip: null, categoryId: null, categoryName: null, sourceState: "ARCHIVED", lifecycle: "ARCHIVED" } });
    expect(await q("SELECT status,tracking_mode,card_type FROM public.items WHERE tenant_id=$1 AND id=$2", [W.tenantId, itemId])).toEqual([{ status: "ARCHIVED", tracking_mode: "LOT", card_type: "HM" }]);
    const forbiddenField = await asApp(W.tenantId, "UPDATE public.items SET source_product_info=source_product_info || '{\"PARASUT\":{\"list_price\":100}}'::jsonb WHERE id=$1", [itemId]);
    expect(forbiddenField).toMatchObject({ ok: false, code: "23514" });
    expect(await stockFingerprint(W)).toEqual(before);
  });

  it("Etkin -> ERP ürün (BOTH): aynı koddaki ERP ürününe bağlanır, yenisi bir kez yaratılır", async () => {
    const W = await seedWorld(adm, reg, "ERPQ");
    const id = await connect(W);
    const codes = (await q<{ code: string }>("SELECT code FROM public.items WHERE tenant_id = $1 AND status = 'ACTIVE' ORDER BY code", [W.tenantId])).map((r) => r.code);
    expect(codes.length).toBeGreaterThan(1);
    fake.products.push({ id: "901", attributes: { code: codes[0], name: "ERP'deki aynı ürün" } });
    await setIntegrationFlow(admin(W), { provider: "PARASUT", flow: "PRODUCTS", enabled: true, direction: "PUSH" });
    const r1 = await sync(W, id);
    expect(r1.kind === "ran" && r1.flows[0]?.counts).toMatchObject({ linked: 1, created: codes.length - 1, failed: 0 });
    const posted = fake.requests.filter((x) => x.method === "POST" && x.path === "/v4/115/products").length;
    expect(posted).toBe(codes.length - 1);
    await sync(W, id);
    expect(fake.requests.filter((x) => x.method === "POST" && x.path === "/v4/115/products").length).toBe(posted);
    expect(fake.products).toHaveLength(codes.length);
  });

  it("irsaliye: gönderilir bir kez; belirsiz sonuçta (bağlantı koptu) kör yeniden gönderim yok → CHECK", async () => {
    const W = await seedWorld(adm, reg, "ERPI");
    const id = await connect(W);
    await setIntegrationFlow(admin(W), { provider: "PARASUT", flow: "SHIPMENTS", enabled: true, direction: "PUSH" });
    // Cari + ürün eşlemesi ve iki POSTED sevk belgesi (akış açıldıktan sonra).
    const party = (await q<{ id: string }>("INSERT INTO public.parties (tenant_id, code, code_key, name, created_by) VALUES ($1, 'C-001', 'C-001', 'Sevk carisi', $2) RETURNING id", [W.tenantId, W.ownerMembershipId]))[0]?.id;
    await adm.query("INSERT INTO public.external_refs (tenant_id, system, entity_type, entity_id, external_id) VALUES ($1, 'PARASUT', 'PARTY', $2, '777'), ($1, 'PARASUT', 'ITEM', $3, '555')", [W.tenantId, party, W.itemNoneId]);
    const docs: string[] = [];
    for (const n of [1, 2]) {
      const order = (await q<{ id: string }>("INSERT INTO public.sales_orders (tenant_id, number, customer_ref, created_by) VALUES ($1, $2, 'c-001', $3) RETURNING id", [W.tenantId, `SIP-T991-${n}`, W.ownerUserId]))[0]?.id;
      const doc = randomUUID();
      await adm.query(
        "INSERT INTO public.documents (tenant_id, id, kind, type_version_id, warehouse_id, business_date, created_by, source_kind, source_id) SELECT $1, $2, 'STOCK_OUT', id, $3, '2026-10-21', $4, 'SALES_ORDER', $5 FROM public.document_type_versions WHERE tenant_id IS NULL AND key = 'STOCK_OUT' AND version = 1",
        [W.tenantId, doc, W.warehouseId, W.ownerUserId, order],
      );
      await adm.query("INSERT INTO public.document_lines (tenant_id, document_id, line_no, item_id, unit_id, quantity, conversion_factor, base_quantity, source_location_id) VALUES ($1, $2, 1, $3, $4, 3, 1, 3, $5)", [W.tenantId, doc, W.itemNoneId, W.unitId, W.rootLocationId]);
      await adm.query("UPDATE public.documents SET status = 'POSTED', number = $3 WHERE tenant_id = $1 AND id = $2", [W.tenantId, doc, `SVK-T991-${n}`]);
      docs.push(doc);
    }
    fake.shipmentFailure = "drop";
    const r1 = await sync(W, id);
    expect(r1.kind === "ran" && r1.flows[0]?.status).toBe("PARTIAL");
    const ob1 = await q<{ status: string; n: number }>("SELECT status, count(*)::int AS n FROM public.integration_outbox WHERE tenant_id = $1 GROUP BY status ORDER BY status", [W.tenantId]);
    expect(ob1).toEqual([{ status: "CHECK", n: 2 }]);
    const attempts = fake.requests.filter((x) => x.path === "/v4/115/shipment_documents").length;
    fake.shipmentFailure = null;
    await sync(W, id);
    // CHECK satırları yeniden gönderilmez.
    expect(fake.requests.filter((x) => x.path === "/v4/115/shipment_documents").length).toBe(attempts);
    expect(fake.shipments).toHaveLength(0);
    // Yeni bir belge: bir kez gider, ikinci koşuda tekrar gitmez; cari/ürün eşlemesi kullanılır.
    await adm.query("UPDATE public.integration_outbox SET status = 'PENDING', last_error_code = NULL, next_attempt_at = now() WHERE tenant_id = $1 AND entity_id = $2", [W.tenantId, docs[0]]);
    await sync(W, id);
    await sync(W, id);
    expect(fake.shipments).toHaveLength(1);
    expect(fake.shipments[0]?.body).toMatchObject({ data: { attributes: { inflow: false, procurement_number: "SVK-T991-1" }, relationships: { contact: { data: { id: "777" } }, stock_movements: { data: [{ attributes: { quantity: 3 }, relationships: { product: { data: { id: "555" } } } }] } } } });
    expect((await q<{ n: number }>("SELECT count(*)::int AS n FROM public.external_refs WHERE tenant_id = $1 AND system = 'PARASUT' AND entity_type = 'DOCUMENT'", [W.tenantId]))[0]?.n).toBe(1);
    const sent = await asApp(W.tenantId, "UPDATE public.integration_outbox SET status = 'PENDING' WHERE tenant_id = $1 AND status = 'SENT'", [W.tenantId]);
    expect(sent).toMatchObject({ ok: false, code: "55000" });
    // Overview kontrol bekleyen irsaliyeyi sayar.
    expect((await getIntegrationOverview(admin(W))).outbox).toMatchObject({ check: 1 });
  });

  it("stok Etkin -> ERP: mutlak toplam yalnız değişince gider", async () => {
    const W = await seedWorld(adm, reg, "ERPK");
    const id = await connect(W);
    await adm.query("INSERT INTO public.external_refs (tenant_id, system, entity_type, entity_id, external_id) VALUES ($1, 'PARASUT', 'ITEM', $2, '555'), ($1, 'PARASUT', 'WAREHOUSE', $3, '801')", [W.tenantId, W.itemNoneId, W.warehouseId]);
    // T-1135: stok gönderimi Devir (işlenmiş açılış stoku belgesi) tamamlanmadan açılmaz.
    expect(await setIntegrationFlow(admin(W), { provider: "PARASUT", flow: "STOCK", enabled: true, direction: "PUSH" })).toEqual({ ok: false, reason: "OPENING_STOCK_INCOMPLETE" });
    const devir = randomUUID();
    await adm.query("INSERT INTO public.documents (tenant_id, id, kind, type_version_id, warehouse_id, business_date, created_by, reason) SELECT $1, $2, 'STOCK_IN', id, $3, '2026-10-30', $4, 'import.opening_stock' FROM public.document_type_versions WHERE tenant_id IS NULL AND key = 'STOCK_IN' AND version = 1", [W.tenantId, devir, W.warehouseId, W.ownerUserId]);
    await adm.query("UPDATE public.documents SET status = 'POSTED', number = 'DVR-T991' WHERE tenant_id = $1 AND id = $2", [W.tenantId, devir]);
    await setIntegrationFlow(admin(W), { provider: "PARASUT", flow: "STOCK", enabled: true, direction: "PUSH" });
    const before = await stockFingerprint(W);
    await sync(W, id);
    expect(fake.stockUpdates).toHaveLength(1);
    const detail = (fake.stockUpdates[0]?.body as { data: { relationships: { details: { data: { attributes: { new_total_inventory: number } }[] } } } }).data.relationships.details.data;
    expect(detail).toHaveLength(1);
    expect(detail[0]?.attributes.new_total_inventory).toBeGreaterThan(0);
    await sync(W, id);
    expect(fake.stockUpdates).toHaveLength(1);
    expect(await stockFingerprint(W)).toEqual(before);
  });

  it("bağlayan kişi yetkisini kaybedince hiçbir akış çalışmaz (CONNECTOR_REVOKED)", async () => {
    const W = await seedWorld(adm, reg, "ERPR");
    const id = await connect(W);
    await setIntegrationFlow(admin(W), { provider: "PARASUT", flow: "PRODUCTS", enabled: true, direction: "PULL" });
    await adm.query("DELETE FROM public.membership_roles WHERE tenant_id = $1 AND membership_id = $2 AND role_key = 'TENANT_ADMIN'", [W.tenantId, W.ownerMembershipId]);
    await adm.query("INSERT INTO public.membership_roles (tenant_id, membership_id, role_key) VALUES ($1, $2, 'READ_ONLY')", [W.tenantId, W.ownerMembershipId]);
    const before = fake.requests.length;
    expect(await sync(W, id)).toEqual({ kind: "skipped", reason: "CONNECTOR_REVOKED" });
    expect(fake.requests.length).toBe(before);
    expect((await q("SELECT status, last_error_code FROM public.integrations WHERE id = $1", [id]))[0]).toEqual({ status: "ERROR", last_error_code: "CONNECTOR_REVOKED" });
  });

  it("belirteç süresi dolunca yenilenir (yeni yenileme belirteci kalıcı); yenileme reddi → REAUTH_REQUIRED", async () => {
    const W = await seedWorld(adm, reg, "ERPT");
    const id = await connect(W);
    await setIntegrationFlow(admin(W), { provider: "PARASUT", flow: "WAREHOUSES", enabled: true, direction: "PULL" });
    const box1 = (await q<{ c: unknown }>("SELECT credentials AS c FROM public.integrations WHERE id = $1", [id]))[0]?.c;
    const later = (): number => Date.now() + 3 * 3600_000;
    const oldRefresh = fake.refreshToken;
    expect((await sync(W, id, { now: later })).kind).toBe("ran");
    expect(fake.refreshToken).not.toBe(oldRefresh);
    const box2 = (await q<{ c: unknown }>("SELECT credentials AS c FROM public.integrations WHERE id = $1", [id]))[0]?.c;
    expect(box2).not.toEqual(box1);
    // Kalıcı yeni belirteçle bir sonraki yenileme de çalışır.
    expect((await sync(W, id, { now: () => Date.now() + 6 * 3600_000 })).kind).toBe("ran");
    fake.revokeRefresh();
    expect(await sync(W, id, { now: () => Date.now() + 9 * 3600_000 })).toEqual({ kind: "skipped", reason: "REAUTH_REQUIRED" });
    expect((await q("SELECT status, last_error_code FROM public.integrations WHERE id = $1", [id]))[0]).toEqual({ status: "ERROR", last_error_code: "REAUTH_REQUIRED" });
  });
});
