// gorsel-buyuk-tokens.ts — scripts/design/port.mjs ile ÜRETİLDİ; elle düzenlemeyin (I-18). Kaynaktaki onaltılık renk → belirteç.
const T: Readonly<Record<string, string>> = {
  "0,0,0,.5": "var(--color-dz-a-aaaaaa-f)",
  "172E42": "var(--color-dz-x-bhcoec)",
  "198,40,40,.85": "var(--color-dz-a-mgcici-if)",
  "1F6B47": "var(--color-dz-x-bpgleh)",
  "23,46,66,.15": "var(--color-dz-a-bhcoec-bf)",
  "23,46,66,.4": "var(--color-dz-a-bhcoec-e)",
  "23,46,66,.5": "var(--color-dz-a-bhcoec-f)",
  "238,241,244,.45": "var(--color-dz-a-oopbpe-ef)",
  "255,255,255,.7": "var(--color-dz-a-pppppp-h)",
  "255,255,255,.75": "var(--color-dz-a-pppppp-hf)",
  "255,255,255,.8": "var(--color-dz-a-pppppp-i)",
  "255,255,255,.95": "var(--color-dz-a-pppppp-jf)",
  "4E6476": "var(--color-dz-x-eogehg)",
  "6B5A45": "var(--color-dz-x-glfkef)",
  "7A4614": "var(--color-dz-x-hkegbe)",
  "9A5B1E": "var(--color-dz-x-jkflbo)",
  "CFC0A9": "var(--color-dz-x-mpmakj)",
  "D9CBB6": "var(--color-dz-x-njmllg)",
  "DCE3EA": "var(--color-dz-x-nmodok)",
  "E3F3EA": "var(--color-dz-x-odpdok)",
  "E8D9C4": "var(--color-dz-x-oinjme)",
  "EEF1F4": "var(--color-dz-x-oopbpe)",
  "F4C542": "var(--color-dz-x-pemfec)",
  "F4E9DC": "var(--color-dz-x-peojnm)",
  "F7EEE3": "var(--color-dz-x-phoood)",
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
