"use client";
// T-1095: "Nasıl kullanırım?" adım adım rehberi (kullanıcı 27 Ekim: "ilgili yere odaklanıp arka plan bulanıklaşır ve sırasıyla işi
// yaptırır"). Ortak buzlu perde (`KalipPerdeKatman`) hedefin çevresini delik bırakarak bütün ekranı örter; ipucu kartı tek satırdır;
// kullanıcı işi yapınca adım kendiliğinden ilerler (`adim-rehber-plan.ts` `done`), "İleri" yoktur. Perdeye (bulanık alana) dokununca rehber
// serbest bırakır ve küçük yüzen simgeye döner: "Kaldığın yerden" ya da "Baştan" (kullanıcı kararı). Durum yalnız bu cihazda tutulur.
// Eylem çağırmaz; hedefe dokunmak gerçek ekrandaki işlemi yapar (yetki ekranda/sunucuda).
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { feedback } from "@wms/ui";
import { JICON } from "../../../design/yolculuk-icons.ts";
import { useKabuk } from "../kabuk/kabuk-bar.tsx";
import { ADIM_YETKI, adimPlani, isAdimKaynak, isAdimRehber, type AdimKaynak, type AdimRehber } from "./adim-rehber-plan.ts";
import { cikisSor } from "./cikis.tsx";
import { KalipPerdeKatman, hedefKutusu, type PerdeDelik } from "./perde.tsx";
import { useSesliOku } from "./sesli-oku.ts";

export const ADIM_REHBER_EVENT = "etkinwms:adim-rehber";

interface Durum {
  readonly rehber: AdimRehber;
  readonly kaynak: AdimKaynak;
  readonly adim: number;
  readonly katli: boolean;
}

function Ikon({ d }: { d: string | readonly string[] }) {
  return (
    <svg className="ico" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      {(typeof d === "string" ? [d] : d).map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}

/** Görünür ilk eşleşen öğe. */
function gorunur(sel: string): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>(sel)].find((el) => el.getBoundingClientRect().width > 0) ?? null;
}

/** Rehber, kullanıcının yetkili olduğu aktarma işleri (kurulum adımı yetkisiyle aynı). */
/** Adımın sorgusu (`a=b&c=d`) adres çubuğundakinde var mı? Sorgusuz adım her zaman uygun. */
function sorguUygun(query: string | undefined): boolean {
  if (query === undefined || query === "" || typeof window === "undefined") return true;
  const simdi = new URLSearchParams(window.location.search);
  return [...new URLSearchParams(query)].every(([k, v]) => simdi.get(k) === v);
}

export function useAdimRehberleri(): readonly AdimRehber[] {
  const ctx = useKabuk();
  const setup = ctx?.guides?.setup ?? [];
  return (["urun", "depo", "cari"] as const).filter((r) => setup.includes(ADIM_YETKI[r]));
}

