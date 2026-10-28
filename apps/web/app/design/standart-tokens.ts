// T-1117 (STANDART §7, kaynak `docs/design/source/Standart*.dc.html`): standart tuvalde geçen ama kalıp kaynaklarında (KalipForm /
// KalipListe / KalipDetay; üretilmiş `kalip-*-tokens.ts`) bulunmayan renkler → `globals.css` `--color-st-k-*` belirteci. Elle yazılır
// (üreteç standart kaynakları henüz okumaz); yeni renk önce tuvale ve `globals.css`'e, sonra buraya.
export const ST_TOKENS: Readonly<Record<string, string>> = {
  /** Sevk / adres ve teslimat turuncusu (Yeni cari "Adres ve teslimat" sütunu). */
  C2702A: "var(--color-st-k-turuncu)",
};
