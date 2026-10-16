# Panel · Demo talepleri — tasarım/uygulama karşılaştırması (I-18)

- Kaynak: `docs/design/source/Yonet.dc.html` (sha256 `32c2dda3…9561`), kabuk + `talepler`, kaynaktaki örnek veri (2 bekleyen talep, yer tutucu adlar).
- Uygulama: `apps/web/app/panel/shell.tsx` + `apps/web/app/panel/talepler/view.tsx`, aynı veriyle sunucu çizimi + `globals.css` (Tailwind + üretilmiş `design/yonet.css`).
- Yöntem: aynı Chromium, aynı yazı tipi dosyaları, 2× piksel yoğunluğu, hareket kapalı, kanal başına 40/255 eşik. Tasarımda menüden "Demo talepleri" açıldı; önizleme çubuğu gizli (DESIGN-PARITY §5).
- **Bilinçli fark (kademeli aktarım, DESIGN-PARITY §8):** sol menü ve mobil sekmelerde yalnız yapılmış sayfa (Demo talepleri) var; Özet, Müşteriler, Paketler, Ödemeler, Satış sayfası, İşlem kaydı kendi kartlarıyla (T-403…T-408) eklenecek. Karşılaştırma bu yüzden menü dışındaki içerik alanında yapıldı.
- Sonuç (2026-10-15), içerik alanı:

| Ölçü | Açık tema | Koyu tema |
|---|---|---|
| 390×844 (mobil) | 0 px | 0 px |
| 1180×820 (tablet) | 114 px (alt piksel kenar yumuşatma, tablo sütun konumu) | 99 px (aynı) |
| 1440×900 (masaüstü) | 683 px (aynı) | 586 px (aynı) |

Fark yalnız tablonun Sektör/İhtiyaç sütunlarındaki metin kenarlarında, 1 pikselin altında yatay kaymadır; büyütülmüş karşılaştırmada metin, konum ve renk aynıdır.
