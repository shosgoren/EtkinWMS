// T-1201 (kullanıcı kararı 1 Kasım 2026): "Paraşüt'ten al" seçili bölümde Etkin Paraşüt'e uyar, buradan gitmez. Gerçek wms_app bağlantısı + RLS.
// Kanıtlar:
//  (1) Bölüm × yön matrisi (ürün / cari / depo × PULL / PUSH / BOTH / kapalı): yeni kart, bağlı kartta Paraşüt alanı, bağlı kartta Etkin'e özgü
//      alan, bağsız yerel kart, arşiv / geri açma. Yalnız PULL'da reddedilir (`SOURCE_MANAGED_CREATE|FIELD|ARCHIVE`), red hiçbir satır ve audit
//      yazmaz; diğer yönlerde her şey bugünkü gibi açık.
//  (2) Excel: cari / depo aktarımında yeni satır ve bağlı kartın Paraşüt alanı `SOURCE_MANAGED` sorunu (diğer satırlar yazılır); ürün
//      önizlemesi `SOURCE_MANAGED` sorunu verir, uygulama reddedilir. Kurulum şablonunun deposu açılmaz, kabul/sevk yerleri gelen depoya kurulur.
//  (3) Entegrasyonun kendi yazımı (apply.ts, `via: integration`) PULL'da engellenmez: yeni kart açar, bağlı kartın adını günceller.
//  (4) Yarış: yön PULL'a çevrilirken (akış satırı kilitli) komut bekler ve yeni yönü görür.
//  (5) Kiracı yalıtımı (I-01…I-03): A'nın PULL'u B'yi etkilemez; B'nin ekran okuması A'nın kartının bağlılığını göremez.
//  (7) İnceleme MINOR-1: ilk eşleme (apply.ts `link`) kart satırını kilitleyip etkinliği yeniden denetler; kullanıcı komutu kart satırını
//      bağlılık okumasından ÖNCE kilitler → açık bir eşleme varken arşiv bekler ve eşleme commit olunca reddedilir (bağlı + arşivli kart
//      oluşmaz); önce arşivlenen kart eşlenmez. Örnek veri temizliği bağlı kartlara dokunmaz.
//  (6) T-1141 ile birlikte: yetkisiz üye önce FORBIDDEN alır (kaynak kuralı yetki sızdırmaz); bağlantı kesilince kural kalkar.
import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient, withSystemTenant } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { AppError } from "../../../packages/shared/src/errors.ts";
import { archiveItem, createItem, createItemWithDefaultUnit, setUnitConversion, updateItem } from "../../../packages/domain/src/catalog/index.ts";
import { importParties, saveParty, setPartyArchived } from "../../../packages/domain/src/catalog/parties.ts";
import { archiveWarehouse, createLocation, createWarehouse, renameWarehouse } from "../../../packages/domain/src/warehouse/index.ts";
import { importWarehouses } from "../../../packages/domain/src/onboarding/master-import.ts";
import { applyImportChunk, previewImport } from "../../../packages/domain/src/onboarding/import-apply.ts";
import { applyLocationsStep } from "../../../packages/domain/src/onboarding/stock-setup.ts";
import { clearSampleData } from "../../../packages/domain/src/onboarding/sample-data.ts";
import { applyContact, applyProduct, applyWarehouse, link as linkRef } from "../../../packages/domain/src/integrations/apply.ts";
import { getSourceLinkedIds, getSourceLock } from "../../../packages/domain/src/integrations/source-guard.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";

const env = readIntEnv(process.env);
const reg = newRegistry();
let app: DbClient;
let adm: pg.Client;

type Dir = "PULL" | "PUSH" | "BOTH" | "LOCAL";
const DIRS: readonly Dir[] = ["PULL", "PUSH", "BOTH", "LOCAL"];
const FLOWS = ["PRODUCTS", "CONTACTS", "WAREHOUSES"] as const;

beforeAll(async () => {
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  await adm.connect();
}, 120_000);

afterAll(async () => {
  await adm?.end();
  await app?.close();
}, 120_000);

const admin = (w: TenantWorld) => ({ db: app, principal: { userId: w.ownerUserId, mfaVerified: true }, tenantSlug: w.slug, recentAuth: async () => undefined });
const picker = (w: TenantWorld) => ({ db: app, principal: { userId: w.memberUserId, mfaVerified: true }, tenantSlug: w.slug });
const uniq = (p: string): string => `${p}-${randomUUID().slice(0, 8)}`.toUpperCase();
async function q<T extends pg.QueryResultRow = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await adm.query<T>(text, params)).rows;
}
async function failure(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return e as AppError;
  }
  throw new Error("expected rejection");
}
const auditCount = async (w: TenantWorld): Promise<number> => Number((await q<{ n: string }>("SELECT count(*)::text AS n FROM public.audit_logs WHERE tenant_id = $1", [w.tenantId]))[0]?.n);

