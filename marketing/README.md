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

## Panelden yönetilen içerik (T-407)

Ana başlık, vurgulu satır, alt metin ve kiralama bölümündeki fiyat kartları `yonet.etkinyazilim.com/satis` ekranından yayınlanır. Sunucu
içeriği `SITE_CONTENT_URL`'den (canlıda `http://web:3000/api/public/site`, iç ağ) 30 sn önbellekle okur, sıkı doğrular, kahraman metnini
HTML kaçışıyla ön-çizime yerleştirir ve istemciye çalıştırılmayan JSON veri bloğu (`#site-content`) verir; `boot.js` bunu `props.site`
olarak bileşene geçirir (yalnız Türkçe görünümde). İçerik yoksa ya da uç yanıt vermezse tasarım metni kalır ve fiyat bölümü görünmez.
Önizleme: `/?onizleme=<sır>` (30 dk, süreç genelinde 10 dakikada en çok 60 istek), yanıt `no-store`, `noindex`, `no-referrer`.
Fiyat bölümünün işaretlemesi tuval (`Saha.dc.html`) ile aynıdır; üretim düzeltmesi yalnız veri kaynağıdır.

## Sunucu

Sunulan dosyalar açılışta `public/` altından listelenir (`/` → index.html, `/privacy` → privacy.html; diğer `.html`, nokta ile başlayan adlar ve bilinmeyen uzantılar sunulmaz). CSP: betik yalnız `'self'`; tasarım satır içi `style` öznitelikleri kullandığı için `style-src 'self' 'unsafe-inline'`.

Demo formu geri bildirimi (T-431): gönderirken düğmede gösterge ve çift gönderim engeli; alan altı uyarılar; hata olursa bilgiler korunur ve kırmızı "Gönderilemedi · tekrar dene" satırı; başarıda aynı kutuda √, talep no (yanıttaki `id`'nin ilk 8 hanesi) ve odak başlıkta. Mantık `src/boot.js`, görünüm `src/landing.dc.html` (demo bölümü); e2e `tests/e2e/zzz-demo-form.spec.ts`.

Demo formu gerçek talepleri `/data/demo-requests.jsonl` dosyasına, Docker named volume üzerinde saklar. Kayıttan sonra (T-945) bildirim ayarı varsa Resend HTTP API ile işletmeciye e-posta gönderir; e-posta hatası kaydı bozmaz, yanıtı bekletmez, loga yalnız durum kodu yazılır.

### E-posta bildirimi ayarı (işletmeci, bir kez)

Ayar ortamdan (`RESEND_API_KEY`, `LEAD_NOTIFY_TO`, `LEAD_NOTIFY_FROM`) ya da veri biriminde `notify.json` dosyasından okunur; anahtar repoya, loga veya sohbete girmez. VPS'de root olarak (anahtar gizli girilir):

```bash
read -rsp 'Resend API anahtarı: ' K && echo && case "$K" in re_*) ;; *) echo 'anahtar re_ ile başlamalı'; false;; esac && case "$K" in *[!A-Za-z0-9_]*) echo 'anahtarda beklenmeyen karakter'; false;; esac && printf '{"resendApiKey":"%s","to":"hosgorens@gmail.com"}' "$K" | docker exec -i etkinwms-marketing-1 sh -c 'umask 077 && cat > /data/notify.json' && unset K && echo tamam
```

Alan adı Resend'de doğrulanmadıkça gönderen `onboarding@resend.dev` olur ve yalnız Resend hesabının e-postasına gönderim yapılabilir. Kapatmak için `notify.json` silinir. Tüm IP'ler için saatte en çok 20 bildirim gider; fazlası yalnız dosyaya kaydedilir. Not: marketing-leads birimi yedeklenirse anahtar da yedekte bulunur. Kayıtlar herkese açık bir API'den okunamaz. Bu sürümde talepleri sunucu erişimi olan işletmeci kontrol eder. Formda iletişim onayı, kaynak denetimi, 8KB gövde sınırı ve IP başına saatte 5 deneme sınırı vardır.

Ürün arayüzleri temsili olarak etiketlenmiştir. Müşteri referansı, fiyat veya tamamlanmamış modülün hazır olduğuna dair iddia içermez. Cihaz uyumluluğu ve pilot kabul kapsamı açıkça belirtilir.
