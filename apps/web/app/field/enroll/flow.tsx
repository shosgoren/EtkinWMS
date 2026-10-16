"use client";
// I-18 (DESIGN-PARITY): Giris.dc.html `v.auth` kabuğu + `v.enr` (ortak cihaz terminal kaydı; T-998 tasarım eki, kaynak 1792177264-a9d9)
// BİREBİR: 1 cihaz adı → KAYDI İSTE (`/api/auth/field/enroll`) → 2 "Onay bekleniyor" (cihaz durumu 3 sn'de bir; yönetici onaylayınca
// ilerler) → 3 hazır. Kayıt belirteci adresin `#` parçasından okunur ve hemen adres çubuğundan silinir (geçmişte/ekranda kalmaz).
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { authClient, authPost } from "../../../lib/auth-client.ts";
import { DzRoot, useDz } from "../../design/dz-root.tsx";
import { C, dz } from "../../design/giris-tokens.ts";
import { GICON } from "../../design/giris-icons.ts";
import { Ico, Shell } from "../flow.tsx";

function Flow() {
  const t = useTranslations("fieldLogin");
  const { dark } = useDz();
  const secret = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState(() => t("deviceNameDefault"));
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const h = window.location.hash.replace(/^#/, "");
    secret.current = /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/i.test(h) ? h : null;
    if (secret.current === null) setBad(true);
    // Belirteç adres çubuğunda ve geçmişte kalmasın.
    try {
      window.history.replaceState(null, "", window.location.pathname);
    } catch {
      // geçmiş API yok
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (step !== 2) return;
    const timer = setInterval(() => {
      void authClient
        .$fetch<{ registered: boolean }>("/field/device", { method: "GET" })
        .then((r) => {
          if (r.data?.registered === true) setStep(3);
        })
        .catch(() => undefined);
    }, 3000);
    return () => clearInterval(timer);
  }, [step]);

  async function request(): Promise<void> {
    if (secret.current === null) return;
    setBusy(true);
    const r = await authPost<{ ok: boolean }>("/field/enroll", { enrollment: secret.current, deviceName: name.trim() });
    setBusy(false);
    if (!r.ok) {
      setBad(true);
      return;
    }
    secret.current = null;
    setStep(2);
  }

  const bars = [1, 2].map((i) => (i <= step ? (dark ? dz("F4C542") : dz("172E42")) : C.track));
  const head = [t("enr1H"), t("enr2H"), t("enr3H")][step - 1];
  return (
    <Shell fact={false}>
      <span className="kick">{step < 3 ? t("enrKick", { n: step }) : t("enrDone")}</span>
      <div className="steps" aria-hidden="true">
        {bars.map((bg, i) => (
          <i key={i} style={{ background: bg }} />
        ))}
      </div>
      <h1 className="lh">{head}</h1>
      <p className="ls">{step === 1 ? t("enr1S") : ""}</p>
      {step === 1 ? (
        <div className="card" style={{ background: C.surface }}>
          <div className="fl">
            <label htmlFor="g-dn">{t("deviceNameLabel")}</label>
            <div className="inp" style={{ background: C.chip }}>
              <Ico d={GICON.term} size={22} style={{ opacity: 0.6 }} />
              <input id="g-dn" type="text" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <span className="hint">{t("deviceNameHint")}</span>
          </div>
        </div>
      ) : null}
      {step === 2 ? (
        <div className="done" style={{ background: C.surface }}>
          <span className="okc" style={{ background: dz("F4B400"), color: dz("1A1300") }}>
            <Ico d={GICON.clock} size={44} sw={2.6} />
          </span>
          <b style={{ font: "800 26px/1.1 var(--font-bricolage), sans-serif" }}>{t("waitTitle")}</b>
          <p className="ls" style={{ margin: 0 }}>
            {t.rich("waitBody", { name: name.trim(), b: (c) => <b>{c}</b> })}
          </p>
          <span className="chip" style={{ background: C.chip }}>
            {t("waitChip")}
          </span>
        </div>
      ) : null}
      {step === 3 ? (
        <div className="done" style={{ background: C.surface }}>
          <span className="okc">
            <Ico d={GICON.check} size={44} sw={3.2} />
          </span>
          <b style={{ font: "800 26px/1.1 var(--font-bricolage), sans-serif" }}>{t("enrDoneTitle")}</b>
          <p className="ls" style={{ margin: 0 }}>
            {t("enrDoneBody")}
          </p>
          <span className="chip" style={{ background: C.chip }}>
            {t("enrDoneChip")}
          </span>
        </div>
      ) : null}
      {bad && ready ? (
        <span className="hint bad" role="alert">
          <Ico d={GICON.warn} size={16} />
          {t("enrBad")}
        </span>
      ) : null}
      {step !== 2 ? (
        <div className="act" style={{ background: C.bg }}>
          <button
            type="button"
            className="big"
            style={{ background: dz("172E42"), color: dz("FFFFFF") }}
            disabled={step === 1 && (busy || bad || !ready || name.trim() === "")}
            onClick={() => (step === 3 ? window.location.assign("/field") : void request())}
          >
            {step === 3 ? t("toLogin") : t("request")}
            <Ico d={GICON.next} size={24} sw={3} />
          </button>
        </div>
      ) : null}
    </Shell>
  );
}

export function EnrollDevice({ dark }: { dark: boolean }) {
  return (
    <DzRoot dark={dark} scope="dzg" testId="field-enroll">
      <Flow />
    </DzRoot>
  );
}
