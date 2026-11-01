"use client";
// I-18 (DESIGN-PARITY): Giris.dc.html `v.auth` kabuğu + `v.login`/`v.loginMail` (E-POSTA sekmesi) ve `v.mfa` (iki adımlı doğrulama) BİREBİR,
// T-999b tasarım ekleriyle (tuval 1792237021-ec8d, kullanıcı onayı 17 Ekim): hata bandı, e-posta biçimi uyarısı, Caps Lock uyarısı,
// "Bu cihazda e-postamı hatırla", Google/Microsoft (bayrakla), demo bandı; doğrulamada kod hatalı / kilitli / süre doldu bantları ve yedek
// kod. T-923 (kullanıcı kararı 20 Ekim 2026): doğrulama kartına "Bu cihazı 30 gün hatırla" onay kutusu (girişteki `.chk` ile aynı öğe). Kabuk saha girişiyle ortaktır (`field/flow.tsx` `Shell`); SAHA GİRİŞİ sekmesi `/field`'e gider. Önizleme `DURUM` çubuğu yoktur.
// Hesap varlığı sızdırılmaz: kayıtlı olmayan e-posta ile yanlış parola AYNI mesajı alır (kullanıcı kararı 17 Ekim). Kalan deneme hakkı
// e-posta başına sayaçtan gelir (`x-attempts-left`; kayıtlı/kayıtsız aynı). Parola yalnız form alanında yaşar; e-posta yalnız kullanıcı
// "hatırla" derse bu tarayıcıda saklanır.
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { tarih } from "@wms/ui";
import { authPost, type AuthCallError } from "../../lib/auth-client.ts";
import { DzRoot } from "../design/dz-root.tsx";
import { C, dz } from "../design/giris-tokens.ts";
import { GICON } from "../design/giris-icons.ts";
import { Ico, Shell } from "../field/flow.tsx";

const REMEMBER_KEY = "etkin.login.email";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Shown {
  readonly h: string;
  readonly t: string;
  readonly reset?: boolean;
  readonly code?: string | undefined;
}

