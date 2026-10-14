# Etkin WMS satış sitesi

Node 24 ile `PORT=3200 LEAD_DIR=/tmp/etkin-sales-test node marketing/server.mjs`.
Ana adres etkinyazilim.com; .com.tr ve www adresleri HTTPS ile ana adrese yönlendirilir.
WMS uygulaması wms.etkinyazilim.com adresinde ayrı çalışır.

## Sayfa nasıl üretilir (T-941)

- Tasarım kaynağı `src/landing.dc.html`: Claude Design kanvasındaki “Saha” tanıtım sayfasının dışa aktarımı + üretim düzeltmeleri (sayfa başlığı, demo formu, göreli gizlilik bağlantısı, `/img/…` görselleri, favicon).
- `node marketing/build.mjs` (Chromium/@playwright/test gerekir) kaynaktan `public/index.html` (ön-çizilmiş, arama motoru ve JS'siz ziyaretçi için tam içerik), `public/styles.css` ve `public/site.js` üretir. Bu üç dosyayı elle düzenlemeyin.
- `src/runtime.js`: şablonu (`{{…}}`, `sc-if`, `sc-for`, `onClick`) tarayıcıda çizen ve ön-çizilmiş DOM'u yerinde güncelleyen küçük çalışma zamanı; eval/new Function kullanmaz. `src/boot.js`: açılış ve demo formu. `src/transform.mjs`: bileşen kodunu ok işlevlerine çevirir (CSP/lint).
- Görseller `public/img`, yazı tipleri `public/fonts` (Bricolage Grotesque, Instrument Sans, IBM Plex Mono; OFL lisansları yanında; Türkçe dahil Latin alt kümesi). Dış yazı tipi veya betik kaynağı yoktur.
- Tasarım güncellenirse: yeni `.dc.html` dışa aktarımını `src/landing.dc.html` üzerine alıp aynı üretim düzeltmelerini koruyun, sonra `node marketing/build.mjs` ve `marketing/*.test.mjs`.

## Sunucu

Sunulan dosyalar açılışta `public/` altından listelenir (`/` → index.html, `/privacy` → privacy.html; diğer `.html`, nokta ile başlayan adlar ve bilinmeyen uzantılar sunulmaz). CSP: betik yalnız `'self'`; tasarım satır içi `style` öznitelikleri kullandığı için `style-src 'self' 'unsafe-inline'`.

Demo formu gerçek talepleri `/data/demo-requests.jsonl` dosyasına, Docker named volume üzerinde saklar. E-posta göndermez. Kayıtlar herkese açık bir API'den okunamaz. Bu sürümde talepleri sunucu erişimi olan işletmeci kontrol eder. Formda iletişim onayı, kaynak denetimi, 8KB gövde sınırı ve IP başına saatte 5 deneme sınırı vardır.

Ürün arayüzleri temsili olarak etiketlenmiştir. Müşteri referansı, fiyat veya tamamlanmamış modülün hazır olduğuna dair iddia içermez. Cihaz uyumluluğu ve pilot kabul kapsamı açıkça belirtilir.
