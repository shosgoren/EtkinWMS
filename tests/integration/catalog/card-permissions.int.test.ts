// T-1141 (kullanıcı kararı 31 Ekim): ürün / cari / depo / raf yeri kartlarında her yazma işlemi kart bölümü × işlem anahtarını ister
// (`items.create|edit|archive`, `parties.*`, `warehouses.*`, `locations.*`; rollerde yalnız TENANT_ADMIN). Yetkisiz üye — geniş rol
// (WAREHOUSE_MANAGER) + gruba verilebilen BÜTÜN ek yetkiler (T-421) taşısa bile — FORBIDDEN alır; hiçbir satır ve audit yazılmaz.
// Hesap sahibi aynı işlemleri yapabilir (erişim kaybı yok). Çapraz tenant: A'nın yöneticisi B'nin kartına yazamaz (NOT_FOUND, I-01/I-02).
// Gerçek wms_app bağlantısı + RLS; fikstürler sentetik (G-09).
import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { AppError } from "../../../packages/shared/src/errors.ts";
import {
  addBarcode,
  archiveItem,
  createItem,
  createItemWithDefaultUnit,
  createUnit,
  removeBarcode,
  renameUnit,
  setUnitConversion,
  suggestCode,
  updateItem,
} from "../../../packages/domain/src/catalog/index.ts";
import { saveParty, setPartyArchived } from "../../../packages/domain/src/catalog/parties.ts";
import {
  archiveLocation,
  archiveWarehouse,
  createBulkLocations,
  createLocation,
  createWarehouse,
  previewBulkLocations,
  renameLocation,
  renameWarehouse,
  setLocationKind,
} from "../../../packages/domain/src/warehouse/index.ts";
import { GRANTABLE } from "../../../packages/domain/src/identity/permissions.ts";
import { mkMembership, mkUser, newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";

const env = readIntEnv(process.env);
const reg = newRegistry();
let app: DbClient;
let adm: pg.Client;
let A: TenantWorld;
let B: TenantWorld;
/** WAREHOUSE_MANAGER + gruba verilebilen bütün ek yetkiler (onay, ters kayıt, Excel aktarımı…): kart yazma anahtarı YOK. */
let managerUserId: string;
let partyA: { id: string; version: number };
let partyB: { id: string; version: number };
let barcodeA: string;
let extraWarehouseA: string;
let leafLocationA: string;

const admin = (w: TenantWorld) => ({ db: app, principal: { userId: w.ownerUserId, mfaVerified: true }, tenantSlug: w.slug });
const manager = () => ({ db: app, principal: { userId: managerUserId, mfaVerified: true }, tenantSlug: A.slug });
const picker = (w: TenantWorld) => ({ db: app, principal: { userId: w.memberUserId, mfaVerified: true }, tenantSlug: w.slug });
const uniq = (p: string): string => `${p}${randomUUID().slice(0, 8)}`.toUpperCase();

async function failure(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return e as AppError;
  }
  throw new Error("expected rejection");
}

/** Kart tablolarının (ürün, birim, dönüşüm, barkod, cari, depo, raf yeri) satır sürümleri + audit sayısı: yazma olmadıysa aynı kalır. */
async function snapshot(tenantId: string): Promise<string> {
  const r = await adm.query<{ s: string }>(
    `SELECT concat_ws('|',
       (SELECT string_agg(id::text || ':' || version::text || ':' || coalesce(archived_at::text, ''), ',' ORDER BY id) FROM public.parties WHERE tenant_id = $1),
       (SELECT string_agg(id::text || ':' || code || ':' || name || ':' || status, ',' ORDER BY id) FROM public.items WHERE tenant_id = $1),
       (SELECT string_agg(id::text || ':' || code || ':' || name || ':' || status, ',' ORDER BY id) FROM public.units WHERE tenant_id = $1),
       (SELECT count(*)::text FROM public.unit_conversions WHERE tenant_id = $1),
       (SELECT count(*)::text FROM public.item_barcodes WHERE tenant_id = $1),
       (SELECT string_agg(id::text || ':' || code || ':' || name || ':' || status, ',' ORDER BY id) FROM public.warehouses WHERE tenant_id = $1),
       (SELECT string_agg(id::text || ':' || code || ':' || name || ':' || status || ':' || kind, ',' ORDER BY id) FROM public.locations WHERE tenant_id = $1),
       (SELECT count(*)::text FROM public.audit_logs WHERE tenant_id = $1)) AS s`,
    [tenantId],
  );
  return r.rows[0]?.s ?? "";
}