/** Bağlı Paraşüt entegrasyonu + üç kart akışı (sentetik; ağ yok). */
async function world(label: string): Promise<{ w: TenantWorld; integrationId: string }> {
  const w = await seedWorld(adm, reg, label);
  const integrationId = randomUUID();
  await adm.query(
    "INSERT INTO public.integrations (tenant_id, id, provider, status, account_ref, connected_by, connected_membership_id, connected_at, credentials) VALUES ($1, $2, 'PARASUT', 'CONNECTED', '115', $3, $4, now(), $5::jsonb)",
    [w.tenantId, integrationId, w.ownerUserId, w.ownerMembershipId, JSON.stringify({ v: 2, kid: "synthetic", iv: "synthetic", tag: "synthetic", ct: "synthetic" })],
  );
  for (const f of FLOWS) await adm.query("INSERT INTO public.integration_flows (tenant_id, integration_id, flow, direction, enabled) VALUES ($1, $2, $3, 'PULL', false)", [w.tenantId, integrationId, f]);
  return { w, integrationId };
}
async function setDir(w: TenantWorld, flow: (typeof FLOWS)[number], dir: Dir): Promise<void> {
  await adm.query("UPDATE public.integration_flows SET enabled = $3, direction = $4 WHERE tenant_id = $1 AND flow = $2", [w.tenantId, flow, dir !== "LOCAL", dir === "LOCAL" ? "PULL" : dir]);
}
const link = (w: TenantWorld, type: "ITEM" | "PARTY" | "WAREHOUSE", id: string) =>
  adm.query("INSERT INTO public.external_refs (tenant_id, system, entity_type, entity_id, external_id) VALUES ($1, 'PARASUT', $2, $3, $4)", [w.tenantId, type, id, randomUUID().slice(0, 12)]);
async function item(w: TenantWorld, linked: boolean): Promise<{ id: string; code: string }> {
  const code = uniq("URN");
  const id = (await q<{ id: string }>("INSERT INTO public.items (tenant_id, code, name, base_unit_id) VALUES ($1, $2, $2, $3) RETURNING id", [w.tenantId, code, w.unitId]))[0]!.id;
  if (linked) await link(w, "ITEM", id);
  return { id, code };
}
async function party(w: TenantWorld, linked: boolean): Promise<{ id: string; code: string; version: number }> {
  const code = uniq("CAR");
  const r = (await q<{ id: string; version: number }>("INSERT INTO public.parties (tenant_id, code, code_key, name, phone, created_by) VALUES ($1, $2, upper($2), 'Acme', '0212 555 11 22', $3) RETURNING id, version", [w.tenantId, code, w.ownerMembershipId]))[0]!;
  if (linked) await link(w, "PARTY", r.id);
  return { id: r.id, code, version: Number(r.version) };
}
async function warehouse(w: TenantWorld, linked: boolean): Promise<{ id: string; code: string }> {
  const code = uniq("DP");
  const id = (await q<{ id: string }>("INSERT INTO public.warehouses (tenant_id, code, name) VALUES ($1, $2, 'Depo') RETURNING id", [w.tenantId, code]))[0]!.id;
  if (linked) await link(w, "WAREHOUSE", id);
  return { id, code };
}
const partyVersion = async (id: string): Promise<number> => Number((await q<{ v: number }>("SELECT version AS v FROM public.parties WHERE id = $1", [id]))[0]?.v);

