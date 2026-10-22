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
| B-124 | Sürüm kayması kalıcı çözümü: imaj derlemesinde sabit `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (sır, GitHub + VPS) ve/veya `deploymentId = <git sha>` (korunan Dockerfile/CI; ayrı PR + onay). Bugün T-990 eski sayfayı tanıyıp "Uygulama güncellendi — Yenile" diyor; kimlikler yine her yayında değişiyor |

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
| B-51 | **KODDA VAR (T-977, PR #140), canlı değil** — Sayım saha (`/field/count`: rafı okut → ürünü okut/seç → sayı → kaydet; kör sayımda referans gizli, sayılmayan ürün uyarısı; kör olmayanda fark uyarısı; onaya gönder) + yönetici (`/counts`: başlat + raf görevleri, fark incelemesi, onay [görev ayrılığı domain'de], fiş, iptal). Kalan: B-96 | T-977 |
| B-52 | Toplama saha ekranı **KODDA VAR (T-977, PR #140)**: `/field/pick` (raf okut → ürün okut/doğrula → miktar → onay; eksikte uyarı) + saha sevk `/field/ship` (satır → miktar → yükleme onayı); OKUT ve Görevlerim bağlı. Kalan: iade ekranı (domain `returns.ts` var), B-96 | T-977 |
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
| B-62 | **KODDA #158 (T-1002) — STT + niyet + Anladım; TTS ve VPS ses servisi kurulumu kalan** — Etkin sesli komut (T-424; Kabuk.dc.html onaylı): bas-konuş / iki dokunuş uzun dinleme ("bitti"), stok/yetki değiştiren komutta "Anladım" onay kartı, okuma komutu doğrudan sonuç; sesli geri bildirim — teknoloji (20 Ekim kullanıcı kararı, Q-129): yerel faster-whisper + Silero VAD, ses için EMA Lightning; ilk adım ölçüm (model seçimi) |
| B-63 | Tasarım kaynağı olmayan ~49 ekran (stok, kabul, sevk, üretim, etiket, ayarlar, saha) için tuval → birebir aktarım (I-18). Saha: OKUT + Kabul + Yerleştirme KalipSaha kalıbında (T-969, KODDA VAR); **grup A KODDA VAR (T-973):** paketli kabul (Form kabı), paket etiketleri (Liste kabı; baskıda üst/alt çubuk yok), saha paket akışı (Saha kalıbı), Görevlerim (Liste kalıbı, saha görünümü) — işlev/eylem/idempotency/I-15 aynı, düğme adları ve test kimlikleri korunur |
| B-60 | Ortak alt ekran çubuğu (Geri + Ana ekran · ana işlem · Etkin) + kaydedilmemiş iş uyarısı (T-423 kalanı); eski `BottomNav`/`screen-nav` emekliye; e2e'ye tablet (768–1199) projesi |
| B-61 | Ortak ses/geri bildirim modülü (`beep()` üç kopya); saha akışlarına sesli geri bildirim |
| B-63 | **İlerleme 20 Ekim: kalıp temeli + Ayarlar + Ürünler KODDA VAR (T-968); grup 1 KODDA VAR (T-971): Depolar + lokasyon ağacı, Cariler, Üyeler/Saha personeli/Cihazlar/Katılma, Kim ne yaptı?, Görevler, Etiket yazdır** — 4 kalıp kaynağı (Liste/Form/Detay/Saha) + ortak bileşenler `app/t/[slug]/kalip/`; kalan ekranlar yalnız kalıbı kullanarak geçer; Saha kalıbı ekran kodu sırada. Tasarım kaynağı olmayan ~49 ekran (stok, kabul, sevk, üretim, etiket, ayarlar, saha) için tuval → birebir aktarım (I-18). Kullanıcı 20 Ekim'de canlıda gördü: **Ayarlar** hâlâ eski görünümde (Kolay mod üst çubuğu, sol Ayarlar/Geri/Ana ekran kutusu, düz form, turuncu Kaydet); alt cam çubuk ve ikonlu yapı yok — önce Ayarlar tuvali |
| B-63 | **grup 2 KODDA VAR (T-972)** — Stok durumu (liste), Stok işlemleri (liste + belge detayı + giriş/çıkış/transfer formu), Beklenen teslimler (liste + `?new=1` form), Sevkiyat (liste + sipariş detayı + yeni sipariş), Üretim (liste + reçete detayı/üretim + yeni reçete) kalıpta; işlev/eylem/yetki/I-15 aynı. Kalan: ~~`receipts/packages`, saha paket akışı, `/field/tasks`~~ grup A KODDA VAR (T-973); türe/duruma göre sunucu süzgeci yok (çipler bölüm geçişi); detay ekranlarında kaydedilmemiş iş uyarısı yok |
| B-63 | **grup B KODDA VAR (T-974)** — eski açılır pencereler (yeni depo/lokasyon, kod değiştir, toplu raf, üye davet, görev ata/iptal, yeni ürün çerçevesi, tüm onay pencereleri) tek kalıp penceresinde (`kalip/pencere.tsx`; telefonda alt cam sayfa, masaüstünde ortada); Yardım, Davet kabulü, Parola sıfırlama, Çalışma alanı sihirbazı giriş tasarım dilinde (`giris-ui.tsx`). 2FA kurulum ekranı, yeni ürün / toplu raf pencere alanları ve ortak `Typeahead` (`variant="kalip"`, "Üst lokasyon") da geçti (koordinatör ekleri). Eksik yok |
| B-63 | **T-978 KODDA VAR (PR açılacak, dal `fix/T-978-kalip-kalanlar`)** — kalanlar: okutma paneli `ScanPanel` + `@wms/ui` `ScanField` `variant="kalip"` (koyu tema; saha kabul/yerleştirme/paket, paketli kabul, kalıp Typeahead); Görevlerim arama + tür/durum çipleri (sunucu `listMyTasks` kind/status/q); Depolar, Üyeler, Görevler, Kim ne yaptı? sunucu araması (ILIKE, kapsam/RLS aynı) + `KalipAra`; eski `SetupGuide`/`FormSection` silindi; eski `FormSteps` kalıp kabında kalıp diliyle. Ayrıntı [T-978](tasks/T-978.md) | T-978 |
| B-63 | Tasarım kaynağı olmayan ~49 ekran (stok, kabul, sevk, üretim, etiket, ayarlar, saha) için tuval → birebir aktarım (I-18). **Saha ilerlemesi (T-969, KODDA VAR):** OKUT, Kabul ve Yerleştirme Saha kalıbında (KalipSaha: Okut · Doğrula · Miktar; sayı tuşları, TÜMÜ, fazla uyarısı, ONAYLA, başarı perdesi); paket akışları ve /field/tasks eski görünümde. **T-977 (KODDA VAR, PR #140):** saha Toplama (`/field/pick`), Sevk (`/field/ship`), Sayım (`/field/count`) Saha kalıbında; yönetici Sayımlar (`/counts`) Liste/Detay/Form kalıbında. Kullanıcı 20 Ekim'de canlıda gördü: **Ayarlar** hâlâ eski görünümde (Kolay mod üst çubuğu, sol Ayarlar/Geri/Ana ekran kutusu, düz form, turuncu Kaydet); alt cam çubuk ve ikonlu yapı yok — önce Ayarlar tuvali |
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
| B-121 | **BİTTİ #151 (T-990)** — Ekleme/düzenleme tam ekran form standardı (kullanıcı kararları 20–21 Ekim): `KalipFormEkran`, yerel `<select>` yok (seçim kutuları / aramalı seçim), ürün kodu önerisi hatası (eski Server Action kimliği), tek tip çıkış uyarısı, Kaydet asla sessiz değil, tek ortak buzlu perde; ALTIN-KURAL 17 kural metni |
| B-122 | **BİTTİ #151 (T-990b)** — ESLint `wms/ui-standard` (`window.confirm`/`alert`, `beforeunload` ortak bileşen dışı, kiracı ekranında JSX `<select>`/`<dialog>`, satır içi `backdropFilter`, kalıp dışı `kperde`/`cfback`) + PR şablonunda "ALTIN-KURAL kontrolü" |
| B-123 | T-990 kalanı: belge formlarının İÇİ (mal kabul `receipt-form`, sevk `shipping-form`, üretim `production-form`, stok belgeleri `document-form`, sayım `counts-forms`) hâlâ eski `@wms/ui` Button/TextField/Banner → `KalipFormEkran` + kalıp alanları; bu belgelerde React durumundaki değişiklik (eklenen satır) `data-dirty` vermedikçe çıkış korumasını tetiklemez |
| B-125 | T-990 küçük kalanlar: toplu raf oluşturucu `KalipFormEkran` yerine `KalipEkran` + `useCikisKorumasi`; ilk depoda önerilen "Ana depo" adı değişiklik sayılıyor; tarayıcı geri tuşu (popstate) `?new=1` formundan uyarısız çıkıyor; eski kabuk (`more-sheet.tsx`, `app-bar.tsx`) `<dialog>` istisnası (B-95 ile kalkar); `packages/ui/src/select-field.tsx` kullanılmıyor |
| B-126 | **BİTTİ #150 (T-436)** — ALTIN-KURAL 5–17 ortak katman: tek ses + "Sessiz", yükleniyor/iskelet, hata/bulunamadı ekranı, boş durum + toplam, çevrimdışı şeridi, "Geri al", Esc/odak, dokunma boyutu, hareketi azalt, "Otomatik" tema, dile göre biçim (ESLint `wms/no-fixed-locale`, T-436b), yetkisiz dokunuş |
| B-127 | T-436 kalanları: (1) denetim (audit) listesi toplam sayısı — kapsam süzgeçli COUNT performans kararı; (2) sayımlar listesi gerçek sayfalama + toplam; (3) detay iç kartlarının boş metinleri (sevk "görev yok", sayım "satır yok") ikon + düğmeye; (4) `lib/sheet/read.ts` sabit `SAYFA n` yedeği çeviriye; (5) kalan özel perdeler (Aktar sütun seçimi, Ekip ekleme sayfası, DzRoot overlay) `KalipPerdeKatman`'a; (6) ürün/depo/lokasyon "arşivden çıkar" eylemi gelince Geri al'a geçer; (7) yeni ortak katmanların tasarım/uygulama ekran görüntüsü karşılaştırması (I-18) UNKNOWN |
| B-128 | T-436b ESLint `wms/no-fixed-locale` kapsam açıkları (security-reviewer MINOR ×2, 22 Ekim): hesaplanmış üye çağrısı (`o["toLocaleString"]("tr")`) ve `localeCompare(x, "tr")` / sonraki argümandaki sabit dil yakalanmıyor; korunan dosya → ayrı PR + security-reviewer |

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
| B-93 | **BİTTİ PR #138 (T-976)** — CI `deps` kırmızı (21 Ekim, PR #136 T-974'te görüldü; main kilidi aynı): `vitest`→`vite` 8.3.2 high advisory GHSA-587h-7wmj-h5pm (launch-editor, Windows; yama ≥8.3.3). Kilit dosyasında yalnız `vite` 8.3.3'e çekildi (manifest/override yok); korunan kilit → security-reviewer + supervisor onayı (ADR-012) |
| B-94 | **BİTTİ (T-979, PR açılacak)** — Eski görünüm kalanları (T-978 taraması): Kokpit görünümü (`view=cockpit` → `task-menu.tsx`) kalıba/Pano'ya geçmedi (kullanıcı kararı "Kokpit şimdilik aynı" — karar gerekirse); `/` karşılama sayfası (yalnız demo/kayıt açık ortamda); sevk toplama formu iç alanları (`shipping/shipping-form.tsx`) eski Tailwind; kalıp ekranlarının içinde eski `Banner`/`rounded-card` parçaları (ürünler, ürün kartı, beklenen teslimler, depolar, lokasyon ağacı, saha paket akışı) | — |
| B-95 | **BİTTİ (T-979, PR açılacak)** — Eski kiracı kabuğunu emekliye ayır: `layout.tsx` hâlâ `AppBar` + `ScreenShell` + `BottomNav` sarıyor (kalıp ekranlarında CSS ile gizli). Kokpit (B-94) geçince kaldırılır; e2e `mobile-shell`, `touch-screens` (`screen-shell`, `--screen-mode`), `theme-screens`, `support/items-screen.ts` bu parçalara bağlı, birlikte güncellenmeli | — |
| B-96 | T-977 sonrası saha eksikleri: (1) toplamada "ürün hiç yok" barkodsuz bildirilemez (`confirmPick` ürün barkodu ister; rafta ürün yoksa okutulacak barkod da yok) → domain'de görev kimliğiyle "bulunamadı" yolu; (2) toplama eksiğinden doğan oturumsuz COUNT görevi sahada açılmaz (önce yönetici `/counts`'ta o rafa sayım başlatır) → görevden tek dokunuşla sayım başlatma; (3) OKUT'ta sipariş numarası okutup sevke gitme yok; aynı raf kodu birden çok depoda varsa OKUT "belirsiz" der; (4) saha toplama/sevk sayı tuşları tam sayı: ondalık miktarlı görev masaüstü Sevkiyat ekranına yönlendirilir (sayımda ondalık alan var); (5) toplama/sayım/sevk ve `/counts` için onaylı tasarım kaynağı (`.dc.html`) yok — Saha/Liste/Detay kalıbıyla yapıldı, görüntü karşılaştırması kullanıcı kararıyla yapılmadı; (6) `/counts` sayım başlatmada raf kodları tek tek çözülür (en çok 200 ayrı sorgu; güvenlik incelemesi MINOR-2) → domain'de toplu `findLocationsByCodes` |
| B-99 | **BİTTİ (T-979b, PR açılacak)** — Kalıp üst çubuğu düğmeleri (Sorun bildir, Destek, Hesap) telefonda 40–42 px (tasarım kaynağı `KalipListe/Form/Detay.dc.html` boyutu); ALTIN-KURAL ≥ 48 px dokunma hedefi ister → kaynakta düzeltilip port.mjs ile yeniden üretilmeli (T-979 CI ölçümünde görüldü) | — |
| B-100 | **BİTTİ (T-979b, PR açılacak)** — Uygulama menüsü penceresi (`t/[slug]/app-menu.tsx`: Akış/Genel bakış, çalışma alanı, yönetim sayfaları, Yardım, Çıkış) hâlâ eski Tailwind görünümünde (koyu tema yok); kalıp penceresi (`kalip/pencere.tsx`) diline geçmeli (T-979'da işlev korunarak bırakıldı) | — |
| B-101 | **Satış sitesi demo formu geri bildirimi (kullanıcı kararı 21 Ekim):** başarıda alanlar yumuşakça kaybolur, aynı kutuda yeşil daire içinde çizilen √, "Talebiniz başarıyla gönderildi", 1 iş günü satırı, kısa talep no (sunucu kimliği), "Ana sayfaya dön"; odak başlığa + aria-live; gönderirken dönen gösterge + çift gönderim engeli; hatada bilgiler kalır, yumuşak kırmızı "Gönderilemedi · tekrar dene"; alan altı doğrulama; ses; TR+EN — **BİTTİ #144 (T-431; birleşmedi, canlı değil)** |
| B-102 | Demo başarı kutusunda "Hemen konuşalım" (WhatsApp `wa.me`) bağlantısı yok: sitede/ayarda herkese açık WhatsApp numarası yok (`CALLMEBOT_PHONE` operatör bildirim sırrıdır, kullanılmaz). Kullanıcı numarayı verince (tercihen panel Satış sayfası içeriğine alan) bağlantı eklenir |
| B-103 | **BİTTİ #148 (T-445)** — Kart numaraları T-915…T-999 doldu; bekçi `scripts/guards/lib/cards.mjs` (`WORK_BRANCH`, `MERGED_BRANCH`) ve `quarantine.mjs` (korunan yol `scripts/guards/**`, kullanıcı onayı gerekir) yalnız 3 haneli `T-\d{3}` kabul ediyor → T-1000+ dalı CI'da `CARD_NOT_FOUND`. T-431 boş 3 haneli numarayla açıldı. Karar: regex `\d{3,4}` (ayrı PR + bekçi testi) ya da numara aralığı kuralı (BACKLOG başı "T-915+") güncellensin |
| B-104 | **BİTTİ PR #143 (T-999c; birleşmedi, canlı değil)** — Canlı hata (kullanıcı 21 Ekim): Ayarlar > Dil English yapılınca arayüz İngilizce olmuyordu. Kök neden: dil `tenant_settings.locale`'e kaydediliyordu ama `i18n/request.ts` yalnız `locale` çerezi (yazan kod yok) + tarayıcı diline bakıyordu. Düzeltme: tenant sayfalarında çalışma alanının dili (çerez → alan dili → tarayıcı → tr), kayıtta yeniden çizim; paket etiketi önizlemesindeki sabit Türkçe metinler mesaj dosyasında; tr/en anahtar bekçisi + e2e `zz-locale` |
| B-105 | T-999c kalanları: (1) kullanıcı başına dil tercihi yok; tenant dışı sayfalar (`/login`, `/help`, `/workspaces`, `/mfa`) tarayıcı diliyle açılır; (2) saat dilimi arayüzde sabit `Europe/Istanbul`; (3) sunucu/istemci biçimlemede sabit `"tr"` yerel ayarları (`toLocaleUpperCase("tr")` vb.) taranmadı (T-numara alanının tükenmesi: B-103) |
| B-106 | CI eşzamanlı iş sınırı: bir PR artık 14 `ci` + guards işi açar; aynı anda 2+ PR'da GitHub ücretsiz plan eşzamanlı iş sınırı (20) kuyruk yaratabilir. Ölçülürse parça sayısı ya da `changes` filtresi genişletilir (T-445 ölçümü PR gövdesinde) |
| B-107 | **T-450 iOS sanal kamera + ≤1,5× zoom #157; gerçek iPhone doğrulaması hâlâ bekliyor** — iPhone'da OKUT hızını gerçek cihazda doğrula (T-446); yetmezse ücretli SDK (STRICH/Dynamsoft/Scandit) ya da yerel uygulama kararı |
| B-108 | **#150 ALTIN-KURAL 5–17 birleşti #150 (T-436)** — **#151 tam ekran form + #152 UI lint birleşti #151 (T-990)** — **#146 Excel/Bağlantılar birleşti #146 (T-981b)** — **#145 QR paylaş birleşti #145 (T-986b)** — YARIM PR'ları bitir (T-447): #145 QR paylaş, #146 Excel/Bağlantılar, #151 tam ekran form + kurallar 1–4, #152 UI lint, #150 kurallar 5–17 — main merge + `pnpm prepush` + sıralı birleştirme |
| B-109 | Tuvale (Claude Design) T-979c orta etiket ve T-979b 48 px düzeltmelerini işle (kaynak `docs/design/source` ile eşitle) |
| B-110 | ERP · Paraşüt canlı ilk bağlantıda doğrula: token gövdesi, irsaliye deposu/cari türü, 429 (T-991) |
| B-111 | ERP · Logo entegrasyonu — ürün bilgisi bekleniyor (Tiger/Go/İşbaşı; aynı altyapı) |
| B-112 | **BİTTİ #146 (T-981b; Paraşüt bağlandı, Logo YAKINDA — B-111)** — ERP · Ayarlar › Bağlantılar Paraşüt/Logo kartını `/integrations`'a bağla (T-981b ile) |
| B-113 | ERP · CHECK durumundaki irsaliyeyi ekrandan çözme |
| B-114 | ERP · Aynı bağlantıda iki koşu çakışmasını kilitle (MINOR-1) |
| B-115 | ERP · Paraşüt yanıtını akışla oku, 5 MiB'de kes (MINOR-5) |
| B-116 | ERP · Paraşüt sipariş karşılığı — kullanıcı kararı |
| B-117 | **BİTTİ #145 (T-986b)** — Ekip › "Saha personeli: katılma QR'ı" paylaşma (kullanıcı isteği 21 Ekim): alt çubuk ortası PAYLAŞ (sistem paylaşım sayfası; yoksa satıra odak), kartın altında WhatsApp ile gönder (`wa.me/?text=`), Bağlantıyı kopyala (2 sn yeşil tik + "Kopyalandı", ses/balon yok — kullanıcı kararı 21 Ekim; `aria-live`), QR'ı indir (PNG), Yazdır; demoda kilitli + sarı balon; Ekibe katılma ekranında aynı satır. Ekip, Gruplar, Aktar üst çubuğuna Sorun bildir + Destek + Hesap (ortak `ust-dugmeler.tsx`) |
| B-118 | T-986b kalanları: (1) `Paylas.dc.html` ajan taslağı, tuvalde yok → tuvale alınıp kullanıcı onayı + ekran görüntüsü karşılaştırması; (2) `KalipEkran` üst çubuk Hesap/Destek mantığı `ust-dugmeler.tsx` ile ikinci kopya → KalipEkran bu bileşeni kullansın; (3) Ekibe katılma ekranında ana işlem QR OLUŞTUR/YENİLE kaldı (yenileme başka yerde yok), PAYLAŞ değil; (4) gerçek telefonda sistem paylaşım sayfası (WhatsApp/Mesajlar/e-posta) denemesi UNKNOWN; (5) kopyalamanın sessiz olması ALTIN-KURAL 3'e kullanıcı kararıyla istisna — ALTIN-KURAL metnine yazılmalı |
| B-119 | **BİTTİ #146 (T-981b)** — Ekran bazlı Excel (kullanıcı isteği 21 Ekim): Ürünler, Cariler, Depolar ve lokasyon ağacında üst çubukta yetkiye bağlı Excel düğmesi + buzlu menü (İçeri al / Güncelle / Dışarı aktar); `.xlsx` dışa aktarma (`data.import`, depo kapsamı, cari kişisel alanları yalnız `settings.manage` + yeniden doğrulama, 5.000 satır, dakikada 6, `data.exported` audit); Aktar'da "koda göre güncelle" kipi + yeni kod ekle/atla, depo ve raf içe aktarma; Ayarlar › Bağlantılar sekmesi (alan + işlem seçimi, boş şablon, Paraşüt → Entegrasyon ekranı) |
| B-120 | **(2) yerel `<select>` BİTTİ #151 (T-990)** — T-981b kalanları: (1) Excel menüsü ve Bağlantılar ekranı tuvalde yok → tuvale işlenip kullanıcı onayı + ekran görüntüsü karşılaştırması; (2) tarayıcının kendi `<select>`'i hâlâ iki yerde — Aktar 3. adımda çok sayfalı Excel'de sayfa seçimi (`import/aktar-view.tsx`) ve Ayarlar saat dilimi "Diğer" listesi (`settings/settings-view.tsx`); `KalipPencereSecim` (`kalip/pencere.tsx`) yerel `select` sarar → ortak kalıp seçim penceresine (buzlu perde + ikonlu liste) geçirilmeli; (3) sesle Excel komutu (B-62) |
| B-129 | Etkin sesli yanıt (EMA Lightning, `/tts`, rakam/kısaltma ön çevirisi; "Sessiz" tercihi) — ikinci PR (B-62 kalanı; torch CPU imajı büyütür) |
| B-130 | VPS ses servisi kurulumu (root, bir kez): aynı commit'in `release.py`'si `/usr/local/sbin/etkinwms-release` + `update-config.sh` ile yeni `compose.yml`; sonraki yayın ses imajını kendisi gönderir (deploy-vps `check` → `images`/`voice_tree`). Ölçüm: VPS'te `/stt` yanıt süresi (B-62) |
| B-131 | Etkin yetki grubu izni (ekran anahtarı `etkin`: migration `permission_groups_screens_chk` + Gruplar tuvali) — şimdilik `stock.view` olan her üye; yazma onayda mevcut eylem izinleriyle (B-62) |
| B-132 | Etkin canlı yazı (akışlı tanıma) + Modüller arama kutusundaki mikrofon + 390/1180/1440 px görüntü karşılaştırması (B-62 kalanı) |
| B-133 | Etkin güvenlik incelemesi MINOR (T-1002): (1) ses servisi tüm kiracılarca paylaşılır, hız sınırı yalnız kullanıcı başına → kiracı başına `voice` kovası; (2) yayında `up --wait` ses servisinin sağlığını da bekler (bozuk ses imajı web yayınını geri alır) → ses servisini ayrı, başarısızlığı yayını durdurmayan adımda başlat; ayrıca test dosyalarını üretim imajından ayır |

## Belge düzeltmeleri
| ID | İş |
|---|---|
| B-70 | STATE.md 93 satır (kural ≤80); başlık tarihi 17.10 ama 19 Ekim kayıtları var; "MAIL_MODE disabled" ve "sahip/yönetici Görevlerim'de" satırları eskimiş |
| B-71 | T-430 kimlik çakışması (STATE: müşteri sil/sıfırla; `tasks/T-430.md`: Ekip ekranı) |
| B-72 | Spec `outbox_events` tablosu yok — I-07 pg-boss aynı transaction ile karşılanıyor; spec güncellensin |
| B-73 | README "Yayın kaynakları" Neon satırı eskimiş |
