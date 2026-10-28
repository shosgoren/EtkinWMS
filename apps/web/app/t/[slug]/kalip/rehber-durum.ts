// T-1124 (kullanıcı 28 Ekim: "bir bölümün rehberini açınca kaldığım yerden devam edemiyorum ya da başka bölüme geçemiyorum, tamamen
// kapanıyor"): işlem rehberleri ile adım adım aktarma rehberleri TEK durumu paylaşır — hangi rehber etkin, katlı mı, her rehberin kaldığı
// adım ve son ekranı. Aynı anda yalnız bir rehber etkindir; başka rehber başlarken öncekinin adımı silinmez (dönünce kaldığı yerden sürer).
// Durum yalnız bu cihazda (localStorage, kullanıcı + çalışma alanı anahtarı); iki rehber motoru aynı depodan okur, biri ötekini olayla
// kapatmaz. Saf işlevler birim testlidir; kanca `useSyncExternalStore` ile iki motoru eşzamanlı tutar.
import { useCallback, useSyncExternalStore } from "react";
import { ADIM_KAYNAKLARI, ADIM_REHBERLERI, adimPlani, type AdimKaynak, type AdimRehber } from "./adim-rehber-plan.ts";
import { GUIDE_INSTRUCTIONS, OP_GUIDES, type OpGuide } from "./rehber-plan.ts";

export type RehberKimlik = `op:${OpGuide}` | `adim:${AdimRehber}:${AdimKaynak}`;

export interface RehberDurum {
  /** Şu an açık (ya da katlı) rehber; `null`: hiçbiri. */
  readonly aktif: RehberKimlik | null;
  /** Etkin rehber yüzen simgeye katlandı (perde yok). */
  readonly katli: boolean;
  /** Her rehberin kaldığı adım (0'dan). Kapatılan rehberin adımı kalır; bitirilenin silinir. */
  readonly adimlar: Readonly<Partial<Record<RehberKimlik, number>>>;
  /** İşlem rehberinin son ekranı (`/t/<alan>/…` + izinli sorgu): "Kaldığın yerden devam" buraya döner. */
  readonly yerler: Readonly<Partial<Record<RehberKimlik, string>>>;
}

export const BOS_DURUM: RehberDurum = { aktif: null, katli: false, adimlar: {}, yerler: {} };

export type RehberTuru = { readonly tur: "op"; readonly guide: OpGuide } | { readonly tur: "adim"; readonly rehber: AdimRehber; readonly kaynak: AdimKaynak };

export function opKimlik(g: OpGuide): RehberKimlik {
  return `op:${g}`;
}
export function adimKimlik(r: AdimRehber, k: AdimKaynak): RehberKimlik {
  return `adim:${r}:${k}`;
}

export function kimlikCoz(v: unknown): RehberTuru | null {
  if (typeof v !== "string") return null;
  const p = v.split(":");
  if (p.length === 2 && p[0] === "op" && (OP_GUIDES as readonly string[]).includes(p[1] ?? "")) return { tur: "op", guide: p[1] as OpGuide };
  if (p.length === 3 && p[0] === "adim" && (ADIM_REHBERLERI as readonly string[]).includes(p[1] ?? "") && (ADIM_KAYNAKLARI as readonly string[]).includes(p[2] ?? "")) {
    return { tur: "adim", rehber: p[1] as AdimRehber, kaynak: p[2] as AdimKaynak };
  }
  return null;
}

export function isKimlik(v: unknown): v is RehberKimlik {
  return kimlikCoz(v) !== null;
}

/** Rehberin adım sayısı. */
export function adimSayisi(id: RehberKimlik): number {
  const k = kimlikCoz(id);
  if (k === null) return 0;
  return k.tur === "op" ? GUIDE_INSTRUCTIONS[k.guide].length : adimPlani(k.rehber, k.kaynak).length;
}

function gecerliAdim(id: RehberKimlik, n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n < adimSayisi(id);
}