describe("(1) bölüm × yön matrisi", () => {
  it.each(DIRS)("ürün kartları — %s", async (dir) => {
    const { w } = await world(`SG-I-${dir}`);
    await setDir(w, "PRODUCTS", dir);
    const pull = dir === "PULL";
    const linked = await item(w, true);
    const local = await item(w, false);
    // Yeni kart (iki yol: birimli ve varsayılan birimli).
    if (pull) {
      const before = await auditCount(w);
      expect(await failure(createItem(admin(w), { code: uniq("YENI"), name: "Yeni", baseUnitId: w.unitId }))).toMatchObject({ code: "VALIDATION_FAILED", detail: "SOURCE_MANAGED_CREATE" });
      expect(await failure(createItemWithDefaultUnit(admin(w), { code: uniq("YENI"), name: "Yeni" }))).toMatchObject({ detail: "SOURCE_MANAGED_CREATE" });
      expect(await auditCount(w)).toBe(before);
    } else {
      await createItem(admin(w), { code: uniq("YENI"), name: "Yeni", baseUnitId: w.unitId });
    }
    // Bağlı kart: ad ve kod Paraşüt'ün.
    if (pull) {
      expect(await failure(updateItem(admin(w), { itemId: linked.id, name: "Yerel ad" }))).toMatchObject({ detail: "SOURCE_MANAGED_FIELD" });
      expect(await failure(updateItem(admin(w), { itemId: linked.id, code: uniq("YK") }))).toMatchObject({ detail: "SOURCE_MANAGED_FIELD" });
      expect((await q<{ name: string; code: string }>("SELECT name, code FROM public.items WHERE id = $1", [linked.id]))[0]).toEqual({ name: linked.code, code: linked.code });
    } else {
      expect(await updateItem(admin(w), { itemId: linked.id, name: "Yerel ad" })).toMatchObject({ changed: true });
    }
    // Bağlı kartta Etkin'e özgü alanlar her yönde açık (toplama kuralı, kart türü, takip/hassasiyet, birim dönüşümü); aynı adı göndermek de serbest.
    expect(await updateItem(admin(w), { itemId: linked.id, pickPolicy: "FEFO", cardType: "HM", trackingMode: "LOT", quantityScale: 2 })).toMatchObject({ changed: true });
    if (pull) expect(await updateItem(admin(w), { itemId: linked.id, name: linked.code })).toMatchObject({ changed: false });
    expect(await setUnitConversion(admin(w), { itemId: linked.id, unitId: w.boxUnitId, factor: "12" })).toMatchObject({ factor: expect.any(String) });
    // Bağsız yerel kart her yönde açık.
    expect(await updateItem(admin(w), { itemId: local.id, name: "Yerel kart", code: uniq("LK") })).toMatchObject({ changed: true });
    // Arşiv: bağlı kart PULL'da Paraşüt'ten gelir; bağsız kart arşivlenir.
    if (pull) expect(await failure(archiveItem(admin(w), { itemId: linked.id }))).toMatchObject({ detail: "SOURCE_MANAGED_ARCHIVE" });
    else expect(await archiveItem(admin(w), { itemId: linked.id })).toMatchObject({ changed: true });
    expect(await archiveItem(admin(w), { itemId: local.id })).toMatchObject({ changed: true });
  });

  it.each(DIRS)("cariler — %s", async (dir) => {
    const { w } = await world(`SG-P-${dir}`);
    await setDir(w, "CONTACTS", dir);
    const pull = dir === "PULL";
    const linked = await party(w, true);
    const local = await party(w, false);
    const newOne = await saveParty(admin(w), { code: uniq("YC"), name: "Yeni cari" }).catch((e: unknown) => e);
    if (pull) expect(newOne).toMatchObject({ code: "VALIDATION_FAILED", detail: "SOURCE_MANAGED_CREATE" });
    else expect(newOne).toMatchObject({ ok: true });
    // Bağlı caride her Paraşüt alanı tek tek kilitli (PULL); aynı değerleri (biçim farkıyla) göndermek serbest; teslimat açık.
    const same = { id: linked.id, code: linked.code, name: "Acme", phone: "0212 555 11 22" };
    const owned: readonly Record<string, string>[] = [{ name: "Acme Yerel" }, { code: uniq("YC") }, { kind: "SUPPLIER" }, { taxNo: "1234567890" }, { taxOffice: "Kadıköy" }, { phone: "0216 000 00 00" }, { email: "a@b.co" }, { city: "İzmir" }, { district: "Bornova" }, { address: "Cad. 1" }, { shortName: "AC" }];
    for (const patch of owned) {
      const r = saveParty(admin(w), { ...same, ...patch, expectedVersion: await partyVersion(linked.id) });
      if (pull) expect(await failure(r), JSON.stringify(patch)).toMatchObject({ detail: "SOURCE_MANAGED_FIELD" });
      else {
        expect(await r).toMatchObject({ ok: true });
        await adm.query("UPDATE public.parties SET code = $2, code_key = upper($2), name = 'Acme', kind = 'CUSTOMER', tax_no = NULL, tax_office = NULL, phone = '0212 555 11 22', email = NULL, city = NULL, district = NULL, address = NULL, short_name = NULL WHERE id = $1", [linked.id, linked.code]);
      }
    }
    expect(await saveParty(admin(w), { ...same, phone: "  0212 555 11 22 ", deliveryMode: "CARRIER", expectedVersion: await partyVersion(linked.id) })).toMatchObject({ ok: true });
    expect((await q<{ delivery_mode: string }>("SELECT delivery_mode FROM public.parties WHERE id = $1", [linked.id]))[0]?.delivery_mode).toBe("CARRIER");
    expect(await saveParty(admin(w), { id: local.id, code: local.code, name: "Yerel Yeni", expectedVersion: local.version })).toMatchObject({ ok: true });
    // Arşiv ve geri açma.
    const arch = setPartyArchived(admin(w), { id: linked.id, expectedVersion: await partyVersion(linked.id), archived: true });
    if (pull) {
      expect(await failure(arch)).toMatchObject({ detail: "SOURCE_MANAGED_ARCHIVE" });
      await adm.query("UPDATE public.parties SET archived_at = now() WHERE id = $1", [linked.id]); // Paraşüt yaşam döngüsü arşivledi
      expect(await failure(setPartyArchived(admin(w), { id: linked.id, expectedVersion: await partyVersion(linked.id), archived: false }))).toMatchObject({ detail: "SOURCE_MANAGED_ARCHIVE" });
    } else {
      await arch;
      await setPartyArchived(admin(w), { id: linked.id, expectedVersion: await partyVersion(linked.id), archived: false });
    }
    await setPartyArchived(admin(w), { id: local.id, expectedVersion: await partyVersion(local.id), archived: true });
  });

  it.each(DIRS)("depolar — %s (raf yerleri her yönde açık)", async (dir) => {
    const { w } = await world(`SG-W-${dir}`);
    await setDir(w, "WAREHOUSES", dir);
    const pull = dir === "PULL";
    const linked = await warehouse(w, true);
    const local = await warehouse(w, false);
    const created = createWarehouse(admin(w), { code: uniq("YD"), name: "Yeni depo" });
    if (pull) expect(await failure(created)).toMatchObject({ detail: "SOURCE_MANAGED_CREATE" });
    else await created;
    if (pull) {
      expect(await failure(renameWarehouse(admin(w), { warehouseId: linked.id, name: "Yerel" }))).toMatchObject({ detail: "SOURCE_MANAGED_FIELD" });
      expect(await failure(renameWarehouse(admin(w), { warehouseId: linked.id, code: uniq("YK") }))).toMatchObject({ detail: "SOURCE_MANAGED_FIELD" });
      expect(await renameWarehouse(admin(w), { warehouseId: linked.id, name: "Depo" })).toEqual({ changed: false });
    } else expect(await renameWarehouse(admin(w), { warehouseId: linked.id, name: "Yerel" })).toEqual({ changed: true });
    // Raf yeri Etkin'e özgüdür: bağlı depoda da açılır.
    const loc = await createLocation(admin(w), { warehouseId: linked.id, parentId: null, code: uniq("R"), name: "Raf", kind: "STORAGE" });
    await adm.query("UPDATE public.locations SET status = 'ARCHIVED', archived_at = now() WHERE id = $1", [loc.locationId]);
    expect(await renameWarehouse(admin(w), { warehouseId: local.id, name: "Yerel depo", code: uniq("LD") })).toEqual({ changed: true });
    if (pull) expect(await failure(archiveWarehouse(admin(w), { warehouseId: linked.id }))).toMatchObject({ detail: "SOURCE_MANAGED_ARCHIVE" });
    else expect(await archiveWarehouse(admin(w), { warehouseId: linked.id })).toEqual({ archived: true });
    expect(await archiveWarehouse(admin(w), { warehouseId: local.id })).toEqual({ archived: true });
  });
});

