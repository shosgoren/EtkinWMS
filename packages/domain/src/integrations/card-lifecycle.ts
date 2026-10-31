// T-1140 (kullanıcı kararı 31 Ekim 2026): Paraşüt'te silinen ya da arşivlenen CARİ ve DEPO — ürün yaşam döngüsüyle (product-lifecycle.ts)
// aynı güvenlik kuralları. Yalnız OAuth'a bağlı bağlantıda (bağlam `lifecycleBinding(..., flow)`; kilitli bağlam dışında yazılmaz):
//  - Kaynakta arşivli → yerel kart kullanımda değilse arşivlenir (`via: integration` audit), kullanımdaysa PENDING bekler.
//  - Kaynakta yok (404) → tek gözlem silme değildir: aynı bağlamda en az 30 sn arayla İKİ yokluk; sonra arşiv / PENDING. Fiziksel silme YOK.
//  - Kaynakta yeniden etkin → yalnız SİSTEMİN arşivlediği kart (`source_managed_archive`) geri açılır; kullanıcının arşivi korunur.
//  - "Kullanımda": cari = açık sipariş / mal kabul / sipariş belgesi; depo = etkin lokasyon (domain archiveWarehouse kuralı), sıfır olmayan
//    bakiye, açık belge / kabul / iade / görev / sayım (product-lifecycle-reads.ts, salt SELECT; stok tablosuna yazma ve kilit yok — I-04, I-15).
// Durum `integration_card_states` (0069) satırındadır; kart satırında yalnız domain'in kendi arşiv alanları (parties.archived_at,
// warehouses.status/archived_at) değişir. Kart satırı kilitlenir (cari FOR UPDATE, depo archiveWarehouse gibi FOR NO KEY UPDATE).
import { sql } from "drizzle-orm";
import { appendAudit } from "@wms/db";
import type { AccessTx } from "../identity/access.ts";
import type { ApplyContext } from "./apply.ts";
import { context, type LifecycleBinding } from "./product-lifecycle.ts";
import { partyLifecycleBusy, warehouseLifecycleBusy } from "./product-lifecycle-reads.ts";

export type LifecycleCard = "PARTY" | "WAREHOUSE";
export const MISSING_MIN_GAP_MS = 30_000;

type StateRow = {
  source_state: string;
  source_disposition: string;
  source_managed_archive: boolean;
  source_missing_since: Date | string | null;
  source_missing_context: string | null;
};

async function cardArchived(tx: AccessTx, tenantId: string, entity: LifecycleCard, id: string): Promise<boolean | null> {
  const r =
    entity === "PARTY"
      ? await tx.execute<{ archived: boolean }>(sql`SELECT archived_at IS NOT NULL AS archived FROM public.parties WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`)
      : await tx.execute<{ archived: boolean }>(sql`SELECT status = 'ARCHIVED' AS archived FROM public.warehouses WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid FOR NO KEY UPDATE`);
  return r[0] === undefined ? null : r[0].archived === true;
}

async function setArchived(tx: AccessTx, tenantId: string, entity: LifecycleCard, id: string, archived: boolean): Promise<boolean> {
  const r =
    entity === "PARTY"
      ? await tx.execute<{ id: string }>(sql`UPDATE public.parties SET archived_at = CASE WHEN ${archived}::boolean THEN now() ELSE NULL END
                                             WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid AND (archived_at IS NULL) = ${archived}::boolean RETURNING id`)
      : await tx.execute<{ id: string }>(sql`UPDATE public.warehouses SET status = CASE WHEN ${archived}::boolean THEN 'ARCHIVED' ELSE 'ACTIVE' END,
                                                    archived_at = CASE WHEN ${archived}::boolean THEN now() ELSE NULL END
                                             WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid AND (status = 'ACTIVE') = ${archived}::boolean RETURNING id`);
  return r[0] !== undefined;
}

/**
 * Tek gözlem (bağlam çağıranda kilitli ve doğrulanmış olmalı). Dönüş: durum ya da kart değişti mi. `archived` boolean değilse (alan yok)
 * kaynak durumu değişmez — "alan yok" etkin demek değildir (ürünle aynı).
 */
