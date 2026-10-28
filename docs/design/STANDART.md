# Ekran standardı — tek kalıp, her ekran (kullanıcı onayı 26 Ekim 2026)

**Kullanıcı kararı (26 Ekim 2026, tuval onayı):** "Tuvali onaylıyorum, kodlamaya başla ama bu standart yapı bu tuvalde olmayan tüm ekranlar için geçerli olmalı; bu genel düzende olmayan hiçbir ekran görmemeliyim (liste ise bu şekilde, kart ise bu şekilde, parametrik bir ayar ise bu şekilde…). Yeni bir şey eklediğimde bu standardı otomatik algılayarak ona göre ekleme veya değişiklik yapabilmeli; her seferinde tuvalde tasarım onayı yapmak istemiyorum."

Bu belgenin sonucu:
- Onaylı tuval: https://claude.ai/artifact/TUJMoHAKDAH3j3xARjVjXL ("Etkin WMS — Masaüstü düzen önerisi"); kaynaklar `docs/design/source/Standart*.dc.html` (sha256 `SOURCE.md`).
- **Her ekran aşağıdaki kalıplardan birine girer.** Tuvalde olmayan ekran (ör. depo kartı, sevk listesi, iş emri formu, yazıcı ayarı) en yakın kalıptan türetilir; ayrı tuval ve ayrı onay istenmez. Kalıba sığmayan yeni bir ihtiyaç çıkarsa önce ortak kalıba eklenir (kod + bu belge), sonra ekranda kullanılır.
- Ekranlar kalıbı ortak bileşenlerden alır (`apps/web/app/t/[slug]/kalip/`); ekran kendi düzenini, rengini, gölgesini yazmaz. Mekanik bekçiler (`ui-standards.test.ts`, `design/kural-standart.test.ts`) yeni ekranlarda da işler.
- ALTIN-KURAL, INVARIANTS (I-18 dahil) ve PROTOCOL kuralları geçerlidir; bu karar yalnız "ekran başına tuval onayı" adımını kaldırır.

## 1. Ortak kabuk (her ekran)
- **Zemin:** ekranın modül renginde sol üstten başlayan yumuşak geçiş → #EEF1F4 → #DCE3EA. Modül tonları: ana ekran lacivert (#E3E9F4), ayarlar camgöbeği (#DDF0EE), ürün listesi mavi (#DFE8F7), ürün/stok kartı bej (#F4E9DC), cari yeşil (#DFF0E6). Koyu temada aynı tonların koyu karşılıkları.
- **Üst çubuk (tüm sayfalarda aynı):** solda logo + ekran simgesi + ekran adı (ana ekranda "Merhaba <ad>") ve "Firma · Rol"; ortada **canlı saat ve tarih** (yeşil noktalı saat simgesi, zeminsiz); sağda sırasıyla tema seçici (güneş/ay), Son işlemler (sayı rozeti), Sorun bildir (bayrak), Destek (kulaklık), **Ayarlar** (dişli, yalnız `settings.manage`), **Hesap** (en sağda: kullanıcı görseli ya da baş harfi, çevrimiçi nokta). **Düğmeler yalnız simge** (yazı yok; 48 px kare, aynı hiza — T-1044 kullanıcı kararı), zeminsiz ve gölgesiz; üstüne gelince çok hafif gri. Hesap menüsü: Sessiz + Çıkış yap ("Kullanıcı değiştir" yok); menü açıkken perde alt çubuğu da örter. Telefonda sığmayan tema seçici ve Ayarlar Hesap menüsüne, saat gizlenir.
- **Alt cam çubuk (tüm sayfalarda aynı):** buzlu beyaz cam, ince parlak kenar, yumuşak gölge; simge + yazı gri-mavi; bulunduğun yer açık mavi hapta mavi. Ortada ekranın ana işlemi (OKUT / KAYDET / EKLE…) yeşil geçişli yuvarlatılmış kare, beyaz halka. Etkin aynı boyda öğe (mor kare + "ETKİN"). Yanında küçük yuvarlak "Alt çubuğu düzenle" (ayar sürgüsü simgesi). Düzen kişiye özel tek ayardır, her sayfada aynı; ana işlem ekrana göre değişir; yetkisi olmayan kısayol gizlenir.
- **Genişlik:** masaüstünde içerik ekranın tamamını kullanır, iki yanda eşit 40 px boşluk (T-1044 kullanıcı kararı: "alan geniş kullanılmıyor"); alt çubuk 720 px; sayfa kaymaz (gerekirse yalnız liste/tablo alanı kendi içinde kayar, sütun başlığı ve toplam şeridi sabit).
- **Perde:** pencere/büyük görünüm/menü açılınca arkadaki sayfa açık renkli bulanık cam olarak görünür (koyu perde yok).
- **Sabit ipucu yazısı yok.** "* zorunlu · Kaydet'e bas" gibi hatırlatmalar sürekli durmaz; uyarı yalnız gerektiği anda (eksik alanda kırmızı çerçeve + tek satır).