describe("(2) Excel ve kurulum yolları", () => {
  it("cari aktarımı: PULL'da yeni satır ve bağlı carinin Paraşüt alanı SOURCE_MANAGED; teslimat ve bağsız cari yazılır; BOTH'ta açılır", async () => {
    const { w } = await world("SG-XP");
    await setDir(w, "CONTACTS", "PULL");
    const linked = await party(w, true);
    const local = await party(w, false);
    const rows = [
      { row: 2, code: uniq("XN"), name: "Yeni" },
      { row: 3, code: linked.code, name: "Başka ad" },
      { row: 4, code: linked.code, deliveryMode: "kargo" },
      { row: 5, code: local.code, name: "Yerel değişti" },
    ];
    const dry = await importParties(admin(w), { rows: [rows[0]!, rows[1]!, rows[3]!], dryRun: true });
    expect(dry.rows.map((r) => [r.row, r.status, r.issue ?? null])).toEqual([[2, "INVALID", "SOURCE_MANAGED"], [3, "INVALID", "SOURCE_MANAGED"], [5, "UPDATED", null]]);
    const real = await importParties(admin(w), { rows: [rows[0]!, rows[3]!], dryRun: false });
    expect(real).toMatchObject({ created: 0, updated: 1, invalid: 1 });
    expect(await importParties(admin(w), { rows: [rows[2]!], dryRun: false })).toMatchObject({ updated: 1 });
    expect((await q<{ name: string; delivery_mode: string }>("SELECT name, delivery_mode FROM public.parties WHERE id = $1", [linked.id]))[0]).toEqual({ name: "Acme", delivery_mode: "CARRIER" });
    await setDir(w, "CONTACTS", "BOTH");
    expect(await importParties(admin(w), { rows: [rows[0]!], dryRun: false })).toMatchObject({ created: 1 });
  });

  it("depo aktarımı: PULL'da yeni depo ve bağlı deponun adı SOURCE_MANAGED (kontrol ve yazım aynı); LOCAL'de açılır", async () => {
    const { w } = await world("SG-XW");
    await setDir(w, "WAREHOUSES", "PULL");
    const linked = await warehouse(w, true);
    const local = await warehouse(w, false);
    const rows = [
      { row: 2, code: uniq("XD"), name: "Yeni depo" },
      { row: 3, code: linked.code, name: "Başka ad" },
      { row: 4, code: local.code, name: "Yerel ad" },
    ];
    for (const dryRun of [true, false]) {
      const r = await importWarehouses(admin(w), { rows, dryRun, update: true });
      expect(r.rows.map((x) => [x.row, x.status, x.issue ?? null])).toEqual([[2, "INVALID", "SOURCE_MANAGED"], [3, "INVALID", "SOURCE_MANAGED"], [4, "UPDATED", null]]);
    }
    await setDir(w, "WAREHOUSES", "LOCAL");
    expect(await importWarehouses(admin(w), { rows: [rows[0]!], dryRun: false, update: false })).toMatchObject({ created: 1 });
  });

  it("ürün aktarımı: PULL'da yeni kod ve bağlı ürünün adı önizlemede SOURCE_MANAGED, uygulama reddedilir; BOTH'ta uygulanır", async () => {
    const { w } = await world("SG-XI");
    await setDir(w, "PRODUCTS", "PULL");
    const unit = (await q<{ code: string }>("SELECT code FROM public.units WHERE id = $1", [w.unitId]))[0]!.code;
    const linked = await item(w, true);
    const newCode = uniq("XI");
    const csv = `kod;ad;temel birim\r\n${newCode};Yeni ürün;${unit}\r\n${linked.code};Başka ad;${unit}\r\n`;
    const pre = await previewImport(admin(w), csv);
    expect(pre.issues.filter((i) => i.code === "SOURCE_MANAGED").map((i) => i.row)).toEqual([2]);
    const upd = await previewImport(admin(w), csv, { update: true });
    expect(upd.issues.filter((i) => i.code === "SOURCE_MANAGED").map((i) => [i.row, i.column])).toEqual([[2, "kod"], [3, "ad"]]);
    expect(upd.chunkCount).toBe(0);
    // Paraşüt ayarı önizleme ile uygulama arasında PULL'a döndüyse uygulama reddedilir (önizleme özetiyle bile).
    await setDir(w, "PRODUCTS", "BOTH");
    const ok = await previewImport(admin(w), csv);
    expect(ok.issues).toEqual([]);
    await setDir(w, "PRODUCTS", "PULL");
    expect(await failure(applyImportChunk(admin(w), { text: csv, chunk: 0, digest: ok.digest }))).toMatchObject({ code: "VALIDATION_FAILED", detail: "SOURCE_MANAGED_CREATE" });
    expect((await q("SELECT 1 FROM public.items WHERE tenant_id = $1 AND code = $2", [w.tenantId, newCode])).length).toBe(0);
    await setDir(w, "PRODUCTS", "BOTH");
    expect(await applyImportChunk(admin(w), { text: csv, chunk: 0, digest: ok.digest })).toMatchObject({ complete: true, counts: { CREATED: 1 } });
  });

  it("kurulum şablonu: depolar Paraşüt'ten geliyorsa D1 açılmaz; kabul/sevk raf yerleri gelen depoya kurulur", async () => {
    const { w } = await world("SG-SETUP");
    await setDir(w, "WAREHOUSES", "PULL");
    const tpl = { setup: { units: [], warehouse: { code: "D1", name: "Ana Depo" }, locations: [{ code: uniq("KABUL"), name: "Kabul", kind: "RECEIVING" as const }] } };
    await adm.query("UPDATE public.warehouses SET code = 'ANA' WHERE id = $1", [w.warehouseId]); // Paraşüt'ten gelen depo (D1 değil)
    const before = await q<{ id: string }>("SELECT id FROM public.warehouses WHERE tenant_id = $1 AND status = 'ACTIVE'", [w.tenantId]);
    const r = await applyLocationsStep({ ...admin(w), requestId: null } as never, tpl as never);
    expect(before.map((x) => x.id)).toContain(r.warehouseId);
    expect((await q("SELECT 1 FROM public.warehouses WHERE tenant_id = $1 AND code = 'D1'", [w.tenantId])).length).toBe(0);
    expect((await q("SELECT 1 FROM public.locations WHERE tenant_id = $1 AND warehouse_id = $2 AND code = $3", [w.tenantId, r.warehouseId, tpl.setup.locations[0]!.code])).length).toBe(1);
    // Hiç depo yoksa adım açıkça reddedilir (önce eşitleme).
    await adm.query("UPDATE public.warehouses SET status = 'ARCHIVED', archived_at = now() WHERE tenant_id = $1", [w.tenantId]);
    expect(await failure(applyLocationsStep({ ...admin(w), requestId: null } as never, tpl as never))).toMatchObject({ detail: "SOURCE_MANAGED_CREATE" });
  });
});

