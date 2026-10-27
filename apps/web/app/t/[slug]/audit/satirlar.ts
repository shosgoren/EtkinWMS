// T-1059: denetim kaydı satırlarının görünüm verisi (sunucu: çeviri, kiracı saat dilimi, kullanıcı dili). Sayfa ilk sayfayı,
// `loadMoreAuditAction` sonrakileri aynı biçimle üretir.
import { getLocale, getTranslations } from "next-intl/server";
import { tarih } from "@wms/ui";
import type { AuditPage } from "@wms/domain/audit/audit-query";
import type { AuditRowView } from "./audit-view.tsx";

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
    record: r.entityType === null ? null : `${r.entityType}${r.entityId === null ? "" : ` · ${r.entityId}`}`,
    reason: r.reason,
  }));
}
