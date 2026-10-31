// T-1006 (0056): ERP'den BİR KEZLİK açılış stoku — gerçek wms_app bağlantısı + sahte Paraşüt sunucusu (gerçek ağ yok). Kullanıcı kararı 22 Ekim
// (parametrik): ayar varsayılan KAPALI; kapalıyken çekmez; açıkken BİR KEZ çeker (domain stok komutu, STOCK_IN belgesi, I-15 kilitleri);
// tekrar istek, eşzamanlı ikinci istek ve alındıktan sonra ayar değişimi reddedilir; DB kilidi (tetikleyici + tekil indeks) uygulama dışından
// da geri alınamaz; başka kiracının ayarı/kilidi etkilenmez; yalnız hesap sahibi. Stok yalnız eşlemesi olan, izlemesiz, stoğu olmayan ürüne yazılır.
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, withSystemTenant } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { AppError } from "../../../packages/shared/src/errors.ts";
import { createSealer } from "../../../packages/shared/src/seal.ts";
import {
  ParasutClient,
  getOpeningStockState,
  pullOpeningStock,
  runIntegrationSync,
  setIntegrationFlow,
  setOpeningStockSetting,
} from "../../../packages/domain/src/integrations/index.ts";
import { getSetupJourney } from "../../../packages/domain/src/onboarding/journey.ts";
import { approveDocument, createStockDocument } from "../../../packages/domain/src/stock/index.ts";
import { startFakeParasut, type FakeParasut } from "../fixtures/fake-parasut.ts";
import { connectParasutOAuth } from "../fixtures/parasut-oauth.ts";
import { mkMembership, mkUser, newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
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
  // Paraşüt ürünleri: 3 stoklu (biri kesirli), 1 stoksuz, 1 izlemesiz; ADET birimi (fikstürde var).
  fake.products.push({ id: "601", attributes: { code: "OPN-1", name: "Conta", unit: "Adet", stock_count: 40, inventory_tracking: true } });
  fake.products.push({ id: "602", attributes: { code: "OPN-2", name: "Hortum", unit: "Adet", stock_count: "15.0", inventory_tracking: true } });
  fake.products.push({ id: "603", attributes: { code: "OPN-3", name: "Kesirli", unit: "Adet", stock_count: 2.5, inventory_tracking: true } });
  fake.products.push({ id: "604", attributes: { code: "OPN-4", name: "Stoksuz", unit: "Adet", stock_count: 0, inventory_tracking: true } });
  fake.products.push({ id: "605", attributes: { code: "OPN-5", name: "Hizmet", unit: "Adet", stock_count: 9, inventory_tracking: false } });
});

const admin = (w: TenantWorld) => ({ db: app, principal: { userId: w.ownerUserId, mfaVerified: true }, tenantSlug: w.slug, recentAuth: async () => undefined });
const as = (userId: string, w: TenantWorld) => ({ db: app, principal: { userId, mfaVerified: true }, tenantSlug: w.slug });
const deps = () => ({ client: new ParasutClient({ baseUrl: fake.url, sleep: async () => undefined }), sealer });
async function q<T extends pg.QueryResultRow = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await adm.query<T>(text, params)).rows;
}
async function fail(p: Promise<unknown>): Promise<AppError> {
  const e = await p.then(() => undefined, (x: unknown) => x);
  expect(e).toBeInstanceOf(AppError);
  return e as AppError;
}
async function asApp(tenant: string, sql: string, params: unknown[] = []): Promise<{ ok: true; rowCount: number } | { ok: false; code?: string }> {
  await appPg.query("BEGIN");
  try {
    await appPg.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenant]);
    const r = await appPg.query(sql, params);
    return { ok: true, rowCount: r.rowCount ?? 0 };
  } catch (e) {
    return { ok: false, code: (e as { code?: string }).code };
  } finally {
    await appPg.query("ROLLBACK");
  }
}

