// T-1129 (B-188; A-87/A-107 güncellemesi): hiç kullanılmamış üründe temel birim, miktar hassasiyeti ve takip modu değişir; ilk kullanımla
// kilitlenir. Gerçek wms_app bağlantısı + RLS; kullanım fikstürleri migration rolüyle (tenant bağlamında) yazılır (G-09 sentetik).
// Kapsam: domain `updateItem` (izin, audit, IN_USE), 0065 tetikleyicisi (doğrudan SQL, sahip, replica, yanlış bağlam), tenant negatifleri
// (I-01…I-03) ve iki yönlü yarış (açık bağımlı satır ↔ açık sabit alan değişikliği).
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { AppError } from "../../../packages/shared/src/errors.ts";
import { createItem, getItemFixedState, updateItem } from "../../../packages/domain/src/catalog/items.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv, redactErrorChain } from "../harness/env.ts";

const env = readIntEnv(process.env);
const reg = newRegistry();
const rnd = (): string => randomBytes(4).toString("hex");
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const CHECK_VIOLATION = "23514";

let app: DbClient;
let adm: pg.Client;
const clients: pg.Client[] = [];
let A: TenantWorld;
let B: TenantWorld;
let kgA: string;
let archivedUnitA: string;

async function connect(url: string): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: url });
  c.on("error", () => undefined);
  try {
    await c.connect();
  } catch (e) {
    throw new Error(`connect failed: ${redactErrorChain(e, [url])}`);
  }
  clients.push(c);
  return c;
}

beforeAll(async () => {
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  adm = await connect(env.databaseUrlDirect);
  A = await seedWorld(adm, reg, "FIXA");
  B = await seedWorld(adm, reg, "FIXB");
  kgA = randomUUID();
  archivedUnitA = randomUUID();
  await owner(A.tenantId, async (q) => {
    await q("INSERT INTO public.units (tenant_id, id, code, name) VALUES ($1, $2, $3, 'Kilogram')", [A.tenantId, kgA, `KG${rnd()}`]);
    await q("INSERT INTO public.units (tenant_id, id, code, name) VALUES ($1, $2, $3, 'Eski')", [A.tenantId, archivedUnitA, `ESK${rnd()}`]);
    await q("UPDATE public.units SET status = 'ARCHIVED', archived_at = now() WHERE id = $1", [archivedUnitA]);
  });
}, 120_000);

afterAll(async () => {
  // Audit append-only: audit yazan tenant'lar kısa ömürlü test veritabanında kalır (catalog-commands ile aynı politika).
  for (const c of clients) await c.end().catch(() => undefined);
  await app.close();
}, 120_000);

const admin = (w: TenantWorld) => ({ db: app, principal: { userId: w.ownerUserId, mfaVerified: true }, tenantSlug: w.slug });
const picker = (w: TenantWorld) => ({ db: app, principal: { userId: w.memberUserId, mfaVerified: true }, tenantSlug: w.slug });

type Q = (text: string, params?: unknown[]) => Promise<pg.QueryResult>;
/** Migration rolüyle tenant bağlamında tek transaction (RLS FORCE: sahip de bağlam ister). */
async function owner<T>(tenant: string, fn: (q: Q) => Promise<T>): Promise<T> {
  await adm.query("BEGIN");
  try {
    await adm.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenant]);
    const v = await fn((t, p) => adm.query(t, p));
    await adm.query("COMMIT");
    return v;
  } catch (e) {
    await adm.query("ROLLBACK");
    throw e;
  }
}
/** Ayrı bağlantıda tenant bağlamlı transaction başlatır (commit/rollback çağıranda). */
async function begin(url: string, tenant: string): Promise<pg.Client> {
  const c = await connect(url);
  await c.query("BEGIN");
  await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenant]);
  return c;
}
/** wms_app ile tek ifade; her zaman ROLLBACK (yan etki bırakmaz) — sonuç ya da SQLSTATE döner. */
async function asApp(tenant: string | null, text: string, params: unknown[]): Promise<{ ok: true; rows: number } | { ok: false; code?: string; message: string }> {
  const c = await connect(env.databaseUrl);
  await c.query("BEGIN");
  try {
    if (tenant !== null) await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenant]);
    const r = await c.query(text, params);
    return { ok: true, rows: r.rowCount ?? 0 };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { ok: false, code: err.code, message: String(err.message) };
  } finally {
    await c.query("ROLLBACK").catch(() => undefined);
    await c.end().catch(() => undefined);
  }
}

