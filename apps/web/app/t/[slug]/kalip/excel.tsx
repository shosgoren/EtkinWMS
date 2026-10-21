"use client";
// T-981b: kalıp üst çubuğunun ORTAK Excel eylemi — sağ üst `.tph` yuvasında Sorun bildir / Destek ile aynı görsel dilde yazısız `.helpb`
// düğmesi (kaynak ikonu `LICON.excel`, yeşil) + dokununca Pano'nun Hesap menüsüyle aynı buzlu perde ve cam kutu (`.hback` + `.halo.tmenu`,
// `.dzp` kabı; ALTIN-KURAL "menüler kısayol halkasıyla aynı perde + cam kutu"). Öğeler: İçeri al (Aktar bu tür seçili), Güncelle (Aktar
// "koda göre güncelle" kipinde), Dışarı aktar (o anki arama/süzgeçle .xlsx indirir). Tuvalde kaynağı yok (DESIGN-PARITY T-981b satırı):
// yalnız kaynakta var olan sınıf, ikon ve renkler kullanılır; yeni stil yok.
// Yetki gösterimdir: düğme yalnız `data.import` olana çizilir; depo/raf içe aktarma ayrıca `settings.manage` ister. Asıl karar sunucuda
// (`/api/t/<alan>/export/<tür>` ve aktarım eylemleri). Her işlemde görsel (balon, renk) + sesli (`tone`) geri bildirim.
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { dz } from "../../../design/pano-tokens.ts";
import { LICON } from "../../../design/kalip-icons.ts";
import { Ico, useKalipToast, type KalipKind } from "./ekran.tsx";
import { kdz, type KalipScope } from "./tokens.ts";
import { feedback, intlDil } from "@wms/ui";

export type KalipExcelTur = "items" | "parties" | "warehouses" | "locations";

export interface KalipExcelProps {
  readonly kind: KalipExcelTur;
  /** Raflar: lokasyon ağacının deposu (dışa aktarma bu depoyla sınırlanır). */
  readonly warehouseId?: string;
}

/** Ekran türü → Aktar türü (`/import?tur=`). */
const AKTAR: Readonly<Record<KalipExcelTur, string>> = { items: "urun", parties: "cari", warehouses: "depo", locations: "raf" };
const SCOPE: Record<KalipKind, KalipScope> = { liste: "dzl", form: "dzf", detay: "dzd" };

export interface ExcelIndirSonuc {
  readonly ok: boolean;
  readonly rows?: number;
  readonly truncated?: boolean;
  readonly personalOmitted?: boolean;
  readonly code?: string;
  readonly detail?: string;
}

/**
 * Dışa aktarma / şablon dosyasını indirir (aynı site `fetch` → blob → indirme). Hata kodu yanıttan okunur (ekranda sade metin).
 * Bağlantılar sekmesi de bunu kullanır (tek davranış).
 */
