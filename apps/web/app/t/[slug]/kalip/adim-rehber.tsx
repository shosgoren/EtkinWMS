"use client";
// T-1095: "Nasıl kullanırım?" adım adım rehberi (kullanıcı 27 Ekim: "ilgili yere odaklanıp arka plan bulanıklaşır ve sırasıyla işi
// yaptırır"). Ortak buzlu perde (`KalipPerdeKatman`) hedefin çevresini delik bırakarak bütün ekranı örter; ipucu kartı tek satırdır;
// kullanıcı işi yapınca adım kendiliğinden ilerler (`adim-rehber-plan.ts` `done`), "İleri" yoktur. Perdeye (bulanık alana) dokununca rehber
// serbest bırakır ve küçük yüzen simgeye döner: "Kaldığın yerden" ya da "Baştan" (kullanıcı kararı). Durum yalnız bu cihazda tutulur.
// Eylem çağırmaz; hedefe dokunmak gerçek ekrandaki işlemi yapar (yetki ekranda/sunucuda).
// T-1124: durum işlem rehberleriyle ortak (`rehber-durum.ts`): başka bölüme geçince kapanmaz, katlanır; başka rehber başlayınca adımı
// hatırlanır ve seçiciden kaldığı yerden sürer. Adım başında hedef görünür alana gelir ve odak alır (`useRehberHedef`).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { feedback } from "@wms/ui";
import { JICON } from "../../../design/yolculuk-icons.ts";
import { useKabuk } from "../kabuk/kabuk-bar.tsx";
import { ADIM_YETKI, adimPlani, isAdimKaynak, isAdimRehber, type AdimKaynak, type AdimRehber } from "./adim-rehber-plan.ts";
import { cikisSor } from "./cikis.tsx";
import { KalipPerdeKatman } from "./perde.tsx";
import { adimaGit, adimKimlik, baslat, bitir, kapat, katla, kimlikCoz, useRehberDurum } from "./rehber-durum.ts";
import { kartYeri, useRehberHedef, type KartYeri } from "./rehber-hedef.ts";
import { LICON } from "../../../design/kalip-icons.ts";
import { ICON as BICON } from "../../../design/bakis-icons.ts";
import { OP_GUIDE_EVENT } from "./rehber-plan.ts";
import { useSesliOku } from "./sesli-oku.ts";

export const ADIM_REHBER_EVENT = "etkinwms:adim-rehber";

