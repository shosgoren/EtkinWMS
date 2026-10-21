// T-436 (ALTIN-KURAL 5, 9, 10, 11, 17): ortak geri bildirim API'si. Ekranlar ses ve balonu yalnız buradan çağırır.
// - `feedback.minor()`: küçük işlem (kopyala, aç/kapat, sekme): SESSİZ, balon yok. Görsel değişim düğmenin kendisindedir.
// - `feedback.ok/warn/error/info(metin?)`: anlamlı sonuç (kaydetme, okutma, onay, uyarı, hata). Metin verilirse ortak balon açılır
//   ve balon kendi sesini çalar; metin yoksa yalnız ses + titreşim.
// - `feedback.undo(metin, etiket, geriAl)`: geri dönüşü olan işlemden sonra "Geri al" düğmeli balon (birkaç saniye).
// Balonu tek ortak katman (`BalonKatmani`, kök düzende) çizer; `aria-live` bölgesi kalıcıdır (ekran okuyucu duyurur).
import { sesCal, type SesTur } from "./ses.ts";

export type BalonTur = "ok" | "err" | "warn" | "info";

export interface BalonEylem {
  readonly etiket: string;
  readonly yap: () => void | Promise<void>;
}

export interface BalonIstek {
  readonly tur: BalonTur;
  readonly metin: string;
  /** Balon içindeki düğme (ör. "Geri al"). */
  readonly eylem?: BalonEylem;
  /** Görünme süresi (ms); varsayılan 2600, eylemli balonda 6000. */
  readonly sure?: number;
  /** Ses çalınsın mı (varsayılan evet; `info` sessizdir). */
  readonly ses?: boolean;
}

/** Ortak katmanın dinlediği olay. */
export const BALON_OLAY = "etkin:balon";

const SES: Readonly<Record<BalonTur, SesTur | null>> = { ok: "tamam", warn: "uyari", err: "hata", info: null };

/** Ortak balonu açar (katman yoksa yalnız ses). Balon kendi sesini çalar. */
export function balonGoster(istek: BalonIstek): void {
  const s = SES[istek.tur];
  if (istek.ses !== false && s !== null) sesCal(s);
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent<BalonIstek>(BALON_OLAY, { detail: istek }));
  } catch {
    /* olay yok */
  }
}

function sonuc(tur: Exclude<BalonTur, "info">) {
  return (metin?: string): void => {
    if (metin === undefined || metin === "") {
      const s = SES[tur];
      if (s !== null) sesCal(s);
      return;
    }
    balonGoster({ tur, metin });
  };
}

export const feedback = {
  /** Küçük işlem: sessiz, balonsuz (görsel değişim düğmede). */
  minor(): void {
    /* bilinçli olarak boş: kullanıcı kararı 21 Ekim */
  },
  ok: sonuc("ok"),
  warn: sonuc("warn"),
  error: sonuc("err"),
  /** Bilgi balonu (sessiz). */
  info(metin: string): void {
    balonGoster({ tur: "info", metin, ses: false });
  },
  /** Okutma sonucu: kısa bip (iyi) ya da alçak çift bip (kötü). */
  scan(iyi: boolean): void {
    sesCal(iyi ? "okutma-iyi" : "okutma-kotu");
  },
  /** Geri dönüşü olan işlem bitti: "Geri al" düğmeli balon. */
  undo(metin: string, etiket: string, geriAl: () => void | Promise<void>): void {
    balonGoster({ tur: "ok", metin, eylem: { etiket, yap: geriAl }, sure: 6000 });
  },
} as const;