describe("(3) entegrasyonun kendi yazımı PULL'da engellenmez", () => {
  it("apply ürün / cari / depo: yeni kart açar, bağlı kartın Paraşüt alanını günceller (via integration)", async () => {
    const { w } = await world("SG-SYNC");
    for (const f of FLOWS) await setDir(w, f, "PULL");
    const ac = { tenantId: w.tenantId, system: "PARASUT", actorUserId: w.ownerUserId, membershipId: w.ownerMembershipId };
    const unit = (await q<{ code: string }>("SELECT code FROM public.units WHERE id = $1", [w.unitId]))[0]!.code;
    const out = await withSystemTenant(app, w.tenantId, "test.source_guard", async (tx) => [
      await applyProduct(tx, ac, { externalId: "P1", code: uniq("PRS"), name: "Paraşüt ürünü", unit }),
      await applyProduct(tx, ac, { externalId: "P1", code: null, name: "Paraşüt ürünü 2", unit }),
      await applyContact(tx, ac, { externalId: "C1", name: "Paraşüt cari", accountType: "customer", taxNumber: null, taxOffice: null, email: null, phone: null, city: "Ankara", address: null }),
      await applyContact(tx, ac, { externalId: "C1", name: "Paraşüt cari 2", accountType: "customer", taxNumber: null, taxOffice: null, email: null, phone: null, city: "Ankara", address: null }),
      await applyWarehouse(tx, ac, { externalId: "W1", name: "Paraşüt depo", archived: false }),
      await applyWarehouse(tx, ac, { externalId: "W1", name: "Paraşüt depo 2", archived: false }),
    ]);
    expect(out).toEqual(["CREATED", "UPDATED", "CREATED", "UPDATED", "CREATED", "UPDATED"]);
    const via = await q<{ action: string }>("SELECT action FROM public.audit_logs WHERE tenant_id = $1 AND change_summary->>'via' = 'integration' AND action IN ('item.created','item.updated','party.created','party.updated','warehouse.created','warehouse.updated') ORDER BY action", [w.tenantId]);
    expect(via.map((r) => r.action)).toEqual(["item.created", "item.updated", "party.created", "party.updated", "warehouse.created", "warehouse.updated"]);
  });
});

