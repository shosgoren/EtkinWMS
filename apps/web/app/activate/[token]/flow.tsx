"use client";
// I-18 (DESIGN-PARITY): Giris.dc.html `v.auth` kabuğu + `v.act` aktivasyon BİREBİR (sol marka paneli, adım çubuğu, 4 adım + hazır ekranı,
// geçersiz bağlantı durumu). Sınıf adları, öğe sırası, ikon yolları ve metinler kaynaktan; CSS `app/design/giris.css` (üretilmiş).
// Akış (ADR-026 §3.4): 1 firma + çalışma alanı adı (canlı uygunluk) → 2 örnek veri / boş → 3 parola (hesap + alan + deneme sunucuda tek
// adımda açılır, ardından bu tarayıcıda giriş) → 4 zorunlu MFA (TOTP + yedek kodlar) → hazır. Parola yalnız bu bileşenin belleğinde yaşar.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { authPost } from "../../../lib/auth-client.ts";
import { DzRoot, useDz } from "../../design/dz-root.tsx";
import { C, dz } from "../../design/giris-tokens.ts";
import { GICON } from "../../design/giris-icons.ts";
import { activateTrialAction, checkWorkspaceNameAction } from "./actions.ts";
import { slugOf, trialDateLabel } from "./helpers.ts";
import { TotpSihirbaz } from "../../totp-sihirbaz.tsx";

type Step = 0 | 1 | 2 | 3 | 4 | 5;
type SlugState = "short" | "taken" | "fix" | "ok";

interface Preview {
  readonly company: string;
  readonly email: string;
  readonly emailVerifiedByLink: boolean;
}

interface EnableData {
  readonly totpURI: string;
  readonly backupCodes: readonly string[];
}

interface Done {
  readonly slug: string;
  readonly email: string;
  readonly trialEndsAt: string;
  readonly welcomeQueued: boolean;
}

function Ico({ d, size, sw, style }: { d: string; size: number; sw?: number; style?: CSSProperties }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={sw === undefined ? style : { strokeWidth: sw, ...style }}>
      <path d={d} />
    </svg>
  );
}

function ThemeButton({ label }: { label: string }) {
  const { toggleTheme } = useDz();
  return (
    <button type="button" className="icb mode" style={{ background: C.surface }} onClick={toggleTheme} aria-label={label}>
      <Ico d={GICON.theme} size={22} />
    </button>
  );
}

