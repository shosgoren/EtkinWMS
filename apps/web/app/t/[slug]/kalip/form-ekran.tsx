"use client";
// T-990 (B-97, kullanıcı kararları 20–21 Ekim): TAM EKRAN FORM — ekleme/düzenleme pencere değil, ekranın kendisidir ("doğru yol tek yol").
// Ekran yalnız ALANLARI (KalipAlan, KalipSecim…) ve KURALLARI (`rules`) verir; şunlar bu sarmalayıcının içindedir, ekran atlayamaz:
//  - Kaydet alt cam çubuğun ortasındaki büyük ana işlemdir; yalnız değişiklik varken etkindir (değişiklik başlangıç değerleriyle
//    karşılaştırılır; yazılıp silinen alan değişiklik sayılmaz). Değişiklik yokken dokunulursa sessiz kalmaz: hata sesi + "Değişiklik yok".
//  - Doğrulama: eksik/geçersiz alan kırmızı çerçeve + kısa sarsılma + altında tek satır neden; ilk hatalı alana kaydırılır ve odaklanır;
//    hata balonu + ses ("2 alan eksik: Cari kodu, Ünvan"). Sunucu alan hataları (ör. kod zaten var) aynı biçimde ilgili alanda.
//  - Çıkış: Geri / Ana ekran / Modüller / bağlantılar yarım işte YALNIZ uygulamanın cam kutusunu açar (cikis.tsx).
//  - Görünüm: telefonda tam ekran; masaüstünde en çok ~720px sütun + sağda canlı önizleme kartı (detay kalıbının hero kartı gibi: ad, kod,
//    tür ikonu); yer yoksa önizleme gizlenir. Adres örneği `?new=1` / `?edit=<id>` (ekran yönetir).
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { LICON } from "../../../design/kalip-icons.ts";
import { useCikisKorumasi } from "./cikis.tsx";
import { degisti, dogrula, ilkHatali, ozet, type AlanKurali, type Hatalar } from "./dogrula.ts";
import { Ico, KalipEkran, tone, useKalipToast, type ToastKind } from "./ekran.tsx";
import { FormBaglamCtx } from "./form-baglam.tsx";
import { KalipKilit } from "./form.tsx";
import { eskiSurumBildir, eskiSurumMu } from "./surum.tsx";
import { kdzOrtak } from "./tokens.ts";

const c = (hex: string): string => kdzOrtak(hex);

/** Kaydetme sonucu: başarı ya da alan hataları / genel neden (formda kalınır). */
export type KaydetSonuc = { readonly ok: true } | { readonly ok: false; readonly alan?: Readonly<Record<string, string>>; readonly mesaj?: string };

export interface KalipFormEkranProps<V extends Readonly<Record<string, unknown>>> {
  readonly dark: boolean;
  readonly title: string;
  readonly icon: { readonly d: string; readonly color: string };
  readonly subtitle?: string;
  readonly testId?: string;
  /** Güncel değerler ve açılıştaki değerler ("değişiklik var" kararı). */
  readonly values: V;
  readonly initial: V;
  /** Alan kuralları (sıra = ekrandaki sıra; ilk hatalı alan buna göre). */
  readonly rules: readonly AlanKurali[];
  /** Yazma yetkisi yoksa salt okunur: kilit bandı, Kaydet kilitli. */
  readonly canEdit?: boolean;
  readonly lockedTitle?: string;
  readonly lockedSub?: string;
  /** Kaydet (yalnız doğrulama geçince çağrılır). */
  readonly onSave: () => Promise<KaydetSonuc>;
  /** Başarılı kayıttan sonra (ekran adresi değiştirir / listeye döner). */
  readonly onDone: () => void;
  /** Geri: yarım işte önce cam kutu sorar. */
  readonly onBack: () => void;
  /** Ana ekran düğmesi (verilmezse kiracı kökü; bağlantı da yarım işte sorar). */
  readonly homeHref?: string;
  /** Ana işlem etiketi (alt çubuk `.cap`, varsayılan "KAYDET") ve erişilebilir adı. */
  readonly saveShort?: string;
  readonly saveAria?: string;
  /** Başarı balonu (varsayılan "Kaydedildi"). */
  readonly savedText?: string;
  /** Çıkış kutusu metni ve "… ve çık" etiketi. */
  readonly leaveText?: string;
  readonly leaveSaveLabel?: string;
  /** Sağdaki canlı önizleme kartı (`KalipOnizleme`). */
  readonly preview?: ReactNode;
  /** Kabın `overlays` yuvasına ek katman (ör. kamera). */
  readonly overlays?: ReactNode;
  /** Formun altındaki ikincil işlemler (Arşivle…; tek soruluk onay pencere kalır). */
  readonly footer?: ReactNode;
  readonly children: ReactNode;
}

