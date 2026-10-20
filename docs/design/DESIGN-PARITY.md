# Tasarım birebir standardı (I-18)

**Kullanıcı kararı (15 Ekim 2026):** "Yaptığın tasarım birebir uygulamada olmalı, her şeyiyle; bunu standart kural haline getir: tasarım, yerleşim, renk, font, her anlamda."

Bu belge `docs/INVARIANTS.md` **I-18**'in uygulama kılavuzudur. Üreteç (`scripts/design/port.mjs`), bekçi (`design-parity.test.ts`) ve kaynak klasörü (`docs/design/source/`) T-988 ile gelir.

**Öncelik:** I-18 yetki, depo kapsamı, tenant yalıtımı ve audit kararlarını (I-01, I-12, A-46) geçersiz kılmaz. Rolün göremeyeceği alan gösterilmez ya da 0 gösterilir; yetkisiz eylem çizilmez ya da tıklanmaz hâlde gösterilir. Çıkış ve menü her ekranda erişilebilir kalır. Kullanıcıya görünen her ekran için geçerlidir; Kokpit/yönetim ekranları da tasarımı geldiğinde bu kurala girer.

## 1. Kaynak

- Tasarımın tek doğru kaynağı Claude Design tuvalindeki dosyanın **tam metnidir**; depoda `docs/design/source/<Ad>.dc.html` olarak durur.
- `docs/design/source/SOURCE.md` her dosya için tuval adresini, sürümünü ve sha256 özetini tutar. Ekran görüntüsü, ezber veya "benzeri" kaynak değildir.
- Tasarım değişirse sıra şudur: önce kaynak yenilenir (dosya + SOURCE.md), sonra üreteç çalışır, en son ekran güncellenir.

## 2. Birebir ne demek

Aşağıdakilerin hepsi kaynakla aynıdır:

| Alan | Kural |
|---|---|
| Yerleşim | Izgara, sütun sayısı, öğe sırası, boşluk (`gap`, `padding`, `margin`), hizalama |
| Kırılım | Kaynaktaki `detect()`: mobil `< 700 px`; tablet `700–1099 px` veya dokunmatik (`pointer: coarse`); masaüstü `≥ 1100 px` ve ince işaretçi |
| Yazı tipi | Aile (Bricolage Grotesque / Instrument Sans / IBM Plex Mono), ağırlık, boyut, satır yüksekliği, harf aralığı, `tabular-nums` |
| Renk | Zemin, yazı, bölüm tonları, açık **ve** koyu tema, gölgeler, saydamlıklar |
| Biçim | Köşe yarıçapı, kenarlık kalınlığı, gölge, ikon kutusu ölçüsü |
| İkon | SVG `path` verisi, boyut ve `stroke-width` aynen (kütüphaneden "benzer" ikon kullanılmaz) |
| Metin | Kelime, büyük/küçük harf, ayraçlar (`·`, `/`), birimler |
| Hareket | Animasyon adı, süre, eğri, gecikme; `prefers-reduced-motion` davranışı |
| Davranış | Dokununca hangi ekranın açıldığı, alt başparmak çubuğu, geri / geri al, uyarı ekranları |

## 3. Nasıl uygulanır (elle yeniden yazmak yasak)

1. **CSS üreteçle türetilir:** `node scripts/design/port.mjs` kaynaktaki `<style>` bloğunu okur ve şunları üretir:
   - `apps/web/app/design/<ad>.css`: kurallar kaynak sırasıyla, `.dz` kabına kapsanmış hâliyle; `.m-mobile/.m-tablet/.m-desktop` kuralları §2'deki kırılım medya sorgularına çevrilir.
   - `globals.css` içindeki `/* design:<ad> */` bloğu: renk belirteçleri (`--color-dz-*`), açık ve koyu tema.

   Üretilen dosyalar elle düzenlenmez. `apps/web/app/design-parity.test.ts`, kaynaktan yeniden üretip depodakiyle karşılaştırır; tek bayt fark testi kırar.
2. **İşaretleme kaynakla aynıdır:** Sınıf adları, öğe sırası, ikon yolları ve metinler kaynaktaki `<x-dc>` gövdesinden aktarılır. Yalnızca `{{…}}` bağları gerçek veriye bağlanır (§4).
3. **Renk sabiti yazılmaz:** Satır içi stillerde tasarımın `{{c.*}}` ve bölüm paletleri `var(--color-dz-*)` olarak kullanılır. Böylece `theme-contrast.test.ts` belirteç dışı renk yasağı da korunur.

