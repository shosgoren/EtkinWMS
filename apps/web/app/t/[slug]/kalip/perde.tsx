"use client";
// T-990 (B-97, ALTIN-KURAL "Katman standardı"): TEK ortak buzlu perde. Yeni her alt sayfa / seçim sayfası / kutu bunu kullanır; görünüş
// `design/perde.css` `.kperde` (Pano hesap menüsü perdesiyle aynı değer). Perdeye dokununca katman kapanır; klavye odağı almaz.
export function KalipPerdeKatman({ onClose, label }: { onClose: () => void; label: string }) {
  return <button type="button" className="kperde" aria-label={label} tabIndex={-1} onClick={onClose} data-testid="kalip-perde" />;
}
