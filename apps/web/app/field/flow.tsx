"use client";
// I-18 (DESIGN-PARITY): Giris.dc.html `v.auth` kabuğu + `v.login`/`v.loginField` (SAHA GİRİŞİ sekmesi) ve `v.fact` (saha etkinleştirme)
// BİREBİR. Sınıf adları, öğe sırası, ikon yolları ve metinler kaynaktan; CSS `app/design/giris.css` (üretilmiş). E-POSTA sekmesi mevcut
// e-posta giriş sayfasına gider. Kaynaktaki "Bu cihazdaki personelden seç" (ortak cihaz, T-998) ve önizleme anahtarı bu ekranda yoktur.
// Akış (ADR-026 §7.4–7.5): kayıtlı cihazda alan + kullanıcı adı + 6 hane PIN → `/api/auth/field/sign-in`; kayıtsız cihazda etkinleştirme
// kodu → PIN iki kez → `/api/auth/field/activate` (cihaz kaydı + oturum). PIN ve kod yalnız bu bileşenin belleğinde yaşar.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { authClient, authPost } from "../../lib/auth-client.ts";
import { DzRoot, useDz } from "../design/dz-root.tsx";
import { C, dz } from "../design/giris-tokens.ts";
import { GICON } from "../design/giris-icons.ts";
import { pinProblem } from "./pin.ts";

type Device =
  | { readonly registered: false }
  | { readonly registered: true; readonly workspace: string; readonly tenantName: string; readonly deviceName: string; readonly shared: boolean };
interface StaffPick {
  readonly name: string;
  readonly username: string;
  readonly role: "PICKER" | "COUNTER";
}
type FactStep = 1 | 2 | 3 | 4;

const WS_KEY = "wms.field.workspace";

export function Ico({ d, size, sw, style }: { d: string; size: number; sw?: number; style?: CSSProperties }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={sw === undefined ? style : { strokeWidth: sw, ...style }}>
      <path d={d} />
    </svg>
  );
}