export interface FormEkranArac {
  readonly say: (kind: ToastKind, text: string) => void;
}

export function KalipFormEkran<V extends Readonly<Record<string, unknown>>>({
  dark,
  title,
  icon,
  subtitle,
  testId,
  values,
  initial,
  rules,
  canEdit = true,
  lockedTitle,
  lockedSub,
  onSave,
  onDone,
  onBack,
  homeHref,
  saveShort,
  saveAria,
  savedText,
  leaveText,
  leaveSaveLabel,
  preview,
  overlays,
  footer,
  children,
}: KalipFormEkranProps<V>) {
  const t = useTranslations("kalip");
  const { say, node: toast } = useKalipToast("form");
  const [hatalar, setHatalar] = useState<Hatalar>({});
  const [salla, setSalla] = useState(0);
  const [busy, setBusy] = useState(false);
  const [genel, setGenel] = useState<string | null>(null);
  // Hata anındaki değerler: kullanıcı alanı değiştirince o alanın hatası kalkar.
  const hataDeger = useRef<Readonly<Record<string, unknown>>>({});
  const dirty = canEdit && degisti(values, initial);

  useEffect(() => {
    setHatalar((cur) => {
      const keys = Object.keys(cur);
      if (keys.length === 0) return cur;
      const next: Record<string, string> = {};
      let changed = false;
      for (const k of keys) {
        if (JSON.stringify(values[k]) === JSON.stringify(hataDeger.current[k])) next[k] = cur[k] as string;
        else changed = true;
      }
      return changed ? next : cur;
    });
  }, [values]);

  const msg = useMemo(() => ({ required: t("vRequired"), email: t("vEmail"), number: t("vNumber"), tooLong: t("vTooLong") }), [t]);

  const goster = useCallback(
    (h: Hatalar, ruleList: readonly AlanKurali[]) => {
      hataDeger.current = { ...values };
      setHatalar(h);
      setSalla((n) => n + 1);
      tone("err");
      say("err", ozet(h, ruleList, msg.required, { missing: (n, list) => t("vMissing", { n, list }), invalid: (n, list) => t("vInvalid", { n, list }) }));
      const first = ilkHatali(h, ruleList);
      if (first === null) return;
      window.requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(`[data-alan="${CSS.escape(first)}"]`);
        if (el === null) return;
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
        const focusable = el.matches("input, textarea, button") ? el : el.querySelector<HTMLElement>("input, textarea, button:not([disabled])");
        focusable?.focus({ preventScroll: true });
      });
    },
    [values, say, msg, t],
  );

  const kaydet = useCallback(async (): Promise<boolean> => {
    if (!canEdit || busy) return false;
    setGenel(null);
    const h = dogrula(rules, values, msg);
    if (Object.keys(h).length > 0) {
      goster(h, rules);
      return false;
    }
    setBusy(true);
    let r: KaydetSonuc;
    try {
      r = await onSave();
    } catch (e) {
      setBusy(false);
      tone("err");
      if (eskiSurumMu(e)) eskiSurumBildir();
      else say("err", t("saveFailed"));
      return false;
    }
    setBusy(false);
    if (!r.ok) {
      if (r.alan !== undefined && Object.keys(r.alan).length > 0) {
        const extra: AlanKurali[] = Object.keys(r.alan)
          .filter((k) => !rules.some((x) => x.name === k))
          .map((k) => ({ name: k, label: k }));
        goster(r.alan, [...rules, ...extra]);
        if (r.mesaj !== undefined) setGenel(r.mesaj);
      } else {
        tone("err");
        const m = r.mesaj ?? t("saveFailed");
        setGenel(m);
        say("err", m);
      }
      return false;
    }
    tone("ok");
    say("ok", savedText ?? t("saved"));
    setHatalar({});
    return true;
  }, [canEdit, busy, rules, values, msg, goster, onSave, say, t, savedText]);

  const korunan = useCikisKorumasi(dirty, {
    dark,
    ...(leaveText === undefined ? {} : { text: leaveText }),
    saveLabel: leaveSaveLabel ?? t("saveLeave"),
    onSave: kaydet,
  });

  const onKaydet = (e?: FormEvent): void => {
    e?.preventDefault();
    if (!canEdit) return;
    if (!dirty) {
      tone("err");
      say("info", t("noChange"));
      return;
    }
    void kaydet().then((ok) => {
      if (ok) onDone();
    });
  };

  const zorunlu = useMemo(() => new Set(rules.filter((r) => r.required === true).map((r) => r.name)), [rules]);
  const baglam = useMemo(() => ({ hatalar, salla, zorunlu }), [hatalar, salla, zorunlu]);
  // Değişen alan sayısı (ana işlem rozeti).
  const changedN = canEdit ? Object.keys({ ...initial, ...values }).filter((k) => degisti(values[k], initial[k])).length : 0;
  return (
    <KalipEkran
      kind="form"
      dark={dark}
      title={title}
      icon={icon}
      {...(subtitle === undefined ? {} : { subtitle })}
      testId={testId ?? "kalip-form"}
      bar={{
        back: { onClick: () => korunan.sor(onBack), aria: t("back") },
        ...(homeHref === undefined ? {} : { homeNav: { href: homeHref } }),
        main: canEdit
          ? {
              label: saveShort ?? t("saveShort"),
              aria: saveAria ?? t("save"),
              d: LICON.check,
              onClick: () => onKaydet(),
              disabled: !dirty || busy,
              disabledReason: busy ? t("saving") : t("noChange"),
              badge: changedN,
              testId: `${testId ?? "kalip-form"}-save`,
            }
          : { label: "", aria: lockedTitle ?? t("readOnly"), d: LICON.lock, disabled: true, disabledReason: lockedTitle ?? t("readOnly") },
      }}
      overlays={
        <>
          {toast}
          {korunan.kutu}
          {overlays}
        </>
      }
    >
      <FormBaglamCtx.Provider value={baglam}>
        <div className="kfl">
          <form className="kfc" onSubmit={onKaydet} aria-label={title} noValidate data-dirty={dirty ? "true" : "false"}>
            {canEdit ? null : <KalipKilit title={lockedTitle ?? t("readOnly")} sub={lockedSub ?? t("readOnlySub")} />}
            {children}
            {genel === null ? null : (
              <p className="kgenel" role="alert" data-testid="kalip-form-issue">
                <Ico d={LICON.warn} size={18} />
                {genel}
              </p>
            )}
            {footer}
            <button type="submit" className="sr" tabIndex={-1} aria-hidden="true">
              {saveAria ?? t("save")}
            </button>
          </form>
          {preview === undefined ? null : (
            <aside className="konz" aria-label={t("preview")}>
              {preview}
            </aside>
          )}
        </div>
      </FormBaglamCtx.Provider>
    </KalipEkran>
  );
}

/** Sağdaki canlı önizleme: detay kalıbının hero kartı gibi (renkli tür ikonu, ad, kod, alt satırlar). */
export function KalipOnizleme({ name, code, d, color, kind, rows = [] }: { name: string; code: string; d: string; color: string; kind?: string; rows?: readonly { readonly k: string; readonly v: string }[] }) {
  const t = useTranslations("kalip");
  return (
    <div className="konc" data-testid="kalip-preview">
      <span className="konh">{t("preview")}</span>
      <span className="konic" style={{ background: c(color) }}>
        <Ico d={d} size={30} />
      </span>
      {kind === undefined ? null : <span className="konk">{kind}</span>}
      <b className="konn">{name.trim() === "" ? t("previewName") : name}</b>
      <span className="konco">{code.trim() === "" ? "—" : code}</span>
      {rows.length === 0 ? null : (
        <dl className="konr">
          {rows.map((r) => (
            <div key={r.k}>
              <dt>{r.k}</dt>
              <dd>{r.v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
