// T-1135 (0066): Paraşüt akış kilitleri — gerçek wms_app bağlantısı + sahte Paraşüt (gerçek ağ yok). Kanıtlar: (A) stok toplamı ⟂ irsaliye
// (domain + DB tetikleyicisi), (B) Devir kapısı ve toplamın kesin kümesi, (C) ondalık metin gövdeye sayı olarak, (D) irsaliye keşfi işlenme
// anına ve ilk açılışa göre (kapat/aç kaçırmaz), (E) stok kesin 4xx reddi sonsuz tekrar etmez, 401 işareti bozmaz, (F) kategorisi çözülemeyen
// ürün kategorisiz alınır, (G) koşu günlüğü bakımı (zaman aşımı, budama, silme bekçisi, boş zamanlı koşu satır bırakmaz), (H) vergi numarasız
// cari ad+şehirle eşlenir; başka karta bağlı dış kayıt bir kez FAILED olur.
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, withSystemTenant } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { createSealer } from "../../../packages/shared/src/seal.ts";
import { ParasutClient, connectParasut, getIntegrationOverview, runIntegrationSync, setIntegrationFlow, STOCK_TOTAL_LOCATION_KINDS, STOCK_TOTAL_STATUSES } from "../../../packages/domain/src/integrations/index.ts";
import { startFakeParasut, type FakeParasut } from "../fixtures/fake-parasut.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv, redactErrorChain } from "../harness/env.ts";

const env = readIntEnv(process.env);
const reg = newRegistry();
const sealer = createSealer(randomBytes(32).toString("hex"));

let app: DbClient;
let adm: pg.Client;
let appPg: pg.Client;
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
}, 120_000);

afterAll(async () => {
  if (fake !== undefined) await fake.close();
  await appPg.end();
  await adm.end();
  await app.close();
}, 120_000);

beforeEach(async () => {
  if (fake !== undefined) await fake.close();
  fake = await startFakeParasut();
});

const admin = (w: TenantWorld) => ({ db: app, principal: { userId: w.ownerUserId, mfaVerified: true }, tenantSlug: w.slug, recentAuth: async () => undefined });
const deps = () => ({ client: new ParasutClient({ baseUrl: fake.url, sleep: async () => undefined }), sealer });
const input = () => ({ companyId: fake.opts.companyId, clientId: fake.opts.clientId, clientSecret: fake.opts.clientSecret, username: fake.opts.username, password: fake.opts.password });
const sync = (w: TenantWorld, integrationId: string, opts: { flow?: string; trigger?: "MANUAL" | "SCHEDULE" } = {}) =>
  runIntegrationSync(
    { inTenant: (fn) => withSystemTenant(app, w.tenantId, "test.integration", fn), client: new ParasutClient({ baseUrl: fake.url, sleep: async () => undefined }), sealer },
    { integrationId, flow: opts.flow as never, trigger: opts.trigger ?? "MANUAL" },
    w.ownerUserId,
  );
