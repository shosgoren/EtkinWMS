"use client";
// Denetim kaydı ekranı (T-126; T-971 B-63 liste kalıbı, KalipListe.dc.html). Veri, süzgeç ve yetki kararı SUNUCUDADIR (page.tsx → listAudit);
// bu bileşen yalnız sunumdur. Süzgeç: hızlı çipler (Tümü / Bugün / Son 7 gün / seçili işlem — adresi değiştirir) + tarih aralığı ve işlem
// seçimi GET formu (`#from`, `#to`, `#action`; JS yokken de çalışır). Kayıtlar kart: işlem adı, kişi · zaman, kayıt türü/kimliği, gerekçe;
// karta dokununca tam kayıt bilgisi balonda. Sayfalama imleçle (`KalipDaha`); ana işlem alt çubukta CSV İNDİR.
// T-978: arama (`.lsearch`, GET `q`: kişi adı / gerekçe / kayıt kimliği; sunucuda listAudit) — tarih ve işlem süzgeci korunur.
// Bilinçli fark (DESIGN-PARITY, T-971): çip sayıları yok.
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { LICON } from "../../../design/kalip-icons.ts";
import { KalipBaslik, KalipEkran, useKalipToast } from "../kalip/ekran.tsx";
import { KalipAra, KalipBos, KalipCipler, KalipDaha, KalipKart, KalipKartListe, type KalipCip } from "../kalip/liste.tsx";
import { feedback } from "@wms/ui";

export interface AuditRowView {
  readonly id: string;
  /** Kiracı saat diliminde biçimlenmiş zaman. */
  readonly when: string;
  readonly actor: string;
  readonly action: string;
  readonly actionLabel: string;
  readonly record: string | null;
  readonly reason: string | null;
}

const FIELD_CLS =
  "min-h-12 w-full min-w-0 rounded-card border-2 border-border-strong bg-surface px-4 text-base text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus";

/** İşlem önekine göre kart ikonu ve rengi (yalnız görsel; veri sunucudan). */
function visual(action: string): { d: string; color: string } {
  const g = action.split(".")[0] ?? "";
  if (["member", "invitation", "ownership", "field_user", "field_device", "team_join", "group"].includes(g)) return { d: LICON.people, color: "2F5DA8" };
  if (["tenant", "onboarding", "settings", "trial", "sample_data", "work_priority"].includes(g)) return { d: LICON.gear, color: "4E6476" };
  if (g === "warehouse" || g === "warehouse_scope") return { d: LICON.depo, color: "30475A" };
  if (g === "location") return { d: LICON.raf, color: "0E7C7B" };
  if (["item", "unit", "item_barcode", "unit_conversion"].includes(g)) return { d: LICON.box, color: "2F5DA8" };
  if (["stock_document", "reservation", "lot", "serial", "handling_unit", "inbound_receipt"].includes(g)) return { d: LICON.koli, color: "9A5B2E" };
  if (["count", "pick", "pick_assignment", "warehouse_task", "sales_order"].includes(g)) return { d: LICON.clip, color: "6C4BD8" };
  if (g === "audit" || g === "password_reset_link") return { d: LICON.shield, color: "172E42" };
  if (g === "problem") return { d: LICON.warn, color: "E56A00" };
  if (g === "party") return { d: LICON.people, color: "6C4BD8" };
  return { d: LICON.clock, color: "6A7F91" };
}

