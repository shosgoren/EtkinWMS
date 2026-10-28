// T-1112 (STANDART §5, tuval StandartAyarlarEntegrasyon): Ayarlar › Entegrasyonlar alt bölümleri — adres sorgusu `?bolum=`, varsayılan
// bölüm ve sol listedeki "Bekleyenler ve hatalar" rozeti. Saf işlevler (sunucu sayfası ve ekran aynı kuralı kullanır; birim testli).

export const ENTEGRASYON_BOLUMLERI = ["baglanti", "akis", "sahiplik", "arsiv", "hatalar"] as const;
export type EntegrasyonBolumu = (typeof ENTEGRASYON_BOLUMLERI)[number];

/** Adresteki bölüm; yoksa ya da tanınmıyorsa bağlıyken "Ne çekilsin, gönderilsin", bağlı değilken "Bağlantı ve veri kaynağı". */
export function entegrasyonBolumu(raw: string | string[] | null | undefined, connected: boolean): EntegrasyonBolumu {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v === "string" && (ENTEGRASYON_BOLUMLERI as readonly string[]).includes(v)) return v as EntegrasyonBolumu;
  return connected ? "akis" : "baglanti";
}

/** Rozet: kontrol bekleyen + gönderilemeyen kayıtlar (outbox CHECK + FAILED) ve hatası olan akış sayısı. Bekleyen (PENDING) sorun değildir. */
export function entegrasyonSorunSayisi(data: { readonly outbox: { readonly check: number; readonly failed: number }; readonly flows: readonly { readonly errorCount: number }[] }): number {
  return data.outbox.check + data.outbox.failed + data.flows.filter((f) => f.errorCount > 0).length;
}

/** Son eşitleme zamanı: akışların son çalışması ve son koşunun başlangıcının en yenisi (ISO); hiç yoksa null. */
export function sonEsitleme(flows: readonly { readonly lastRunAt: string | null }[], runs: readonly { readonly startedAt: string }[]): string | null {
  let best: string | null = null;
  for (const at of [...flows.map((f) => f.lastRunAt), ...runs.map((r) => r.startedAt)]) {
    if (at !== null && (best === null || Date.parse(at) > Date.parse(best))) best = at;
  }
  return best;
}