function Shell({ bad, children }: { bad: boolean; children: ReactNode }) {
  const t = useTranslations("activate");
  const rows = bad
    ? [
        [GICON.mail, t("badSideR1")],
        [GICON.term, t("badSideR2")],
        [GICON.lock, t("badSideR3")],
      ]
    : [
        [GICON.box, t("sideR1")],
        [GICON.lock, t("sideR2")],
        [GICON.mail, t("sideR3")],
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
          <h2 className="lside-h">{bad ? t("badSideH") : t("sideH")}</h2>
          <p className="lside-p">{bad ? t("badSideP") : t("sideP")}</p>
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
              <ThemeButton label={t("theme")} />
            </div>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function Flow({ host, token, preview }: { host: string; token: string | null; preview: Preview | null }) {
  const t = useTranslations("activate");
  const { dark } = useDz();
  const bad = token === null || preview === null;
  const [step, setStep] = useState<Step>(bad ? 0 : 1);
  const [company, setCompany] = useState(preview?.company ?? "");
  const [slugIn, setSlugIn] = useState(slugOf(preview?.company ?? ""));
  const [checked, setChecked] = useState<{ slug: string; state: "ok" | "taken" | "short" } | null>(null);
  const [seed, setSeed] = useState<"ornek" | "bos">("ornek");
  const [np, setNp] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [linkBad, setLinkBad] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [enable, setEnable] = useState<EnableData | null>(null);
  const seq = useRef(0);

  const slug = slugOf(slugIn);
  // Canlı uygunluk: kısa → yerel; diğerleri sunucuda (ayrılmış/alınmış aynı yanıt). Sunucu yanıtı gelene dek "böyle olacak" (doğru bilgi).
  useEffect(() => {
    if (bad || slug.length < 3) return;
    const my = ++seq.current;
    const timer = setTimeout(() => {
      void checkWorkspaceNameAction({ token, name: slug }).then((r) => {
        if (my !== seq.current) return;
        if (r.ok) setChecked({ slug: r.data.slug, state: r.data.state });
        else if (r.error.code === "NOT_FOUND") setLinkBad(true);
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [bad, slug, token]);

  const slugState: SlugState =
    slug.length < 3 ? "short" : checked !== null && checked.slug === slug ? (checked.state === "taken" ? "taken" : slug !== slugIn ? "fix" : "ok") : "fix";
  const slugHint = {
    short: t("slugShort"),
    taken: t("slugTaken"),
    fix: t("slugFix", { slug }),
    ok: t("slugOk", { host, slug }),
  }[slugState];
  const slugOk = checked !== null && checked.slug === slug && checked.state === "ok";
  const npOk = np.length >= 12;

  const aS: Step = bad || linkBad ? 0 : step;
  const dis =
    busy ||
    (aS === 1 && (slugState === "short" || slugState === "taken" || !slugOk || company.trim() === "")) ||
    (aS === 3 && !npOk);

  const failText = useCallback(
    (code: string, detail?: string): string | null => {
      if (code === "NOT_FOUND") {
        setLinkBad(true);
        return null;
      }
      if (code === "VALIDATION_FAILED" && detail === "CODE_TAKEN") {
        setChecked({ slug, state: "taken" });
        setStep(1);
        return null;
      }
      if (code === "VERSION_CONFLICT") return t("errConflict");
      if (code === "FORBIDDEN") return t("errExists");
      if (code === "VALIDATION_FAILED") return t("errValidation");
      if (code === "RATE_LIMITED") return t("errRate");
      return t("errServer");
    },
    [slug, t],
  );

  async function submitPassword(): Promise<void> {
    if (token === null) return;
    setBusy(true);
    setErr(null);
    const r = await activateTrialAction({ token, company: company.trim(), workspaceName: slug, sample: seed === "ornek", password: np });
    if (!r.ok) {
      setBusy(false);
      setErr(failText(r.error.code, r.error.detail));
      return;
    }
    setDone(r.data);
    // Bu tarayıcıda giriş (yeni hesap MFA'sız; sahip TENANT_ADMIN → kurulum zorunlu, A-38), sonra TOTP kurulumu.
    const signIn = await authPost<{ twoFactorRedirect?: boolean }>("/sign-in/email", { email: r.data.email, password: np });
    if (!signIn.ok) {
      setBusy(false);
      setErr(t("errSignIn"));
      setStep(5);
      return;
    }
    const en = await authPost<EnableData>("/two-factor/enable", { password: np });
    setBusy(false);
    setNp("");
    if (!en.ok) {
      setErr(t("errMfaStart"));
      setStep(5);
      return;
    }
    setEnable(en.data);
    setStep(4);
  }

  // T-1034: kurulum sihirbazı kodu doğrular; sonuç yalnız evet/hayır (hata metni sihirbazda).
  async function verifyCode(code: string): Promise<boolean> {
    const r = await authPost<unknown>("/two-factor/verify-totp", { code });
    return r.ok;
  }

  function next(): void {
    setErr(null);
    if (aS === 0) {
      window.location.assign("/login");
      return;
    }
    if (aS === 1 || aS === 2) setStep((aS + 1) as Step);
    else if (aS === 3) void submitPassword();
    else if (aS === 5) window.location.assign(done === null ? "/login" : `/t/${done.slug}`);
  }

  const bars = [1, 2, 3, 4].map((i) => (i <= aS ? (dark ? dz("F4C542") : dz("172E42")) : C.track));
  const kick = aS === 0 ? t("kickBad") : aS < 5 ? t("kickStep", { n: aS }) : t("kickDone");
  const btnText = t(`btn${aS}` as "btn0");
  const doneSlug = done?.slug ?? slug;
  const ownerMail = done?.email ?? preview?.email ?? "";

  return (
    <Shell bad={aS === 0}>
      {aS === 4 ? null : (
        <>
          <span className="kick">{kick}</span>
          <div className="steps" aria-hidden="true">
            {bars.map((bg, i) => (
              <i key={i} style={{ background: bg }} />
            ))}
          </div>
          <h1 className="lh">{t(`h${aS}` as "h0")}</h1>
          <p className="ls">{aS === 5 ? "" : t(`s${aS}` as "s0")}</p>
        </>
      )}

      {aS === 1 ? (
        <div className="card" style={{ background: C.surface }}>
          <div className="fl">
            <label htmlFor="g-co">{t("company")}</label>
            <div className="inp" style={{ background: C.chip }}>
              <Ico d={GICON.company} size={22} style={{ opacity: 0.6 }} />
              <input
                id="g-co"
                type="text"
                autoComplete="organization"
                value={company}
                maxLength={120}
                onChange={(e) => {
                  const v = e.target.value;
                  if (slugOf(company) === slugIn) setSlugIn(slugOf(v));
                  setCompany(v);
                }}
              />
            </div>
            <span className="hint">{t("companyHint")}</span>
          </div>
          <div className="fl">
            <label htmlFor="g-slug">{t("slug")}</label>
            <div className={`inp${slugState === "taken" ? " bad" : slugState === "ok" ? " ok" : ""}`} style={{ background: C.chip }}>
              <span className="pre">{`${host}/`}</span>
              <input
                id="g-slug"
                type="text"
                autoCapitalize="none"
                spellCheck={false}
                value={slugIn}
                maxLength={40}
                onChange={(e) => setSlugIn(e.target.value)}
                aria-describedby="g-slug-h"
              />
            </div>
            <span id="g-slug-h" className={`hint${slugState === "taken" ? " bad" : slugState === "ok" ? " ok" : ""}`} role="status">
              {slugHint}
            </span>
          </div>
        </div>
      ) : null}

      {aS === 2 ? (
        <>
          <div className="opts" role="radiogroup" aria-label={t("seedLabel")}>
            {(
              [
                ["ornek", t("seedSampleT"), t("seedSampleS"), GICON.box, dz("FFE7A8"), dz("4A3500")],
                ["bos", t("seedEmptyT"), t("seedEmptyS"), GICON.empty, C.chip, C.fg],
              ] as const
            ).map(([key, title, sub, d, iBg, iFg]) => {
              const sel = seed === key;
              return (
                <button key={key} type="button" role="radio" aria-checked={sel ? "true" : "false"} className={`opt${sel ? " on" : ""}`} style={{ background: C.surface }} onClick={() => setSeed(key)}>
                  <span className="tick">
                    <Ico d={GICON.check} size={16} sw={3.2} />
                  </span>
                  <span className="oi" style={{ background: iBg, color: iFg }}>
                    <Ico d={d} size={24} />
                  </span>
                  {/* Kaynak çalışma zamanı metin bağlarını `<span>` içinde çizer; `.opt span` kuralı bu yüzden başlığa da uygulanır (birebir). */}
                  <b>
                    <span>{title}</span>
                  </b>
                  <span>
                    <span>{sub}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="ban" style={{ background: C.chip }}>
            <Ico d={GICON.clock} size={22} />
            <span>
              <b>{t("seedBanT")}</b>
              {t("seedBanS")}
            </span>
          </div>
        </>
      ) : null}

      {aS === 3 ? (
        <div className="card" style={{ background: C.surface }}>
          <div className="fl">
            <span className="fll">{t("ownerMail")}</span>
            <div className="inp" style={{ background: C.chip }}>
              <Ico d={GICON.mail} size={22} style={{ opacity: 0.6 }} />
              <span style={{ font: "600 17px/1 var(--font-instrument), sans-serif" }}>{ownerMail}</span>
            </div>
            {preview?.emailVerifiedByLink === true ? (
              <span className="hint ok">
                <Ico d={GICON.check} size={16} />
                {t("mailOk")}
              </span>
            ) : (
              <span className="hint">{t("mailNo")}</span>
            )}
          </div>
          <div className="fl">
            <label htmlFor="g-np">{t("newPassword")}</label>
            <div className="inp" style={{ background: C.chip }}>
              <Ico d={GICON.lock} size={22} style={{ opacity: 0.6 }} />
              <input id="g-np" type={showPw ? "text" : "password"} autoComplete="new-password" value={np} maxLength={128} onChange={(e) => setNp(e.target.value)} aria-describedby="g-np-h" />
              <button type="button" className="eye" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? t("pwHide") : t("pwShow")}>
                <Ico d={showPw ? GICON.eyeOff : GICON.eye} size={22} />
              </button>
            </div>
            <span id="g-np-h" className={`hint${npOk ? " ok" : ""}`}>
              {npOk ? t("pwStrong") : t("pwShortHint", { n: np.length })}
            </span>
          </div>
        </div>
      ) : null}

      {aS === 4 && enable !== null ? (
        <TotpSihirbaz
          totpURI={enable.totpURI}
          backupCodes={enable.backupCodes}
          verify={verifyCode}
          onDone={() => {
            setEnable(null);
            setStep(5);
          }}
        />
      ) : null}

      {aS === 5 ? (
        <div className="done" style={{ background: C.surface }}>
          <span className="okc">
            <Ico d={GICON.check} size={44} sw={3.2} />
          </span>
          <b style={{ font: "800 26px/1.1 var(--font-bricolage), sans-serif" }}>{t("doneTitle")}</b>
          {/* Kaynakta metin bağı ayrı `<span>` olarak çizilir; `.addr`/`.chip` esnek kutu aralığı bu yüzden bağdan önce ve sonra uygulanır. */}
          <span className="addr" style={{ background: C.chip }}>
            {`${host}/`}
            <span>{doneSlug}</span>
          </span>
          {done !== null ? (
            <span className="chip" style={{ background: dz("F4C542"), color: dz("1A1300") }}>
              {t.rich("trialChip", { date: trialDateLabel(done.trialEndsAt), d: (c) => <span>{c}</span> })}
            </span>
          ) : null}
          <p className="ls" style={{ margin: 0 }}>
            {done?.welcomeQueued === true ? t.rich("doneSent", { email: ownerMail, b: (c) => <b>{c}</b> }) : t.rich("doneOff", { email: ownerMail, b: (c) => <b>{c}</b> })}
          </p>
        </div>
      ) : null}

      {err !== null ? (
        <span className="hint bad" role="alert">
          <Ico d={GICON.warn} size={16} />
          {err}
        </span>
      ) : null}
      {aS === 4 ? null : (
      <div className="act" style={{ background: C.bg }}>
        {aS > 1 && aS < 4 ? (
          <button type="button" className="big ghost" style={{ background: C.chip, color: C.fg, flex: "0 0 auto", minWidth: "64px" }} onClick={() => setStep((aS - 1) as Step)} aria-label={t("back")} disabled={busy}>
            <Ico d={GICON.back} size={24} sw={3} />
          </button>
        ) : null}
        <button type="button" className="big" style={{ background: aS === 5 ? dz("17804F") : dz("172E42"), color: dz("FFFFFF") }} onClick={next} disabled={dis}>
          {btnText}
          <Ico d={GICON.next} size={24} sw={3} />
        </button>
      </div>
      )}
    </Shell>
  );
}

export function ActivationFlow({ dark, host, token, preview }: { dark: boolean; host: string; token: string | null; preview: Preview | null }) {
  return (
    <DzRoot dark={dark} scope="dzg" testId="activate">
      <Flow host={host} token={token} preview={preview} />
    </DzRoot>
  );
}
