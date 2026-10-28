// T-1059: denetim kaydı satırlarının görünüm verisi (sunucu: çeviri, kiracı saat dilimi, kullanıcı dili). Sayfa ilk sayfayı,
// `loadMoreAuditAction` sonrakileri aynı biçimle üretir.
import { getLocale, getTranslations } from "next-intl/server";
import { tarih } from "@wms/ui";
import type { AuditPage } from "@wms/domain/audit/audit-query";
import type { AuditRowView } from "./audit-view.tsx";

/** T-1111: adı çevrilmiş kayıt türleri (`auditLog.entities.*`); listede olmayan "Kayıt" olarak görünür. */
export const KAYIT_TURLERI: ReadonlySet<string> = new Set(["membership", "tenant", "warehouse_task", "item", "warehouse", "stock_document", "integration", "count_session", "party", "location", "invitation", "unit", "permission_group", "item_barcode", "team_join_link", "support_ticket", "problem_report", "inbound_receipt", "field_device", "external_ref", "work_priority", "tenant_settings", "team_join_request", "serial", "pick_assignment", "lot", "location_batch", "integration_run", "handling_unit", "audit_log", "sales_order", "reservation", "user"]);

export async function denetimSatirlari(page: AuditPage): Promise<AuditRowView[]> {
  const t = await getTranslations("auditLog");
  const locale = await getLocale(); // T-436 (ALTIN-KURAL 16): kullanıcının dili
  const fmt = (d: Date): string => tarih(d, locale, { dateStyle: "medium", timeStyle: "medium", timeZone: page.timeZone });
  return page.items.map((r) => ({
    id: r.id,
    when: fmt(r.occurredAt),
    actor: r.actorName ?? t("system"),
    action: r.action,
    actionLabel: r.actionKnown ? t(`actions.${r.action}`) : t("actions.other"),
    // T-1111: ham tür adı ve uzun kimlik ("integration_run · f4f8…-…") yerine okunur ad + kısa kimlik.
    record:
      r.entityType === null
        ? null
        : `${KAYIT_TURLERI.has(r.entityType) ? t(`entities.${r.entityType}`) : t("entities.other")}${r.entityId === null ? "" : ` · ${r.entityId.slice(0, 8)}`}`,
    reason: r.reason,
  }));
}
