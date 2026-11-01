# Etiket tasarım editörü — B-166 uygulama planı

Tarih: 1 Kasım 2026. Durum: GELİŞTİRME BAŞLADI; T-1146 tasarım kaynağı GitHub PR282 ile main'de; T-1147 saf sözleşme PR283 ile main’de (23a1aa5). T-1148…1150 kalıcıkatman paketi yerel doğrulamada. Henüz uygulama/yayın yok.
Plan kartı: [T-1145](../tasks/T-1145.md). Başlangıç kaynak main: `9c046c6f015aa2448cbc82bff86fbbbd88ac6c20`.
Otorite: kullanıcı kararı + ALTIN-KURAL, STANDART, DESIGN-PARITY, INVARIANTS ve ADR-022. Bu belge onların istisnası değildir.

## Amaç ve mevcut durum

Hiç bilgisayar kullanmamış kişi hazır bir etiket seçer; logo, metin, barkod ve QR'ı kolayca yerleştirir; kendi ölçüsünde kaydeder ve işleme bağlar. Depo personeli her baskıda tasarım yapmaz: doğru tasarım işleme göre kendiliğinden gelir.

Kaynak incelemesi (kod kanıtı; canlı ve fiziksel yazıcı kabulü değildir):
- `packages/domain/src/labels/templates.ts`: kodla tanımlı ürün/lokasyon SVG ve 203 dpi ZPL, ürün QR üretimi. Kayıtlı müşteri tasarım modeli yok.
- `apps/web/app/t/[slug]/labels/`: önizleme, A4/rulo ve ölçü ayarı; özel ölçüde ZPL indirme gizlenir. Mevcut ölçü seçimi serbest alan yerleşimi değildir.
- `apps/web/app/t/[slug]/receipts/packages/labels/`: paket etiketi/tekil QR yolu. Kimlikler ve stok motoru korunacak.
- `packages/domain/src/identity/permissions.ts`: ürün/raf label işlem anahtarları var; tasarım yönetimi ve yayın yetkileri ayrıca modellenmeli.
- ADR-022: birincil baskı tarayıcı; yerel köprü kapalı. Müşteri şablonları ve yeni baskı yetenekleri için uygulama aşamasında ADR eki gerekir.
- B-166 aynı ihtiyacı kapsar; yeni mükerrer backlog açılmaz. Tasarım editörü, kapalı paket akışını kendiliğinden etkinleştirmez.

## 1. Kullanıcının göreceği akış

**Etiketler → Nerede kullanılacak? → Hazır tasarım → Düzenle → Kaydet ve kullan.**

İlk açılışta en çok dört atlanabilir, tekrar açılabilir görsel adım. Tuval boş başlamaz; örnek verili hazır etiket gelir. Kullanıcıya değişken kodu veya teknik yazıcı dili yazdırılmaz.

| Kullanım yeri | Örnek hazır tasarım | Gerçek veri kaynağı / kimlik |
|---|---|---|
| Ürün | Küçük ürün, detaylı ürün | Ürün adı/kodu/birim ve mevcut standart barkodu |
| Giriş / tekil paket | Varil, koli, çuval | Mal kabul/paket kaydı; lot, üretim/SKT, gerçek miktar, mevcut tekil paket QR |
| Raf / göz | Büyük raf kodu | Yetkili depo/lokasyon kaydı; mevcut raf kimliği |
| Çıkış / sevk | Sevk kolisi, sevk bilgisi | Mevcut çıkış/sevk belgesi ve ilişkili paketler; izinli cari/belge alanları |

Her kullanım yerine birden fazla şablon, tam bir aktif varsayılan atanabilir. Aynı şablon uyumlu birden çok yerde kullanılabilir; uyumsuz alan bağlamında yayın reddedilir. Baskıda varsayılan önceden seçilir; yetkili kullanıcı değiştirebilir. İlk sürümde gizli ürün/depo öncelik zinciri yoktur; depo özel eşlemeleri sonraki aşamada açık öncelik göstergesiyle ele alınır.

## 2. Editör araçları