function readRemembered(): string {
  try {
    return window.localStorage.getItem(REMEMBER_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeRemembered(email: string | null): void {
  try {
    if (email === null) window.localStorage.removeItem(REMEMBER_KEY);
    else window.localStorage.setItem(REMEMBER_KEY, email);
  } catch {
    // Tarayıcı depolaması kapalı: hatırlama sessizce atlanır.
  }
}

/** Bekleme süresi ve bitiş saati (kullanıcının saatiyle). */
function waitParts(seconds: number | undefined, locale: string): { readonly minutes: number; readonly time: string } | null {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return null;
  const until = new Date(Date.now() + seconds * 1000);
  const time = tarih(until, locale, { hour: "2-digit", minute: "2-digit", hour12: false });
  return { minutes: Math.max(1, Math.ceil(seconds / 60)), time };
}

function ErrBan({ e, onReset }: { e: Shown; onReset?: () => void }) {
  const t = useTranslations("auth.signin");
  return (
    <div className="ban err" role="alert" style={{ background: C["err-bg"], color: C["err-fg"] }}>
      <Ico d={GICON.warn} size={22} />
      <span>
        <b>{e.h}</b>
        {e.t}
        {e.code ? ` ${t("code", { code: e.code })}` : null}
        {e.reset && onReset ? (
          <>
            <br />
            <button type="button" className="blnk" onClick={onReset}>
              {t("reset")}
            </button>
          </>
        ) : null}
      </span>
    </div>
  );
}

function Tabs() {
  const t = useTranslations("auth.signin");
  return (
    <div className="tabs" role="tablist" aria-label={t("tabsLabel")} style={{ background: C.chip }}>
      <button type="button" role="tab" className="tab on" aria-selected="true" style={{ background: C.surface }}>
        <Ico d={GICON.mail} size={22} />
        {t("tabMail")}
      </button>
      <button type="button" role="tab" className="tab" aria-selected="false" style={{ background: "transparent" }} onClick={() => window.location.assign("/field")}>
        <Ico d={GICON.term} size={22} />
        {t("tabField")}
      </button>
    </div>
  );
}

function Login({ next, socialEnabled, demo, fieldTab, reauth }: { next: string; socialEnabled: boolean; demo: boolean; fieldTab: boolean; reauth: boolean }) {
  const t = useTranslations("auth.signin");
  const locale = useLocale(); // T-436 (ALTIN-KURAL 16): kullanıcının dili
  const [email, setEmail] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(false);
  const [caps, setCaps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [mailHint, setMailHint] = useState<string | null>(null);
  const [pwHint, setPwHint] = useState<string | null>(null);
  const [error, setError] = useState<Shown | null>(null);
  const pwRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setReady(true);
    const saved = readRemembered();
    if (saved !== "") {
      setEmail((cur) => (cur === "" ? saved : cur));
      setRemember(true);
    }
  }, []);

  const toReset = (): void => window.location.assign("/reset-password");

  function explain(e: AuthCallError): Shown {
    if (e.status === 0 || e.status >= 500) return { h: t("netH"), t: t("netT"), code: e.code ?? "INTERNAL" };
    if (e.status === 429 || e.code === "RATE_LIMITED") {
      const w = waitParts(e.retryAfterSec, locale);
      return { h: t("waitH"), t: w === null ? t("waitTSome") : t("waitT", { minutes: w.minutes, time: w.time }), reset: true };
    }
    // Güvenlik incelemesi m1: `EMAIL_NOT_VERIFIED` yalnız parola DOĞRUYSA döner; ayrı mesaj "hesap var ve parola doğru" bilgisini sızdırırdı.
    // Hesap varlığı sızdırılmaz kuralı gereği hatalı bilgi mesajıyla aynı gösterilir (tasarımdaki "doğrulanmamış" bandı kullanılmaz).
    const left = e.attemptsLeft;
    const tail = left === undefined ? "" : left > 0 ? ` ${t("left", { n: left })}` : ` ${t("leftNone")}`;
    return { h: t("invalidH"), t: `${t("invalidT")}${tail}`, reset: true };
  }

  async function onSubmit(ev: FormEvent<HTMLFormElement>): Promise<void> {
    ev.preventDefault();
    const mail = email.trim();
    const password = pwRef.current?.value ?? "";
    const mh = mail === "" ? t("mailEmpty") : EMAIL_RE.test(mail) ? null : t("mailBad");
    const ph = password === "" ? t("pwEmpty") : null;
    setMailHint(mh);
    setPwHint(ph);
    setError(null);
    if (mh !== null || ph !== null) return;
    setBusy(true);
    // T-923 (A-39): hassas işlem yeniden doğrulamasında güvenilen cihaz çerezi sunucuda yok sayılır → doğrulama kodu yine sorulur.
    const res = await authPost<{ readonly twoFactorRedirect?: boolean }>("/sign-in/email", { email: mail, password }, reauth ? { "x-wms-reauth": "1" } : undefined);
    if (res.ok) {
      writeRemembered(remember ? mail : null);
      // Tam gezinme: sunucu bileşenleri yeni çerezle yeniden çizilir. `next` sunucuda `safeNext`'ten geçmiştir.
      window.location.assign(res.data.twoFactorRedirect === true ? `/mfa?next=${encodeURIComponent(next)}` : next);
      return;
    }
    setBusy(false);
    setError(explain(res.error));
  }

  async function onSocial(provider: "google" | "microsoft"): Promise<void> {
    setBusy(true);
    setError(null);
    const res = await authPost<{ url?: string }>("/sign-in/social", { provider, callbackURL: next });
    if (res.ok && typeof res.data.url === "string") {
      window.location.assign(res.data.url);
      return;
    }
    setBusy(false);
    setError(res.ok ? { h: t("netH"), t: t("netT") } : explain(res.error));
  }

  const capsKey = (e: KeyboardEvent<HTMLInputElement>): void => setCaps(e.getModifierState("CapsLock"));

  return (
    <Shell fact={false}>
      <h1 className="lh">{t("heading")}</h1>
      {/* Panel yüzeyinde saha girişi yoktur (ADR-027): sekme çubuğu çizilmez. */}
      {fieldTab ? <Tabs /> : null}
      {demo ? (
        <div className="ban" style={{ background: dz("F4B400"), color: dz("1A1300") }}>
          <Ico d={GICON.warn} size={22} />
          <span>
            <b>{t("demoH")}</b>
            {t("demoT")}
          </span>
        </div>
      ) : null}
      {error !== null ? <ErrBan e={error} onReset={toReset} /> : null}
      <form method="post" noValidate onSubmit={(e) => void onSubmit(e)} style={{ display: "contents" }} aria-busy={busy || !ready}>
        <div className="card" style={{ background: C.surface }}>
          <div className="fl">
            <label htmlFor="g-mail">{t("email")}</label>
            <div className={mailHint === null ? "inp" : "inp bad"} style={{ background: C.chip }}>
              <Ico d={GICON.mail} size={22} style={{ opacity: 0.6 }} />
              <input
                id="g-mail"
                name="email"
                disabled={!ready}
                type="email"
                autoComplete="username"
                placeholder="ad@firma.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.currentTarget.value);
                  if (mailHint !== null) setMailHint(null);
                }}
                aria-invalid={mailHint !== null}
                aria-describedby={mailHint === null ? undefined : "g-mail-h"}
              />
            </div>
            {mailHint !== null ? (
              <span id="g-mail-h" className="hint bad" role="alert">
                <Ico d={GICON.warn} size={16} />
                {mailHint}
              </span>
            ) : null}
          </div>
          <div className="fl">
            <label htmlFor="g-pw">{t("password")}</label>
            <div className={pwHint === null ? "inp" : "inp bad"} style={{ background: C.chip }}>
              <Ico d={GICON.lock} size={22} style={{ opacity: 0.6 }} />
              <input
                id="g-pw"
                ref={pwRef}
                name="password"
                disabled={!ready}
                type={showPw ? "text" : "password"}
                autoComplete="current-password"
                placeholder={t("passwordPh")}
                onKeyDown={capsKey}
                onKeyUp={capsKey}
                onBlur={() => setCaps(false)}
                onChange={() => {
                  if (pwHint !== null) setPwHint(null);
                }}
                aria-invalid={pwHint !== null}
                aria-describedby={pwHint === null ? undefined : "g-pw-h"}
              />
              <button type="button" className="eye" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? t("hidePw") : t("showPw")}>
                <Ico d={showPw ? GICON.eyeOff : GICON.eye} size={22} />
              </button>
            </div>
            {pwHint !== null ? (
              <span id="g-pw-h" className="hint bad" role="alert">
                <Ico d={GICON.warn} size={16} />
                {pwHint}
              </span>
            ) : null}
            {caps ? (
              <span className="hint warn" role="status">
                <Ico d={GICON.caps} size={16} />
                {t("caps")}
              </span>
            ) : null}
          </div>
          <button type="button" role="checkbox" className={remember ? "chk on" : "chk"} aria-checked={remember} onClick={() => setRemember((v) => !v)}>
            <i>
              <Ico d={GICON.check} size={16} sw={3.2} />
            </i>
            {t("remember")}
          </button>
          <button type="button" className="lnk" onClick={toReset}>
            {t("forgot")}
          </button>
        </div>
        {socialEnabled ? (
          <>
            <div className="or">{t("or")}</div>
            <div className="soc">
              <button type="button" className="big ghost sm" style={{ background: C.surface, color: C.fg }} disabled={busy} onClick={() => void onSocial("google")}>
                {t("google")}
              </button>
              <button type="button" className="big ghost sm" style={{ background: C.surface, color: C.fg }} disabled={busy} onClick={() => void onSocial("microsoft")}>
                {t("microsoft")}
              </button>
            </div>
          </>
        ) : null}
        <div className="ban" style={{ background: C.chip }}>
          <Ico d={GICON.clock} size={22} />
          <span>
            <b>{t("findH")}</b>
            {t("findT")}
          </span>
        </div>
        <div className="act" style={{ background: C.bg }}>
          {/* Görünen metin büyük harf (kaynak "GİRİŞ YAP"); erişilebilir ad "Giriş yap" (tr büyük harf dönüşümü CSS'te). */}
          <button type="submit" className="big" style={{ background: dz("172E42"), color: dz("FFFFFF"), textTransform: "uppercase" }} disabled={busy || !ready}>
            {t("submit")}
            <Ico d={GICON.next} size={24} sw={3} />
          </button>
        </div>
      </form>
    </Shell>
  );
}