## 2. Liste kalıbı (ör. Ürünler; cari, depo, raf yeri, belge listeleri aynı)
- Üstte arama + **Kart / Liste geçişi** + **Sütunlar** (göster/gizle, sürükleyerek sırala, "Varsayılana dön"; kişiye özel kaydedilir; kod ve ad her zaman görünür).
- Süzgeç çipleri: Tümü · türler · Pasif · Arşivli (arşivli yalnız burada).
- Liste görünümü: görsel küçük resmi (birden çok görselde nokta göstergesi, görselsiz satırda aynı hizada "+"), sütunlu sıralanabilir tablo, durum hapları, uzun ad en çok 2 satır (fazlası "…" + üstüne gelince tam ad).
- **Kaydırma (kullanıcı kararı 26 Ekim, T-1055 — sayfa geçişinin yerine):** bütün listelerde, masaüstü / tablet / telefonda üst çubuk, arama, süzgeç çipleri ve sayı başlığı **yerinde kalır**, alt çubuk sabittir; **yalnız liste aşağı-yukarı kayar**. Sona yaklaşınca sonraki 50 kayıt kendiliğinden gelir (sayfa numarası / "Sonraki" yok; yüklenirken gösterge, hata olursa "Tekrar dene"). Tabloda sütun başlığı sabit. Kayda girip geri dönünce kaldığın yerden. Epey aşağıda "Başa dön" oku. Telefonda süzgeç çipleri tek satırda sağa kayar (sağ kenarda solan gölge).

## 3. Kayıt kartı kalıbı (ör. Ürün kartı; cari, depo, raf yeri, belge kartları aynı)
- Tek büyük panel, ekranı doldurur, kaydırma yok.
- **Üst şerit** (modül/tür renginde tonlu zemin): görsel (oklar, "1 / 3", dokununca büyük görünüm) + altında ayrı "Görsel ekle" düğmesi; ad + etiketler (kod, tür, birim, durum, entegrasyon durumu); **sayı kutuları** (tek kalıp: beyaz, ince çerçeve, üst kenarda renk şeridi, simge + büyük sayı; ör. Eldeki · Kullanılabilir · Ayrılmış); hızlı işlemler aynı şeritte.
- **Sekmeler** (alt çizgili, her sekmede renkli simge): ör. Genel · Stok ve yer · Hareketler · Barkodlar · Takip · Paraşüt · Değişiklik geçmişi.
- Genel: bilgiler simgeli kutucuklarda (3 sütun); dış sistemin yönettiği alanda kilit simgesi. Sağda **son hareketler zaman çizgisi**: her satır tıklanınca o işlemi açan kart (renkli simge, belge no, tarih, raf yeri, miktar hapı +yeşil/−kırmızı, yapan kişi).
- **Stok ve yer:** katlanır pivot (Depo › Raf yeri › Lot › Paket; sıra sürüklenir, "+ Seri"; Hepsini aç/kapat; Tam ekran); her seviyede toplam; altta sabit toplam şeridi.
- Arşivli kayıtta işlem düğmeleri yok; yetkisiz işlem gizlenir ya da kilitli görünür.