beforeAll(async () => {
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  await adm.connect();
  A = await seedWorld(adm, reg, "A1141");
  B = await seedWorld(adm, reg, "B1141");
  managerUserId = await mkUser(adm, reg, "A1141 manager");
  const managerMembershipId = await mkMembership(adm, A.tenantId, managerUserId, { roles: ["WAREHOUSE_MANAGER"] });
  const g = await adm.query<{ id: string }>("INSERT INTO public.permission_groups (tenant_id, name, grants, created_by) VALUES ($1, 'Tam ek yetki', $2::text[], $3) RETURNING id", [
    A.tenantId,
    [...GRANTABLE],
    A.ownerMembershipId,
  ]);
  await adm.query("INSERT INTO public.member_groups (tenant_id, membership_id, group_id, assigned_by) VALUES ($1, $2, $3, $4)", [A.tenantId, managerMembershipId, g.rows[0]?.id, A.ownerMembershipId]);

  // Yazılacak hedefler hesap sahibince açılır (aynı zamanda sahibin erişimini korur: TENANT_ADMIN bütün kart anahtarlarını taşır).
  const pa = await saveParty(admin(A), { code: uniq("C-"), name: "T1141 Cari A", kind: "CUSTOMER" });
  const pb = await saveParty(admin(B), { code: uniq("C-"), name: "T1141 Cari B", kind: "CUSTOMER" });
  if (!pa.ok || !pb.ok) throw new Error("party seed failed");
  partyA = { id: pa.id, version: pa.version };
  partyB = { id: pb.id, version: pb.version };
  barcodeA = (await addBarcode(admin(A), { itemId: A.itemId, unitId: null, barcode: `T1141${Date.now()}`, quantity: null })).barcodeId;
  extraWarehouseA = (await createWarehouse(admin(A), { code: uniq("W-"), name: "T1141 boş depo" })).warehouseId;
  leafLocationA = (await createLocation(admin(A), { warehouseId: A.warehouseId, parentId: A.rootLocationId, code: uniq("L-"), name: "T1141 raf", kind: "STORAGE" })).locationId;
}, 120_000);

afterAll(async () => {
  await adm.end();
  await app.close();
}, 60_000);

/** Yetkisiz denemelerin hepsi: [ad, çağrı]. Her biri FORBIDDEN olmalı ve hiçbir şey yazmamalı. */
const forbiddenCalls = (who: () => ReturnType<typeof manager>): readonly (readonly [string, () => Promise<unknown>])[] => [
  // Ürünler
  ["items.create createItem", () => createItem(who(), { code: uniq("I-"), name: "x", baseUnitId: A.unitId })],
  ["items.create createItemWithDefaultUnit", () => createItemWithDefaultUnit(who(), { code: uniq("I-"), name: "x" })],
  ["items.create createUnit", () => createUnit(who(), { code: uniq("U"), name: "x" })],
  ["items.create suggestCode", () => suggestCode(who(), { kind: "item" })],
  ["items.edit updateItem (ad)", () => updateItem(who(), { itemId: A.itemId, name: "değişti" })],
  ["items.edit updateItem (kod)", () => updateItem(who(), { itemId: A.itemId, code: uniq("K-") })],
  ["items.edit addBarcode", () => addBarcode(who(), { itemId: A.itemId, unitId: null, barcode: `X${Date.now()}`, quantity: null })],
  ["items.edit removeBarcode", () => removeBarcode(who(), { barcodeId: barcodeA })],
  ["items.edit setUnitConversion", () => setUnitConversion(who(), { itemId: A.itemId, unitId: A.boxUnitId, factor: "12" })],
  ["items.edit renameUnit", () => renameUnit(who(), { unitId: A.unitId, name: "değişti" })],
  ["items.archive archiveItem", () => archiveItem(who(), { itemId: A.itemTwoId })],
  // Cariler
  ["parties.create saveParty (yeni)", () => saveParty(who(), { code: uniq("C-"), name: "x", kind: "CUSTOMER" })],
  ["parties.create suggestCode", () => suggestCode(who(), { kind: "party", prefix: "MUS" })],
  ["parties.edit saveParty (düzenle + kod)", () => saveParty(who(), { id: partyA.id, expectedVersion: partyA.version, code: uniq("C-"), name: "değişti", kind: "CUSTOMER" })],
  ["parties.archive setPartyArchived", () => setPartyArchived(who(), { id: partyA.id, expectedVersion: partyA.version, archived: true })],
  // Depolar
  ["warehouses.create createWarehouse", () => createWarehouse(who(), { code: uniq("W-"), name: "x" })],
  ["warehouses.create suggestCode", () => suggestCode(who(), { kind: "warehouse" })],
  ["warehouses.edit renameWarehouse (kod)", () => renameWarehouse(who(), { warehouseId: A.warehouseId, code: uniq("W-") })],
  ["warehouses.archive archiveWarehouse", () => archiveWarehouse(who(), { warehouseId: extraWarehouseA })],
  // Raf yerleri
  ["locations.create createLocation", () => createLocation(who(), { warehouseId: A.warehouseId, parentId: A.rootLocationId, code: uniq("L-"), name: "x", kind: "STORAGE" })],
  ["locations.create suggestCode", () => suggestCode(who(), { kind: "location", warehouseId: A.warehouseId })],
  ["locations.create previewBulkLocations", () => previewBulkLocations(who(), { warehouseId: A.warehouseId, parentId: A.rootLocationId, zone: "Z", rackFrom: 1, rackTo: 1, levelFrom: 1, levelTo: 1 })],
  ["locations.create createBulkLocations", () => createBulkLocations(who(), { warehouseId: A.warehouseId, parentId: A.rootLocationId, zone: "Z", rackFrom: 1, rackTo: 1, levelFrom: 1, levelTo: 1, idempotencyKey: randomUUID() })],
  ["locations.edit renameLocation (kod)", () => renameLocation(who(), { locationId: leafLocationA, code: uniq("L-") })],
  ["locations.edit setLocationKind", () => setLocationKind(who(), { locationId: leafLocationA, kind: "RECEIVING" })],
  ["locations.archive archiveLocation", () => archiveLocation(who(), { locationId: leafLocationA })],
];