async function fail(p: Promise<unknown>, code: string, detail?: string): Promise<void> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
  expect((err as AppError).detail).toBe(detail);
}
async function newItem(w: TenantWorld, opts: { tracking?: "NONE" | "LOT" | "SERIAL" | "LOT_AND_SERIAL"; scale?: number } = {}): Promise<string> {
  const { itemId } = await createItem(admin(w), { code: `F${rnd()}`, name: "Sabit alan", baseUnitId: w.unitId, trackingMode: opts.tracking ?? "NONE", quantityScale: opts.scale ?? 0 });
  return itemId;
}
async function fixedOf(itemId: string): Promise<{ base_unit_id: string; tracking_mode: string; quantity_scale: number }> {
  const r = await adm.query("SELECT base_unit_id, tracking_mode, quantity_scale FROM public.items WHERE id = $1", [itemId]);
  return r.rows[0] as { base_unit_id: string; tracking_mode: string; quantity_scale: number };
}

/** Kullanım türü → ürünü "kullanılmış" yapan fikstür (migration rolü, tenant bağlamı). Beklenen `item_fixed_usage` kodu yanında. */
const USES: readonly { name: string; code: string; tracking?: "LOT" | "SERIAL"; seed: (q: Q, w: TenantWorld, item: string) => Promise<unknown> }[] = [
  { name: "stok boyutu", code: "STOCK", seed: (q, w, item) => q("INSERT INTO public.stock_dimensions (tenant_id, id, item_id, location_id) VALUES ($1, gen_random_uuid(), $2, $3)", [w.tenantId, item, w.rootLocationId]) },
  {
    name: "belge satırı",
    code: "DOCUMENT",
    seed: (q, w, item) =>
      q(
        `INSERT INTO public.document_lines (tenant_id, id, document_id, line_no, item_id, unit_id, quantity, conversion_factor, base_quantity, target_location_id)
         VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, 1, 1, 1, $6)`,
        [w.tenantId, w.documentId, 1000 + Math.floor(Math.random() * 1_000_000), item, w.unitId, w.rootLocationId],
      ),
  },
  { name: "lot", code: "TRACKING", tracking: "LOT", seed: (q, w, item) => q("INSERT INTO public.lots (tenant_id, item_id, lot_code) VALUES ($1, $2, $3)", [w.tenantId, item, `L${rnd()}`]) },
  { name: "seri", code: "TRACKING", tracking: "SERIAL", seed: (q, w, item) => q("INSERT INTO public.serials (tenant_id, item_id, serial_no) VALUES ($1, $2, $3)", [w.tenantId, item, `S${rnd()}`]) },
  { name: "birim dönüşümü", code: "UNIT", seed: (q, w, item) => q("INSERT INTO public.unit_conversions (tenant_id, item_id, unit_id, to_base_factor) VALUES ($1, $2, $3, 12)", [w.tenantId, item, w.boxUnitId]) },
  { name: "birimli barkod", code: "UNIT", seed: (q, w, item) => q("INSERT INTO public.item_barcodes (tenant_id, item_id, unit_id, barcode) VALUES ($1, $2, $3, $4)", [w.tenantId, item, w.unitId, `B${rnd()}`]) },
  { name: "miktarlı barkod", code: "UNIT", seed: (q, w, item) => q("INSERT INTO public.item_barcodes (tenant_id, item_id, barcode, quantity) VALUES ($1, $2, $3, 5)", [w.tenantId, item, `B${rnd()}`]) },
  { name: "depo görevi", code: "TASK", seed: (q, w, item) => q("INSERT INTO public.warehouse_tasks (tenant_id, warehouse_id, kind, item_id, quantity) VALUES ($1, $2, 'PUTAWAY', $3, 2)", [w.tenantId, w.warehouseId, item]) },
  {
    name: "reçete çıktısı",
    code: "RECIPE",
    seed: (q, w, item) =>
      q("INSERT INTO public.production_recipes (tenant_id, id, code, version, name, output_item_id, output_quantity, created_by) VALUES ($1, gen_random_uuid(), $2, 1, 'Reçete', $3, 1, $4)", [w.tenantId, `R${rnd()}`, item, w.ownerUserId]),
  },
  { name: "stok politikası", code: "POLICY", seed: (q, w, item) => q("INSERT INTO public.item_stock_policies (tenant_id, warehouse_id, item_id, min_quantity, max_quantity) VALUES ($1, $2, $3, 1, 5)", [w.tenantId, w.warehouseId, item]) },
];