export async function excelIndir(href: string): Promise<ExcelIndirSonuc> {
  try {
    const res = await fetch(href, { credentials: "same-origin", headers: { accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
    if (!res.ok) {
      let code = "INTERNAL";
      let detail: string | undefined;
      try {
        const body = (await res.json()) as { error?: { code?: unknown; detail?: unknown } };
        if (typeof body.error?.code === "string") code = body.error.code;
        if (typeof body.error?.detail === "string") detail = body.error.detail;
      } catch {
        /* gövde yok */
      }
      return { ok: false, code, ...(detail === undefined ? {} : { detail }) };
    }
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "etkin.xlsx";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return { ok: true, rows: Number(res.headers.get("x-export-rows") ?? "0"), truncated: res.headers.get("x-export-truncated") === "1", personalOmitted: res.headers.get("x-export-personal-omitted") === "1" };
  } catch {
    return { ok: false, code: "NETWORK" };
  }
}

/** Kişisel veri dosyası yeniden giriş istedi: kısa balondan sonra yeniden giriş ekranı (dönüş bu sayfa). */
export function excelYenidenGiris(r: ExcelIndirSonuc): boolean {
  if (r.detail !== "RECENT_AUTH_REQUIRED") return false;
  const next = `${window.location.pathname}${window.location.search}`;
  window.setTimeout(() => window.location.assign(`/login?reauth=1&next=${encodeURIComponent(next)}`), 1600);
  return true;
}

/** Hata kodu → `kalip.excel.err.*` anahtarı. */
export function excelHata(code: string | undefined, detail?: string): string {
  return detail === "RECENT_AUTH_REQUIRED" ? "reauth" : code === "RATE_LIMITED" ? "rate" : code === "FORBIDDEN" || code === "UNAUTHENTICATED" ? "forbidden" : code === "NETWORK" ? "network" : code === "NOT_FOUND" ? "notFound" : "generic";
}

/** Ekranın o anki arama / süzgeci (adres sorgusu): `q`, cari arşivi. */
function currentFilter(kind: KalipExcelTur): URLSearchParams {
  const out = new URLSearchParams();
  const cur = new URLSearchParams(window.location.search);
  const q = (cur.get("q") ?? "").trim();
  if (q !== "") out.set("q", q.slice(0, 100));
  if (kind === "parties" && cur.get("arsiv") === "1") out.set("arsiv", "1");
  return out;
}

export interface KalipExcelKatman {
  /** Üst çubuk `.tph` yuvasındaki düğme. */
  readonly button: ReactNode;
  /** `.app` içinde çizilen perde + menü + balon. */
  readonly layer: ReactNode;
  readonly open: boolean;
  readonly close: () => void;
}

/**
 * KalipEkran'ın kullandığı kanca. `can`: kiracı düzeninden gelen gösterim yetkisi (`data`: düğme + dışarı aktar; `master`: depo/raf içe aktarma).
 * Yetki yoksa düğme hiç çizilmez.
 */
export function useKalipExcel(scopeKind: KalipKind, slug: string | undefined, excel: KalipExcelProps | undefined, can: { readonly data: boolean; readonly master: boolean } | undefined, dark: boolean, onOpen: () => void): KalipExcelKatman {
  const t = useTranslations("kalip.excel");
  const locale = useLocale(); // T-436 (ALTIN-KURAL 16): kullanıcının dili
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { say, node: toast } = useKalipToast(scopeKind);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (excel === undefined || slug === undefined || can?.data !== true) return { button: null, layer: toast, open: false, close };
  const base = `/t/${encodeURIComponent(slug)}`;
  const canImport = excel.kind === "items" || excel.kind === "parties" || can.master;
  const label = t(`kind.${excel.kind}`);
  const aktar = `${base}/import?tur=${AKTAR[excel.kind]}`;
  const download = async (): Promise<void> => {
    if (busy) return;
    feedback.minor();
    setBusy(true);
    const f = currentFilter(excel.kind);
    if (excel.kind === "locations" && excel.warehouseId !== undefined) f.set("warehouse", excel.warehouseId);
    const qs = f.toString();
    const r = await excelIndir(`/api/t/${encodeURIComponent(slug)}/export/${excel.kind}${qs === "" ? "" : `?${qs}`}`);
    setBusy(false);
    setOpen(false);
    if (!r.ok) {
      feedback.error();
      say(r.detail === "RECENT_AUTH_REQUIRED" ? "warn" : "err", t(`err.${excelHata(r.code, r.detail)}`));
      excelYenidenGiris(r);
      return;
    }
    feedback.ok();
    const n = (r.rows ?? 0).toLocaleString(intlDil(locale));
    if (r.truncated === true) say("warn", t("doneTruncated", { n }));
    else if (r.personalOmitted === true) say("info", t("donePersonal", { n }));
    else say("ok", t("done", { n }));
  };
  const items: Array<{ k: string; label: string; color: string; d: string; href?: string; go?: () => void }> = [
    ...(canImport
      ? [
          { k: "import", label: t("import"), color: "2F7D5B", d: LICON.moveIn, href: aktar },
          { k: "update", label: t("update"), color: "2F5DA8", d: LICON.transfer, href: `${aktar}&kip=guncelle` },
        ]
      : []),
    { k: "export", label: busy ? t("exporting") : t("export"), color: "0E7C7B", d: LICON.moveOut, go: () => void download() },
  ];
  const sc = SCOPE[scopeKind];
  const button = (
    <button
      type="button"
      className="helpb xls"
      style={{ color: kdz(sc, "2F7D5B") }}
      aria-label={t("aria", { kind: label })}
      title={t("aria", { kind: label })}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => {
        feedback.minor();
        onOpen();
        setOpen((o) => !o);
      }}
      data-testid="kalip-excel"
    >
      <Ico d={LICON.excel} size={22} />
    </button>
  );
  const panoScope = `dzp${dark ? " dz-dark" : ""}`;
  const layer = (
    <>
      {open ? (
        <div className={panoScope} style={{ display: "contents" }}>
          <div className="hback" onClick={close} />
          <div className="halo tmenu" role="menu" aria-label={t("menu", { kind: label })} data-testid="kalip-excel-menu">
            <div className="tmh">
              <span className="av" style={{ background: dz("2F7D5B") }}>
                <Ico d={LICON.excel} size={20} />
              </span>
              <span style={{ minWidth: 0 }}>
                <b>{t("title", { kind: label })}</b>
                <small>{canImport ? t("sub") : t("subExport")}</small>
              </span>
            </div>
            {items.map((m, i) =>
              m.href !== undefined ? (
                <a key={m.k} href={m.href} className="hb" role="menuitem" style={{ textDecoration: "none" }} onClick={() => feedback.minor()} data-testid={`kalip-excel-${m.k}`} autoFocus={i === 0}>
                  <i style={{ background: dz(m.color) }}>
                    <Ico d={m.d} size={20} />
                  </i>
                  <span>{m.label}</span>
                </a>
              ) : (
                <button key={m.k} type="button" className="hb" role="menuitem" onClick={m.go} aria-busy={busy || undefined} disabled={busy} data-testid={`kalip-excel-${m.k}`} autoFocus={i === 0}>
                  <i style={{ background: dz(m.color) }}>
                    <Ico d={m.d} size={20} />
                  </i>
                  <span>{m.label}</span>
                </button>
              ),
            )}
          </div>
        </div>
      ) : null}
      {toast}
    </>
  );
  return { button, layer, open, close };
}
