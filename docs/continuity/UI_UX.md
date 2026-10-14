# Web, mobil ve tablet UI/UX

## Temel kullanıcı kuralı
İlk defa bilgisayar kullanan kişi bile sıradaki işi anlamalı. Müşteri sisteme hizmet etmez; sistem yanlış miktarı, yanlış yeri, mükerrer işlemi ve yetkisiz işi önleyerek müşteriye fayda sağlar. Bu bir hedef ve test kabulüdür; ekranın güzel olması hedefin ölçüldüğü anlamına gelmez.

- Marka Etkin WMS; Motive müşteridir. Eski ekranın kopyası veya sektör adına bağlı ürün tasarımı yapılmaz.
- Lacivert/turuncu ortak dil; satış sitesi aynı marka ailesinde. Kaynak token'lar `apps/web/app/globals.css`, ayrıntı `docs/design/palette.md`.
- Güncel kaynak renkleri: ink `#172e42`, accent `#c64a19`, surface `#ffffff`, bg `#f5f7f8`, accent-soft `#fff4ee`. Bunlar sabit yeni kopya üretme talimatı değil, kaynak snapshot'ıdır; bileşenler semantic token kullanır.
- Renk + ayırt edici ikon + kısa etiket birlikte. Renk tek başına hata, öncelik veya başarı anlamı taşımaz.
- Bir ekranda bir ana karar, belirgin sonraki adım. Az düz yazı; ikonların yanında 1–3 kelimelik işletme dili. Uzun teknik metin yalnız yardım ayrıntısında.
- Seçili ürün/depo/miktar ve işlemin sonucu kaydetmeden önce görünür. Hata ilgili alan yanında, şimdi yapılacak düzeltmeyle; boş durum açık başlangıç eylemiyle.
- Veri kaydetme başarılı sunucu sonucu olmadan “tamamlandı” gösterilmez. Tekrar tıklama/düşen bağlantı tekrar stok yazmamalı.

## Cihaz düzeni
| Yüzey | Davranış |
|---|---|
| Telefon | Dikey kısa akış, tek elle ana işlem; gerekliyse kart/liste; sayfa yatay taşmaz |
| Tablet / dokunmatik masaüstü | Büyük hedef, görünür etiket, hover gerektirmeyen işlem; yan panel yalnız yeterli alanda |
| Notebook / masaüstü | Özet + düzenli liste; arama/klavye desteği; çok sütun sadece okunabiliyorsa |
| Yatay telefon | Kaynak CSS: dar ekran veya coarse pointer + alçak ekran; cihaz adı/user-agent koklaması yok |

Kaynak kırılımı: <768px veya coarse-pointer/max-height500px telefon varyantı. Yeni breakpoint, bütün cihaz matrisiyle test edilir; sadece eski telefon resmiyle kabul yok. Eski “her şey kaydırmasız sığmalı” kabulü ile büyük hedef çatışıyorsa mevcut tasarım/spec ve kullanıcı kararı birlikte çözülür; küçük düğmeyle sessiz bypass yok.

## Etkileşim / erişilebilirlik
- Dokunma alanı ≥48px; ana eylem ≥56px. Yakınlaştırma engellenmez; klavye odak ve ekran okuyucu etiketleri korunur.
- Normal metin kontrastı ≥4.5:1, büyük metin/anlamlı ikon/girdi sınırı ≥3:1; kaynak kontrast testleri otorite.
- Native veya ortak `SelectField`: touch/klavye yerel seçici, fare tasarım listesi; label/hint bağlı, Escape/Enter/ok tuşları çalışır.
- Küçük ekranda form/panel kullanılabilir yüksekliği aşmaz; kaydet/iptal ulaşılır. Klavye açılınca alan ve hata görünür.
- İlk kullanım rehberi, tekrar açılabilen yardım. Yardım düğmesi kamera/form/sabit eylemi örtmez. Kaynak T-912 satır içi yerleşimi canlıda var varsayılmaz.
- MFA QR + elle anahtar alternatifi; OTP/MFA sırrı üçüncü taraf QR servisine gönderilmez, ekran görüntüsü/loga girmez.

## Donanım / kabul sınırı
Telefon/notebook kamerası için HTTPS, kullanıcı izni ve gerçek barkod senaryosu. Android el terminali için native uygulama baştan zorunlu kabul edilmez; kamera/klavye-wedge/PWA akışı cihazda denenir.