## 4. Veri bağları

- Tasarımdaki her sayı, ad ve durum gerçek veriye bağlanır. Örnekler: `{{tot.leftO}}`, `{{se.o}}`, vardiya, depo adı, ACİL rozeti, SORUN sayısı.
- **Karşılığı olmayan alan gizlenmez ve uydurulmaz.** Altyapısı (tablo, komut, okuma) aynı iş kapsamında kurulur. Veri sıfırsa tasarımın kendi sıfır veya boş durumu gösterilir.
- Selam satırı veridir: saate göre Günaydın / İyi günler / İyi akşamlar, adı oturumdaki kullanıcının ilk adı. İş bitince kaynaktaki "Harika, X! Gün tamam" gösterilir.

## 5. Uygulamaya girmeyen tasarım aracı parçaları

| Parça | Neden |
|---|---|
| `ÖNİZLEME` çubuğu (Otomatik / Masaüstü / Tablet / Mobil), Giris'teki `EKRAN` çubuğu ve cihaz çerçevesi (`.fr-mobile`, `.fr-tablet`) | Tasarım aracının önizleme kontrolüdür, ürünün parçası değildir |
| Kamera ekranındaki `OKUNDU · DEMO` düğmesi ve benzetimli görüntü | Gerçek kamera ve okuyucu kullanılır |
| Demo örnekleri menüsünün **içeriği** ("Şef yeni görev atasın", "Yanlış ürün okutuldu", "Bağlantı kopsun") | Benzetim içindir. Aynı açılır kutu (`.demo` / `.dm`) görünümüyle gerçek işlevler gelir; bkz. §6 |

## 6. Uyarlamalar (görünüm aynı, işlev gerçek)

| Tasarım | Uygulama | Onay |
|---|---|---|
| Sarı ⚠ düğmesi → "Demo örnekleri" açılır kutusu | Aynı düğme ve aynı açılır kutu; öğeler: **Sorun bildir**, **Nasıl kullanılır?**, **Menü** (çalışma alanı, görünüm, çıkış). Uygulama menüsünün ve çıkışın başka yeri yoktur | 15 Ekim 2026 kullanıcı kararı "altyapısını da kur" (Sorun) + menünün erişilebilir kalması zorunluluğu |
| Bağlantı noktası düğmesi (tasarımda benzetim için açar/kapatır) | Tarayıcının gerçek çevrimiçi durumunu gösterir; tıklanınca durumu söyler | — |
| `v.mfa` kartında yalnız kod alanı ve "Yedek kod kullan" bağlantısı | Kod alanının altına "Bu cihazı 30 gün hatırla" onay kutusu eklendi (aynı kaynağın `v.login` "Bu cihazda e-postamı hatırla" `.chk` öğesi birebir; varsayılan kapalı). Tasarım kaynağına henüz işlenmedi; ekran görüntüsü karşılaştırması T-923'te alınmadı | 20 Ekim 2026 kullanıcı (ürün sahibi) kararı: "Bu cihazı 30 gün hatırla" — yönetici her girişte Google Authenticator kodu girmesin (T-923) |

Bu tablo dışındaki her sapma için kullanıcının yazılı onayı gerekir; onay tarih ve alıntıyla buraya eklenir.

### Kaynak çalışma zamanının çizim ayrıntıları (T-995)

Tasarım aracı metin bağlarını (`{{…}}`) ayrı bir `<span>` içinde çizer ve sayfaya tarayıcı varsayılanları uygulanır; uygulamada Tailwind
sıfırlaması vardır. Birebir için: (1) `.opt span`, `.addr`, `.chip` gibi alt öğe ya da esnek kutu aralığı kuralı olan yerlerde bağ ayrı
`<span>` olarak çizilir; (2) `dl` dış boşluğu (1em) ve metin kutusu iç boşluğu (1px 2px) açıkça verilir (`.dzg .inp input` uyarlaması).

## 7. Teslim kanıtı (her ekran PR'ı)

- Aynı veriyle tasarım ve uygulama ekran görüntüleri üç ölçüde alınır: **390×844** (mobil), **1180×820** (tablet), **1440×900** (masaüstü). Görüntüler `docs/design/parity/<ekran>/` altına `design-<ölçü>.png` ve `app-<ölçü>.png` adıyla konur.
- PR açıklaması bu görüntülere bağlantı verir ve "fark yok" ya da kalan farkların listesini yazar. Kalan fark varsa PR birleşmez.
- Mekanik bekçiler: `design-parity.test.ts` (CSS türetme sapması) ve `theme-contrast.test.ts` (renk sabiti).

