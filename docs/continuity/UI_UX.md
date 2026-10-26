# Web, mobil ve tablet UI/UX

- T-1012: Eski kök üst çubuğu (`.app-header`: Kolay mod · İşlemler/Genel bakış · Nasıl kullanırım? · Yardım) kök yerleşimde YOK; yalnız karşılama sayfası `/` (`welcome-header.tsx`, yalnız demo/kayıt açık ortam) çizer. Ekran ekran `body:has(.x) .app-header` gizleme kuralları silindi; yeni ekran bu kuralı eklemez (bekçi `apps/web/app/eski-kabuk.test.ts`). Kiracı ekranlarındaki iç bağlantılar `next/link` (istemci içi geçiş); oturum/parola (`/login?reauth`, `/mfa`, `/reset-password`), dış bağlantı, indirmeler ve hata ekranının Ana ekran bağlantısı tam sayfa kalır. Çıkış koruması belge yakalama evresinde çalıştığından Link ile de tetiklenir. Eski ilk rehber kendiliğinden yalnız karşılama sayfasında `/` açılır (Destek > Rehberi aç elle açar). e2e `tests/e2e/eski-cubuk.spec.ts`.
- T-1011: Görevlerim kartında ürün adı/kodu, görev türü/durum ve depo/raf bilgisi ortak `kalip/gorev-karti.tsx` ile gösterilir. Ayırt edici satırlar telefonda gizlenen `.um` içine konmaz. Ürün/rafı olmayan görevde bilgi uydurulmaz; liste adları mevcut tenant transaction'ı ve depo kapsamı içinde gelir. Salt okuma değişikliğidir; Üstlen/Başla komutları aynıdır.
- T-1010: ortak seçim/önizleme renkleri `kalip/tokens.ts` içindeki `kdzOrtak` ile çözülür. CSS renk belirteci kalıp kapsamında yoksa yalnız doğrulanmış tasarım kaynağındaki renk yedek olarak kullanılır (Yeni ürün / Hammadde: #8A5A12); mevcut açık/koyu tema belirteci önceliklidir. Üretilmiş CSS elle değiştirilmez.

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
- Dokunma alanı ≥48px; ana eylem ≥56px. Yakınlaştırma engellenmez; klavye odak ve ekran okuyucu etiketleri korunur. Odak işareti tek ortak kuraldır (`design/kural.css` madde 11, T-1033): öğenin köşesini izleyen lacivert/koyu temada sarı halka, yazı alanında alan kutusunda; ekran CSS'inde ayrı odak çerçevesi yazılmaz.
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
- Stok/ürün/depo/görev kısayolları kısa; ekip/ayar/denetim “Diğer işler” altında. Ayrıntılı iş listesi `view=cockpit` / “Genel bakış”ta (T-979: `kokpit.tsx`, liste kalıbı); mevcut görsel tercih bu görünümü açabilir.
- Yetkisiz yazma kartı kilitli ve gerekçeli; hedef sayfa/eylem sunucuda yetkiyi ayrıca denetler. Bekleyen iş sayıları gerçek domain sorgularından gelir.
- T-979: eski Kokpit ızgarası (`task-menu.tsx`, `more-sheet.tsx`) ve geometri e2e sözleşmesi kaldırıldı; Kokpit e2e'si liste kalıbı kartlarını (etkin/kilitli/yakında, `now-*`, `my-tasks-*`) denetler.

## İç ekran ve tek elle gezinme (T-929)
- Masaüstü (>=1200): geniş içerik alanı ve üst gezinme; tablet (768–1199): ayrı dokunmatik yerleşim, alt erişim alanı; telefon: tek sütun, alt geri/ana ekran ve ana işlem erişimi. Kısa yatay coarse-pointer ekran telefon davranışını korur.
- Geri tarayıcı geçmişine güvenmez: `id/new` detay veya formdan aynı bölümün listesine, derin sayfadan ebeveyne, bölüm kökünden ana ekrana gider. Dış siteye geri dönüş yok.
- Ortak görsel kabuk tüm iç tenant sayfalarını kapsar; ana ekran sözleşmesi korunur. Renk ve ikon işlemin yönünü destekler, metin/alan etiketi kaybolmaz.
- Saha işlem çubuğu ve form ana eylemi ortak alt alan yüksekliğini paylaşır. Safe-area boşluğu, içerik kaydırma sonu ve hata/son alan erişimi cihaz testinin parçasıdır. Birden çok sabit gezinme çubuğu üst üste çizilmez.
- Bu görev UI yerleşimidir; iş kuralı, kayıt idempotency, rol, miktar veya QR v3 değişikliği anlamına gelmez. Canlı sürüm doğrulaması PR ve receiver kanıtıyla yapılır.

## Ekran kalıpları (T-968, B-63)
- Eski ekranlar tuvaldeki 4 kalıpla geçer: Liste (`KalipListe`), Form (`KalipForm`), Detay (`KalipDetay`), Saha (`KalipSaha`, yalnız telefon). Ortak bileşenler `apps/web/app/t/[slug]/kalip/`: `KalipEkran` (üst çubuk + sağ üst `actions` yuvası + ortak alt cam çubuk `bar`), `liste.tsx` (KalipAra, KalipCipler, KalipKartListe/KalipKart, KalipBos, KalipKurulum, KalipDaha), `form.tsx` (KalipKilit, KalipIzgara, KalipGrup, KalipSatir, KalipAnahtar, KalipSabit, KalipSecenek, KalipAlan, KalipPerde, KalipCikisUyarisi, useLeaveGuard), `detay.tsx` (KalipDetayIzgara, KalipHero, KalipHizli, KalipKartBolum, KalipNerede, KalipMinimum, KalipZaman, KalipTumu).
- Kalıp kabı kullanmayan tam kaynak ekranlar (Ekip, Gruplar, Aktar) sağ üst Sorun bildir + Destek + Hesap'ı `t/[slug]/ust-dugmeler.tsx` (`UstDugmeler`) ile çizer (T-986b). Katılma QR'ı paylaşma satırı ve PAYLAŞ ana işlemi ortak `members/join-share.tsx` (`JoinShareRow`, `useJoinShare`; kaynak `Paylas.dc.html`, tuval onayı bekliyor).
- Kalıbı kullanan ekranda eski kabuk süslemeleri kendiliğinden gizlenir (`design/kalip-frame.css`, kök `.kalip`); ekranın ayrıca bir şey yapması gerekmez. Satır içi renk o kalıbın kaynağında geçen renk olmalı (`kdz(scope, hex)` kaynakta yoksa hata verir).
- Kullanıcı kararı 20 Ekim: görüntü karşılaştırması ve ekran başı e2e zorunlu değil; CI yeşil + kaynak birebir.
- T-972 (grup 2): stok / belgeler / sevk / üretim listeleri ortak bölüm çiplerini (`stock/belge-kalip.ts`) ve yeni belge formları `stock/form-ekran.tsx` kabını kullanır (alt çubuk ana işlemi ekrandaki `form.workflow-form`u gönderir). İç düğmeli kart (kabul teslimi) bağlantı değil `.uc` görünümlü liste öğesidir.
- Kalıpta olan ekranlar (T-968 + T-971): Ayarlar, Ürünler, ürün kartı, Depolar, depo/lokasyon ağacı (detay), Cariler (liste + tam ekran form), Üyeler, Saha personeli (form), Cihazlar, Ekibe katılma, Kim ne yaptı? (denetim), Görevler, Etiket yazdır. Kart üzerinde ikincil eylem varsa kart `<div role="listitem">` sarmalayıcıdır; içinde kart bağlantısı/düğmesi (`KalipKart role={null}`) + altında `.btn` eylem satırı (bağlantı içine düğme gömülmez). Pencereler T-974'ten beri tek kalıp penceresi `kalip/pencere.tsx` (`KalipPencere`, `KalipOnay`; `Sheet` bunu sarar): yerel `<dialog>`, telefonda alt cam sayfa, masaüstünde ortada; yeni pencere bunu kullanır, `@wms/ui` ConfirmDialog kalıp ekranında kullanılmaz. Hesap ekranları (yardım, davet, sıfırlama, sihirbaz) `giris-ui.tsx` ile giriş dilinde.
- T-981b: `KalipEkran` `excel={{ kind }}` üst çubuğa Excel düğmesi + buzlu menü ekler (`kalip/excel.tsx`; gösterim yetkisi kiracı bağlamı `excel.data/master`, karar sunucuda); indirme ortak `excelIndir` (aynı site fetch → .xlsx, hata/yeniden giriş balonu). Ekran içi sekme şeridi ve büyük ikonlu seçim kutuları `kalip/secim.tsx` (`KalipSekme` — kaydedilmemiş işte `onGo` ile ekranın uyarısı; `KalipSecimKutulari` — kilitli seçenek ses + gerekçe balonu). Ayarlar › Bağlantılar `settings/baglantilar/`.
- T-978: kalıp ekranında okutma paneli/alanı `ScanPanel variant="kalip"` ve `@wms/ui` `ScanField variant="kalip"` (`.kscanp`/`.kscan*`, kalip-frame.css; koyu tema kabın `dz-dark` sınıfından); varsayılan görünüm eski ekranlar için. Liste araması `KalipAra` GET `q` + sunucu süzgeci (Depolar, Üyeler, Görevler, Görevlerim, Kim ne yaptı?); çip/süzgeç değerleri aramada gizli alanla korunur.
- T-979 (B-94/B-95): eski kiracı kabuğu (telefon üst çubuğu `AppBar`, masaüstü `tenant-bar`, `ScreenShell`, `BottomNav`) kaldırıldı; `layout.tsx` yalnız uygulama menüsünü (`app-menu.tsx`, Hesap menüsü "Tüm ekranlar") ve içeriği çizer. Kalıp kabının içinde kalan eski Tailwind parçaları (Banner, eski alanlar) kalıp belirteçleriyle çizilir: `kalip-frame.css` uygulama belirteçlerini (`--color-surface`, `--color-ink`, durum renkleri…) kap içinde kalıbın üretilmiş belirteçlerine bağlar, koyu temada `dz-dark` karşılıklarına. Kiracı hata/askı ekranları giriş dilinde (`giris-ui.tsx`).
- T-979b: üst çubuk düğmeleri (kalıp `.helpb`, Pano `.tb`) telefonda 48 px — kaynakta düzeltilir, `port.mjs` ile üretilir.
- T-979c: "Tüm ekranlar" penceresi yok. Görünüm geçişi Modüller'de (`kabukModules(base, member, view)` → `kokpit` / `akis`, `switchView`); hesap işleri ekranın Hesap menüsünde (Kullanıcı / Çalışma alanı değiştir, tema, Çıkış) ya da Görevlerim ⚠ kutusunda. Alt çubuk orta etiketi `capOf` (≤ 10 karakter), çubuğun içinde; e2e `expectCenterCapInside` (kabuk-checks).

## Fiziksel paket kabulü — yeni kullanıcı kararı / geliştirme hedefi
- Ürün barkodu ürünü seçer; paket QR'si fiziksel varil/koli kimliğidir, birbirinin yerine geçmez. 5 varil toplamına tek QR üretilmez.
- Kısa adımlar: Ürün → Paketler → Kontrol → Etiket. Eşit paket miktarı topluca girilebilir; farklı miktarlar paket kartlarında değiştirilir, toplam sistemce hesaplanır.
- Lot/üretim/SKT alanları ürün takibine göre görünür/zorunlu; sunucu ayrıca doğrular. Tarih hatası ve negatif/boş miktar kaydı engeller.
- Kaydet sonrası paket etiketleri açılır; yazdırma iptali stok kaydını tekrarlamaz. Yeniden baskı aynı paket QR'sini korur. Tarayıcı baskı penceresinin açılması fiziksel baskı başarısı sayılmaz.
- Transfer/tüketim paket okutmayla yönlendirilir; kalan miktar görünür. Eski kimliksiz stok kendiliğinden varillere bölünmez.
- T-931 hedefi henüz canlı özellik değildir; gerçek durum STATE'dedir.

- T-1040: arşivli kayıt normal listede görünmez (yalnız "Arşivli" süzgecinde: ürün `?status=ARCHIVED`, cari ve depo `?arsiv=1`, raf ağacında "Arşivli rafları göster"); arşivli kaydın ekranında işlem kısa yolu çizilmez.
- T-1037 ekran standardı (bekçi `design/kural-standart.test.ts`): form kabında TEK ana işlem (formun `.workflow-primary` düğmesi gizli, alt çubuk çağırır; yeni form ekranı `FormEkran` + `.workflow-form` + bir `.workflow-primary` yeter); form alanları `KalipAlan` / `Typeahead variant="kalip"`; uzun adlar kesilmez; tarih gösterimi `kalip/format.ts` `fmtGun`; liste üstüne "yeni X" kesik düğmesi konmaz — YENİ ana işlemi gerekirse tür seçimine (`KalipSecimKutulari`) gider.

## Excel / fiş / ERP deneyimi — ek hedef
- Önizleme ikon+renk+1–3 kelimeyle: Hazır / Tamamlandı / Düzelt. Hücre hatası bir dokunuşla açılır; çözülemeyen satır sessiz atlanmaz. Kullanıcıya uzun teknik rapor okutulmaz.
- İçe aktarma sonucu ürün sayısı, otomatik eklenen barkodlar ve etiket hazır paketler ayrı özetlenir. “Basılmaya hazır” fiziksel baskı başarı bildirimi değildir.
- Excel okuma (`lib/sheet/read.ts`, T-1035): öğeler ad alanı önekinden bağımsız okunur (ERP/.NET çıktıları `<x:row>`), tarih biçimli hücre "GG.AA.YYYY" olur. Sütun eşleştirme (`lib/sheet/mapping.ts`): benzer başlık yalnız tam kelimeyle ya da eş anlamlının ilk kelimesiyle ("Miktar" koli içi adet DEĞİLDİR); isteğe bağlı tam sayı alanı içerikten tahmin edilmez. Birim eş adları (Ad., adt, PCS, Kilo, Mt) `domain/catalog/unit-alias.ts`. Yeni ERP başlığı eklemek: `FIELDS` eş anlamlıları + `mapping.test.ts` örneği.
- Masaüstü fiş başlık/satır düzenleme; telefon/tablet aynı yetki ve sürüm denetimiyle kısa görsel akış. Ana eylem rol/durum bağımlıdır; renk tek güvenlik kontrolü değildir.
- Taslak gri/kalem, kesinleşmiş yeşil/onay, geri alınmış kırmızı/geri ok, ERP durum mavi/aktarım; renk+ikon+kısa ad beraber. Riskli geri almada paket adedi ve miktar görünür; mükerrer dokunma tek etkidir.
- Yanlış QR, başka depo, SKT/kalite uyarısı, eşzamanlı değişiklik, yazıcı iptali ve ERP hatasında “Şimdi ne yapmalı?” tek kısa eylem gösterilir.

## T936 geliştirme akışı
- Controlled arama ve kabul girdileri SSR'de istemci hazır olmadan etkin görünmez; erken dokunma/yazı kaybını sistem önler. Rastgele bekleme süresi eklemek veya test seçicisini değiştirerek kaybı gizlemek çözüm değildir.
- `/t/[slug]/receipts/packages?document=<uuid>` kısa ürün→paketler→kontrol→etiket akışıdır; server `PACKAGE_RECEIVING_ENABLED === "true"` ve rol kontrolleriyle kapalı başlar. Normal Mal geldi hedefi korunur.
- Mevcut `KalipAdimlar` (eski FormSteps), scanner/kamera ve 56px/48px saha düğmeleri tekrar kullanılır. Lokal desktop özet/listesi, tablet özet üstte, telefon/alçak coarse-pointer tek sütun; ikinci sabit alt bar eklenmez. Gerçek cihaz ölçümü hâlâ paket kabulünde doğrulanmalıdır.
- Belirsiz gönderimden sonra içerik kilitli; ilk kesin prepare doğrulama/yetki reddi düzeltmeye izin verir, önceden belirsiz outcome varsa kilit korunur; prepare yanıtı URL'yi belge kimliğiyle korur; retry aynı taslak ve ayrı sabit komut anahtarlarını kullanır. Draft edit/cancel yok. Sayfa kapanırken cevabı alınmamış prepare için otomatik kurtarma yok.
- T937 etiket bağlantısı yalnız gerçek POSTED sonucu: `/t/[slug]/receipts/packages/labels?document=<uuid>`. Metadata `PackageReceiptDto.packages` (server QR/id, sıra, ürün, quantity/unitCode, lotCode/producedOn/expiresOn); miktar kabul anına aittir. T936 label route veya baskı gerçekleştirmez.
- Scoped UI/action testleri67 PASS, skip0; scoped lint ve web typecheck PASS. Yayın/pilot/gerçek baskı başarı kanıtı değildir.

## T951–955 tekilQR kalite / yerleştirme
- `/t/[slug]/field/packages?package=<uuid>` aynı fiziksel QR için gerçek currentbalance/konum/durum gösterir; origin lot/üretim/SKT ayrı korunur. İlk dilim tam paket kalite onayı ve aynıdepo STORAGE yerleştirmedir; transfer/üretim tamamlandı sayılmaz.
- Akış: Paket okut → sunucunun izin verdiği tek işlem → gerekirse yer okut → sunucu sonucu. Ürün/palet barkodu paket yerine kabul edilmez; miktarı kullanıcı tekrar girmez.
- Hydration öncesi girdiler kapalı; belirsiz yazma aynı içerik/anahtarla tekrar edilir. POSTED cevabı sonrası okuma hatasında yazma tekrarlanmaz; yeni işlem taze currentstate yüklenene kadar kapalı.
- Yeni gerçek tarayıcı4/4PASS: kayıp cevap/tek etki/aynıQR/diğer800KG, dört viewport,56pxana/geri ve48pxsonalan/odak. Kamera/Epson fiziksel kabulü UNKNOWN; serverflag ve canlı kaynak durumu STATE'dedir.

## QR depo transferi (T949)
- SameQR → hedefdepo → konum okut/seç → sunucu miktarı ve iki depo görselkontrolü → POSTED sonuç. Tüm seçim sayfaları yüklenir; tek el48px kontrol/56px anaeylem/geri/anaekran.
- Kayıp cevap aynıkey/payload; başarılı kayıt sonrası readhatası ikinci yazma yaratmaz, sonraki işlem freshstate olmadan kapalı. Gerçek desktop/mobile4PASS dörtviewport, sameQR/lot/tarihler/diğer800KG ve A→B→A; fizikselkamera/yazıcıUNKNOWN. CI/yayın/flag ayrı.

- **Entegrasyon (`/t/<alan>/integrations`, T-991):** form kalıbı + `Entegrasyon.dc.html` "YENİ" bölümü (`.dzen`, iç sarmalayıcı `display: contents`).
  Bağlan penceresi KalipPencere, Kes onayı KalipOnay; akış = KalipAnahtar + KalipSecenek (yön). Ana düğme BAĞLAN / EŞİTLE hiçbir durumda sessiz
  değil. Ayarlar > Bağlantılar (T-981) kartı bu adrese bağlanacak.
## Arayüz dili (T-999c)
- Görünür metin yalnız `apps/web/messages/{tr,en}.json`; JSX'e sabit metin yazılmaz. İki dosyanın anahtar kümesi, tek dilde boş metin ve `{yer tutucu}` adları `apps/web/messages/messages.test.ts` ile bekçide.
- Dil sırası (`apps/web/i18n/request.ts`): `locale` çerezi (cihaz tercihi; bugün yazan yok) → tenant sayfalarında Ayarlar > Dil (`tenant_settings.locale`, her üye okur) → tarayıcı dili → `tr`. Tenant dışı sayfalar tarayıcı dilindedir (B-105).
## İlk kurulum yolculuğu (T-1006)
- Asıl deneyim spotlight tur (`t/[slug]/yolculuk/yolculuk.tsx` `YolculukKatman`, kiracı düzeninde yalnız hesap sahibi/yönetici): hedefler `data-tour="…"` (KabukBar ana işlemi `main`, Ürünler Excel `excel` + menüsü `data-tour-follow`, Entegrasyon `opening-pull`); adım planı `steps.ts` `stepPlan`/`stopFor`; delik `KalipPerdeKatman delik`; tur durumu sunucuda `tour_state`, seçili adım oturumda. Tamamlanma gerçek veriden (domain `onboarding/journey.ts`). Pano küçük halka → adım listesi; Destek › Rehberi aç → tur (iptal edilebilir `etkinwms:yolculuk-open`). E2E giriş yardımcısı `closeSetupTour` turu kapatır. T-1036: ipucu kartında bütün adımların şeridi (`.ysteps`, `yol-strip`: biten yeşil tik, şimdiki sarı, kalan numara, atlanan kesik); kart sayısı "ADIM n/N" kısa turda da bütün (atlanmamış) adımlardan; adım bitince ya da sona gelince sıradaki = geride kalan ilk açık adım (`steps.ts` `firstOpen`); kısa tur yalnız kart/depo/stok üçü de bitince kapanır.

### Panel güncelliği (T-1027)
PanelShell görünür ve çevrimiçi sekmede 5 saniyede bir sunucu bileşenlerini yeniden okur; odak/bağlantı dönüşünde hemen okur. Form durumu korunur; liste ve menü sayaçları birlikte güncellenir. Yeni endpoint veya yetki değişikliği yoktur. Tam sayfa yenilemesi veya SSE değildir.

## İki adımlı doğrulama kurulumu (T-1034)
Aktivasyon 4. adımı ve `/mfa` tek bileşen kullanır: `apps/web/app/totp-sihirbaz.tsx` (uygulamayı kur → hesabı ekle → kod → yedek kodlar). Yeni kurulum yüzeyi eklenirse bu bileşen kullanılır; QR/anahtar/yedek kod ayrı ekranda yeniden yazılmaz. Yedek kod adımında "Kaydettim" işaretlenmeden çıkış ortak `useCikisKorumasi` kutusuyla sorulur.
