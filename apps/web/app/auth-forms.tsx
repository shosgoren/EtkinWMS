"use client";
// Kimlik ekranı istemci formları (T-118). Alan kuralları (parola uzunluğu, hız sınırı, kilit) SUNUCUDADIR (A-41);
// burada yalnızca sunucu yanıtı (kod + sonraki eylem) gösterilir. Tüm metin `messages/*.json` `auth.*` altındadır.
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import { Banner, Button, CircleAlert, TextField } from "@wms/ui";
import { QrCode } from "./qr-code.tsx";
import { BRAND_E_PATH } from "./brand-mark.tsx";
import { acceptInvitationAction } from "./invite/[token]/actions.ts";
import { authPost } from "../lib/auth-client.ts";
import type { AuthCallError } from "../lib/auth-client.ts";

type Translator = ReturnType<typeof useTranslations>;

const LINK =
  "inline-flex min-h-12 min-w-12 items-center justify-center rounded-control px-2 text-base font-semibold text-accent-ink underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus";

interface ShownError {
  readonly reason: string;
  readonly action: string;
  /** Sunucu hata kodu (destek için); yoksa gösterilmez. */
  readonly code?: string | undefined;
}

function waitText(t: Translator, seconds: number | undefined): string {
  if (seconds === undefined) return t("common.waitSomeTime");
  return seconds >= 120 ? t("common.waitMinutes", { minutes: Math.ceil(seconds / 60) }) : t("common.waitSeconds", { seconds });
}

/** Ortak (kimlik ekranından bağımsız) sunucu/ağ ve hız sınırı hataları; tanınmıyorsa `null`. */
function commonError(t: Translator, e: AuthCallError): ShownError | null {
  if (e.status === 429 || e.code === "RATE_LIMITED") {
    return { reason: t("common.rateLimited"), action: t("common.rateLimitedAction", { wait: waitText(t, e.retryAfterSec) }), code: e.code ?? "RATE_LIMITED" };
  }
  if (e.status === 0 || e.status >= 500) {
    return { reason: t("common.serverError"), action: t("common.serverErrorAction"), code: e.code };
  }
  return null;
}

function FormError({ id, error }: { id: string; error: ShownError | null }) {
  const t = useTranslations("auth");
  if (error === null) return <div id={id} />;
  return (
    <div id={id}>
      <Banner kind="error">
        <p>
          {error.reason} {error.action}
        </p>
        {error.code ? <p className="mt-1 text-sm">{t("common.errorCode", { code: error.code })}</p> : null}
      </Banner>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="auth-card mx-auto flex w-full max-w-md min-w-0 flex-col gap-4 px-4 py-6">
      <h1 className="break-words text-2xl font-extrabold text-ink">{title}</h1>
      {children}
    </main>
  );
}

function fieldValue(form: HTMLFormElement, name: string): string {
  const v = new FormData(form).get(name);
  return typeof v === "string" ? v : "";
}

// ---------------------------------------------------------------------------------------------
// Giriş
// ---------------------------------------------------------------------------------------------

interface SignInData {
  readonly twoFactorRedirect?: boolean;
}

const REMEMBER_KEY = "etkin.login.email";

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