## 8. Ekran durumu

| Ekran (kaynak görünümü) | Kaynak | Durum |
|---|---|---|
| Görevlerim (`v.home`) | Bakis.dc.html | T-988: birebir aktarım sürüyor |
| Bölüm / durum listesi (`v.list`) | Bakis.dc.html | Sırada |
| Manuel giriş/çıkış (`v.man`) | Bakis.dc.html | Sırada |
| Giriş (`v.recv`) + QR penceresi | Bakis.dc.html | Sırada |
| Sayım (`v.count`) | Bakis.dc.html | Sırada |
| Toplama: Çıkış / Transfer / Üretim (`v.pick`) | Bakis.dc.html | Sırada |
| Kamera, uyarılar, tamam ekranı, geri al, çevrimdışı, bildirim | Bakis.dc.html | Ekranlarıyla birlikte |
| Landing | Saha.dc.html | T-980–983 ile yayında (marketing) |
| Giriş: e-posta + saha PIN sekmesi, iki adımlı doğrulama, çalışma alanı seçimi (`v.login`, `v.mfa`, `v.pick`) | Giris.dc.html | SAHA GİRİŞİ sekmesi T-997 aktarıldı (`/field`; kayıtlı/kayıtsız cihaz 0 px, tek fark verinin Türkçe büyük harfi "MOTİVE"); **T-924 sapması (kullanıcı bildirimi 20 Ekim, "mobilde sığmıyor")**: 390×844 parite görüntüsü gerçek telefonun görünür yüksekliğini (Safari çubuklarıyla ~660–690 pt) temsil etmiyordu; kayıtlı cihazda hatırlanan çalışma alanı yeşil bantta tek satır + Değiştir (alan yalnız Değiştir ile açılır), kısa telefon ekranında (≤ 860 px yükseklik) boşluk/başlık/tuş yüksekliği küçülür (tuş ≥ 50 px), alt eylem çubuğu yokken 132 px alt boşluk kaldırılır — tuvaldeki `v.login` de aynı düzene güncellenmeli (B-63); E-POSTA sekmesi ve `v.mfa` T-999b aktarıldı (`/login`, `/mfa`, `parity/giris-eposta/`): 0 px; tasarım ekleri (hata bantları, kalan deneme, Caps Lock, hatırla, sosyal giriş, demo, yedek kod) kullanıcı onayı 17 Ekim 16:10; bekleme satırında saat eki farkı ("Saat … sonrasında"); "Doğrulanmamış" bandı güvenlik gereği kullanılmaz (hatalı bilgi mesajı gösterilir, hesap varlığı sızmaz). "Bu cihazdaki personelden seç" T-998. `v.pick` T-999 aktarıldı (`/workspaces`, `parity/alan-secimi/`): 390/1180/1440 açık ve koyu; tek fark kaynak yerel çiziminde `sc-for` içindeki alan adı (`b`) ince çiziliyor (bilinen; uygulama kaynak CSS 800 18px). Satır alanı açan bağlantıdır; "SON" ve seçili çerçeve sunucudaki son alan |
| Aktivasyon 4 adım + hazır + geçersiz bağlantı (`v.act`) ve hoş geldiniz e-postası (`v.mail`) | Giris.dc.html | T-995 aktarıldı (`parity/aktivasyon/`): 390/1180/1440 açık ve koyu 0 px (masaüstünde hareketli logo noktası 1 px). Tasarıma eklenen durumlar (geçersiz bağlantı, MFA anahtarı + yedek kodlar, posta kapalı metni, hata satırı) kullanıcı onayladı ("onaylıyorum", 16 Ekim). E-posta HTML'i aynı düzende (marka, başlık, bilgi kutusu, düğme) |
| Saha etkinleştirme: kod → PIN → tekrar (`v.fact`), ortak cihaz kullanıcı değiştir (`v.sw`) | Giris.dc.html | `v.fact` T-997 aktarıldı (`/field`, `parity/saha-girisi/`): 390/1180/1440 açık ve koyu 0 px. `v.sw` T-998 aktarıldı (`/field` ortak cihazda "Bu cihazdaki personelden seç", `parity/saha-cihazlar/`): PIN ekranı 0 px; liste satırında depo adı yok, baş harf adın iki harfi; bekleyen çevrimdışı iş bandı yok (uygulamada çevrimdışı kuyruk yok). Terminal kaydı `v.enr` (T-998 tasarım eki 16 Ekim) `/field/enroll`: 0 px |
| Saha personeli ekle + etkinleştirme kartı (`v.staff`), cihazlar + QR ile ekle (`v.dev`) | Giris.dc.html | `v.staff` T-997 aktarıldı (`/t/<alan>/members/field`, `parity/saha-girisi/`): yerleşim, kart ve liste birebir; farklar: depo seçeneklerine "Tüm depolar" eklendi (A-77 kapsamsız = tüm depolar); T-413 (18 Ekim): depo önceden seçili gelmez, seçilmeden gönderilemez (güvenlik incelemesi; kaynakta ilk depo seçili), kart QR'ı gerçek saha giriş adresidir (kod URL'ye girmez), liste satırında depo adı yok, avatar baş harfi adın ilk harfi; tasarım yerel çiziminde `sc-for` içindeki `b` öğeleri ince çiziliyor (kaynak CSS 800 18px — uygulama CSS'e uyar). `v.dev` T-998 aktarıldı (`/t/<alan>/members/devices`, `parity/saha-cihazlar/`): QR kartı ve onay kartı (T-998 tasarım eki: talep eden cihaz, ONAYLA/REDDET, onaysız cihaz bandı) birebir; liste satırında depo adı yok, son kullanım göreli zaman |
| Operatör demo talepleri (`v.op`) | Giris.dc.html | T-994 aktarıldı (`parity/demo-talepleri/`), sonra ADR-027 ile panele taşındı; bu görünüm artık kullanılmıyor |
| Yönetim paneli (yonet.etkinyazilim.com): özet, müşteriler, müşteri detayı, paketler, ödemeler, demo talepleri, satış sayfası, işlem kaydı | Yonet.dc.html | Onaylandı 15 Ekim; T-401…T-408. Demo talepleri ekranı Giris `v.op` yerine buradan (ADR-027) |
| Panel kabuğu + Demo talepleri (`talepler`) | Yonet.dc.html | T-401 aktarıldı (`parity/panel-talepler/`): içerik alanı mobil 0 px, tablet/masaüstü alt piksel; menüde yalnız yapılmış sayfa (kademeli). T-995: aktivasyon durumları + tek seferlik bağlantı kutusu (`parity/panel-talepler-aktivasyon/`, aynı sonuç; tasarım eki onaylandı "onaylıyorum" 16 Ekim) |
| Panel · Paketler (`paketler`) | Yonet.dc.html | T-404 aktarıldı (`parity/paketler/`): içerik alanı 390/1180/1440 açık ve koyu 0 px (aynı veri: kaynaktaki üç paket, müşteri sayıları 3/2/0, "[fiyat]"). Kabukta başlık eylemi ("Yeni paket") ve geri düğmesi kaynaktan. Panel formlarında metin kutusu iç boşluğu tarayıcı varsayılanı (`.dzy .inp input`, Giriş kabıyla aynı uyarlama). Menüde yalnız yapılmış sayfalar: Paketler, Demo talepleri |
| Panel · Müşteriler (`musteriler`, `musteri`) | Yonet.dc.html | T-403 aktarıldı (`parity/musteriler/`): liste ve detay içerik alanı 390/1180/1440 açık ve koyu 0 px (aynı veri: kaynaktaki beş müşteri, Motive Rubber detayı). Arama kutusu iç boşluğu ve yer tutucu rengi tarayıcı varsayılanı (`.dzy .search input`). Metin farkları bilinçli (I-18 §4, değer uydurulmaz): ABONELİK etiketi "İYZİCO · YAKINDA", ödeme alanları ödeme bağlantısı gelene dek dürüst metin; paket değişikliği notları hemen geçerli olduğunu söyler; "Destek erişimi iste" T-409'a dek pasif. Pencereler (Askıya al, Paketi değiştir) kaynak işaretlemesiyle; piksel ölçümü yapılmadı |
| Panel · Ödemeler (`odemeler`) | Yonet.dc.html | T-406 aktarıldı (`parity/odemeler/`): içerik alanı 390/1180/1440 açık ve koyu 0 px; "Ödeme kaydı" penceresi koyu 0 px, açık 16 px (tutar metninde alt piksel yumuşatma). Tasarım eki (tuval sürümü 1792166286-9fa9): satırda "Ödendi işaretle", "Ödeme kaydı" ve "Dönem tahakkuku" pencereleri. "Hatırlat" e-posta kuyruğu kurulumu (T-411) gelene dek pasif. Pencerede tutar satırı satır yüksekliği tarayıcı varsayılanı (`line-height: normal`) |
| Panel · Satış sayfası (`satis`) ve satış sitesi fiyat bölümü | Yonet.dc.html, Saha.dc.html (`marketing/src/landing.dc.html`) | T-407 aktarıldı (`parity/satis-sayfasi/`): panel içerik alanı 390/1180/1440 açık ve koyu birebir (önizleme bağlantısı kutusu açık; örnek paket sınırları farklı veri). Landing kiralama bölümü fiyat kartları 390/1440 birebir; tasarımdaki `[fiyat]` yer tutucusu uygulamada gerçek fiyattır. Tasarım eki 16 Ekim (VURGULU SATIR, SON YAYIN, önizleme kutusu, landing fiyat bölümü): kullanıcı onayladı (17 Ekim 11:12) |
| Panel · Özet (`ozet`) ve İşlem kaydı (`kayit`) | Yonet.dc.html | T-408 aktarıldı (`parity/ozet-kayit/`): içerik alanı 390/1180/1440 açık ve koyu 0 px (aynı örnek veri). Gerçek veride metin farkları: geciken ödeme alt satırı "N FATURA GECİKTİ", sınır satırı "ŞU AN", sistem kartında kuyruk sayısı/son yedek/gönderim sayısı yok (kaynak yok) |
| Ayarlar → Örnek veriler (`/t/<alan>/settings`) | — (tasarım kaynağı yok) | T-996: ayarlar ekranının tasarımı henüz yok; bölüm mevcut ayarlar sayfasının bileşenleriyle (Banner, Button) eklendi. Ayarlar tasarımı geldiğinde I-18 kapsamına girer ve birebir aktarılır |
| Ayarlar → Görev ayrılığı (`/t/<alan>/settings`) | — (tasarım kaynağı yok) | T-416: bölüm mevcut ayarlar sayfasının bileşenleriyle eklendi (aç/kapat, yeniden giriş uyarısı). Ayarlar tasarımı geldiğinde I-18 kapsamına girer |
| Cari kartlar (`/t/<alan>/parties`) | — (tasarım kaynağı yok) | T-428: liste, arama, kart penceresi ve alt cam çubuk Aktar kabuğunun kendi sınıflarıyla (`.top`, `.colb`, `.scrim > .sheet`, `.subdock`); metin kutuları `design/aktar-frame.css` uyarlamasında belirteçlerle. Tuvalde tasarlandığında I-18 kapsamına girer |
| Üyeler → depo kısıtı (`/t/<alan>/members`) | — (üyeler listesinin tasarım kaynağı yok) | T-417: kart içinde "Depolar: …" satırı ve "Depoları düzenle" alanı mevcut üyeler ekranı bileşenleriyle (Button, ConfirmDialog, onay kutuları) eklendi. Üyeler tasarımı geldiğinde I-18 kapsamına girer |
| Ana ekran (role göre) + üst çubuk + alt cam çubuk + yüzen kısayol + Ekip/Hesap menüsü + Etkin şeridi | Pano.dc.html | Onaylandı 19 Ekim 16:09; T-423 (kabuk), T-422 (rol içerikleri). T-423 ilk teslim: saha (PICKER) ve sayım (COUNTER) rolleri açılışta Pano görür (`app/t/[slug]/pano/`, CSS `design/pano.css` üretilmiş, uyarlama `design/pano-frame.css`); yönetici ve hesap sahibi T-422'ye dek Görevlerim'de. Bilinçli farklar (kullanıcı onayına sunuldu): bildirim zili yalnız hesap sahibi / depo yöneticisi panosunda (sayı: kritik stok + açık sorun; ayrı bildirim kutusu yok, uyarılara götürür); Etkin düğmeleri ve `.say` ipucu çizilmez (T-424); "Düzenle" kısayol seçici T-421 dalında eklendi (yetkili ekranlar, en çok 6, seçim tarayıcıda; öğe ikonu kaynaktaki liste ikonu yerine öğenin kendi ikonu); kaynakta uygulama içi tema düğmesi yok → tema Hesap menüsünde öğe; Hesap menüsüne "Tüm ekranlar" (uygulama menüsü) eklendi; "BUGÜN DEPODA" şeridi (masaüstü) ve sayım satırları (`.cs`) veri kaynağı gelene dek yok; Transfer/Üretim/Sayım kart renkleri kaynağın paletinden seçildi (kaynakta yalnız Giriş/Çıkış kartı var); telefonda 4+ kartta ilerleme satırı gizlenir (kaydırma yok kuralı); "ÖRNEK VERİ" etiketi yok (gerçek veri). Eşlik görüntüleri toplayıcı oturumunda (`tests/e2e/support/pano-checks.ts`, 390/1180/1440 açık ve koyu). **T-422:** hesap sahibi (`isOwner`: raporlar, dikkat isteyenler, satın alma, bekleyen siparişler, devir hızı) ve depo yöneticisi (`isManager`: iş halkası, Bugünü planla, atanmayı bekleyen işler + kişiye dokun ata, ekip şu an) gerçek veriyle (`getBoard`). Bilinçli farklar: siparişte sevk tarihi yok → "Geciken sipariş" yerine "Bekleyen sipariş" (bekleme günü); "Kritik stok" = minimumun %35 altı (kaynaktaki kırmızı çubuk eşiği), "Satın alma" = minimum altı (minimum stok `item_stock_policies`); "Hepsini listeye ekle" (satın alma listesi yok) çizilmez, "+N" ürün kartına gider; "Depo yöneticisine öne al" yerine "Sevkiyatı aç"; ekip durumu OKUTUYOR/GÖREVDE/BOŞTA/YOK (bağlantı bilgisi yok); Ekip menüsünde Yetki grupları T-421'e dek yok, "Onay bekleyenler" cihaz onaylarına gider |
| Ekip: kişiler + aktif/pasif, onay bekleyenler, davet, saha katılma QR'ı | Ekip.dc.html | Onaylandı 19 Ekim; T-429 (güvenlik incelemesi zorunlu: uzun ömürlü katılma QR'ı) |
| Yetki grupları | Gruplar.dc.html | Onaylandı 19 Ekim; T-421 |
| Uygulama kabuğu: alt cam çubuk (Geri/Sorun · Ana ekran · ana işlem · Modüller · Etkin), Modüller sayfası, Etkin dinleme/onay kartı, ilk kullanım rehberi | Kabuk.dc.html | Onaylandı 20 Ekim ("Onaylıyorum"); aktarım sırada (BACKLOG B-60, B-62, B-75) |
| Excel'den aktar (şablonsuz eşleştirme) | Aktar.dc.html | Onaylandı 19 Ekim; T-427 aktarıldı (`app/t/[slug]/import/aktar-view.tsx`, CSS `design/aktar.css` üretilmiş, uyarlama `design/aktar-frame.css`). Bilinçli farklar: Cari kartlar T-428'e dek kapalı kart; .xls (eski ikili) okunmaz, kullanıcıya ".xlsx olarak kaydet" denir (XLS rozeti yok); "Kritik stok (en az)" alanı yok (minimum stok aktarımı ayrı iş); Etkin ve sesle eşleme T-424; "Sorunluları Excel'e indir" yok; eşleştirme hafızası tarayıcıda; çok sayfalı dosyada sayfa seçici (kaynakta yok) |
| Yetki grupları (`/t/<alan>/groups`) | Gruplar.dc.html | Onaylandı 19 Ekim; T-421 aktarıldı (`app/t/[slug]/groups/groups-view.tsx`, CSS `design/gruplar.css` üretilmiş, uyarlama `design/gruplar-frame.css`). Bilinçli farklar: HAZIR gruplar rollerdir, salt okunur (rol Ekip ekranında değişir); "Ekibi yönetsin" kartı kilitli (ekip yönetimi grupla verilmez, güvenlik); özel grup için "Grubu arşivle" düğmesi (kaynakta yok; grup silinmez); kişi aramasında yazı kutusu, Etkin (sesle) T-424; demo alanında salt okunur; 9'dan çok kişide liste kendi içinde kayar |
| Ekip (`/t/<alan>/team`) | Ekip.dc.html | Onaylandı 19 Ekim; T-430 aktarıldı (`app/t/[slug]/team/team-view.tsx`, CSS `design/ekip.css` üretilmiş, uyarlama `design/ekip-frame.css`). Bilinçli farklar: onay kartında personelin kodu gösterilmez, yönetici yazar (güvenlik: uygulama rolü kodu okuyamaz); aktif/pasif anahtarı ve son görülme yok (pasif üyelik ayrı iş; filtre Hepsi / Saha / Ofis); davette ad alanı yok (kişi kabulde yazar); QR adresi yalnız üretildiği anda (yenile → yeni QR); Etkin T-424; ayrıntılı kişi işlemleri Kullanıcılar ekranına bağlantı |
