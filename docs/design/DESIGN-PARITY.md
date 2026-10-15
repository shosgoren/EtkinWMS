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
| Aktivasyon 4 adım + hazır (`v.act`) ve hoş geldiniz e-postası (`v.mail`) | Giris.dc.html | Onaylandı; T-995 |
| Saha etkinleştirme: kod → PIN → tekrar (`v.fact`), ortak cihaz kullanıcı değiştir (`v.sw`) | Giris.dc.html | Onaylandı; T-997 / T-998 |
| Saha personeli ekle + etkinleştirme kartı (`v.staff`), cihazlar + QR ile ekle (`v.dev`) | Giris.dc.html | Onaylandı; T-997 / T-998 |
| Operatör demo talepleri (`v.op`) | Giris.dc.html | Onaylandı; T-994 |