- **Ekle:** Logo / Metin / Veri alanı / Barkod / QR / Çizgi / Çerçeve. İleri seçenekler ihtiyaç oldukça açılır.
- Sürükle-bırak, köşeden boyutlandır, kopyala, sil ve geri al/ileri al. QR ve barkod en-boy oranı/okunabilirliği korunur.
- Ortala, hizala, eşit aralık, gruplama, öne/arkaya al, arka plan öğesini kilitle; taşıma sırasında mıknatıslı kılavuzlar ve güvenli kenarlar.
- Etiket ebatları mm: hazır ölçüler + özel en/boy, yatay/dikey, boşluk, kenar payı. A4'te sütun/satır ve boşluk önizlenir; gerçek ölçü ile ekran yakınlaştırması ayrıdır.
- Yazı boyutu, satır sonu, kalınlık, hizalama ve dönüş; metin alanlarında Türkçe karakterler. Taşan metin sessizce kesilmez: sığdır/satırla/kısalt politikası belirgin olur; kimlik/barkod değeri asla kesilmez.
- Veri alanları ikonlu katalogdan seçilir: ad/kod/birim, miktar, lot, üretim/SKT, raf, belge no, yetkili cari vb. Yalnız seçilen kullanım yerinde ve kullanıcı yetkisinde bulunan alanlar açılır.
- Her öğe sabit metin ya da izinli dinamik alan olabilir. Örnek/gerçek önizleme ayrımı belirgin; örnek veri üretim etiketi gibi basılamaz.
- Şablon çoğaltma, adlandırma, taslak kurtarma, önceki yayımlanmış sürüme geri dönme. Kalıcı kişisel tasarım/varsayılanlar tenant'ta tutulur.
- Basit ses komutları mevcut Etkin altyapısına bağlanır: “metin ekle”, “ortala”, “geri al”, “önizle”; yayın/baskıda gereken onay ve yetki korunur.

## 3. Cihaza göre ayrı kullanım

| Cihaz | Düzen ve etkileşim |
|---|---|
| Masaüstü | Sol öğe kutusu, ortada çalışma yüzeyi, sağda yalnız seçili öğenin ayarı; fare, klavye okları ve çoklu seçim. Ortak kabuk/kalıp uzatılır. |
| Tablet | Geniş çalışma yüzeyi, büyük dokunma tutamaçları; özellikler tek açılır panelde. Parmakla taşıma ve iki parmakla yakınlaştırma. |
| Telefon | Ekrana sığan etiket, aşağıda Ekle/Düzenle/Hizala; aynı anda tek kısa araç paneli. Sürüklemenin yanında “öğeyi seç → hedefe dokun”, büyük yön düğmeleri ve otomatik hizalama. |

Telefon/tablet ana düzeninde yatay taşma veya sayfa kaydırması yoktur; yakınlaştırılmış tuvalin kontrollü kaydırılması editör yüzeyinin içindedir. Tek parmak öğeyi taşır, iki parmak görünümü değiştirir; görünümü değiştirmek etiketi değiştirmez. Telefon klavyesi ve Safari kısa görünür yüksekliği ayrıca kontrol edilir.

Tüm cihazlarda alt Geri/Ana ekran erişilir; seçili öğe rengi ve tutamaçlarla anlaşılır. Renk tek başına bilgi değildir: ikon, kısa ad ve şekil eşlik eder. Dokunma en az48px, ana işlem56px; kısa anlamlı sonuç bildirimi, sessiz tercihi ve hareket azaltma korunur. Her harekette ses/uzun açıklama yoktur.

Önce `docs/design/source` içinde ortak editör uzantısı ve üç görünüm hazırlanır; 390/1180/1440 genişlikte, tablet dikey/yatay ve kısa telefon yüksekliğinde gözle kontrol edilir. Ardından ortak `kalip/` bileşenlerine aktarılır. Bu planın kendisi tasarım kaynağı veya ekran kabulü değildir.

## 4. Sistem kullanıcıyı korur