describe("T-1129 hiç kullanılmamış ürün: sabit alanlar değişir", () => {
  it("temel birim + hassasiyet + takip modu birlikte değişir; audit eski → yeni; yeniden aynı değer no-op", async () => {
    const itemId = await newItem(A);
    expect(await getItemFixedState(picker(A), { itemId })).toEqual({ usage: null, sourceLinked: false });
    expect(await updateItem(admin(A), { itemId, baseUnitId: kgA, quantityScale: 3, trackingMode: "LOT" })).toEqual({ itemId, changed: true });
    expect(await fixedOf(itemId)).toEqual({ base_unit_id: kgA, tracking_mode: "LOT", quantity_scale: 3 });
    const audit = await adm.query("SELECT change_summary, actor_user_id FROM public.audit_logs WHERE tenant_id = $1 AND entity_id = $2 AND action = 'item.updated' ORDER BY occurred_at DESC LIMIT 1", [A.tenantId, itemId]);
    expect(audit.rows[0]).toMatchObject({
      actor_user_id: A.ownerUserId,
      change_summary: { from_base_unit_id: A.unitId, to_base_unit_id: kgA, from_tracking_mode: "NONE", to_tracking_mode: "LOT", from_quantity_scale: 0, to_quantity_scale: 3 },
    });
    expect(await updateItem(admin(A), { itemId, baseUnitId: kgA, quantityScale: 3, trackingMode: "LOT" })).toEqual({ itemId, changed: false });
    // Yalnız ad değişimi sabit alanları audit'e eklemez.
    await updateItem(admin(A), { itemId, name: "Yeni ad" });
    const last = await adm.query("SELECT change_summary FROM public.audit_logs WHERE tenant_id = $1 AND entity_id = $2 AND action = 'item.updated' ORDER BY occurred_at DESC LIMIT 1", [A.tenantId, itemId]);
    expect(Object.keys((last.rows[0] as { change_summary: Record<string, unknown> }).change_summary)).not.toContain("to_base_unit_id");
  });

  it("birimsiz ve miktarsız barkod ürünü kilitlemez (birim anlamı taşımaz)", async () => {
    const itemId = await newItem(A);
    await owner(A.tenantId, (q) => q("INSERT INTO public.item_barcodes (tenant_id, item_id, barcode) VALUES ($1, $2, $3)", [A.tenantId, itemId, `EWMS-ITEM-${itemId}`]));
    expect(await updateItem(admin(A), { itemId, quantityScale: 2, baseUnitId: kgA })).toEqual({ itemId, changed: true });
  });

  it("yetki ve doğrulama: settings.manage ister; arşivli/başka tenant'ın birimi; ölçek sınırı", async () => {
    const itemId = await newItem(A);
    await fail(updateItem(picker(A), { itemId, quantityScale: 2 }), "FORBIDDEN");
    await fail(updateItem(admin(A), { itemId, baseUnitId: archivedUnitA }), "VALIDATION_FAILED");
    await fail(updateItem(admin(A), { itemId, baseUnitId: B.unitId }), "NOT_FOUND"); // I-01: başka tenant'ın birimi görünmez
    await fail(updateItem(admin(A), { itemId, quantityScale: 7 }), "VALIDATION_FAILED");
    expect(await fixedOf(itemId)).toEqual({ base_unit_id: A.unitId, tracking_mode: "NONE", quantity_scale: 0 });
  });
});

