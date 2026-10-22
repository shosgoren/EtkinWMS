"use client";
// T-986b: katılma QR'ını paylaşma — Ekip "Saha personeli: katılma QR'ı" ve Ekibe katılma ekranlarının ORTAK satırı (Paylas.dc.html `.shr`,
// CSS `design/paylas.css` üretilmiş, kap `.dzsh`) ve alt çubuğun PAYLAŞ ana işlemi (`useJoinShare`).
// Güvenlik: paylaşılan yalnız katılma bağlantısıdır (yönetici onayı + 6 haneli kod + PIN akışı değişmez); metin = firma adı + bağlantı + süre,
// başka bilgi yok. Bağlantı yalnız bu bileşenin belleğinde (QR ile aynı); sunucuya/loga gitmez. Demo alanında hepsi kilitli: dokunuş sarı
// "yetkin yok" balonu + hata sesi. Kopyalama: kullanıcı kararı 21 Ekim — balon ve ses YOK; düğme 2 sn yeşil tik + "Kopyalandı", ekran
// okuyucuya `aria-live` duyurusu.
import { useTranslations } from "next-intl";
import { create as createQr } from "qrcode";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { SHICON } from "../../../design/paylas-icons.ts";
import { dz } from "../../../design/paylas-tokens.ts";
import { Ico, type ToastKind } from "../kalip/ekran.tsx";
import { feedback } from "@wms/ui";

export type JoinSay = (kind: ToastKind, text: string) => void;

export interface JoinShareInput {
  /** Yalnız üretildiği anda bilinen katılma adresi; yoksa paylaşılacak bir şey yok. */
  readonly url: string | null;
  readonly tenantName: string;
  readonly isDemo: boolean;
  readonly say: JoinSay;
}

