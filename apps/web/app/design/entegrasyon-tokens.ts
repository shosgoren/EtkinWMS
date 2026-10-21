// entegrasyon-tokens.ts — scripts/design/port.mjs ile ÜRETİLDİ; elle düzenlemeyin (I-18). Kaynaktaki onaltılık renk → belirteç.
const T: Readonly<Record<string, string>> = {
  "0F6E8C": "var(--color-dz-x-apgoim)",
  "121B24": "var(--color-dz-x-bcblce)",
  "172E42": "var(--color-dz-x-bhcoec)",
  "17583C": "var(--color-dz-x-bhfidm)",
  "17804F": "var(--color-dz-x-bhiaep)",
  "1A1300": "var(--color-dz-x-bkbdaa)",
  "1C2833": "var(--color-dz-x-bmcidd)",
  "1F3A30": "var(--color-dz-x-bpdkda)",
  "223040": "var(--color-dz-x-ccdaea)",
  "23,46,66,.06": "var(--color-dz-a-bhcoec-ag)",
  "23,46,66,.4": "var(--color-dz-a-bhcoec-e)",
  "2F5DA8": "var(--color-dz-x-cpfnki)",
  "2F7D5B": "var(--color-dz-x-cphnfl)",
  "2F9E6B": "var(--color-dz-x-cpjogl)",
  "30475A": "var(--color-dz-x-daehfk)",
  "3A1E22": "var(--color-dz-x-dkbocc)",
  "3A2E12": "var(--color-dz-x-dkcobc)",
  "4E6476": "var(--color-dz-x-eogehg)",
  "6B4A00": "var(--color-dz-x-glekaa)",
  "6C4BD8": "var(--color-dz-x-gmelni)",
  "7A1F1F": "var(--color-dz-x-hkbpbp)",
  "9A5B2E": "var(--color-dz-x-jkflco)",
  "9FB2C2": "var(--color-dz-x-jplcmc)",
  "9FE1BF": "var(--color-dz-x-jpoblp)",
  "B07D0B": "var(--color-dz-x-lahnal)",
  "C5D0DA": "var(--color-dz-x-mfnank)",
  "C62828": "var(--color-dz-x-mgcici)",
  "E3E9EE": "var(--color-dz-x-odojoo)",
  "E3F1E9": "var(--color-dz-x-odpboj)",
  "E56A00": "var(--color-dz-x-ofgkaa)",
  "E6EBEF": "var(--color-dz-x-ogolop)",
  "EEF1F4": "var(--color-dz-x-oopbpe)",
  "F2A3A3": "var(--color-dz-x-pckdkd)",
  "F2C53D": "var(--color-dz-x-pcmfdn)",
  "F2D58A": "var(--color-dz-x-pcnfik)",
  "F4C542": "var(--color-dz-x-pemfec)",
  "F6F3EE": "var(--color-dz-x-pgpdoo)",
  "FDECEC": "var(--color-dz-x-pnomom)",
  "FFF3D1": "var(--color-dz-x-pppdnb)",
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