export async function observeCard(
  tx: AccessTx,
  b: LifecycleBinding,
  c: ApplyContext,
  entity: LifecycleCard,
  externalId: string,
  observation: { exists: true; archived: unknown } | { exists: false },
  now = Date.now(),
): Promise<boolean> {
  const refs = await tx.execute<{ entity_id: string }>(sql`SELECT entity_id FROM public.external_refs WHERE tenant_id = ${b.tenantId}::uuid AND system = ${c.system} AND entity_type = ${entity} AND external_id = ${externalId} FOR SHARE`);
  const id = refs[0]?.entity_id;
  if (id === undefined) return false;
  const archivedNow = await cardArchived(tx, b.tenantId, entity, id);
  if (archivedNow === null) return false;
  await tx.execute(sql`INSERT INTO public.integration_card_states (tenant_id, system, entity_type, entity_id) VALUES (${b.tenantId}::uuid, ${c.system}, ${entity}, ${id}::uuid)
                       ON CONFLICT ON CONSTRAINT integration_card_states_pkey DO NOTHING`);
  const rows = await tx.execute<StateRow>(sql`SELECT source_state, source_disposition, source_managed_archive, source_missing_since, source_missing_context FROM public.integration_card_states
                                               WHERE tenant_id = ${b.tenantId}::uuid AND system = ${c.system} AND entity_type = ${entity} AND entity_id = ${id}::uuid FOR UPDATE`);
  const row = rows[0];
  if (row === undefined) return false;
  const at = sql`to_timestamp(${now} / 1000.0)`;
  const where = sql`tenant_id = ${b.tenantId}::uuid AND system = ${c.system} AND entity_type = ${entity} AND entity_id = ${id}::uuid`;
  const key = context(b, id, externalId);
  let state = row.source_state;
  if (observation.exists) {
    if (typeof observation.archived === "boolean") state = observation.archived ? "ARCHIVED" : "ACTIVE";
    await tx.execute(sql`UPDATE public.integration_card_states SET source_missing_since = NULL, source_missing_context = NULL, source_checked_at = ${at} WHERE ${where}`);
  } else {
    if (row.source_missing_context !== key || row.source_missing_since === null) {
      await tx.execute(sql`UPDATE public.integration_card_states SET source_missing_since = ${at}, source_missing_context = ${key}, source_checked_at = ${at} WHERE ${where}`);
      return false;
    }
    if (now - new Date(row.source_missing_since).getTime() < MISSING_MIN_GAP_MS) return false;
    state = "DELETED";
  }
  let disposition = "NONE";
  let managed = row.source_managed_archive;
  let archive: boolean | null = null; // true: arşivle, false: geri aç
  if (state === "ACTIVE") {
    if (managed && archivedNow) archive = false;
    managed = false;
  } else if (!archivedNow && (entity === "PARTY" ? await partyLifecycleBusy(tx, b.tenantId, id) : await warehouseLifecycleBusy(tx, b.tenantId, id))) {
    disposition = "PENDING";
    managed = false;
  } else {
    disposition = "ARCHIVED";
    if (!archivedNow) {
      archive = true;
      managed = true;
    }
  }
  const flipped = archive === null ? false : await setArchived(tx, b.tenantId, entity, id, archive);
  if (!flipped && archive === true) managed = row.source_managed_archive; // yarış: kart bu arada değişti, sahiplik iddia edilmez
  const changed = flipped || row.source_state !== state || row.source_disposition !== disposition || row.source_managed_archive !== managed;
  await tx.execute(sql`UPDATE public.integration_card_states SET source_state = ${state}, source_disposition = ${disposition}, source_managed_archive = ${managed},
                              source_changed_at = CASE WHEN ${state} = 'ACTIVE' THEN NULL ELSE COALESCE(source_changed_at, clock_timestamp()) END,
                              source_checked_at = ${at}
                        WHERE ${where}`);
  if (changed) {
    const type = entity === "PARTY" ? "party" : "warehouse";
    const action = flipped ? (archive ? `${type}.archived` : `${type}.restored`) : `${type}.updated`;
    await appendAudit(tx, { action: action as "party.archived", actorUserId: c.actorUserId, entityType: type, entityId: id, changeSummary: { via: "integration", system: c.system, sourceState: state, disposition } });
  }
  return changed;
}

/** Bu koşuda listede görülmemiş bağlı kartlar (kimliğiyle sorulacak; en çok 10 — ürünle aynı). */
export async function cardLifecycleCandidates(tx: AccessTx, b: LifecycleBinding, c: ApplyContext, entity: LifecycleCard, started: number): Promise<readonly { external_id: string }[]> {
  return tx.execute<{ external_id: string }>(sql`
    SELECT r.external_id FROM public.external_refs r
      LEFT JOIN public.integration_card_states s ON s.tenant_id = r.tenant_id AND s.system = r.system AND s.entity_type = r.entity_type AND s.entity_id = r.entity_id
     WHERE r.tenant_id = ${b.tenantId}::uuid AND r.system = ${c.system} AND r.entity_type = ${entity} AND r.external_id ~ '^[0-9]{1,18}$'
       AND (s.source_checked_at IS NULL OR s.source_checked_at < to_timestamp(${started} / 1000.0))
       AND (COALESCE(s.source_state, 'ACTIVE') <> 'DELETED' OR s.source_disposition = 'PENDING' OR s.source_checked_at < to_timestamp(${started - 300_000} / 1000.0))
     ORDER BY s.source_checked_at NULLS FIRST, r.entity_id
     LIMIT 10`);
}
