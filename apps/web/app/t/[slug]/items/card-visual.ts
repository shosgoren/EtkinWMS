// T-968: kart türünün kalıp ikonu ve rengi (KalipListe kaynağındaki CAT eşlemesi: Hammadde / Yarı mamul / Mamul). Ticari mal kaynakta yok:
// kaynağın koli ikonu + liste ve detay kaplarının ikisinde de geçen camgöbeği renk. Renkler onaltılık, `#` yok (kdz ile belirteç).
import { LICON } from "../../../design/kalip-icons.ts";
import type { CardType } from "./items-view.tsx";

export const CARD_VISUAL: Readonly<Record<CardType, { readonly d: string; readonly color: string }>> = {
  HM: { d: LICON.box, color: "8A5A12" },
  YM: { d: LICON.uret, color: "6C4BD8" },
  MM: { d: LICON.tag, color: "2F7D5B" },
  TM: { d: LICON.koli, color: "0E7C7B" },
};
