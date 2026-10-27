"use client";
// T-1106 (kullanıcı 27 Ekim: "Türkçe doğal konuşan dil aktif değil, robot ses konuşuyor"; Q-129): rehber hoparlörlerinin ortak okuyucusu.
// Türkçede metin iç ses servisinde EMA Lightning ile doğal sese çevrilir (`etkinSoyleAction`); servis yoksa/meşgulse ya da dil Türkçe
// değilse cihaz sesi (speechSynthesis). Çalma uygulamanın tek ses modülünde (`@wms/ui` ses.ts: `konusmaHazirla` dokunuş anında bağlamı
// açar — iPhone kilidi; `konusmaCal` gelen WAV'ı aynı bağlamda çalar; CSP `media-src` gerekmez).
// Aynı cümle bu sekmede bellekte tutulur (en çok 24).
import { useCallback } from "react";
import { useLocale } from "next-intl";
import { useParams } from "next/navigation";
import { intlDil, konusmaCal, konusmaDurdur, konusmaHazirla } from "@wms/ui";
import { etkinSoyleAction } from "../etkin/actions.ts";

const ONBELLEK_MAX = 24;
const onbellek = new Map<string, Uint8Array>();
let sira = 0;

function base64Bayt(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Çalan doğal sesi ve cihaz sesini durdurur (rehber kapanınca, adım değişince). */
export function sesiDurdur(): void {
  sira++;
  konusmaDurdur();
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ses yok */
  }
}

function cihazSesi(metin: string, locale: string): boolean {
  if (typeof window === "undefined" || !window.speechSynthesis) return false;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(metin);
  u.lang = intlDil(locale);
  window.speechSynthesis.speak(u);
  return true;
}

/** Dokunuş işleyicisinden çağrılır. Hiçbir ses çalınamıyorsa `false` (çağıran uyarı gösterebilir). */
export function useSesliOku(): (metin: string) => boolean {
  const locale = useLocale();
  const params = useParams<{ slug?: string }>();
  const slug = typeof params?.slug === "string" ? params.slug : "";
  return useCallback(
    (metin: string): boolean => {
      sesiDurdur();
      const text = metin.trim().slice(0, 400);
      if (text === "") return false;
      if (!locale.startsWith("tr") || slug === "" || !konusmaHazirla()) return cihazSesi(text, locale);
      const benim = ++sira;
      const cal = (wav: Uint8Array): void => {
        if (benim !== sira) return;
        konusmaCal(wav).catch(() => {
          if (benim === sira) cihazSesi(text, locale);
        });
      };
      const hazir = onbellek.get(text);
      if (hazir !== undefined) {
        cal(hazir);
        return true;
      }
      void etkinSoyleAction({ slug, text })
        .then((res) => {
          if (benim !== sira) return;
          if (!res.ok || res.data.status !== "ok") {
            cihazSesi(text, locale);
            return;
          }
          const wav = base64Bayt(res.data.audio);
          onbellek.set(text, wav);
          while (onbellek.size > ONBELLEK_MAX) onbellek.delete(onbellek.keys().next().value as string);
          cal(wav);
        })
        .catch(() => {
          if (benim === sira) cihazSesi(text, locale);
        });
      return true;
    },
    [locale, slug],
  );
}
