// T-1006 (0056): ilk kurulum yolculuğu — gerçek wms_app bağlantısı. Kanıtlar: tamamlanma GERÇEK veriden (örnek veri sayılmaz, tıklama sayılmaz),
// atlama / geri alma ve payda, "üretim yapmıyorum" ile 5–6'nın gizlenmesi, etiket basıldı işaretinin bir kez yazılması, yetki (saha personeli
// yolculuğu görmez / değiştiremez; depo yöneticisi görür), RLS (başka kiracının seçimi görünmez / değişmez) ve DB CHECK'leri.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { AppError } from "../../../packages/shared/src/errors.ts";
import { getSetupJourney, markLabelsPrinted, setJourneyChoice } from "../../../packages/domain/src/onboarding/journey.ts";
import { mkMembership, mkUser, newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv, redactErrorChain } from "../harness/env.ts";

const env = readIntEnv(process.env);
const reg = newRegistry();

let app: DbClient;
let adm: pg.Client;
let appPg: pg.Client;
let W: TenantWorld;
/** Boş kiracı: sahip + depo yöneticisi + saha personeli; ürün/raf/stok yok. */
let bare: { tenantId: string; slug: string; owner: string; manager: string; picker: string };

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
  W = await seedWorld(adm, reg, "YOLW");
  const tenantId = randomUUID();
  const slug = `t1006-${tenantId.slice(0, 8)}`;
  await adm.query("INSERT INTO public.tenants (id, slug, name, status) VALUES ($1, $2, 'T1006 boş', 'ACTIVE')", [tenantId, slug]);
  await adm.query("INSERT INTO public.tenant_settings (tenant_id, locale, time_zone, onboarding_status) VALUES ($1, 'tr-TR', 'Europe/Istanbul', 'PENDING')", [tenantId]);
  const owner = await mkUser(adm, reg, "T1006 owner");
  const manager = await mkUser(adm, reg, "T1006 manager");
  const picker = await mkUser(adm, reg, "T1006 picker");
  await mkMembership(adm, tenantId, owner, { isOwner: true, roles: ["TENANT_ADMIN"] });
  await mkMembership(adm, tenantId, manager, { roles: ["WAREHOUSE_MANAGER"] });
  bare = { tenantId, slug, owner, manager, picker };
}, 120_000);

afterAll(async () => {
  await appPg.end();
  await adm.end();
  await app.close();
}, 120_000);

const as = (userId: string, slug: string) => ({ db: app, principal: { userId, mfaVerified: true }, tenantSlug: slug });
const owner = () => as(bare.owner, bare.slug);
const state = (v: Awaited<ReturnType<typeof getSetupJourney>>, k: string) => v.steps.find((s) => s.key === k);
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