Etiket ölçüsü kullanıcı seçilebilir; yazıcı “her modelde doğrudan çalışır” diye ilan edilmez. İlk pilot tarayıcı/işletim sistemi yazdırma + PDF; ZPL/ağ/Bluetooth/USB özel protokol erişimi gerekiyorsa ölçülmüş ayrı köprü ve izin. Epson A4 test ile gerçek termal etiket kabulü farklı kanıttır.

Kabul matrisi: telefon Android/iOS, notebook kamera, tablet portrait/landscape, dokunmatik + klavye; giriş/arama/miktar/yanlış barkod/bağlantı hatası/ters kayıt; yazıcıda gerçek boyut ve okunabilir barkod. Test edilmediyse STATE'de UNKNOWN yaz.

## Canlı uygulamanın kolay ana ekranı (T-928)
- Varsayılan `view=flow` / kullanıcı etiketi “İşlemler”: Mal geldi (turuncu), Taşı (mavi), Üret (mor), Sevk et (yeşil). Telefon iki, masaüstü dört sütun; 48px hedef/56px ana eylem alt sınırı korunur.
- Kartlar VPS WMS'nin gerçek field/receive, stock/documents?new=TRANSFER, production, shipping sayfalarına gider. Sites localStorage/veri katmanı taşınmaz; QR özelliğinin tamamlandığı anlamına gelmez.
- Stok/ürün/depo/görev kısayolları kısa; ekip/ayar/denetim “Diğer işler” altında. Ayrıntılı TaskMenu `view=cockpit` / “Genel bakış”ta korunur; mevcut görsel tercih bu görünümü açabilir.
- Yetkisiz yazma kartı kilitli ve gerekçeli; hedef sayfa/eylem sunucuda yetkiyi ayrıca denetler. Bekleyen iş sayıları gerçek domain sorgularından gelir.
- Yeni Akış düzeni ve eski Kokpit geometrisi ayrı E2E sözleşmeleridir. Eski testler atlanmaz; Kokpit açıkça seçilerek korunur.

## İç ekran ve tek elle gezinme (T-929)
- Masaüstü (>=1200): geniş içerik alanı ve üst gezinme; tablet (768–1199): ayrı dokunmatik yerleşim, alt erişim alanı; telefon: tek sütun, alt geri/ana ekran ve ana işlem erişimi. Kısa yatay coarse-pointer ekran telefon davranışını korur.
- Geri tarayıcı geçmişine güvenmez: `id/new` detay veya formdan aynı bölümün listesine, derin sayfadan ebeveyne, bölüm kökünden ana ekrana gider. Dış siteye geri dönüş yok.
- Ortak görsel kabuk tüm iç tenant sayfalarını kapsar; ana ekran sözleşmesi korunur. Renk ve ikon işlemin yönünü destekler, metin/alan etiketi kaybolmaz.
- Saha işlem çubuğu ve form ana eylemi ortak alt alan yüksekliğini paylaşır. Safe-area boşluğu, içerik kaydırma sonu ve hata/son alan erişimi cihaz testinin parçasıdır. Birden çok sabit gezinme çubuğu üst üste çizilmez.
- Bu görev UI yerleşimidir; iş kuralı, kayıt idempotency, rol, miktar veya QR v3 değişikliği anlamına gelmez. Canlı sürüm doğrulaması PR ve receiver kanıtıyla yapılır.

## Fiziksel paket kabulü — yeni kullanıcı kararı / geliştirme hedefi
- Ürün barkodu ürünü seçer; paket QR'si fiziksel varil/koli kimliğidir, birbirinin yerine geçmez. 5 varil toplamına tek QR üretilmez.
- Kısa adımlar: Ürün → Paketler → Kontrol → Etiket. Eşit paket miktarı topluca girilebilir; farklı miktarlar paket kartlarında değiştirilir, toplam sistemce hesaplanır.
- Lot/üretim/SKT alanları ürün takibine göre görünür/zorunlu; sunucu ayrıca doğrular. Tarih hatası ve negatif/boş miktar kaydı engeller.
- Kaydet sonrası paket etiketleri açılır; yazdırma iptali stok kaydını tekrarlamaz. Yeniden baskı aynı paket QR'sini korur. Tarayıcı baskı penceresinin açılması fiziksel baskı başarısı sayılmaz.
- Transfer/tüketim paket okutmayla yönlendirilir; kalan miktar görünür. Eski kimliksiz stok kendiliğinden varillere bölünmez.
- T-931 hedefi henüz canlı özellik değildir; gerçek durum STATE'dedir.