interface Durum {
  readonly rehber: AdimRehber;
  readonly kaynak: AdimKaynak;
  readonly adim: number;
  readonly katli: boolean;
}
/** Kurulum yolculuğunu kapatmadan katlar (`rehber.tsx` `JOURNEY_PAUSE_EVENT` ile aynı; döngüsel içe aktarma olmasın diye yazılı). */
const JOURNEY_PAUSE = "etkinwms:journey-pause";

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
  const to = useTranslations("operationGuide");
  const sesliOku = useSesliOku();
  const ctx = useKabuk();
  const path = usePathname();
  const router = useRouter();
  const izinli = useAdimRehberleri();
  const base = `/t/${encodeURIComponent(slug)}`;
  const [st, guncelle] = useRehberDurum(`${userId}:${slug}`);
  const [biten, setBiten] = useState(false);
  const k = kimlikCoz(st.aktif);
  const d: Durum | null = k?.tur === "adim" ? { rehber: k.rehber, kaynak: k.kaynak, adim: st.adimlar[adimKimlik(k.rehber, k.kaynak)] ?? 0, katli: st.katli } : null;
  const id = d === null ? null : adimKimlik(d.rehber, d.kaynak);
  const owner = ctx?.guideOwner;
  const setOwner = ctx?.setGuideOwner;

  const rehber = d?.rehber ?? null;
  const kaynak = d?.kaynak ?? null;
  const plan = useMemo(() => (rehber === null || kaynak === null ? [] : adimPlani(rehber, kaynak)), [rehber, kaynak]);
  const adim = d === null ? null : (plan[Math.min(d.adim, plan.length - 1)] ?? null);
  const burada = adim !== null && path === `${base}${adim.path}`;
  // Rehberin bölümü (planın ekranlarından biri): dışındaysa rehber kapanmaz, yüzen simgeye katlanır.
  const bolumde = plan.some((p) => path === `${base}${p.path}`);
  const acik = d !== null && !d.katli && bolumde && izinli.includes(d.rehber) && owner !== "setup";

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

  // Başlat: "Nasıl kullanırım?" seçim kutusundan `{ rehber, kaynak }`. T-1124: daha önce yarıda kaldıysa kaldığı adımdan sürer.
  useEffect(() => {
    const ac = (e: Event): void => {
      if (!(e instanceof CustomEvent)) return;
      const det = e.detail as { rehber?: unknown; kaynak?: unknown } | null;
      if (det === null || !isAdimRehber(det.rehber) || !isAdimKaynak(det.kaynak) || !izinli.includes(det.rehber)) return;
      setBiten(false);
      const yeni = adimKimlik(det.rehber, det.kaynak);
      const n = st.adimlar[yeni] ?? 0;
      guncelle((x) => baslat(x, yeni));
      setOwner?.("operation");
      window.dispatchEvent(new Event(JOURNEY_PAUSE));
      git(det.rehber, det.kaynak, n);
    };
    window.addEventListener(ADIM_REHBER_EVENT, ac);
    return () => window.removeEventListener(ADIM_REHBER_EVENT, ac);
  }, [setOwner, git, izinli, guncelle, st.adimlar]);

  const { delik, yok } = useRehberHedef(adim?.target ?? null, acik && burada, `${id ?? ""}:${d?.adim ?? 0}`);

  const dAdim = d?.adim ?? 0;
  // Adımın bittiğini izle; bitince sesli/görsel onay ve sonraki adım (ya da "Tamamlandı").
  useEffect(() => {
    if (id === null || adim === null || owner === "setup") return;
    const ilerle = (): void => {
      feedback.ok();
      if (dAdim + 1 >= plan.length) {
        guncelle((x) => bitir(x, id));
        setBiten(true);
        window.setTimeout(() => setBiten(false), 4000);
        return;
      }
      guncelle((x) => adimaGit(x, id, dAdim + 1));
    };
    const done = adim.done;
    const olc = (): void => {
      if ("path" in done && path === `${base}${done.path}`) return ilerle();
      if ("sel" in done && burada && gorunur(done.sel) !== null) return ilerle();
      if (burada && adim.geri !== undefined && gorunur(adim.geri.sel) !== null) {
        const n = plan.findIndex((p) => p.key === adim.geri?.key);
        if (n >= 0 && n < dAdim) guncelle((x) => adimaGit(x, id, n));
      }
    };
    olc();
    const iv = window.setInterval(olc, 300);
    const tikla = (e: Event): void => {
      if (!("click" in done) || !(e.target instanceof Element)) return;
      if (e.target.closest(adim.target) !== null) window.setTimeout(ilerle, 300);
    };
    document.addEventListener("click", tikla, true);
    return () => {
      window.clearInterval(iv);
      document.removeEventListener("click", tikla, true);
    };
  }, [dAdim, id, adim, plan, path, base, burada, guncelle, owner]);

  // Kart delikleri örtmesin (işlem rehberiyle aynı köşe seçimi).
  const kart = useRef<HTMLElement>(null);
  const [yer, setYer] = useState<KartYeri>({ left: 12, bottom: 136 });
  useLayoutEffect(() => {
    const el = kart.current;
    if (el === null || !acik) return;
    const r = el.getBoundingClientRect();
    const y = kartYeri(delik ?? [], window.innerWidth, window.innerHeight, r.width, r.height);
    setYer((o) => (o.left === y.left && o.right === y.right && o.top === y.top && o.bottom === y.bottom ? o : y));
  }, [delik, acik, d?.adim]);

  if (biten) {
    return (
      <div className={`dzj${dark ? " dz-dark" : ""}`}>
        <section className="ycoach working" style={{ left: 12, bottom: 136, zIndex: 42 }} role="status" data-testid="adim-rehber-bitti">
          <b className="ctt">{t("done")}</b>
        </section>
      </div>
    );
  }
  if (d === null || id === null || adim === null || !izinli.includes(d.rehber) || owner === "setup") return null;
  const ad = `${t(`names.${d.rehber}`)} · ${t(`kaynak.${d.kaynak}`)}`;
  const ilerleme = `${d.adim + 1}/${plan.length}`;
  const metin = t(`steps.${adim.key}`);
  const kapatTik = (): void => guncelle(kapat);

  if (!acik) {
    // Serbest: küçük yüzen simge — kaldığın yerden (rehberin ekranına döner), baştan, başka bölüm, kapat.
    return (
      <div className={`dzj${dark ? " dz-dark" : ""}`}>
        <section className="ycoach working folded" style={{ zIndex: 42 }} role="region" aria-label={ad} data-testid="adim-rehber" data-folded="true" data-step={adim.key}>
          <button type="button" className="ynb" onClick={() => { feedback.minor(); guncelle((x) => katla(x, false)); git(d.rehber, d.kaynak, d.adim); }} data-testid="adim-devam" title={ad}>
            {t("resume")} · {ilerleme}
          </button>
          <button type="button" className="cbtn" onClick={() => { feedback.minor(); guncelle((x) => baslat(x, id, true)); git(d.rehber, d.kaynak, 0); }} aria-label={t("restart")} title={t("restart")} data-testid="adim-bastan">
            <Ikon d={BICON.undo} />
          </button>
          <button type="button" className="cbtn" onClick={() => { feedback.minor(); guncelle((x) => katla(x, true)); window.dispatchEvent(new CustomEvent(OP_GUIDE_EVENT, { detail: "pick" })); }} aria-label={to("other")} title={to("other")} data-testid="adim-diger">
            <Ikon d={LICON.grid} />
          </button>
          <button type="button" className="cbtn" onClick={kapatTik} aria-label={t("close")} data-testid="adim-kapat">
            <Ikon d={JICON.close} />
          </button>
        </section>
      </div>
    );
  }

  const sesli = (): void => {
    sesliOku(metin);
  };
  const style: CSSProperties = { left: yer.left ?? "auto", right: yer.right ?? "auto", top: yer.top ?? "auto", bottom: yer.bottom ?? "auto", zIndex: 42 };
  return (
    <div className={`dzj${dark ? " dz-dark" : ""}`}>
      {delik !== null ? (
        <KalipPerdeKatman
          onClose={() => {
            feedback.minor();
            guncelle((x) => katla(x, true));
          }}
          label={t("free")}
          delik={delik}
        />
      ) : null}
      <section ref={kart} className="ycoach working" style={style} role="region" aria-label={ad} data-testid="adim-rehber" data-step={adim.key} data-folded="false">
        <div className="cth">
          <span className="cstep" aria-live="polite">
            {ad} · {ilerleme}
          </span>
          <button type="button" className="cbtn" onClick={sesli} aria-label={t("speak")}>
            <Ikon d={[JICON.speak, JICON.speakWave]} />
          </button>
          <button type="button" className="cbtn" onClick={kapatTik} aria-label={t("close")} data-testid="adim-kapat">
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
