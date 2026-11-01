// etiket-editor-tokens.ts — scripts/design/port.mjs ile ÜRETİLDİ; elle düzenlemeyin (I-18). Kaynaktaki onaltılık renk → belirteç.
const T: Readonly<Record<string, string>> = {
  "000000": "var(--color-dz-x-aaaaaa)",
  "0F7D80": "var(--color-dz-x-aphnia)",
  "15212E": "var(--color-dz-x-bfcbco)",
  "172E42": "var(--color-dz-x-bhcoec)",
  "1C2A37": "var(--color-dz-x-bmckdh)",
  "23,46,66,.14": "var(--color-dz-a-bhcoec-be)",
  "233C5D": "var(--color-dz-x-cddmfn)",
  "2F5DA8": "var(--color-dz-x-cpfnki)",
  "364858": "var(--color-dz-x-dgeifi)",
  "3F351D": "var(--color-dz-x-dpdfbn)",
  "47,93,168,.06": "var(--color-dz-a-cpfnki-ag)",
  "536B7E": "var(--color-dz-x-fdglho)",
  "6C4BD8": "var(--color-dz-x-gmelni)",
  "8B5B27": "var(--color-dz-x-ilflch)",
  "8BAAE2": "var(--color-dz-x-ilkkoc)",
  "B5C6D5": "var(--color-dz-x-lfmgnf)",
  "D8A52B": "var(--color-dz-x-nikfcl)",
  "DCE3EA": "var(--color-dz-x-nmodok)",
  "E3EBF7": "var(--color-dz-x-odolph)",
  "E6EBEF": "var(--color-dz-x-ogolop)",
  "E8EDF3": "var(--color-dz-x-oionpd)",
  "F2D27C": "var(--color-dz-x-pcnchm)",
  "FFF4CF": "var(--color-dz-x-pppemp)",
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
