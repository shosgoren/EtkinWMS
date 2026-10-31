// T-1138 (0067): Paraşüt anlık bildirim — gerçek wms_app bağlantısı + sahte Paraşüt. Kanıtlar: RLS/yetki (DELETE yok, mühürsüz anahtar CHECK'te
// reddedilir, probe araması yalnız bağlı + etkin bağlantı), bağlanınca kayıt işi, kayıt (6 webhook, idempotent, Paraşüt'ün atadığı anahtar),
// teslim → tek işte ürün oluştu/güncellendi/arşivlendi/kaldırıldı, cari güncellendi, yanlış imza / bilinmeyen şirket / başka tenant'ın
// anahtarı reddedilir (I-01..03), tekrar teslim tek etki (I-07), kademe geçişi, kesince Paraşüt'te silinir + anahtar NULL, uç (route) sınırları.
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "../../../packages/db/node_modules/drizzle-orm/index.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbClient, withSystemTenant } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { consumeOnce } from "../../../packages/queue-adapter/src/consume.ts";
import { createSealer } from "../../../packages/shared/src/seal.ts";
import {
  ParasutClient,
  connectParasut,
  disconnectIntegration,
  enqueueScheduledIntegrations,
  getWebhookStatus,
  receiveParasutWebhook,
  registerParasutWebhooks,
  runWebhookEvent,
  type ConsumeOnce,
} from "../../../packages/domain/src/integrations/index.ts";
import { startFakeParasut, type FakeParasut } from "../fixtures/fake-parasut.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv, redactErrorChain } from "../harness/env.ts";

const h = vi.hoisted(() => ({ db: undefined as unknown, queue: undefined as unknown }));
vi.mock("../../../packages/db/src/index.ts", async (orig) => ({ ...(await orig<Record<string, unknown>>()), getAppDb: () => h.db }));
vi.mock("../../../apps/web/lib/queue.ts", () => ({ getSenderQueue: () => Promise.resolve(h.queue) }));

const env = readIntEnv(process.env);
const reg = newRegistry();
const sealKey = randomBytes(32).toString("hex");
const sealer = createSealer(sealKey);
const URI = "https://wms.example.test/api/integrations/parasut/webhook";

let app: DbClient;
let adm: pg.Client;
let appPg: pg.Client;
let fake: FakeParasut;

beforeAll(async () => {
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  h.db = app;
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
}, 120_000);

afterAll(async () => {
  await fake?.close();
  await appPg.end();
  await adm.end();
  await app.close();
}, 120_000);

beforeEach(async () => {
  if (fake !== undefined) await fake.close();
  // Her test kendi şirket numarası: probe araması (en çok 5 bağlantı) önceki testlerin bağlantılarıyla karışmaz.
  fake = await startFakeParasut({ companyId: String(100_000 + Math.floor(Math.random() * 899_999)) });
});

const admin = (w: TenantWorld) => ({ db: app, principal: { userId: w.ownerUserId, mfaVerified: true }, tenantSlug: w.slug, recentAuth: async () => undefined });
// İstemci saati sanal: hız penceresi beklemesi gerçek zamanı tüketmez (olay döngüsünü kilitlemez).
const client = () => {
  let t = Date.now();
  return new ParasutClient({ baseUrl: fake.url, now: () => t, sleep: async (ms) => void (t += ms) });
};
const inTenant = (w: TenantWorld) => <T,>(fn: (tx: never) => Promise<T>) => withSystemTenant(app, w.tenantId, "test.webhook", fn as never) as Promise<T>;
async function q<T extends pg.QueryResultRow = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await adm.query<T>(text, params)).rows;
}

/** Kuyruk: işi ve yazıldığı transaction'ın tenant bağlamını kaydeder; aynı singletonKey ikinci kez yazılmaz (adaptör davranışı). */
function memQueue() {
  const jobs: { tenant: string; job: { type: string; payload: Record<string, unknown>; singletonKey?: string } }[] = [];
  return {
    jobs,
    enqueue: async (tx: { execute: (q: unknown) => Promise<unknown> }, job: unknown) => {
      const j = job as (typeof jobs)[number]["job"];
      if (j.singletonKey !== undefined && jobs.some((x) => x.job.singletonKey === j.singletonKey)) return { jobId: null };
      const r = (await tx.execute(sql`SELECT current_setting('app.current_tenant_id', true) AS t`)) as { t: string }[];
      jobs.push({ tenant: r[0]?.t ?? "", job: j });
      return { jobId: randomUUID() };
    },
  };
}

async function world(label: string, opts: { oauthApp?: boolean } = {}): Promise<{ w: TenantWorld; id: string }> {
  const w = await seedWorld(adm, reg, label);
  const r = await connectParasut(admin(w), { companyId: fake.opts.companyId, clientId: fake.opts.clientId, clientSecret: fake.opts.clientSecret, username: fake.opts.username, password: fake.opts.password }, { client: client(), sealer });
  expect(r.ok).toBe(true);
  const id = (await q<{ id: string }>("SELECT id FROM public.integrations WHERE tenant_id = $1", [w.tenantId]))[0]!.id;
  await q("UPDATE public.integration_flows SET enabled = true, direction = 'PULL' WHERE tenant_id = $1 AND flow IN ('PRODUCTS','CONTACTS')", [w.tenantId]);
  // Ürün yaşam döngüsü yalnız firma başına OAuth uygulaması varken çalışır (product-lifecycle.ts); sentetik mühürlü kutu.
  if (opts.oauthApp !== false) await q("INSERT INTO public.integration_oauth_apps(tenant_id,credentials) VALUES($1,'{\"v\":2,\"kid\":\"s\",\"iv\":\"s\",\"tag\":\"s\",\"ct\":\"s\"}')", [w.tenantId]);
  return { w, id };
}
const register = (w: TenantWorld, id: string, uri: string | null = URI) => registerParasutWebhooks({ inTenant: inTenant(w), client: client(), sealer, callbackUrl: uri }, id);

