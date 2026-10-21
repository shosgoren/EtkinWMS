// paylas-tokens.ts — scripts/design/port.mjs ile ÜRETİLDİ; elle düzenlemeyin (I-18). Kaynaktaki onaltılık renk → belirteç.
const T: Readonly<Record<string, string>> = {
  "0E7C7B": "var(--color-dz-x-aohmhl)",
  "16212B": "var(--color-dz-x-bgcbcl)",
  "172E42": "var(--color-dz-x-bhcoec)",
  "1A1300": "var(--color-dz-x-bkbdaa)",
  "1B2833": "var(--color-dz-x-blcidd)",
  "1E8E4E": "var(--color-dz-x-boioeo)",
  "23,46,66,.08": "var(--color-dz-a-bhcoec-ai)",
  "23,46,66,.5": "var(--color-dz-a-bhcoec-f)",
  "24323F": "var(--color-dz-x-cedcdp)",
  "255,255,255,.22": "var(--color-dz-a-pppppp-cc)",
  "2F5DA8": "var(--color-dz-x-cpfnki)",
  "2F7D5B": "var(--color-dz-x-cphnfl)",
  "4E6476": "var(--color-dz-x-eogehg)",
  "6A7F91": "var(--color-dz-x-gkhpjb)",
  "8A9BAA": "var(--color-dz-x-ikjlkk)",
  "C9D2DA": "var(--color-dz-x-mjncnk)",
  "E4E9EE": "var(--color-dz-x-oeojoo)",
  "E6EBEF": "var(--color-dz-x-ogolop)",
  "F4C542": "var(--color-dz-x-pemfec)",
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