describe("tamamlanma gerçek veriden", () => {
  it("boş kiracı: 0/8, sıradaki kartlar; seçim satırı yokken de okunur", async () => {
    const v = await getSetupJourney(owner());
    expect({ done: v.done, total: v.total, next: v.next, complete: v.complete, dismissed: v.dismissed }).toEqual({ done: 0, total: 8, next: "cards", complete: false, dismissed: false });
    expect(v.steps.every((s) => !s.done && !s.skipped && s.count === 0)).toBe(true);
    expect(v.hints).toEqual({ warehouseId: null, recipeId: null, parasut: { connected: false, openingEnabled: false, openingTakenAt: null } });
  });

  it("örnek veri sayılmaz; gerçek ürün ve raf oluşunca adımlar kendiliğinden tamam", async () => {
    const unit = randomUUID();
    const wh = randomUUID();
    await adm.query("INSERT INTO public.units (tenant_id, id, code, name) VALUES ($1, $2, 'ADET', 'Adet')", [bare.tenantId, unit]);
    await adm.query("INSERT INTO public.items (tenant_id, id, code, name, base_unit_id, is_sample) VALUES ($1, $2, 'ORNEK', 'Örnek', $3, true)", [bare.tenantId, randomUUID(), unit]);
    await adm.query("INSERT INTO public.warehouses (tenant_id, id, code, name) VALUES ($1, $2, 'D1', 'Ana depo')", [bare.tenantId, wh]);
    let v = await getSetupJourney(owner());
    expect(state(v, "cards")).toMatchObject({ done: false, count: 0 });
    expect(v.hints.warehouseId).toBe(wh);
    await adm.query("INSERT INTO public.items (tenant_id, id, code, name, base_unit_id) VALUES ($1, $2, 'U1', 'Ürün', $3), ($1, $4, 'U2', 'Ürün 2', $3)", [bare.tenantId, randomUUID(), unit, randomUUID()]);
    await adm.query("INSERT INTO public.locations (tenant_id, id, warehouse_id, parent_id, code, name, depth, kind) VALUES ($1, $2, $3, NULL, 'A1', 'Raf A1', 0, 'STORAGE')", [bare.tenantId, randomUUID(), wh]);
    v = await getSetupJourney(owner());
    expect(state(v, "cards")).toMatchObject({ done: true, count: 2 });
    expect(state(v, "shelves")).toMatchObject({ done: true, count: 1 });
    expect({ done: v.done, next: v.next }).toEqual({ done: 2, next: "stock" });
  });

  it("dolu dünya: stok hareketi, saha personeli ve sayım görevi tamam; reçete / üretim / etiket değil", async () => {
    const v = await getSetupJourney(as(W.ownerUserId, W.slug));
    for (const k of ["cards", "shelves", "stock", "people", "task"]) expect(state(v, k)?.done, k).toBe(true);
    for (const k of ["labels", "bom", "order"]) expect(state(v, k)?.done, k).toBe(false);
    expect(v.done).toBe(5);
  });

  it("etiket basıldı işareti bir kez yazılır (saha personeli de yazdırabilir), adım 4 tamam", async () => {
    const picker = await mkUser(adm, reg, "T1006 picker2");
    await mkMembership(adm, W.tenantId, picker, { roles: ["PICKER"] });
    expect(await markLabelsPrinted(as(picker, W.slug))).toEqual({ first: true });
    expect(await markLabelsPrinted(as(W.ownerUserId, W.slug))).toEqual({ first: false });
    const v = await getSetupJourney(as(W.ownerUserId, W.slug));
    expect(state(v, "labels")).toMatchObject({ done: true, count: 1 });
    const audit = await adm.query<{ n: number }>("SELECT count(*)::int AS n FROM public.audit_logs WHERE tenant_id = $1 AND action = 'setup_journey.labels_printed'", [W.tenantId]);
    expect(audit.rows[0]?.n).toBe(1);
  });
});

describe("atlama ve seçimler", () => {
  it("Bunu kullanmıyorum: adım atlanır, paydadan düşer; geri alınır; audit yazılır", async () => {
    let v = await setJourneyChoice(owner(), { skip: "labels" });
    expect(state(v, "labels")).toMatchObject({ skipped: true, done: false });
    expect(v.total).toBe(7);
    v = await setJourneyChoice(owner(), { skip: "labels" }); // tekrar: değişmez
    expect(v.total).toBe(7);
    v = await setJourneyChoice(owner(), { unskip: "labels" });
    expect(state(v, "labels")?.skipped).toBe(false);
    expect(v.total).toBe(8);
    const audit = await adm.query<{ n: number }>("SELECT count(*)::int AS n FROM public.audit_logs WHERE tenant_id = $1 AND action = 'setup_journey.updated'", [bare.tenantId]);
    expect(audit.rows[0]?.n).toBe(3);
  });

  it("üretim yapmayan firmada 5 ve 6 hiç görünmez; cevap değişince geri gelir", async () => {
    let v = await setJourneyChoice(owner(), { makesProduction: false });
    expect(v.steps.map((s) => s.key)).toEqual(["cards", "shelves", "stock", "labels", "people", "task"]);
    expect(v.total).toBe(6);
    v = await setJourneyChoice(as(bare.manager, bare.slug), { makesProduction: true });
    expect(v.steps).toHaveLength(8);
    expect(v.makesProduction).toBe(true);
  });

  it("kaynak + açılış stoku cevabı ve kutlamayı kapatma kaydedilir; kaldığı yerden okunur", async () => {
    await setJourneyChoice(owner(), { cardSource: "PARASUT", openingStockWanted: true, skip: "task" });
    const v = await getSetupJourney(as(bare.manager, bare.slug));
    expect({ cardSource: v.cardSource, openingStockWanted: v.openingStockWanted, dismissed: v.dismissed }).toEqual({ cardSource: "PARASUT", openingStockWanted: true, dismissed: false });
    expect(state(v, "task")?.skipped).toBe(true);
    expect((await setJourneyChoice(owner(), { dismiss: true })).dismissed).toBe(true);
  });

  it("spotlight tur: başta null; başlat → ACTIVE, kapat → CLOSED; kutlamayı kapatmak turu da kapatır", async () => {
    expect((await getSetupJourney(as(W.ownerUserId, W.slug))).tour).toBeNull();
    expect((await setJourneyChoice(as(W.ownerUserId, W.slug), { tour: "start" })).tour).toBe("ACTIVE");
    expect((await setJourneyChoice(as(W.ownerUserId, W.slug), { tour: "close" })).tour).toBe("CLOSED");
    await setJourneyChoice(as(W.ownerUserId, W.slug), { tour: "start" });
    const v = await setJourneyChoice(as(W.ownerUserId, W.slug), { dismiss: true });
    expect({ tour: v.tour, dismissed: v.dismissed }).toEqual({ tour: "CLOSED", dismissed: true });
    expect((await fail(setJourneyChoice(owner(), { tour: "pause" }))).code).toBe("VALIDATION_FAILED");
    expect(await asApp(W.tenantId, "UPDATE public.setup_journeys SET tour_state = 'PAUSED' WHERE tenant_id = $1", [W.tenantId])).toMatchObject({ ok: false, code: "23514" });
  });

  it("geçersiz girdi VALIDATION_FAILED (bilinmeyen adım, boş seçim, bilinmeyen kaynak)", async () => {
    expect((await fail(setJourneyChoice(owner(), { skip: "evil" }))).code).toBe("VALIDATION_FAILED");
    expect((await fail(setJourneyChoice(owner(), {}))).code).toBe("VALIDATION_FAILED");
    expect((await fail(setJourneyChoice(owner(), { cardSource: "SAP" }))).code).toBe("VALIDATION_FAILED");
  });
});

