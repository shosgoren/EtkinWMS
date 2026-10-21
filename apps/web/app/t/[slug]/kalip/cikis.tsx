"use client";
// T-990 (B-97, ALTIN-KURAL "Kaydedilmemiş iş uyarısı"): TEK çıkış koruması. Yarım iş varken uygulama içindeki her gezinme (alt çubuğun Geri /
// Ana ekran / Modüller kutuları, üst çubuk, hesap menüsü, sayfadaki bağlantılar) YALNIZ uygulamanın cam kutusunu açar: "… ve çık" ·
// "Kaydetmeden çık" · "Vazgeç, burada kalayım". Tarayıcının kendi "Siteden çıkılsın mı?" penceresi (`beforeunload`) yalnız sekme kapatma ve
// sayfa yenilemede kalır; uygulama içi geçişte asla çıkmaz. Değişiklik yoksa sormadan geçer.
// Kök neden (Cariler, canlı 21 Ekim): alt çubuğun Ana ekran / Modüller kutuları düz `<a href>` (tam sayfa gezinmesi) olduğundan form
// `beforeunload` dinlerken tarayıcı penceresi açılıyordu. Çözüm: (1) KabukBar / Modüller / Hesap menüsü bağlantıları istemci içi geçiştir
// ve önce `cikisSor`'a sorar; (2) korunan form açıkken belgeye yakalama evresinde her aynı köken bağlantı tıklaması durdurulur, cam kutu
// açılır, "Kaydetmeden çık" seçilince istemci içi geçişle gidilir (`beforeunload` o an susturulur).
// `beforeunload` bu dosya dışında yazılmaz (bekçi: ui-standards.test.ts).
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { LICON } from "../../../design/kalip-icons.ts";
import { Ico, tone } from "./ekran.tsx";

type Ask = (proceed: () => void) => void;
interface Kayit {
  readonly id: string;
  readonly ask: Ask;
}
/** Açık korumalar (en son açılan sorar). Modül düzeyi: KabukBar ve kalıp dışı bağlantılar React ağacından bağımsız ulaşır. */
const korumalar: Kayit[] = [];
let gecis = false;

/** Uygulama içi gezinmeden önce sor: yarım iş varsa cam kutu açılır, yoksa hemen geçer. KabukBar ve ekranlar kullanır. */
export function cikisSor(proceed: () => void): void {
  const top = korumalar[korumalar.length - 1];
  if (top === undefined || gecis) proceed();
  else top.ask(proceed);
}

/** Yarım iş var mı (test ve çubuk için). */
export function cikisKorumasiAcik(): boolean {
  return korumalar.length > 0;
}

/**
 * "Kaydetmeden çık" sonrası "Değişiklikler bırakıldı" balonu (ALTIN-KURAL). Gidilen ekran kalıp kabı olmayabilir; balon belgeye bağlı tek
 * kalıp balonu olarak çizilir (istemci içi geçişte yaşar), 2,6 sn sonra kalkar. Görünüş kaynak `.toast` (KalipForm), ses `tone`.
 */
function birakildiBalonu(text: string, dark: boolean): void {
  try {
    document.querySelector(".kbirak")?.remove();
    const host = document.createElement("div");
    host.className = `dzf kbirak${dark ? " dz-dark" : ""}`;
    const box = document.createElement("div");
    box.className = "toast";
    box.setAttribute("role", "status");
    box.setAttribute("data-testid", "kalip-toast-discarded");
    box.textContent = text;
    host.appendChild(box);
    document.body.appendChild(host);
    window.setTimeout(() => host.remove(), 2600);
  } catch {
    /* belge yoksa balon yok */
  }
}

/** Kaydetmeden çık / kaydedip çık: `beforeunload` bir kez susturulur, sonra gidilir. */
function serbestGit(proceed: () => void): void {
  gecis = true;
  try {
    proceed();
  } finally {
    // Tam sayfa gezinmesinde sayfa zaten gider; istemci gezinmesinde koruma bileşenle birlikte kalkar.
    window.setTimeout(() => {
      gecis = false;
    }, 5000);
  }
}

function hedefBaglanti(e: MouseEvent): HTMLAnchorElement | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
  if (!(a instanceof HTMLAnchorElement)) return null;
  if (a.target !== "" && a.target !== "_self") return null;
  if (a.hasAttribute("download")) return null;
  let url: URL;
  try {
    url = new URL(a.href, window.location.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  // Aynı sayfa içi çapa (yalnız `#…`) gezinme değildir.
  if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash !== "") return null;
  return a;
}

export interface CikisKorumasi {
  /** Ekranın kendi Geri düğmesi: yarım iş varsa sorar, yoksa `proceed`. */
  readonly sor: (proceed: () => void) => void;
  /** Kabın `overlays` yuvasına verilir. */
  readonly kutu: ReactNode;
}

export interface CikisSecenek {
  /** Kutu başlığı (verilmezse "Kaydedilmemiş değişiklik var"). */
  readonly title?: string;
  /** Kutudaki açıklama ("Kartta kaydedilmemiş değişiklik var…"). Verilmezse ortak metin. */
  readonly text?: string;
  /** "… ve çık" düğmesi (ör. "Gönder ve çık"); verilmezse "Kaydet ve çık". */
  readonly saveLabel?: string;
  /** Verilirse kutuda "… ve çık" görünür; `true` dönerse gidilir (doğrulama/sunucu hatasında kalınır). */
  readonly onSave?: () => Promise<boolean> | boolean;
  readonly dark?: boolean;
}

