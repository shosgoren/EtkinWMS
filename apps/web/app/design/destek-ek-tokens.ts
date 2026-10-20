// destek-ek-tokens.ts — scripts/design/port.mjs ile ÜRETİLDİ; elle düzenlemeyin (I-18). Kaynaktaki onaltılık renk → belirteç.
const T: Readonly<Record<string, string>> = {
  "0E7C7B": "var(--color-dz-x-aohmhl)",
  "108,75,216,.88": "var(--color-dz-a-gmelni-ii)",
  "14,124,123,.8": "var(--color-dz-a-aohmhl-i)",
  "172E42": "var(--color-dz-x-bhcoec)",
  "17583C": "var(--color-dz-x-bhfidm)",
  "198,40,40,.8": "var(--color-dz-a-mgcici-i)",
  "244,197,66,.16": "var(--color-dz-a-pemfec-bg)",
  "255,255,255,.5": "var(--color-dz-a-pppppp-f)",
  "2F5DA8": "var(--color-dz-x-cpfnki)",
  "2F7D5B": "var(--color-dz-x-cphnfl)",
  "30475A": "var(--color-dz-x-daehfk)",
  "4E6476": "var(--color-dz-x-eogehg)",
  "6C4BD8": "var(--color-dz-x-gmelni)",
  "9A5B2E": "var(--color-dz-x-jkflco)",
  "9FB2C2": "var(--color-dz-x-jplcmc)",
  "B07D0B": "var(--color-dz-x-lahnal)",
  "B23A3A": "var(--color-dz-x-lcdkdk)",
  "C62828": "var(--color-dz-x-mgcici)",
  "D7ECEC": "var(--color-dz-x-nhomom)",
  "E3F1E9": "var(--color-dz-x-odpboj)",
  "E56A00": "var(--color-dz-x-ofgkaa)",
  "F2C53D": "var(--color-dz-x-pcmfdn)",
  "F4C542": "var(--color-dz-x-pemfec)",
  "FFE1CC": "var(--color-dz-x-ppobmm)",
  "FFFFFF": "var(--color-dz-x-pppppp)",
};
/** Kaynaktaki onaltılık rengin (`#` olmadan, büyük harf) belirteci; kaynakta olmayan renk hata verir. */
export function dz(hex: string): string {
  const v = T[hex];
  if (v === undefined) throw new Error(`dz: kaynakta olmayan renk ${hex}`);
  return v;
}
/** Tema paleti (açık/koyu `.dz.dz-dark` ile değişir): kaynaktaki c.*, bölüm K(), A, TXT, başparmak çubuğu. */
export const C = {
} as const;
