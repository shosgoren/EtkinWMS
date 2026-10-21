// T-1001 (ALTIN-KURAL 5, 13): uygulamanın TEK ses ve titreşim kaynağı. `AudioContext` yalnız bu dosyada açılır (bekçi:
// `ses-tek-kaynak.test.ts`). Ses yalnız anlamlı sonuçlardadır (kaydetme, okutma, onay, hata, uyarı; kullanıcı kararı 21 Ekim):
// küçük işlemler (kopyala, aç/kapat, sekme) sessizdir — onlar için `geri-bildirim.ts` `feedback.minor()` ses çalmaz.
// "Sessiz" tercihi cihazda saklanır (localStorage); "Hareketi azalt" açıksa titreşim de durur.

export type SesTur = "tamam" | "uyari" | "hata" | "okutma-iyi" | "okutma-kotu";

/** Cihazda saklanan "Sessiz" tercihinin anahtarı. */
export const SESSIZ_ANAHTAR = "etkin.sessiz";
/** Tercih değişince pencereye yayılan olay (aynı sekmedeki menüler eşitlensin). */
export const SESSIZ_OLAY = "etkin:sessiz";

// [frekans Hz, başlangıç s, süre s]
const TONLAR: Readonly<Record<SesTur, ReadonlyArray<readonly [number, number, number]>>> = {
  tamam: [
    [660, 0, 0.12],
    [990, 0.13, 0.12],
  ],
  uyari: [
    [520, 0, 0.14],
    [520, 0.2, 0.14],
  ],
  hata: [
    [330, 0, 0.12],
    [220, 0.13, 0.12],
  ],
  "okutma-iyi": [[1200, 0, 0.12]],
  "okutma-kotu": [
    [220, 0, 0.18],
    [220, 0.26, 0.18],
  ],
};
const TITRESIM: Readonly<Record<SesTur, number | readonly number[]>> = {
  tamam: 30,
  uyari: [40, 40, 40],
  hata: [60, 40, 60],
  "okutma-iyi": 60,
  "okutma-kotu": [200, 80, 200],
};

type AudioCtor = new () => AudioContext;
let baglam: AudioContext | null = null;
let son: { tur: SesTur; at: number } | null = null;

/** Kullanıcı "Sessiz" seçtiyse `true` (depolama kapalıysa sesli). */
export function sessizMi(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(SESSIZ_ANAHTAR) === "1";
  } catch {
    return false;
  }
}

/** "Sessiz" tercihini cihaza yazar ve aynı sekmedeki dinleyicilere duyurur. */
export function sessizYap(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(SESSIZ_ANAHTAR, "1");
    else window.localStorage.removeItem(SESSIZ_ANAHTAR);
  } catch {
    /* depolama kapalı: yalnız bu oturum */
  }
  try {
    window.dispatchEvent(new CustomEvent(SESSIZ_OLAY, { detail: on }));
  } catch {
    /* olay yok */
  }
}

/** İşletim sistemi "Hareketi azalt" açık mı (ALTIN-KURAL 13: titreşim ve SVG hareketi de durur). */
export function hareketAzaltMi(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export interface SesSonucu {
  readonly sounded: boolean;
  readonly vibrated: boolean;
}

/**
 * Sesi ve titreşimi çalar. Destek yoksa (iOS `vibrate`, kilitli ses) kanal atlanır ve `false` döner; sahte "çaldı" bildirilmez.
 * Aynı tür 250 ms içinde ikinci kez çalmaz (balon + düğme aynı sonucu iki kez seslendirmesin).
 */
export function sesCal(tur: SesTur): SesSonucu {
  if (typeof window === "undefined") return { sounded: false, vibrated: false };
  const now = Date.now();
  if (son !== null && son.tur === tur && now - son.at < 250) return { sounded: false, vibrated: false };
  son = { tur, at: now };
  let vibrated = false;
  let sounded = false;
  if (!hareketAzaltMi()) {
    try {
      const v = TITRESIM[tur];
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") vibrated = navigator.vibrate(typeof v === "number" ? v : [...v]);
    } catch {
      vibrated = false;
    }
  }
  if (sessizMi()) return { sounded: false, vibrated };
  try {
    const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (Ctor !== undefined) {
      baglam ??= new Ctor();
      const ctx = baglam;
      if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
      const t0 = ctx.currentTime;
      for (const [f, at, dur] of TONLAR[tur]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        const t = t0 + at;
        o.type = "sine";
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(t);
        o.stop(t + dur + 0.01);
      }
      sounded = true;
    }
  } catch {
    sounded = false;
  }
  return { sounded, vibrated };
}

/** Yalnız birim testi: iç durumu sıfırlar. */
export function sesSifirlaTest(): void {
  baglam = null;
  son = null;
}