/** Bağlı + ürün kartları çekilmiş kiracı (eşlemeler hazır, stok yok). */
async function ready(label: string): Promise<{ w: TenantWorld; id: string }> {
  const w = await seedWorld(adm, reg, label);
  expect(await connectParasutOAuth(admin(w), deps(), fake, { productsOff: true })).toEqual({ ok: true, label: fake.opts.companyName });
  const id = (await q<{ id: string }>("SELECT id FROM public.integrations WHERE tenant_id = $1 AND provider = 'PARASUT'", [w.tenantId]))[0]?.id as string;
  await setIntegrationFlow(admin(w), { provider: "PARASUT", flow: "PRODUCTS", enabled: true, direction: "PULL" });
  const r = await runIntegrationSync({ inTenant: (fn) => withSystemTenant(app, w.tenantId, "test.integration", fn), client: new ParasutClient({ baseUrl: fake.url, sleep: async () => undefined }), sealer }, { integrationId: id, flow: "PRODUCTS", trigger: "MANUAL" }, w.ownerUserId);
  expect(r.kind).toBe("ran");
  return { w, id };
}
const ledgerOf = (w: TenantWorld) =>
  q<{ code: string; qty: string }>(
    "SELECT i.code, sum(l.quantity)::text AS qty FROM public.stock_ledger l JOIN public.items i ON i.tenant_id = l.tenant_id AND i.id = l.item_id WHERE l.tenant_id = $1 AND i.code LIKE 'OPN-%' GROUP BY i.code ORDER BY i.code",
    [w.tenantId],
  );
const pull = (w: TenantWorld, loc = w.childLocationId) => pullOpeningStock(admin(w), { provider: "PARASUT", locationId: loc }, deps());

describe("ayar varsayılan kapalı", () => {
  it("kapalıyken çekmez: DISABLED, hiçbir stok yazılmaz, Paraşüt'e ürün isteği gitmez", async () => {
    const { w } = await ready("OPN0");
    expect(await getOpeningStockState(admin(w), { provider: "PARASUT" })).toMatchObject({ enabled: false, takenAt: null });
    const before = fake.requests.length;
    expect(await pull(w)).toEqual({ ok: false, reason: "DISABLED" });
    expect(fake.requests.length).toBe(before);
    expect(await ledgerOf(w)).toEqual([]);
  });
});