/** Yalnız uygulama içi yol (`/t/…`), sorgu en çok 512 karakter; dış adres ya da protokol kabul edilmez. */
function gecerliYer(v: unknown): v is string {
  return typeof v === "string" && v.length <= 512 && /^\/t\/[^/?#\\]+(\/[^?#\\]*)?(\?[^#\\]*)?$/.test(v);
}

/** Depodan okunan değeri doğrular; bozuk/eski alanlar düşer (rehberi engellemez). */
export function durumCoz(raw: unknown): RehberDurum {
  if (raw === null || typeof raw !== "object") return BOS_DURUM;
  const r = raw as Record<string, unknown>;
  const adimlar: Partial<Record<RehberKimlik, number>> = {};
  if (r.adimlar !== null && typeof r.adimlar === "object") {
    for (const [k, n] of Object.entries(r.adimlar as Record<string, unknown>)) if (isKimlik(k) && gecerliAdim(k, n)) adimlar[k] = n;
  }
  const yerler: Partial<Record<RehberKimlik, string>> = {};
  if (r.yerler !== null && typeof r.yerler === "object") {
    for (const [k, y] of Object.entries(r.yerler as Record<string, unknown>)) if (isKimlik(k) && gecerliYer(y)) yerler[k] = y;
  }
  const aktif = isKimlik(r.aktif) ? r.aktif : null;
  return { aktif, katli: aktif !== null && r.katli === true, adimlar, yerler };
}

/**
 * T-1105/T-1095 dönemindeki iki ayrı kayıttan (işlem: `{guide, step, closed, path, query}`, aktarma: `{rehber, kaynak, adim, katli}`) ilk
 * okumada geçiş: kaldığı adımlar korunur.
 */
export function eskiDurum(op: unknown, adim: unknown): RehberDurum {
  let d = BOS_DURUM;
  if (op !== null && typeof op === "object") {
    const o = op as Record<string, unknown>;
    if (typeof o.guide === "string" && isKimlik(`op:${o.guide}`)) {
      const id = `op:${o.guide}` as RehberKimlik;
      if (gecerliAdim(id, o.step)) d = { ...d, adimlar: { ...d.adimlar, [id]: o.step } };
      const yer = typeof o.path === "string" ? `${o.path}${typeof o.query === "string" && o.query !== "" ? `?${o.query}` : ""}` : null;
      if (gecerliYer(yer)) d = { ...d, yerler: { ...d.yerler, [id]: yer } };
      if (o.closed !== true) d = { ...d, aktif: id, katli: false };
    }
  }
  if (adim !== null && typeof adim === "object") {
    const a = adim as Record<string, unknown>;
    const id = `adim:${String(a.rehber)}:${String(a.kaynak)}`;
    if (isKimlik(id) && gecerliAdim(id, a.adim)) d = { ...d, adimlar: { ...d.adimlar, [id]: a.adim }, ...(d.aktif === null ? { aktif: id, katli: a.katli === true } : {}) };
  }
  return d;
}

/** Rehberi başlatır ya da kaldığı adımdan sürdürür (`bastan`: ilk adım). Önceki etkin rehberin adımı korunur. */
export function baslat(d: RehberDurum, id: RehberKimlik, bastan = false): RehberDurum {
  const n = bastan ? 0 : (d.adimlar[id] ?? 0);
  return { ...d, aktif: id, katli: false, adimlar: { ...d.adimlar, [id]: n } };
}

export function adimaGit(d: RehberDurum, id: RehberKimlik, n: number): RehberDurum {
  const son = adimSayisi(id) - 1;
  return { ...d, adimlar: { ...d.adimlar, [id]: Math.max(0, Math.min(son, Math.trunc(n))) } };
}

export function katla(d: RehberDurum, katli: boolean): RehberDurum {
  return d.aktif === null || d.katli === katli ? d : { ...d, katli };
}

/** Kapat (✕ / Esc): yalnız etkin rehber kapanır; kaldığı adım ve diğer rehberler kalır. */
export function kapat(d: RehberDurum): RehberDurum {
  return d.aktif === null ? d : { ...d, aktif: null, katli: false };
}

/** Son adım bitti: rehberin kaydı silinir (bir dahaki açılış baştan). */
export function bitir(d: RehberDurum, id: RehberKimlik): RehberDurum {
  const adimlar = { ...d.adimlar };
  const yerler = { ...d.yerler };
  delete adimlar[id];
  delete yerler[id];
  return { aktif: d.aktif === id ? null : d.aktif, katli: d.aktif === id ? false : d.katli, adimlar, yerler };
}

export function yerKaydet(d: RehberDurum, id: RehberKimlik, yer: string): RehberDurum {
  return !gecerliYer(yer) || d.yerler[id] === yer ? d : { ...d, yerler: { ...d.yerler, [id]: yer } };
}

// ---- Depo (bu cihaz) ----
const dinleyiciler = new Set<() => void>();
const bellek = new Map<string, RehberDurum>();

/** `sahip` = `<kullanıcı>:<alan>`; anahtarlar mevcut rehber kayıtlarıyla aynı düzende. */
export function rehberAnahtari(sahip: string): string {
  return `etkinwms.rehber.v2:${sahip}`;
}

function json(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function oku(sahip: string): RehberDurum {
  const hazir = bellek.get(sahip);
  if (hazir !== undefined) return hazir;
  let d = BOS_DURUM;
  try {
    const raw = localStorage.getItem(rehberAnahtari(sahip));
    d = raw !== null ? durumCoz(json(raw)) : eskiDurum(json(localStorage.getItem(`etkinwms.instructions.v1:${sahip}`)), json(localStorage.getItem(`etkinwms.adim.v1:${sahip}`)));
  } catch {
    /* depolama kapalı: rehber bu sayfada bellekte sürer */
  }
  bellek.set(sahip, d);
  return d;
}

function yaz(sahip: string, d: RehberDurum): void {
  if (bellek.get(sahip) === d) return;
  bellek.set(sahip, d);
  try {
    localStorage.setItem(rehberAnahtari(sahip), JSON.stringify(d));
  } catch {
    /* depolama isteğe bağlı */
  }
  for (const f of dinleyiciler) f();
}

function abone(f: () => void): () => void {
  dinleyiciler.add(f);
  // Başka sekmede değişti: önbellek düşer, yeniden okunur.
  const depo = (e: StorageEvent): void => {
    if (e.key === null || e.key.startsWith("etkinwms.rehber.v2:")) {
      bellek.clear();
      f();
    }
  };
  window.addEventListener("storage", depo);
  return () => {
    dinleyiciler.delete(f);
    window.removeEventListener("storage", depo);
  };
}

/** İki rehber motorunun ortak durumu. `guncelle` saf bir dönüşüm alır (en güncel durum üzerinde). */
export function useRehberDurum(sahip: string): readonly [RehberDurum, (f: (d: RehberDurum) => RehberDurum) => void] {
  const d = useSyncExternalStore(
    abone,
    () => oku(sahip),
    () => BOS_DURUM,
  );
  const guncelle = useCallback((f: (d: RehberDurum) => RehberDurum): void => yaz(sahip, f(oku(sahip))), [sahip]);
  return [d, guncelle] as const;
}