const flow = (w: TenantWorld, f: string, enabled: boolean, direction = "PUSH") => setIntegrationFlow(admin(w), { provider: "PARASUT", flow: f, enabled, direction });
async function q<T extends pg.QueryResultRow = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await adm.query<T>(text, params)).rows;
}
async function connect(w: TenantWorld): Promise<string> {
  expect(await connectParasut(admin(w), input(), deps())).toEqual({ ok: true, label: fake.opts.companyName });
  return (await q<{ id: string }>("SELECT id FROM public.integrations WHERE tenant_id = $1 AND provider = 'PARASUT'", [w.tenantId]))[0]?.id as string;
}
async function asApp(tenant: string, sql: string, params: unknown[] = []): Promise<{ ok: true; rowCount: number } | { ok: false; code?: string; message?: string }> {
  await appPg.query("BEGIN");
  try {
    await appPg.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenant]);
    const r = await appPg.query(sql, params);
    return { ok: true, rowCount: r.rowCount ?? 0 };
  } catch (e) {
    return { ok: false, code: (e as { code?: string }).code, message: (e as Error).message };
  } finally {
    await appPg.query("ROLLBACK");
  }
}
/** STOCK_IN belgesi (doğrudan, migration rolüyle) + POSTED; `reason` açılış stoku ise Devir tamam sayılır. */
async function postedDoc(w: TenantWorld, kind: "STOCK_IN" | "STOCK_OUT", opts: { reason?: string; orderId?: string; number: string; post?: boolean }): Promise<string> {
  const doc = randomUUID();
  await adm.query(
    `INSERT INTO public.documents (tenant_id, id, kind, type_version_id, warehouse_id, business_date, created_by, source_kind, source_id, reason)
     SELECT $1, $2, $6::text, id, $3, '2026-10-30', $4, $7::text, $5::uuid, $8::text FROM public.document_type_versions WHERE tenant_id IS NULL AND key = $6::text AND version = 1`,
    [w.tenantId, doc, w.warehouseId, w.ownerUserId, opts.orderId ?? null, kind, opts.orderId === undefined ? null : "SALES_ORDER", opts.reason ?? null],
  );
  if (kind === "STOCK_OUT") {
    await adm.query("INSERT INTO public.document_lines (tenant_id, document_id, line_no, item_id, unit_id, quantity, conversion_factor, base_quantity, source_location_id) VALUES ($1, $2, 1, $3, $4, 3, 1, 3, $5)", [w.tenantId, doc, w.itemNoneId, w.unitId, w.rootLocationId]);
  }
  if (opts.post !== false) await post(w, doc, opts.number);
  return doc;
}
const post = (w: TenantWorld, doc: string, number: string) => adm.query("UPDATE public.documents SET status = 'POSTED', number = $3 WHERE tenant_id = $1 AND id = $2", [w.tenantId, doc, number]);
const devir = (w: TenantWorld) => postedDoc(w, "STOCK_IN", { reason: "import.opening_stock", number: `DVR-${randomBytes(3).toString("hex")}` });
const linkRefs = async (w: TenantWorld, rows: [string, string, string][]) => {
  for (const [type, entity, ext] of rows) await adm.query("INSERT INTO public.external_refs (tenant_id, system, entity_type, entity_id, external_id) VALUES ($1, 'PARASUT', $2, $3, $4)", [w.tenantId, type, entity, ext]);
};

describe("(A) stok toplamı ⟂ irsaliye", () => {
  it("domain: biri açıkken öteki açılamaz (sade neden), kapatma serbest; DB tetikleyicisi doğrudan yazımı da reddeder", async () => {
    const W = await seedWorld(adm, reg, "G1135A");
    const id = await connect(W);
    await devir(W);
    expect(await flow(W, "SHIPMENTS", true)).toMatchObject({ ok: true, enabled: true });
    expect(await flow(W, "STOCK", true)).toEqual({ ok: false, reason: "INTEGRATION_FLOW_EXCLUSIVE" });
    const direct = await asApp(W.tenantId, "UPDATE public.integration_flows SET enabled = true WHERE tenant_id = $1 AND integration_id = $2 AND flow = 'STOCK'", [W.tenantId, id]);
    expect(direct).toMatchObject({ ok: false, code: "23514" });
    expect((direct as { message?: string }).message).toMatch(/INTEGRATION_FLOW_EXCLUSIVE/);
    // Açık akışın yönü/koşu alanı güncellemesi tetikleyiciye takılmaz.
    expect(await asApp(W.tenantId, "UPDATE public.integration_flows SET last_error_code = NULL WHERE tenant_id = $1 AND integration_id = $2 AND flow = 'SHIPMENTS'", [W.tenantId, id])).toMatchObject({ ok: true, rowCount: 1 });
    expect(await flow(W, "SHIPMENTS", false)).toMatchObject({ ok: true, enabled: false });
    expect(await flow(W, "STOCK", true)).toMatchObject({ ok: true, enabled: true });
    expect(await flow(W, "SHIPMENTS", true)).toEqual({ ok: false, reason: "INTEGRATION_FLOW_EXCLUSIVE" });
    const flows = await q<{ flow: string; enabled: boolean }>("SELECT flow, enabled FROM public.integration_flows WHERE integration_id = $1 AND flow IN ('STOCK','SHIPMENTS') ORDER BY flow", [id]);
    expect(flows).toEqual([{ flow: "SHIPMENTS", enabled: false }, { flow: "STOCK", enabled: true }]);
    // Reddedilen deneme audit'e "değişti" diye yazılmaz.
    expect((await q("SELECT change_summary->>'flow' AS f, change_summary->>'enabled' AS e FROM public.audit_logs WHERE tenant_id = $1 AND action = 'integration.flow_changed' ORDER BY occurred_at", [W.tenantId]))).toEqual([
      { f: "SHIPMENTS", e: "true" }, { f: "SHIPMENTS", e: "false" }, { f: "STOCK", e: "true" },
    ]);
  });

  it("eşzamanlı iki açma: yalnız biri açılır", async () => {
    const W = await seedWorld(adm, reg, "G1135A2");
    await connect(W);
    await devir(W);
    const r = await Promise.allSettled([flow(W, "STOCK", true), flow(W, "SHIPMENTS", true)]);
    const ok = r.filter((x) => x.status === "fulfilled" && (x.value as { ok: boolean }).ok).length;
    expect(ok).toBe(1);
    expect((await q<{ n: number }>("SELECT count(*)::int AS n FROM public.integration_flows WHERE tenant_id = $1 AND flow IN ('STOCK','SHIPMENTS') AND enabled", [W.tenantId]))[0]?.n).toBe(1);
  });
});