describe("(4) yarış: yön değişikliği", () => {
  it("yön PULL'a çevrilirken (akış satırı kilitli) yeni kart komutu bekler ve yeni yönü görür; BOTH'a dönüşte açılır", async () => {
    const { w } = await world("SG-RACE");
    await setDir(w, "PRODUCTS", "BOTH");
    const locker = new pg.Client({ connectionString: env.databaseUrlDirect });
    await locker.connect();
    try {
      await locker.query("BEGIN");
      await locker.query("UPDATE public.integration_flows SET direction = 'PULL' WHERE tenant_id = $1 AND flow = 'PRODUCTS'", [w.tenantId]);
      let settled = false;
      const p = createItem(admin(w), { code: uniq("YARIS"), name: "Yarış", baseUnitId: w.unitId }).finally(() => {
        settled = true;
      });
      p.catch(() => undefined);
      await new Promise((r) => setTimeout(r, 400));
      expect(settled).toBe(false); // FOR SHARE yön değişikliğinin satır kilidini bekliyor
      await locker.query("COMMIT");
      expect(await failure(p)).toMatchObject({ detail: "SOURCE_MANAGED_CREATE" });
      // Ters yön: komut kilidi tutarken yön değişikliği bekler (komut kısa; yalnız sonucun tutarlılığı sınanır).
      await locker.query("BEGIN");
      await locker.query("UPDATE public.integration_flows SET direction = 'BOTH' WHERE tenant_id = $1 AND flow = 'PRODUCTS'", [w.tenantId]);
      const q2 = createItem(admin(w), { code: uniq("YARIS"), name: "Yarış 2", baseUnitId: w.unitId });
      await new Promise((r) => setTimeout(r, 200));
      await locker.query("COMMIT");
      expect(await q2).toMatchObject({ itemId: expect.any(String) });
    } finally {
      await locker.end();
    }
  });
});

describe("(4b) alma sayfası ile kart komutu kilitlenmesi (inceleme @ fe3f925)", () => {
  it("sayfa akışı FOR NO KEY UPDATE alır, kartı kilitler, imleci günceller: eşzamanlı updateItem / saveParty 40P01 almaz, sayfa commit olunca biter", async () => {
    const { w } = await world("SG-PAGE");
    await setDir(w, "PRODUCTS", "PULL");
    await setDir(w, "CONTACTS", "PULL");
    const it1 = await item(w, true);
    const p1 = await party(w, true);
    for (const [flow, table, id, command] of [
      ["PRODUCTS", "items", it1.id, () => updateItem(admin(w), { itemId: it1.id, pickPolicy: "FEFO" })],
      ["CONTACTS", "parties", p1.id, async () => saveParty(admin(w), { id: p1.id, code: p1.code, name: "Acme", phone: "0212 555 11 22", deliveryMode: "CARRIER", expectedVersion: await partyVersion(p1.id) })],
    ] as const) {
      const page = new pg.Client({ connectionString: env.databaseUrlDirect });
      await page.connect();
      try {
        // sync.ts pull sayfası: guardFlow inTenantPage (akış FOR NO KEY UPDATE) → kart satırı (apply / lockActiveCard) → imleç UPDATE.
        await page.query("BEGIN");
        await page.query("SELECT 1 FROM public.integration_flows WHERE tenant_id = $1 AND flow = $2 FOR NO KEY UPDATE", [w.tenantId, flow]);
        await page.query(`SELECT 1 FROM public.${table} WHERE tenant_id = $1 AND id = $2 FOR NO KEY UPDATE`, [w.tenantId, id]);
        let settled = false;
        const r = (command as () => Promise<unknown>)().finally(() => {
          settled = true;
        });
        r.catch(() => undefined);
        await new Promise((res) => setTimeout(res, 400));
        expect(settled).toBe(false); // komut akış satırında sayfanın arkasında bekliyor (kart kilidine hiç ulaşmadı)
        await page.query("UPDATE public.integration_flows SET cursor = '2' WHERE tenant_id = $1 AND flow = $2", [w.tenantId, flow]);
        // deadlock_timeout (1 sn) geçsin: döngü olsaydı PostgreSQL bir tarafı 40P01 ile keserdi.
        await new Promise((res) => setTimeout(res, 1500));
        await page.query("COMMIT");
        await expect(r).resolves.toBeDefined();
      } finally {
        await page.end();
      }
    }
    expect((await q<{ pick_policy: string }>("SELECT pick_policy FROM public.items WHERE id = $1", [it1.id]))[0]?.pick_policy).toBe("FEFO");
    expect((await q<{ delivery_mode: string }>("SELECT delivery_mode FROM public.parties WHERE id = $1", [p1.id]))[0]?.delivery_mode).toBe("CARRIER");
  });
});