describe("açıkken BİR KEZ", () => {
  it("açıkken bir kez çeker: tek STOCK_IN belgesi, yalnız uygun satırlar, kilit + audit; yolculuk adımı 3 tamam", async () => {
    const { w, id } = await ready("OPN1");
    expect(await setOpeningStockSetting(admin(w), { provider: "PARASUT", enabled: true })).toEqual({ ok: true, enabled: true, changed: true });
    const r = await pull(w);
    if (!r.ok) throw new Error(`açılış stoku alınamadı: ${r.reason}`);
    expect(r.lines).toBe(2);
    expect(r.skipped).toEqual({ unlinked: 0, hasStock: 0, unsupported: 0, invalid: 2 }); // 2.5 (ölçek 0) + izlemesiz
    expect(await ledgerOf(w)).toEqual([
      { code: "OPN-1", qty: "40.000000" },
      { code: "OPN-2", qty: "15.000000" },
    ]);
    const doc = await q<{ kind: string; status: string; reason: string; n: number }>(
      "SELECT d.kind, d.status, d.reason, (SELECT count(*)::int FROM public.document_lines x WHERE x.tenant_id = d.tenant_id AND x.document_id = d.id) AS n FROM public.documents d WHERE d.tenant_id = $1 AND d.id = $2",
      [w.tenantId, r.documentId],
    );
    expect(doc).toEqual([{ kind: "STOCK_IN", status: "POSTED", reason: "integration.opening_stock", n: 2 }]);
    const lock = await q<{ taken: boolean; doc: string }>("SELECT opening_stock_taken_at IS NOT NULL AS taken, opening_stock_document_id::text AS doc FROM public.integrations WHERE tenant_id = $1 AND id = $2", [w.tenantId, id]);
    expect(lock).toEqual([{ taken: true, doc: r.documentId }]);
    const audit = await q<{ lines: string }>("SELECT change_summary->>'lines' AS lines FROM public.audit_logs WHERE tenant_id = $1 AND action = 'integration.opening_stock_taken'", [w.tenantId]);
    expect(audit).toEqual([{ lines: "2" }]);
    const idem = await q<{ n: number }>("SELECT count(*)::int AS n FROM public.idempotency_records WHERE tenant_id = $1 AND command_type = 'integration.opening_stock'", [w.tenantId]);
    expect(idem[0]?.n).toBe(1);
    expect((await getOpeningStockState(admin(w), { provider: "PARASUT" }))?.takenAt).toBeInstanceOf(Date);
    const j = await getSetupJourney(admin(w));
    expect(j.hints.parasut).toMatchObject({ connected: true, openingEnabled: true });
    expect(j.hints.parasut.openingTakenAt).toBeInstanceOf(Date);
  });

  it("tekrar istekte reddeder: ALREADY_TAKEN, stok değişmez; ayar artık değiştirilemez; DB kilidi uygulama rolüyle geri alınamaz", async () => {
    const { w, id } = await ready("OPN2");
    await setOpeningStockSetting(admin(w), { provider: "PARASUT", enabled: true });
    expect((await pull(w)).ok).toBe(true);
    const after = await ledgerOf(w);
    expect(await pull(w)).toEqual({ ok: false, reason: "ALREADY_TAKEN" });
    expect(await ledgerOf(w)).toEqual(after);
    expect(await setOpeningStockSetting(admin(w), { provider: "PARASUT", enabled: false })).toEqual({ ok: false, reason: "ALREADY_TAKEN" });
    // Kilit DB'de: alınmış kayıt silinemez / değiştirilemez (tetikleyici 55000).
    expect(await asApp(w.tenantId, "UPDATE public.integrations SET opening_stock_taken_at = NULL, opening_stock_document_id = NULL WHERE id = $1", [id])).toEqual({ ok: false, code: "55000" });
    expect(await asApp(w.tenantId, "UPDATE public.integrations SET opening_stock_taken_at = now() - interval '1 day' WHERE id = $1", [id])).toEqual({ ok: false, code: "55000" });
  });

  it("eşzamanlı iki istek: yalnız biri yazar, diğeri ALREADY_TAKEN; defter iki kez yazılmaz", async () => {
    const { w } = await ready("OPN3");
    await setOpeningStockSetting(admin(w), { provider: "PARASUT", enabled: true });
    const [a, b] = await Promise.all([pull(w), pull(w)]);
    const oks = [a, b].filter((x) => x.ok);
    expect(oks).toHaveLength(1);
    expect([a, b].find((x) => !x.ok)).toMatchObject({ ok: false, reason: "ALREADY_TAKEN" });
    expect(await ledgerOf(w)).toEqual([
      { code: "OPN-1", qty: "40.000000" },
      { code: "OPN-2", qty: "15.000000" },
    ]);
  });

  it("ayar sonradan açılırsa (hiç alınmadıysa) bir kez yapılabilir; DB: ayar kapalıyken kilit yazılamaz", async () => {
    const { w, id } = await ready("OPN4");
    expect(await pull(w)).toEqual({ ok: false, reason: "DISABLED" });
    expect(await asApp(w.tenantId, "UPDATE public.integrations SET opening_stock_taken_at = now(), opening_stock_document_id = $2 WHERE id = $1", [id, w.documentId])).toEqual({ ok: false, code: "55000" });
    expect(await setOpeningStockSetting(admin(w), { provider: "PARASUT", enabled: true })).toMatchObject({ ok: true, enabled: true });
    expect(await setOpeningStockSetting(admin(w), { provider: "PARASUT", enabled: false })).toMatchObject({ ok: true, enabled: false });
    expect(await setOpeningStockSetting(admin(w), { provider: "PARASUT", enabled: true })).toMatchObject({ ok: true, enabled: true });
    expect((await pull(w)).ok).toBe(true);
  });

  it("stoğu olan ürüne yazmaz (iki kez sayılmaz); eşlemesi olmayan ve hatalı raf reddedilir", async () => {
    const { w } = await ready("OPN5");
    await setOpeningStockSetting(admin(w), { provider: "PARASUT", enabled: true });
    fake.products.push({ id: "699", attributes: { code: "YOK", name: "Eşlemesiz", unit: "Adet", stock_count: 3 } }); // senkrondan sonra eklendi
    expect(await pull(w, "00000000-0000-4000-8000-000000000000")).toEqual({ ok: false, reason: "LOCATION_INVALID" });
    const r = await pull(w);
    expect(r).toMatchObject({ ok: true, lines: 2, skipped: { unlinked: 1 } });
  });
});

