"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

const KEY = "etkinwms.guide.v1";
export function FirstUseGuide() {
  const t = useTranslations("guide");
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState(0);
  useEffect(() => {
    try { if (localStorage.getItem(KEY) !== "seen") dialog.current?.showModal(); } catch { /* Rehber düğmeden açılabilir. */ }
  }, []);
  function close() {
    try { localStorage.setItem(KEY, "seen"); } catch { /* Depolama gerekli değildir. */ }
    dialog.current?.close();
  }
  return <>
    <button type="button" className="guide-trigger" onClick={() => { setStep(0); dialog.current?.showModal(); }}>{t("label")}</button>
    <dialog ref={dialog} className="guide-dialog" aria-labelledby="guide-title" onCancel={close}>
      <div className="guide-heading"><span>{t("progress", { current: step + 1, total: 3 })}</span><button type="button" onClick={close} aria-label={t("skip")}>×</button></div>
      <p className="guide-kicker">ETKİN WMS</p><h2 id="guide-title">{t("title")}</h2><p className="guide-intro">{t("intro")}</p>
      <div className={`guide-step guide-step-${step}`}><span className="guide-step-number" aria-hidden="true">{step + 1}</span><h3>{t(`steps.${step}.title`)}</h3><p>{t(`steps.${step}.text`)}</p></div>
      <div className="guide-dots" aria-hidden="true">{[0,1,2].map(n => <span key={n} className={n === step ? "selected" : ""} />)}</div>
      <button type="button" className="guide-next" onClick={() => step < 2 ? setStep(step + 1) : close()}>{t(step < 2 ? "next" : "done")} →</button>
      <button type="button" className="guide-skip" onClick={close}>{t("skip")}</button>
    </dialog>
  </>;
}
