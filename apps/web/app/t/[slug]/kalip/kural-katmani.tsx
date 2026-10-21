"use client";
// T-1001: ALTIN-KURAL 5–17 için kök düzende BİR KEZ çizilen ortak katman (müşteri uygulaması ve yönetim paneli). Ekranlar bunları
// kendiliğinden alır:
// - 5/10/11/17: ortak balon (`BalonKatmani`; tek `aria-live` bölgesi).
// - 9: çevrimdışı şeridi (üstte) + çevrimdışıyken form gönderimi engeli ("Bağlantı yok · bağlanınca tekrar dene").
// - 13: "Hareketi azalt" açıkken SVG `animateMotion` (logo noktası) durur; CSS animasyonları kural.css'te durur.
// - 14: "Otomatik (sistem)" tema: cihaz ayarı `dz-sys` çerezine yazılır; tercih otomatikse değişince sayfa yenilenir.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { feedback, hareketAzaltMi } from "@wms/ui";
import { LICON } from "../../../design/kalip-icons.ts";
import { THEME_SYS_COOKIE, belgeCerezleri, sistemKoyu, temaKokuGuncelle, temaTercihi } from "../../../design/theme.ts";
import { BalonKatmani } from "./balon.tsx";
import { cevrimdisiEngel, cevrimdisiMetniAyarla, useCevrimici } from "./cevrimdisi.ts";
import { kilitliMetniAyarla } from "./kilitli.tsx";

/** "Hareketi azalt": sayfadaki bütün SVG SMIL animasyonlarını (animateMotion) durdurur; yeni eklenenleri de. */
function useSvgHareketi(): void {
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    } catch {
      return;
    }
    let obs: MutationObserver | null = null;
    const dur = (): void => {
      for (const svg of document.querySelectorAll("svg")) {
        if (svg.querySelector("animate, animateMotion, animateTransform") === null) continue;
        try {
          svg.pauseAnimations();
          svg.setCurrentTime(0);
        } catch {
          /* SMIL yok */
        }
      }
    };
    const surdur = (): void => {
      for (const svg of document.querySelectorAll("svg")) {
        try {
          svg.unpauseAnimations();
        } catch {
          /* SMIL yok */
        }
      }
    };
    const uygula = (): void => {
      obs?.disconnect();
      obs = null;
      if (hareketAzaltMi()) {
        dur();
        let bekliyor = false;
        obs = new MutationObserver(() => {
          if (bekliyor) return;
          bekliyor = true;
          window.requestAnimationFrame(() => {
            bekliyor = false;
            dur();
          });
        });
        obs.observe(document.body, { childList: true, subtree: true });
      } else surdur();
    };
    uygula();
    mq.addEventListener("change", uygula);
    return () => {
      mq?.removeEventListener("change", uygula);
      obs?.disconnect();
    };
  }, []);
}

/** Otomatik tema: cihaz ayarını çereze yazar; tercih otomatikse ve sunucunun bildiğinden farklıysa sayfayı yeniler. */
function useSistemTema(): void {
  const router = useRouter();
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia("(prefers-color-scheme: dark)");
    } catch {
      return;
    }
    const sync = (): void => {
      const koyu = sistemKoyu() ? "koyu" : "acik";
      const jar = belgeCerezleri();
      const onceki = jar.get(THEME_SYS_COOKIE)?.value;
      if (onceki === koyu) return;
      document.cookie = `${THEME_SYS_COOKIE}=${koyu}; path=/; max-age=31536000; samesite=lax`;
      if (temaTercihi(jar) === "oto") {
        temaKokuGuncelle(koyu === "koyu");
        router.refresh();
      }
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq?.removeEventListener("change", sync);
  }, [router]);
}

/** Çevrimdışıyken her form gönderimi (sunucu eylemi dahil) yakalama aşamasında durdurulur ve balon çıkar. */
function useCevrimdisiGonderim(): void {
  useEffect(() => {
    const onSubmit = (e: SubmitEvent): void => {
      const form = e.target;
      // Yalnız ağ gerektiren gönderim: GET arama formları da sunucuya gider; hepsi engellenir (kuyruk yok).
      if (!(form instanceof HTMLFormElement) || form.method === "dialog") return;
      if (cevrimdisiEngel()) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    document.addEventListener("submit", onSubmit, true);
    // Düğmeden çağrılan sunucu eylemleri (form olmadan): çevrimdışıyken istek hiç gönderilmez, balon çıkar; çağıran ağ hatası alır
    // (gerçek kopuşla aynı yol — ekran kendi hata metnini gösterir). Yalnız yazma istekleri (GET dışı) engellenir.
    const orijinal = window.fetch;
    const sarili: typeof window.fetch = (input, init) => {
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (method !== "GET" && method !== "HEAD" && cevrimdisiEngel()) return Promise.reject(new TypeError("offline"));
      return orijinal(input, init);
    };
    window.fetch = sarili;
    return () => {
      document.removeEventListener("submit", onSubmit, true);
      if (window.fetch === sarili) window.fetch = orijinal;
    };
  }, []);
}

function CevrimdisiSerit() {
  const t = useTranslations("kural");
  const online = useCevrimici();
  const once = useRef(true);
  useEffect(() => {
    if (once.current) {
      once.current = false;
      return;
    }
    if (online) feedback.ok(t("backOnline"));
    else feedback.warn(t("offline"));
  }, [online, t]);
  if (online) return null;
  return (
    <div className="kcs" role="alert" data-testid="cevrimdisi-serit">
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path d={LICON.globe} />
      </svg>
      {t("offlineStrip")}
    </div>
  );
}

export function KuralKatmani() {
  const t = useTranslations("kural");
  cevrimdisiMetniAyarla(t("offline"));
  kilitliMetniAyarla(t("locked"));
  useSvgHareketi();
  useSistemTema();
  useCevrimdisiGonderim();
  return (
    <>
      <CevrimdisiSerit />
      <BalonKatmani />
    </>
  );
}