describe("T-1141 kart yazma yetkileri", () => {
  it("yetkisiz yönetici (WAREHOUSE_MANAGER + bütün ek grup yetkileri) her kart yazmasında FORBIDDEN; satır ve audit değişmez", async () => {
    const before = await snapshot(A.tenantId);
    for (const [name, call] of forbiddenCalls(manager)) {
      const e = await failure(call());
      expect(e.code, name).toBe("FORBIDDEN");
      expect(e.detail, name).toBeUndefined();
    }
    expect(await snapshot(A.tenantId)).toBe(before);
    const audit = await adm.query<{ n: string }>("SELECT count(*) AS n FROM public.audit_logs WHERE tenant_id = $1 AND actor_user_id = $2", [A.tenantId, managerUserId]);
    expect(Number(audit.rows[0]?.n)).toBe(0);
  });

  it("toplayıcı (PICKER) da aynı: FORBIDDEN, yazım yok", async () => {
    const before = await snapshot(A.tenantId);
    for (const [name, call] of forbiddenCalls(() => picker(A))) expect((await failure(call())).code, name).toBe("FORBIDDEN");
    expect(await snapshot(A.tenantId)).toBe(before);
  });

  it("veritabanı gruba kart anahtarı verdirmez (0051 kapalı liste; T-1142 yetki ekranı işine kadar)", async () => {
    await expect(
      adm.query("INSERT INTO public.permission_groups (tenant_id, name, grants, created_by) VALUES ($1, 'Kaçak kart', ARRAY['items.create'], $2)", [A.tenantId, A.ownerMembershipId]),
    ).rejects.toThrow(/permission_groups_grants_chk/);
  });

  it("hesap sahibi (TENANT_ADMIN) aynı işlemleri yapabilir — erişim kaybı yok", async () => {
    const itemId = (await createItem(admin(A), { code: uniq("I-"), name: "sahip", baseUnitId: A.unitId })).itemId;
    expect((await updateItem(admin(A), { itemId, name: "sahip 2" })).changed).toBe(true);
    expect((await archiveItem(admin(A), { itemId })).changed).toBe(true);
    const p = await saveParty(admin(A), { code: uniq("C-"), name: "sahip cari", kind: "SUPPLIER" });
    if (!p.ok) throw new Error("party");
    const archived = await setPartyArchived(admin(A), { id: p.id, expectedVersion: p.version, archived: true });
    await setPartyArchived(admin(A), { id: p.id, expectedVersion: archived.version, archived: false });
    const wh = (await createWarehouse(admin(A), { code: uniq("W-"), name: "sahip depo" })).warehouseId;
    expect((await renameWarehouse(admin(A), { warehouseId: wh, name: "sahip depo 2" })).changed).toBe(true);
    const loc = (await createLocation(admin(A), { warehouseId: wh, parentId: null, code: uniq("L-"), name: "sahip raf", kind: "STORAGE" })).locationId;
    expect((await renameLocation(admin(A), { locationId: loc, name: "sahip raf 2" })).changed).toBe(true);
    expect((await archiveLocation(admin(A), { locationId: loc })).archived).toBe(true);
    expect((await archiveWarehouse(admin(A), { warehouseId: wh })).archived).toBe(true);
  });

  it("çapraz tenant: A'nın hesap sahibi B'nin kartlarına yazamaz (NOT_FOUND), B değişmez (I-01/I-02)", async () => {
    const before = await snapshot(B.tenantId);
    expect((await failure(updateItem(admin(A), { itemId: B.itemId, name: "sızma" }))).code).toBe("NOT_FOUND");
    expect((await failure(archiveItem(admin(A), { itemId: B.itemTwoId }))).code).toBe("NOT_FOUND");
    expect((await failure(saveParty(admin(A), { id: partyB.id, expectedVersion: partyB.version, code: uniq("C-"), name: "sızma", kind: "CUSTOMER" }))).code).toBe("NOT_FOUND");
    const arch = await failure(setPartyArchived(admin(A), { id: partyB.id, expectedVersion: partyB.version, archived: true }));
    expect(["NOT_FOUND", "VERSION_CONFLICT"]).toContain(arch.code);
    expect((await failure(renameWarehouse(admin(A), { warehouseId: B.warehouseId, name: "sızma" }))).code).toBe("NOT_FOUND");
    expect((await failure(renameLocation(admin(A), { locationId: B.childLocationId, name: "sızma" }))).code).toBe("NOT_FOUND");
    expect((await failure(archiveLocation(admin(A), { locationId: B.childLocationId }))).code).toBe("NOT_FOUND");
    expect(await snapshot(B.tenantId)).toBe(before);
  });
});