function delivery(ev: { model: string; action: string; id: string; key: string; eventDate?: string; companyId?: string; attributes?: Record<string, unknown> }): { body: string; signature: string } {
  // Paraşüt `data` kaydı gösterim biçimindedir ve `updated_at` taşır; imza yalnız `data`'yı kapsar (VARSAYIM) → olay zamanı buradan.
  const at = ev.eventDate ?? `${new Date().toISOString()}#${randomUUID()}`;
  const data = JSON.stringify({ id: ev.id, data: { id: ev.id, type: `${ev.model}s`, attributes: { ...(ev.attributes ?? { name: "yükteki ad (kullanılmaz)" }), updated_at: at } } });
  const body = new URLSearchParams({ company_id: ev.companyId ?? fake.opts.companyId, resource: ev.model, action: ev.action, event_date: at, data }).toString();
  return { body, signature: createHmac("sha256", ev.key).update(data).digest("hex") };
}
const hookKey = (model: string, action: string): string => fake.webhooks.find((w) => w.attributes.model === model && w.attributes.action === action)!.attributes.encryption_key as string;

function runner(w: TenantWorld, clock: { t: number }) {
  return (payload: { integrationId: string; resource: "product" | "contact"; action: "create" | "update" | "delete"; externalId: string; eventKey: string }) =>
    runWebhookEvent({ inTenant: inTenant(w), client: client(), sealer, consumeOnce: consumeOnce as unknown as ConsumeOnce, now: () => clock.t, sleep: async (ms) => void (clock.t += ms) }, payload);
}
async function deliverAndRun(w: TenantWorld, ev: Parameters<typeof delivery>[0], clock = { t: Date.now() }) {
  const queue = memQueue();
  const d = delivery(ev);
  const r = await receiveParasutWebhook({ db: app, sealer, queue: queue as never }, d);
  expect(r).toEqual({ status: 200, outcome: "QUEUED" });
  const p = queue.jobs[0]!.job.payload as Parameters<ReturnType<typeof runner>>[0];
  expect(queue.jobs[0]!.tenant).toBe(w.tenantId);
  return { result: await runner(w, clock)(p), payload: p, queue };
}

describe("0067: şema, RLS ve yetkiler", () => {
  it("ENABLE + FORCE RLS; wms_app DELETE yok; mühürsüz anahtar ve tanımsız model reddedilir; başka tenant göremez", async () => {
    const { w, id } = await world("WH0");
    const B = await seedWorld(adm, reg, "WH0B");
    const r = await q<{ rls: boolean; force: boolean; del: boolean }>("SELECT relrowsecurity AS rls, relforcerowsecurity AS force, has_table_privilege('wms_app', oid, 'DELETE') AS del FROM pg_class WHERE oid = 'public.integration_webhooks'::regclass");
    expect(r[0]).toEqual({ rls: true, force: true, del: false });
    const asApp = async (tenant: string, text: string, params: unknown[]) => {
      await appPg.query("BEGIN");
      try {
        await appPg.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenant]);
        const x = await appPg.query(text, params);
        return { ok: true as const, n: x.rowCount ?? 0, rows: x.rows };
      } catch (e) {
        return { ok: false as const, code: (e as { code?: string }).code };
      } finally {
        await appPg.query("ROLLBACK");
      }
    };
    const ins = "INSERT INTO public.integration_webhooks (tenant_id, integration_id, model, action, external_id, key_box) VALUES ($1, $2, $3, 'create', '9', $4::jsonb)";
    expect(await asApp(w.tenantId, ins, [w.tenantId, id, "product", '{"key":"duz"}'])).toMatchObject({ ok: false, code: "23514" });
    expect(await asApp(w.tenantId, ins, [w.tenantId, id, "sales_invoice", JSON.stringify(sealer.seal({ key: "k" }, { jobType: "x", template: "y", tenantId: w.tenantId }))])).toMatchObject({ ok: false, code: "23514" });
    expect(await asApp(B.tenantId, ins, [w.tenantId, id, "product", JSON.stringify(sealer.seal({ key: "k" }, { jobType: "x", template: "y", tenantId: w.tenantId }))])).toMatchObject({ ok: false });
    await register(w, id);
    expect((await asApp(B.tenantId, "SELECT count(*)::int AS n FROM public.integration_webhooks", [])).rows?.[0]).toEqual({ n: 0 });
    expect(await asApp(w.tenantId, "DELETE FROM public.integration_webhooks WHERE tenant_id = $1", [w.tenantId])).toMatchObject({ ok: false, code: "42501" });
    // Probe araması: yalnız tenant/bağlantı + mühürlü kutular; bilinmeyen/biçimsiz şirket boş.
    const look = async (c: string) => (await appPg.query("SELECT tenant_id, integration_id, jsonb_array_length(key_boxes) AS n FROM wms_probe.integration_webhook_lookup('PARASUT', $1)", [c])).rows;
    expect((await look(fake.opts.companyId)).filter((x) => x.tenant_id === w.tenantId)).toEqual([{ tenant_id: w.tenantId, integration_id: id, n: 6 }]);
    expect(await look("1")).toEqual([]);
    expect(await look("1' OR '1'='1")).toEqual([]);
    await disconnectIntegration(admin(w), { provider: "PARASUT" }, { client: client(), sealer });
    expect((await look(fake.opts.companyId)).filter((x) => x.tenant_id === w.tenantId)).toEqual([]);
  });
});

