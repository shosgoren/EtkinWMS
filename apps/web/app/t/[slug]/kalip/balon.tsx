"use client";
// T-436 (ALTIN-KURAL 5, 10, 11): uygulamanın TEK balon katmanı. Ekranlar balonu `feedback.*` / `balonGoster` (@wms/ui) ile açar;
// kök düzende bir kez çizilen bu katman kaynak `.toast` görünümünü (ikon dairesi + kısa metin) verir, kendi sesini çalar (balonGoster)
// ve kalıcı `aria-live` bölgesidir (ekran okuyucu her durum değişikliğini duyurur). Açık pencerelerin üstünde kalsın diye üst katmanda
// (popover) açılır. "Geri al" gibi eylemli balon birkaç saniye kalır; eylem bir kez çalışır.
import { useCallback, useEffect, useRef, useState } from "react";
import { BALON_OLAY, type BalonIstek, type BalonTur } from "@wms/ui";
import { LICON } from "../../../design/kalip-icons.ts";

const IKON: Readonly<Record<BalonTur, string>> = { ok: LICON.check, err: LICON.close, warn: LICON.warn, info: LICON.info };

function koyuMu(): boolean {
  try {
    return document.querySelector(".dz-dark") !== null;
  } catch {
    return false;
  }
}

export function BalonKatmani() {
  const [balon, setBalon] = useState<(BalonIstek & { readonly n: number; readonly dark: boolean }) | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const host = useRef<HTMLDivElement>(null);
  const sayac = useRef(0);
  const [calisiyor, setCalisiyor] = useState(false);

  useEffect(() => {
    const on = (e: Event): void => {
      const d = (e as CustomEvent<BalonIstek>).detail;
      if (d === undefined || d === null || typeof d.metin !== "string") return;
      window.clearTimeout(timer.current);
      sayac.current += 1;
      setCalisiyor(false);
      setBalon({ ...d, n: sayac.current, dark: koyuMu() });
      timer.current = window.setTimeout(() => setBalon(null), d.sure ?? (d.eylem === undefined ? 2600 : 6000));
    };
    window.addEventListener(BALON_OLAY, on);
    return () => {
      window.removeEventListener(BALON_OLAY, on);
      window.clearTimeout(timer.current);
    };
  }, []);

  // Üst katman: açık `<dialog>` (showModal) varken de görünür. Her yeni balonda yeniden açılır (en üste gelir).
  useEffect(() => {
    const el = host.current as (HTMLDivElement & { showPopover?: () => void; hidePopover?: () => void }) | null;
    if (el === null || typeof el.showPopover !== "function") return;
    try {
      if (el.matches(":popover-open")) el.hidePopover?.();
      el.showPopover();
    } catch {
      /* popover yok: sabit konum yeter */
    }
  }, [balon]);

  const eylem = useCallback(async () => {
    if (balon?.eylem === undefined || calisiyor) return;
    setCalisiyor(true);
    window.clearTimeout(timer.current);
    try {
      await balon.eylem.yap();
    } finally {
      setBalon((b) => (b !== null && b.n === balon.n ? null : b));
      setCalisiyor(false);
    }
  }, [balon, calisiyor]);

  return (
    // Kalıcı canlı bölge (her zaman açık, boşken görünmez); yeni balonda üst katmanın en üstüne yeniden alınır.
    <div ref={host} className={`kbl${balon?.dark === true ? " dk" : ""}`} {...{ popover: "manual" }} role="status" aria-live="polite" aria-atomic="true" data-testid="balon">
      {balon === null ? null : (
        <div key={balon.n} className="kbl-b" data-tur={balon.tur} data-testid="kalip-toast">
          <i aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path d={IKON[balon.tur]} />
            </svg>
          </i>
          <span>{balon.metin}</span>
          {balon.eylem === undefined ? null : (
            <button type="button" onClick={() => void eylem()} disabled={calisiyor} aria-busy={calisiyor || undefined} data-testid="balon-eylem">
              {balon.eylem.etiket}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
