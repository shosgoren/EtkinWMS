"use client";
// T-1106 (kullanıcı 27 Ekim: "Türkçe doğal konuşan dil aktif değil, robot ses konuşuyor"; Q-129): rehber hoparlörlerinin ortak okuyucusu.
// Türkçede metin iç ses servisinde EMA Lightning ile doğal sese çevrilir (`etkinSoyleAction`); servis yoksa/meşgulse ya da dil Türkçe
// değilse cihaz sesi (speechSynthesis). iPhone Safari, dokunuştan sonra beklenen (await) bir çalmayı engeller: ortak <audio> öğesi
// dokunuş anında sessiz kısa bir WAV ile açılır, gelen ses aynı öğede çalınır. Aynı cümle bu sekmede bellekte tutulur (en çok 24).
import { useCallback } from "react";
import { useLocale } from "next-intl";
import { useParams } from "next/navigation";
import { intlDil } from "@wms/ui";
import { etkinSoyleAction } from "../etkin/actions.ts";

const ONBELLEK_MAX = 24;
const onbellek = new Map<string, string>();
let calici: HTMLAudioElement | null = null;
let sira = 0;

function sessizWav(): string {
  const n = 240;
  const b = new Uint8Array(44 + n * 2);
  const v = new DataView(b.buffer);
  const yaz = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i);
  };
  yaz(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  yaz(8, "WAVE");
  yaz(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 24000, true);
  v.setUint32(28, 48000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  yaz(36, "data");
  v.setUint32(40, n * 2, true);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return `data:audio/wav;base64,${btoa(s)}`;
}

/** Çalan doğal sesi ve cihaz sesini durdurur (rehber kapanınca, adım değişince). */
export function sesiDurdur(): void {
  sira++;
  try {
    calici?.pause();
  } catch {
    /* çalıcı yok */
  }
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
      if (!locale.startsWith("tr") || slug === "" || typeof Audio === "undefined") return cihazSesi(text, locale);
      const benim = ++sira;
      const el = (calici ??= new Audio());
      el.src = sessizWav();
      el.play().catch(() => undefined);
      const cal = (src: string): void => {
        if (benim !== sira) return;
        el.src = src;
        el.play().catch(() => {
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
          const src = `data:audio/wav;base64,${res.data.audio}`;
          onbellek.set(text, src);
          while (onbellek.size > ONBELLEK_MAX) onbellek.delete(onbellek.keys().next().value as string);
          cal(src);
        })
        .catch(() => {
          if (benim === sira) cihazSesi(text, locale);
        });
      return true;
    },
    [locale, slug],
  );
}
