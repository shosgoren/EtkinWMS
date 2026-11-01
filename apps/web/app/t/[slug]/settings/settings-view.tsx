"use client";
// T-968 (B-63, I-18): Ayarlar — KalipForm.dc.html BİREBİR (form kalıbı). Gruplar: Çalışma alanı (Ad, Dil, Saat dilimi, Örnek veriler),
// Görev ayrılığı (anahtar), Tema ve görünüm, Güvenlik (iki adımlı doğrulama durumu, Parola). Alt cam çubuğun ana işlemi KAYDET yalnız
// değişiklik varken etkin; değişen satırda sarı çizgi (`.chg`); Geri / Ana ekran kaydedilmemiş işte uyarı kutusunu açar.
// İşlevler aynı sunucu eylemlerindedir (yetki, audit, yeniden giriş domain'de): ad/dil/saat dilimi + görev ayrılığı TEK Kaydet ile
// `saveSettingsFormAction`; örnek veri temizleme `clearSampleDataAction` (onay kutusu korunur). Tema cihaz tercihidir (çerez), sunucuya gitmez.
// Bilinçli farklar (DESIGN-PARITY, T-968): tema seçeneğinde "Otomatik" yok (uygulamada sistem teması izleme yok); saat diliminde kaynaktaki
// üç seçenek + mevcut değer düğme, tam liste "Diğer" seçicisinde; iki adımlı doğrulama satırı oturumun gerçek durumunu gösterir;
// "Bağlantı gönder" parola sıfırlama sayfasını açar (bağlantıyı o sayfa e-postayla gönderir); örnek veri yoksa satır çizilmez.
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { LICON } from "../../../design/kalip-icons.ts";
import { sistemKoyu, temaYaz, type TemaTercihi } from "../../../design/theme.ts";
import { Ico, KalipEkran, MicIco, useKalipToast } from "../kalip/ekran.tsx";
import { useCikisKorumasi } from "../kalip/cikis.tsx";
import { KalipAlan, KalipAnahtar, KalipBaglanti, KalipGrup, KalipIzgara, KalipKilit, KalipPerde, KalipSabit, KalipSatir, KalipSecenek } from "../kalip/form.tsx";
import { KalipSecimListe, KalipSekme } from "../kalip/secim.tsx";
import { saveSettingsFormAction } from "./form-actions.ts";
import { ayarSekmeleri, ayarSekmesi, ayniTaslakSekmesi } from "./sekmeler.ts";
import { clearSampleDataAction } from "./sample-actions.ts";
import { buyukHarf, feedback } from "@wms/ui";

export interface SettingsValues {
  readonly name: string;
  readonly locale: string;
  readonly timeZone: string;
  readonly sod: boolean;
  /** T-1109 (B-134): Etkin sesli yanıt. */
  readonly voice: boolean;
}

export interface SettingsViewProps {
  readonly slug: string;
  readonly dark: boolean;
  /** T-436 (ALTIN-KURAL 14): cihazdaki tema tercihi (açık / koyu / otomatik). */
  readonly theme?: TemaTercihi;
  readonly locked: boolean;
  readonly canLabels?: boolean;
  /** Ayar yoksa (yetkisiz) boş değerler gösterilir; satırlar kilitli. */
  readonly values: SettingsValues;
  readonly addressSlug: string | null;
  readonly timeZones: readonly string[];
  /** Etkin örnek kayıt sayıları; yoksa satır çizilmez. */
  readonly sample: { readonly warehouses: number; readonly locations: number; readonly items: number } | null;
  readonly mfaOn: boolean;
  readonly canImport: boolean;
  /** Adres sorgusundan gelen sonuç bildirimleri (sunucu eylemi yönlendirmesi). */
  readonly notices: readonly { readonly kind: "ok" | "err" | "info"; readonly text: string }[];
  /** Yeniden giriş gerektiren işlem için bant + bağlantı. */
  readonly reauth: { readonly text: string; readonly href: string; readonly link: string } | null;
  readonly error: { readonly text: string; readonly code: string } | null;
}