/**
 * Yarım iş koruması. `dirty` başlangıç değerleriyle karşılaştırılarak verilir (bir alan yazılıp silinirse değişiklik sayılmaz).
 * Açıkken: bağlantı tıklamaları ve `cikisSor` çağrıları cam kutuya gider; sekme kapatma/yenilemede tarayıcının uyarısı.
 */
export function useCikisKorumasi(dirty: boolean, opts: CikisSecenek = {}): CikisKorumasi {
  const id = useId();
  const t = useTranslations("kalip");
  const router = useRouter();
  const [bekleyen, setBekleyen] = useState<(() => void) | null>(null);
  const [busy, setBusy] = useState(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const ask = useCallback<Ask>((proceed) => {
    tone("tap");
    setBekleyen(() => proceed);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const kayit: Kayit = { id, ask };
    korumalar.push(kayit);
    const onClick = (e: MouseEvent): void => {
      if (korumalar[korumalar.length - 1]?.id !== id || gecis) return;
      const a = hedefBaglanti(e);
      if (a === null) return;
      e.preventDefault();
      e.stopPropagation();
      const url = new URL(a.href, window.location.href);
      // İstemci içi geçiş (tam sayfa yüklemesi yok): uygulama içi bağlantıların hepsi aynı kökende.
      ask(() => router.push(`${url.pathname}${url.search}${url.hash}`));
    };
    const onBefore = (e: BeforeUnloadEvent): void => {
      if (gecis) return;
      e.preventDefault();
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onBefore);
    return () => {
      const i = korumalar.findIndex((k) => k.id === id);
      if (i >= 0) korumalar.splice(i, 1);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBefore);
    };
  }, [dirty, id, ask, router]);

  const sor = useCallback(
    (proceed: () => void) => {
      if (!dirty || gecis) proceed();
      else ask(proceed);
    },
    [dirty, ask],
  );

  const kutu = (
    <KalipCikisUyarisi
      open={bekleyen !== null}
      dark={opts.dark}
      {...(opts.title === undefined ? {} : { title: opts.title })}
      text={opts.text}
      saveLabel={opts.saveLabel}
      busy={busy}
      onSave={
        opts.onSave === undefined
          ? undefined
          : () => {
              const go = bekleyen;
              const save = optsRef.current.onSave;
              if (save === undefined) return;
              setBusy(true);
              void Promise.resolve(save()).then((ok) => {
                setBusy(false);
                if (!ok) {
                  setBekleyen(null);
                  return;
                }
                setBekleyen(null);
                if (go !== null) serbestGit(go);
              });
            }
      }
      onLeave={() => {
        const go = bekleyen;
        setBekleyen(null);
        tone("tap");
        birakildiBalonu(t("discarded"), opts.dark === true || document.querySelector(".dz-dark") !== null);
        if (go !== null) serbestGit(go);
      }}
      onStay={() => setBekleyen(null)}
    />
  );
  return { sor, kutu };
}

/**
 * Kaynak `.cfback` + `.cfbox` (KalipForm.dc.html; Ekip/Gruplar/Aktar kaynaklarındaki kutu aynı) — TEK ortak çıkış kutusu. Kendi `.dzf`
 * katmanında (sabit, tam ekran) çizilir; hangi ekranda açılırsa açılsın görünüş aynıdır. Perde ortak buzlu perdedir (perde.css).
 */
export function KalipCikisUyarisi({
  open,
  text,
  saveLabel,
  onSave,
  onLeave,
  onStay,
  dark,
  busy = false,
  title,
  leaveLabel,
}: {
  open: boolean;
  text?: string | undefined;
  saveLabel?: string | undefined;
  onSave?: (() => void) | undefined;
  onLeave: () => void;
  onStay: () => void;
  dark?: boolean | undefined;
  busy?: boolean;
  title?: string;
  leaveLabel?: string;
}) {
  const t = useTranslations("kalip");
  const [koyu, setKoyu] = useState(dark === true);
  useEffect(() => {
    if (!open) return;
    if (dark !== undefined) setKoyu(dark);
    else setKoyu(document.querySelector(".dz-dark") !== null);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onStay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onStay, dark]);
  if (!open) return null;
  return (
    <div className={`dzf kcikis${koyu ? " dz-dark" : ""}`} data-testid="kalip-unsaved-layer">
      <div className="cfback" onClick={onStay} />
      <div className="cfbox" role="alertdialog" aria-modal="true" aria-label={title ?? t("unsavedTitle")} data-testid="kalip-unsaved">
        <span className="cfic">
          <Ico d={LICON.warn} size={28} />
        </span>
        <b>{title ?? t("unsavedTitle")}</b>
        <p>{text ?? t("unsavedText")}</p>
        {onSave === undefined ? null : (
          <button type="button" className="cfb save" onClick={onSave} disabled={busy} autoFocus data-testid="kalip-unsaved-save">
            <Ico d={LICON.check} size={20} />
            {saveLabel ?? t("saveLeave")}
          </button>
        )}
        <button type="button" className="cfb leave" onClick={onLeave} disabled={busy} data-testid="kalip-unsaved-leave">
          {leaveLabel ?? t("leave")}
        </button>
        <button type="button" className="cfb stay" onClick={onStay} autoFocus={onSave === undefined} data-testid="kalip-unsaved-stay">
          {t("stay")}
        </button>
      </div>
    </div>
  );
}