describe("(B) Devir kapısı ve toplam kümesi", () => {
  it("Devir yokken STOCK açılamaz (domain + DB); Devir sonrası açılır", async () => {
    const W = await seedWorld(adm, reg, "G1135B");
    const id = await connect(W);
    expect(await flow(W, "STOCK", true)).toEqual({ ok: false, reason: "OPENING_STOCK_INCOMPLETE" });
    const direct = await asApp(W.tenantId, "UPDATE public.integration_flows SET enabled = true WHERE tenant_id = $1 AND integration_id = $2 AND flow = 'STOCK'", [W.tenantId, id]);
    expect(direct).toMatchObject({ ok: false, code: "23514" });
    expect((direct as { message?: string }).message).toMatch(/OPENING_STOCK_INCOMPLETE/);
    // İşlenmemiş ya da başka nedenli belge Devir sayılmaz.
    await postedDoc(W, "STOCK_IN", { reason: "import.opening_stock", number: "DVR-DRAFT", post: false });
    await postedDoc(W, "STOCK_IN", { reason: "baska", number: "DVR-OTHER" });
    expect(await flow(W, "STOCK", true)).toEqual({ ok: false, reason: "OPENING_STOCK_INCOMPLETE" });
    await devir(W);
    expect(await flow(W, "STOCK", true)).toMatchObject({ ok: true, enabled: true });
  });

  it("toplam yalnız AVAILABLE + RECEIVING/STORAGE; karantina/hasarlı/bloke ve yoldaki/sevk sahası hariç", async () => {
    expect([...STOCK_TOTAL_STATUSES]).toEqual(["AVAILABLE"]);
    expect([...STOCK_TOTAL_LOCATION_KINDS]).toEqual(["RECEIVING", "STORAGE"]);
    const W = await seedWorld(adm, reg, "G1135T");
    const id = await connect(W);
    await linkRefs(W, [["ITEM", W.itemNoneId, "555"], ["WAREHOUSE", W.warehouseId, "801"]]);
    // Fikstür: kök raf (STORAGE) 10 AVAILABLE. Ek: aynı rafta 5 QUARANTINE, 2 DAMAGED, 1 BLOCKED; TRANSIT ve STAGING raflarda 7 + 4 AVAILABLE.
    const transit = randomUUID();
    const staging = randomUUID();
    await adm.query("BEGIN");
    try {
      await adm.query("SELECT set_config('app.current_tenant_id', $1, true)", [W.tenantId]);
      await adm.query("INSERT INTO public.locations (tenant_id, id, warehouse_id, parent_id, code, name, depth, kind) VALUES ($1, $2, $4, NULL, 'YOL', 'Yolda', 0, 'TRANSIT'), ($1, $3, $4, NULL, 'SVK', 'Sevk', 0, 'STAGING')", [W.tenantId, transit, staging, W.warehouseId]);
      for (const [loc, status, qty] of [[W.rootLocationId, "QUARANTINE", 5], [W.rootLocationId, "DAMAGED", 2], [W.rootLocationId, "BLOCKED", 1], [transit, "AVAILABLE", 7], [staging, "AVAILABLE", 4]] as const) {
        const dim = randomUUID();
        await adm.query("INSERT INTO public.stock_dimensions (tenant_id, id, item_id, location_id, stock_status) VALUES ($1, $2, $3, $4, $5)", [W.tenantId, dim, W.itemNoneId, loc, status]);
        await adm.query("INSERT INTO public.stock_ledger (tenant_id, id, document_id, document_line_id, stock_dimension_id, quantity, reason, business_date, actor_user_id) VALUES ($1, $2, $3, $4, $5, $6, 'T1135 fikstur', '2026-10-30', $7)", [W.tenantId, randomUUID(), W.documentId, W.documentLineNoneId, dim, qty, W.ownerUserId]);
        await adm.query("INSERT INTO public.stock_balances (tenant_id, stock_dimension_id, quantity) VALUES ($1, $2, $3)", [W.tenantId, dim, qty]);
      }
      await adm.query("COMMIT");
    } catch (e) {
      await adm.query("ROLLBACK");
      throw e;
    }
    await devir(W);
    expect(await flow(W, "STOCK", true)).toMatchObject({ ok: true });
    const r = await sync(W, id);
    expect(r.kind === "ran" && r.flows[0]).toMatchObject({ flow: "STOCK", status: "SUCCESS" });
    expect(fake.stockUpdates).toHaveLength(1);
    const raw = fake.requests.find((x) => x.path === "/v4/115/stock_updates")?.body ?? "";
    // (C) toplam JSON sayısı (metin değil), kesin küme: yalnız 10.
    expect(raw).toContain('"new_total_inventory":10');
    expect(raw).not.toMatch(/"new_total_inventory":"/);
    expect(await q("SELECT quantity::text AS q FROM public.integration_stock_marks WHERE tenant_id = $1 AND integration_id = $2", [W.tenantId, id])).toEqual([{ q: "10.000000" }]);
  });
});

describe("(D) irsaliye keşfi: işlenme anı + ilk açılış (kapat/aç kaçırmaz)", () => {
  it("kapalıyken işlenen belge yeniden açılınca gider; açılıştan önce oluşturulup sonra işlenen gider; ilk açılıştan önce işlenen gitmez; stok toplamına girmiş belge gitmez", async () => {
    const W = await seedWorld(adm, reg, "G1135D");
    const id = await connect(W);
    const party = (await q<{ id: string }>("INSERT INTO public.parties (tenant_id, code, code_key, name, created_by) VALUES ($1, 'C-1135', 'C-1135', 'Sevk carisi', $2) RETURNING id", [W.tenantId, W.ownerMembershipId]))[0]?.id as string;
    await linkRefs(W, [["PARTY", party, "777"], ["ITEM", W.itemNoneId, "555"], ["WAREHOUSE", W.warehouseId, "801"]]);
    const order = async (n: string) => (await q<{ id: string }>("INSERT INTO public.sales_orders (tenant_id, number, customer_ref, created_by) VALUES ($1, $2, 'c-1135', $3) RETURNING id", [W.tenantId, `SIP-${n}`, W.ownerUserId]))[0]?.id as string;
    const shipped = () => fake.shipments.map((s) => (s.body as { data: { attributes: { procurement_number: string } } }).data.attributes.procurement_number).sort();

    const before = await postedDoc(W, "STOCK_OUT", { orderId: await order("0"), number: "SVK-ONCE" });
    const draftEarly = await postedDoc(W, "STOCK_OUT", { orderId: await order("1"), number: "x", post: false });
    expect(before).toBeTruthy();
    expect(await flow(W, "SHIPMENTS", true)).toMatchObject({ ok: true });
    const first = (await q<{ f: Date }>("SELECT first_enabled_at AS f FROM public.integration_flows WHERE integration_id = $1 AND flow = 'SHIPMENTS'", [id]))[0]?.f;
    await post(W, draftEarly, "SVK-SONRA");
    await sync(W, id);
    expect(shipped()).toEqual(["SVK-SONRA"]);
    // Kapat → bu arada işlenen belge → aç: ilk açılış anı korunur, belge gider.
    expect(await flow(W, "SHIPMENTS", false)).toMatchObject({ ok: true });
    await postedDoc(W, "STOCK_OUT", { orderId: await order("2"), number: "SVK-KAPALI" });
    expect(await flow(W, "SHIPMENTS", true)).toMatchObject({ ok: true });
    expect((await q<{ f: Date }>("SELECT first_enabled_at AS f FROM public.integration_flows WHERE integration_id = $1 AND flow = 'SHIPMENTS'", [id]))[0]?.f).toEqual(first);
    await sync(W, id);
    expect(shipped()).toEqual(["SVK-KAPALI", "SVK-SONRA"]);
    // (C) miktar JSON sayısı.
    expect(fake.requests.filter((x) => x.path === "/v4/115/shipment_documents").every((x) => x.body.includes('"quantity":3'))).toBe(true);
    // Stok moduna geçiş: o sırada işlenen belge stok toplamına girer; irsaliyeye dönünce ikinci kez düşülmez.
    expect(await flow(W, "SHIPMENTS", false)).toMatchObject({ ok: true });
    await devir(W);
    expect(await flow(W, "STOCK", true)).toMatchObject({ ok: true });
    await postedDoc(W, "STOCK_OUT", { orderId: await order("3"), number: "SVK-STOKTA" });
    await sync(W, id);
    expect(fake.stockUpdates.length).toBeGreaterThan(0);
    expect(await flow(W, "STOCK", false)).toMatchObject({ ok: true });
    expect(await flow(W, "SHIPMENTS", true)).toMatchObject({ ok: true });
    await sync(W, id);
    expect(shipped()).toEqual(["SVK-KAPALI", "SVK-SONRA"]);
    await postedDoc(W, "STOCK_OUT", { orderId: await order("4"), number: "SVK-YENI" });
    await sync(W, id);
    expect(shipped()).toEqual(["SVK-KAPALI", "SVK-SONRA", "SVK-YENI"]);
  });
});

describe("(E) stok gönderiminde kesin red", () => {
  it("422: işaret FAILED, aynı toplam 30 sn'de bir yeniden gönderilmez; 401 işareti bozmaz ve koşu FAILED", async () => {
    const W = await seedWorld(adm, reg, "G1135E");
    const id = await connect(W);
    await linkRefs(W, [["ITEM", W.itemNoneId, "555"], ["WAREHOUSE", W.warehouseId, "801"]]);
    await devir(W);
    await flow(W, "STOCK", true);
    fake.stockFailure = 422;
    const r1 = await sync(W, id);
    expect(r1.kind === "ran" && r1.flows[0]).toMatchObject({ status: "PARTIAL", counts: { failed: 1, updated: 0 } });
    expect(await q("SELECT quantity, failed_quantity::text AS f, last_error_code AS c, failed_at IS NOT NULL AS at FROM public.integration_stock_marks WHERE integration_id = $1", [id])).toEqual([{ quantity: null, f: "10.000000", c: "PROVIDER_INVALID", at: true }]);
    const posts = () => fake.requests.filter((x) => x.path === "/v4/115/stock_updates").length;
    const n = posts();
    fake.stockFailure = null;
    const r2 = await sync(W, id);
    expect(r2.kind === "ran" && r2.flows[0]).toMatchObject({ status: "SUCCESS", counts: { failed: 0, updated: 0 } });
    expect(posts()).toBe(n);
    // 401: oturum düşer, koşu FAILED; işaret değişmez (yeniden denenir, kalıcı red sayılmaz).
    const W2 = await seedWorld(adm, reg, "G1135E2");
    const id2 = await connect(W2);
    await linkRefs(W2, [["ITEM", W2.itemNoneId, "556"], ["WAREHOUSE", W2.warehouseId, "802"]]);
    await devir(W2);
    await flow(W2, "STOCK", true);
    fake.stockFailure = 401;
    const r3 = await sync(W2, id2);
    expect(r3.kind === "ran" && r3.flows[0]).toMatchObject({ status: "FAILED", errorCode: "PROVIDER_AUTH_FAILED" });
    expect(await q("SELECT 1 FROM public.integration_stock_marks WHERE integration_id = $1", [id2])).toEqual([]);
    fake.stockFailure = null;
    const r4 = await sync(W2, id2);
    expect(r4.kind === "ran" && r4.flows[0]).toMatchObject({ status: "SUCCESS", counts: { updated: 1 } });
  });
});

describe("(F) kategori", () => {
  it("kategorisi çözülemeyen ürün kategorisiz alınır, satır düşmez; uyarı audit özetinde", async () => {
    const W = await seedWorld(adm, reg, "G1135F");
    const id = await connect(W);
    await flow(W, "PRODUCTS", true, "PULL");
    fake.products.push({ id: "971", attributes: { code: "CAT-MISSING", name: "Kategorisi yok", unit: "Adet" }, relationships: { category: { data: { id: "99", type: "item_categories" } } } });
    const r = await sync(W, id);
    expect(r.kind === "ran" && r.flows[0]).toMatchObject({ status: "SUCCESS", counts: { created: 1, failed: 0, warnings: 1 } });
    expect(await q("SELECT source_product_info->'PARASUT' AS info FROM public.items WHERE tenant_id = $1 AND code = 'CAT-MISSING'", [W.tenantId])).toEqual([{ info: { unit: "Adet", categoryId: null, categoryName: null } }]);
    expect((await q<{ w: string }>("SELECT change_summary->>'warnings' AS w FROM public.audit_logs WHERE tenant_id = $1 AND action = 'integration.synced'", [W.tenantId]))).toEqual([{ w: "1" }]);
  });
});

describe("(G) koşu günlüğü bakımı", () => {
  it("40 dk'yı aşan RUNNING → FAILED/TIMEOUT; 7 günden eski biten satır budanır, yakın geçmiş korunur; boş zamanlı koşu satır bırakmaz", async () => {
    const W = await seedWorld(adm, reg, "G1135G");
    const id = await connect(W);
    await flow(W, "WAREHOUSES", true, "PULL");
    const stale = randomUUID();
    const old = randomUUID();
    const recent = randomUUID();
    await adm.query("INSERT INTO public.integration_runs (tenant_id, id, integration_id, flow, trigger, status, started_at) VALUES ($1, $2, $5, 'WAREHOUSES', 'SCHEDULE', 'RUNNING', now() - interval '50 minutes'), ($1, $3, $5, 'WAREHOUSES', 'SCHEDULE', 'SUCCESS', now() - interval '8 days'), ($1, $4, $5, 'WAREHOUSES', 'SCHEDULE', 'SUCCESS', now() - interval '2 days')", [W.tenantId, stale, old, recent, id]);
    // wms_app yakın geçmişi silemez; başka kiracı hiç göremez.
    expect(await asApp(W.tenantId, "DELETE FROM public.integration_runs WHERE tenant_id = $1 AND id = $2", [W.tenantId, recent])).toMatchObject({ ok: false, code: "55000" });
    const B = await seedWorld(adm, reg, "G1135GB");
    expect(await asApp(B.tenantId, "DELETE FROM public.integration_runs WHERE id = $1", [old])).toMatchObject({ ok: true, rowCount: 0 });
    const before = (await q<{ n: number }>("SELECT count(*)::int AS n FROM public.integration_runs WHERE integration_id = $1", [id]))[0]?.n as number;
    const r = await sync(W, id, { trigger: "SCHEDULE" });
    expect(r.kind === "ran" && r.flows[0]).toMatchObject({ status: "SUCCESS", counts: { created: 0, updated: 0 } });
    expect(await q("SELECT id, status, error_code FROM public.integration_runs WHERE integration_id = $1 ORDER BY started_at", [id])).toEqual([
      { id: recent, status: "SUCCESS", error_code: null },
      { id: stale, status: "FAILED", error_code: "TIMEOUT" },
    ]);
    expect(before).toBe(3);
    // Değişiklik getiren koşu satır bırakır; son kontrol anı akışta.
    fake.warehouses.push({ id: "881", attributes: { name: "Yeni Depo" } });
    await sync(W, id, { trigger: "SCHEDULE" });
    expect((await q<{ n: number }>("SELECT count(*)::int AS n FROM public.integration_runs WHERE integration_id = $1 AND status = 'SUCCESS'", [id]))[0]?.n).toBe(2);
    expect((await q<{ ok: boolean }>("SELECT last_run_at > now() - interval '1 minute' AS ok FROM public.integration_flows WHERE integration_id = $1 AND flow = 'WAREHOUSES'", [id]))[0]?.ok).toBe(true);
  });
});

describe("(H) cari eşleme", () => {
  it("vergi numarasız cari normalleştirilmiş ad + şehirle tek adaya bağlanır; birden çok aday atlanır; farklı şehir yeni kayıt", async () => {
    const W = await seedWorld(adm, reg, "G1135H");
    const id = await connect(W);
    const mk = async (code: string, name: string, city: string | null) =>
      (await q<{ id: string }>("INSERT INTO public.parties (tenant_id, code, code_key, name, city, created_by) VALUES ($1, $2, $2, $3, $4, $5) RETURNING id", [W.tenantId, code, name, city, W.ownerMembershipId]))[0]?.id as string;
    const acme = await mk("C-ACME", "Acme Ltd", "İzmir");
    await mk("C-DUP1", "Çift Ad", "Bursa");
    await mk("C-DUP2", "Çift  Ad", "bursa");
    fake.contacts.push({ id: "741", attributes: { name: "  ACME   ltd ", account_type: "customer", city: "İzmir" } });
    fake.contacts.push({ id: "742", attributes: { name: "Çift Ad", account_type: "customer", city: "Bursa" } });
    fake.contacts.push({ id: "743", attributes: { name: "Acme Ltd", account_type: "customer", city: "Ankara" } });
    await flow(W, "CONTACTS", true, "PULL");
    const r = await sync(W, id);
    expect(r.kind === "ran" && r.flows[0]).toMatchObject({ counts: { linked: 1, created: 1, skipped: 1, failed: 0 } });
    expect(await q("SELECT entity_id FROM public.external_refs WHERE tenant_id = $1 AND system = 'PARASUT' AND entity_type = 'PARTY' AND external_id = '741'", [W.tenantId])).toEqual([{ entity_id: acme }]);
    expect(await q("SELECT 1 FROM public.external_refs WHERE tenant_id = $1 AND system = 'PARASUT' AND external_id = '742'", [W.tenantId])).toEqual([]);
    expect((await q<{ n: number }>("SELECT count(*)::int AS n FROM public.parties WHERE tenant_id = $1 AND lower(name) LIKE '%acme%'", [W.tenantId]))[0]?.n).toBe(2);
  });

  it("BOTH: dış karşılığı başka karta bağlı cari bir kez FAILED olur; sonraki koşular yeniden aramaz ve 'atlandı' saymaz; irsaliye bandı etkilenmez", async () => {
    const W = await seedWorld(adm, reg, "G1135HB");
    const id = await connect(W);
    const y = (await q<{ id: string }>("INSERT INTO public.parties (tenant_id, code, code_key, name, created_by) VALUES ($1, 'C-Y', 'C-Y', 'Ortak Ad', $2) RETURNING id", [W.tenantId, W.ownerMembershipId]))[0]?.id as string;
    const x = (await q<{ id: string }>("INSERT INTO public.parties (tenant_id, code, code_key, name, tax_no, created_by) VALUES ($1, 'C-X', 'C-X', 'Ortak Ad', NULL, $2) RETURNING id", [W.tenantId, W.ownerMembershipId]))[0]?.id as string;
    fake.contacts.push({ id: "751", attributes: { name: "Ortak Ad", account_type: "customer" } });
    await linkRefs(W, [["PARTY", y, "751"]]);
    // Bütün Etkin carileri: fikstürde başka cari yoksa yalnız x eşlemesiz kalır.
    await flow(W, "CONTACTS", true, "BOTH");
    const r1 = await sync(W, id, { flow: "CONTACTS" });
    expect(r1.kind === "ran" && r1.flows[0]?.counts).toMatchObject({ failed: 1, skipped: 0 });
    expect(await q("SELECT entity_type, status, last_error_code FROM public.integration_outbox WHERE tenant_id = $1 AND entity_id = $2", [W.tenantId, x])).toEqual([{ entity_type: "PARTY", status: "FAILED", last_error_code: "EXTERNAL_ALREADY_LINKED" }]);
    const searches = () => fake.requests.filter((q2) => q2.path.includes("/contacts?filter")).length;
    const n = searches();
    const r2 = await sync(W, id, { flow: "CONTACTS" });
    expect(r2.kind === "ran" && r2.flows[0]?.counts).toMatchObject({ failed: 0, skipped: 0 });
    expect(searches()).toBe(n);
    expect((await getIntegrationOverview(admin(W))).outbox).toEqual({ pending: 0, check: 0, failed: 0 });
  });
});