export function KalipAdimRehberi({ userId, slug, dark }: { userId: string; slug: string; dark: boolean }) {
  const t = useTranslations("operationGuide.adim");
  const sesliOku = useSesliOku();
  const ctx = useKabuk();
  const path = usePathname();
  const router = useRouter();
  const izinli = useAdimRehberleri();
  const base = `/t/${encodeURIComponent(slug)}`;
  const key = `etkinwms.adim.v1:${userId}:${slug}`;
  const [d, setD] = useState<Durum | null>(null);
  const [delik, setDelik] = useState<PerdeDelik | null>(null);
  const [biten, setBiten] = useState(false);
  // Doğru ekrandayken hedef bulunamıyor (ör. aktarma tür seçiminde): "Ekranı aç" adımın ekranını sorgusuyla yeniden açar.
  const [yok, setYok] = useState(false);

  const kaydet = useCallback(
    (n: Durum | null): void => {
      setD(n);
      try {
        if (n === null) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(n));
      } catch {
        /* depolama isteğe bağlı */
      }
    },
    [key],
  );

  // Sayfa yenilense de rehber kaldığı adımdan sürer (yalnız bu cihaz).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return;
      const s = JSON.parse(raw) as Partial<Durum>;
      if (isAdimRehber(s.rehber) && isAdimKaynak(s.kaynak) && Number.isInteger(s.adim) && (s.adim ?? -1) >= 0 && (s.adim ?? 99) < adimPlani(s.rehber, s.kaynak).length) {
        setD({ rehber: s.rehber, kaynak: s.kaynak, adim: s.adim as number, katli: s.katli === true });
      }
    } catch {
      /* bozuk kayıt rehberi engellemez */
    }
  }, [key]);

  const rehber = d?.rehber ?? null;
  const kaynak = d?.kaynak ?? null;
  const plan = useMemo(() => (rehber === null || kaynak === null ? [] : adimPlani(rehber, kaynak)), [rehber, kaynak]);
  const adim = d === null ? null : (plan[d.adim] ?? null);
  const burada = adim !== null && path === `${base}${adim.path}`;
  const acik = d !== null && !d.katli && izinli.includes(d.rehber);

  const git = useCallback(
    (r: AdimRehber, k: AdimKaynak, n: number, zorla = false): void => {
      const a = adimPlani(r, k)[n];
      if (a === undefined) return;
      const hedef = `${base}${a.path}`;
      if (zorla || path !== hedef || !sorguUygun(a.query)) cikisSor(() => router.push(`${hedef}${a.query ? `?${a.query}` : ""}`));
    },
    [base, path, router],
  );

  // T-1112 (Codex P2): adım aynı sayfanın başka bölümündeyse (`?bolum=akis`) ilerlerken ya da kaldığı yerden sürerken sorgu da uygulanır;
  // yoksa hedef başka bölümde kalır ve rehber "Ekranı aç"a düşerdi.
  useEffect(() => {
    if (!acik || adim === null || !burada || sorguUygun(adim.query)) return;
    router.replace(`${base}${adim.path}?${adim.query}`);
  }, [acik, adim, burada, base, router]);

  // Başlat: "Nasıl kullanırım?" seçim kutusundan `{ rehber, kaynak }`.
  useEffect(() => {
    const ac = (e: Event): void => {
      if (!(e instanceof CustomEvent)) return;
      const det = e.detail as { rehber?: unknown; kaynak?: unknown } | null;
      if (det === null || !isAdimRehber(det.rehber) || !isAdimKaynak(det.kaynak) || !izinli.includes(det.rehber)) return;
      setBiten(false);
      kaydet({ rehber: det.rehber, kaynak: det.kaynak, adim: 0, katli: false });
      ctx?.setGuideOwner?.("operation");
      git(det.rehber, det.kaynak, 0);
    };
    window.addEventListener(ADIM_REHBER_EVENT, ac);
    return () => window.removeEventListener(ADIM_REHBER_EVENT, ac);
  }, [ctx, git, izinli, kaydet]);

  // Hedefi ölç (delik) ve adımın bittiğini izle; bitince sesli/görsel onay ve sonraki adım (ya da "Tamamlandı").
  useEffect(() => {
    if (d === null || adim === null) return;
    const ilerle = (): void => {
      feedback.ok();
      if (d.adim + 1 >= plan.length) {
        kaydet(null);
        setBiten(true);
        window.setTimeout(() => setBiten(false), 4000);
        return;
      }
      kaydet({ ...d, adim: d.adim + 1 });
    };
    const done = adim.done;
    const olc = (): void => {
      if ("path" in done && path === `${base}${done.path}`) return ilerle();
      if ("sel" in done && burada && gorunur(done.sel) !== null) return ilerle();
      if (burada && adim.geri !== undefined && gorunur(adim.geri.sel) !== null) {
        const n = plan.findIndex((p) => p.key === adim.geri?.key);
        if (n >= 0 && n < d.adim) return kaydet({ ...d, adim: n });
      }
      const el = burada ? gorunur(adim.target) : null;
      setYok(burada && el === null);
      if (el === null) return setDelik((o) => (o === null ? o : null));
      const r = hedefKutusu(el);
      const n = { x: Math.round(r.left - 6), y: Math.round(r.top - 6), w: Math.round(r.width + 12), h: Math.round(r.height + 12) };
      setDelik((o) => (o !== null && o.x === n.x && o.y === n.y && o.w === n.w && o.h === n.h ? o : n));
    };
    olc();
    const id = window.setInterval(olc, 300);
    const tikla = (e: Event): void => {
      if (!("click" in done) || !(e.target instanceof Element)) return;
      if (e.target.closest(adim.target) !== null) window.setTimeout(ilerle, 300);
    };
    document.addEventListener("click", tikla, true);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("click", tikla, true);
    };
  }, [d, adim, plan, path, base, burada, kaydet]);

  if (biten) {
    return (
      <div className={`dzj${dark ? " dz-dark" : ""}`}>
        <section className="ycoach working" style={{ left: 12, bottom: 136, zIndex: 42 }} role="status" data-testid="adim-rehber-bitti">
          <b className="ctt">{t("done")}</b>
        </section>
      </div>
    );
  }
  if (d === null || adim === null || !izinli.includes(d.rehber)) return null;
  const ad = `${t(`names.${d.rehber}`)} · ${t(`kaynak.${d.kaynak}`)}`;
  const ilerleme = `${d.adim + 1}/${plan.length}`;
  const metin = t(`steps.${adim.key}`);
  const kapat = (): void => kaydet(null);

  if (!acik) {
    // Serbest: küçük yüzen simge — kaldığın yerden ya da baştan.
    return (
      <div className={`dzj${dark ? " dz-dark" : ""}`}>
        <section className="ycoach working folded" style={{ zIndex: 42 }} role="region" aria-label={ad} data-testid="adim-rehber" data-folded="true">
          <button type="button" className="ynb" onClick={() => { feedback.minor(); kaydet({ ...d, katli: false }); git(d.rehber, d.kaynak, d.adim); }} data-testid="adim-devam">
            {t("resume")} · {ilerleme}
          </button>
          <button type="button" className="ynb" onClick={() => { feedback.minor(); kaydet({ ...d, adim: 0, katli: false }); git(d.rehber, d.kaynak, 0); }} data-testid="adim-bastan">
            {t("restart")}
          </button>
          <button type="button" className="cbtn" onClick={kapat} aria-label={t("close")} data-testid="adim-kapat">
            <Ikon d={JICON.close} />
          </button>
        </section>
      </div>
    );
  }

  const sesli = (): void => {
    sesliOku(metin);
  };
  return (
    <div className={`dzj${dark ? " dz-dark" : ""}`}>
      <KalipPerdeKatman
        onClose={() => {
          feedback.minor();
          kaydet({ ...d, katli: true });
        }}
        label={t("free")}
        delik={delik}
      />
      <section className="ycoach working" style={{ left: 12, bottom: 136, zIndex: 42 }} role="region" aria-label={ad} data-testid="adim-rehber" data-step={adim.key}>
        <div className="cth">
          <span className="cstep" aria-live="polite">
            {ad} · {ilerleme}
          </span>
          <button type="button" className="cbtn" onClick={sesli} aria-label={t("speak")}>
            <Ikon d={[JICON.speak, JICON.speakWave]} />
          </button>
          <button type="button" className="cbtn" onClick={kapat} aria-label={t("close")} data-testid="adim-kapat">
            <Ikon d={JICON.close} />
          </button>
        </div>
        <p className="ctx" data-testid="adim-metin">
          {metin}
        </p>
        {burada && !yok ? null : (
          <button type="button" className="ynb go" onClick={() => git(d.rehber, d.kaynak, d.adim, burada)} data-testid="adim-ekran">
            {t("open")}
          </button>
        )}
      </section>
    </div>
  );
}
