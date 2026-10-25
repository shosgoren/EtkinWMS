"use client";
// Kimlik ekranı istemci formları (T-118). Alan kuralları (parola uzunluğu, hız sınırı, kilit) SUNUCUDADIR (A-41);
// burada yalnızca sunucu yanıtı (kod + sonraki eylem) gösterilir. Tüm metin `messages/*.json` `auth.*` altındadır.
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Button, CircleAlert, buyukHarf } from "@wms/ui";
import { GICON, GirisAlan, GirisBaglanti, GirisBant, GirisBaslik, GirisEylem, GirisKabuk, GirisKart } from "./giris-ui.tsx";
import { TotpSihirbaz } from "./totp-sihirbaz.tsx";
import { acceptInvitationAction } from "./invite/[token]/actions.ts";
import { authPost } from "../lib/auth-client.ts";
import type { AuthCallError } from "../lib/auth-client.ts";

type Translator = ReturnType<typeof useTranslations>;


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

function fieldValue(form: HTMLFormElement, name: string): string {
  const v = new FormData(form).get(name);
  return typeof v === "string" ? v : "";
}

// ---------------------------------------------------------------------------------------------
// Parola sıfırlama (e-posta girişi ve doğrulama ekranı T-999b'den beri `login/flow.tsx`)
// ---------------------------------------------------------------------------------------------

/** T-974 (B-63 grup B): giriş tasarım dilinde hata bandı (`.ban.err`); kod destek içindir. */
function GirisHata({ id, error }: { id: string; error: ShownError | null }) {
  const t = useTranslations("auth");
  return (
    <div id={id} style={{ display: "contents" }}>
      {error === null ? null : (
        <GirisBant kind="err" title={error.reason}>
          {error.action}
          {error.code ? ` ${t("common.errorCode", { code: error.code })}` : null}
        </GirisBant>
      )}
    </div>
  );
}

export function ResetRequestForm({ dark = false }: { dark?: boolean }) {
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
    <GirisKabuk dark={dark} testId="reset-request">
      <GirisBaslik title={t("reset.requestTitle")} sub={t("reset.requestIntro")} />
      {outcome === "sent" ? <GirisBant kind="ok">{t("reset.sent")}</GirisBant> : null}
      {outcome === "undeliverable" ? <GirisBant kind="warn">{t("reset.undeliverable")}</GirisBant> : null}
      <form onSubmit={onSubmit} style={{ display: "contents" }} aria-describedby="reset-error" aria-busy={busy}>
        <GirisKart>
          <GirisAlan id="reset-mail" label={t("login.email")} d={GICON.mail} name="email" type="email" autoComplete="username" placeholder="ad@firma.com" required />
        </GirisKart>
        <GirisHata id="reset-error" error={error} />
        <GirisEylem label={t("reset.requestSubmit")} busy={busy} />
      </form>
      <GirisBaglanti href="/login">{t("common.backToLogin")}</GirisBaglanti>
    </GirisKabuk>
  );
}