- Barkodlar yetkili gerçek kayıttan gelir; şablon stok, fiş, lot veya paket kimliği üretmez/değiştirmez. Beş varil için beş mevcut kimlik, beş etiket; ürün barkodu paket QR yerine geçirilemez.
- Yeniden basım aynı kimliği kullanır; bir öğeyi veya şablonu kopyalamak yeni fiziksel paket oluşturmaz. QR içeriği tasarım ekranında serbestçe değiştirilemez.
- EAN13 yalnız geçerli mevcut kodla; eksik olana uydurma uluslararası numara verilmez. İç barkod QR/Code128 olabilir. GTİP barkod değildir. GS1/SSCC mevcut yetkili numara kaynağı doğrulanmadan açılmaz.
- QR sessiz bölgesi, minimum modül boyu, karşıtlık; barkod genişliği ve etiket dışına taşma basmadan önce doğrulanır. Dekoratif öğe kodun üstünü örtemez. Renkli logo olabilir; kod yüzeyi açık ve okunaklı kalır.
- Zorunlu izlenebilirlik alanı eksik/okunamazsa yayın veya ilgili baskı engellenir; kullanıcı sorunlu öğeye götürülür. Opsiyonel alan yoksa şablonda tanımlı “gizle/boş bırak” davranışı uygulanır, veri uydurulmaz.
- Tarih ve miktarlar sunucudan, izinli biçimlendirmeyle gelir; miktar metin/decimal doğruluğu korunur. Serbest SQL/JavaScript/HTML/formül çalıştırılmaz.
- Taslak değişiklikleri mevcut baskıyı etkilemez. Otomatik taslak kaydında durum görünür; ağ kesilince “kaydedildi” denmez ve yayın engellenir. Çakışan iki düzenleyici sürüm kontrolüyle korunur; sessiz son yazan kazanır yoktur.
- Kaydetme ve işlem varsayılanına atama açık bir son eylemdir. Taslak otomatik kaydı ≠ yayındaki şablonu değiştirme. Yarım işte ortak çıkış koruması; nesne silmede geri al vardır.

## 5. Veri, yetki ve güvenlik taslağı

Uygulama kartında kesinleşecek aday model (bu plan migration oluşturmaz/numara ayırmaz):
- `label_templates`: tenant, sabit UUID, ad, desteklenen kullanım yerleri, durum.
- `label_template_versions`: değişmez yayımlanan sürüm + sürümlü doğrulanmış JSON; mm koordinatlar, öğe türleri/bağları, baskı profili. Taslak için optimistic version; sayısal/öğe/boyut sınırları sunucuda.
- `label_template_assignments`: tenant + kullanım yeri başına tek varsayılan; yalnız uyumlu yayımlanmış sürüme atomik atama.
- `label_assets`: tenant'a ait logo, içerik özeti ve doğrulanmış boyut/biçim. İlk sürüm PNG/JPEG/WebP; dosya boyutu ve piksel limiti, yeniden kodlama, yön doğrulama. Ham SVG/HTML, dış URL'den içerik getirme yok.
- `label_print_jobs`: şablon sürümü, kaynak kayıt kimlikleri/sürümleri, kopya sayısı, isteyen kişi, yeniden baskı nedeni ve çıktı durumu. Gereken baskı snapshot'ı izinli alanlarla sınırlı; kişisel veri saklama/teslim politikası belirlenir.

Tenant bileşik ilişkiler, FORCE RLS ve transaction-local bağlam; tasarım yönetimi/yayın/atama/baskı ayrı katalog yetkileri, denetim kaydı, depo kapsamı ve ihtiyaç varsa MFA. Mevcut Yetkiler ekranı üzerinden atanır; izin sayısı/DB CHECK sınırı uygulama aşamasında birlikte denetlenir. Bir şablonu kullanabilmek, veri alanlarına erişim yetkisi kazandırmaz. Önizleme, çıktı ve logo erişimi sunucuda yeniden doğrulanır. Tenant export/takeout kapsamı şablon ve varlıkları içerir; ödeme durumuyla erişim kapatılamaz.

Yayımlanmış sürüm ve kullanılan varlık değişmez; sonraki logo/değişiklik yeni sürümdür. Kullanımdaki şablon arşivlenmeden alternatif varsayılan seçilir; geçmiş baskılar yetkili yeniden üretim için eski sürüme bağlı kalır. Tarihsel içeriğin yeniden basımı ile güncel veriden yeni baskı açıkça ayrılır. Etiket değiştirmek stok defterine yazmaz.

## 6. Baskı kapsamı ve dürüst durumlar

1. **İlk teslimin tam yolu:** ortak doğrulanmış tasarım → aynı geometri/veri ile önizleme, tarayıcı baskısı ve PDF; A4/rulo/özel mm, örnek test baskısı, yüzde100 ölçek/kenar kalibrasyonu. Logo ve QR dahil kaynak tek modeldir; PDF ayrı elle yazılmış tasarım değildir.
2. Yazıcıya OS/tarayıcı üzerinden ulaşılır. Her USB/ağ/Bluetooth yazıcının her telefonda doğrudan çalıştığı iddia edilmez. Tarayıcı, yazıcı seçimini ve sessiz otomatik baskıyı genel olarak uygulamaya bırakamaz. Cihaz tercihi öneri olarak saklanabilir; kuyruk kontrolü ayrı köprü işidir.
3. **Sonraki teslim:** mevcut ZPL yolu korunur; dinamik tasarımın desteklenen alanları DPI profiline göre üretilir. Logo/yazı/rotasyon destekleri doğrulanmadan “birebir” denmez. Desteklenmeyen öğede açık PDF/tarayıcı seçeneği vardır.
4. Yerel köprü/ham ağ baskısı ayrı ADR eki, güvenlik ve cihaz kabulüyle açılır. VPS'den müşterinin yerel ağına port açılması planlanmaz.
5. Baskı iletişim kutusunu açmak “etiket basıldı” kanıtı değildir. Hazırlandı/indirildi/baskı istendi/kullanıcı doğruladı/yazıcı doğruladı durumları ayrılır; fiziksel kabul gerektiği yerde mevcut stok durum geçişleri sahte başarıyla ilerletilmez.