function readWs(): string {
  try {
    return window.localStorage.getItem(WS_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveWs(v: string): void {
  try {
    window.localStorage.setItem(WS_KEY, v);
  } catch {
    // depolama kapalı: alan her seferinde yazılır
  }
}

export function buzz(): void {
  try {
    navigator.vibrate?.([80, 40, 80]);
  } catch {
    // titreşim yok
  }
}

export function Shell({ fact, children }: { fact: boolean; children: ReactNode }) {
  const t = useTranslations("fieldLogin");
  const { toggleTheme } = useDz();
  const rows = fact
    ? [
        [GICON.phone, t("factSideR1")],
        [GICON.lock, t("factSideR2")],
        [GICON.check, t("factSideR3")],
      ]
    : [
        [GICON.mail, t("sideR1")],
        [GICON.term, t("sideR2")],
        [GICON.lock, t("sideR3")],
      ];
  return (
    <div className="lp" style={{ background: C.bg, color: C.fg }}>
      <aside className="lside" aria-hidden="true">
        <div className="brand">
          <svg width="34" height="34" viewBox="0 0 120 120" aria-hidden="true" style={{ flex: "none", display: "block" }}>
            <rect x="4" y="4" width="112" height="112" rx="28" fill={dz("FFFFFF")} />
            <path d={GICON.logo} fill="none" stroke={dz("172E42")} strokeWidth="13" strokeLinecap="round" />
            <circle r="12" fill={dz("F2C53D")} stroke={dz("FFFFFF")} strokeWidth="4">
              <animateMotion dur="3.2s" repeatCount="indefinite" path={GICON.logo} />
            </circle>
          </svg>
          <b>{t("brand")}</b>
        </div>
        <div>
          <h2 className="lside-h">{fact ? t("factSideH") : t("sideH")}</h2>
          <p className="lside-p">{fact ? t("factSideP") : t("sideP")}</p>
        </div>
        <div className="lside-f">
          {rows.map(([d, l]) => (
            <div key={l} className="lside-r">
              <i>
                <svg className="ico" width="18" height="18" viewBox="0 0 24 24">
                  <path d={d} />
                </svg>
              </i>
              {l}
            </div>
          ))}
        </div>
      </aside>
      <div className="lmain">
        <div className="lscroll">
          <div className="lin">
            <div className="brand">
              <svg width="28" height="28" viewBox="0 0 120 120" aria-hidden="true" style={{ flex: "none", display: "block" }}>
                <rect x="4" y="4" width="112" height="112" rx="28" fill={C["logo-bg"]} />
                <path d={GICON.logo} fill="none" stroke={C["logo-fg"]} strokeWidth="13" strokeLinecap="round" />
                <circle r="12" fill={dz("F2C53D")} stroke={C["logo-bg"]} strokeWidth="4">
                  <animateMotion dur="3.2s" repeatCount="indefinite" path={GICON.logo} />
                </circle>
              </svg>
              <b>{t("brand")}</b>
              <button type="button" className="icb mode" style={{ background: C.surface }} onClick={toggleTheme} aria-label={t("theme")}>
                <Ico d={GICON.theme} size={22} />
              </button>
            </div>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Kaynaktaki `.dots` (+ hata satırı). */
export function PinDots({ pin, err, center }: { pin: string; err: string | null; center: boolean }) {
  const t = useTranslations("fieldLogin");
  return (
    <>
      <div className={`dots${err !== null ? " bad" : ""}`} role="img" aria-label={t("pinAria", { n: pin.length })}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <i key={i} className={i < pin.length ? "on" : ""} />
        ))}
      </div>
      {err !== null ? (
        <span className="hint bad" role="alert" style={center ? { justifyContent: "center" } : undefined}>
          {center ? null : <Ico d={GICON.warn} size={16} />}
          {err}
        </span>
      ) : null}
    </>
  );
}

/** Kaynaktaki `.pad` (12 tuş: 1–9, TEMİZLE, 0, SİL); 6. rakamda 160 ms sonra `onDone`. */
export function PinKeys({ pin, setPin, onDone, busy }: { pin: string; setPin: (p: string) => void; onDone: (p: string) => void; busy: boolean }) {
  const t = useTranslations("fieldLogin");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const press = (d: string) => () => {
    if (busy || pin.length >= 6) return;
    const p = pin + d;
    setPin(p);
    if (p.length === 6) {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => onDone(p), 160);
    }
  };
  const keys: { l: string; a: string; cls: string; bg: string; go: () => void }[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => ({ l: d, a: d, cls: "key", bg: C["key-bg"], go: press(d) }));
  keys.push({ l: t("clear"), a: t("clearAria"), cls: "key fn", bg: "transparent", go: () => setPin("") });
  keys.push({ l: "0", a: "0", cls: "key", bg: C["key-bg"], go: press("0") });
  keys.push({ l: t("del"), a: t("delAria"), cls: "key fn", bg: "transparent", go: () => setPin(pin.slice(0, -1)) });
  return (
    <div className="pad" role="group" aria-label={t("pad")}>
      {keys.map((k) => (
        <button key={k.a} type="button" className={k.cls} style={{ background: k.bg, color: C.fg }} onClick={k.go} aria-label={k.a} disabled={busy}>
          {k.l}
        </button>
      ))}
    </div>
  );
}

function errorText(t: ReturnType<typeof useTranslations>, code: string | undefined, status: number): string {
  if (code === "FIELD_LOGIN_LOCKED") return t("errLocked");
  if (code === "FIELD_RATE_LIMITED" || status === 429) return t("errRate");
  if (code === "FIELD_LOGIN_DENIED" || code === "FIELD_INPUT_INVALID" || status === 401 || status === 400) return t("errDenied");
  return t("errServer");
}

function Flow({ host }: { host: string }) {
  const t = useTranslations("fieldLogin");
  const { dark } = useDz();
  const [device, setDevice] = useState<Device | null>(null);
  const [scr, setScr] = useState<"login" | "fact" | "sw">("login");
  const [staff, setStaff] = useState<readonly StaffPick[] | null>(null);
  const [who, setWho] = useState<StaffPick | null>(null);
  const [ws, setWs] = useState("");
  const [user, setUser] = useState("");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [pin1, setPin1] = useState("");
  const [pinErr, setPinErr] = useState<string | null>(null);
  const [fs, setFs] = useState<FactStep>(1);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadDevice = useCallback(async () => {
    const r = await authClient.$fetch<{ registered: boolean; workspace?: string; tenantName?: string; deviceName?: string; kind?: string }>("/field/device", { method: "GET" }).catch(() => null);
    const d = r?.data;
    if (d?.registered === true && typeof d.workspace === "string") {
      setDevice({ registered: true, workspace: d.workspace, tenantName: d.tenantName ?? "", deviceName: d.deviceName ?? "", shared: d.kind === "SHARED" });
      setWs(d.workspace);
    } else {
      setDevice({ registered: false });
      setWs((v) => (v === "" ? readWs() : v));
    }
  }, []);
  useEffect(() => {
    void loadDevice();
  }, [loadDevice]);

  const wsNorm = ws.trim().toLowerCase();
  const userNorm = user.trim().toLowerCase();

  async function openSwitch(): Promise<void> {
    setScr("sw");
    setWho(null);
    setPin("");
    setPinErr(null);
    const r = await authClient.$fetch<{ staff: StaffPick[] }>("/field/staff", { method: "GET" }).catch(() => null);
    setStaff(r?.data?.staff ?? []);
  }

  async function signIn(p: string, as?: string): Promise<void> {
    const userFor = as ?? userNorm;
    if (wsNorm === "" || userFor === "") {
      buzz();
      setPin("");
      setPinErr(t("errFill"));
      return;
    }
    setBusy(true);
    const r = await authPost<{ ok: boolean }>("/field/sign-in", { workspace: wsNorm, username: userFor, pin: p });
    if (r.ok) {
      saveWs(wsNorm);
      window.location.assign(`/t/${encodeURIComponent(wsNorm)}`);
      return;
    }
    setBusy(false);
    buzz();
    setPin("");
    setPinErr(errorText(t, r.error.code, r.error.status));
  }

  async function activate(p: string): Promise<void> {
    setBusy(true);
    const r = await authPost<{ ok: boolean }>("/field/activate", { workspace: wsNorm, username: userNorm, code, pin: p, deviceName: t("deviceName") });
    setBusy(false);
    setPin("");
    setPin1("");
    if (r.ok) {
      saveWs(wsNorm);
      setCode("");
      setFs(4);
      return;
    }
    buzz();
    setFs(1);
    setErr(r.error.code === "FIELD_RATE_LIMITED" || r.error.status === 429 ? t("errRate") : r.error.status === 0 || r.error.status >= 500 ? t("errServer") : t("errActivate"));
  }

  function factPin(p: string): void {
    if (fs === 2) {
      if (pinProblem(p) !== null) {
        buzz();
        setPin("");
        setPinErr(t("pinEasy"));
        return;
      }
      setPin1(p);
      setPin("");
      setPinErr(null);
      setFs(3);
      return;
    }
    if (p !== pin1) {
      buzz();
      setPin("");
      setPinErr(t("pinMismatch"));
      return;
    }
    setPinErr(null);
    void activate(p);
  }

  const toLogin = (): void => {
    setScr("login");
    setFs(1);
    setPin("");
    setPin1("");
    setPinErr(null);
    setErr(null);
    void loadDevice();
  };

  if (scr === "sw" && device !== null && device.registered) {
    // Kaynak `v.sw` (ortak cihazda hızlı kullanıcı değişimi). Bekleyen çevrimdışı iş bandı: uygulamada çevrimdışı kuyruk yok (T-998 notu).
    const tones: readonly (readonly [string, string])[] = [
      ["FFE7A8", "4A3500"],
      ["CFE8DA", "0F3D27"],
      ["DCE4F8", "1C2E5C"],
      ["F6D9C9", "5C2410"],
    ];
    const ini = (n: string): string =>
      n
        .split(" ")
        .map((x) => x.charAt(0))
        .join("")
        .slice(0, 2)
        .toLocaleUpperCase("tr-TR");
    return (
      <Shell fact={false}>
        <span className="kick">{`${device.deviceName} · ${device.tenantName}`.toLocaleUpperCase("tr-TR")}</span>
        <h1 className="lh">{who === null ? t("swH") : t("swPinH", { name: who.name })}</h1>
        {who === null ? (
          <div className="rows">
            {staff !== null && staff.length === 0 ? <span className="hint">{t("swEmpty")}</span> : null}
            {(staff ?? []).map((p, i) => {
              const tone = tones[i % tones.length] ?? ["FFE7A8", "4A3500"];
              return (
                <button
                  key={p.username}
                  type="button"
                  className="row"
                  style={{ background: C.surface }}
                  onClick={() => {
                    setWho(p);
                    setPin("");
                    setPinErr(null);
                  }}
                >
                  <span className="av" style={{ background: dz(tone[0]), color: dz(tone[1]) }}>
                    {ini(p.name)}
                  </span>
                  <span className="rt">
                    <b>{p.name}</b>
                    <span>{(p.role === "COUNTER" ? t("roleCounter") : t("rolePicker")).toLocaleUpperCase("tr-TR")}</span>
                  </span>
                  <Ico d={GICON.next} size={26} sw={3} />
                </button>
              );
            })}
          </div>
        ) : (
          <>
            <div className="card" style={{ background: C.surface }}>
              <PinDots pin={pin} err={pinErr} center />
              <PinKeys pin={pin} setPin={(p) => { setPin(p); setPinErr(null); }} onDone={(p) => void signIn(p, who.username)} busy={busy} />
            </div>
            <button type="button" className="lnk" onClick={() => { setWho(null); setPin(""); setPinErr(null); }}>
              {t("swBack")}
            </button>
          </>
        )}
      </Shell>
    );
  }

  if (scr === "fact") {
    const bars = [1, 2, 3].map((i) => (i <= fs ? (dark ? dz("F4C542") : dz("172E42")) : C.track));
    const head = [t("f1H"), t("f2H"), t("f3H"), t("f4H")][fs - 1];
    const sub = [t("f1S"), t("f2S"), t("f3S"), ""][fs - 1];
    const canNext = fs === 4 || (wsNorm.length >= 3 && userNorm.length >= 3 && code.replace(/[\s-]/g, "").length === 8);
    return (
      <Shell fact>
        <span className="kick">{fs < 4 ? t("step", { n: Math.min(fs, 3) }) : t("stepDone")}</span>
        <div className="steps" aria-hidden="true">
          {bars.map((bg, i) => (
            <i key={i} style={{ background: bg }} />
          ))}
        </div>
        <h1 className="lh">{head}</h1>
        <p className="ls">{sub}</p>
        {fs === 1 ? (
          <div className="card" style={{ background: C.surface }}>
            <div className="fl">
              <label htmlFor="g-ws2">{t("workspace")}</label>
              <div className="inp" style={{ background: C.chip }}>
                <span className="pre">{`${host}/`}</span>
                <input id="g-ws2" type="text" value={ws} onChange={(e) => setWs(e.target.value)} />
              </div>
            </div>
            <div className="fl">
              <label htmlFor="g-user2">{t("username")}</label>
              <div className="inp" style={{ background: C.chip }}>
                <input id="g-user2" type="text" autoCapitalize="none" value={user} onChange={(e) => setUser(e.target.value)} />
              </div>
            </div>
            <div className="fl">
              <label htmlFor="g-code">{t("code")}</label>
              <div className="inp" style={{ background: C.chip }}>
                <input
                  id="g-code"
                  type="text"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={9}
                  placeholder="XXXX-XXXX"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  style={{ fontFamily: "var(--font-plex-mono), monospace", fontSize: "22px", letterSpacing: ".14em" }}
                />
              </div>
              <span className="hint">{t("codeHint")}</span>
            </div>
          </div>
        ) : null}
        {fs === 2 || fs === 3 ? (
          <div className="card" style={{ background: C.surface }}>
            <PinDots pin={pin} err={pinErr} center />
            <PinKeys pin={pin} setPin={(p) => { setPin(p); setPinErr(null); }} onDone={factPin} busy={busy} />
          </div>
        ) : null}
        {fs === 4 ? (
          <div className="done" style={{ background: C.surface }}>
            <span className="okc">
              <Ico d={GICON.check} size={44} sw={3.2} />
            </span>
            <b style={{ font: "800 26px/1.1 var(--font-bricolage), sans-serif" }}>{t("doneTitle")}</b>
            <p className="ls" style={{ margin: 0 }}>
              {t("doneBody")}
            </p>
            <span className="chip" style={{ background: C.chip }}>
              {t("doneChip")}
            </span>
          </div>
        ) : null}
        {err !== null && fs === 1 ? (
          <span className="hint bad" role="alert">
            <Ico d={GICON.warn} size={16} />
            {err}
          </span>
        ) : null}
        {fs === 1 || fs === 4 ? (
          <div className="act" style={{ background: C.bg }}>
            <button
              type="button"
              className="big ghost"
              style={{ background: C.chip, color: C.fg, flex: "0 0 auto", minWidth: "64px" }}
              onClick={fs === 1 ? toLogin : () => window.location.assign(`/t/${encodeURIComponent(wsNorm)}`)}
              aria-label={t("back")}
            >
              <Ico d={GICON.back} size={24} sw={3} />
            </button>
            <button
              type="button"
              className="big"
              style={{ background: dz("172E42"), color: dz("FFFFFF") }}
              disabled={!canNext || busy}
              onClick={() => {
                if (fs === 4) {
                  window.location.assign(`/t/${encodeURIComponent(wsNorm)}`);
                  return;
                }
                setErr(null);
                setPin("");
                setPinErr(null);
                setFs(2);
              }}
            >
              {fs === 4 ? t("goTasks") : t("next")}
              <Ico d={GICON.next} size={24} sw={3} />
            </button>
          </div>
        ) : null}
      </Shell>
    );
  }

  return (
    <Shell fact={false}>
      <h1 className="lh">{t("heading")}</h1>
      <div className="tabs" role="tablist" aria-label={t("tabsLabel")} style={{ background: C.chip }}>
        <button type="button" role="tab" className="tab" aria-selected="false" style={{ background: "transparent" }} onClick={() => window.location.assign("/login")}>
          <Ico d={GICON.mail} size={22} />
          {t("tabMail")}
        </button>
        <button type="button" role="tab" className="tab on" aria-selected="true" style={{ background: C.surface }}>
          <Ico d={GICON.term} size={22} />
          {t("tabField")}
        </button>
      </div>
      {device === null ? (
        <span className="hint" role="status">
          {t("checking")}
        </span>
      ) : device.registered ? (
        <>
          <div className="ban" style={{ background: C["ok-bg"], color: C["ok-fg"] }}>
            <Ico d={GICON.check} size={22} />
            <span>
              <b>{t("deviceOk", { name: device.deviceName })}</b>
              {device.tenantName.toLocaleUpperCase("tr-TR")}
            </span>
          </div>
          <div className="card" style={{ background: C.surface }}>
            <div className="fl">
              <label htmlFor="g-ws">{t("workspace")}</label>
              <div className="inp" style={{ background: C.chip }}>
                <span className="pre">{`${host}/`}</span>
                <input id="g-ws" type="text" autoComplete="organization" value={ws} onChange={(e) => setWs(e.target.value)} aria-describedby="g-ws-h" />
              </div>
              <span id="g-ws-h" className="hint">
                {t("workspaceHint")}
              </span>
            </div>
            <div className="fl">
              <label htmlFor="g-user">{t("username")}</label>
              <div className="inp" style={{ background: C.chip }}>
                <Ico d={GICON.user} size={22} style={{ opacity: 0.6 }} />
                <input id="g-user" type="text" autoComplete="username" autoCapitalize="none" value={user} onChange={(e) => setUser(e.target.value)} />
              </div>
            </div>
            <div className="fl">
              <span className="fll" id="g-pin-l">
                {t("pin")}
              </span>
              <PinDots pin={pin} err={pinErr} center={false} />
            </div>
            <PinKeys pin={pin} setPin={(p) => { setPin(p); setPinErr(null); }} onDone={(p) => void signIn(p)} busy={busy} />
          </div>
          {device.shared ? (
            <button type="button" className="lnk" onClick={() => void openSwitch()}>
              {t("pickStaff")}
            </button>
          ) : null}
        </>
      ) : (
        <>
          <div className="ban" style={{ background: dz("F4B400"), color: dz("1A1300") }}>
            <Ico d={GICON.warn} size={22} />
            <span>
              <b>{t("noDeviceTitle")}</b>
              {t("noDeviceBody")}
            </span>
          </div>
          <div className="act" style={{ background: C.bg }}>
            <button
              type="button"
              className="big"
              style={{ background: dz("172E42"), color: dz("FFFFFF") }}
              onClick={() => {
                setScr("fact");
                setFs(1);
                setErr(null);
              }}
            >
              <Ico d={GICON.lock} size={24} sw={2.8} />
              {t("haveCode")}
            </button>
          </div>
        </>
      )}
    </Shell>
  );
}

export function FieldSignIn({ dark, host }: { dark: boolean; host: string }) {
  return (
    <DzRoot dark={dark} scope="dzg" testId="field">
      <Flow host={host} />
    </DzRoot>
  );
}
