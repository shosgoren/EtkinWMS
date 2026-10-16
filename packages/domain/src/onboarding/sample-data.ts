// Deneme alanı örnek verisi (T-996, ADR-026 §4; 0040).
// - Yükleme: aktivasyonda "Örnek verilerle" seçildiyse, tenant'ı kuran transaction'ın İÇİNDE ayrı bir "Örnek depo" (bölge > raf > göz)
//   ve örnek ürünler (temel birim ADET, koli dönüşümü) `is_sample = true` ile yazılır. Stok hareketi YAZILMAZ: defter satırı silinemez
//   (I-08); örnek ürünler sıfır stokla başlar ve kullanıcı ilk hareketi kendisi yapar.
// - Temizleme ("Örnek verileri temizle", `settings.manage`): tek transaction'da önce SİLME denenir (savepoint). Örnek kayda herhangi bir
//   kayıt bağlıysa (belge satırı, stok boyutu → defter, görev, sayım, barkod …) DB FK'si 23503 ile reddeder; o zaman savepoint geri alınır
//   ve örnek kayıtlar PASİFE alınır (status = ARCHIVED). Stoğu ya da açık rezervasyonu olan örnek kayıt pasife alınamaz (`IN_USE`):
//   bakiyesi görünmez olurdu. Her iki sonuç tek `sample_data.cleared` audit satırıyla yazılır; sonuç ekranda açıkça söylenir.
// - Silme yetkisi DB'de daraltılmıştır (0040 tetikleyicileri): wms_app yalnız örnek satırı silebilir; örnek olmayan satır atlanır. Burada
//   silinen sayılar önceden sayılanla karşılaştırılır; sapma silmeyi geri alıp pasife almaya düşer. Lokasyonun sayım kilidini de aynı
//   tetikleyici siler (bu dosya kilit tablosuna yazmaz; T-210 stok yazma kuralı).
import { sql } from "drizzle-orm";
import { appendAudit } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { runTenantCommand, runTenantQuery, type AccessDbClient, type AccessPrincipal, type AccessTx } from "../identity/access.ts";
import { sqlstateOf } from "../stock/retry.ts";

export const SAMPLE_WAREHOUSE = Object.freeze({ code: "ORNEK", name: "Örnek depo" });

export interface SampleItemDef {
  readonly code: string;
  readonly name: string;
  /** Koli başına temel birim (ADET); yoksa dönüşüm yazılmaz. */
  readonly perKoli: string | null;
}

/** Kodlar `ORN-` önekli: kullanıcının kendi kodlarıyla çakışmaz ve listede örnek olduğu görünür. */
export const SAMPLE_ITEMS: readonly SampleItemDef[] = Object.freeze<readonly SampleItemDef[]>([
  { code: "ORN-KRT-3020", name: "Karton kutu 30x20x15", perKoli: "50" },
  { code: "ORN-KRT-4030", name: "Karton kutu 40x30x25", perKoli: "25" },
  { code: "ORN-KRT-6040", name: "Karton kutu 60x40x40", perKoli: "20" },
  { code: "ORN-BNT-45S", name: "Koli bandı 45mm şeffaf", perKoli: "36" },
  { code: "ORN-STR-500", name: "Streç film 500mm", perKoli: "6" },
  { code: "ORN-ETK-100", name: "Etiket 100x150 termal", perKoli: "6000" },
  { code: "ORN-BLN-100", name: "Balonlu naylon 100cm x 100m", perKoli: "4" },
  { code: "ORN-PLT-8012", name: "Ahşap palet 80x120", perKoli: null },
]);

export interface SampleLocationDef {
  readonly code: string;
  readonly name: string;
  readonly parent: string | null;
}

/** 1 bölge × 3 raf × 4 göz (A-14 Bölge > Raf > Göz); ebeveyn her zaman çocuktan önce. */
export const SAMPLE_LOCATIONS: readonly SampleLocationDef[] = Object.freeze<readonly SampleLocationDef[]>([
  { code: "A", name: "Bölge A", parent: null },
  ...[1, 2, 3].flatMap((r) => [
    { code: `A-R${r}`, name: `Raf ${r}`, parent: "A" },
    ...[1, 2, 3, 4].map((g) => ({ code: `A${r}-G0${g}`, name: `Göz 0${g}`, parent: `A-R${r}` })),
  ]),
]);