describe("T-1129 kullanılmış ürün: her kullanım türü kilitler (domain IN_USE + tetikleyici)", () => {
  for (const use of USES) {
    it(`${use.name} → ${use.code}: updateItem IN_USE, wms_app doğrudan SQL 23514, sahip de reddedilir; değerler değişmez`, async () => {
      const itemId = await newItem(A, use.tracking === undefined ? {} : { tracking: use.tracking });
      await owner(A.tenantId, (q) => use.seed(q, A, itemId));
      expect(await getItemFixedState(picker(A), { itemId })).toEqual({ usage: use.code, sourceLinked: false });
      const before = await fixedOf(itemId);
      await fail(updateItem(admin(A), { itemId, quantityScale: 4 }), "VALIDATION_FAILED", "IN_USE");
      await fail(updateItem(admin(A), { itemId, baseUnitId: kgA }), "VALIDATION_FAILED", "IN_USE");
      await fail(updateItem(admin(A), { itemId, trackingMode: use.tracking === undefined ? "LOT" : "NONE" }), "VALIDATION_FAILED", "IN_USE");
      const direct = await asApp(A.tenantId, "UPDATE public.items SET quantity_scale = 5 WHERE id = $1", [itemId]);
      expect(direct).toMatchObject({ ok: false, code: CHECK_VIOLATION });
      expect((direct as { message: string }).message).toMatch(/^ITEM_FIXED_IN_USE/);
      await expect(owner(A.tenantId, (q) => q("UPDATE public.items SET base_unit_id = $2 WHERE id = $1", [itemId, kgA]))).rejects.toMatchObject({ code: CHECK_VIOLATION });
      expect(await fixedOf(itemId)).toEqual(before);
      // Ad/kod gibi serbest alanlar kullanılmış üründe de değişir.
      expect(await updateItem(admin(A), { itemId, name: "Ad serbest" })).toEqual({ itemId, changed: true });
    });
  }

  it("bağlı sistemden gelen ürün: temel birim kilitli (IN_USE), hassasiyet/takip değişir", async () => {
    const itemId = await newItem(A);
    await owner(A.tenantId, (q) => q("INSERT INTO public.external_refs (tenant_id, system, entity_type, entity_id, external_id) VALUES ($1, 'PARASUT', 'ITEM', $2, $3)", [A.tenantId, itemId, `P${rnd()}`]));
    expect(await getItemFixedState(picker(A), { itemId })).toEqual({ usage: null, sourceLinked: true });
    await fail(updateItem(admin(A), { itemId, baseUnitId: kgA }), "VALIDATION_FAILED", "IN_USE");
    const direct = await asApp(A.tenantId, "UPDATE public.items SET base_unit_id = $2 WHERE id = $1", [itemId, kgA]);
    expect(direct).toMatchObject({ ok: false, code: CHECK_VIOLATION });
    expect((direct as { message: string }).message).toMatch(/^ITEM_FIXED_SOURCE_LINKED/);
    expect(await updateItem(admin(A), { itemId, quantityScale: 2, trackingMode: "LOT" })).toEqual({ itemId, changed: true });
    expect(await fixedOf(itemId)).toEqual({ base_unit_id: A.unitId, tracking_mode: "LOT", quantity_scale: 2 });
  });
});