## 7. Seri geliştirme ve bitiş ölçütleri

Her aşama başlamadan ayrı boş T numarasıyla kart, gerçek dosya kapsamı ve test planı oluşturulur. Aynı anda tek aşama; yalnız zorunlu bağımsız güvenlik incelemesi ayrı ajan olabilir.

| Sıra | Teslim | Tamam sayılması için |
|---|---|---|
| 1 | Kullanım akışı, ortak editör tasarım kaynağı ve dört hazır şablon | Üç cihaz görünümü, tek elle yerleştirme, büyük logo/uzun ad/raf etiketi örnekleri; kaynak görsel kontrolü |
| 2 | Sürümlü model, logo varlığı, yetki, kaydetme/yayın/atama | RLS/çapraz tenant, yetkisiz yayın, eşzamanlı edit, rollback/ret ve audit testleri; bağımsız güvenlik |
| 3 | Sürükle-bırak editörü ve aynı modelden baskı/PDF | Logo/metin/veri/kod araçları, geri al, dokunarak yerleştir, güvenli sınırlar; aynı geometri ve çözülebilir kod |
| 4 | Ürün, raf, giriş/paket ve çıkış/sevk akışlarına bağlama | Her bölüm doğru varsayılanı getirir, yetkili alternatif seçer; aynı QR ile yeniden basım; mevcut süreç regresyonları |
| 5 | Kullanıcı/cihaz kabulü ve kontrollü yayın | İlk kez kullanan kişi rehberle tasarımını kaydeder, bölüme atar, test basar ve gerçek kod okutulur; CI/main/deploy/DB/sağlık ayrı kanıtlanır |

İlk dört aşama ilk kullanılabilir editörün kapsamıdır; yalnız çizim ekranı “modül bitti” sayılmaz. ZPL/köprü genişlemesi bu yol tamamlandıktan sonra ayrı teslimdir.

## 8. Kabul senaryoları ve devir

- Hazır üründen başla; logo ekle, adı/QR'ı taşı, özel60×40mm kaydet; Ürün varsayılanı yap; yetkili başka cihazda aynı tasarım/veri/ebat açılır.
- Girişte beş farklı miktarlı varil için beş farklı mevcut QR, doğru lot/tarihler; yeniden basımda kimlik ve stok miktarı değişmez. Paket akışı kapalıysa bu özellik açık gibi gösterilmez.
- Raf etiketi, sevk etiketi ve ürün tasarımı birbirinin varsayılanını bozmaz. Yanlış kaynak alanı, yetkisiz cari ve eksik zorunlu tarih basılamaz.
- 390/1180/1440, telefon kısa yükseklik/klavye, tablet yatay/dikey; sürükleme, dokunarak yerleştirme, klavye, odak, koyu tema, hareket azaltma, erişilebilir adlar ve alt çubuk kontrolü.
- Uzun/Unicode metin, dar etiket, sınır dışı/geçersiz JSON, zararlı logo, katmanla örtülen QR, yetkisiz logo/şablon erişimi, ağ kesilmesi ve eşzamanlı taslak yayını.
- Renderer çıktılarından QR/Code128/EAN13 çözme; PDF gerçek sayfa ölçüsü ve logo yerleşimi. Epson/A4 ve seçilmiş termal/telefon için ayrı fiziksel cihaz kabulü; çözümleme testi cihaz başarısı değildir.
- Her iş kendi changes parçası + bu belgenin ilgili durumunu günceller. Push öncesi prepush, gitleaks, riskin istediği bağımsız inceleme; korunan dosya/ADR/migration için mevcut protokol. Gösterilmeyen test sonucu UNKNOWN.

