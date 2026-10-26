"use client";
// T-1042 (STANDART.md §1, kullanıcı onayı 26 Ekim): masaüstü standardı üst çubuk ORTAK parçaları — canlı saat, tema seçici, Ayarlar
// düğmesi. Kalıp kabı (KalipEkran) ve Pano üst çubuğu aynı bileşenleri kullanır; görünüm `design/standart.css` (`.st*`).
// Telefonda sığmayan parçalar CSS ile gizlenir (tema Hesap menüsünde zaten var; saat yalnız saate kısalır).
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { feedback, intlDil } from "@wms/ui";
import { SICON } from "../../../design/standart-icons.ts";
import { temaYaz } from "../../../design/theme.ts";
import { useKabuk } from "../kabuk/kabuk-bar.tsx";
import { myTodayActionsAction } from "../son-islemler-actions.ts";
import { useModalFocus } from "./odak.ts";
import { KalipPerdeKatman } from "./perde.tsx";

function Ico({ d, size }: { d: string; size: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** Canlı saat ve tarih (yeşil noktalı saat simgesi). Sunucu çiziminde boş kalır (saat dilimi farkı hidrasyon hatası vermesin). */
export function StSaat() {
  const t = useTranslations("kalip.st");
  const locale = intlDil(useLocale());
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  const time = now === null ? "" : new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(now);
  const date = now === null ? "" : new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", weekday: "long" }).format(now);
  return (
    <span className="stsaat" role="timer" aria-label={now === null ? t("clock") : t("clockAria", { time, date })} data-testid="st-saat">
      <i className="stsi" aria-hidden="true">
        <Ico d={SICON.clock} size={15} />
        <em />
      </i>
      <b>{time}</b>
      <small>{date}</small>
    </span>
  );
}

/** Tema seçici (güneş / ay); cihaz tercihi çerezi (Hesap menüsündeki geçişle aynı). `onToggle` verilirse (Pano yerel durumu) o çağrılır. */
export function StTema({ dark, onToggle }: { dark: boolean; onToggle?: () => void }) {
  const t = useTranslations("kalip.st");
  const router = useRouter();
  const set = (koyu: boolean): void => {
    if (koyu === dark) return;
    if (onToggle !== undefined) {
      onToggle();
      return;
    }
    temaYaz(koyu ? "koyu" : "acik");
    router.refresh();
  };
  return (
    <span className="sttema" role="radiogroup" aria-label={t("theme")} data-testid="st-tema">
      <button type="button" role="radio" aria-checked={!dark} aria-label={t("light")} className={dark ? undefined : "on"} onClick={() => set(false)}>
        <Ico d={SICON.sun} size={20} />
      </button>
      <button type="button" role="radio" aria-checked={dark} aria-label={t("dark")} className={dark ? "on" : undefined} onClick={() => set(true)}>
        <Ico d={SICON.moon} size={20} />
      </button>
    </span>
  );
}

/** Ayarlar düğmesi (dişli + "AYARLAR"); yalnız `settings.manage` sahibine (kabuk bağlamı `settingsHref`). Hesap'ın hemen önünde. */
export function StAyarlar({ href }: { href?: string | undefined }) {
  const t = useTranslations("kalip.st");
  const ctx = useKabuk();
  const to = href ?? ctx?.settingsHref;
  if (to === undefined) return null;
  return (
    <Link href={to} prefetch={false} className="stbtn stayar" aria-label={t("settings")} data-testid="st-ayarlar">
      <Ico d={SICON.gear} size={22} />
      <span>{t("settingsShort")}</span>
    </Link>
  );
}

interface SonIslem {
  readonly at: string;
  readonly key: string;
}

const gorulduAnahtar = (slug: string): string => `son-islem-goruldu:${slug}`;

/** Sekme içi ortak önbellek: üst çubuk her ekran geçişinde yeniden kurulur; sunucu (ve kullanıcı/firma hız sınırı) dakikada en çok bir kez sorulur. */
const TAZE_MS = 55_000;
type SonIslemSonuc = { readonly items: readonly SonIslem[]; readonly timeZone: string } | null;
const onbellek = new Map<string, { readonly at: number; readonly p: Promise<SonIslemSonuc> }>();
function sonIslemler(slug: string, zorla: boolean): Promise<SonIslemSonuc> {
  const c = onbellek.get(slug);
  if (!zorla && c !== undefined && Date.now() - c.at < TAZE_MS) return c.p;
  const p = myTodayActionsAction({ slug }).then(
    (r) => (r.ok ? { items: r.data.items, timeZone: r.data.timeZone } : null),
    () => null,
  );
  onbellek.set(slug, { at: Date.now(), p });
  return p;
}

/**
 * T-1053 (STANDART §1, tuval `StandartAnaEkran` "Son işlemler (3 yeni)"): saat simgeli düğme; açılınca BUGÜN kendi yaptıkların
 * (en yeni üstte, saatiyle). Rozet: son açılıştan beri yeni işlem sayısı (cihazda hatırlanır). Esc ve dışarı dokunuş kapatır,
 * odak düğmeye döner. Veri okunamazsa pencere nedeni söyler; ekran düşmez.
 */
export function StSonIslemler({ slug: slugProp }: { slug?: string | undefined }) {
  const t = useTranslations("kalip.st");
  const tAll = useTranslations();
  const locale = intlDil(useLocale());
  const ctx = useKabuk();
  const slug = slugProp ?? ctx?.slug;
  const [items, setItems] = useState<readonly SonIslem[] | null>(null);
  const [timeZone, setTimeZone] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<string | null>(null);
  const [yer, setYer] = useState<{ readonly top: number; readonly right: number; readonly koyu: boolean }>({ top: 0, right: 0, koyu: false });
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const kapat = useCallback((): void => setOpen(false), []);
  // ALTIN-KURAL 11 / Katman standardı: ortak perde + odak kancası (Esc kapatır, odak pencerede kalır, kapanınca düğmeye döner).
  useModalFocus(open, box, { onClose: kapat });

  const load = useCallback(
    async (zorla = false): Promise<void> => {
      if (slug === undefined) return;
      const r = await sonIslemler(slug, zorla);
      if (r === null) {
        setFailed(true);
        return;
      }
      setItems(r.items);
      setTimeZone(r.timeZone);
      setFailed(false);
    },
    [slug],
  );

  useEffect(() => {
    if (slug === undefined) return;
    try {
      setSeen(window.localStorage.getItem(gorulduAnahtar(slug)));
    } catch {
      /* cihazda saklanamıyor: rozet her işi yeni sayar */
    }
    // Codex P2 (PR 202): aynı ekranda yapılan yeni işler de rozete yansısın — sekme görünürken dakikada bir ve sekmeye dönüşte yenilenir.
    // Düğme yalnız masaüstünde görünür (standart.css `.stson`, 1100 px altı gizli): telefon/tablette sunucu çağrısı yapılmaz.
    const genis = window.matchMedia("(min-width: 1100px)");
    const yenile = (): void => {
      if (genis.matches && document.visibilityState === "visible") void load();
    };
    yenile();
    const id = window.setInterval(yenile, 60_000);
    document.addEventListener("visibilitychange", yenile);
    genis.addEventListener("change", yenile);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", yenile);
      genis.removeEventListener("change", yenile);
    };
  }, [slug, load]);

  if (slug === undefined) return null;
  const yeni = items === null ? 0 : items.filter((i) => seen === null || i.at > seen).length;
  const saat = (iso: string): string => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", ...(timeZone === undefined ? {} : { timeZone }) }).format(new Date(iso));
  const metin = (key: string): string => (tAll.has(key) ? tAll(key) : t("recentOther"));
  const ac = (): void => {
    feedback.minor();
    if (open) {
      setOpen(false);
      return;
    }
    const b = btn.current;
    if (b !== null) {
      const r = b.getBoundingClientRect();
      setYer({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right), koyu: b.closest(".dz-dark") !== null });
    }
    setOpen(true);
    // Açılış kullanıcı eylemi: önbelleği atlar (az önce yapılan iş de görünsün).
    void load(true);
    const now = new Date().toISOString();
    setSeen(now);
    try {
      window.localStorage.setItem(gorulduAnahtar(slug), now);
    } catch {
      /* yok say */
    }
  };
  return (
    <span className="stson">
      <button
        ref={btn}
        type="button"
        className="stbtn stsonb"
        aria-label={yeni > 0 ? t("recentNew", { n: yeni }) : t("recent")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={ac}
        data-testid="st-son-islemler"
      >
        <Ico d={SICON.clock} size={22} />
        {yeni > 0 ? (
          <em className="stsonn" aria-hidden="true">
            {yeni > 9 ? "9+" : yeni}
          </em>
        ) : null}
      </button>
      {open
        ? createPortal(
            <div className={yer.koyu ? "stsonk dz-dark" : "stsonk"}>
              <KalipPerdeKatman onClose={kapat} label={t("close")} />
              <div
                ref={box}
                className="stsonp"
                role="dialog"
                aria-modal="true"
                aria-label={t("recent")}
                tabIndex={-1}
                style={{ top: yer.top, right: yer.right }}
                data-testid="st-son-islemler-pencere"
              >
                <b className="stsonh">{t("recentTitle")}</b>
                {failed && items === null ? (
                  <p className="stsonbos">{t("recentFailed")}</p>
                ) : items === null ? (
                  <p className="stsonbos">{t("recentLoading")}</p>
                ) : items.length === 0 ? (
                  <p className="stsonbos">{t("recentEmpty")}</p>
                ) : (
                  <ol className="stsonl">
                    {items.map((i, n) => (
                      <li key={`${i.at}-${n}`}>
                        <i aria-hidden="true">
                          <Ico d={SICON.onay} size={16} />
                        </i>
                        <span>{metin(i.key)}</span>
                        <time dateTime={i.at}>{saat(i.at)}</time>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