describe("T-1129 veritabanı bekçisi (0065): yetki, tenant, replica", () => {
  it("wms_app yalnız üç sabit sütunda UPDATE alır; tenant_id/id/created_at hâlâ yetkisiz", async () => {
    const r = await adm.query<Record<string, boolean>>(
      `SELECT has_column_privilege('wms_app', 'public.items', 'base_unit_id', 'UPDATE') AS b, has_column_privilege('wms_app', 'public.items', 'tracking_mode', 'UPDATE') AS t,
              has_column_privilege('wms_app', 'public.items', 'quantity_scale', 'UPDATE') AS s, has_column_privilege('wms_app', 'public.items', 'tenant_id', 'UPDATE') AS tenant,
              has_column_privilege('wms_app', 'public.items', 'id', 'UPDATE') AS id, has_column_privilege('wms_app', 'public.items', 'created_at', 'UPDATE') AS created,
              has_function_privilege('wms_app', 'public.item_fixed_usage(uuid, uuid)', 'EXECUTE') AS fn,
              has_function_privilege('public', 'public.item_fixed_usage(uuid, uuid)', 'EXECUTE') AS fn_public`,
    );
    expect(r.rows[0]).toEqual({ b: true, t: true, s: true, tenant: false, id: false, created: false, fn: true, fn_public: false });
    const trg = await adm.query("SELECT tgenabled FROM pg_trigger WHERE tgrelid = 'public.items'::regclass AND tgname = 'items_guard_unused_fixed'");
    expect(trg.rows[0]).toEqual({ tgenabled: "A" }); // ENABLE ALWAYS
  });

  it("kullanılmamış ürün wms_app doğrudan SQL ile değişir; başka tenant bağlamında 0 satır (RLS); bağlamsız/yanlış bağlam fail-closed", async () => {
    const itemId = await newItem(A);
    expect(await asApp(A.tenantId, "UPDATE public.items SET quantity_scale = 2, tracking_mode = 'SERIAL' WHERE id = $1", [itemId])).toEqual({ ok: true, rows: 1 });
    // I-01/I-03: B bağlamındaki wms_app A'nın ürününü göremez/değiştiremez.
    expect(await asApp(B.tenantId, "UPDATE public.items SET quantity_scale = 2 WHERE id = $1", [itemId])).toEqual({ ok: true, rows: 0 });
    expect(await asApp(null, "UPDATE public.items SET quantity_scale = 2 WHERE id = $1", [itemId])).toMatchObject({ ok: true, rows: 0 });
    // I-02: sahip (RLS'i aşabilen rol) yanlış bağlamla da geçemez — denetim fail-closed.
    await expect(owner(B.tenantId, (q) => q("UPDATE public.items SET quantity_scale = 2 WHERE id = $1", [itemId]))).rejects.toMatchObject({ code: CHECK_VIOLATION, message: expect.stringMatching(/^STOCK_TENANT_CONTEXT_MISMATCH/) });
    // Kullanım fonksiyonu da yalnız kendi tenant bağlamında sayar.
    expect(await asApp(B.tenantId, "SELECT public.item_fixed_usage($1, $2)", [A.tenantId, itemId])).toMatchObject({ ok: false, code: CHECK_VIOLATION });
    // Başka tenant'ın birimi RLS altında görünmez → tetikleyici reddeder (bileşik FK ayrıca bağlar).
    expect(await asApp(A.tenantId, "UPDATE public.items SET base_unit_id = $2 WHERE id = $1", [itemId, B.unitId])).toMatchObject({ ok: false, code: CHECK_VIOLATION, message: expect.stringMatching(/^ITEM_FIXED_UNIT_INVALID/) });
    // Arşivli birim tetikleyicide reddedilir.
    expect(await asApp(A.tenantId, "UPDATE public.items SET base_unit_id = $2 WHERE id = $1", [itemId, archivedUnitA])).toMatchObject({ ok: false, code: CHECK_VIOLATION, message: expect.stringMatching(/^ITEM_FIXED_UNIT_INVALID/) });
  });

  it("replica modu da atlatmaz (ENABLE ALWAYS)", async () => {
    const itemId = await newItem(A);
    await owner(A.tenantId, (q) => q("INSERT INTO public.unit_conversions (tenant_id, item_id, unit_id, to_base_factor) VALUES ($1, $2, $3, 6)", [A.tenantId, itemId, A.boxUnitId]));
    await expect(
      owner(A.tenantId, async (q) => {
        await q("SET LOCAL session_replication_role = replica");
        return q("UPDATE public.items SET quantity_scale = 3 WHERE id = $1", [itemId]);
      }),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION, message: expect.stringMatching(/^ITEM_FIXED_IN_USE/) });
  });
});

