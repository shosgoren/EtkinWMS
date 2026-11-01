# Etiketler — B-166 hızlı devam

Bu dosya uygulanan sözleşmenin kısa özeti; canlı yayın kanıtı değildir. Yeni AI önce continuity/README + STATE ve işlenmemiş changes parçalarını okur. Kod, current main CI, VPS imajı ve DB defteri ayrı doğrulanır. Eski görev kartları o adımın tarihli kaydıdır; güncel mimari burada, gerçek yayın durumu GitHub/receiver'dadır.

## Kullanıcı yolu

**Modüller → Etiket tasarımı → kullanım yeri → hazır tasarım → Kaydet ve kullan.** Aynı modüle Ayarlar'dan ve yetkili ses komutundan ulaşılır. Depocu her işlemde tasarım yapmaz; bağlamın yayımlanmış varsayılanı baskıda seçilir.

| Bağlam | Gerçek kaynak | Kimlik |
|---|---|---|
| PRODUCT | Ürün ve ana birimin mevcut, belirsiz olmayan barkodu | Mevcut standart barkod; yeni kod tahsis edilmez |
| RECEIPT | İşlenmiş ve kapanmış kabul / işlenmiş üretim çıktısı | Mevcut tekil paket QR + gerçek miktar, lot, üretim/SKT, fiş |
| LOCATION | Yetkili depo/lokasyon ve isteğe bağlı alt ağaç | Mevcut raf kodu |
| SHIPMENT | İşlenmiş, ters kayıt olmayan çıkış | Fiziksel pakette mevcut QR; düz çıkışta gerçek fiş numarası |

Sevk `trackingCode` kapalı sunucu alanıdır; gerçek packageQr varsa onunla birebir aynı, yoksa documentNo. Fiş alanı ayrıca korunur; RECEIPT zorunlu paket bağı gevşetilmez. Müşteri adı için güvenilir veri bağı yoksa boş kalır; isim uydurulmaz.

## Ekran ve ilk kullanım

- Ortak `kalip/` + EtiketEditor kaynak uzantısı. 390×670/844,1180×820,1440×900; açık/koyu, büyük araçlar, sabit Geri/Ana ekran/işlem/Modüller. Dokunmatik tablette araç sütunu140px ile kelimeler bölünmez. Telefonda ortak `ksecp` özellik sayfası, odak/Esc/perde ve kaydırılabilir alanlar.
- Logo / metin / bağlı alan / QR / Code128 / EAN13 / çizgi / çerçeve; sürükle, köşeden boyutlandır, döndür, kopyala, sil, geri al, ok tuşları, alan seçici, ortala, yakınlaştır/sığdır ve iki parmak pan/zoom. Serbest yer varsa yeni nesne/kopya oraya konur; yoksa uyarı ve mevcut tasarım korunur.
- Ölçüler tam µm saklanır, mm gösterilir; ara sayı yazımı bitince doğrulanır. Hazır satırlar uzun ürün kodunu kesmeden iki satıra sığdırır; yazı/kod taşması sessiz kesilmez. QR/barkod çevresi ve fiziksel geometri yayında/baskıda yeniden denetlenir.
- Taslak ayrı, yayın sürümleri değişmez. Kirli/yüklenen taslakta çıkış korunur; hata sahte başarıya dönüşmez. Varsayılan atanan sürümü kullanır; daha yeni yayın sessizce onu değiştirmez. Geçmiş sürüm taslağa kopyalanabilir, aktif varsayılan alternatif olmadan arşivlenemez.
- Beş kısa görsel rehber adımı gerçek hedeflere bağlıdır. İlk otomatik açılış sunucuda tenant+üyelik+aktör+guideVersion audit kaydıyla tekilleşir; etkin başka rehberi kesmez. POST yalnız rehber motoru olayı kabul edince yapılır. Cihazdaki kaldığın adım kaydı ayrı; yardım menüsünden tekrar açılır.
- İleri tasarım araçları (gruplama/eşit aralık/katman yöneticisi, redo, taslak otomatik kurtarma ve obje düzeyinde ses komutları) bu sürümde varmış gibi gösterilmez. Temel hazır etiket/kayıt/baskı yolu bunlara bağlı değildir.

## Yetki ve güvenlik

`labels.view/design/publish/print/printers` ayrı; TENANT_ADMIN tamamına sahiptir. Saha rolü kendiliğinden tasarım hakkı almaz. Print hakkı designer view hakkı vermez. Her sunucu okuma/yazma aktör/üyelik/tenant ve kaynak depo yetkisini yeniden doğrular; sensitive yayın/yazıcı işlemlerinde mevcut MFA/recent-auth kuralları korunur.

Logo yalnız sınırlı yerel PNG/JPEG/WebP'den (5MiB) data URI ile okunur; CSP genişletilmez. İstemci küçültmesi güven sınırı değildir: sunucu128KiB/1024px statik RGB/RGBA8 PNG, CRC/chunk/scanline ve sınırlı inflate doğrular, metadata/animasyon/SVG/URL reddedilir. Depolama/çıktı yalnız kanonik PNG'dir. Metin XML escape edilir; örnek değerler gerçek baskı girdisi olmaz.

0072/0073 additive migration'ları:7 tenant tablosu, FORCE RLS, bileşik FKs ve değişmez version/asset/job. App rolü bunları güncelleyip silemez. Normal işlemde FK hemen denetlenir; yalnız mevcut bakım reset işlemi kendi transaction'ında erteler. Prod reset yapılmaz.

## Yazıcı tercihi ve fiziksel sınır

Öncelik: **şablon+bu cihaz → şablon+firma → genel+bu cihaz → genel+firma → sistem penceresi**. Cihaz tercihi doğrulanmış aktörün kaydıdır. Açıkça seçili kapalı/eksik profil veya değişmiş kalibrasyon sessiz başka yazıcıya düşmez; yeniden seçim gerekir.

