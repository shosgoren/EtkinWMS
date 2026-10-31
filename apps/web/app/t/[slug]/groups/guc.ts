// T-1142: grup sihirbazı güç kartları ↔ yetki anahtarları (saf; birim testli). Sihirbaz kaydı yalnız bu ekranda DEĞİŞEN güç kartlarının
// yetkilerini ekler/çıkarır; Yetkiler ekranında tek tek açılan anahtarlar (kart yetkileri, tek başına belge onayı…) korunur.
/** Güç kartı → domain yetkileri (sıra kaynaktaki POWERS ile aynı; `team` ve `settings` grupla verilmez → boş). */
export const GUC_YETKI: Readonly<Record<string, readonly string[]>> = Object.freeze({
  scan: ["stock.post"],
  create: ["document.create"],
  approve: ["document.approve", "count_diff.approve"],
  reverse: ["reversal.create"],
  team: [],
  import: ["data.import"],
  settings: [],
});

export const gucYetkileri = (powers: readonly string[]): string[] => powers.flatMap((p) => [...(GUC_YETKI[p] ?? [])]);

/** Kartı gösterilen güçler: yetkilerinin HEPSİ grupta olan ve boş olmayan kartlar. */
export const gruptakiGucler = (grants: readonly string[]): string[] =>
  Object.entries(GUC_YETKI).filter(([, g]) => g.length > 0 && g.every((x) => grants.includes(x))).map(([p]) => p);

/** Kayıtlı yetkiler + bu ekranda açılan kartlar − kapatılan kartlar; kart dışı anahtarlar korunur. */
export function birlesikYetkiler(original: readonly string[], before: readonly string[], after: readonly string[]): string[] {
  const added = gucYetkileri(after.filter((p) => !before.includes(p)));
  const removed = gucYetkileri(before.filter((p) => !after.includes(p)));
  return [...new Set([...original.filter((g) => !removed.includes(g)), ...added])];
}