describe("kayıt", () => {
  it("bağlanınca kayıt işi kuyruğa girer; 6 webhook, mühürlü anahtar, idempotent; durum okuması", async () => {
    const w = await seedWorld(adm, reg, "WH1");
    const queue = memQueue();
    await connectParasut(admin(w), { companyId: fake.opts.companyId, clientId: fake.opts.clientId, clientSecret: fake.opts.clientSecret, username: fake.opts.username, password: fake.opts.password }, { client: client(), sealer, queue: queue as never });
    const id = (await q<{ id: string }>("SELECT id FROM public.integrations WHERE tenant_id = $1", [w.tenantId]))[0]!.id;
    expect(queue.jobs.map((j) => j.job)).toEqual([{ type: "integration.webhook", actorUserId: w.ownerUserId, payload: { integrationId: id, kind: "REGISTER" }, singletonKey: `integration.webhook.register.${id}` }]);
    expect(queue.jobs[0]!.tenant).toBe(w.tenantId);
    expect(await getWebhookStatus(admin(w))).toEqual({ status: "OFF", lastEventAt: null, checkedAt: null });
    expect(await register(w, id)).toEqual({ kind: "ok", created: 6, kept: 0 });
    expect(fake.webhooks.map((x) => `${x.attributes.model}/${x.attributes.action}@${x.attributes.uri}`).sort()).toEqual(["contact/create", "contact/delete", "contact/update", "product/create", "product/delete", "product/update"].map((x) => `${x}@${URI}`));
    const rows = await q<{ key_box: Record<string, unknown>; status: string }>("SELECT key_box, status FROM public.integration_webhooks WHERE tenant_id = $1", [w.tenantId]);
    expect(rows).toHaveLength(6);
    const key = fake.webhooks[0]!.attributes.encryption_key as string;
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    for (const r of rows) {
      expect(Object.keys(r.key_box).sort()).toEqual(["ct", "iv", "kid", "tag", "v"]);
      expect(JSON.stringify(r.key_box)).not.toContain(key);
    }
    expect(JSON.stringify(await q("SELECT change_summary FROM public.audit_logs WHERE tenant_id = $1", [w.tenantId]))).not.toContain(key);
    expect((await getWebhookStatus(admin(w)))?.status).toBe("ACTIVE");
    expect(await register(w, id)).toEqual({ kind: "ok", created: 0, kept: 6 });
    expect(fake.webhooks).toHaveLength(6);
    // Paraşüt'te elle silinen kayıt günlük uzlaştırmada yeniden kurulur.
    fake.webhooks.splice(0, 1);
    expect(await register(w, id)).toEqual({ kind: "ok", created: 1, kept: 5 });
  });

  it("Paraşüt anahtarı kendisi atarsa (alanı reddeder) onun anahtarı saklanır ve teslim doğrulanır", async () => {
    fake.webhookKeyMode = "assign";
    const { w, id } = await world("WH2");
    expect(await register(w, id)).toEqual({ kind: "ok", created: 6, kept: 0 });
    fake.products.push({ id: "701", attributes: { code: "WH2-1", name: "Atanan anahtar", unit: "Adet" } });
    const { result } = await deliverAndRun(w, { model: "product", action: "create", id: "701", key: hookKey("product", "create") });
    expect(result).toEqual({ kind: "applied", outcome: "CREATED" });
  });

  it("kurulamazsa FAILED + kod; adres yoksa CONFIG; 30 sn kademesi sürer", async () => {
    const { w, id } = await world("WH3");
    expect(await register(w, id, null)).toEqual({ kind: "failed", code: "CONFIG" });
    fake.webhookFailure = 500;
    expect(await register(w, id)).toEqual({ kind: "failed", code: "PROVIDER_UNAVAILABLE" });
    expect((await q("SELECT webhook_status, webhook_last_error_code FROM public.integrations WHERE id = $1", [id]))[0]).toEqual({ webhook_status: "FAILED", webhook_last_error_code: "PROVIDER_UNAVAILABLE" });
    expect((await getWebhookStatus(admin(w)))?.status).toBe("FAILED");
  });
});