function Mfa({ next, trustOption }: { next: string; trustOption: boolean }) {
  const t = useTranslations("auth.verify");
  const locale = useLocale(); // T-436 (ALTIN-KURAL 16): kullanıcının dili
  const [backup, setBackup] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  // T-923: "Bu cihazı 30 gün hatırla" — varsayılan kapalı; hassas işlemlerde kod yine sorulur.
  const [trust, setTrust] = useState(false);
  const [error, setError] = useState<(Shown & { readonly kind: "bad" | "locked" | "expired" | "net" }) | null>(null);

  function explain(e: AuthCallError): Shown & { readonly kind: "bad" | "locked" | "expired" | "net" } {
    if (e.status === 0 || e.status >= 500) return { kind: "net", h: t("netH"), t: t("netT"), code: e.code ?? "INTERNAL" };
    if (e.status === 429 || e.code === "RATE_LIMITED" || (e.code ?? "").startsWith("TOO_MANY")) {
      const w = waitParts(e.retryAfterSec, locale);
      return { kind: "locked", h: t("lockedH", { minutes: w?.minutes ?? 15 }), t: w === null ? t("lockedTSome") : t("lockedT", { time: w.time }) };
    }
    if (/COOKIE|SESSION/.test(e.code ?? "")) return { kind: "expired", h: t("expiredH"), t: t("expiredT") };
    return { kind: "bad", h: t("badH"), t: backup ? t("badBackupT") : t("badT") };
  }

  async function onSubmit(ev: FormEvent<HTMLFormElement>): Promise<void> {
    ev.preventDefault();
    const value = code.replace(/\s+/g, "");
    if (value === "") {
      setError({ kind: "bad", h: t("emptyH"), t: backup ? t("emptyBackupT") : t("emptyT") });
      return;
    }
    setBusy(true);
    setError(null);
    const res = await authPost<unknown>(backup ? "/two-factor/verify-backup-code" : "/two-factor/verify-totp", { code: value, trustDevice: trustOption && trust });
    if (res.ok) {
      window.location.assign(next);
      return;
    }
    setBusy(false);
    setError(explain(res.error));
  }

  const toLogin = (): void => window.location.assign(`/login?next=${encodeURIComponent(next)}`);
  const inpCls = error?.kind === "bad" ? "inp bad" : "inp";
  return (
    <Shell fact={false}>
      <span className="kick">{t("kick")}</span>
      <h1 className="lh">{t("heading")}</h1>
      <p className="ls">{backup ? t("lsBackup") : t("lsApp")}</p>
      {error !== null ? <ErrBan e={error} /> : null}
      <form method="post" noValidate onSubmit={(e) => void onSubmit(e)} style={{ display: "contents" }} aria-busy={busy || !ready}>
        <div className="card" style={{ background: C.surface }}>
          {backup ? (
            <div className="fl">
              <label htmlFor="g-bk">{t("backupLabel")}</label>
              <div className={inpCls} style={{ background: C.chip }}>
                <input
                  id="g-bk"
                  disabled={!ready}
                  name="code"
                  type="text"
                  autoComplete="one-time-code"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="xxxxx-xxxxx"
                  value={code}
                  onChange={(e) => setCode(e.currentTarget.value)}
                  style={{ fontFamily: "var(--font-plex-mono), monospace", fontSize: "22px", letterSpacing: ".12em" }}
                />
              </div>
              <span className="hint">{t("backupHint")}</span>
            </div>
          ) : (
            <div className="fl">
              <label htmlFor="g-otp">{t("codeLabel")}</label>
              <div className={inpCls} style={{ background: C.chip }}>
                <input
                  id="g-otp"
                  disabled={!ready}
                  name="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  aria-label={t("codeAria")}
                  value={code}
                  onChange={(e) => setCode(e.currentTarget.value)}
                  style={{ fontFamily: "var(--font-plex-mono), monospace", fontSize: "26px", letterSpacing: ".3em" }}
                />
              </div>
            </div>
          )}
          {trustOption ? (
            <button type="button" role="checkbox" className={trust ? "chk on" : "chk"} aria-checked={trust} onClick={() => setTrust((v) => !v)}>
              <i>
                <Ico d={GICON.check} size={16} sw={3.2} />
              </i>
              {t("trust")}
            </button>
          ) : null}
          <button
            type="button"
            className="lnk"
            onClick={() => {
              setBackup((v) => !v);
              setCode("");
              setError(null);
            }}
          >
            {backup ? t("useApp") : t("useBackup")}
          </button>
        </div>
        <div className="act" style={{ background: C.bg }}>
          <button type="button" className="big ghost" style={{ background: C.chip, color: C.fg, flex: "0 0 auto", minWidth: "64px" }} onClick={toLogin} aria-label={t("back")}>
            <Ico d={GICON.back} size={24} sw={3} />
          </button>
          <button type="submit" className="big" style={{ background: dz("172E42"), color: dz("FFFFFF") }} disabled={busy || !ready}>
            {t("submit")}
          </button>
        </div>
      </form>
    </Shell>
  );
}

export function EmailSignIn({
  dark,
  next,
  socialEnabled,
  demo,
  fieldTab,
  reauth = false,
}: {
  dark: boolean;
  next: string;
  socialEnabled: boolean;
  demo: boolean;
  fieldTab: boolean;
  reauth?: boolean;
}): ReactNode {
  return (
    <DzRoot dark={dark} scope="dzg" testId="login">
      <Login next={next} socialEnabled={socialEnabled} demo={demo} fieldTab={fieldTab} reauth={reauth} />
    </DzRoot>
  );
}

export function MfaVerify({ dark, next, trustOption = false }: { dark: boolean; next: string; trustOption?: boolean }): ReactNode {
  return (
    <DzRoot dark={dark} scope="dzg" testId="mfa">
      <Mfa next={next} trustOption={trustOption} />
    </DzRoot>
  );
}