describe("yetki ve kiracı yalıtımı", () => {
  it("saha personeli, sayım kullanıcısı ve salt okuma yolculuğu görmez ve değiştiremez (FORBIDDEN)", async () => {
    const counter = await mkUser(adm, reg, "T1006 counter");
    const reader = await mkUser(adm, reg, "T1006 reader");
    await mkMembership(adm, W.tenantId, counter, { roles: ["COUNTER"] });
    await mkMembership(adm, W.tenantId, reader, { roles: ["READ_ONLY"] });
    for (const userId of [W.memberUserId /* PICKER */, counter, reader]) {
      const p = as(userId, W.slug);
      expect((await fail(getSetupJourney(p))).code).toBe("FORBIDDEN");
      expect((await fail(setJourneyChoice(p, { skip: "labels" }))).code).toBe("FORBIDDEN");
    }
  });

  it("üye olmayan kullanıcı başka kiracının yolculuğunu okuyamaz", async () => {
    const e = await fail(getSetupJourney(as(bare.owner, W.slug)));
    expect(["NOT_FOUND", "FORBIDDEN"]).toContain(e.code);
  });

  it("RLS: başka kiracının seçim satırı görünmez ve güncellenemez; kiracı A'nın seçimi B'yi etkilemez", async () => {
    const own = await asApp(W.tenantId, "SELECT tenant_id FROM public.setup_journeys WHERE tenant_id = $1", [bare.tenantId]);
    expect(own).toMatchObject({ ok: true, rowCount: 0 });
    const upd = await asApp(W.tenantId, "UPDATE public.setup_journeys SET skipped = '{}'::text[] WHERE tenant_id = $1", [bare.tenantId]);
    expect(upd).toMatchObject({ ok: true, rowCount: 0 });
    const ins = await asApp(W.tenantId, "INSERT INTO public.setup_journeys (tenant_id) VALUES ($1)", [bare.tenantId]);
    expect(ins).toMatchObject({ ok: false, code: "42501" });
    const w = await getSetupJourney(as(W.ownerUserId, W.slug));
    expect(w.steps.some((s) => s.skipped)).toBe(false);
    expect(w.cardSource).toBeNull();
  });

  it("DB: tekrar eden ya da bilinmeyen adım reddedilir; DELETE yetkisi yok", async () => {
    expect(await asApp(bare.tenantId, "UPDATE public.setup_journeys SET skipped = '{labels,labels}'::text[] WHERE tenant_id = $1", [bare.tenantId])).toMatchObject({ ok: false, code: "23514" });
    expect(await asApp(bare.tenantId, "UPDATE public.setup_journeys SET skipped = '{evil}'::text[] WHERE tenant_id = $1", [bare.tenantId])).toMatchObject({ ok: false, code: "23514" });
    expect(await asApp(bare.tenantId, "DELETE FROM public.setup_journeys WHERE tenant_id = $1", [bare.tenantId])).toMatchObject({ ok: false, code: "42501" });
  });
});