describe("teslim → tek işte kart", () => {
  it("ürün: oluştu, güncellendi (yük değil Paraşüt'teki güncel ad), arşivlendi, kesin silinince Kaldırıldı", async () => {
    const { w, id } = await world("WH4");
    await register(w, id);
    fake.products.push({ id: "801", attributes: { code: "WH4-1", name: "Somun M8", unit: "Adet" } });
    const clock = { t: Date.now() };
    const created = await deliverAndRun(w, { model: "product", action: "create", id: "801", key: hookKey("product", "create") }, clock);
    expect(created.result).toEqual({ kind: "applied", outcome: "CREATED" });
    const item = async () => (await q<{ name: string; status: string; source_state: string; source_disposition: string }>("SELECT i.name, i.status, i.source_state, i.source_disposition FROM public.items i JOIN public.external_refs r ON r.tenant_id = i.tenant_id AND r.entity_id = i.id AND r.system = 'PARASUT' AND r.entity_type = 'ITEM' WHERE i.tenant_id = $1 AND r.external_id = '801'", [w.tenantId]))[0];
    expect(await item()).toMatchObject({ name: "Somun M8", status: "ACTIVE" });
    fake.products[0]!.attributes.name = "Somun M8 galvaniz";
    expect((await deliverAndRun(w, { model: "product", action: "update", id: "801", key: hookKey("product", "update") }, clock)).result).toEqual({ kind: "applied", outcome: "UPDATED" });
    expect((await item())?.name).toBe("Somun M8 galvaniz");
    fake.products[0]!.attributes.archived = true;
    await deliverAndRun(w, { model: "product", action: "update", id: "801", key: hookKey("product", "update") }, clock);
    expect(await item()).toMatchObject({ status: "ARCHIVED", source_state: "ARCHIVED", source_disposition: "ARCHIVED" });
    fake.products.splice(0, 1);
    const removed = await deliverAndRun(w, { model: "product", action: "delete", id: "801", key: hookKey("product", "delete") }, clock);
    expect(removed.result).toEqual({ kind: "applied", outcome: "REMOVED_CHECKED" });
    // Fiziksel silme yok: kart ve eşleme durur, durum kaynakta silindi + hiç kullanılmadığı için Kaldırıldı.
    expect(await item()).toMatchObject({ status: "ARCHIVED", source_state: "DELETED", source_disposition: "REMOVED" });
    expect(await q("SELECT change_summary->>'outcome' AS o FROM public.audit_logs WHERE tenant_id = $1 AND action = 'integration.webhook_received' ORDER BY occurred_at", [w.tenantId])).toEqual([{ o: "CREATED" }, { o: "UPDATED" }, { o: "UPDATED" }, { o: "REMOVED_CHECKED" }]);
    expect((await getWebhookStatus(admin(w)))?.lastEventAt).not.toBeNull();
  });

  it("geçici 404 silme değildir: ikinci denetimde kayıt döndüyse kart etkin kalır", async () => {
    const { w, id } = await world("WH5");
    await register(w, id);
    fake.products.push({ id: "802", attributes: { code: "WH5-1", name: "Pul", unit: "Adet" } });
    const clock = { t: Date.now() };
    await deliverAndRun(w, { model: "product", action: "create", id: "802", key: hookKey("product", "create") }, clock);
    const saved = fake.products.splice(0, 1);
    const queue = memQueue();
    const d = delivery({ model: "product", action: "delete", id: "802", key: hookKey("product", "delete") });
    await receiveParasutWebhook({ db: app, sealer, queue: queue as never }, d);
    const res = await runWebhookEvent({ inTenant: inTenant(w), client: client(), sealer, consumeOnce: consumeOnce as unknown as ConsumeOnce, now: () => clock.t, sleep: async (ms) => { clock.t += ms; fake.products.push(...saved); } }, queue.jobs[0]!.job.payload as never);
    expect(res).toMatchObject({ kind: "applied" });
    expect((await q("SELECT i.status, i.source_state FROM public.items i WHERE i.tenant_id = $1 AND i.code = 'WH5-1'", [w.tenantId]))[0]).toEqual({ status: "ACTIVE", source_state: "ACTIVE" });
  });

  it("cari: oluştu ve güncellendi; akış kapalıysa iş atlanır", async () => {
    const { w, id } = await world("WH6");
    await register(w, id);
    fake.contacts.push({ id: "901", attributes: { name: "Aras Kauçuk", account_type: "customer", tax_number: "1234567890" } });
    expect((await deliverAndRun(w, { model: "contact", action: "create", id: "901", key: hookKey("contact", "create") })).result).toEqual({ kind: "applied", outcome: "CREATED" });
    fake.contacts[0]!.attributes.name = "Aras Kauçuk A.Ş.";
    expect((await deliverAndRun(w, { model: "contact", action: "update", id: "901", key: hookKey("contact", "update") })).result).toEqual({ kind: "applied", outcome: "UPDATED" });
    expect((await q("SELECT name FROM public.parties WHERE tenant_id = $1 AND code = 'PRS-901'", [w.tenantId]))[0]).toEqual({ name: "Aras Kauçuk A.Ş." });
    await q("UPDATE public.integration_flows SET enabled = false WHERE tenant_id = $1 AND flow = 'CONTACTS'", [w.tenantId]);
    fake.contacts[0]!.attributes.name = "Değişmemeli";
    expect((await deliverAndRun(w, { model: "contact", action: "update", id: "901", key: hookKey("contact", "update") })).result).toEqual({ kind: "skipped", reason: "FLOW_OFF" });
    expect((await q("SELECT name FROM public.parties WHERE tenant_id = $1 AND code = 'PRS-901'", [w.tenantId]))[0]).toEqual({ name: "Aras Kauçuk A.Ş." });
  });
});