export interface SampleCounts {
  readonly warehouses: number;
  readonly locations: number;
  readonly items: number;
}

/**
 * Örnek veriyi tenant bağlamı KURULMUŞ transaction'da yazar (aktivasyon akışı; ayrı komut değil). Standart birimler (ADET, KOLI) aynı
 * transaction'da önceden kurulmuş olmalıdır (`initializeNewTenant`). Lokasyon sayım kilitleri 0010 tetikleyicisiyle oluşur.
 */
export async function seedSampleData(tx: AccessTx, tenantId: string, actorUserId: string, requestId: string): Promise<SampleCounts> {
  const units = await tx.execute<{ id: string; code: string }>(
    sql`SELECT id, code FROM public.units WHERE tenant_id = ${tenantId}::uuid AND code IN ('ADET', 'KOLI') AND status = 'ACTIVE'`,
  );
  const adet = units.find((u) => u.code === "ADET")?.id;
  const koli = units.find((u) => u.code === "KOLI")?.id;
  if (adet === undefined || koli === undefined) throw new AppError("INTERNAL");

  const wh = await tx.execute<{ id: string }>(
    sql`INSERT INTO public.warehouses (tenant_id, id, code, name, is_sample)
        VALUES (${tenantId}::uuid, gen_random_uuid(), ${SAMPLE_WAREHOUSE.code}, ${SAMPLE_WAREHOUSE.name}, true)
        RETURNING id`,
  );
  const warehouseId = wh[0]?.id;
  if (warehouseId === undefined) throw new AppError("INTERNAL");

  const locIds = new Map<string, { id: string; depth: number }>();
  for (const def of SAMPLE_LOCATIONS) {
    const parent = def.parent === null ? null : locIds.get(def.parent);
    if (def.parent !== null && parent === undefined) throw new AppError("INTERNAL");
    const depth = parent === undefined || parent === null ? 0 : parent.depth + 1;
    const rows = await tx.execute<{ id: string }>(
      sql`INSERT INTO public.locations (tenant_id, id, warehouse_id, parent_id, code, name, depth, kind, is_sample)
          VALUES (${tenantId}::uuid, gen_random_uuid(), ${warehouseId}::uuid, ${parent?.id ?? null}::uuid, ${def.code}, ${def.name},
                  ${depth}, 'STORAGE', true)
          RETURNING id`,
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new AppError("INTERNAL");
    locIds.set(def.code, { id, depth });
  }

  for (const def of SAMPLE_ITEMS) {
    const rows = await tx.execute<{ id: string }>(
      sql`INSERT INTO public.items (tenant_id, id, code, name, base_unit_id, is_sample)
          VALUES (${tenantId}::uuid, gen_random_uuid(), ${def.code}, ${def.name}, ${adet}::uuid, true)
          RETURNING id`,
    );
    const itemId = rows[0]?.id;
    if (itemId === undefined) throw new AppError("INTERNAL");
    if (def.perKoli !== null) {
      await tx.execute(
        sql`INSERT INTO public.unit_conversions (tenant_id, id, item_id, unit_id, to_base_factor)
            VALUES (${tenantId}::uuid, gen_random_uuid(), ${itemId}::uuid, ${koli}::uuid, ${def.perKoli}::numeric)`,
      );
    }
  }

  const counts: SampleCounts = { warehouses: 1, locations: SAMPLE_LOCATIONS.length, items: SAMPLE_ITEMS.length };
  await appendAudit(tx, {
    action: "sample_data.loaded",
    actorUserId,
    entityType: "warehouse",
    entityId: warehouseId,
    requestId,
    changeSummary: { ...counts },
  });
  return counts;
}

// ---------------------------------------------------------------------------------------------
// Durum ve temizleme
// ---------------------------------------------------------------------------------------------

export interface SampleDataStatus {
  /** Etkin (pasife alınmamış) örnek kayıt sayıları; hepsi 0 ise ekranda temizleme bölümü gösterilmez. */
  readonly active: SampleCounts;
}

async function activeCounts(tx: AccessTx, tenantId: string): Promise<SampleCounts> {
  const r = await tx.execute<{ w: number; l: number; i: number }>(
    sql`SELECT (SELECT count(*)::int FROM public.warehouses WHERE tenant_id = ${tenantId}::uuid AND is_sample AND status = 'ACTIVE') AS w,
               (SELECT count(*)::int FROM public.locations WHERE tenant_id = ${tenantId}::uuid AND is_sample AND status = 'ACTIVE') AS l,
               (SELECT count(*)::int FROM public.items WHERE tenant_id = ${tenantId}::uuid AND is_sample AND status = 'ACTIVE') AS i`,
  );
  const row = r[0];
  return { warehouses: Number(row?.w ?? 0), locations: Number(row?.l ?? 0), items: Number(row?.i ?? 0) };
}

export function hasActiveSample(s: SampleDataStatus): boolean {
  return s.active.warehouses + s.active.locations + s.active.items > 0;
}

/** Ayarlar ekranı için (izin: `settings.manage`, temizleme ile aynı). */
export async function getSampleDataStatus(params: {
  readonly db: AccessDbClient;
  readonly principal: AccessPrincipal | null | undefined;
  readonly tenantSlug: string;
}): Promise<SampleDataStatus> {
  return runTenantQuery({ ...params, permission: "settings.manage" }, async (tx, m) => ({ active: await activeCounts(tx, m.tenantId) }));
}

export type SampleClearMode = "DELETED" | "ARCHIVED" | "NONE";

export interface ClearSampleDataResult {
  readonly mode: SampleClearMode;
  readonly counts: SampleCounts;
}

class SampleInUse extends Error {
  override readonly name = "SampleInUse";
}

/** Tüm örnek kayıtları silmeyi dener; bir satır bile kalırsa (FK ya da DB tetikleyicisi atladı) fırlatır → savepoint geri alınır. */
async function deleteAll(sp: AccessTx, tenantId: string): Promise<SampleCounts> {
  const pre = await sp.execute<{ w: number; l: number; i: number; u: number }>(
    sql`SELECT (SELECT count(*)::int FROM public.warehouses WHERE tenant_id = ${tenantId}::uuid AND is_sample) AS w,
               (SELECT count(*)::int FROM public.locations WHERE tenant_id = ${tenantId}::uuid AND is_sample) AS l,
               (SELECT count(*)::int FROM public.items WHERE tenant_id = ${tenantId}::uuid AND is_sample) AS i,
               (SELECT count(*)::int FROM public.unit_conversions c JOIN public.items it ON it.tenant_id = c.tenant_id AND it.id = c.item_id
                 WHERE c.tenant_id = ${tenantId}::uuid AND it.is_sample) AS u`,
  );
  const p = pre[0];
  if (p === undefined) throw new AppError("INTERNAL");
  const del = async (q: ReturnType<typeof sql>, expected: number): Promise<void> => {
    const r = await sp.execute<{ x: number }>(q);
    if (r.length !== Number(expected)) throw new SampleInUse("sample row was not deleted");
  };
  await del(
    sql`DELETE FROM public.unit_conversions c USING public.items it
         WHERE c.tenant_id = ${tenantId}::uuid AND it.tenant_id = c.tenant_id AND it.id = c.item_id AND it.is_sample RETURNING 1 AS x`,
    p.u,
  );
  // Tek ifade: öz-FK (ebeveyn) denetimi ifade sonunda yapılır; örnek olmayan çocuk varsa 23503. Sayım kilidini 0040 tetikleyicisi siler
  // (sayımdaki kilit kalır → FK 23503 → pasife alma).
  await del(sql`DELETE FROM public.locations WHERE tenant_id = ${tenantId}::uuid AND is_sample RETURNING 1 AS x`, p.l);
  await del(sql`DELETE FROM public.items WHERE tenant_id = ${tenantId}::uuid AND is_sample RETURNING 1 AS x`, p.i);
  await del(sql`DELETE FROM public.warehouses WHERE tenant_id = ${tenantId}::uuid AND is_sample RETURNING 1 AS x`, p.w);
  return { warehouses: Number(p.w), locations: Number(p.l), items: Number(p.i) };
}

async function archiveAll(tx: AccessTx, tenantId: string): Promise<SampleCounts> {
  // Stoğu ya da açık rezervasyonu olan örnek kayıt pasife alınmaz: bakiye görünmez olur (archiveItem/archiveWarehouse kuralı).
  const busy = await tx.execute<{ x: number }>(
    sql`SELECT 1 AS x FROM public.stock_balances b
          JOIN public.stock_dimensions d ON d.tenant_id = b.tenant_id AND d.id = b.stock_dimension_id
          LEFT JOIN public.items i ON i.tenant_id = d.tenant_id AND i.id = d.item_id
          LEFT JOIN public.locations l ON l.tenant_id = d.tenant_id AND l.id = d.location_id
         WHERE b.tenant_id = ${tenantId}::uuid AND (b.quantity <> 0 OR b.reserved_quantity <> 0) AND (i.is_sample OR l.is_sample)
        UNION ALL
        SELECT 1 FROM public.reservations r JOIN public.items i ON i.tenant_id = r.tenant_id AND i.id = r.item_id
         WHERE r.tenant_id = ${tenantId}::uuid AND r.status = 'ACTIVE' AND i.is_sample
        LIMIT 1`,
  );
  if (busy[0] !== undefined) throw new AppError("VALIDATION_FAILED", { detail: "IN_USE" });
  const items = await tx.execute<{ x: number }>(
    sql`UPDATE public.items SET status = 'ARCHIVED', archived_at = now()
         WHERE tenant_id = ${tenantId}::uuid AND is_sample AND status = 'ACTIVE' RETURNING 1 AS x`,
  );
  const locs = await tx.execute<{ x: number }>(
    sql`UPDATE public.locations SET status = 'ARCHIVED', archived_at = now()
         WHERE tenant_id = ${tenantId}::uuid AND is_sample AND status = 'ACTIVE' RETURNING 1 AS x`,
  );
  // Örnek depoda kullanıcının kendi açtığı etkin lokasyon varsa depo açık kalır (gerçek kayıt gizlenmez).
  const whs = await tx.execute<{ x: number }>(
    sql`UPDATE public.warehouses w SET status = 'ARCHIVED', archived_at = now()
         WHERE w.tenant_id = ${tenantId}::uuid AND w.is_sample AND w.status = 'ACTIVE'
           AND NOT EXISTS (SELECT 1 FROM public.locations l
                            WHERE l.tenant_id = w.tenant_id AND l.warehouse_id = w.id AND l.status = 'ACTIVE')
         RETURNING 1 AS x`,
  );
  return { warehouses: whs.length, locations: locs.length, items: items.length };
}

export async function clearSampleData(params: {
  readonly db: AccessDbClient;
  readonly principal: AccessPrincipal | null | undefined;
  readonly tenantSlug: string;
  readonly recentAuth?: () => Promise<void>;
  readonly requestId?: string | null;
}): Promise<ClearSampleDataResult> {
  const { requestId, ...access } = params;
  return runTenantCommand({ ...access, permission: "settings.manage" }, async (tx, m) => {
    // Eşzamanlı iki temizlemeyi ve temizlik sırasında örnek depoya lokasyon açılmasını serileştirir.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${m.tenantId}:sample-data`}, 0))`);
    await tx.execute(sql`SELECT id FROM public.warehouses WHERE tenant_id = ${m.tenantId}::uuid AND is_sample FOR NO KEY UPDATE`);
    const active = await activeCounts(tx, m.tenantId);
    if (active.warehouses + active.locations + active.items === 0) return { mode: "NONE", counts: active };

    let mode: SampleClearMode;
    let counts: SampleCounts;
    try {
      counts = await tx.transaction((sp) => deleteAll(sp as AccessTx, m.tenantId));
      mode = "DELETED";
    } catch (e) {
      if (!(e instanceof SampleInUse) && sqlstateOf(e) !== "23503") throw e;
      counts = await archiveAll(tx, m.tenantId);
      mode = "ARCHIVED";
    }
    await appendAudit(tx, {
      action: "sample_data.cleared",
      actorUserId: m.userId,
      entityType: "tenant",
      entityId: m.tenantId,
      requestId: requestId ?? null,
      changeSummary: { mode, ...counts },
    });
    return { mode, counts };
  });
}