describe("savunma katmanları (güvenlik incelemesi MINOR-1/2/4)", () => {
  it("Paraşüt aynı ürünü iki kez dönerse bütün çekme reddedilir (BAD_RESPONSE); stok yazılmaz, kilit boş kalır", async () => {
    const { w, id } = await ready("OPND");
    await setOpeningStockSetting(admin(w), { provider: "PARASUT", enabled: true });
    fake.products.push({ ...(fake.products[0] as { id: string; attributes: Record<string, unknown> }) });
    expect(await pull(w)).toEqual({ ok: false, reason: "BAD_RESPONSE" });
    expect(await ledgerOf(w)).toEqual([]);
    expect(await q("SELECT opening_stock_taken_at FROM public.integrations WHERE tenant_id = $1 AND id = $2", [w.tenantId, id])).toEqual([{ opening_stock_taken_at: null }]);
  });

  it("deneme (demo) alanında ayar ve çekme DEMO", async () => {
    const { w } = await ready("OPNM");
    await setOpeningStockSetting(admin(w), { provider: "PARASUT", enabled: true });
    await adm.query("UPDATE public.tenants SET is_demo = true WHERE id = $1", [w.tenantId]);
    expect(await setOpeningStockSetting(admin(w), { provider: "PARASUT", enabled: false })).toEqual({ ok: false, reason: "DEMO" });
    expect(await pull(w)).toEqual({ ok: false, reason: "DEMO" });
    expect(await ledgerOf(w)).toEqual([]);
  });

  it("ayar kaynağı audit'e yazılır (yolculuk cevabı: via=journey)", async () => {
    const { w } = await ready("OPNV");
    await setOpeningStockSetting(admin(w), { provider: "PARASUT", enabled: true, via: "journey" });
    expect(await q("SELECT change_summary->>'via' AS via, change_summary->>'enabled' AS en FROM public.audit_logs WHERE tenant_id = $1 AND action = 'integration.opening_stock_setting'", [w.tenantId])).toEqual([{ via: "journey", en: "true" }]);
  });

  it("DB: açılış alanları INSERT ile yazılamaz (42501); kilit işlenmemiş (APPROVED) belgeyle commit'te reddedilir; tenant başına ikinci açılış tekil indeksle reddedilir", async () => {
    const { w, id } = await ready("OPNX");
    expect(await asApp(w.tenantId, "INSERT INTO public.integrations (tenant_id, provider, status, opening_stock_enabled) VALUES ($1, 'LOGO', 'DISCONNECTED', true)", [w.tenantId])).toEqual({ ok: false, code: "42501" });
    // Onaylı ama işlenmemiş STOCK_IN: BEFORE tetikleyicisi geçer, ertelenmiş kısıt commit'te reddeder.
    const unit = (await q<{ u: string }>("SELECT base_unit_id AS u FROM public.items WHERE tenant_id = $1 AND id = $2", [w.tenantId, w.itemNoneId]))[0]?.u as string;
    const cmd = () => ({ ...admin(w), clientKey: randomUUID(), retry: { sleep: async () => undefined } });
    const draft = await createStockDocument(cmd(), { kind: "STOCK_IN", warehouseId: w.warehouseId, reason: "T1006 onaylı", lines: [{ itemId: w.itemNoneId, unitId: unit, quantity: "1", baseQuantity: "1", conversionFactor: "1", targetLocationId: w.rootLocationId }] });
    const approved = draft.documentId as string;
    await approveDocument(cmd(), { documentId: approved, expectedVersion: 1 });
    expect(await q("SELECT status FROM public.documents WHERE tenant_id = $1 AND id = $2", [w.tenantId, approved])).toEqual([{ status: "APPROVED" }]);
    const c = new pg.Client({ connectionString: env.databaseUrl });
    c.on("error", () => undefined);
    await c.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [w.tenantId]);
      await c.query("UPDATE public.integrations SET opening_stock_enabled = true WHERE id = $1", [id]);
      await c.query("UPDATE public.integrations SET opening_stock_taken_at = now(), opening_stock_document_id = $2 WHERE id = $1", [id, approved]);
      const commit = await c.query("COMMIT").then(() => null, (e: { code?: string }) => e.code);
      expect(commit).toBe("55000");
    } finally {
      await c.end();
    }
    expect(await q("SELECT opening_stock_taken_at FROM public.integrations WHERE tenant_id = $1 AND id = $2", [w.tenantId, id])).toEqual([{ opening_stock_taken_at: null }]);
    // Tekil indeks: Paraşüt'te alındıktan sonra ikinci sağlayıcı satırında açılış yazılamaz (23505).
    await setOpeningStockSetting(admin(w), { provider: "PARASUT", enabled: true });
    const done = await pull(w);
    if (!done.ok) throw new Error(`açılış stoku alınamadı: ${done.reason}`);
    await adm.query("BEGIN");
    await adm.query("SELECT set_config('app.current_tenant_id', $1, true)", [w.tenantId]);
    const logo = (await adm.query<{ id: string }>("INSERT INTO public.integrations (tenant_id, provider, status) VALUES ($1, 'LOGO', 'DISCONNECTED') RETURNING id", [w.tenantId])).rows[0]?.id;
    await adm.query("COMMIT");
    const c2 = new pg.Client({ connectionString: env.databaseUrl });
    c2.on("error", () => undefined);
    await c2.connect();
    try {
      await c2.query("BEGIN");
      await c2.query("SELECT set_config('app.current_tenant_id', $1, true)", [w.tenantId]);
      await c2.query("UPDATE public.integrations SET opening_stock_enabled = true WHERE id = $1", [logo]);
      const second = await c2.query("UPDATE public.integrations SET opening_stock_taken_at = now(), opening_stock_document_id = $2 WHERE id = $1", [logo, done.documentId]).then(() => null, (e: { code?: string; constraint?: string }) => `${e.code}:${e.constraint}`);
      expect(second).toBe("23505:integrations_opening_stock_once");
      await c2.query("ROLLBACK");
    } finally {
      await c2.end();
    }
  });
});

