"use client";
// T-1047 (STANDART §2 liste kalıbı, tuval StandartUrunlerListe): bütün listelerin ORTAK görünüm parçaları — Kart / Liste geçişi,
// "Sütunlar" seçimi (göster/gizle, sıra, "Varsayılana dön"; kod ve ad her zaman görünür), başlığa dokununca sıralanan tablo ve sayfa
// satırı ("1–20 / 80 ürün", ‹ İlk · Sonraki ›). Seçimler kişinin cihazında kalır (`localStorage`, ekran anahtarıyla); sunucuda kişiye
// özel kayıt ayrı iş (STANDART §8.8). Yeni liste ekranı yalnız sütun tanımı verir; görünüm `design/standart.css` (`.kt*`).
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LICON } from "../../../design/kalip-icons.ts";
import { SICON } from "../../../design/standart-icons.ts";
import { feedback } from "@wms/ui";
import { Ico } from "./ekran.tsx";

export type KalipGorunumTur = "kart" | "liste";

const oku = (k: string): string | null => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
const yaz = (k: string, v: string | null): void => {
  try {
    if (v === null) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, v);
  } catch {
    /* gizli pencere / engelli depolama: seçim yalnız bu açılışta kalır */
  }
};

/** Kart / Liste seçimi (ekran başına, cihazda). İlk çizim her zaman kart (sunucu ile aynı; hidrasyon farkı yok). */
export function useKalipGorunum(anahtar: string): [KalipGorunumTur, (g: KalipGorunumTur) => void] {
  const k = `kalip-gorunum:${anahtar}`;
  const [g, setG] = useState<KalipGorunumTur>("kart");
  // Telefonda (dar ekran) her zaman kart: tablo sığmaz; seçim saklı kalır, geniş ekranda geri gelir.
  const [dar, setDar] = useState(false);
  useEffect(() => {
    if (oku(k) === "liste") setG("liste");
    const mq = window.matchMedia("(max-width: 699.98px)");
    const f = (): void => setDar(mq.matches);
    f();
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, [k]);
  const sec = useCallback(
    (v: KalipGorunumTur) => {
      setG(v);
      yaz(k, v);
    },
    [k],
  );
  return [dar ? "kart" : g, sec];
}

/** Kart / Liste düğme çifti. */
export function KalipGorunumSec({ value, onChange }: { value: KalipGorunumTur; onChange: (g: KalipGorunumTur) => void }) {
  const t = useTranslations("kalip.tablo");
  return (
    <span className="ktgor" role="radiogroup" aria-label={t("view")} data-testid="kalip-gorunum">
      {(["kart", "liste"] as const).map((g) => (
        <button
          key={g}
          type="button"
          role="radio"
          aria-checked={value === g}
          className={value === g ? "on" : undefined}
          onClick={() => {
            feedback.minor();
            onChange(g);
          }}
          data-gorunum={g}
        >
          <Ico d={g === "kart" ? LICON.grid : SICON.list} size={18} />
          {t(g)}
        </button>
      ))}
    </span>
  );
}

export interface KalipSutun<T> {
  readonly id: string;
  readonly baslik: string;
  /** Her zaman görünür (ör. kod ve ad); seçimde kilitli. */
  readonly sabit?: boolean;
  /** Varsayılan görünürlük (verilmezse görünür). */
  readonly varsayilan?: boolean;
  readonly deger: (r: T) => ReactNode;
  /** Sıralama anahtarı; yoksa sütun sıralanmaz. */
  readonly sirala?: (r: T) => string | number;
  /** Sayı sütunu: sağa yaslı. */
  readonly sayi?: boolean;
}

/** Görünür sütunlar ve sırası (ekran başına, cihazda). */
export function useKalipSutunlar<T>(anahtar: string, sutunlar: readonly KalipSutun<T>[]) {
  const k = `kalip-sutun:${anahtar}`;
  const varsayilan = useMemo(() => sutunlar.filter((s) => s.sabit === true || s.varsayilan !== false).map((s) => s.id), [sutunlar]);
  const [secili, setSecili] = useState<readonly string[]>(varsayilan);
  useEffect(() => {
    const ham = oku(k);
    if (ham === null) return;
    try {
      const ids = (JSON.parse(ham) as unknown[]).filter((x): x is string => typeof x === "string" && sutunlar.some((s) => s.id === x));
      const sabitler = sutunlar.filter((s) => s.sabit === true).map((s) => s.id);
      setSecili([...sabitler.filter((x) => !ids.includes(x)), ...ids]);
    } catch {
      /* bozuk kayıt: varsayılan */
    }
  }, [k, sutunlar]);
  const kaydet = (ids: readonly string[]): void => {
    setSecili(ids);
    yaz(k, JSON.stringify(ids));
  };
  const degistir = (id: string): void => {
    const s = sutunlar.find((x) => x.id === id);
    if (s === undefined || s.sabit === true) return;
    kaydet(secili.includes(id) ? secili.filter((x) => x !== id) : [...secili, id]);
  };
  const tasi = (id: string, yon: -1 | 1): void => {
    const i = secili.indexOf(id);
    const j = i + yon;
    if (i < 0 || j < 0 || j >= secili.length) return;
    const yeni = [...secili];
    [yeni[i], yeni[j]] = [yeni[j]!, yeni[i]!];
    kaydet(yeni);
  };
  const sifirla = (): void => {
    setSecili(varsayilan);
    yaz(k, null);
  };
  const gorunur = secili.map((id) => sutunlar.find((s) => s.id === id)).filter((s): s is KalipSutun<T> => s !== undefined);
  return { secili, gorunur, degistir, tasi, sifirla };
}

/** "Sütunlar" düğmesi + seçim penceresi (işaretle, yukarı/aşağı sırala, Varsayılana dön). */
export function KalipSutunSec<T>({ sutunlar, secim }: { sutunlar: readonly KalipSutun<T>[]; secim: ReturnType<typeof useKalipSutunlar<T>> }) {
  const t = useTranslations("kalip.tablo");
  const [acik, setAcik] = useState(false);
  const kutu = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!acik) return;
    const kapat = (e: MouseEvent | KeyboardEvent): void => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !kutu.current?.contains(e.target as Node)) setAcik(false);
    };
    document.addEventListener("mousedown", kapat);
    document.addEventListener("keydown", kapat);
    return () => {
      document.removeEventListener("mousedown", kapat);
      document.removeEventListener("keydown", kapat);
    };
  }, [acik]);
  const sirali = [...secim.secili.map((id) => sutunlar.find((s) => s.id === id)).filter((s): s is KalipSutun<T> => s !== undefined), ...sutunlar.filter((s) => !secim.secili.includes(s.id))];
  return (
    <span className="ktsut" ref={kutu}>
      <button type="button" className="ktbtn" aria-expanded={acik} aria-haspopup="dialog" onClick={() => setAcik((a) => !a)} data-testid="kalip-sutunlar">
        <Ico d={SICON.sliders} size={18} />
        {t("columns")}
      </button>
      {acik ? (
        <span className="ktpop" role="dialog" aria-label={t("columns")} data-testid="kalip-sutunlar-pencere">
          {sirali.map((s) => {
            const on = secim.secili.includes(s.id);
            return (
              <span key={s.id} className="ktrow">
                <label>
                  <input type="checkbox" checked={on} disabled={s.sabit === true} onChange={() => secim.degistir(s.id)} />
                  <span>{s.baslik}</span>
                  {s.sabit === true ? <small>{t("always")}</small> : null}
                </label>
                {on ? (
                  <span className="ktmv">
                    <button type="button" aria-label={t("up", { col: s.baslik })} onClick={() => secim.tasi(s.id, -1)}>
                      <Ico d={SICON.chevUp} size={16} />
                    </button>
                    <button type="button" aria-label={t("down", { col: s.baslik })} onClick={() => secim.tasi(s.id, 1)}>
                      <Ico d={SICON.chevDown} size={16} />
                    </button>
                  </span>
                ) : null}
              </span>
            );
          })}
          <button type="button" className="ktreset" onClick={secim.sifirla}>
            {t("reset")}
          </button>
        </span>
      ) : null}
    </span>
  );
}

