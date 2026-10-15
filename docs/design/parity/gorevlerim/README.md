# Görevlerim — tasarım/uygulama karşılaştırması (I-18)

- Kaynak: `docs/design/source/Bakis.dc.html` (sha256 `f38a508b…f457`), `v.home`, kaynaktaki örnek veri (11 iş, 25 kalem; Çıkış ve Üretim ACİL).
- Uygulama: `apps/web/app/t/[slug]/easy-operations.tsx`, aynı veriyle sunucu çizimi + `globals.css` (Tailwind derlemesi + üretilmiş `design/bakis.css`).
- Yöntem: iki taraf da aynı Chromium'da, aynı yazı tipi dosyalarıyla, 2× piksel yoğunluğunda çekildi. Hareket kapalıydı (`prefers-reduced-motion` ve SVG animasyonu durduruldu). Fark eşiği kanal başına 40/255 idi.
- Sonuç (2026-10-15):

| Ölçü | Açık tema | Koyu tema |
|---|---|---|
| 390×844 (mobil, dokunmatik) | 0 px fark | 2 px (kenar yumuşatma) |
| 1180×820 (tablet, dokunmatik) | 0 px fark | 2 px (kenar yumuşatma) |
| 1440×900 (masaüstü) | 0 px fark | 2 px (kenar yumuşatma) |

Görüntüler 1× ölçeğe küçültülerek saklandı: `design-<ölçü>.png` ve `app-<ölçü>.png`.