describe("ret ve tenant yalıtımı (I-01..03)", () => {
  it("yanlış imza, imzasız, bilinmeyen şirket, bozuk gövde: aynı 401; iş yok", async () => {
    const { w, id } = await world("WH7");
    await register(w, id);
    const queue = memQueue();
    const key = hookKey("product", "update");
    const ok = delivery({ model: "product", action: "update", id: "1", key });
    const deps = { db: app, sealer, queue: queue as never };
    for (const bad of [
      { ...ok, signature: createHmac("sha256", randomBytes(32)).update("x").digest("hex") },
      { ...ok, signature: null },
      delivery({ model: "product", action: "update", id: "1", key, companyId: "424242" }),
      { body: "company_id=115&resource=product", signature: ok.signature },
      // İmza veriyi kapsar: yükteki kimlik değişirse imza tutmaz.
      { body: ok.body.replace(encodeURIComponent('"id":"1"'), encodeURIComponent('"id":"2"')), signature: ok.signature },
    ]) expect(await receiveParasutWebhook(deps, bad)).toEqual({ status: 401, outcome: "REJECTED" });
    expect(queue.jobs).toEqual([]);
    // Kart dışı model: doğrulanır, iş açılmaz.
    expect(await receiveParasutWebhook(deps, delivery({ model: "sales_invoice", action: "create", id: "5", key }))).toEqual({ status: 200, outcome: "IGNORED" });
    expect(queue.jobs).toEqual([]);
    // Kuyruk yoksa 503 (Paraşüt yeniden dener; uzlaştırma da yakalar).
    expect(await receiveParasutWebhook({ db: app, sealer, queue: undefined }, ok)).toEqual({ status: 503, outcome: "UNAVAILABLE" });
  });

  it("aynı şirkete bağlı iki tenant: teslim yalnız imzası tutan tenant'a gider; diğerinin kartına dokunulmaz", async () => {
    // Sahte Paraşüt tek belirteç tutar (ikinci bağlantı ilkinin belirtecini döndürür): burada yönlendirme ve bağlam kanıtlanır.
    const A = await world("WH8A");
    await register(A.w, A.id);
    const keyA = hookKey("product", "update");
    fake.webhooks.splice(0); // B kendi anahtarıyla kaydolur
    const B = await world("WH8B");
    await register(B.w, B.id);
    const keyB = hookKey("product", "update");
    expect(keyA).not.toBe(keyB);
    const queue = memQueue();
    const deps = { db: app, sealer, queue: queue as never };
    expect(await receiveParasutWebhook(deps, delivery({ model: "product", action: "update", id: "811", key: keyA }))).toEqual({ status: 200, outcome: "QUEUED" });
    expect(await receiveParasutWebhook(deps, delivery({ model: "product", action: "update", id: "811", key: keyB, eventDate: "b" }))).toEqual({ status: 200, outcome: "QUEUED" });
    expect(queue.jobs.map((j) => [j.tenant, j.job.payload.integrationId])).toEqual([[A.w.tenantId, A.id], [B.w.tenantId, B.id]]);
    // A'nın işini B bağlamında çalıştırmak (yük değiştirme denemesi): bağlantı kimliği B'de görünmez → atlanır, B'ye yazılmaz.
    fake.products.push({ id: "811", attributes: { code: "WH8-1", name: "Rondela", unit: "Adet" } });
    const cross = await runner(B.w, { t: Date.now() })({ ...(queue.jobs[0]!.job.payload as Parameters<ReturnType<typeof runner>>[0]), eventKey: randomUUID() });
    expect(cross).toEqual({ kind: "skipped", reason: "NOT_CONNECTED" });
    expect(await runner(B.w, { t: Date.now() })(queue.jobs[1]!.job.payload as never)).toEqual({ kind: "applied", outcome: "CREATED" });
    expect(await q("SELECT tenant_id FROM public.items WHERE code = 'WH8-1'")).toEqual([{ tenant_id: B.w.tenantId }]);
  });

  it("tekrar teslim tek etki: kuyrukta tekil anahtar + processed_events", async () => {
    const { w, id } = await world("WH9");
    await register(w, id);
    fake.products.push({ id: "821", attributes: { code: "WH9-1", name: "Conta", unit: "Adet" } });
    const queue = memQueue();
    const d = delivery({ model: "product", action: "create", id: "821", key: hookKey("product", "create"), eventDate: "2026-10-30T10:00:00+03:00" });
    expect(await receiveParasutWebhook({ db: app, sealer, queue: queue as never }, d)).toEqual({ status: 200, outcome: "QUEUED" });
    expect(await receiveParasutWebhook({ db: app, sealer, queue: queue as never }, d)).toEqual({ status: 200, outcome: "DUPLICATE" });
    const p = queue.jobs[0]!.job.payload as never;
    const run = runner(w, { t: Date.now() });
    expect(await run(p)).toEqual({ kind: "applied", outcome: "CREATED" });
    expect(await run(p)).toEqual({ kind: "duplicate" });
    expect(await q("SELECT count(*)::int AS n FROM public.audit_logs WHERE tenant_id = $1 AND action = 'integration.webhook_received'", [w.tenantId])).toEqual([{ n: 1 }]);
  });
});

describe("tekrar teslim ve imzasız alanlar (inceleme MINOR-1)", () => {
  it("yalnız `data` imzalıysa dış event_date ve action yok sayılır: yeniden tarihlenen tekrar aynı olay; audit'e eylem yazılmaz", async () => {
    const { w, id } = await world("WHR1");
    await register(w, id);
    fake.products.push({ id: "831", attributes: { code: "WHR1-1", name: "Kelepçe", unit: "Adet" } });
    const d = delivery({ model: "product", action: "create", id: "831", key: hookKey("product", "create"), eventDate: "2026-10-30T11:00:00+03:00" });
    const redated = (date: string, action: string) => {
      const f = new URLSearchParams(d.body);
      f.set("event_date", date);
      f.set("action", action);
      return { body: f.toString(), signature: d.signature };
    };
    const queue = memQueue();
    const deps = { db: app, sealer, queue: queue as never };
    expect(await receiveParasutWebhook(deps, d)).toEqual({ status: 200, outcome: "QUEUED" });
    const p0 = queue.jobs[0]!.job.payload;
    expect(p0).not.toHaveProperty("action");
    expect(queue.jobs[0]!.job.singletonKey).toBe(`integration.webhook.event.${id}.product.831`);
    // İş beklerken yeniden tarihlenmiş/eylemi değiştirilmiş tekrarlar yeni iş açmaz (kayıt başına tekil anahtar).
    for (let i = 0; i < 5; i++) expect(await receiveParasutWebhook(deps, redated(`2027-01-0${i + 1}T00:00:00Z`, "delete"))).toEqual({ status: 200, outcome: "DUPLICATE" });
    expect(queue.jobs).toHaveLength(1);
    const run = runner(w, { t: Date.now() });
    expect(await run(p0 as never)).toEqual({ kind: "applied", outcome: "CREATED" });
    // İş bittikten sonra gelen yeniden tarihli tekrar: olay anahtarı imzalı veriden → aynı; etki yok.
    const q2 = memQueue();
    expect(await receiveParasutWebhook({ db: app, sealer, queue: q2 as never }, redated("2027-02-01T00:00:00Z", "update"))).toEqual({ status: 200, outcome: "QUEUED" });
    expect(q2.jobs[0]!.job.payload.eventKey).toBe(p0.eventKey);
    expect(await run(q2.jobs[0]!.job.payload as never)).toEqual({ kind: "duplicate" });
    expect(await q("SELECT change_summary FROM public.audit_logs WHERE tenant_id = $1 AND action = 'integration.webhook_received'", [w.tenantId])).toEqual([{ change_summary: { provider: "PARASUT", resource: "product", outcome: "CREATED" } }]);
  });

  it("ham gövde imzalıysa dış event_date ve action imzalıdır ve kullanılır", async () => {
    const { w, id } = await world("WHR2");
    await register(w, id);
    fake.products.push({ id: "832", attributes: { code: "WHR2-1", name: "Somun", unit: "Adet" } });
    const key = hookKey("product", "update");
    const d = delivery({ model: "product", action: "update", id: "832", key, eventDate: "x" });
    const signed = { body: d.body, signature: createHmac("sha256", key).update(d.body).digest("hex") };
    const queue = memQueue();
    expect(await receiveParasutWebhook({ db: app, sealer, queue: queue as never }, signed)).toEqual({ status: 200, outcome: "QUEUED" });
    expect(queue.jobs[0]!.job.payload).toMatchObject({ action: "update", resource: "product", externalId: "832" });
    expect(await runner(w, { t: Date.now() })(queue.jobs[0]!.job.payload as never)).toMatchObject({ kind: "applied" });
    expect((await q<{ a: string }>("SELECT change_summary->>'action' AS a FROM public.audit_logs WHERE tenant_id = $1 AND action = 'integration.webhook_received'", [w.tenantId]))[0]?.a).toBe("update");
  });
});