describe("(5) kiracı yalıtımı", () => {
  it("A'nın PULL'u B'yi etkilemez; B'nin okuması A'nın kartının bağlılığını görmez", async () => {
    const { w: A } = await world("SG-TA");
    const { w: B } = await world("SG-TB");
    for (const f of FLOWS) await setDir(A, f, "PULL");
    const aItem = await item(A, true);
    await createItem(admin(B), { code: uniq("B"), name: "B ürünü", baseUnitId: B.unitId });
    await createWarehouse(admin(B), { code: uniq("BD"), name: "B depo" });
    expect(await saveParty(admin(B), { code: uniq("BC"), name: "B cari" })).toMatchObject({ ok: true });
    expect(await getSourceLock(admin(A), "ITEM", aItem.id)).toMatchObject({ managed: true, linked: true, provider: "PARASUT", canSync: true });
    expect(await getSourceLock(admin(B), "ITEM", aItem.id)).toMatchObject({ managed: false, linked: false });
    await setDir(B, "PRODUCTS", "PULL");
    expect(await getSourceLock(admin(B), "ITEM", aItem.id)).toMatchObject({ managed: true, linked: false });
    expect(await getSourceLinkedIds(admin(B), "ITEM", [aItem.id])).toEqual([]);
    expect(await getSourceLinkedIds(admin(A), "ITEM", [aItem.id])).toEqual([aItem.id.toLowerCase()]);
    // A'nın yöneticisi B'nin kartına yazamaz (kaynak kuralından önce NOT_FOUND / kapsam).
    expect((await failure(updateItem(admin(A), { itemId: B.itemId, name: "x" }))).code).toBe("NOT_FOUND");
  });
});

describe("(6) T-1141 yetki ve bağlantı", () => {
  it("yetkisiz üye PULL'da da önce FORBIDDEN alır; ekran okuması eşitlemeyi önermez; bağlantı kesilince kural kalkar", async () => {
    const { w, integrationId } = await world("SG-PERM");
    await setDir(w, "PRODUCTS", "PULL");
    const linked = await item(w, true);
    expect((await failure(createItem(picker(w), { code: uniq("P"), name: "P", baseUnitId: w.unitId }))).code).toBe("FORBIDDEN");
    expect((await failure(archiveItem(picker(w), { itemId: linked.id }))).code).toBe("FORBIDDEN");
    expect(await getSourceLock(picker(w), "ITEM", linked.id)).toMatchObject({ managed: true, linked: true, canSync: false });
    await adm.query("UPDATE public.integrations SET status = 'DISCONNECTED', credentials = NULL WHERE id = $1", [integrationId]);
    expect(await getSourceLock(admin(w), "ITEM", linked.id)).toMatchObject({ managed: false, linked: false });
    expect(await updateItem(admin(w), { itemId: linked.id, name: "Kesik bağlantı" })).toMatchObject({ changed: true });
    await createItem(admin(w), { code: uniq("K"), name: "Kesik", baseUnitId: w.unitId });
  });
});

