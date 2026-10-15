// yonet-tokens.ts — scripts/design/port.mjs ile ÜRETİLDİ; elle düzenlemeyin (I-18). Kaynaktaki onaltılık renk → belirteç.
const T: Readonly<Record<string, string>> = {
  "0,0,0,.3": "var(--color-dz-a-aaaaaa-d)",
  "0,0,0,.6": "var(--color-dz-a-aaaaaa-g)",
  "05090D": "var(--color-dz-x-afajan)",
  "0F3D27": "var(--color-dz-x-apdnch)",
  "13171C": "var(--color-dz-x-bdbhbm)",
  "172E42": "var(--color-dz-x-bhcoec)",
  "17804F": "var(--color-dz-x-bhiaep)",
  "1A1300": "var(--color-dz-x-bkbdaa)",
  "1B2128": "var(--color-dz-x-blcbci)",
  "1E2F3E": "var(--color-dz-x-bocpdo)",
  "1F4A3A": "var(--color-dz-x-bpekdk)",
  "23,46,66,.06": "var(--color-dz-a-bhcoec-ag)",
  "23,46,66,.08": "var(--color-dz-a-bhcoec-ai)",
  "23,46,66,.35": "var(--color-dz-a-bhcoec-df)",
  "23,46,66,.5": "var(--color-dz-a-bhcoec-f)",
  "232B34": "var(--color-dz-x-cdclde)",
  "244,197,66,.12": "var(--color-dz-a-pemfec-bc)",
  "255,255,255,.06": "var(--color-dz-a-pppppp-ag)",
  "255,255,255,.08": "var(--color-dz-a-pppppp-ai)",
  "255,255,255,.1": "var(--color-dz-a-pppppp-b)",
  "255,255,255,.12": "var(--color-dz-a-pppppp-bc)",
  "255,255,255,.14": "var(--color-dz-a-pppppp-be)",
  "255,255,255,.75": "var(--color-dz-a-pppppp-hf)",
  "255,255,255,.78": "var(--color-dz-a-pppppp-hi)",
  "2C3540": "var(--color-dz-x-cmdfea)",
  "3A4552": "var(--color-dz-x-dkeffc)",
  "3D2A6B": "var(--color-dz-x-dnckgl)",
  "4A3500": "var(--color-dz-x-ekdfaa)",
  "5,9,13,.55": "var(--color-dz-a-afajan-ff)",
  "B07D00": "var(--color-dz-x-lahnaa)",
  "C62828": "var(--color-dz-x-mgcici)",
  "C9C3B8": "var(--color-dz-x-mjmdli)",
  "CFE8DA": "var(--color-dz-x-mpoink)",
  "D8DEE4": "var(--color-dz-x-ninooe)",
  "E6E2DA": "var(--color-dz-x-ogocnk)",
  "E6EAEE": "var(--color-dz-x-ogokoo)",
  "E9E4DA": "var(--color-dz-x-ojoenk)",
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
  bg: "var(--color-dzy-bg)",
  fg: "var(--color-dzy-fg)",
  surface: "var(--color-dzy-surface)",
  chip: "var(--color-dzy-chip)",
  track: "var(--color-dzy-track)",
  "ok-bg": "var(--color-dzy-ok-bg)",
  "ok-fg": "var(--color-dzy-ok-fg)",
} as const;
