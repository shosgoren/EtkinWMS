// I-18: tasarım teması (kaynak cycleTheme: acik / koyu). Sunucu ilk çizimde çerezi okur; istemci dz-root.tsx yazar.
export const THEME_COOKIE = "dz-theme";

// T-1001 (ALTIN-KURAL 14): "Otomatik (sistem)". Tercih `oto` (ya da hiç seçilmemiş) iken tema cihazın açık/koyu ayarını izler.
// Sunucu cihaz ayarını bilemez: kök katman (`KuralKatmani`) cihaz ayarını `dz-sys` çerezine yazar ve değişince sayfayı yeniler.
export const THEME_SYS_COOKIE = "dz-sys";
export type TemaTercihi = "acik" | "koyu" | "oto";

interface CerezOkur {
  get(name: string): { readonly value: string } | undefined;
}

/** Çerezdeki tercih (bilinmeyen/boş = otomatik). */
export function temaTercihi(jar: CerezOkur): TemaTercihi {
  const v = jar.get(THEME_COOKIE)?.value;
  return v === "koyu" || v === "acik" ? v : "oto";
}

/** Sunucu: bu istekte koyu tema mı (tercih koyu, ya da otomatik + cihaz koyu). */
export function temaKoyu(jar: CerezOkur): boolean {
  const p = temaTercihi(jar);
  if (p !== "oto") return p === "koyu";
  return jar.get(THEME_SYS_COOKIE)?.value === "koyu";
}

/** İstemci: `document.cookie` okuyucusu (temaKoyu / temaTercihi ile). */
export function belgeCerezleri(): CerezOkur {
  return {
    get(name: string) {
      if (typeof document === "undefined") return undefined;
      const hit = document.cookie
        .split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith(`${name}=`));
      return hit === undefined ? undefined : { value: decodeURIComponent(hit.slice(name.length + 1)) };
    },
  };
}

/** İstemci: tema tercihini yazar (1 yıl). */
export function temaYaz(p: TemaTercihi): void {
  document.cookie = `${THEME_COOKIE}=${p}; path=/; max-age=31536000; samesite=lax`;
  temaKokuGuncelle(p === "oto" ? sistemKoyu() : p === "koyu");
}

/** İstemci: eski (Tailwind belirteçli) yüzeylerin teması `html[data-tema]` ile; yenilemeden değişince eşitlenir. */
export function temaKokuGuncelle(koyu: boolean): void {
  try {
    document.documentElement.dataset.tema = koyu ? "koyu" : "acik";
  } catch {
    /* belge yok */
  }
}

/** İstemci: cihazın koyu tema ayarı. */
export function sistemKoyu(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}