describe("(7) ilk eşleme ile kullanıcı komutu yarışı (inceleme MINOR-1) ve örnek veri", () => {
  const ac = (w: TenantWorld) => ({ tenantId: w.tenantId, system: "PARASUT", actorUserId: w.ownerUserId, membershipId: w.ownerMembershipId });

  /** `link` transaction'ı açık tutulur; komut başlatılır, beklediği gösterilir, sonra eşleme commit edilir. */
  async function holdLink<T>(w: TenantWorld, doLink: (tx: Parameters<Parameters<typeof withSystemTenant>[3]>[0]) => Promise<string>, command: () => Promise<T>): Promise<{ outcome: string; result: Promise<T> }> {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let linked!: () => void;
    const didLink = new Promise<void>((r) => (linked = r));
    let outcome = "";
    const tx = withSystemTenant(app, w.tenantId, "test.source_guard_race", async (t) => {
      outcome = await doLink(t);
      linked();
      await gate;
    });
    await didLink;
    let settled = false;
    const result = command().finally(() => {
      settled = true;
    });
    result.catch(() => undefined);
    await new Promise((r) => setTimeout(r, 400));
    expect(settled).toBe(false); // kart satırı kilidini bekliyor
    release();
    await tx;
    return { outcome, result };
  }

  it("cari / ürün / depo: açık eşleme varken arşiv bekler, eşleme commit olunca SOURCE_MANAGED_ARCHIVE; kart bağlı ve etkin kalır", async () => {
    const { w } = await world("SG-RACE-LINK");
    for (const f of FLOWS) await setDir(w, f, "PULL");
    const unit = (await q<{ code: string }>("SELECT code FROM public.units WHERE id = $1", [w.unitId]))[0]!.code;

    const p = await party(w, false);
    await adm.query("UPDATE public.parties SET tax_no = '9990001112' WHERE id = $1", [p.id]);
    const rp = await holdLink(
      w,
      (t) => applyContact(t, ac(w), { externalId: "RC1", name: "Acme", accountType: "customer", taxNumber: "9990001112", taxOffice: null, email: null, phone: null, city: null, address: null }),
      async () => setPartyArchived(admin(w), { id: p.id, expectedVersion: await partyVersion(p.id), archived: true }),
    );
    expect(rp.outcome).toBe("LINKED");
    expect(await failure(rp.result)).toMatchObject({ detail: "SOURCE_MANAGED_ARCHIVE" });
    expect((await q<{ archived: boolean }>("SELECT archived_at IS NOT NULL AS archived FROM public.parties WHERE id = $1", [p.id]))[0]?.archived).toBe(false);

    const i = await item(w, false);
    const ri = await holdLink(w, (t) => applyProduct(t, ac(w), { externalId: "RI1", code: i.code, name: i.code, unit }), () => archiveItem(admin(w), { itemId: i.id }));
    expect(ri.outcome).toBe("LINKED");
    expect(await failure(ri.result)).toMatchObject({ detail: "SOURCE_MANAGED_ARCHIVE" });
    expect((await q<{ status: string }>("SELECT status FROM public.items WHERE id = $1", [i.id]))[0]?.status).toBe("ACTIVE");

    const wh = await warehouse(w, false);
    const wname = uniq("Yaris Depo");
    await adm.query("UPDATE public.warehouses SET name = $2 WHERE id = $1", [wh.id, wname]);
    const rw = await holdLink(w, (t) => applyWarehouse(t, ac(w), { externalId: "RW1", name: wname, archived: false }), () => archiveWarehouse(admin(w), { warehouseId: wh.id }));
    expect(rw.outcome).toBe("LINKED");
    expect(await failure(rw.result)).toMatchObject({ detail: "SOURCE_MANAGED_ARCHIVE" });
    // Düzenleme de aynı sırayla: açık eşlemeyi bekler ve Paraşüt alanını reddeder.
    const p2 = await party(w, false);
    await adm.query("UPDATE public.parties SET tax_no = '9990001113' WHERE id = $1", [p2.id]);
    const re = await holdLink(
      w,
      (t) => applyContact(t, ac(w), { externalId: "RC2", name: "Acme", accountType: "customer", taxNumber: "9990001113", taxOffice: null, email: null, phone: null, city: null, address: null }),
      async () => saveParty(admin(w), { id: p2.id, code: p2.code, name: "Yerel ad", taxNo: "9990001113", phone: "0212 555 11 22", expectedVersion: await partyVersion(p2.id) }),
    );
    expect(await failure(re.result)).toMatchObject({ detail: "SOURCE_MANAGED_FIELD" });
  });

  it("önce arşivlenen kart eşlenmez (kilit altında yeniden denetim): eşleme atlanır, kart yerel ve arşivli kalır", async () => {
    const { w } = await world("SG-LINK-ARCH");
    await setDir(w, "WAREHOUSES", "PULL");
    const wh = await warehouse(w, false);
    const wname = uniq("Arsivli Depo");
    await adm.query("UPDATE public.warehouses SET name = $2 WHERE id = $1", [wh.id, wname]);
    // Eşleme adayı arşivden önce seçilmiş gibi: link'i doğrudan çağır (apply.ts adayı düz SELECT ile seçer).
    expect(await archiveWarehouse(admin(w), { warehouseId: wh.id })).toEqual({ archived: true });
    const r = await withSystemTenant(app, w.tenantId, "test.source_guard_link", (t) => linkRef(t, ac(w), "WAREHOUSE", wh.id, "RW9"));
    expect(r).toBe(false);
    expect((await q("SELECT 1 FROM public.external_refs WHERE tenant_id = $1 AND entity_id = $2", [w.tenantId, wh.id])).length).toBe(0);
  });

  it("örnek veri temizliği Paraşüt'e bağlı örnek karta dokunmaz (silmez, pasife almaz, kalan saymaz)", async () => {
    const { w } = await world("SG-SAMPLE");
    const linkedItem = await item(w, true);
    const freeItem = await item(w, false);
    const linkedWh = await warehouse(w, true);
    const freeWh = await warehouse(w, false);
    await adm.query("UPDATE public.items SET is_sample = true WHERE id = ANY($1::uuid[])", [[linkedItem.id, freeItem.id]]);
    await adm.query("UPDATE public.warehouses SET is_sample = true WHERE id = ANY($1::uuid[])", [[linkedWh.id, freeWh.id]]);
    const r = await clearSampleData(admin(w));
    expect(r.mode).toBe("DELETED");
    expect(r.counts).toMatchObject({ items: 1, warehouses: 1 });
    expect((await q<{ status: string }>("SELECT status FROM public.items WHERE id = $1", [linkedItem.id]))[0]?.status).toBe("ACTIVE");
    expect((await q<{ status: string }>("SELECT status FROM public.warehouses WHERE id = $1", [linkedWh.id]))[0]?.status).toBe("ACTIVE");
    expect((await q("SELECT 1 FROM public.items WHERE id = $1", [freeItem.id])).length).toBe(0);
    expect((await q("SELECT 1 FROM public.warehouses WHERE id = $1", [freeWh.id])).length).toBe(0);
    // Bağlı örnekler "kalan örnek" sayılmaz: ikinci temizlik yapacak bir şey bulmaz.
    expect(await clearSampleData(admin(w))).toMatchObject({ mode: "NONE" });
  });
});