## Excel / fiş / ERP deneyimi — ek hedef
- Önizleme ikon+renk+1–3 kelimeyle: Hazır / Tamamlandı / Düzelt. Hücre hatası bir dokunuşla açılır; çözülemeyen satır sessiz atlanmaz. Kullanıcıya uzun teknik rapor okutulmaz.
- İçe aktarma sonucu ürün sayısı, otomatik eklenen barkodlar ve etiket hazır paketler ayrı özetlenir. “Basılmaya hazır” fiziksel baskı başarı bildirimi değildir.
- Masaüstü fiş başlık/satır düzenleme; telefon/tablet aynı yetki ve sürüm denetimiyle kısa görsel akış. Ana eylem rol/durum bağımlıdır; renk tek güvenlik kontrolü değildir.
- Taslak gri/kalem, kesinleşmiş yeşil/onay, geri alınmış kırmızı/geri ok, ERP durum mavi/aktarım; renk+ikon+kısa ad beraber. Riskli geri almada paket adedi ve miktar görünür; mükerrer dokunma tek etkidir.
- Yanlış QR, başka depo, SKT/kalite uyarısı, eşzamanlı değişiklik, yazıcı iptali ve ERP hatasında “Şimdi ne yapmalı?” tek kısa eylem gösterilir.

## T936 geliştirme akışı
- Controlled arama ve kabul girdileri SSR'de istemci hazır olmadan etkin görünmez; erken dokunma/yazı kaybını sistem önler. Rastgele bekleme süresi eklemek veya test seçicisini değiştirerek kaybı gizlemek çözüm değildir.
- `/t/[slug]/receipts/packages?document=<uuid>` kısa ürün→paketler→kontrol→etiket akışıdır; server `PACKAGE_RECEIVING_ENABLED === "true"` ve rol kontrolleriyle kapalı başlar. Normal Mal geldi hedefi korunur.
- Mevcut `ScreenShell`, `FormSteps`, scanner/kamera ve 56px/48px saha düğmeleri tekrar kullanılır. Lokal desktop özet/listesi, tablet özet üstte, telefon/alçak coarse-pointer tek sütun; ikinci sabit alt bar eklenmez. Gerçek cihaz ölçümü hâlâ paket kabulünde doğrulanmalıdır.
- Belirsiz gönderimden sonra içerik kilitli; ilk kesin prepare doğrulama/yetki reddi düzeltmeye izin verir, önceden belirsiz outcome varsa kilit korunur; prepare yanıtı URL'yi belge kimliğiyle korur; retry aynı taslak ve ayrı sabit komut anahtarlarını kullanır. Draft edit/cancel yok. Sayfa kapanırken cevabı alınmamış prepare için otomatik kurtarma yok.
- T937 etiket bağlantısı yalnız gerçek POSTED sonucu: `/t/[slug]/receipts/packages/labels?document=<uuid>`. Metadata `PackageReceiptDto.packages` (server QR/id, sıra, ürün, quantity/unitCode, lotCode/producedOn/expiresOn); miktar kabul anına aittir. T936 label route veya baskı gerçekleştirmez.
- Scoped UI/action testleri67 PASS, skip0; scoped lint ve web typecheck PASS. Yayın/pilot/gerçek baskı başarı kanıtı değildir.

## T951–955 tekilQR kalite / yerleştirme
- `/t/[slug]/field/packages?package=<uuid>` aynı fiziksel QR için gerçek currentbalance/konum/durum gösterir; origin lot/üretim/SKT ayrı korunur. İlk dilim tam paket kalite onayı ve aynıdepo STORAGE yerleştirmedir; transfer/üretim tamamlandı sayılmaz.
- Akış: Paket okut → sunucunun izin verdiği tek işlem → gerekirse yer okut → sunucu sonucu. Ürün/palet barkodu paket yerine kabul edilmez; miktarı kullanıcı tekrar girmez.
- Hydration öncesi girdiler kapalı; belirsiz yazma aynı içerik/anahtarla tekrar edilir. POSTED cevabı sonrası okuma hatasında yazma tekrarlanmaz; yeni işlem taze currentstate yüklenene kadar kapalı.
- Yeni gerçek tarayıcı4/4PASS: kayıp cevap/tek etki/aynıQR/diğer800KG, dört viewport,56pxana/geri ve48pxsonalan/odak. Kamera/Epson fiziksel kabulü UNKNOWN; serverflag ve canlı kaynak durumu STATE'dedir.
