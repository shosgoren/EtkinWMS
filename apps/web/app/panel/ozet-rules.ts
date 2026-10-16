// Özet kuralları (T-408): saf yardımcılar (sayfa ve birim testi).

/**
 * Sınıra yaklaşan kullanım: sınır > 0, kullanım var ve kalan ≤ sınırın %20'si (en az 1). Kullanılmayan küçük sınır (1 depo, 0 kullanım)
 * uyarı üretmez (inceleme m1). Dolu ya da aşılmış sınırda kalan 0. Uyarı yoksa `null`.
 */
export function nearLimit(limit: number, used: number): number | null {
  if (limit <= 0 || used <= 0) return null;
  const left = Math.max(limit - used, 0);
  return left <= Math.max(1, Math.floor(limit * 0.2)) ? left : null;
}