describe("T-1129 yarış: 'kullanılmıyor' kararı ile ilk kullanım arasında açık kalmaz", () => {
  it("açık (commit edilmemiş) dönüşüm eklemesi varken updateItem bekler; ekleme commit → IN_USE, değer değişmez", async () => {
    const itemId = await newItem(A);
    const c2 = await begin(env.databaseUrl, A.tenantId);
    await c2.query("INSERT INTO public.unit_conversions (tenant_id, id, item_id, unit_id, to_base_factor) VALUES ($1, gen_random_uuid(), $2, $3, 10)", [A.tenantId, itemId, A.boxUnitId]);
    let done = false;
    const t1 = updateItem(admin(A), { itemId, quantityScale: 3 }).finally(() => {
      done = true;
    });
    t1.catch(() => undefined);
    await sleep(500);
    expect(done, "updateItem açık eklemenin commit'ini beklemeliydi").toBe(false);
    await c2.query("COMMIT");
    await fail(t1, "VALIDATION_FAILED", "IN_USE");
    expect((await fixedOf(itemId)).quantity_scale).toBe(0);
  });

  it("açık belge satırı eklemesi varken wms_app doğrudan UPDATE bekler; commit → ITEM_FIXED_IN_USE", async () => {
    const itemId = await newItem(A);
    const c2 = await begin(env.databaseUrlDirect, A.tenantId);
    await c2.query(
      `INSERT INTO public.document_lines (tenant_id, id, document_id, line_no, item_id, unit_id, quantity, conversion_factor, base_quantity, target_location_id)
       VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, 1, 1, 1, $6)`,
      [A.tenantId, A.documentId, 2_000_000 + Math.floor(Math.random() * 1_000_000), itemId, A.unitId, A.rootLocationId],
    );
    const c1 = await begin(env.databaseUrl, A.tenantId);
    let done = false;
    const t1 = c1.query("UPDATE public.items SET base_unit_id = $2 WHERE id = $1", [itemId, kgA]).finally(() => {
      done = true;
    });
    t1.catch(() => undefined);
    await sleep(500);
    expect(done, "doğrudan UPDATE açık belge satırının commit'ini beklemeliydi").toBe(false);
    await c2.query("COMMIT");
    await expect(t1).rejects.toMatchObject({ code: CHECK_VIOLATION, message: expect.stringMatching(/^ITEM_FIXED_IN_USE/) });
    await c1.query("ROLLBACK");
    expect((await fixedOf(itemId)).base_unit_id).toBe(A.unitId);
  });

  it("açık takip modu değişikliği (wms_app) varken stok boyutu eklemesi bekler; değişiklik commit → TRACKING_VIOLATION, boyut yok", async () => {
    const itemId = await newItem(A);
    const c1 = await begin(env.databaseUrl, A.tenantId);
    await c1.query("UPDATE public.items SET tracking_mode = 'LOT' WHERE id = $1", [itemId]);
    const c2 = await begin(env.databaseUrl, A.tenantId);
    let done = false;
    const t2 = c2.query("INSERT INTO public.stock_dimensions (tenant_id, id, item_id, location_id) VALUES ($1, gen_random_uuid(), $2, $3)", [A.tenantId, itemId, A.rootLocationId]).finally(() => {
      done = true;
    });
    t2.catch(() => undefined);
    await sleep(500);
    expect(done, "boyut eklemesi açık takip modu değişikliğini beklemeliydi").toBe(false);
    await c1.query("COMMIT");
    await expect(t2).rejects.toMatchObject({ code: CHECK_VIOLATION, message: expect.stringContaining("TRACKING_VIOLATION") });
    await c2.query("ROLLBACK");
    const left = await adm.query("SELECT count(*)::int AS n FROM public.stock_dimensions WHERE item_id = $1", [itemId]);
    expect((left.rows[0] as { n: number }).n).toBe(0);
    expect((await fixedOf(itemId)).tracking_mode).toBe("LOT");
  });

  it("takip modu değişikliği başka tenant'ların boyut eklemesini bekletmez (tablo geneli kilit yok)", async () => {
    const itemId = await newItem(A);
    const other = await newItem(B);
    const c1 = await begin(env.databaseUrl, A.tenantId);
    await c1.query("UPDATE public.items SET tracking_mode = 'LOT' WHERE id = $1", [itemId]);
    try {
      const c2 = await begin(env.databaseUrl, B.tenantId);
      await c2.query("SET LOCAL lock_timeout = '3s'");
      await c2.query("INSERT INTO public.stock_dimensions (tenant_id, id, item_id, location_id) VALUES ($1, gen_random_uuid(), $2, $3)", [B.tenantId, other, B.rootLocationId]);
      await c2.query("ROLLBACK");
    } finally {
      await c1.query("ROLLBACK");
    }
  });
});