export function AuditView({
  dark,
  home,
  here,
  rows,
  filters,
  actions,
  quick,
  exportHref,
  moreHref,
  banner,
}: {
  dark: boolean;
  home: string;
  here: string;
  rows: readonly AuditRowView[] | null;
  filters: { readonly from?: string; readonly to?: string; readonly action?: string; readonly q?: string };
  /** İşlem seçenekleri (kod + ad). */
  actions: readonly { readonly id: string; readonly label: string }[];
  /** Hızlı çipler (sunucu hesaplar: bugünün tarihi kiracı saat diliminde). */
  quick: readonly { readonly id: string; readonly label: string; readonly href: string; readonly on: boolean }[];
  exportHref: string;
  moreHref: string | null;
  banner: ReactNode;
}) {
  const t = useTranslations("auditLog");
  const tk = useTranslations("kural");
  const { say, node: toast } = useKalipToast("liste");
  const ALL = { d: LICON.grid, color: "172E42" };
  const ICONS: Record<string, { d: string; color: string }> = {
    all: ALL,
    today: { d: LICON.clock, color: "2F5DA8" },
    week: { d: LICON.clock, color: "0E7C7B" },
    action: { d: LICON.check, color: "6C4BD8" },
  };
  const chips: KalipCip[] = quick.map((q) => {
    const ic = ICONS[q.id] ?? ALL;
    return { id: q.id, label: q.label, href: q.href, on: q.on, d: ic.d, color: ic.color };
  });
  const filtered = filters.from !== undefined || filters.to !== undefined || filters.action !== undefined || filters.q !== undefined;

  return (
    <KalipEkran kind="liste" dark={dark} title={t("title")} icon={{ d: LICON.shield, color: "172E42" }} testId="audit" bar={{
        back: { href: home, aria: t("back") },
        main: rows === null ? { label: "", d: LICON.excel, disabled: true } : { label: t("exportShort"), aria: t("export"), d: LICON.excel, href: exportHref, testId: "audit-export" },
      }} overlays={toast}>
      <KalipAra
        label={t("search")}
        placeholder={t("searchPlaceholder")}
        action={here}
        defaultValue={filters.q ?? ""}
        below={(["from", "to", "action"] as const).map((k) => (filters[k] === undefined ? null : <input key={k} type="hidden" name={k} value={filters[k]} />))}
      />
      <KalipCipler label={t("quick")} chips={chips} />
      <form method="get" action={here} aria-label={t("filterLabel")} className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end" style={{ flex: "none" }}>
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="from" className="text-sm font-semibold">
            {t("from")}
          </label>
          <input id="from" name="from" type="date" defaultValue={filters.from ?? ""} className={FIELD_CLS} />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="to" className="text-sm font-semibold">
            {t("to")}
          </label>
          <input id="to" name="to" type="date" defaultValue={filters.to ?? ""} className={FIELD_CLS} />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="action" className="text-sm font-semibold">
            {t("action")}
          </label>
          <select id="action" name="action" defaultValue={filters.action ?? ""} className={FIELD_CLS}>
            <option value="">{t("allActions")}</option>
            {actions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        {filters.q === undefined ? null : <input type="hidden" name="q" value={filters.q} />}
        <button type="submit" className="btn n">
          {t("filter")}
        </button>
      </form>
      {banner}
      {rows === null ? null : rows.length === 0 ? (
        <KalipBos
          title={filtered ? tk("notFoundSearch") : t("empty")}
          action={filtered ? { label: t("clear"), href: here, kind: "clear" } : { label: tk("home"), href: home, kind: "go" }}
        />
      ) : (
        <>
          <KalipBaslik title={t("listTitle")} hint={t("intro")} />
          <KalipKartListe label={t("title")}>
            {rows.map((r, i) => {
              const v = visual(r.action);
              const meta = [r.record, r.reason].filter((x): x is string => x !== null && x !== "").join(" · ");
              return (
                <KalipKart
                  key={r.id}
                  index={i}
                  name={r.actionLabel}
                  code={`${r.actor} · ${r.when}`}
                  {...(meta === "" ? {} : { meta })}
                  d={v.d}
                  color={v.color}
                  aria={`${r.actionLabel} · ${r.actor} · ${r.when}${meta === "" ? "" : ` · ${meta}`}`}
                  onClick={() => {
                    feedback.minor();
                    say("info", [r.actionLabel, r.actor, r.when, r.record, r.reason].filter((x): x is string => x !== null && x !== "").join(" · "));
                  }}
                  testId="audit-row"
                />
              );
            })}
          </KalipKartListe>
          {moreHref === null ? null : (
            <KalipDaha href={moreHref} iconD={LICON.plus} testId="audit-more">
              {t("more")}
            </KalipDaha>
          )}
        </>
      )}
      <p style={{ margin: 0, fontSize: 13 }}>
        {t("export")}: {t("exportNote")}
      </p>
    </KalipEkran>
  );
}