describe("PR 273 inceleme düzeltmeleri", () => {
  it("P1: okuma sürerken bağlantı kesilir ya da akış kapanırsa cari/ürün yazılmaz (yazım anı yetki denetimi)", async () => {
    const { w, id } = await world("WHP1");
    await register(w, id);
    fake.contacts.push({ id: "941", attributes: { name: "Yarış Cari", account_type: "customer" } });
    fake.products.push({ id: "942", attributes: { code: "WHP1-1", name: "Yarış Ürün", unit: "Adet" } });
    const run = async (model: "contact" | "product", during: () => Promise<unknown>) => {
      const queue = memQueue();
      await receiveParasutWebhook({ db: app, sealer, queue: queue as never }, delivery({ model, action: "create", id: model === "contact" ? "941" : "942", key: hookKey(model, "create") }));
      const c = client();
      const origContact = c.contact.bind(c), origProduct = c.productDetail.bind(c);
      c.contact = async (...a) => { const r = await origContact(...a); await during(); return r; };
      c.productDetail = async (...a) => { const r = await origProduct(...a); await during(); return r; };
      return runWebhookEvent({ inTenant: inTenant(w), client: c, sealer, consumeOnce: consumeOnce as unknown as ConsumeOnce }, queue.jobs[0]!.job.payload as never);
    };
    expect(await run("contact", () => q("UPDATE public.integration_flows SET enabled = false WHERE tenant_id = $1 AND flow = 'CONTACTS'", [w.tenantId]))).toEqual({ kind: "skipped", reason: "NOT_CONNECTED" });
    expect(await q("SELECT 1 FROM public.parties WHERE tenant_id = $1 AND code = 'PRS-941'", [w.tenantId])).toEqual([]);
    await q("UPDATE public.integration_flows SET enabled = true WHERE tenant_id = $1 AND flow = 'CONTACTS'", [w.tenantId]);
    expect(await run("contact", () => q("UPDATE public.membership_roles SET role_key = 'WAREHOUSE_MANAGER' WHERE tenant_id = $1 AND membership_id = $2 AND role_key = 'TENANT_ADMIN'", [w.tenantId, w.ownerMembershipId]).catch(() => q("DELETE FROM public.membership_roles WHERE tenant_id = $1 AND membership_id = $2 AND role_key = 'TENANT_ADMIN'", [w.tenantId, w.ownerMembershipId])))).toEqual({ kind: "skipped", reason: "NOT_CONNECTED" });
    expect(await q("SELECT 1 FROM public.parties WHERE tenant_id = $1 AND code = 'PRS-941'", [w.tenantId])).toEqual([]);
    await q("INSERT INTO public.membership_roles (tenant_id, membership_id, role_key) VALUES ($1, $2, 'TENANT_ADMIN') ON CONFLICT DO NOTHING", [w.tenantId, w.ownerMembershipId]);
    expect(await run("product", () => q("UPDATE public.integrations SET status = 'DISCONNECTED', credentials = NULL WHERE id = $1", [id]))).toEqual({ kind: "skipped", reason: "NOT_CONNECTED" });
    expect(await q("SELECT 1 FROM public.items WHERE tenant_id = $1 AND code = 'WHP1-1'", [w.tenantId])).toEqual([]);
    expect(await q("SELECT count(*)::int AS n FROM public.processed_events WHERE tenant_id = $1 AND consumer = 'integration.webhook.event'", [w.tenantId])).toEqual([{ n: 0 }]);
  });

  it("P2: geçici DB hatası FAILED olmaz — transaction ve processed_events geri alınır, yeniden deneme uygular; kesin red FAILED", async () => {
    const { w, id } = await world("WHP2");
    await register(w, id);
    fake.contacts.push({ id: "951", attributes: { name: "Geçici Cari", account_type: "customer" } });
    const queue = memQueue();
    await receiveParasutWebhook({ db: app, sealer, queue: queue as never }, delivery({ model: "contact", action: "create", id: "951", key: hookKey("contact", "create") }));
    const payload = queue.jobs[0]!.job.payload as never;
    // Kart okunurken (apply içinde) atılan hata: 40P01 (kilitlenme) geçicidir.
    const failing = (err: Error) => {
      const c = client();
      const orig = c.contact.bind(c);
      c.contact = async (...a) => {
        const r = await orig(...a);
        if (r === null) return r;
        return { ...r, get attributes(): Record<string, unknown> { throw err; } } as never;
      };
      return c;
    };
    const deadlock = Object.assign(new Error("deadlock detected"), { code: "40P01" });
    await expect(runWebhookEvent({ inTenant: inTenant(w), client: failing(deadlock), sealer, consumeOnce: consumeOnce as unknown as ConsumeOnce }, payload)).rejects.toThrow("deadlock detected");
    expect(await q("SELECT count(*)::int AS n FROM public.processed_events WHERE tenant_id = $1 AND consumer = 'integration.webhook.event'", [w.tenantId])).toEqual([{ n: 0 }]);
    expect(await q("SELECT count(*)::int AS n FROM public.audit_logs WHERE tenant_id = $1 AND action = 'integration.webhook_received'", [w.tenantId])).toEqual([{ n: 0 }]);
    expect(await runner(w, { t: Date.now() })(payload)).toEqual({ kind: "applied", outcome: "CREATED" });
    // Kesin red (doğrulama): FAILED olarak bir kez işlenir.
    fake.contacts.push({ id: "952", attributes: { name: "Kesin Red", account_type: "customer" } });
    const q2 = memQueue();
    await receiveParasutWebhook({ db: app, sealer, queue: q2 as never }, delivery({ model: "contact", action: "create", id: "952", key: hookKey("contact", "create") }));
    const definite = Object.assign(new Error("invalid"), { code: "VALIDATION_FAILED" });
    expect(await runWebhookEvent({ inTenant: inTenant(w), client: failing(definite), sealer, consumeOnce: consumeOnce as unknown as ConsumeOnce }, q2.jobs[0]!.job.payload as never)).toEqual({ kind: "applied", outcome: "FAILED" });
  });

  it("P3: ikinci kayıt düşerse ilki kalıcı; yeniden deneme çoğaltmaz, sahipsiz kayıt bırakmaz; kesme hepsini siler", async () => {
    const { w, id } = await world("WHP3");
    fake.webhookFailAfter = 1;
    expect(await register(w, id)).toEqual({ kind: "failed", code: "PROVIDER_UNAVAILABLE" });
    expect(fake.webhooks).toHaveLength(1);
    const rows = async () => q<{ external_id: string; status: string }>("SELECT external_id, status FROM public.integration_webhooks WHERE integration_id = $1 ORDER BY external_id", [id]);
    expect((await rows()).map((r) => [r.external_id, r.status])).toEqual([[fake.webhooks[0]!.id, "ACTIVE"]]);
    fake.webhookFailAfter = null;
    expect(await register(w, id)).toEqual({ kind: "ok", created: 5, kept: 1 });
    expect(fake.webhooks).toHaveLength(6);
    expect((await rows()).map((r) => r.external_id).sort()).toEqual(fake.webhooks.map((x) => x.id).sort());
    await disconnectIntegration(admin(w), { provider: "PARASUT" }, { client: client(), sealer });
    expect(fake.webhooks).toHaveLength(0);
  });
});