type RowId = "name" | "loc" | "tz" | "smp" | "theme" | "pass";
const POPULAR_TZ = ["Europe/Istanbul", "Europe/Berlin", "Europe/London"] as const;

export function SettingsView({ slug, dark: initialDark, theme: initialTheme, locked, canLabels=false, values, addressSlug, timeZones, sample, mfaOn, notices, reauth, error }: SettingsViewProps) {
  const t = useTranslations("settings.k");
  const ts = useTranslations("settings");
  const tl = useTranslations("labelEditor");
  const tk = useTranslations("kalip");
  const tr = useTranslations("kural");
  const locale = useLocale(); // T-436 (ALTIN-KURAL 16): kullanıcının dili
  const tb = useTranslations("baglantilar");
  const ty = useTranslations("yetkiler");
  const router = useRouter();
  const sekme = ayarSekmesi(useSearchParams().get("sekme"));
  const base = `/t/${encodeURIComponent(slug)}`;
  const firstTheme: TemaTercihi = initialTheme ?? (initialDark ? "koyu" : "acik");
  const [savedTheme, setSavedTheme] = useState<TemaTercihi>(firstTheme);
  const [v, setV] = useState<SettingsValues & { readonly dark: boolean; readonly tema: TemaTercihi }>({ ...values, dark: initialDark, tema: firstTheme });
  const [open, setOpen] = useState<RowId | null>(null);
  const [busy, setBusy] = useState(false);
  const { say, node: toast } = useKalipToast("form");
  const formRef = useRef<HTMLFormElement>(null);

  // Sunucu yönlendirmesiyle gelen sonuç bir kez balonla söylenir (görsel + ses).
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current || notices.length === 0) return;
    shown.current = true;
    const n = notices[0];
    if (n === undefined) return;
    (n.kind === "err" ? feedback.error : feedback.ok)();
    say(n.kind, n.text);
  }, [notices, say]);

  const chg: string[] = [];
  if (v.name !== values.name) chg.push("name");
  if (v.locale !== values.locale) chg.push("loc");
  if (v.timeZone !== values.timeZone) chg.push("tz");
  if (v.sod !== values.sod) chg.push("sod");
  if (v.voice !== values.voice) chg.push("voice");
  if (v.tema !== savedTheme) chg.push("theme");
  const dirty = chg.length > 0 && !locked && v.name.trim() !== "";

  const denied = (): void => {
    say("warn", t("lockToast"));
  };
  const toggle = (id: RowId) => (): void => {
    if (locked && id !== "theme" && id !== "pass") {
      denied();
      return;
    }
    feedback.minor();
    setOpen((o) => (o === id ? null : id));
  };
  const close = useCallback(() => setOpen(null), []);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]): void => {
    if (locked && k !== "dark" && k !== "tema") return;
    feedback.minor();
    setV((cur) => ({ ...cur, [k]: val }));
  };

  /** Kaydet: tema cihazda (çerez); çalışma alanı alanları ve görev ayrılığı sunucuya tek form. */
  const save = (): void => {
    if (!dirty || busy) return;
    if (v.tema !== savedTheme) {
      temaYaz(v.tema);
      setSavedTheme(v.tema);
    }
    const server = chg.some((k) => k !== "theme");
    setOpen(null);
    if (!server) {
      say("ok", t("themeSaved"));
      return;
    }
    setBusy(true);
    formRef.current?.requestSubmit();
  };

  // T-990: yarım işte Geri / Ana ekran / bağlantılar yalnız ortak çıkış kutusunu açar ("Kaydet ve çık" sunucu formunu gönderir, sayfada kalınır).
  const korunan = useCikisKorumasi(chg.length > 0 && !locked, {
    dark: v.dark,
    text: t("unsavedText", { n: chg.length }),
    ...(dirty
      ? {
          onSave: () => {
            save();
            return false;
          },
        }
      : {}),
  });
  const go = (href: string) => (): void => {
    feedback.minor();
    korunan.sor(() => router.push(href));
  };

  const tzLabel = (z: string): string => (z === "Europe/Istanbul" ? t("tzIstanbul") : z === "Europe/Berlin" ? t("tzBerlin") : z === "Europe/London" ? t("tzLondon") : z);
  const tzOptions = [...POPULAR_TZ, ...(POPULAR_TZ.includes(v.timeZone as (typeof POPULAR_TZ)[number]) ? [] : [v.timeZone])].map((z) => ({ id: z, label: tzLabel(z), d: LICON.clock }));
  const locV = v.locale === "en" ? t("localeEn") : t("localeTr");
  const hasSample = sample !== null && sample.warehouses + sample.locations + sample.items > 0;

  return (
    <KalipEkran
      kind="form"
      dark={v.dark}
      title={t("screenTitle")}
      icon={{ d: LICON.gear, color: "0E7C7B" }}
      testId="settings"
      bar={{
        back: { onClick: go(base), testId: "kabuk-back" },
        homeNav: { href: base, testId: "kabuk-home" },
        main: {
          label: t("save"),
          aria: dirty ? t("saveAria", { n: chg.length }) : t("saveNone"),
          d: LICON.check,
          disabled: !dirty || busy,
          disabledReason: busy ? tk("saving") : t("saveNone"),
          onClick: save,
          testId: "settings-save",
        },
      }}
      overlays={
        <>
          <KalipPerde open={open !== null} onClose={close} />
          {toast}
          {korunan.kutu}
        </>
      }
    >
      {/* T-1046 (STANDART §5): ayar sekmeleri (Firma · Kullanıcılar ve yetki · Entegrasyonlar · Görünüm); aynı anda tek konu. */}
      <KalipSekme
        label={tb("tabs")}
        color="0E7C7B"
        current={sekme}
        onGo={(href) => {
          // Firma / Kullanıcılar / Görünüm aynı taslağın sekmeleridir (tek Kaydet): geçiş taslağı korur, "kaydetmeden çık" sorulmaz
          // (sorulsaydı taslak silinmeden kalır ve sonraki Kaydet gizli değişikliği gönderirdi). Entegrasyonlar ayrı ekran: koruma sorar.
          if (ayniTaslakSekmesi(href, base)) {
            feedback.minor();
            router.replace(href, { scroll: false });
          } else go(href)();
        }}
        // T-1112: ayar yetkisi (settings.manage) yoksa ERP ekranı kilitlidir; Entegrasyonlar sekmesi Excel aktarımını açar.
        items={ayarSekmeleri(base, tb, !locked)}
      />
      {locked ? <KalipKilit title={t("lockTitle")} sub={t("lockSub")} /> : null}
      {reauth === null ? null : (
        <div className="lockb" role="alert">
          <i>
            <Ico d={LICON.key} size={20} />
          </i>
          <span>
            <b>{reauth.text}</b>
            <small>
              <a href={reauth.href} style={{ color: "inherit" }}>
                {reauth.link}
              </a>
            </small>
          </span>
        </div>
      )}
      {error === null ? null : (
        <div className="lockb" role="alert" data-testid="settings-error">
          <i>
            <Ico d={LICON.warn} size={20} />
          </i>
          <span>
            <b>{error.text}</b>
            <small>{error.code}</small>
          </span>
        </div>
      )}
      {/* Sunucu formu: değerler kalıbın durumundan (gizli alanlar). */}
      <form ref={formRef} action={saveSettingsFormAction} hidden>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="tenant" value={chg.some((k) => k === "name" || k === "loc" || k === "tz") ? "1" : "0"} />
        <input type="hidden" name="name" value={v.name} />
        <input type="hidden" name="locale" value={v.locale} />
        <input type="hidden" name="timeZone" value={v.timeZone} />
        <input type="hidden" name="sod" value={chg.includes("sod") ? (v.sod ? "1" : "0") : ""} />
        <input type="hidden" name="voice" value={chg.includes("voice") ? (v.voice ? "1" : "0") : ""} />
      </form>
      {sekme === "firma" ? (
        <KalipIzgara
          left={
          <KalipGrup title={t("ws")} d={LICON.workspace} color="0F6E8C" testId="settings-ws">
            {canLabels&&<KalipBaglanti title={tl("title")} value={tl("printers")} d={LICON.printer} color="3B6A9E" href={base+"/label-designs"} testId="settings-label-designs"/>}
            <KalipSatir id="name" title={t("name")} value={v.name} d={LICON.pencil} color="0F6E8C" open={open === "name"} changed={chg.includes("name")} locked={locked} onToggle={toggle("name")} onClose={close} editorTitle={t("nameEditor")} testId="settings-name">
              <div className="sxr">
                <KalipAlan
                  label={t("nameField")}
                  type="text"
                  name="name-edit"
                  value={v.name}
                  maxLength={120}
                  required
                  autoComplete="off"
                  aria-label={t("nameEditor")}
                  onChange={(e) => setV((cur) => ({ ...cur, name: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      close();
                    }
                  }}
                />
                <button type="button" className="sbtn mic" aria-label={t("sayName")} aria-disabled="true" onClick={() => say("info", tk("voiceSoon"))}>
                  <MicIco size={22} />
                </button>
              </div>
              {addressSlug === null ? null : <small className="sxn">{t("nameNote", { slug: addressSlug })}</small>}
            </KalipSatir>
            <KalipSatir id="loc" title={t("locale")} value={locV} d={LICON.globe} color="2F5DA8" open={open === "loc"} changed={chg.includes("loc")} locked={locked} onToggle={toggle("loc")} onClose={close} testId="settings-locale">
              <KalipSecenek
                label={t("locale")}
                value={v.locale}
                color="2F5DA8"
                onPick={(id) => set("locale", id)}
                options={[
                  { id: "tr", label: ts("localeTr"), d: LICON.globe },
                  { id: "en", label: ts("localeEn"), d: LICON.globe },
                ]}
              />
            </KalipSatir>
            <KalipSatir id="tz" title={t("tz")} value={buyukHarf(tzLabel(v.timeZone), locale)} d={LICON.clock} color="6C4BD8" open={open === "tz"} changed={chg.includes("tz")} locked={locked} onToggle={toggle("tz")} onClose={close} testId="settings-tz">
              <KalipSecenek label={t("tz")} value={v.timeZone} color="6C4BD8" onPick={(id) => set("timeZone", id)} options={tzOptions} />
              <KalipSecimListe label={t("tzOther")} value={v.timeZone} onPick={(id) => set("timeZone", id)} options={timeZones.map((z) => ({ id: z, label: tzLabel(z) === z ? z : `${tzLabel(z)}`, sub: tzLabel(z) === z ? undefined : z }))} icon={{ d: LICON.clock, color: "6C4BD8" }} scan={false} testId="settings-tz-other" />
            </KalipSatir>
            {hasSample ? (
              <KalipSatir id="smp" title={t("sample")} value={t("sampleHas")} d={LICON.koli} color="9A5B2E" open={open === "smp"} locked={locked} onToggle={toggle("smp")} onClose={close} testId="sample-data">
                <small className="sxn">{ts("sample.body", { ...sample })}</small>
                <small className="sxn">{t("sampleRule")}</small>
                <form action={clearSampleDataAction} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <input type="hidden" name="slug" value={slug} />
                  <label className="sxn" style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 48 }}>
                    <input type="checkbox" name="confirm" value="1" required style={{ width: 24, height: 24, flex: "none" }} />
                    <span>{ts("sample.confirm")}</span>
                  </label>
                  <button type="submit" className="rej">
                    <Ico d={LICON.trash} size={20} />
                    {ts("sample.clear")}
                  </button>
                </form>
              </KalipSatir>
            ) : null}
          </KalipGrup>
          }
          right={
            <>
            <KalipGrup title={t("sod")} d={LICON.people} color="6C4BD8" testId="sod">
              <KalipAnahtar
                title={t("sodRow")}
                d={LICON.shield}
                color="6C4BD8"
                on={v.sod}
                changed={chg.includes("sod")}
                locked={locked}
                aria={v.sod ? t("sodAriaOn") : t("sodAriaOff")}
                onToggle={() => (locked ? denied() : set("sod", !v.sod))}
                testId="settings-sod"
              />
            </KalipGrup>
            {/* T-1109 (B-134): Etkin sesli yanıt (firma ayarı, varsayılan kapalı); kullanıcının "Sessiz" tercihi ayrıca kapatır. */}
            <KalipGrup title={t("voice")} d={LICON.micB} color="2F7D5B" testId="settings-voice-group">
              <KalipAnahtar
                title={t("voiceRow")}
                d={LICON.micB}
                color="2F7D5B"
                on={v.voice}
                changed={chg.includes("voice")}
                locked={locked}
                aria={v.voice ? t("voiceAriaOn") : t("voiceAriaOff")}
                onToggle={() => (locked ? denied() : set("voice", !v.voice))}
                testId="settings-voice"
              />
            </KalipGrup>
            </>
          }
        />
      ) : sekme === "kullanici" ? (
        <KalipIzgara
          left={
            <KalipGrup title={t("people")} d={LICON.people} color="6C4BD8" testId="settings-people">
              <KalipBaglanti title={t("members")} value={t("membersV")} d={LICON.people} color="2F5DA8" href={`${base}/members`} testId="settings-members" />
              <KalipBaglanti title={t("groups")} value={t("groupsV")} d={LICON.shield} color="6C4BD8" href={`${base}/groups`} testId="settings-groups" />
              {/* T-1142: bütün yetkiler aç/kapa ile (grup + kişi görünümü). */}
              <KalipBaglanti title={ty("settingsLink")} value={ty("settingsLinkV")} d={LICON.key} color="6C4BD8" href={`${base}/yetkiler`} testId="settings-yetkiler" />
            </KalipGrup>
          }
          right={
            <KalipGrup title={t("sec")} d={LICON.lock} color="2F7D5B">
              <KalipSabit title={t("mfa")} d={LICON.shield} color="2F7D5B" pill={{ label: mfaOn ? tk("on") : tk("off"), ok: mfaOn }} aria={mfaOn ? t("mfaAriaOn") : t("mfaAriaOff")} testId="settings-mfa" />
              <KalipSatir id="pass" title={t("pass")} value={t("passV")} d={LICON.key} color="2F7D5B" open={open === "pass"} onToggle={toggle("pass")} onClose={close} editorTitle={t("passEditor")} testId="settings-pass">
                <small className="sxn">{t("passNote")}</small>
                <a className="btn n" href="/reset-password" style={{ textDecoration: "none" }}>
                  <Ico d={LICON.arrow} size={20} />
                  {t("passSend")}
                </a>
              </KalipSatir>
            </KalipGrup>
          }
        />
      ) : (
        <KalipIzgara
          left={
            <KalipGrup title={t("look")} d={LICON.sun} color="B07D0B">
              <KalipSatir id="theme" title={t("theme")} value={v.tema === "oto" ? tr("themeAuto") : v.dark ? t("themeDarkV") : t("themeLightV")} d={LICON.moon} color="B07D0B" open={open === "theme"} changed={chg.includes("theme")} onToggle={toggle("theme")} onClose={close} testId="settings-theme">
                <KalipSecenek
                  label={t("theme")}
                  value={v.tema === "oto" ? "auto" : v.dark ? "dark" : "light"}
                  color="B07D0B"
                  onPick={(id) => {
                    const tema: TemaTercihi = id === "auto" ? "oto" : id === "dark" ? "koyu" : "acik";
                    feedback.minor();
                    setV((cur) => ({ ...cur, tema, dark: tema === "oto" ? sistemKoyu() : tema === "koyu" }));
                  }}
                  options={[
                    { id: "light", label: t("themeLight"), d: LICON.sun },
                    { id: "dark", label: t("themeDark"), d: LICON.moon },
                    { id: "auto", label: tr("themeAuto"), d: LICON.globe },
                  ]}
                />
              </KalipSatir>
            </KalipGrup>
          }
          right={null}
        />
      )}
    </KalipEkran>
  );
}
