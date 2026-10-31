// T-1140 (inceleme MINOR-3): kullanıcı cari/depoyu kendisi arşivledi ya da geri açtı (domain komutu, aynı transaction) — Paraşüt yaşam
// döngüsünün sistem arşiv sahipliği (`integration_card_states.source_managed_archive`) bırakılır: Paraşüt'te kart yeniden etkin olsa da
// kullanıcının arşivi açılmaz, kullanıcının geri açtığı kart kaynak durumu değişmedikçe yeniden arşivlenmez (card-lifecycle.ts; ürünün
// `archiveItem` kuralıyla aynı). Bağımlılığı yalnız SQL'dir: katalog/depo komutları entegrasyon modül zincirini içe aktarmaz.
import { sql } from "drizzle-orm";
import type { AccessTx } from "../identity/access.ts";

/** Sistem sahipliği bırakıldıysa true. RLS + açık kiracı süzgeci (I-01). */
export async function releaseSourceArchive(tx: AccessTx, tenantId: string, entity: "PARTY" | "WAREHOUSE", id: string): Promise<boolean> {
  const r = await tx.execute<{ entity_id: string }>(sql`UPDATE public.integration_card_states SET source_managed_archive = false
                        WHERE tenant_id = ${tenantId}::uuid AND entity_type = ${entity} AND entity_id = ${id}::uuid AND source_managed_archive RETURNING entity_id`);
  return r.length > 0;
}