export function ResetPasswordForm({ token, linkError, dark = false }: { token: string; linkError: boolean; dark?: boolean }) {
  const t = useTranslations("auth");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ShownError | null>(null);
  const [mismatch, setMismatch] = useState(false);
  const [done, setDone] = useState(false);

  if (linkError) {
    return (
      <GirisKabuk dark={dark} testId="reset-new">
        <GirisBaslik title={t("reset.newTitle")} />
        <GirisBant kind="err" title={t("reset.invalidLink")}>
          {t("reset.invalidLinkAction")}
        </GirisBant>
        <GirisBaglanti href="/reset-password">{t("reset.requestAgain")}</GirisBaglanti>
      </GirisKabuk>
    );
  }
  if (done) {
    return (
      <GirisKabuk dark={dark} testId="reset-new">
        <GirisBaslik title={t("reset.newTitle")} />
        <GirisBant kind="ok">{t("reset.done")}</GirisBant>
        <GirisBaglanti href="/login">{t("common.backToLogin")}</GirisBaglanti>
      </GirisKabuk>
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
    <GirisKabuk dark={dark} testId="reset-new">
      <GirisBaslik title={t("reset.newTitle")} />
      <form onSubmit={onSubmit} style={{ display: "contents" }} aria-describedby="reset-new-error" aria-busy={busy}>
        <GirisKart>
          <GirisAlan
            id="reset-pw"
            label={t("reset.newPassword")}
            hint={t("reset.passwordHint")}
            d={GICON.lock}
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
          />
          <GirisAlan
            id="reset-pw2"
            label={t("reset.confirmPassword")}
            d={GICON.lock}
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            {...(mismatch ? { error: `${t("reset.mismatch")} ${t("reset.mismatchAction")}` } : {})}
          />
        </GirisKart>
        <GirisHata id="reset-new-error" error={error} />
        <GirisEylem label={t("reset.newSubmit")} busy={busy} />
      </form>
    </GirisKabuk>
  );
}

// ---------------------------------------------------------------------------------------------
// 2FA kurulum (QR bileşeni bağımlılık gerektirir: şimdilik elle anahtar + otpauth bağlantısı)
// ---------------------------------------------------------------------------------------------

/** MFA kurulumu doğrulama adımı hataları (giriş ikinci adımı T-999b'den beri `login/flow.tsx`). */
function mfaError(t: Translator, e: AuthCallError): ShownError {
  const common = commonError(t, e);
  if (common !== null) return e.status === 429 || e.code === "RATE_LIMITED" ? { ...common, action: t("mfa.lockedAction") } : common;
  if (e.code === "TOO_MANY_ATTEMPTS" || e.status === 429) {
    return { reason: t("mfa.locked"), action: t("mfa.lockedAction"), code: e.code };
  }
  return { reason: t("mfa.invalid"), action: t("mfa.invalidAction"), code: e.code };
}

interface EnableData {
  readonly totpURI: string;
  readonly backupCodes: readonly string[];
}

/** Kurulum formu yerine durum bildirimi (sunucu karar verir: demo kullanıcı M9, 2FA zaten etkin). T-974: giriş tasarım dili. */
export function MfaNotice({ kind, next, dark = false }: { kind: "demo" | "enabled"; next: string; dark?: boolean }) {
  const t = useTranslations("auth");
  return (
    <GirisKabuk dark={dark} testId="mfa-setup">
      <GirisBaslik title={t("mfa.setupTitle")} />
      <GirisBant kind={kind === "demo" ? "info" : "ok"}>{kind === "demo" ? t("mfa.demoDisabled") : t("mfa.alreadyEnabled")}</GirisBant>
      <GirisBaglanti href={next}>{t("common.continue")}</GirisBaglanti>
    </GirisKabuk>
  );
}

// T-974 (B-63 grup B): 2FA kurulumu Giris.dc.html dilinde (aktivasyonun MFA adımıyla aynı öğeler: `.card` QR + anahtar `.addr`, yedek kodlar
// `.kv`, onay `.chk`, kod alanı `.fl > .inp`). Sunucu çağrıları, sıra (parola → anahtar → yedek kod onayı → ilk kod) ve hata eşlemesi aynı.
export function MfaSetupForm({ next, dark = false }: { next: string; dark?: boolean }) {
  const t = useTranslations("auth");
  const locale = useLocale(); // T-436 (ALTIN-KURAL 16): kullanıcının dili
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ShownError | null>(null);
  const [enable, setEnable] = useState<EnableData | null>(null);
  const [finished, setFinished] = useState(false);

  if (finished) {
    return (
      <GirisKabuk dark={dark} testId="mfa-setup">
        <GirisBaslik title={t("mfa.setupTitle")} />
        <GirisBant kind="ok">{t("mfa.setupDone")}</GirisBant>
        <GirisBaglanti href={next}>{t("common.continue")}</GirisBaglanti>
      </GirisKabuk>
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

  // T-1034: kurulum sihirbazı (`totp-sihirbaz.tsx`) kodu doğrular; kilit/çok deneme metni sunucu hatasından.
  async function verifyCode(code: string): Promise<true | string> {
    const res = await authPost<unknown>("/two-factor/verify-totp", { code });
    if (res.ok) return true;
    const e = mfaError(t, res.error);
    return `${e.reason} ${e.action}`;
  }

  if (enable === null) {
    return (
      <GirisKabuk dark={dark} testId="mfa-setup">
        <GirisBaslik kick={buyukHarf(t("mfa.verifyTitle"), locale)} title={t("mfa.setupTitle")} sub={t("mfa.setupIntro")} />
        <form onSubmit={onPassword} style={{ display: "contents" }} aria-describedby="mfa-setup-error" aria-busy={busy}>
          <GirisKart>
            <GirisAlan
              id="mfa-pw"
              label={t("mfa.confirmPassword")}
              hint={t("mfa.confirmPasswordHint")}
              d={GICON.lock}
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </GirisKart>
          <GirisHata id="mfa-setup-error" error={error} />
          <GirisEylem label={t("mfa.setupStart")} busy={busy} />
        </form>
      </GirisKabuk>
    );
  }

  return (
    <GirisKabuk dark={dark} testId="mfa-setup">
      <TotpSihirbaz totpURI={enable.totpURI} backupCodes={enable.backupCodes} verify={verifyCode} onDone={() => setFinished(true)} />
    </GirisKabuk>
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

export function InviteAcceptForm({ token, signedIn, dark = false, preview }: { token: string; signedIn: boolean; dark?: boolean; preview?: ReactNode }) {
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
    <GirisKabuk dark={dark} testId="invite">
      <GirisBaslik title={t("invite.title")} sub={signedIn ? t("invite.introSignedIn") : t("invite.intro")} />
      {preview}
      <form onSubmit={onSubmit} style={{ display: "contents" }} aria-describedby="invite-error" aria-busy={busy}>
        {signedIn ? null : (
          <GirisKart>
            <GirisAlan id="invite-name" label={t("invite.name")} d={GICON.user} name="name" type="text" autoComplete="name" maxLength={200} required />
            <GirisAlan
              id="invite-pw"
              label={t("reset.newPassword")}
              hint={t("reset.passwordHint")}
              d={GICON.lock}
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
            />
          </GirisKart>
        )}
        <GirisHata id="invite-error" error={error} />
        <GirisEylem label={signedIn ? t("invite.acceptSignedIn") : t("invite.acceptNew")} busy={busy} />
      </form>
      {signedIn ? null : <GirisBaglanti href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>{t("invite.haveAccount")}</GirisBaglanti>}
    </GirisKabuk>
  );
}
