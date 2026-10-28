// T-1109 (B-134): Etkin'in ekrandaki durum yazısını okunacak cümleye çevirir: ayraç noktası ("·") virgül olur, tırnaklar düşer, boşluk
// sadeleşir. Sayı/birim okunuşu ses servisindedir (ön çeviri + normalleştirici).
export function okunacak(metin: string): string {
  return metin
    .replace(/\s*·\s*/g, ", ")
    .replace(/[‘’“”"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