export function LoginForm({ next, socialEnabled, banner }: { next: string; socialEnabled: boolean; banner?: ReactNode }) {
  const t = useTranslations("auth");
  const guide = useTranslations("guide");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ShownError | null>(null);
  const [badgeEmail, setBadgeEmail] = useState("");
  const [capsOn, setCapsOn] = useState(false);
  const [remember, setRemember] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // T-981: "e-postamı hatırla" yalnız bu cihazın tarayıcısında e-postayı tutar; parola asla saklanmaz.
  useEffect(() => {
    const saved = readRemembered();
    const input = formRef.current?.elements.namedItem("email");
    if (saved !== "" && input instanceof HTMLInputElement && input.value === "") {
      input.value = saved;
      setBadgeEmail(saved);
      setRemember(true);
    }
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError(null);
    const email = fieldValue(form, "email");
    const res = await authPost<SignInData>("/sign-in/email", {
      email,
      password: fieldValue(form, "password"),
    });
    if (res.ok) {
      writeRemembered(remember ? email.trim() : null);
      // Tam gezinme: sunucu bileşenleri yeni çerezle yeniden çizilir. `next` sunucuda `safeNext`'ten geçmiştir.
      window.location.assign(res.data.twoFactorRedirect === true ? `/mfa?next=${encodeURIComponent(next)}` : next);
      return;
    }
    setBusy(false);
    // Hesap varlığı sızdırılmaz: yanlış parola, bilinmeyen e-posta, doğrulanmamış e-posta aynı mesaj.
    setError(
      commonError(t, res.error) ?? { reason: t("login.invalid"), action: t("login.invalidAction"), code: res.error.code },
    );
  }

  async function onSocial(provider: "google" | "microsoft") {
    setBusy(true);
    const res = await authPost<{ url?: string }>("/sign-in/social", { provider, callbackURL: next });
    if (res.ok && typeof res.data.url === "string") {
      window.location.assign(res.data.url);
      return;
    }
    setBusy(false);
    setError({ reason: t("common.serverError"), action: t("common.serverErrorAction") });
  }

  const caps = (event: KeyboardEvent<HTMLInputElement>) => setCapsOn(event.getModifierState("CapsLock"));

  return (
    <div className="login-stage">
      <LoginScene t={t} />
      <div className="login-panel">
        <main className="auth-card login-card flex w-full max-w-md min-w-0 flex-col gap-4">
          <div className="login-printer" aria-hidden="true">
            <span className="login-printer-head" />
            <span className="login-badge">
              <QrGlyph />
              <span className="login-badge-text">
                <small>{t("login.badge")}</small>
                <b>{badgeEmail.trim() || t("login.badgeEmpty")}</b>
              </span>
            </span>
          </div>
          <h1 className="break-words text-2xl font-extrabold text-ink">{t("login.title")}</h1>
          <p className="auth-instruction">{guide("loginHelp")}</p>
          {banner}
          <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4" aria-describedby="login-error" noValidate={false}>
            <div className="login-field login-field-email">
              <TextField
                label={t("login.email")}
                name="email"
                type="email"
                autoComplete="username"
                required
                onInput={(e) => setBadgeEmail(e.currentTarget.value)}
              />
              <FieldIcon d="M4 6h16v12H4z M4 7l8 6 8-6" />
            </div>
            <div className="login-field login-field-password">
              <TextField
                label={t("login.password")}
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                onKeyDown={caps}
                onKeyUp={caps}
                onBlur={() => setCapsOn(false)}
              />
              <FieldIcon d="M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
              <button
                type="button"
                className="login-eye"
                aria-pressed={showPassword}
                aria-label={guide(showPassword ? "hidePassword" : "showPassword")}
                title={guide(showPassword ? "hidePassword" : "showPassword")}
                onClick={() => setShowPassword((v) => !v)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
                  <circle cx="12" cy="12" r="3" />
                  {showPassword ? <path d="M4 4l16 16" /> : null}
                </svg>
              </button>
            </div>
            {capsOn ? (
              <p className="login-caps" role="status">
                {t("login.capsLock")}
              </p>
            ) : null}
            <label className="login-remember">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.currentTarget.checked)} />
              {t("login.remember")}
            </label>
            <FormError id="login-error" error={error} />
            <Button type="submit" loading={busy}>
              {t("login.submit")}
              <svg className="login-arrow" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </Button>
          </form>
          <Link href="/reset-password" className={LINK}>
            {t("login.forgot")}
          </Link>
          {socialEnabled ? (
            <section aria-label={t("login.socialLabel")} className="flex flex-col gap-3">
              <Button variant="secondary" onClick={() => void onSocial("google")} disabled={busy}>
                {t("login.google")}
              </Button>
              <Button variant="secondary" onClick={() => void onSocial("microsoft")} disabled={busy}>
                {t("login.microsoft")}
              </Button>
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}

function FieldIcon({ d }: { d: string }) {
  return (
    <svg className="login-field-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

function QrGlyph() {
  return (
    <svg className="login-badge-qr" viewBox="0 0 29 29" aria-hidden="true" focusable="false">
      <path className="qr-frame" d="M1 1h7v7H1z M21 1h7v7h-7z M1 21h7v7H1z" />
      <path className="qr-dots" d="M3.5 3.5h2v2h-2z M23.5 3.5h2v2h-2z M3.5 23.5h2v2h-2z M11 1h2v2h-2z M15 1h2v4h-2z M11 5h4v2h-4z M11 9h2v4h-2z M15 9h2v2h-2z M1 11h4v2H1z M7 11h2v2H7z M19 11h2v2h-2z M23 11h5v2h-5z M13 13h4v2h-4z M1 15h2v2H1z M5 15h4v2H5z M19 15h2v4h-2z M25 15h3v2h-3z M11 17h2v4h-2z M15 17h2v2h-2z M23 19h2v2h-2z M11 23h4v2h-4z M17 21h2v4h-2z M21 23h2v2h-2z M25 23h3v5h-3z M11 27h6v1h-6z M19 26h4v2h-4z" />
    </svg>
  );
}

// Giriş sahnesi (T-981): hareketli Rota e logosu; koli e yolunu dolaşırken istasyonlar sırayla yanar. Yalnız görsel.
const SCENE_STATIONS = [
  { key: "stIn", cls: "in", d: "M12 3v12M7 10l5 5 5-5M4 15v4h16v-4" },
  { key: "stTransfer", cls: "transfer", d: "M4 8h13M14 5l3 3-3 3M20 16H7M10 13l-3 3 3 3" },
  { key: "stProd", cls: "prod", d: "M3 21V11l6 3v-3l6 3V7l6-3v17z" },
  { key: "stCount", cls: "count", d: "M9 5H7v16h10V5h-2M9 5a3 3 0 0 1 6 0M9 13l2 2 4-4" },
  { key: "stShip", cls: "ship", d: "M3 7h11v9H3zM14 10h4l3 3v3h-7z" },
] as const;

function LoginScene({ t }: { t: Translator }) {
  return (
    <aside className="login-scene" aria-hidden="true">
      <div className="login-scene-logo">
        <svg className="login-scene-e" viewBox="0 0 120 120" focusable="false">
          <path className="login-e-base" d={BRAND_E_PATH} />
          <path className="login-e-trail" d={BRAND_E_PATH} pathLength={400} />
          <circle className="login-e-pack" r="9">
            <animateMotion dur="9s" repeatCount="indefinite" path={BRAND_E_PATH} keyPoints="0;0;1;1" keyTimes="0;0.05;0.8;1" calcMode="linear" />
          </circle>
        </svg>
        {SCENE_STATIONS.map((s, i) => (
          <span key={s.key} className={`login-station login-station-${s.cls} login-station-${i + 1}`}>
            <i>
              <svg viewBox="0 0 24 24" focusable="false">
                <path d={s.d} />
              </svg>
            </i>
            {t(`login.${s.key}`)}
          </span>
        ))}
      </div>
      <div className="login-scene-text">
        <p className="login-wordmark">
          <b>{t("login.wordmark")}</b>
          <span>{t("login.wordmarkSub")}</span>
        </p>
        <p className="login-slogan">
          {t("login.sloganA")} <em>{t("login.sloganB")}</em> {t("login.sloganC")}
        </p>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------------------------
// Parola sıfırlama
// ---------------------------------------------------------------------------------------------

export function ResetRequestForm() {
  const t = useTranslations("auth");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ShownError | null>(null);
  const [outcome, setOutcome] = useState<"none" | "sent" | "undeliverable">("none");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError(null);
    const res = await authPost<unknown>("/request-password-reset", {
      email: fieldValue(form, "email"),
      redirectTo: "/reset-password",
    });
    setBusy(false);
    if (res.ok) {
      setOutcome("sent"); // tek tip yanıt: hesap var/yok ayrımı yok
      return;
    }
    if (res.error.code === "MAIL_DELIVERY_DISABLED") {
      // A-42: e-posta teslimi kapalı; sahte başarı yok, her e-posta için aynı dürüst mesaj.
      setOutcome("undeliverable");
      return;
    }
    setError(commonError(t, res.error) ?? { reason: t("common.serverError"), action: t("common.serverErrorAction"), code: res.error.code });
  }

  return (
    <Card title={t("reset.requestTitle")}>
      {outcome === "sent" ? <Banner kind="info">{t("reset.sent")}</Banner> : null}
      {outcome === "undeliverable" ? <Banner kind="warning">{t("reset.undeliverable")}</Banner> : null}
      <p className="break-words text-base text-ink-muted">{t("reset.requestIntro")}</p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" aria-describedby="reset-error">
        <TextField label={t("login.email")} name="email" type="email" autoComplete="username" required />
        <FormError id="reset-error" error={error} />
        <Button type="submit" loading={busy}>
          {t("reset.requestSubmit")}
        </Button>
      </form>
      <Link href="/login" className={LINK}>
        {t("common.backToLogin")}
      </Link>
    </Card>
  );
}

export function ResetPasswordForm({ token, linkError }: { token: string; linkError: boolean }) {
  const t = useTranslations("auth");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ShownError | null>(null);
  const [mismatch, setMismatch] = useState(false);
  const [done, setDone] = useState(false);

  if (linkError) {
    return (
      <Card title={t("reset.newTitle")}>
        <Banner kind="error">
          {t("reset.invalidLink")} {t("reset.invalidLinkAction")}
        </Banner>
        <Link href="/reset-password" className={LINK}>
          {t("reset.requestAgain")}
        </Link>
      </Card>
    );
  }
  if (done) {
    return (
      <Card title={t("reset.newTitle")}>
        <Banner kind="info">{t("reset.done")}</Banner>
        <Link href="/login" className={LINK}>
          {t("common.backToLogin")}
        </Link>
      </Card>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const password = fieldValue(form, "password");
    if (password !== fieldValue(form, "confirm")) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    setBusy(true);
    setError(null);
    const res = await authPost<unknown>("/reset-password", { newPassword: password, token });
    setBusy(false);
    if (res.ok) {
      setDone(true);
      return;
    }
    const code = res.error.code;
    if (code === "INVALID_TOKEN") {
      setError({ reason: t("reset.invalidLink"), action: t("reset.invalidLinkAction"), code });
    } else if (code === "PASSWORD_TOO_SHORT" || code === "PASSWORD_TOO_LONG") {
      setError({ reason: t("reset.passwordRule"), action: t("reset.passwordRuleAction"), code });
    } else {
      setError(commonError(t, res.error) ?? { reason: t("common.serverError"), action: t("common.serverErrorAction"), code });
    }
  }

  return (
    <Card title={t("reset.newTitle")}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" aria-describedby="reset-new-error">
        <TextField
          label={t("reset.newPassword")}
          hint={t("reset.passwordHint")}
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
        <TextField
          label={t("reset.confirmPassword")}
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          {...(mismatch ? { error: { reason: t("reset.mismatch"), action: t("reset.mismatchAction") } } : {})}
        />
        <FormError id="reset-new-error" error={error} />
        <Button type="submit" loading={busy}>
          {t("reset.newSubmit")}
        </Button>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// 2FA doğrulama (girişin ikinci adımı)
// ---------------------------------------------------------------------------------------------

export function MfaVerifyForm({ next }: { next: string }) {
  const t = useTranslations("auth");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ShownError | null>(null);
  const [backup, setBackup] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError(null);
    const res = await authPost<unknown>(backup ? "/two-factor/verify-backup-code" : "/two-factor/verify-totp", {
      code: fieldValue(form, "code").replace(/\s+/g, ""),
    });
    if (res.ok) {
      window.location.assign(next);
      return;
    }
    setBusy(false);
    setError(mfaError(t, res.error));
  }

  return (
    <Card title={t("mfa.verifyTitle")}>
      <p className="break-words text-base text-ink-muted">{backup ? t("mfa.backupIntro") : t("mfa.verifyIntro")}</p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" aria-describedby="mfa-verify-error">
        <TextField
          key={backup ? "backup" : "totp"}
          label={backup ? t("mfa.backupCode") : t("mfa.code")}
          name="code"
          type="text"
          inputMode={backup ? "text" : "numeric"}
          autoComplete="one-time-code"
          required
        />
        <FormError id="mfa-verify-error" error={error} />
        <Button type="submit" loading={busy}>
          {t("mfa.verifySubmit")}
        </Button>
      </form>
      <Button
        variant="secondary"
        onClick={() => {
          setBackup(!backup);
          setError(null);
        }}
      >
        {backup ? t("mfa.useTotp") : t("mfa.useBackup")}
      </Button>
      <Link href="/login" className={LINK}>
        {t("common.backToLogin")}
      </Link>
    </Card>
  );
}

function mfaError(t: Translator, e: AuthCallError): ShownError {
  const common = commonError(t, e);
  if (common !== null) return e.status === 429 || e.code === "RATE_LIMITED" ? { ...common, action: t("mfa.lockedAction") } : common;
  if (e.code === "TOO_MANY_ATTEMPTS" || e.status === 429) {
    return { reason: t("mfa.locked"), action: t("mfa.lockedAction"), code: e.code };
  }
  return { reason: t("mfa.invalid"), action: t("mfa.invalidAction"), code: e.code };
}

// ---------------------------------------------------------------------------------------------
// 2FA kurulum (QR bileşeni bağımlılık gerektirir: şimdilik elle anahtar + otpauth bağlantısı)
// ---------------------------------------------------------------------------------------------

interface EnableData {
  readonly totpURI: string;
  readonly backupCodes: readonly string[];
}

function secretOf(uri: string): string {
  try {
    return new URL(uri).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

/** Kurulum formu yerine durum bildirimi (sunucu karar verir: demo kullanıcı M9, 2FA zaten etkin). */
export function MfaNotice({ kind, next }: { kind: "demo" | "enabled"; next: string }) {
  const t = useTranslations("auth");
  return (
    <Card title={t("mfa.setupTitle")}>
      <Banner kind="info">{kind === "demo" ? t("mfa.demoDisabled") : t("mfa.alreadyEnabled")}</Banner>
      <Link href={next} className={LINK}>
        {t("common.continue")}
      </Link>
    </Card>
  );
}

export function MfaSetupForm({ next }: { next: string }) {
  const t = useTranslations("auth");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ShownError | null>(null);
  const [enable, setEnable] = useState<EnableData | null>(null);
  const [saved, setSaved] = useState(false);
  const [finished, setFinished] = useState(false);

  if (finished) {
    return (
      <Card title={t("mfa.setupTitle")}>
        <Banner kind="info">{t("mfa.setupDone")}</Banner>
        <Link href={next} className={LINK}>
          {t("common.continue")}
        </Link>
      </Card>
    );
  }

  async function onPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError(null);
    const res = await authPost<EnableData>("/two-factor/enable", { password: fieldValue(form, "password") });
    setBusy(false);
    if (res.ok) {
      setEnable(res.data);
      return;
    }
    setError(setupError(t, res.error));
  }

  async function onVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError(null);
    const res = await authPost<unknown>("/two-factor/verify-totp", { code: fieldValue(form, "code").replace(/\s+/g, "") });
    setBusy(false);
    if (res.ok) {
      setFinished(true);
      return;
    }
    setError(mfaError(t, res.error));
  }

  if (enable === null) {
    return (
      <Card title={t("mfa.setupTitle")}>
        <p className="break-words text-base text-ink-muted">{t("mfa.setupIntro")}</p>
        <form onSubmit={onPassword} className="flex flex-col gap-4" aria-describedby="mfa-setup-error">
          <TextField
            label={t("mfa.confirmPassword")}
            hint={t("mfa.confirmPasswordHint")}
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          <FormError id="mfa-setup-error" error={error} />
          <Button type="submit" loading={busy}>
            {t("mfa.setupStart")}
          </Button>
        </form>
      </Card>
    );
  }

  const secret = secretOf(enable.totpURI);
  return (
    <Card title={t("mfa.setupTitle")}>
      <section className="flex flex-col gap-2" aria-labelledby="mfa-key-title">
        <h2 id="mfa-key-title" className="text-lg font-bold text-ink">
          {t("mfa.keyTitle")}
        </h2>
        <p className="break-words text-base text-ink-muted">{t("mfa.keyIntro")}</p>
        <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:items-center">
          <QrCode value={enable.totpURI} label={t("mfa.qrLabel")} />
          <p className="break-words text-base text-ink-muted">{t("mfa.qrHint")}</p>
        </div>
        <p className="break-words text-sm font-semibold text-ink">{t("mfa.keyManual")}</p>
        <code className="break-all rounded-card bg-accent-soft p-3 font-mono text-base text-ink select-all">{secret}</code>
        <a href={enable.totpURI} className={LINK}>
          {t("mfa.openApp")}
        </a>
      </section>
      <section className="flex flex-col gap-2" aria-labelledby="mfa-backup-title">
        <h2 id="mfa-backup-title" className="text-lg font-bold text-ink">
          {t("mfa.backupTitle")}
        </h2>
        <Banner kind="warning">{t("mfa.backupWarning")}</Banner>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {enable.backupCodes.map((c) => (
            <li key={c} className="break-all rounded-card border-2 border-border p-2 font-mono text-base select-all">
              {c}
            </li>
          ))}
        </ul>
        <label className="flex min-h-12 items-center gap-3 text-base font-semibold text-ink">
          <input
            type="checkbox"
            checked={saved}
            onChange={(e) => setSaved(e.target.checked)}
            className="size-6 shrink-0 accent-accent"
          />
          {t("mfa.backupSaved")}
        </label>
      </section>
      <form onSubmit={onVerify} className="flex flex-col gap-4" aria-describedby="mfa-setup-error">
        <TextField label={t("mfa.code")} hint={t("mfa.codeHint")} name="code" type="text" inputMode="numeric" autoComplete="one-time-code" required />
        <FormError id="mfa-setup-error" error={error} />
        <Button type="submit" loading={busy} disabled={!saved}>
          {t("mfa.setupFinish")}
        </Button>
      </form>
    </Card>
  );
}

function setupError(t: Translator, e: AuthCallError): ShownError {
  const common = commonError(t, e);
  if (common !== null) return common;
  if (e.code === "TOTP_ALREADY_ENABLED") return { reason: t("mfa.alreadyEnabled"), action: t("mfa.alreadyEnabledAction"), code: e.code };
  if (e.code === "DEMO_FORBIDDEN") return { reason: t("mfa.demoDisabled"), action: t("mfa.demoDisabledAction"), code: e.code };
  if (e.code === "INVALID_PASSWORD") return { reason: t("mfa.passwordWrong"), action: t("mfa.passwordWrongAction"), code: e.code };
  return { reason: t("common.serverError"), action: t("common.serverErrorAction"), code: e.code };
}

// ---------------------------------------------------------------------------------------------
// Çıkış (kabuktaki kullanıcı çipine bağlanır)
// ---------------------------------------------------------------------------------------------

export function SignOutButton() {
  const t = useTranslations("auth");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function onClick() {
    setBusy(true);
    setFailed(false);
    const res = await authPost<unknown>("/sign-out", {});
    if (res.ok) {
      window.location.assign("/login");
      return;
    }
    setBusy(false);
    setFailed(true);
  }

  return (
    <>
      <Button variant="secondary" onClick={() => void onClick()} loading={busy} aria-describedby={failed ? "signout-error" : undefined}>
        {t("signOut.label")}
      </Button>
      {failed ? (
        <span id="signout-error" role="alert" className="inline-flex items-start gap-1 text-sm font-medium text-danger-ink">
          <CircleAlert className="size-4 shrink-0 text-danger" strokeWidth={2} aria-hidden="true" />
          <span>
            {t("signOut.failed")} {t("signOut.failedAction")}
          </span>
        </span>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Davet kabulü
// ---------------------------------------------------------------------------------------------

export function InviteAcceptForm({ token, signedIn }: { token: string; signedIn: boolean }) {
  const t = useTranslations("auth");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ShownError | null>(null);

  async function accept(extra: { name: string; password: string } | null) {
    setBusy(true);
    setError(null);
    const res = await acceptInvitationAction({ token, ...(extra ?? {}) });
    if (res.ok) {
      // Yeni hesapta oturum yoktur: girişten sonra aynı hedefe dönülür (`next` giriş sayfasında `safeNext`'ten geçer).
      window.location.assign(res.data.signedIn ? res.data.redirectTo : `/login?next=${encodeURIComponent(res.data.redirectTo)}`);
      return;
    }
    setBusy(false);
    const e = res.error;
    const detail = e.detail === "MFA_REQUIRED" ? "mfa_required" : undefined;
    if (detail !== undefined) {
      setError({ reason: t("invite.errors.mfa_required"), action: t("invite.errors.mfa_requiredAction"), code: e.code });
    } else if (e.code === "NOT_FOUND" || e.code === "FORBIDDEN" || e.code === "VALIDATION_FAILED" || e.code === "RATE_LIMITED") {
      const key = e.code.toLowerCase();
      setError({ reason: t(`invite.errors.${key}`), action: t(`invite.errors.${key}Action`), code: e.code });
    } else {
      setError({ reason: t("common.serverError"), action: t("common.serverErrorAction"), code: e.code });
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    void accept(signedIn ? null : { name: fieldValue(form, "name"), password: fieldValue(form, "password") });
  }

  return (
    <Card title={t("invite.title")}>
      <p className="break-words text-base text-ink-muted">{signedIn ? t("invite.introSignedIn") : t("invite.intro")}</p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" aria-describedby="invite-error">
        {signedIn ? null : (
          <>
            <TextField label={t("invite.name")} name="name" type="text" autoComplete="name" maxLength={200} required />
            <TextField
              label={t("reset.newPassword")}
              hint={t("reset.passwordHint")}
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
            />
          </>
        )}
        <FormError id="invite-error" error={error} />
        <Button type="submit" loading={busy}>
          {signedIn ? t("invite.acceptSignedIn") : t("invite.acceptNew")}
        </Button>
      </form>
      {signedIn ? null : (
        <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`} className={LINK}>
          {t("invite.haveAccount")}
        </Link>
      )}
    </Card>
  );
}
