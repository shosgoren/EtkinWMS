// T-1136: yön seçiminin onay penceresi için kart akışının YEREL kayıt sayısı (Ayarlar › Entegrasyonlar › Akış). Yetki `settings.manage`
// (ekran okumasıyla aynı); tenant `runTenantQuery` + RLS, her sorguda ayrıca `tenant_id` süzgeci (I-01…I-03). Yalnız sayı döner (ad/kod yok).
// Sayılan kümeler eşitlemenin gerçekten dokunduğu kümelerdir (`sync.ts` `unlinked`, `apply.ts`): ürün ve depo `status = 'ACTIVE'`, cari
// arşivlenmemiş; `unlinked` = bu sağlayıcıya eşlemesi (`external_refs`) olmayanlar — "gönder" yönünün göndereceği adaylar.
import { sql } from "drizzle-orm";
import { AppError } from "@wms/shared/errors";
import { runTenantQuery } from "../identity/access.ts";
import { PROVIDER_INFO, parseFlow, parseProvider, type Flow } from "./catalog.ts";
import type { ConnectionCallParams } from "./connections.ts";

/** Yön seçimi sonucu yerel kayıtlara dokunan kart akışları. */
export const CARD_FLOWS = ["PRODUCTS", "CONTACTS", "WAREHOUSES"] as const satisfies readonly Flow[];
export type CardFlow = (typeof CARD_FLOWS)[number];

export interface FlowRecordCount {
  /** Eşitlemenin gördüğü yerel kayıt sayısı. */
  readonly total: number;
  /** Bu sağlayıcıya henüz eşlenmemiş olanlar. */
  readonly unlinked: number;
}

export async function countFlowRecords(params: ConnectionCallParams, input: { readonly provider: string; readonly flow: string }): Promise<FlowRecordCount> {
  const provider = parseProvider(input.provider);
  const flow = parseFlow(input.flow);
  if (!(CARD_FLOWS as readonly Flow[]).includes(flow)) throw new AppError("VALIDATION_FAILED");
  const system = PROVIDER_INFO[provider].system;
  return runTenantQuery({ ...params, permission: "settings.manage" }, async (tx, m) => {
    const t = m.tenantId;
    const rows =
      flow === "PRODUCTS"
        ? await tx.execute<{ total: number; unlinked: number }>(sql`
            SELECT count(*)::int AS total,
                   count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.external_refs r WHERE r.tenant_id = i.tenant_id AND r.system = ${system} AND r.entity_type = 'ITEM' AND r.entity_id = i.id))::int AS unlinked
              FROM public.items i WHERE i.tenant_id = ${t}::uuid AND i.status = 'ACTIVE'`)
        : flow === "CONTACTS"
          ? await tx.execute<{ total: number; unlinked: number }>(sql`
            SELECT count(*)::int AS total,
                   count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.external_refs r WHERE r.tenant_id = p.tenant_id AND r.system = ${system} AND r.entity_type = 'PARTY' AND r.entity_id = p.id))::int AS unlinked
              FROM public.parties p WHERE p.tenant_id = ${t}::uuid AND p.archived_at IS NULL`)
          : await tx.execute<{ total: number; unlinked: number }>(sql`
            SELECT count(*)::int AS total,
                   count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.external_refs r WHERE r.tenant_id = w.tenant_id AND r.system = ${system} AND r.entity_type = 'WAREHOUSE' AND r.entity_id = w.id))::int AS unlinked
              FROM public.warehouses w WHERE w.tenant_id = ${t}::uuid AND w.status = 'ACTIVE'`);
    return { total: Number(rows[0]?.total ?? 0), unlinked: Number(rows[0]?.unlinked ?? 0) };
  });
}