describe("kiracı yalıtımı ve yetki", () => {
  it("başka kiracı ayarı etkilemez: A açık + alındı, B kapalı kalır ve çekemez; B, A'nın satırını göremez/değiştiremez", async () => {
    // Sahte sunucu tek hesaptır (yeni bağlantı önceki belirteci döndürür): A önce tamamlanır, sonra B bağlanır.
    const A = await ready("OPNA");
    await setOpeningStockSetting(admin(A.w), { provider: "PARASUT", enabled: true });
    expect((await pull(A.w)).ok).toBe(true);
    const B = await ready("OPNB");
    expect(await getOpeningStockState(admin(B.w), { provider: "PARASUT" })).toMatchObject({ enabled: false, takenAt: null });
    expect(await pull(B.w)).toEqual({ ok: false, reason: "DISABLED" });
    expect(await asApp(B.w.tenantId, "UPDATE public.integrations SET opening_stock_enabled = false WHERE id = $1", [A.id])).toEqual({ ok: true, rowCount: 0 });
    // A'nın rafını B'nin isteğine vermek işe yaramaz (raf B'de yok).
    await setOpeningStockSetting(admin(B.w), { provider: "PARASUT", enabled: true });
    expect(await pull(B.w, A.w.childLocationId)).toEqual({ ok: false, reason: "LOCATION_INVALID" });
    expect((await pull(B.w)).ok).toBe(true); // B'nin kendi bir kezlik hakkı
  });

  it("yalnız hesap sahibi: saha personeli ve depo yöneticisi FORBIDDEN (ayar ve çekme)", async () => {
    const { w } = await ready("OPNY");
    const manager = await mkUser(adm, reg, "OPN manager");
    await mkMembership(adm, w.tenantId, manager, { roles: ["WAREHOUSE_MANAGER"] });
    for (const userId of [w.memberUserId, manager]) {
      expect((await fail(setOpeningStockSetting(as(userId, w), { provider: "PARASUT", enabled: true }))).code).toBe("FORBIDDEN");
      expect((await fail(pullOpeningStock(as(userId, w), { provider: "PARASUT", locationId: w.childLocationId }, deps()))).code).toBe("FORBIDDEN");
    }
    expect(await ledgerOf(w)).toEqual([]);
  });

  it("bağlantı yokken ayar NOT_CONNECTED; geçersiz raf kimliği VALIDATION_FAILED", async () => {
    const w = await seedWorld(adm, reg, "OPNN");
    expect(await setOpeningStockSetting(admin(w), { provider: "PARASUT", enabled: true })).toEqual({ ok: false, reason: "NOT_CONNECTED" });
    expect(await getOpeningStockState(admin(w), { provider: "PARASUT" })).toBeNull();
    expect((await fail(pullOpeningStock(admin(w), { provider: "PARASUT", locationId: "x" }, deps()))).code).toBe("VALIDATION_FAILED");
  });
});
