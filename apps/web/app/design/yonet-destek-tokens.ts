// yonet-destek-tokens.ts — scripts/design/port.mjs ile ÜRETİLDİ; elle düzenlemeyin (I-18). Kaynaktaki onaltılık renk → belirteç.
const T: Readonly<Record<string, string>> = {
  "0F3D27": "var(--color-dz-x-apdnch)",
  "172E42": "var(--color-dz-x-bhcoec)",
  "17804F": "var(--color-dz-x-bhiaep)",
  "1E2F3E": "var(--color-dz-x-bocpdo)",
  "23,46,66,.25": "var(--color-dz-a-bhcoec-cf)",
  "2F5DA8": "var(--color-dz-x-cpfnki)",
  "2F7D5B": "var(--color-dz-x-cphnfl)",
  "4A3500": "var(--color-dz-x-ekdfaa)",
  "4E6476": "var(--color-dz-x-eogehg)",
  "B07D0B": "var(--color-dz-x-lahnal)",
  "C62828": "var(--color-dz-x-mgcici)",
  "CFE8DA": "var(--color-dz-x-mpoink)",
  "E56A00": "var(--color-dz-x-ofgkaa)",
  "E6E2DA": "var(--color-dz-x-ogocnk)",
  "F1EEE8": "var(--color-dz-x-pboooi)",
  "F2C53D": "var(--color-dz-x-pcmfdn)",
  "F4C542": "var(--color-dz-x-pemfec)",
  "F4F2EE": "var(--color-dz-x-pepcoo)",
  "FFE7A8": "var(--color-dz-x-ppohki)",
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