Profil SYSTEM_DIALOG,203/300/600 DPI ve ±10mm kaydırma saklar. **Son gerçek yazıcı seçimi OS/tarayıcı penceresindedir.** Bu sürüm yazıcıları ağda keşfetmez, sessiz USB/Bluetooth/ağ seçmez; bridge/raw socket/arbitrary endpoint yok. Donanım testi olmadan fiziksel basıldı denmez.

A4 gerçek mm ızgara (10mm kenar,3mm boşluk) veya tam ölçülü rulo/özel kağıt. Sığmayan A4 küçültülmez, özel kağıda yönlendirir; kullanıcı ölçek%100 seçer. Hazırlanan güncel job SVG'si DOM'a yerleşmeden pencere açılmaz. Busy durumda kağıt değişmez; sayfadan ayrılınca geç pencere açılmaz. “Hazırlandı / pencere açıldı” fiziksel çıktı kabulü değildir.

## Baskı ve değişmezlik

GET salt okunur. Guarded POST yalnız source kimlikleri, izinli şablon, kopya, cihaz ipucu ve jobUUID alır; client actor/değer/snapshot/DPI/endpoint gönderemez. İzin, stok kaynakları, varsayılan sürüm, profil ve geometri aynı yetkili transaction'da okunur.

Job metadata UUID idempotent: aynı içerik aynı değişmez snapshot, farklı içerik çakışması. Tarihsel yeniden basım neden ister; aynı değer/QR/sürümle basılır, güncel kaynak/ACL tekrar denetlenir. Başka ürüne geçen/silinmiş barkod veya değişmiş raf kodu tekrar baskıyı kapatır. Salt geçmiş erişimi ayrı korunur. Baskı stock ledger/bakiye/paket kimliği üretmez.

Sınırlar:60 nesne;100 kaynak/sayfa;1–100 kopya, toplam500; incremental8MiB SVG;512KiB snapshot;200 tasarım/100 logo/30 profil. Liste50 kayıt keyset + arama/bağlam/arşiv; cihaz tercihi yenilemesi cursor'u kaybetmez. Ayrıntı20 sürüm, export25/10 sınırlıdır.

Mevcut ürün/raf/toplu ürün/kabul/üretim düğmeleri yetkili özel varsayılan varsa yeni yola geçer. Varsayılan veya print hakkı yoksa eski stock.view yolu korunur; hatalı seçili özel tasarım sessiz fallback yapmaz. İşlenmiş çıkış kartında sevk etiketi bağlantısı vardır.

## Kod otoriteleri ve kabul kanıtı

| Alan | Giriş |
|---|---|
| Saf model/ready/render/DTO | packages/shared/src/labels/ |
| Store/logo/printer/guide | packages/domain/src/labels/store.ts, assets.ts, printer-store.ts |
| Gerçek kaynak/baskı işi | packages/domain/src/labels/print-source.ts, print.ts |
| Ekran/guarded actions | apps/web/app/t/[slug]/label-designs/, custom-labels/ |
| Ortak editor/baskı | kalip/etiket-editor.tsx, kalip/etiket-baski.tsx, labels/physical-print.ts |
| Kaynak/parite | docs/design/source/EtiketEditor.dc.html + SOURCE.md + port.mjs |
| Gerçek DB | tests/integration/labels/ + ac/ac-04-api-slug.int.test.ts |
| Gerçek tarayıcı | tests/e2e/label-designer.spec.ts |

Test izolasyonu: etiket tasarım/yazıcı varsayılanı ve yarış testleri ayrı gerçek `label-design`/`label-race` signup+MFA aktörlerini kullanır; eski receiving müşterisine varsayılan bırakmaz. İlk rehber perdesi kapatılıp sunucu audit kabulü beklenir. Giriş/MFA alanları hydration bitene kadar kapalıdır ve native fallback POST'tur; test sır alanına yazmadan gerçek hazır durumunu bekler. Auth/MFA/hız politikası değişmez.

1Kasım yerel kanıt:158 hedef birim;26 gerçek DB (store9/printer4/print13); ayrı A/B/oturum yükleyici AC04 392. QR/Code128/EAN13×203/300/600×4dönüş Chromium→ZXing36/36. Gerçek PDF6etiket A4→2sayfa,100×50mm rulo→6sayfa görüntülendi. Fiziksel yazıcı/GS1 kalite sertifikası kanıtı yok.

Tarayıcı aday app commit6d62903: desktop/mobile tasarım/logo/sürükleme/klavye/tema,5 gerçek paketQR, tercihler, değişmez yeniden baskı ve>50 keyset; ölçü yarışı/unmount/busy/legacyyetki kabulü tek tam koşuda4/4 geçti.100×150mm ürün etiketi seçimi, gerçek standart barkodun QR/Code128/EAN13 olarak hazırlanması ve kayıtlı203DPI'da gerçek jobSVG'sinin Chromium→ZXing çözümü de bu koşuda.96DPI ekran küçük resmi fiziksel barkod kalite kanıtı sayılmaz. Mevcut derleme kimliği/uygulama değişmezliği yerel kanıtla doğrulandı. Exact-head final CI ve receiver/imaj/DB doğrulaması her yayında ayrıca gerekir; geçmiş yeşil log güncel yayın sayılmaz.

Yayın/geri alma/yedek ve sır referansları: OPERATIONS.md. Sır/DB adresi/anahtar burada veya görev kartlarında tutulmaz. Son görev kaydı: T1170; seri kartlar T1145–1182. Eski geliştirme günlüklerinin ayrıntısı Git geçmişindedir.
