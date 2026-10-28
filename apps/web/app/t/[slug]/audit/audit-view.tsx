"use client";
// Denetim kaydı ekranı (T-126; T-971 B-63 liste kalıbı, KalipListe.dc.html). Veri, süzgeç ve yetki kararı SUNUCUDADIR (page.tsx → listAudit);
// bu bileşen yalnız sunumdur. Süzgeç: hızlı çipler (Tümü / Bugün / Son 7 gün / seçili işlem — adresi değiştirir) + tarih aralığı ve işlem
// seçimi GET formu (`#from`, `#to`, `#action`; JS yokken de çalışır). Kayıtlar kart: işlem adı, kişi · zaman, kayıt türü/kimliği, gerekçe;
// karta dokununca tam kayıt bilgisi balonda. Sayfalama liste sonunda kendiliğinden (T-1059, `KalipSonsuz`); ana işlem alt çubukta CSV İNDİR.
// T-978: arama (`.lsearch`, GET `q`: kişi adı / gerekçe / kayıt kimliği; sunucuda listAudit) — tarih ve işlem süzgeci korunur.
// Bilinçli fark (DESIGN-PARITY, T-971): çip sayıları yok.
// T-990 (B-97): işlem süzgeci yerel açılır liste değil: `#action` güçlü kenarlıklı tetik düğmesi ortak aramalı seçim sayfasını
// (`KalipSecimSayfasi`) açar; seçim gizli `action` alanına yazılır ve GET formu hemen gönderilir (adres değişir). JS yokken "Süz" düğmesi
// tarih süzgecini yine gönderir.
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { LICON } from "../../../design/kalip-icons.ts";
import { Ico, KalipBaslik, KalipEkran, useKalipToast } from "../kalip/ekran.tsx";
import { feedback } from "@wms/ui";
import { KalipAra, KalipBos, KalipCipler, KalipKart, KalipKartListe, type KalipCip } from "../kalip/liste.tsx";
import { KalipSecimSayfasi } from "../kalip/secim.tsx";
import { KalipSonsuz, useKalipDerinlik } from "../kalip/tablo.tsx";
import { loadMoreAuditAction } from "./actions.ts";

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
  // T-1111: entegrasyon (Paraşüt turuncu bağlantı, STANDART §7), Excel aktarımı, destek, kurulum rehberi.
  if (g === "integration") return { d: LICON.transfer, color: "E0582B" };
  if (g === "data") return { d: LICON.excel, color: "2F7D5B" };
  if (g === "support") return { d: LICON.support, color: "0E7C7B" };
  if (g === "setup_journey") return { d: LICON.check, color: "2F7D5B" };
  if (g === "production_recipe") return { d: LICON.uret, color: "8A5A12" };
  return { d: LICON.clock, color: "6A7F91" };
}

export function AuditView({
  dark,
  home,
  here,
  rows: ilkSatirlar,
  filters,
  actions,
  quick,
  exportHref,
  nextCursor,
  slug,
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
  /** T-1059: sonraki sayfanın imleci; sonraki kayıtlar liste sonunda kendiliğinden gelir. */
  nextCursor: string | null;
  slug: string;
  banner: ReactNode;
}) {
  const t = useTranslations("auditLog");
  const tk = useTranslations("kural");
  const { say, node: toast } = useKalipToast("liste");
  // T-1059: kaydırınca eklenen sayfalar; süzgeç değişince (sunucu yeni ilk sayfa çizer) sıfırlanır.
  const [ek, setEk] = useState<{ readonly bas: readonly AuditRowView[] | null; readonly rows: readonly AuditRowView[]; readonly next: string | null }>({ bas: ilkSatirlar, rows: [], next: nextCursor });
  const guncel = ek.bas === ilkSatirlar ? ek : { bas: ilkSatirlar, rows: [], next: nextCursor };
  if (guncel !== ek) setEk(guncel);
  const rows = useMemo(() => {
    if (ilkSatirlar === null) return null;
    const ilk = new Set(ilkSatirlar.map((r) => r.id));
    return [...ilkSatirlar, ...guncel.rows.filter((r) => !ilk.has(r.id))];
  }, [ilkSatirlar, guncel.rows]);
  const sonraki = guncel.next;
  const dahaYukle = useCallback(async (): Promise<boolean> => {
    if (sonraki === null) return true;
    const r = await loadMoreAuditAction({ slug, filters, cursor: sonraki });
    if (!r.ok) return false;
    setEk((o) => (o.bas !== ilkSatirlar ? o : { bas: o.bas, rows: [...o.rows, ...r.data.rows], next: r.data.next }));
    return true;
  }, [sonraki, slug, filters, ilkSatirlar]);
  useKalipDerinlik(rows?.length ?? 0, sonraki !== null, dahaYukle);
  const [action, setAction] = useState(filters.action ?? "");
  const [pick, setPick] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const actionLabel = action === "" ? t("allActions") : (actions.find((a) => a.id === action)?.label ?? action);
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
      }} overlays={
        <>
          {toast}
          <KalipSecimSayfasi
            open={pick}
            title={t("action")}
            icon={{ d: LICON.check, color: "6C4BD8" }}
            value={action}
            options={[{ id: "", label: t("allActions"), d: LICON.grid, color: "172E42" }, ...actions.map((a) => ({ id: a.id, label: a.label, keys: [a.id], d: visual(a.id).d, color: visual(a.id).color }))]}
            scan={false}
            onPick={(id) => {
              setAction(id);
              // Gizli alan güncellendikten sonra gönder (aynı karede değer henüz yazılmamış olabilir).
              window.requestAnimationFrame(() => form.current?.requestSubmit());
            }}
            onClose={() => setPick(false)}
            testId="audit-action-sheet"
          />
        </>
      }>
      <KalipAra
        label={t("search")}
        placeholder={t("searchPlaceholder")}
        action={here}
        defaultValue={filters.q ?? ""}
        below={(["from", "to", "action"] as const).map((k) => (filters[k] === undefined ? null : <input key={k} type="hidden" name={k} value={filters[k]} />))}
      />
      <KalipCipler label={t("quick")} chips={chips} />
      <form ref={form} method="get" action={here} aria-label={t("filterLabel")} className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end" style={{ flex: "none" }}>
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
          <button
            type="button"
            id="action"
            className={`${FIELD_CLS} flex items-center justify-between gap-2 text-left`}
            aria-haspopup="listbox"
            aria-expanded={pick}
            aria-label={`${t("action")}: ${actionLabel}`}
            onClick={() => {
              feedback.minor();
              setPick(true);
            }}
            data-testid="audit-action"
            data-value={action}
          >
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{actionLabel}</span>
            <Ico d={LICON.chev} size={18} />
          </button>
          {action === "" ? null : <input type="hidden" name="action" value={action} />}
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
            <KalipSonsuz devam={sonraki !== null} yukle={dahaYukle} metin={t("listTitle")} testId="audit-sonsuz" />
          </KalipKartListe>
        </>
      )}
      <p style={{ margin: 0, fontSize: 13 }}>
        {t("export")}: {t("exportNote")}
      </p>
    </KalipEkran>
  );
}
