// T-981b: ekran bazlı Excel dışa aktarma + güncelleme kipi + depo/raf aktarımı. GERÇEK roller (wms_app, pooler); fikstür yalnız DATABASE_URL_DIRECT.
// Kapsam: (1) kiracı yalıtımı — başka kiracının satırı dosyaya girmez, başka kiracının alanında çağrı reddedilir; (2) depo kapsamı — kapsam dışı
// depo/raf/stok görünmez, kapsam dışı depo kimliği NOT_FOUND; (3) yetkisiz üye (aktarım yetkisi yok) FORBIDDEN; kişisel cari alanları yalnız
// settings.manage olana dolu; (4) güncelleme kipi — kod eşleşen ürünün adı güncellenir, yeni kod "atla" ile yazılmaz, stok DEĞİŞMEZ, açılış
// stokunda güncelleme kipi reddedilir; (5) audit — her dışa aktarma `data.exported` (kim, ne, kaç satır).
import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { exportData } from "../../../packages/domain/src/onboarding/data-export.ts";
import { importLocations, importWarehouses } from "../../../packages/domain/src/onboarding/master-import.ts";
import { applyImportChunk, previewImport } from "../../../packages/domain/src/onboarding/import-apply.ts";
import { importParties } from "../../../packages/domain/src/catalog/parties.ts";
import { saveGroup, setMemberGroup } from "../../../packages/domain/src/identity/groups.ts";
import { mkMembership, mkUser, newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";

const env = readIntEnv(process.env);
const reg = newRegistry();
let app: DbClient;
let adm: pg.Client;
let A: TenantWorld;
let B: TenantWorld;
/** Aktarım yetkisi (grup: data.import) olan, depo kapsamı yalnız D1 olan depo yöneticisi. */
let SCOPED: string;
let SCOPED_M: string;
/** Aktarım yetkisi olmayan depo yöneticisi. */
let PLAIN: string;
let W2: string;
let W2_LOC: string;

const recentAuth = async (): Promise<void> => undefined;
const call = (userId: string, w: TenantWorld) => ({ db: app, principal: { userId, mfaVerified: true }, tenantSlug: w.slug, requestId: randomUUID() });

async function withScope<T>(fn: () => Promise<T>): Promise<T> {
  const prior = process.env.WAREHOUSE_SCOPE_ENABLED;
  process.env.WAREHOUSE_SCOPE_ENABLED = "true";
  try {
    return await fn();
  } finally {
    if (prior === undefined) delete process.env.WAREHOUSE_SCOPE_ENABLED;
    else process.env.WAREHOUSE_SCOPE_ENABLED = prior;
  }
}

const auditCount = async (tenantId: string, action: string): Promise<number> =>
  Number((await adm.query<{ n: string }>("SELECT count(*)::text AS n FROM public.audit_logs WHERE tenant_id = $1 AND action = $2", [tenantId, action])).rows[0]?.n ?? 0);

const balanceSum = async (tenantId: string): Promise<string> =>
  (await adm.query<{ s: string }>("SELECT coalesce(sum(quantity), 0)::text AS s FROM public.stock_balances WHERE tenant_id = $1", [tenantId])).rows[0]?.s ?? "0";

beforeAll(async () => {
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  await adm.connect();
  A = await seedWorld(adm, reg, "A981");
  B = await seedWorld(adm, reg, "B981");
  // A'da ikinci depo (W2) + rafı; B'de ayırt edici ürün kodu.
  W2 = randomUUID();
  W2_LOC = randomUUID();
  await adm.query("INSERT INTO public.warehouses (tenant_id, id, code, name) VALUES ($1, $2, 'D2', 'Ikinci Depo')", [A.tenantId, W2]);
  await adm.query("INSERT INTO public.locations (tenant_id, id, warehouse_id, parent_id, code, name, depth, kind) VALUES ($1, $2, $3, NULL, 'GIZLI-RAF', 'Gizli', 0, 'STORAGE')", [A.tenantId, W2_LOC, W2]);
  await adm.query("UPDATE public.items SET code = 'B-ONLY-1' WHERE tenant_id = $1 AND id = $2", [B.tenantId, B.itemTwoId]);
  SCOPED = await mkUser(adm, reg, "A981 scoped");
  SCOPED_M = await mkMembership(adm, A.tenantId, SCOPED, { roles: ["WAREHOUSE_MANAGER"] });
  await adm.query("INSERT INTO public.membership_warehouse_scopes (tenant_id, membership_id, warehouse_id) VALUES ($1, $2, $3)", [A.tenantId, SCOPED_M, A.warehouseId]);
  const g = await saveGroup({ ...call(A.ownerUserId, A), recentAuth, name: "Excel ekibi", color: "#2F7D5B", screens: ["receive"], grants: ["data.import"] });
  if (!g.ok) throw new Error("group");
  await setMemberGroup({ ...call(A.ownerUserId, A), recentAuth, memberId: SCOPED_M, groupId: g.id });
  PLAIN = await mkUser(adm, reg, "A981 plain");
  await mkMembership(adm, A.tenantId, PLAIN, { roles: ["WAREHOUSE_MANAGER"] });
  await importParties(call(A.ownerUserId, A), { dryRun: false, rows: [{ row: 2, code: "C981", name: "Kaya Ltd", phone: "0532 111 22 33", email: "a@kaya.com", city: "İzmir", kind: "tedarikçi" }] });
}, 120_000);

afterAll(async () => {
  await adm.end();
  await app.close();
}, 60_000);

describe("T-981b Excel dışa aktarma", () => {
  it("kiracı yalıtımı: dosyada yalnız kendi kayıtları; başka kiracının alanında çağrı reddedilir; sütunlar şablonla aynı", async () => {
    const items = await exportData(call(A.ownerUserId, A), { kind: "items" });
    expect(items.headers).toEqual(["kod", "ad", "temel birim", "koli içi adet", "adet barkodu", "koli barkodu"]);
    const codes = items.rows.map((r) => r[0]);
    expect(codes).toEqual(expect.arrayContaining(["U1", "U2"]));
    expect(codes).not.toContain("B-ONLY-1");
    // Koli katsayısı Türkçe tam sayı, barkod dolu.
    expect(items.rows.find((r) => r[0] === "U1")).toEqual(["U1", "Urun 1", "ADET", "12", expect.stringMatching(/^BC-/), ""]);
    const wh = await exportData(call(A.ownerUserId, A), { kind: "warehouses" });
    expect(wh.rows.map((r) => r[0]).sort()).toEqual(["D1", "D2"]);
    // B'nin sahibi A'nın alanında dışa aktaramaz (üyelik yok) — varlık sızmaz.
    await expect(exportData(call(B.ownerUserId, A), { kind: "items" })).rejects.toMatchObject({ code: expect.stringMatching(/^(NOT_FOUND|FORBIDDEN)$/) });
    // Başka kiracının deposu kimliğiyle raf dışa aktarma: NOT_FOUND.
    await expect(exportData(call(A.ownerUserId, A), { kind: "locations", warehouseId: B.warehouseId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("depo kapsamı: kapsam dışı depo, rafı ve stoğu görünmez; kapsam dışı depo kimliği NOT_FOUND", async () => {
    await withScope(async () => {
      const wh = await exportData(call(SCOPED, A), { kind: "warehouses" });
      expect(wh.rows.map((r) => r[0])).toEqual(["D1"]);
      const locs = await exportData(call(SCOPED, A), { kind: "locations" });
      expect(locs.rows.map((r) => r[1])).not.toContain("GIZLI-RAF");
      expect(locs.rows.every((r) => r[0] === "D1")).toBe(true);
      // Ağaç sırası: üst raf önce (Z1, sonra Z1-R1 üst raf koduyla).
      expect(locs.rows.find((r) => r[1] === "Z1-R1")).toEqual(["D1", "Z1-R1", "Raf 1", "Z1", "Depolama"]);
      await expect(exportData(call(SCOPED, A), { kind: "locations", warehouseId: W2 })).rejects.toMatchObject({ code: "NOT_FOUND" });
      const stock = await exportData(call(SCOPED, A), { kind: "stock" });
      expect(stock.headers).toEqual(["ürün kodu", "raf kodu", "miktar"]);
      expect(stock.rows.map((r) => r[1])).not.toContain("GIZLI-RAF");
      // Hesap sahibi (TENANT_ADMIN) kapsamdan bağımsız tüm depoları görür.
      expect((await exportData(call(A.ownerUserId, A), { kind: "warehouses" })).rows).toHaveLength(2);
    });
  });

  it("yetkisiz üye FORBIDDEN; kişisel cari alanları yalnız settings.manage olana dolu", async () => {
    await expect(exportData(call(PLAIN, A), { kind: "items" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(exportData(call(A.memberUserId, A), { kind: "parties" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const own = await exportData(call(A.ownerUserId, A), { kind: "parties", q: "C981" });
    expect(own.personalOmitted).toBe(false);
    expect(own.rows).toEqual([["C981", "Kaya Ltd", "", "", "0532 111 22 33", "a@kaya.com", "İzmir", "", "Tedarikçi"]]);
    const grant = await exportData(call(SCOPED, A), { kind: "parties", q: "C981" });
    expect(grant.personalOmitted).toBe(true);
    expect(grant.rows).toEqual([["C981", "Kaya Ltd", "", "", "", "", "İzmir", "", "Tedarikçi"]]);
    // Kişisel alanla arama da yetkisizde eşleşmez (telefon numarasıyla arayıp varlık sorgulanamaz).
    expect((await exportData(call(SCOPED, A), { kind: "parties", q: "0532 111" })).rows).toHaveLength(0);
  });

  it("audit: her dışa aktarma data.exported (kim, tür, kaç satır); arama metni yazılmaz", async () => {
    const before = await auditCount(A.tenantId, "data.exported");
    const r = await exportData(call(A.ownerUserId, A), { kind: "warehouses", q: "Ikinci" });
    expect(r.rows).toHaveLength(1);
    expect(await auditCount(A.tenantId, "data.exported")).toBe(before + 1);
    const last = await adm.query<{ actor: string; cs: Record<string, unknown>; et: string }>(
      "SELECT actor_user_id::text AS actor, change_summary AS cs, entity_type AS et FROM public.audit_logs WHERE tenant_id = $1 AND action = 'data.exported' ORDER BY occurred_at DESC, id DESC LIMIT 1",
      [A.tenantId],
    );
    expect(last.rows[0]).toMatchObject({ actor: A.ownerUserId, et: "warehouses", cs: { kind: "warehouses", rows: 1, truncated: false, search: true } });
    expect(JSON.stringify(last.rows[0]?.cs)).not.toContain("Ikinci");
    // Yetkisiz deneme audit yazmaz.
    await exportData(call(PLAIN, A), { kind: "warehouses" }).catch(() => null);
    expect(await auditCount(A.tenantId, "data.exported")).toBe(before + 1);
  });
});

describe("T-981b güncelleme kipi (Excel)", () => {
  it("ürün: kod eşleşen kaydın adı güncellenir; 'atla' ile yeni kod yazılmaz; stok değişmez; açılış stokunda güncelleme reddedilir", async () => {
    const stockBefore = await balanceSum(A.tenantId);
    const text = "﻿kod;ad;temel birim\r\nU1;Urun 1 Yeni Ad;ADET\r\nYENI-981;Yeni urun;ADET\r\n";
    const mode = { update: true, addMissing: false };
    const p = await previewImport(call(A.ownerUserId, A), text, mode);
    expect(p.issueTotal).toBe(0);
    expect(p.products).toMatchObject({ create: 0, existing: 1, changes: 1, skipped: 1 });
    // Önizleme kipi özete girer: kipsiz uygulama reddedilir (HİÇBİR şey yazılmaz).
    await expect(applyImportChunk(call(A.ownerUserId, A), { text, chunk: 0, digest: p.digest })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const r = await applyImportChunk(call(A.ownerUserId, A), { text, chunk: 0, digest: p.digest, mode });
    expect(r.rows.map((x) => x.status)).toEqual(["UPDATED", "SKIPPED"]);
    const items = await adm.query<{ code: string; name: string }>("SELECT code, name FROM public.items WHERE tenant_id = $1 AND code IN ('U1', 'YENI-981')", [A.tenantId]);
    expect(items.rows).toEqual([{ code: "U1", name: "Urun 1 Yeni Ad" }]);
    expect(await balanceSum(A.tenantId)).toBe(stockBefore);
    // İçeri al kipi (varsayılan) mevcut ürünün adını DEĞİŞTİRMEZ.
    const t2 = "kod;ad\r\nU1;Baska Ad\r\n";
    const p2 = await previewImport(call(A.ownerUserId, A), t2);
    expect(p2.products).toMatchObject({ create: 0, existing: 1, changes: 0 });
    await applyImportChunk(call(A.ownerUserId, A), { text: t2, chunk: 0, digest: p2.digest });
    expect((await adm.query<{ name: string }>("SELECT name FROM public.items WHERE tenant_id = $1 AND code = 'U1'", [A.tenantId])).rows[0]?.name).toBe("Urun 1 Yeni Ad");
    // Açılış stoku dosyasında güncelleme kipi: domain reddeder (stok yalnız belgeyle değişir).
    await expect(previewImport(call(A.ownerUserId, A), "ürün kodu;raf kodu;miktar\r\nU2;Z1-R1;5\r\n", mode)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await balanceSum(A.tenantId)).toBe(stockBefore);
    // Grup yetkili üye (data.import, settings.manage yok) de ürün adını Excel'den güncelleyebilir (T-421 kuralı); yetkisiz üye yazamaz.
    const t3 = "kod;ad\r\nU2;Urun 2 Grup\r\n";
    const p3 = await previewImport(call(SCOPED, A), t3, { update: true, addMissing: true });
    expect((await applyImportChunk(call(SCOPED, A), { text: t3, chunk: 0, digest: p3.digest, mode: { update: true, addMissing: true } })).rows[0]?.status).toBe("UPDATED");
    await expect(previewImport(call(PLAIN, A), t3, { update: true, addMissing: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("cari: güncelle kipinde 'atla' ile yeni kod eklenmez, mevcut güncellenir", async () => {
    const rows = [
      { row: 2, code: "C981", name: "Kaya Ltd Şti" },
      { row: 3, code: "C981-YENI", name: "Yeni" },
    ];
    const r = await importParties(call(A.ownerUserId, A), { rows, dryRun: false, addMissing: false });
    expect(r).toMatchObject({ updated: 1, skipped: 1, created: 0 });
    expect((await adm.query("SELECT 1 FROM public.parties WHERE tenant_id = $1 AND code = 'C981-YENI'", [A.tenantId])).rowCount).toBe(0);
  });

  it("depo / raf: içeri al yeni ekler, güncelle adı ve türü değiştirir, üst raf değişmez; yalnız Yönetici; audit özeti", async () => {
    const before = await auditCount(A.tenantId, "data.imported");
    const w = [
      { row: 2, code: "d9", name: "Dokuzuncu" },
      { row: 3, code: "D1", name: "Ana Depo Yeni" },
    ];
    const dry = await importWarehouses(call(A.ownerUserId, A), { rows: w, dryRun: true, update: false });
    expect(dry).toMatchObject({ created: 1, unchanged: 1, updated: 0 });
    expect(await importWarehouses(call(A.ownerUserId, A), { rows: w, dryRun: false, update: false })).toMatchObject({ created: 1, unchanged: 1 });
    expect(await importWarehouses(call(A.ownerUserId, A), { rows: w, dryRun: false, update: true })).toMatchObject({ created: 0, updated: 1, unchanged: 1 });
    expect((await adm.query<{ name: string }>("SELECT name FROM public.warehouses WHERE tenant_id = $1 AND code = 'D1'", [A.tenantId])).rows[0]?.name).toBe("Ana Depo Yeni");

    const l = [
      { row: 2, warehouseCode: "D9", code: "A", name: "Bölge A", kind: "Depolama" },
      { row: 3, warehouseCode: "D9", code: "A-01", name: "Raf A-01", parentCode: "A", kind: "depolama" },
      { row: 4, warehouseCode: "D9", code: "K1", name: "Kabul", kind: "Kabul" },
      { row: 5, warehouseCode: "YOK", code: "X", name: "X" },
      { row: 6, warehouseCode: "D9", code: "B-01", name: "Yetim", parentCode: "B" },
    ];
    const lr = await importLocations(call(A.ownerUserId, A), { rows: l, dryRun: false, update: false });
    expect(lr.rows.map((x) => [x.row, x.status, x.issue])).toEqual([
      [2, "CREATED", undefined],
      [3, "CREATED", undefined],
      [4, "CREATED", undefined],
      [5, "INVALID", "WAREHOUSE_UNKNOWN"],
      [6, "INVALID", "PARENT_UNKNOWN"],
    ]);
    const child = await adm.query<{ depth: number; parent: string }>(
      "SELECT l.depth, p.code AS parent FROM public.locations l JOIN public.locations p ON p.tenant_id = l.tenant_id AND p.id = l.parent_id WHERE l.tenant_id = $1 AND l.code = 'A-01'",
      [A.tenantId],
    );
    expect(child.rows[0]).toEqual({ depth: 1, parent: "A" });
    const upd = await importLocations(call(A.ownerUserId, A), {
      rows: [
        { row: 2, warehouseCode: "D9", code: "K1", name: "Mal kabul", kind: "Sevk" },
        { row: 3, warehouseCode: "D9", code: "A-01", parentCode: "K1" },
        { row: 4, warehouseCode: "D9", code: "YENI-RAF", name: "Yeni" },
      ],
      dryRun: false,
      update: true,
      addMissing: false,
    });
    expect(upd.rows.map((x) => [x.status, x.issue])).toEqual([
      ["UPDATED", undefined],
      ["INVALID", "PARENT_CHANGE"],
      ["SKIPPED", undefined],
    ]);
    expect((await adm.query<{ name: string; kind: string }>("SELECT name, kind FROM public.locations WHERE tenant_id = $1 AND code = 'K1'", [A.tenantId])).rows[0]).toEqual({ name: "Mal kabul", kind: "STAGING" });
    expect(await auditCount(A.tenantId, "data.imported")).toBeGreaterThanOrEqual(before + 3);
    // Aktarım yetkisi olan ama Yönetici olmayan üye depo/raf yazamaz; aktarım yetkisi olmayan da.
    await expect(importWarehouses(call(SCOPED, A), { rows: w, dryRun: true, update: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(importLocations(call(PLAIN, A), { rows: l, dryRun: true, update: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Başka kiracı A'nın deposunu göremez: B'nin sahibi kendi alanında D9'u bulamaz.
    expect((await importLocations(call(B.ownerUserId, B), { rows: [{ row: 2, warehouseCode: "D9", code: "Z", name: "Z" }], dryRun: true, update: false })).rows[0]?.issue).toBe("WAREHOUSE_UNKNOWN");
  });
});
