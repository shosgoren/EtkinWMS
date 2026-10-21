"use client";
// T-429 (Ekip.dc.html "personel kendi telefonuyla katılır"; görünüm Giris.dc.html `v.auth` kabuğu + `v.enr` adımları ile aynı):
// 1 ad + kullanıcı adı → KATILMAK İSTE (`/api/auth/field/join`) → 2 cihazda 6 haneli kod, "Onay bekleniyor" (3 sn'de bir durum) →
// 3 yönetici onaylayınca PIN iki kez → `/api/auth/field/join/activate` (kişisel cihaz + oturum). Katılma belirteci adresin `#` parçasından
// okunur ve hemen adres çubuğundan silinir; talep belirteci httpOnly çerezdedir (betik okuyamaz). PIN yalnız bu bileşenin belleğinde.
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { buyukHarf } from "@wms/ui";
import { authClient, authPost } from "../../../lib/auth-client.ts";
import { DzRoot, useDz } from "../../design/dz-root.tsx";
import { C, dz } from "../../design/giris-tokens.ts";
import { GICON } from "../../design/giris-icons.ts";
import { Ico, PinDots, PinKeys, Shell, buzz } from "../flow.tsx";
import { pinProblem } from "../pin.ts";

type Status = "NONE" | "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "CLAIMED" | "EXPIRED";
const CODE_KEY = "etkin-katilma-kod";