## 4. Form kalıbı (yeni / düzenle; ör. Yeni cari)
- Tek panel, en çok 3 sütun, kaydırma yok (konu çoksa sekmeye bölünür).
- Üst şerit: modül renginde tonlu zemin, büyük simge, girilen ad canlı, otomatik kod; tür seçimi büyük simgeli düğmeler.
- Her sütun bir konu: simgeli başlık, üstü kendi renginde hafif tonlu; yazı kutuları beyaz, ince çerçeve, başında küçük renkli simge. Önizleme sütunu yok.
- Kaydet alt çubuğun ortasında; düzenlemede yalnız değişiklik varsa etkin. Görsel/ek gibi anlık işlemler otomatik kaydedilir ("Kaydedildi" + Geri al).

## 5. Ayar kalıbı (parametrik ayarlar; ör. İş akışı, Entegrasyonlar)
- Üstte ayar sekmeleri (renkli simgeli): Firma · Kullanıcılar ve yetki · İş akışı · Entegrasyonlar · Etiket ve yazıcı · Görünüm.
- Birden çok konu barındıran sekmede **solda dikey alt bölüm listesi** (simge + ad, sorun varsa kırmızı sayı rozeti), sağda yalnız seçili bölüm; aynı anda tek konu.
- Ayar satırı: simgeli kutucuk + ad + kısa açıklama + aç/kapa ya da büyük seçim düğmeleri; kart başı kendi renginde tonlu.
- **Entegrasyon yönü standart dört seçenek:** ← <Sistem>'den al · → <Sistem>'e gönder · ⇄ İki yönlü · [e] Yalnız Etkin WMS (o bilgi için mümkün olmayan yön gösterilmez).
- **Kod (T-1112):** `kalip/ayar.tsx` — `KalipAltBolumler` (sol alt bölüm listesi, adres `?bolum=`, telefonda kartın üstünde yatay çip satırı), `KalipAyarKart` (seçili bölüm kartı), `KalipAyarSatir` (ayar satırı), `KalipYonSecimi` (yön seçimi); görünüm `design/standart.css` `.stab/.stak/.stay/.styon`. İlk kullanan: Ayarlar › Entegrasyonlar (`/integrations`).

## 6. Büyük görünüm / pencere kalıbı
- Açık bulanık cam perde, ortada içerik gölgeli; kapat ve oklar beyaz cam düğme; alt sırada küçük resimler + işlem düğmeleri (aynı boy, simgeli: Ekle · Kapak yap · Sil) + "Kaydedildi".

## 7. Sözlük ve simge/renk eşlemesi (her ekranda aynı)
- **Terim:** stok tutulan adres her yerde **"raf yeri"** (A-1-2-3); "göz" kullanılmaz. Arşiv/pasif: "Arşivli", "Pasif".
- **Simge + renk (tek eşleme):** Paraşüt turuncu bağlantı (#E0582B) · transfer mor çift ok (#6C4BD8) · giriş/mal kabul yeşil aşağı ok (#2F7D5B) · sevk turuncu kamyon (#C2702A) · sayım mavi pano (#2F5DA8) · etiket/yazıcı mavi yazıcı (#3B6A9E) · depo koyu gri bina · raf yeri gri raf · lot mavi etiket · palet kahve · koli turuncu kutu · QR camgöbeği · değişiklik geçmişi gri geri-saat · kritik stok kiremit (#B23A3A).
- Siyaha yakın koyu dolgu yok: seçili sekme/süzgeç açık mavi zemin + mavi yazı; koyu lacivert yalnız logoda ve metinde.

## 8. Uygulama sırası (T-1041…)
1. Belge + kaynak (bu iş).
2. Ortak kabuk: üst çubuk, alt çubuk, zemin geçişi, perde (KalipEkran + Pano) → bütün ekranlar birlikte değişir.
3. Ana ekran.
4. Liste kalıbı (kart/liste, sütunlar, kaydırmayla yükleme) → ürün, cari, depo, belge listeleri.
5. Kayıt kartı kalıbı + Stok ve yer pivotu → ürün, cari, depo kartları.
6. Form kalıbı → bütün yeni/düzenle ekranları.
7. Ayar kalıbı → Ayarlar sekmeleri, İş akışı, Entegrasyonlar.
8. Veri gerektirenler (ayrı iş): ürün görselleri, kişiye özel sütun/çubuk düzeni kaydı, Paraşüt alan sahipliği, pasif durum.