Plan tesliminde yapılan: güncel kaynak ve B-166 karşılaştırması, kapsam/akış/kabul/devir dokümanı. Yapılmayan: ekran, migration, uygulama kodu, logo yükleme, baskı motoru, cihaz testi ve canlı yayın.

## 1 Kasım ek kullanıcı kararı — yetki ve şablon yazıcısı
- Modül görüntüleme, taslak düzenleme, yayın/varsayılan atama, baskı ve yazıcı tercih yönetimi ayrı sunucu yetkileridir; Yetkiler ekranında gruba atanır. Özel tasarım yetkisi olmayan saha personeli izinli hazır şablonu kullanabilir.
- Etkin tercih sırası: şablonun bu cihazdaki yazıcısı → şablonun firma yazıcısı → cihazın genel yazıcısı → firmanın genel yazıcısı → sistem yazdırma iletişim kutusu. “Genel tercihi kullan” açık seçenektir. Desteklenmeyen/çevrimdışı açık bir şablon tercihi sessizce başka yazıcıya gitmez.
- Tarayıcıdan fiziksel yazıcıları listeleme ve sessiz yönlendirme garanti edilmez. Köprü yokken kayıtlı tercih baskı profili/önerisidir; sistem iletişim kutusunda seçim gerekir. Gerçek otomatik rota yalnız yetkili ve yeteneği doğrulanmış köprüde açılır; arayüz bu ayrımı söyler.
- T-1146 ortak kaynak: docs/design/source/EtiketEditor.dc.html; örnek verili işlevsel tasarım, henüz backend yetki/kayıt/baskı değil.

### T-1147 sözleşme dilimi
- `@wms/domain/labels/editor`: DB/Next/yazıcı ağı içermeyen sürümlü geometri ve alan bağları, logoassetUUID, taslak/yayın ayrıdoğrulama. Integerµm baskıölçüsü; UIyakınlaştırması etiketi değiştirmez. QRkapalıalanı korunur; paketkimliği ürünbarkoduyla değiştirilemez, statiklotmetni zorunlu gerçeklotyerine geçmez.
- Yazıcı çözümü gerçek yetkili profile listesiyle çağrılır; tarayıcımodu her zaman sistemseçimigerekir der. Açıkça seçilmiş erişilemeyen/kapalı/yetkisiz yazıcı veya hazır olmayan köprüde blocked; genel tercihe sessiz geçiş yok.
- Yerel64birim/roottsc/hedefESLint geçti. Bağımsız inceleme/prepush/CI henüz bekliyor. Bu saf dilim kalıcı şablon, sunucu yetkisi veya gerçek baskı değildir; sonraki seri kart API/DB/izinleri kurar.

## T-1148…T-1150 kalıcı katman (geliştirme)
- 0072 yedi tenanttablosu: taslak/sürüm, PNGvarlık, yalnızsistemdiyaloğuyazıcıprofili, şablon/genelcihaz/firma tercihi, bağlamvarsayılanı, değişmezbaskısnapshotı. Uygulama rolü yayımlanansürüm/varlık/baskıyı güncelleyemez/silemez; snapshot hazırlama fizikselbaskıkanıtı değildir.
- 0073 + yetkikataloğu: labels.view/design/publish/print/printers; Yönetici tümü, özelgrupta ayrıaçılır. Yayın/yazıcıyönetimi MFA. Mevcut stock.view etiket yolu korunur, yeniözelleştirilmişmodüle yetki kendiliğinden verilmez.
- GeçiciDockerDB: yenişema6test ve öncekimigration4testi geçti; birimkatalog22test/roottsc geçti. Bağımsızsecurity/QA0/0/0 (15birim+6int); öncekimigrationregresyonu179test, AC04 383test ve verify5421birim geçti. Kapsam/tabanmetadata kaydı düzeltildikten sonra genelprepush tekrar koşuyor; CI/yayın bekliyor; henüz API/UI/baskıbağlantısı yok.

**PR284 kapsam düzeltmesi:** TamCI ORMtablo/sütuneşliği ve bakımsıfırlamaFKdöngüsü buldu. 0072geri-bağı başlangıçtaanında denetlenen ertelemeliFK oldu; Drizzle modelieklenecek, bakımbetiğideğişmez. Paket≤30dosya kalması için 0073yetkiler/T-1149 ayrı sonraki pakete alındı. Önceki0bulgu raporu sonSQLfarkını kapsamaz; yeniinceleme/testşart. Canlıda müşteri verisine sıfırlama uygulanmaz.