function Flow() {
  const t = useTranslations("fieldLogin");
  const locale = useLocale(); // T-1001 (ALTIN-KURAL 16): kullanıcının dili
  const { dark } = useDz();
  const secret = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [tenantName, setTenantName] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ended, setEnded] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [pin, setPin] = useState("");
  const [pin1, setPin1] = useState<string | null>(null);
  const [pinErr, setPinErr] = useState<string | null>(null);

  useEffect(() => {
    const h = window.location.hash.replace(/^#/, "");
    secret.current = /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/i.test(h) ? h : null;
    try {
      window.history.replaceState(null, "", window.location.pathname);
    } catch {
      // geçmiş API yok
    }
    void (async () => {
      // Önce bekleyen talep (sayfa yenilendiyse): çerez sunucuda okunur.
      const st = await authClient.$fetch<{ status: Status; workspace?: string; tenantName?: string }>("/field/join/status", { method: "GET" }).catch(() => null);
      const s = st?.data?.status ?? "NONE";
      if (s === "PENDING" || s === "APPROVED") {
        setTenantName(st?.data?.tenantName ?? "");
        setWorkspace(st?.data?.workspace ?? "");
        try {
          setCode(window.sessionStorage.getItem(CODE_KEY) ?? "");
        } catch {
          // depolama yok
        }
        setStep(s === "APPROVED" ? 3 : 2);
        setReady(true);
        return;
      }
      if (secret.current === null) {
        setEnded(s === "NONE" ? "EXPIRED" : s);
        setReady(true);
        return;
      }
      const r = await authPost<{ ok: boolean; tenantName?: string }>("/field/join/link", { join: secret.current });
      if (!r.ok) setEnded("EXPIRED");
      else setTenantName(r.data.tenantName ?? "");
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (step !== 2) return;
    const timer = setInterval(() => {
      void authClient
        .$fetch<{ status: Status; workspace?: string }>("/field/join/status", { method: "GET" })
        .then((r) => {
          const s = r.data?.status;
          if (s === "APPROVED") {
            setWorkspace(r.data?.workspace ?? "");
            setStep(3);
          } else if (s === "REJECTED" || s === "CANCELLED" || s === "EXPIRED" || s === "NONE") {
            setEnded(s);
          }
        })
        .catch(() => undefined);
    }, 3000);
    return () => clearInterval(timer);
  }, [step]);

  async function request(): Promise<void> {
    if (secret.current === null) return;
    setBusy(true);
    setErr(null);
    const r = await authPost<{ ok: boolean; confirmCode?: string }>("/field/join", {
      join: secret.current,
      name: name.trim(),
      username: username.trim(),
      deviceHint: t("deviceName"),
    });
    setBusy(false);
    if (!r.ok) {
      buzz();
      setErr(
        r.error.code === "FIELD_USERNAME_TAKEN"
          ? t("joinTaken")
          : r.error.code === "FIELD_INPUT_INVALID"
            ? t("joinInvalid")
            : r.error.code === "FIELD_RATE_LIMITED" || r.error.status === 429
              ? t("errRate")
              : t("joinBad"),
      );
      return;
    }
    const c = r.data.confirmCode ?? "";
    setCode(c);
    try {
      window.sessionStorage.setItem(CODE_KEY, c);
    } catch {
      // depolama yok
    }
    setStep(2);
  }

  async function activate(p: string): Promise<void> {
    setBusy(true);
    const r = await authPost<{ ok: boolean }>("/field/join/activate", { pin: p, deviceName: t("deviceName") });
    setBusy(false);
    setPin("");
    setPin1(null);
    if (!r.ok) {
      buzz();
      setPinErr(r.error.code === "FIELD_RATE_LIMITED" || r.error.status === 429 ? t("errRate") : t("joinActivateBad"));
      return;
    }
    try {
      window.sessionStorage.removeItem(CODE_KEY);
    } catch {
      // depolama yok
    }
    setStep(4);
    window.setTimeout(() => window.location.assign(workspace === "" ? "/field" : `/t/${encodeURIComponent(workspace)}`), 900);
  }

  function onPin(p: string): void {
    if (pin1 === null) {
      if (pinProblem(p) !== null) {
        buzz();
        setPin("");
        setPinErr(t("pinEasy"));
        return;
      }
      setPin1(p);
      setPin("");
      setPinErr(null);
      return;
    }
    if (p !== pin1) {
      buzz();
      setPin("");
      setPin1(null);
      setPinErr(t("pinMismatch"));
      return;
    }
    void activate(p);
  }

  const bars = [1, 2, 3].map((i) => (i <= step ? (dark ? dz("F4C542") : dz("172E42")) : C.track));
  const head = ended !== null ? t("joinEndedH") : [t("join1H"), t("join2H"), pin1 === null ? t("join3H") : t("join3H2"), t("joinDoneH")][step - 1];
  return (
    <Shell fact={false}>
      <span className="kick">{tenantName === "" ? t("joinKick") : buyukHarf(tenantName, locale)}</span>
      <div className="steps" aria-hidden="true">
        {bars.map((bg, i) => (
          <i key={i} style={{ background: bg }} />
        ))}
      </div>
      <h1 className="lh">{head}</h1>
      {ended !== null ? (
        <p className="ls" role="alert" data-testid="join-ended">
          {t(`joinEnded.${ended}`)}
        </p>
      ) : null}
      {ended === null && step === 1 ? (
        <>
          <p className="ls">{t("join1S")}</p>
          <div className="card" style={{ background: C.surface }}>
            <div className="fl">
              <label htmlFor="j-name">{t("joinNameLabel")}</label>
              <div className="inp" style={{ background: C.chip }}>
                <Ico d={GICON.user} size={22} style={{ opacity: 0.6 }} />
                <input id="j-name" type="text" maxLength={60} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} data-testid="join-name" />
              </div>
            </div>
            <div className="fl">
              <label htmlFor="j-user">{t("joinUserLabel")}</label>
              <div className="inp" style={{ background: C.chip }}>
                <Ico d={GICON.user} size={22} style={{ opacity: 0.6 }} />
                <input
                  id="j-user"
                  type="text"
                  maxLength={32}
                  autoCapitalize="none"
                  autoComplete="username"
                  spellCheck={false}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  data-testid="join-username"
                />
              </div>
              <span className="hint">{t("joinUserHint")}</span>
            </div>
          </div>
        </>
      ) : null}
      {ended === null && step === 2 ? (
        <div className="done" style={{ background: C.surface }} data-testid="join-wait">
          <span className="okc" style={{ background: dz("F4B400"), color: dz("1A1300") }}>
            <Ico d={GICON.clock} size={44} sw={2.6} />
          </span>
          <b style={{ font: "800 26px/1.1 var(--font-bricolage), sans-serif" }}>{t("waitTitle")}</b>
          {code !== "" ? (
            <span className="kcode" aria-label={t("codeAria")} data-testid="join-code">
              {`${code.slice(0, 3)} ${code.slice(3)}`}
            </span>
          ) : null}
          <p className="ls" style={{ margin: 0 }}>
            {t("joinWaitBody")}
          </p>
          <span className="chip" style={{ background: C.chip }}>
            {t("waitChip")}
          </span>
        </div>
      ) : null}
      {ended === null && step === 3 ? (
        <>
          <p className="ls">{pin1 === null ? t("join3S") : t("join3S2")}</p>
          <PinDots pin={pin} err={pinErr} center />
          <PinKeys
            pin={pin}
            setPin={(p) => {
              setPin(p);
              setPinErr(null);
            }}
            onDone={onPin}
            busy={busy}
          />
        </>
      ) : null}
      {ended === null && step === 4 ? (
        <div className="done" style={{ background: C.surface }} data-testid="join-done">
          <span className="okc">
            <Ico d={GICON.check} size={44} sw={3.2} />
          </span>
          <b style={{ font: "800 26px/1.1 var(--font-bricolage), sans-serif" }}>{t("joinDoneTitle")}</b>
        </div>
      ) : null}
      {err !== null ? (
        <span className="hint bad" role="alert">
          <Ico d={GICON.warn} size={16} />
          {err}
        </span>
      ) : null}
      {ended === null && step === 1 ? (
        <div className="act" style={{ background: C.bg }}>
          <button
            type="button"
            className="big"
            style={{ background: dz("172E42"), color: dz("FFFFFF") }}
            disabled={busy || !ready || name.trim() === "" || username.trim().length < 3}
            onClick={() => void request()}
            data-testid="join-request"
          >
            {t("joinRequest")}
            <Ico d={GICON.next} size={24} sw={3} />
          </button>
        </div>
      ) : null}
    </Shell>
  );
}

export function JoinTeam({ dark }: { dark: boolean }) {
  return (
    <DzRoot dark={dark} scope="dzg" testId="field-join">
      <Flow />
    </DzRoot>
  );
}