/** Sıralanabilir tablo (başlığa dokun: artan / azalan). Satır bir bağlantıdır (kartla aynı hedef). */
export function KalipTablo<T>({ label, sutunlar, satirlar, anahtar, href, satirAria, testId, sonu }: { label: string; sutunlar: readonly KalipSutun<T>[]; satirlar: readonly T[]; anahtar: (r: T) => string; href: (r: T) => string; satirAria: (r: T) => string; testId?: string; /** T-1055: tablonun altında, kayan bölgenin içinde (ör. `KalipSonsuz`). */ sonu?: ReactNode }) {
  const [sira, setSira] = useState<{ id: string; yon: 1 | -1 } | null>(null);
  const sirali = useMemo(() => {
    const s = sira === null ? undefined : sutunlar.find((x) => x.id === sira.id);
    if (s?.sirala === undefined || sira === null) return satirlar;
    const f = s.sirala;
    return [...satirlar].sort((a, b) => {
      const x = f(a);
      const y = f(b);
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sira.yon;
    });
  }, [satirlar, sutunlar, sira]);
  return (
    <div className="kttab" role="region" aria-label={label} data-testid={testId}>
      <table>
        <thead>
          <tr>
            {sutunlar.map((s) => {
              const aktif = sira?.id === s.id;
              return (
                <th key={s.id} className={s.sayi === true ? "num" : undefined} aria-sort={aktif ? (sira.yon === 1 ? "ascending" : "descending") : undefined} scope="col">
                  {s.sirala === undefined ? (
                    s.baslik
                  ) : (
                    <button type="button" onClick={() => setSira((o) => (o?.id === s.id ? { id: s.id, yon: o.yon === 1 ? -1 : 1 } : { id: s.id, yon: 1 }))}>
                      {s.baslik}
                      {aktif ? <Ico d={sira.yon === 1 ? SICON.chevUp : SICON.chevDown} size={14} /> : null}
                    </button>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sirali.map((r) => (
            <tr key={anahtar(r)}>
              {sutunlar.map((s, i) => (
                <td key={s.id} className={s.sayi === true ? "num" : undefined}>
                  {i === 0 ? (
                    <Link href={href(r)} className="ktlink" aria-label={satirAria(r)}>
                      {s.deger(r)}
                    </Link>
                  ) : (
                    s.deger(r)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {sonu}
    </div>
  );
}

/** Sayfa satırı: "1–20 / 80" + ‹ İlk · Sonraki ›. Sayfalar imleçlidir (numaralı atlama ayrı iş). */
export function KalipSayfa({ metin, ilk, sonraki, testId }: { metin: string; ilk?: string | undefined; sonraki?: string | undefined; testId?: string }) {
  const t = useTranslations("kalip.tablo");
  return (
    <nav className="ktsayfa" aria-label={t("pages")} data-testid={testId}>
      <span>{metin}</span>
      <span className="ktpg">
        {ilk === undefined ? (
          <span className="ktpb off" aria-hidden="true">
            <Ico d={SICON.chevLeft} size={18} />
          </span>
        ) : (
          <Link className="ktpb" href={ilk} aria-label={t("first")}>
            <Ico d={SICON.chevLeft} size={18} />
          </Link>
        )}
        {sonraki === undefined ? (
          <span className="ktpb off" aria-hidden="true">
            <Ico d={LICON.chev} size={18} />
          </span>
        ) : (
          <Link className="ktpb" href={sonraki} aria-label={t("next")} data-testid="kalip-sayfa-sonraki">
            <Ico d={LICON.chev} size={18} />
          </Link>
        )}
      </span>
    </nav>
  );
}

/**
 * T-1055 (kullanıcı kararı 26 Ekim: "sayfa yerine kaydırma"): liste sonu. Kayan listenin içinde en altta durur; görünür olmaya yaklaşınca
 * (`rootMargin` 400 px) sonraki sayfayı ister — sayfa satırı / "Sonraki" düğmesi yok. Yükleme sürerken gösterge, hata olursa "Tekrar dene";
 * liste bitince yalnız sayı yazar. Tek seferde tek istek; yükleme sonrası hâlâ görünürse (kısa liste) sıradaki sayfayı da ister.
 */
export function KalipSonsuz({ devam, yukle, metin, testId }: { devam: boolean; yukle: () => Promise<boolean>; metin: string; testId?: string }) {
  const t = useTranslations("kalip.tablo");
  const ref = useRef<HTMLDivElement>(null);
  const mesgul = useRef(false);
  const [durum, setDurum] = useState<"bekle" | "yukleniyor" | "hata">("bekle");
  const [tur, setTur] = useState(0);
  const [yukari, setYukari] = useState(false);
  // Kayan bölge = listenin kendisi (`.ulist` / `.kttab`); başa dön oku ve konum hafızası onu izler.
  useEffect(() => {
    const kap = ref.current?.parentElement;
    if (kap === null || kap === undefined) return undefined;
    const anahtar = `kalip-kaydir:${window.location.pathname}${window.location.search}`;
    // Bir kayda girip geri dönünce kaldığın yer (eklenen sayfalar `useKalipDerinlik` ile sunucudan yeniden gelir; gelince yerleşir).
    const bas = Date.now();
    let hedef = 0;
    try {
      hedef = Number(window.sessionStorage.getItem(anahtar) ?? "0") || 0;
    } catch {
      hedef = 0;
    }
    let raf = 0;
    const yerlestir = (): void => {
      // Eklenen sayfalar sunucudan yeniden gelirken birkaç saniye bekler.
      if (hedef <= 0 || Date.now() - bas > 4000) return;
      if (kap.scrollHeight - kap.clientHeight >= hedef) kap.scrollTop = hedef;
      else raf = window.requestAnimationFrame(yerlestir);
    };
    raf = window.requestAnimationFrame(yerlestir);
    const kaydir = (): void => {
      setYukari(kap.scrollTop > 600);
      try {
        window.sessionStorage.setItem(anahtar, String(Math.round(kap.scrollTop)));
      } catch {
        /* depolama yoksa yalnız bu açılış */
      }
    };
    kap.addEventListener("scroll", kaydir, { passive: true });
    return () => {
      window.cancelAnimationFrame(raf);
      kap.removeEventListener("scroll", kaydir);
    };
  }, []);
  const iste = useCallback((): void => {
    if (mesgul.current) return;
    mesgul.current = true;
    setDurum("yukleniyor");
    void yukle()
      .then((ok) => setDurum(ok ? "bekle" : "hata"))
      .catch(() => setDurum("hata"))
      .finally(() => {
        mesgul.current = false;
        setTur((n) => n + 1);
      });
  }, [yukle]);
  useEffect(() => {
    const el = ref.current;
    if (el === null || !devam || durum === "hata" || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) iste();
    }, { rootMargin: "400px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [devam, durum, iste, tur]);
  return (
    <div ref={ref} className="ktson" role="status" aria-live="polite" data-testid={testId} data-devam={devam ? "1" : "0"}>
      {yukari ? (
        <button
          type="button"
          className="ktust"
          aria-label={t("top")}
          title={t("top")}
          data-testid="kalip-basa-don"
          onClick={() => {
            feedback.minor();
            ref.current?.parentElement?.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          <Ico d={SICON.chevUp} size={22} />
        </button>
      ) : null}
      {!devam ? (
        <span>{metin}</span>
      ) : durum === "hata" ? (
        <button type="button" className="ktsonb" onClick={iste}>
          {t("retry")}
        </button>
      ) : (
        <span>{durum === "yukleniyor" ? t("loading") : metin}</span>
      )}
    </div>
  );
}

/**
 * T-1055: kaydırma derinliği hafızası (oturum içi, adres başına). Bir kayda girip geri dönülünce liste aynı uzunluğa kadar sunucudan
 * YENİDEN yüklenir (`yukle` sırayla çağrılır) ve `KalipSonsuz` kaldığın yere kaydırır. Yalnız SAYI saklanır — satır / stok verisi
 * saklanmaz (Codex P1/P2, PR 204): başka kullanıcının kapsamı ya da değişmiş kayıt eski veriden gösterilmez; her satır o anki üyenin
 * yetkisiyle taze gelir. Kayıt 10 dakika sonra geçersiz.
 */
const DERIN_OMUR_MS = 10 * 60_000;
const derinAnahtar = (): string => `kalip-derin:${window.location.pathname}${window.location.search}`;

export function useKalipDerinlik(yuklenen: number, devam: boolean, yukle: () => Promise<boolean>): void {
  const [hedef, setHedef] = useState(0);
  const mesgul = useRef(false);
  useEffect(() => {
    try {
      const ham = window.sessionStorage.getItem(derinAnahtar());
      const k = ham === null ? null : (JSON.parse(ham) as { readonly t?: number; readonly n?: number });
      if (k !== null && typeof k.t === "number" && typeof k.n === "number" && Date.now() - k.t < DERIN_OMUR_MS) setHedef(Math.min(k.n, 1000));
    } catch {
      /* bozuk ya da erişilemeyen kayıt: ilk sayfayla devam */
    }
  }, []);
  useEffect(() => {
    try {
      window.sessionStorage.setItem(derinAnahtar(), JSON.stringify({ t: Date.now(), n: yuklenen }));
    } catch {
      /* dolu / engelli depolama */
    }
  }, [yuklenen]);
  useEffect(() => {
    if (yuklenen >= hedef || !devam || mesgul.current) return;
    mesgul.current = true;
    void yukle()
      .then((ok) => {
        if (!ok) setHedef(0);
      })
      .catch(() => setHedef(0))
      .finally(() => {
        mesgul.current = false;
      });
  }, [yuklenen, hedef, devam, yukle]);
}
