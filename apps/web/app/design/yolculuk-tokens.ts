// yolculuk-tokens.ts — scripts/design/port.mjs ile ÜRETİLDİ; elle düzenlemeyin (I-18). Kaynaktaki onaltılık renk → belirteç.
const T: Readonly<Record<string, string>> = {
  "0E7C7B": "var(--color-dz-x-aohmhl)",
  "121B24": "var(--color-dz-x-bcblce)",
  "16212B": "var(--color-dz-x-bgcbcl)",
  "172E42": "var(--color-dz-x-bhcoec)",
  "17583C": "var(--color-dz-x-bhfidm)",
  "18,27,36,.94": "var(--color-dz-a-bcblce-je)",
  "1A1300": "var(--color-dz-x-bkbdaa)",
  "1C2833": "var(--color-dz-x-bmcidd)",
  "1F3A30": "var(--color-dz-x-bpdkda)",
  "23,46,66,.06": "var(--color-dz-a-bhcoec-ag)",
  "23,46,66,.08": "var(--color-dz-a-bhcoec-ai)",
  "23,46,66,.12": "var(--color-dz-a-bhcoec-bc)",
  "23,46,66,.4": "var(--color-dz-a-bhcoec-e)",
  "23,46,66,.5": "var(--color-dz-a-bhcoec-f)",
  "240,194,75,.1": "var(--color-dz-a-pamcel-b)",
  "240,194,75,.22": "var(--color-dz-a-pamcel-cc)",
  "24323F": "var(--color-dz-x-cedcdp)",
  "255,255,255,.14": "var(--color-dz-a-pppppp-be)",
  "255,255,255,.94": "var(--color-dz-a-pppppp-je)",
  "2F5DA8": "var(--color-dz-x-cpfnki)",
  "2F7D5B": "var(--color-dz-x-cphnfl)",
  "30475A": "var(--color-dz-x-daehfk)",
  "3A3015": "var(--color-dz-x-dkdabf)",
  "47,125,91,.18": "var(--color-dz-a-cphnfl-bi)",
  "4A2FA8": "var(--color-dz-x-ekcpki)",
  "4E6476": "var(--color-dz-x-eogehg)",
  "5,9,13,.6": "var(--color-dz-a-afajan-g)",
  "5FAF8A": "var(--color-dz-x-fpkpik)",
  "6A7F91": "var(--color-dz-x-gkhpjb)",
  "6B4A00": "var(--color-dz-x-glekaa)",
  "6C4BD8": "var(--color-dz-x-gmelni)",
  "7A4BC2": "var(--color-dz-x-hkelmc)",
  "8A5A12": "var(--color-dz-x-ikfkbc)",
  "8A9BAA": "var(--color-dz-x-ikjlkk)",
  "9FB2C2": "var(--color-dz-x-jplcmc)",
  "9FD3B8": "var(--color-dz-x-jpndli)",
  "B23A3A": "var(--color-dz-x-lcdkdk)",
  "C25A00": "var(--color-dz-x-mcfkaa)",
  "C9D2DA": "var(--color-dz-x-mjncnk)",
  "C9D6E0": "var(--color-dz-x-mjngoa)",
  "DCE3EA": "var(--color-dz-x-nmodok)",
  "E3F1E9": "var(--color-dz-x-odpboj)",
  "E4E9EE": "var(--color-dz-x-oeojoo)",
  "E6EBEF": "var(--color-dz-x-ogolop)",
  "EEF1F4": "var(--color-dz-x-oopbpe)",
  "EFE9FB": "var(--color-dz-x-opojpl)",
  "F0C24B": "var(--color-dz-x-pamcel)",
  "F0D27A": "var(--color-dz-x-panchk)",
  "F4C542": "var(--color-dz-x-pemfec)",
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
