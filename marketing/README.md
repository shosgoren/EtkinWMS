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

Demo formu (T-1025): zorunlu alan işaretleri, ikonlu native radio ve form DOM'unu koruyan gizlilik katmanı `docs/design/source/DemoForm.dc.html` kaynağından üretilir. Gönderim anahtarı aynı içerik retry'ında korunur. Başarı yeşil onay ve giriş bağlantısıdır; yeni/eski adrese aynı202 `{ok:true}`, talep numarası veya durum dönmez. TR/EN ve odak davranışı `tests/e2e/zzz-demo-form.spec.ts`, izole üç genişlik/privacy/retry/sahiplik akışı `node marketing/form-browser.mjs` ile sınanır.

Yeni talepler mevcut `SITE_CONTENT_URL` kökenindeki **yalnız iç ağda erişilen** `/api/public/demo` köprüsü üzerinden PostgreSQL'e yazılır.0057 migration gereklidir. Eski `/data/demo-requests.jsonl` dosyası korunur ve yeni talepten önce taranır; tüm adres normalizasyonunda PostgreSQL tek otoritedir. Eski worker ingestion ve yeni gönderim aynı kalıcı e-posta rezervasyonunu kullanır; statüden bağımsız ikinci kayıt ve retry bildirimi engellenir. DB/köprü yoksa JSONL'ye geri dönüş yapılmaz;503 ve aynı anahtarla retry gerekir.

Sahiplik bağlantısı mevcut worker mailer + `QUEUE_SEAL_KEY` kullanır; yeni credential/servis gerekmez. DB outbox15dakika süre, hash/mühür, tek kullanım, adres başına15dakika aralık/3günlük, global100saatlik sınır taşır. Bağlantı fragment'i URL'den temizlenir; açık düğme POST'u doğrular. GET/mail tarayıcısı tüketmez. Yalnız doğrulanmış okuyucu bekleme, kurulum veya giriş yönlendirmesini alır; yönetici onayı ve giriş değişmez. Başarısız satır diğer postaları durdurmaz; retry sağlayıcı idempotency anahtarını korur.

Kayıttan sonra mevcut işletmeci bildirimi yalnız yeni DB kaydı için tetiklenir; yanıt kaybı ikinci bildirim açmaz. Bu eski bildirim en iyi çaba esasıyla çalışır; sahiplik postası kalıcı outbox'tadır.

### E-posta bildirimi ayarı (işletmeci, bir kez)

Ayar ortamdan (`RESEND_API_KEY`, `LEAD_NOTIFY_TO`, `LEAD_NOTIFY_FROM`) ya da veri biriminde `notify.json` dosyasından okunur; anahtar repoya, loga veya sohbete girmez. VPS'de root olarak (anahtar gizli girilir):

```bash
read -rsp 'Resend API anahtarı: ' K && echo && case "$K" in re_*) ;; *) echo 'anahtar re_ ile başlamalı'; false;; esac && case "$K" in *[!A-Za-z0-9_]*) echo 'anahtarda beklenmeyen karakter'; false;; esac && printf '{"resendApiKey":"%s","to":"hosgorens@gmail.com"}' "$K" | docker exec -i etkinwms-marketing-1 sh -c 'umask 077 && cat > /data/notify.json' && unset K && echo tamam
```

Alan adı Resend'de doğrulanmadıkça gönderen `onboarding@resend.dev` olur ve yalnız Resend hesabının e-postasına gönderim yapılabilir. Kapatmak için `notify.json` silinir. Tüm IP'ler için saatte en çok 20 bildirim gider; fazlasının DB kaydı korunur. Not: marketing-leads birimi yedeklenirse anahtar da yedekte bulunur. Kayıtlar herkese açık bir API'den okunamaz. Talepler mevcut yönetim panelinde işlenir. Formda iletişim onayı, kaynak denetimi, 8KB gövde sınırı ve IP başına saatte 5 deneme sınırı vardır.

Ürün arayüzleri temsili olarak etiketlenmiştir. Müşteri referansı, fiyat veya tamamlanmamış modülün hazır olduğuna dair iddia içermez. Cihaz uyumluluğu ve pilot kabul kapsamı açıkça belirtilir.

## T-1025 hazırlığı (henüz yayınlanmadı)
Zorunlu alanlar ve sektör seçenekleri `docs/design/source/DemoForm.dc.html` kaynağından build sırasında alınır.
`src/form-ui.js` gizlilik metnini aynı sayfada erişilebilir bir katmanda açar; geri bağlantısı, Esc ve tarayıcı geri düğmesi formun mevcut DOM'una döner. Kişisel veri tarayıcı depolamasına veya URL'ye yazılmaz. Sektörler yerel radio semantiğiyle klavyeden seçilir.
İzole tarayıcı deneyi: `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium node marketing/form-browser.mjs` (yerel sunucu, gönderim uçları sahte; gerçek posta yok).
0057 migration hazırlığı ingestion'da kalıcı e-posta ve request ID tekilliği sağlar; mevcut marketing POST henüz bu yola bağlanmamıştır. Bu yüzden uçtan uca mükerrerlik düzeltmesi tamamlanmış değildir.
Son kullanıcı seçimi e-postaya süreli sahiplik bağlantısıdır; bu akış henüz uygulanmadı. PR/yayın kapalıdır.
