# Etkin WMS — tek yapılacaklar listesi

Bu dosya bütün açık işlerin **tek listesidir**; kural metni burada tekrar yazılmaz (otorite: [INVARIANTS](INVARIANTS.md), [ALTIN-KURAL](design/ALTIN-KURAL.md), [PROTOCOL](agents/PROTOCOL.md)). Canlı durum [STATE](STATE.md)'tedir.
İş başlarken satıra T-numarası (T-915+ boş numara) ve kart açılır; bitince satır silinmez, durumu `BİTTİ <PR/SHA>` olur, sonraki temizlikte Git geçmişine bırakılır.

Kaynak: 20.10.2026 statik inceleme (kod okuması; test/DB/canlı koşturulmadı). Etiketler [UPDATE_PROTOCOL](continuity/UPDATE_PROTOCOL.md) ile aynı.
Öncelik: **P0** canlı müşteri açılmadan · **P1** en kısa sürede (0051/0052 19 Ekim 21:18'de canlıya çıktı, main `0993416`) · **P2** ilk ücretli müşteri öncesi · **P3** ölçek/kalite.

**Güvenlik satırları (🔒):** depo herkese açık olduğundan ayrıntı (dosya:satır, senaryo, düzeltme) burada yazılmaz; depo yöneticilerine açık gizli danışma taslağı **GHSA-jxfh-5j2f-4mvg** içindedir (GitHub → Security → Advisories). Düzeltme birleşip canlıya çıkınca ayrıntı kart/PR'a taşınabilir. Yeni güvenlik bulgusu da önce oraya, burada yalnız kimlik + genel başlıkla eklenir.

## Kullanıcı onaylı sıra (20 Ekim, "Onaylıyorum")
1. B-76 "Bu cihazı 30 gün hatırla" → 2. B-60 yeni alt çubuk + Modüller (Kabuk.dc.html) → 2b. (20 Ekim ekleme, önce) B-87 yüzen kopya düğme, B-85 üst çubukta Sorun/Destek ikonları, B-84 destek talebi + panel + WhatsApp, B-86 OKUT doğrudan okutma → 3. B-75 ilk kullanım rehberi → 4. B-62 Etkin sesli komut → 5. B-63 eski ekranlar (önce Ayarlar) → 6. P1 güvenlik kalanı → 7. B-51 sayım, B-50 QR akışı, B-56 donanım denemesi → 8. B-80…B-83 eklemeler. P0 yedek/izleme kullanıcının depolama hesabını bekler.

## P0 — veri kaybı ve görünürlük
| ID | İş | Kim |
|---|---|---|
| B-01 | Günlük şifreli sunucu dışı yedek + saklama politikası 🔒 | AI betik, kullanıcı hesap + kurulum |
| B-02 | WAL arşivi + PITR, RPO/RTO kararı (Q-25), aylık otomatik geri yükleme tatbikatı | AI + kullanıcı |
| B-03 | Dış izleme ve alarm (sağlık, disk, sertifika, worker) + bildirim kanalı | AI + kullanıcı |
| B-04 | Hata izleme (Q-21), KVKK uyumlu maskeleme | Kullanıcı kararı |

## P1 — yetki ve RLS (ilk güvenlik paketi; 0051/0052 canlıda; security-reviewer + QA zorunlu)
| ID | İş |
|---|---|
| B-10 | Global kimlik/olay tablolarında uygulama rolü okuma yetkisini daralt 🔒 — `security_events` kısmı T-919 canlıda (#115, `6fa23e0`); kalan kısım açık |
| B-11 | Ekibe katılma onayını DB'de kod doğrulamasına bağla 🔒 — BİTTİ #115 / main `6fa23e0` (canlı 20 Ekim) |
| B-12 | Saha girişi migration'larının geri almasına veri bekçisi 🔒 |
| B-13 | Pano bölümlerinde depo kapsamı tutarlılığı 🔒 — BİTTİ #116 / main `abd7261` (canlı 20 Ekim) |
| B-14 | Paket/palet oluşturmada depo kapsamı 🔒 — BİTTİ #116 / main `abd7261` (canlı 20 Ekim) |
| B-15 | İzolasyon testini (AC-04) RLS'siz tabloların yetkilerini kapsayacak şekilde genişlet |
| B-16 | Yöneticiyi yalnız hesap sahibi yönetir (kullanıcı kararı 20 Ekim: evet) 🔒 — BİTTİ #118 / main `abd7261` (canlı 20 Ekim) |
| B-17 | DB işlevlerinde aktör kimliğini oturum bağlamından al 🔒 |
| B-18 | Kuyruk RLS politikası simetrisi 🔒 |
| B-19 | Hassas işlemlerde yeniden doğrulama tutarlılığı 🔒 — BİTTİ #116 / main `abd7261` (canlı 20 Ekim) |

## P1 — DB ikinci savunma
| ID | İş |
|---|---|
| B-20 | Üyelik/rol/grup yazmalarında DB düzeyi yetki denetimi; tek sahip kısıtı 🔒 |
| B-21 | Depo kapsamını RLS'e taşı; kapsam bayrağı yoksa üretimde fail-closed 🔒 |
| B-22 | I-08/I-09 için DB CHECK'leri (ters kayıt üst sınırı, temel miktar kesin çarpım) |
| B-23 | Görev ayrılığı: ayar yetkisi ve kapsamın genişletilmesi; DB tetikleyicisi 🔒 |
| B-24 | Tenant bağlamı güven sınırını ADR'ye yaz; ham SQL lint kilidi; worker/operatör için ayrı DB rolü değerlendirmesi 🔒 |
| B-25 | Eksik tekil kısıt ve indeksler (saha girişi, ekibe katılma, abonelik) |
| B-26 | Hız sınırı tablosu yetkisi; bileşik FK eksikleri 🔒 |

## P1 — altyapı sıkılaştırma
| ID | İş |
|---|---|
| B-30 | Docker ağ ayrımı (ön yüz / DB) 🔒 |
| B-31 | Konteyner sıkılaştırma (salt okunur kök, yetenek düşürme, süreç sınırı) |
| B-32 | Proxy: imaj sabitleme, güvenlik başlıkları tüm sitelerde, erişim günlüğü, iç uçların dışarı kapatılması 🔒 |
| B-33 | Canlı compose/Caddyfile sürümleme (config drift); eski `deploy/vps/compose.yml` kaldır |
| B-34 | Migration sırasında bütün yazıcıları durdur; eski imaj temizliği + disk alarmı; belgelenmiş `rollback <tag>` |
| B-35 | Eski `etkinwms-motive_*` birim/ağ temizliği (önce yedek, kullanıcı onayı) |
| B-36 | Neon/Fly kalıntıları: `restore-drill`, `deploy-migrate`, `deploy-smoke`, `uptime-check` betikleri, RUNBOOK-ops, Dockerfile/compose yorumları |
| B-37 | Satış sitesi form/önizleme sıkılaştırma 🔒 |
| B-38 | Panel kökeninde gereksiz kimlik uçlarını kapat 🔒 |
| B-39b | CI hızlandırma: int/e2e paralel parçalar, yalnız belge PR'da ağır testler atlanır, yayın tek tetikleme. T-925 (KODDA VAR) |
| B-39 | Dependabot/Renovate; `pnpm audit` CI işi; DB TLS sertifika yenileme otomasyonu |

## P2 — satılabilir SaaS
| ID | İş | Bağlı |
|---|---|---|
| B-40 | iyzico abonelik + webhook (imza doğrulama, idempotent tüketim, retry), otomatik aylık tahakkuk, "Hatırlat" | T-405, şirket kuruluşu |
| B-41 | Deneme bitiş davranışı | Q-127 |
| B-42 | Kullanım koşulları, DPA, mesafeli satış, veri sorumlusu kimliği, saklama süresi; yurt dışı aktarım hukuk onayı | Q-07, avukat |
| B-43 | Veri dışa aktarma (takeout) + kapatma süreci | I-13, AC-24/26/29/30, Faz 4P |
| B-44 | Destek erişimi (audit'li, süreli) | T-409 |
| B-45 | e-Arşiv/e-Fatura | ADR-008 Faz 4S |
| B-46 | Kesintisiz yayın: expand/contract migration kuralı; yazıcıları durdurmadan migration | — |

## P2 — ürün akışları
| ID | İş | Bağlı |
|---|---|---|
| B-50 | Paketli/QR akışı normal girişe bağla, `PACKAGE_RECEIVING_ENABLED` aç | T-975 |
| B-51 | Sayım saha + yönetici ekranları (domain hazır) | T-990/T-991 |
| B-52 | Toplama saha ekranı, iade ekranı (domain `returns.ts` var) | — |
| B-53 | Üretim fixture hataları + kapılar; siparişsiz sevk kapıları | T-964, T-970–974 |
| B-54 | Yetki grupları, ekibe katılma QR, Ekip ekranı: canlıda (main `0993416`, 19 Ekim 21:18 deploy-vps 39326385152); kullanıcı kabulü ve P1 düzeltmeleri bekliyor | T-421, T-429 |
| B-55 | Pasif üyelik; davet/saha hesabı yaşam döngüsü tutarlılığı | — |
| B-56 | Donanım kabulü: telefon/notebook kamera, Epson/ZPL, Bluetooth, el terminali (AC-35) | Q-103 |
| B-57 | Offline gereksinim ölçümü | Q-102, ADR-025 |
| B-58 | **Canlı hata:** tablette (768–1199 px) eski "Geri / Ana ekran" çubuğu yeni tasarım ekranlarının (Ekip, Gruplar, Aktar, Cari, Pano alt ekranları) cam çubuğunun üstüne biniyor; orta ana işlem tıklanamıyor. T-921 | kullanıcı bildirimi 20 Ekim |
| B-59 | Ekip: "Rol, depo ve şifre işlemleri · Kullanıcılar ekranı" bağlantı metni kesik çerçevenin üst çizgisine biniyor. T-921 | kullanıcı bildirimi 20 Ekim |
| B-58b | **Canlı hata:** saha girişi (kayıtlı cihaz) iPhone'da sığmıyor, tuş takımı kesik. T-924 canlıda (`4f7d907`) son satır hâlâ yarım → T-959: kayıtlı cihazda çalışma alanı kaldırıldı, bant tek satır (KODDA VAR) | kullanıcı bildirimi 20 Ekim |

## P3 — Altın Kural / tasarım ve kod kalitesi
| ID | İş |
|---|---|
| B-60 | Yeni alt cam çubuk (Geri/Sorun · Ana ekran · ana işlem · Modüller · Etkin) + Modüller sayfası (rol/yetki) + kaydedilmemiş iş uyarısı — kaynak `Kabuk.dc.html` (kullanıcı onayı 20 Ekim); eski `BottomNav`/`screen-nav` emekliye; e2e ortak yerleşim taraması (telefon/tablet/masaüstü) — T-958 (KODDA VAR): Pano + Ekip/Gruplar/Aktar/Cariler ortak çubukta; eski `screen-shell` ekranlarının `screen-nav`/saha çubuğu B-63 ile ekranlar tasarıma geçerken |
| B-61 | Ortak ses/geri bildirim modülü (`beep()` üç kopya + T-958 `kabuk-bar.tsx` `tone()`); saha akışlarına sesli geri bildirim |
| B-62 | Etkin sesli komut (T-424; Kabuk.dc.html onaylı): bas-konuş / iki dokunuş uzun dinleme ("bitti"), stok/yetki değiştiren komutta "Anladım" onay kartı, okuma komutu doğrudan sonuç; sesli geri bildirim — teknoloji (20 Ekim kullanıcı kararı, Q-129): yerel faster-whisper + Silero VAD, ses için EMA Lightning; ilk adım ölçüm (model seçimi) |
| B-63 | Tasarım kaynağı olmayan ~49 ekran (stok, kabul, sevk, üretim, etiket, ayarlar, saha) için tuval → birebir aktarım (I-18). Saha: OKUT + Kabul + Yerleştirme KalipSaha kalıbında (T-969, KODDA VAR); **grup A KODDA VAR (T-973):** paketli kabul (Form kabı), paket etiketleri (Liste kabı; baskıda üst/alt çubuk yok), saha paket akışı (Saha kalıbı), Görevlerim (Liste kalıbı, saha görünümü) — işlev/eylem/idempotency/I-15 aynı, düğme adları ve test kimlikleri korunur |
| B-60 | Ortak alt ekran çubuğu (Geri + Ana ekran · ana işlem · Etkin) + kaydedilmemiş iş uyarısı (T-423 kalanı); eski `BottomNav`/`screen-nav` emekliye; e2e'ye tablet (768–1199) projesi |
| B-61 | Ortak ses/geri bildirim modülü (`beep()` üç kopya); saha akışlarına sesli geri bildirim |
| B-63 | **İlerleme 20 Ekim: kalıp temeli + Ayarlar + Ürünler KODDA VAR (T-968); grup 1 KODDA VAR (T-971): Depolar + lokasyon ağacı, Cariler, Üyeler/Saha personeli/Cihazlar/Katılma, Kim ne yaptı?, Görevler, Etiket yazdır** — 4 kalıp kaynağı (Liste/Form/Detay/Saha) + ortak bileşenler `app/t/[slug]/kalip/`; kalan ekranlar yalnız kalıbı kullanarak geçer; Saha kalıbı ekran kodu sırada. Tasarım kaynağı olmayan ~49 ekran (stok, kabul, sevk, üretim, etiket, ayarlar, saha) için tuval → birebir aktarım (I-18). Kullanıcı 20 Ekim'de canlıda gördü: **Ayarlar** hâlâ eski görünümde (Kolay mod üst çubuğu, sol Ayarlar/Geri/Ana ekran kutusu, düz form, turuncu Kaydet); alt cam çubuk ve ikonlu yapı yok — önce Ayarlar tuvali |
| B-63 | **grup 2 KODDA VAR (T-972)** — Stok durumu (liste), Stok işlemleri (liste + belge detayı + giriş/çıkış/transfer formu), Beklenen teslimler (liste + `?new=1` form), Sevkiyat (liste + sipariş detayı + yeni sipariş), Üretim (liste + reçete detayı/üretim + yeni reçete) kalıpta; işlev/eylem/yetki/I-15 aynı. Kalan: ~~`receipts/packages`, saha paket akışı, `/field/tasks`~~ grup A KODDA VAR (T-973); türe/duruma göre sunucu süzgeci yok (çipler bölüm geçişi); detay ekranlarında kaydedilmemiş iş uyarısı yok |
| B-63 | Tasarım kaynağı olmayan ~49 ekran (stok, kabul, sevk, üretim, etiket, ayarlar, saha) için tuval → birebir aktarım (I-18). **Saha ilerlemesi (T-969, KODDA VAR):** OKUT, Kabul ve Yerleştirme Saha kalıbında (KalipSaha: Okut · Doğrula · Miktar; sayı tuşları, TÜMÜ, fazla uyarısı, ONAYLA, başarı perdesi); paket akışları ve /field/tasks eski görünümde. Kullanıcı 20 Ekim'de canlıda gördü: **Ayarlar** hâlâ eski görünümde (Kolay mod üst çubuğu, sol Ayarlar/Geri/Ana ekran kutusu, düz form, turuncu Kaydet); alt cam çubuk ve ikonlu yapı yok — önce Ayarlar tuvali |
| B-64 | İstemci `void action().then()` zincirlerine hata yakalama (ör. `apps/web/app/activate/[token]/flow.tsx`); `loading.tsx`, panel `error.tsx`, `global-error`, `not-found` |
| B-65 | `apps/web/app/t/[slug]/page.tsx` üyelik yoksa `return null` → `notFound()`; tanımsız roller için açılış ekranı |
| B-66 | Panel hata kodlarını kullanıcı diline çevir |
| B-69 | Üyeler ekranı ve davet penceresi: sahip olmayan yöneticide yönetici hedefli rol/çıkarma/sıfırlama düğmeleri ve TENANT_ADMIN davet seçeneği kilitli + nedeni görünür (sunucu zaten reddediyor; T-922 inceleme MINOR-2) |
| B-67 | Cari kişisel alanlarının görünürlüğünü daralt; `settings.manage`'i böl; kullanılmayan `takeout.request` 🔒 |
| B-75 | İlk kullanım rehberi (Kabuk.dc.html onaylı): her ekran ilk açılışta ≤ 5 adım, yaparak ilerleme, sesli anlatım, görüldü bilgisi sunucuda kullanıcıya bağlı, üst çubuk "?" ile tekrar; adım metinleri tek kaynakta + rehberi olmayan ekran bekçisi |
| B-64b | E2E rastgele düşme ("strict mode violation: 2 elements") → **T-965 (KODDA VAR)**: kök neden — kiracı yerleşimindeki `Suspense` sınırı her SSR'da askıya düşüyordu (Flight akışı); `fallback={children}` sayfayı görünür yedek + gizli `S:` kopyası olarak İKİ KEZ veriyordu (`$RC` değişimine kadar). Yerleşim `force-dynamic` olduğundan Suspense gereksizdi, kaldırıldı; `fallback={null}` denemesindeki theme-admin düşmesi içerik geç açılırken beklemeyen `appMenuReachable` yarışıydı |
| B-64c | main `6c3c877` e2e-shard (desktop) paket testleri "Ürün ara" sonucu gelmiyor → **BİTTİ T-970**: kök neden — `completeFirstUseGuide` içindeki `waitForFunction("() => {...}")` dizesi fonksiyon nesnesi döndürdüğü için hiç beklemiyordu; yavaş CI'da rehber tamamlanmadan dönülüyor, paket ekranında rehber kipli açılıp arka planı `inert` yapıyor, `fill()` metni kayboluyordu (CI snapshot: rehber açık, arama kutusu boş). `expect.poll(page.evaluate(...))` ile düzeltildi; uygulama kodu değişmedi | T-970 |
| B-68 | Defter–bakiye denetiminin ölçeği (her yazımda tüm geçmiş toplamı) — checkpoint tasarımı |
| B-76 | Güvenilen cihaz "Bu cihazı 30 gün hatırla" (yönetici her girişte kod girmesin; kullanıcı kararı 20 Ekim) — T-923 (KODDA VAR); kalan: güvenilen cihaz listesi + tekil iptal arayüzü (sunucu tarafı toplu iptal var) |

## Eklemeler (kullanıcı onayı 20 Ekim)
| ID | İş |
|---|---|
| B-80 | Face ID / parmak iziyle giriş (passkey/WebAuthn; ADR-026 sonraki eklemeler) |
| B-81 | Anlık bildirim (web push): kritik stok, geciken sipariş, bildirilen sorun — rol ve depo kapsamına göre |
| B-82 | Ayın personeli / performans ekranı (okutma ve görev verisinden; Modüller'de "YAKINDA") |
| B-83 | Satın alma önerisi listesi: minimum altındaki ürünler için "şu kadar al" (Pano satın alma altyapısı) |
| B-84 | **Destek talebi (kullanıcı kararı 20 Ekim):** her kullanıcı üst çubuktaki Destek ikonundan bize yazar (konu, kısa not, otomatik ekran/sürüm/destek kodu, isteğe bağlı ekran görüntüsü). Talep yonet.etkinyazilim.com'da müşterinin Destek sekmesine ve genel gelen kutusuna (rozetli) düşer. Talepten tek tıkla "Erişim iste" (mevcut destek erişimi akışı) ve yanıt verilir; yanıt kullanıcının ekranına döner. Operatöre WhatsApp bildirimi gider: kullanıcı kararı 20 Ekim, ücretsiz kısa yol **CallMeBot** (resmi değil; anahtarı kullanıcı sunucu ortamına kendisi ekler; mesajda müşteri verisi yok, yalnız "yeni destek talebi #no" + panel bağlantısı). Asıl kayıt panel rozeti; kalıcı yol B-81 web push (panel için de); Meta Cloud API ileride. Tuval → onay → birebir (I-18). Kiracı verisi RLS'li; operatör okuması panel rolüyle denetimli |
| B-85 | **Üst çubukta iki anlaşılır ikon (kullanıcı kararı 20 Ekim):** "Sorun bildir" (hasarlı, eksik, yanlış ürün → kendi yöneticisine; mevcut `problem-sheet`) ve "Destek" (bize, B-84). Alt çubuğun sol düğmesi her ekranda Geri olur; sarı "?" kalkar. Kabuk.dc.html tuvalinde güncelleme → onay |
| B-86 | **KODDA VAR (T-969)** — Alt çubuk OKUT eski "Saha" iş seçme menüsünü açıyordu (kullanıcı 20 Ekim, telefon). `/field` artık doğrudan okutma (KalipSaha (a)): kamera hemen açık, NFC / Kodu yaz, el terminali; okutulan kod sunucuda çözülür (`resolveFieldScan`: ürün → bekleyen kabul ya da ürün kartı, raf → yerleştirme ya da stok, teslim no → kabul, tanınmayan → kırmızı + tekrar okut); `stock.post` yoksa okuma görünümü + kilit gerekçesi. Kalan: gerçek cihaz denemesi (B-56), paket QR akışı açılınca (B-50) aynı ekrandan |
| B-87 | Ana ekranda sağda yüzen ızgara düğmesi (`pano-fab`, sürüklenebilir kısayol halkası) alt çubuktaki Modüller ile aynı görünüyor; kullanıcı kopya olarak algıladı (20 Ekim). Pano/Gruplar/Aktar onaylı kaynağında var (I-18) → kaldırma veya farklılaştırma B-85 tuval güncellemesiyle birlikte onaya sunulur |
| B-84 | **Destek talebi (kullanıcı kararı 20 Ekim):** her kullanıcı üst çubuktaki Destek ikonundan bize yazar (konu, kısa not, otomatik ekran/sürüm/destek kodu, isteğe bağlı ekran görüntüsü). Talep yonet.etkinyazilim.com'da müşterinin Destek sekmesine ve genel gelen kutusuna (rozetli) düşer. Talepten tek tıkla "Erişim iste" (mevcut destek erişimi akışı) ve yanıt verilir; yanıt kullanıcının ekranına döner. Operatöre WhatsApp bildirimi gider: kullanıcı kararı 20 Ekim, ücretsiz kısa yol **CallMeBot** (resmi değil; anahtarı kullanıcı sunucu ortamına kendisi ekler; mesajda müşteri verisi yok, yalnız "yeni destek talebi #no" + panel bağlantısı). Asıl kayıt panel rozeti; kalıcı yol B-81 web push (panel için de); Meta Cloud API ileride. Tuval → onay → birebir (I-18). Kiracı verisi RLS'li; operatör okuması panel rolüyle denetimli — **KODDA VAR (T-967, PR #133)**, dal `feat/T-967-support-tickets`, canlı değil: arka uç 0054 + domain + `support.notify` (CallMeBot) + panel `/support` + Destek penceresi; ekran görüntüsü eki sonraki tur; "Erişim iste" pasif (destek erişimi akışı yok) |
| B-85 | **Üst çubukta iki anlaşılır ikon (kullanıcı kararı 20 Ekim):** "Sorun bildir" (hasarlı, eksik, yanlış ürün → kendi yöneticisine; mevcut `problem-sheet`) ve "Destek" (bize, B-84). Alt çubuğun sol düğmesi her ekranda Geri olur; sarı "?" kalkar. Kabuk.dc.html tuvalinde güncelleme → onay — **KODDA VAR (T-967, PR #133)**, canlı değil |
| B-86 | Alt çubuk OKUT eski "Saha" iş seçme menüsünü açıyor (kullanıcı 20 Ekim, telefon). OKUT doğrudan kamera/okuyucu ile okutmayı açmalı: okutulan koda göre ürün, raf veya görev bulunup ilgili işe geçilir. B-50 QR akışı ve B-63 saha ekranlarıyla birlikte |
| B-87 | Ana ekranda sağda yüzen ızgara düğmesi (`pano-fab`, sürüklenebilir kısayol halkası) alt çubuktaki Modüller ile aynı görünüyor; kullanıcı kopya olarak algıladı (20 Ekim). Pano/Gruplar/Aktar onaylı kaynağında var (I-18) → kaldırma veya farklılaştırma B-85 tuval güncellemesiyle birlikte onaya sunulur — **KODDA VAR (T-967, PR #133)**, canlı değil |
| B-88 | Destek talebine ekran görüntüsü eki (B-84 kalanı, T-967 sonrası): depolama + boyut/tür sınırı + kiracı izolasyonu + operatör erişim denetimi; Destek penceresindeki gizli düğme açılır |
| B-89 | Destek "Erişim iste": projede müşteri onaylı, süreli destek erişimi akışı yok (I-12 denetimli); panelde düğme şimdilik pasif (T-967) |
| B-90 | Destek: müşterinin kendi talebini "Çözüldü" ile kapatması (tasarımda var, DB'de müşteri → CLOSED geçişi yok; T-967) ve not alanında sesle yazma (şimdilik "yakında") |
| B-91 | **BİTTİ (toplu yayın 21 Ekim, int/21ekim-ekranlar)** — `docs/design/ALTIN-KURAL.md` kullanıcının 20 Ekim kararıyla güncellendi: üst çubukta yazısız iki ikon (Sorun bildir → yönetici, Destek → Etkin ekibi), alt çubuğun sol düğmesi her ekranda Geri, rehber tekrar Destek penceresinden. Eski kayıt: kural "ana ekranda Geri yerine sarı ? Sorun" ve "üst çubuktaki ? ile rehber" diyordu |
| B-92 | BİTTİ PR #135 (T-971) — Kalıp ekranlarında çıkış/hesap erişimi: `KalipEkran` üst çubuğunun sağ üstünde (`actions` yuvasından ayrı öğe) Pano'nun Hesap düğmesi + menüsü (`.tb.tb-team` + `.halo.tmenu`, ortak `pano/hesap-menu.tsx`): Kullanıcı değiştir, Tüm ekranlar (Akış/Genel bakış + yetkili ekranlar), tema, Çıkış yap |

## Belge düzeltmeleri
| ID | İş |
|---|---|
| B-70 | STATE.md 93 satır (kural ≤80); başlık tarihi 17.10 ama 19 Ekim kayıtları var; "MAIL_MODE disabled" ve "sahip/yönetici Görevlerim'de" satırları eskimiş |
| B-71 | T-430 kimlik çakışması (STATE: müşteri sil/sıfırla; `tasks/T-430.md`: Ekip ekranı) |
| B-72 | Spec `outbox_events` tablosu yok — I-07 pg-boss aynı transaction ile karşılanıyor; spec güncellensin |
| B-73 | README "Yayın kaynakları" Neon satırı eskimiş |
| B-93 | CI `deps` kırmızı (21 Ekim, T-973 PR #137'de görüldü): GHSA-587h-7wmj-h5pm vitest > vite ≤ 8.3.2 high. Çözüm: kök devDependency `vite@8.3.3` (+ STACK satırı) ya da ci.yml muafiyeti (dev zinciri, Windows-only); ikisi de korunan dosya → supervisor onayı + security-reviewer özeti gerekir | — |