describe("inceleme 764d808 (MINOR-A / MINOR-B)", () => {
  it("MINOR-A: beklenmeyen hata durumu FAILED INTERNAL yapar, kalıcı yazılmamış uzak kayıt silinir; sonraki tikte kayıt işi açılmaz", async () => {
    const { w, id } = await world("WHMA");
    let thrown = false;
    const flaky = { ...sealer, seal: (v: Readonly<Record<string, string>>, aad: never) => {
      if (!thrown && (aad as { jobType?: string }).jobType === "integration.webhook.key") { thrown = true; throw new TypeError("boom"); }
      return sealer.seal(v, aad);
    } } as typeof sealer;
    const r = await registerParasutWebhooks({ inTenant: inTenant(w), client: client(), sealer: flaky, callbackUrl: URI }, id);
    expect(r).toEqual({ kind: "failed", code: "INTERNAL", errorName: "TypeError" });
    expect((await q("SELECT webhook_status, webhook_last_error_code FROM public.integrations WHERE id = $1", [id]))[0]).toEqual({ webhook_status: "FAILED", webhook_last_error_code: "INTERNAL" });
    expect(fake.webhooks).toHaveLength(0);
    const queue = memQueue();
    await withSystemTenant(app, w.tenantId, "test.schedule", (tx) => enqueueScheduledIntegrations(tx as never, w.tenantId, queue as never));
    expect(queue.jobs.map((j) => j.job.type)).not.toContain("integration.webhook");
  });

  it("MINOR-B: döngü ortasında bağlantı kesilirse bu koşunun açtığı bütün uzak kayıtlar silinir (0 kalır)", async () => {
    const { w, id } = await world("WHMB");
    const c = client();
    const orig = c.createWebhook.bind(c);
    let n = 0;
    c.createWebhook = async (...a) => {
      const rec = await orig(...a);
      if (++n === 3) await q("UPDATE public.integrations SET status = 'DISCONNECTED', credentials = NULL WHERE id = $1", [id]);
      return rec;
    };
    expect(await registerParasutWebhooks({ inTenant: inTenant(w), client: c, sealer, callbackUrl: URI }, id)).toEqual({ kind: "skipped", reason: "NOT_CONNECTED" });
    expect(fake.webhooks).toHaveLength(0);
  });
});