/** `https://wa.me/?text=` + kodlanmış metin (bağlantıdaki `#` dahil). */
export function whatsappHref(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** `var(--x)` → çözülmüş renk (tuval düz renk ister; renk sabiti yazılmaz, belirteçten okunur). */
function resolve(el: Element, token: string): string {
  const name = /^var\((--[a-z-]+)\)$/.exec(token)?.[1];
  return name === undefined ? token : getComputedStyle(el).getPropertyValue(name).trim();
}

async function downloadPng(url: string, el: Element, file: string): Promise<boolean> {
  const m = createQr(url, { errorCorrectionLevel: "M" }).modules;
  const cell = 12;
  const quiet = 4;
  const px = (m.size + quiet * 2) * cell;
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const g = canvas.getContext("2d");
  if (g === null) return false;
  g.fillStyle = resolve(el, dz("FFFFFF"));
  g.fillRect(0, 0, px, px);
  g.fillStyle = resolve(el, dz("172E42"));
  for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (m.get(y, x)) g.fillRect((x + quiet) * cell, (y + quiet) * cell, cell, cell);
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
  if (blob === null) return false;
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = `${file}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  return true;
}

/** Alt çubuğun PAYLAŞ ana işlemi: sistem paylaşım sayfası (telefonda WhatsApp, Mesajlar, e-posta); yoksa paylaşma satırına odak. */
export function useJoinShare({ url, tenantName, isDemo, say }: JoinShareInput): { readonly share: () => void; readonly rowRef: RefObject<HTMLDivElement | null> } {
  const t = useTranslations("paylas");
  const rowRef = useRef<HTMLDivElement | null>(null);
  const focusRow = useCallback(() => {
    const row = rowRef.current;
    if (row === null) return;
    row.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    row.querySelector<HTMLElement>(".shc")?.focus({ preventScroll: true });
  }, []);
  const share = useCallback(() => {
    if (isDemo) {
      say("warn", t("locked"));
      return;
    }
    if (url === null) {
      feedback.error();
      say("info", t("needQr"));
      return;
    }
    if (typeof navigator.share !== "function") {
      feedback.minor();
      focusRow();
      say("info", t("pickBelow"));
      return;
    }
    feedback.minor();
    navigator.share({ title: t("title"), text: t("text", { tenant: tenantName, url }) }).then(
      () => {
        say("ok", t("shared"));
      },
      (e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return; // kullanıcı vazgeçti
        feedback.error();
        focusRow();
        say("warn", t("shareFailed"));
      },
    );
  }, [focusRow, isDemo, say, t, tenantName, url]);
  return { share, rowRef };
}

/** Kartın altındaki çip satırı: WhatsApp ile gönder · Bağlantıyı kopyala · QR'ı indir (PNG) · Yazdır. */
export function JoinShareRow({ url, tenantName, isDemo, say, dark, rowRef }: JoinShareInput & { readonly dark: boolean; readonly rowRef: RefObject<HTMLDivElement | null> }) {
  const t = useTranslations("paylas");
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => setCopied(false), [url]);
  const ready = url !== null && !isDemo;
  const text = url === null ? "" : t("text", { tenant: tenantName, url });
  const blocked = (): void => {
    feedback.error();
    if (isDemo) say("warn", t("locked"));
    else say("info", t("needQr"));
  };
  const cls = (k: string): string => `shc ${k}${ready ? "" : " lock"}`;
  const lockBadge = isDemo ? (
    <b className="lk" aria-hidden="true">
      <Ico d={SHICON.lock} size={12} />
    </b>
  ) : null;

  async function copy(): Promise<void> {
    if (!ready || url === null) return blocked();
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      say("err", t("copyFailed"));
      return;
    }
    // Kullanıcı kararı 21 Ekim: ses ve balon yok — düğmenin kendisi 2 sn "Kopyalandı".
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2000);
  }

  async function png(): Promise<void> {
    if (!ready || url === null || rowRef.current === null) return blocked();
    let ok = false;
    try {
      ok = await downloadPng(url, rowRef.current, t("file"));
    } catch {
      ok = false;
    }
    say(ok ? "ok" : "err", ok ? t("pngDone") : t("pngFailed"));
  }

  return (
    <div className={`dzsh${dark ? " dz-dark" : ""}`} style={{ width: "100%" }}>
      <div ref={rowRef} className="shr" role="group" aria-label={t("rowLabel")} data-testid="join-share">
        {ready ? (
          <a className={cls("wa")} href={whatsappHref(text)} target="_blank" rel="noopener noreferrer" onClick={() => feedback.minor()} data-testid="share-whatsapp">
            <i>
              <Ico d={[SHICON.waA, SHICON.waB]} size={22} />
            </i>
            <span>{t("whatsapp")}</span>
          </a>
        ) : (
          <button type="button" className={cls("wa")} aria-disabled="true" onClick={blocked} data-testid="share-whatsapp">
            <i>
              <Ico d={[SHICON.waA, SHICON.waB]} size={22} />
            </i>
            <span>{t("whatsapp")}</span>
            {lockBadge}
          </button>
        )}
        <button type="button" className={`${cls("cp")}${copied ? " done" : ""}`} aria-disabled={ready ? undefined : "true"} onClick={() => void copy()} data-testid="share-copy">
          <i>
            <Ico d={copied ? SHICON.check : [SHICON.copyA, SHICON.copyB]} size={22} />
          </i>
          <span>{copied ? t("copied") : t("copy")}</span>
          {lockBadge}
        </button>
        <button type="button" className={cls("dl")} aria-disabled={ready ? undefined : "true"} onClick={() => void png()} data-testid="share-png">
          <i>
            <Ico d={[SHICON.downA, SHICON.downB]} size={22} />
          </i>
          <span>{t("png")}</span>
          {lockBadge}
        </button>
        <button
          type="button"
          className={cls("pr")}
          aria-disabled={ready ? undefined : "true"}
          onClick={() => {
            if (!ready) return blocked();
            feedback.minor();
            window.print();
          }}
          data-testid="share-print"
        >
          <i>
            <Ico d={SHICON.print} size={22} />
          </i>
          <span>{t("print")}</span>
          {lockBadge}
        </button>
      </div>
      <span className="sr-only" role="status" aria-live="polite" data-testid="share-live">
        {copied ? t("copiedLive") : ""}
      </span>
    </div>
  );
}
