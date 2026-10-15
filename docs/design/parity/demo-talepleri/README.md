# Demo talepleri (operatör) — tasarım/uygulama karşılaştırması (I-18)

- Kaynak: `docs/design/source/Giris.dc.html` (sha256 `10987db5…9383`), `v.mgr` + `v.op`, kaynaktaki örnek veri (3 bekleyen talep, yer tutucu adlar; BUGÜN 14:22 / DÜN 09:10 / 12.10 16:45).
- Uygulama: `apps/web/app/operator/demo-requests/view.tsx`, aynı veriyle sunucu çizimi + `globals.css` (Tailwind derlemesi + üretilmiş `design/giris.css`).
- Yöntem: iki taraf aynı Chromium'da, aynı yazı tipi dosyalarıyla, 2× piksel yoğunluğunda; hareket kapalı; fark eşiği kanal başına 40/255. Tasarımda ekran `EKRAN › Demo talepleri` ile açıldı, önizleme çubuğu gizlendi (DESIGN-PARITY §5).
- Not: kaynak çalışma zamanı her `{{…}}` bağını `<span>` içine alır; `.rt span` kuralı bu yüzden ada ve alt satıra da uygulanır. Uygulama aynı iç içe `<span>` yapısını kurar (onaylı görünüm).
- Sonuç (2026-10-15):

| Ölçü | Açık tema | Koyu tema |
|---|---|---|
| 390×844 (mobil, dokunmatik) | 0 px fark | 0 px fark |
| 1180×820 (tablet, dokunmatik) | 0 px fark | 0 px fark |
| 1440×900 (masaüstü) | 0 px fark | 0 px fark |

Görüntüler 1× ölçeğe küçültülerek saklandı: `design-<ölçü>[-koyu].png` ve `app-<ölçü>[-koyu].png`.
