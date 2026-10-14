"use client";
// İlk kullanım rehberi (T-903c) — T-912: tetikleyici artık ekranın üstünde yüzmez (içeriği ve "Yeni ürün" gibi yapışkan
// düğmeleri örtüyordu). Rehber penceresi kök düzende kalır; `GuideTrigger` düğmesi üst çubuğa ve mobil menüye
// yerleştirilir ve bir pencere olayıyla rehberi açar.
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";

const KEY = "etkinwms.guide.v1";
const OPEN_EVENT = "etkinwms:guide-open";

/** Rehberi açan düğme; görünümü çağıranın sınıfıyla (üst çubuk hapı / menü satırı). */
export function GuideTrigger({ className, iconOnly = false }: { className: string; iconOnly?: boolean }) {
  const t = useTranslations("guide");
  return (
    <button
      type="button"
      className={className}
      data-testid="guide-trigger"
      aria-label={iconOnly ? t("label") : undefined}
      onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
    >
      {iconOnly ? <span aria-hidden="true">?</span> : t("label")}
    </button>
  );
}

export function FirstUseGuide() {
  const t = useTranslations("guide");
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState(0);
  const pathname = usePathname();
  // T-983: giriş ekranı sade kalır (üst bar yok); ilk rehber girişten sonraki ilk ekranda açılır.
  useEffect(() => {
    if (pathname === "/login") return;
    try { if (localStorage.getItem(KEY) !== "seen" && !dialog.current?.open) dialog.current?.showModal(); } catch { /* Rehber düğmeden açılabilir. */ }
  }, [pathname]);
  useEffect(() => {
    const onOpen = () => {
      setStep(0);
      if (!dialog.current?.open) dialog.current?.showModal();
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);
  function close() {
    try { localStorage.setItem(KEY, "seen"); } catch { /* Depolama gerekli değildir. */ }
    dialog.current?.close();
  }
  return (
    <dialog ref={dialog} className="guide-dialog" aria-labelledby="guide-title" onCancel={close}>
      <div className="guide-heading"><span>{t("progress", { current: step + 1, total: 3 })}</span><button type="button" onClick={close} aria-label={t("skip")}>×</button></div>
      <p className="guide-kicker">ETKİN WMS</p><h2 id="guide-title">{t("title")}</h2><p className="guide-intro">{t("intro")}</p>
      <div className={`guide-step guide-step-${step}`}><span className="guide-step-number" aria-hidden="true">{step + 1}</span><h3>{t(`steps.${step}.title`)}</h3><p>{t(`steps.${step}.text`)}</p></div>
      <div className="guide-dots" aria-hidden="true">{[0,1,2].map(n => <span key={n} className={n === step ? "selected" : ""} />)}</div>
      <button type="button" className="guide-next" onClick={() => step < 2 ? setStep(step + 1) : close()}>{t(step < 2 ? "next" : "done")} →</button>
      <button type="button" className="guide-skip" onClick={close}>{t("skip")}</button>
    </dialog>
  );
}