describe("kademe ve kesme", () => {
  it("anlık bildirim açıkken kart 15 dk / depo 3 dk; kurulamamışken 30 sn; kayıt işi vadesinde", async () => {
    const { w, id } = await world("WHA");
    await q("UPDATE public.integration_flows SET enabled = true WHERE tenant_id = $1 AND flow = 'WAREHOUSES'", [w.tenantId]);
    await q("UPDATE public.integration_flows SET last_run_at = now() - interval '1 minute' WHERE tenant_id = $1", [w.tenantId]);
    const run = async () => {
      const queue = memQueue();
      await withSystemTenant(app, w.tenantId, "test.schedule", (tx) => enqueueScheduledIntegrations(tx as never, w.tenantId, queue as never));
      return queue.jobs.map((j) => j.job);
    };
    expect(await run()).toEqual([
      { type: "integration.sync", payload: { integrationId: id, trigger: "SCHEDULE", flows: expect.arrayContaining(["PRODUCTS", "CONTACTS", "WAREHOUSES"]) }, singletonKey: `integration.sync.${id}` },
      { type: "integration.webhook", payload: { integrationId: id, kind: "REGISTER" }, singletonKey: `integration.webhook.register.${id}` },
    ]);
    await register(w, id);
    expect(await run()).toEqual([]);
    await q("UPDATE public.integration_flows SET last_run_at = now() - interval '4 minutes' WHERE tenant_id = $1", [w.tenantId]);
    expect((await run())[0]?.payload).toEqual({ integrationId: id, trigger: "SCHEDULE", flows: ["WAREHOUSES"] });
    await q("UPDATE public.integration_flows SET last_run_at = now() - interval '16 minutes' WHERE tenant_id = $1", [w.tenantId]);
    expect(((await run())[0]?.payload as { flows: string[] }).flows.sort()).toEqual(["CONTACTS", "PRODUCTS", "WAREHOUSES"]);
  });

  it("kesince Paraşüt'teki kayıtlar silinir, anahtar NULL, durum OFF; eski anahtarla teslim reddedilir", async () => {
    const { w, id } = await world("WHB");
    await register(w, id);
    const key = hookKey("product", "update");
    expect(fake.webhooks).toHaveLength(6);
    expect(await disconnectIntegration(admin(w), { provider: "PARASUT" }, { client: client(), sealer })).toEqual({ changed: true });
    expect(fake.webhooks).toHaveLength(0);
    expect(await q("SELECT DISTINCT status, key_box FROM public.integration_webhooks WHERE integration_id = $1", [id])).toEqual([{ status: "DELETED", key_box: null }]);
    expect((await q("SELECT webhook_status FROM public.integrations WHERE id = $1", [id]))[0]).toEqual({ webhook_status: "OFF" });
    expect(await receiveParasutWebhook({ db: app, sealer, queue: memQueue() as never }, delivery({ model: "product", action: "update", id: "1", key }))).toEqual({ status: 401, outcome: "REJECTED" });
    expect((await q("SELECT webhook_status, webhook_checked_at FROM public.integrations WHERE id = $1", [id]))[0]).toEqual({ webhook_status: "OFF", webhook_checked_at: null });
    // Hemen yeniden bağlanınca (kayıt işini kuyruğa vermeyen eski yol) zamanlayıcı kaydı ilk tikte kurar — bir saat beklemez (CI e2e bulgusu).
    await connectParasut(admin(w), { companyId: fake.opts.companyId, clientId: fake.opts.clientId, clientSecret: fake.opts.clientSecret, username: fake.opts.username, password: fake.opts.password }, { client: client(), sealer });
    const queue = memQueue();
    await withSystemTenant(app, w.tenantId, "test.schedule", (tx) => enqueueScheduledIntegrations(tx as never, w.tenantId, queue as never));
    expect(queue.jobs.map((j) => j.job.type)).toContain("integration.webhook");
    expect(await register(w, id)).toEqual({ kind: "ok", created: 6, kept: 0 });
    expect((await getWebhookStatus(admin(w)))?.status).toBe("ACTIVE");
  });
});

describe("uç: /api/integrations/parasut/webhook", () => {
  it("413 büyük gövde, 401 sabit gövde, 200 geçerli teslim; yanıt sır/şirket taşımaz", async () => {
    vi.stubEnv("QUEUE_SEAL_KEY", sealKey);
    vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(32).toString("hex"));
    const { w, id } = await world("WHC");
    await register(w, id);
    const queue = memQueue();
    h.queue = queue;
    const { POST } = await import("../../../apps/web/app/api/integrations/parasut/webhook/route.ts");
    const post = (body: string, sig: string | null, extra: Record<string, string> = {}) =>
      POST(new Request("https://wms.example.test/api/integrations/parasut/webhook", { method: "POST", headers: { "content-type": "www-url-encoded", "fly-client-ip": "203.0.113.9", ...(sig === null ? {} : { signature: sig }), ...extra }, body }));
    const big = await post("x".repeat(200 * 1024), "a".repeat(64));
    expect(big.status).toBe(413);
    const bad = await post("company_id=115", "a".repeat(64));
    expect([bad.status, await bad.text(), bad.headers.get("cache-control")]).toEqual([401, "rejected", "no-store"]);
    const d = delivery({ model: "product", action: "update", id: "1", key: hookKey("product", "update") });
    const okRes = await post(d.body, d.signature);
    expect([okRes.status, await okRes.text()]).toEqual([200, "ok"]);
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0]!.tenant).toBe(w.tenantId);
    vi.unstubAllEnvs();
  });
});
