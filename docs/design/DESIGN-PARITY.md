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
| Giriş: e-posta + saha PIN sekmesi, iki adımlı doğrulama, çalışma alanı seçimi (`v.login`, `v.mfa`, `v.pick`) | Giris.dc.html | Onaylandı 15 Ekim; T-999 / T-997 |
| Aktivasyon 4 adım + hazır + geçersiz bağlantı (`v.act`) ve hoş geldiniz e-postası (`v.mail`) | Giris.dc.html | T-995 aktarıldı (`parity/aktivasyon/`): 390/1180/1440 açık ve koyu 0 px (masaüstünde hareketli logo noktası 1 px). Tasarıma eklenen durumlar (geçersiz bağlantı, MFA anahtarı + yedek kodlar, posta kapalı metni, hata satırı) kullanıcı onayladı ("onaylıyorum", 16 Ekim). E-posta HTML'i aynı düzende (marka, başlık, bilgi kutusu, düğme) |
| Saha etkinleştirme: kod → PIN → tekrar (`v.fact`), ortak cihaz kullanıcı değiştir (`v.sw`) | Giris.dc.html | Onaylandı; T-997 / T-998 |
| Saha personeli ekle + etkinleştirme kartı (`v.staff`), cihazlar + QR ile ekle (`v.dev`) | Giris.dc.html | Onaylandı; T-997 / T-998 |
| Operatör demo talepleri (`v.op`) | Giris.dc.html | T-994 aktarıldı (`parity/demo-talepleri/`), sonra ADR-027 ile panele taşındı; bu görünüm artık kullanılmıyor |
| Yönetim paneli (yonet.etkinyazilim.com): özet, müşteriler, müşteri detayı, paketler, ödemeler, demo talepleri, satış sayfası, işlem kaydı | Yonet.dc.html | Onaylandı 15 Ekim; T-401…T-408. Demo talepleri ekranı Giris `v.op` yerine buradan (ADR-027) |
| Panel kabuğu + Demo talepleri (`talepler`) | Yonet.dc.html | T-401 aktarıldı (`parity/panel-talepler/`): içerik alanı mobil 0 px, tablet/masaüstü alt piksel; menüde yalnız yapılmış sayfa (kademeli). T-995: aktivasyon durumları + tek seferlik bağlantı kutusu (`parity/panel-talepler-aktivasyon/`, aynı sonuç; tasarım eki onaylandı "onaylıyorum" 16 Ekim) |
| Panel · Paketler (`paketler`) | Yonet.dc.html | T-404 aktarıldı (`parity/paketler/`): içerik alanı 390/1180/1440 açık ve koyu 0 px (aynı veri: kaynaktaki üç paket, müşteri sayıları 3/2/0, "[fiyat]"). Kabukta başlık eylemi ("Yeni paket") ve geri düğmesi kaynaktan. Panel formlarında metin kutusu iç boşluğu tarayıcı varsayılanı (`.dzy .inp input`, Giriş kabıyla aynı uyarlama). Menüde yalnız yapılmış sayfalar: Paketler, Demo talepleri |
| Panel · Müşteriler (`musteriler`, `musteri`) | Yonet.dc.html | T-403 aktarıldı (`parity/musteriler/`): liste ve detay içerik alanı 390/1180/1440 açık ve koyu 0 px (aynı veri: kaynaktaki beş müşteri, Motive Rubber detayı). Arama kutusu iç boşluğu ve yer tutucu rengi tarayıcı varsayılanı (`.dzy .search input`). Metin farkları bilinçli (I-18 §4, değer uydurulmaz): ABONELİK etiketi "İYZİCO · YAKINDA", ödeme alanları ödeme bağlantısı gelene dek dürüst metin; paket değişikliği notları hemen geçerli olduğunu söyler; "Destek erişimi iste" T-409'a dek pasif. Pencereler (Askıya al, Paketi değiştir) kaynak işaretlemesiyle; piksel ölçümü yapılmadı |
| Panel · Ödemeler (`odemeler`) | Yonet.dc.html | T-406 aktarıldı (`parity/odemeler/`): içerik alanı 390/1180/1440 açık ve koyu 0 px; "Ödeme kaydı" penceresi koyu 0 px, açık 16 px (tutar metninde alt piksel yumuşatma). Tasarım eki (tuval sürümü 1792166286-9fa9): satırda "Ödendi işaretle", "Ödeme kaydı" ve "Dönem tahakkuku" pencereleri. "Hatırlat" e-posta kuyruğu kurulumu (T-411) gelene dek pasif. Pencerede tutar satırı satır yüksekliği tarayıcı varsayılanı (`line-height: normal`) |
| Ayarlar → Örnek veriler (`/t/<alan>/settings`) | — (tasarım kaynağı yok) | T-996: ayarlar ekranının tasarımı henüz yok; bölüm mevcut ayarlar sayfasının bileşenleriyle (Banner, Button) eklendi. Ayarlar tasarımı geldiğinde I-18 kapsamına girer ve birebir aktarılır |
