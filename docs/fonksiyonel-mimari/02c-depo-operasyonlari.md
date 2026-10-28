# 2C. Depo operasyonları (wms.etkinyazilim.com) — ekran, aksiyon ve veritabanı eşlemesi

Bu bölüm depoda **her gün yapılan işleri** anlatır: ana ekran, görevler, okutma (OKUT), yerleştirme, paket işlemleri, depolar arası transfer,
sipariş–toplama–sevkiyat, sayım, üretim, iade, işlem kaydı (Kim ne yaptı?), raporlar ve sesli komut (Etkin).

Kaynak: `main` dalındaki kod — **main 8e2710d · 28 Ekim 2026** (ilk sürüm 36f3a13 · 23 Ekim'den yazılmıştı; aradaki T-1029…T-1109
değişiklikleri işlendi). Tahmin yok; her satırda dosya yolu verildi. Web yolları `apps/web/app/t/[slug]/` altına göredir. Mal kabul, stok listesi,
ürün kartı ve stok belgeleri (giriş/çıkış formu) **2B** bölümündedir; burada yalnız bağlantı noktası anılır.

## Etiketlerin anlamı

| Etiket | Anlamı (bu belgede) |
| :--- | :--- |
| [TAMAMLANDI] | Ekran → sunucu eylemi → iş kuralı → veritabanı zinciri `main` kodunda uçtan uca bağlı ve testli. |
| [GELİŞTİRİLİYOR] | Bir kısmı var: ör. arka uç (iş kuralı + tablo) hazır ama ekranı yok, ya da bir ayarla kapalı, ya da BACKLOG'da "kalan" maddesi var. |
| [PLANLANDI] | Yalnız BACKLOG/şartname/tasarım tuvalinde; kodu yok. |

**Canlı mı?** `main`'e birleşen her iş otomatik yayına çıkar (CLAUDE.md). Bu belgede ekran ekran canlı deneme yapılmadı; canlı durum
`docs/STATE.md` kayıtlarından ayrıca okunmalıdır. Bir satırda "Canlı: UNKNOWN" yazıyorsa kod `main`'dedir ama canlıda denendiği kayıtlı değildir.
28 Ekim itibarıyla STATE bu bölümün ekranlarından yalnız T-446 (hızlı OKUT, 21 Ekim) için açık "canlı" kaydı taşır; 26–28 Ekim işleri
(T-1042…T-1109) STATE'te dal/PR olarak kayıtlıdır, canlı doğrulaması yazılı değildir → UNKNOWN.

---

## 0. Bütün depo işlemlerinin ortak çalışma şekli

Bu ekranların neredeyse hepsi aynı "stok komutu" kalıbıyla çalışır. Bir kez anlarsanız her modülde ne olduğunu bilirsiniz.

### 0.1 Sade anlatım

1. Kullanıcı ekranda düğmeye basar. Ekran tarayıcıda **tek kullanımlık bir anahtar** (`clientKey`) üretir. Bağlantı koparsa aynı anahtarla tekrar
   gönderilir; sistem işlemi **ikinci kez yapmaz**, ilk sonucu geri verir (buna *idempotency* = "tekrar güvenliği" denir, kural I-06).
2. İstek sunucudaki **sunucu eylemine** (*server action*: ekranın arkasındaki küçük sunucu fonksiyonu, ör. `postShipmentAction`) gider.
   Eylem oturumu, firmayı (kiracı/tenant) ve yetkiyi doğrular, istek hızını sınırlar (`apps/web/lib/action-guard.ts` → `limitVerifiedTenant`).
3. Eylem **iş kuralı katmanını** (`packages/domain/src/...`) çağırır. Stok değiştiren her iş `executeStockCommand` ile tek bir veritabanı
   işleminde (*transaction*: ya hepsi kaydolur ya hiçbiri) yürür (`packages/domain/src/stock/command.ts`):
   yetki → depo kapsamı → tekrar kaydı → **stok kilitleri** (`acquireStockLocks`, aynı rafa iki kişi aynı anda yazamasın; kural I-15) →
   iş kuralları → stok defteri + bakiye → **denetim kaydı** (`audit_logs`) → belge numarası → sonuç.
4. Kural ihlalinde (ör. stok yetersiz) **hiçbir şey yazılmaz**; ret, ayrı kısa bir kayıtla "reddedildi" olarak saklanır.
5. Geçici çakışmada (aynı anda iki kişi) sistem en çok 3 kez kendiliğinden yeniden dener.

### 0.2 Bu kalıbın dokunduğu ortak tablolar

| Tablo | Ne tutar (sade) |
| :--- | :--- |
| `documents` / `document_lines` | Stok fişi başlığı ve satırları. Tür (`kind`): `STOCK_IN` giriş, `STOCK_OUT` çıkış, `STOCK_MOVE` taşıma, `REVERSAL` ters kayıt, `COUNT_ADJUSTMENT` sayım farkı. Durum (`status`): `DRAFT` taslak → `APPROVED` onaylı → `POSTED` işlendi; `CANCELLED` iptal. |
| `stock_ledger` | **Stok defteri**: her giriş/çıkış bir satır; silinmez, değiştirilmez (I-04). |
| `stock_balances` | Anlık bakiye: `quantity` (eldeki), `reserved_quantity` (siparişe ayrılan). Eksiye düşemez (DB kısıtı `quantity >= 0`). |
| `stock_dimensions` | Stok "kimliği": ürün + raf + durum (`AVAILABLE` kullanılabilir / `QUARANTINE` karantina / `DAMAGED` hasarlı / `BLOCKED` bloke) + lot/seri/paket. |
| `reservations` | Siparişe ayrılan stok. Durum: `ACTIVE` (ayrılmış) → `CONSUMED` (sevkte tüketildi) veya `RELEASED` (serbest bırakıldı). |
| `idempotency_records` | Tekrar güvenliği kaydı: `IN_PROGRESS` / `COMPLETED` / `REJECTED` / `FAILED`. |
| `audit_logs` | Kim, ne zaman, hangi işlemi yaptı (Kim ne yaptı? ekranının kaynağı). |
| `number_sequences` | Fiş numarası sayaçları (firma + tür + yıl). |

### 0.3 Ortak yaşam döngüsü (bütün stok düğmeleri)

```mermaid
sequenceDiagram
  autonumber
  actor K as Kullanıcı
  participant E as Ekran (tarayıcı)
  participant A as Sunucu eylemi
  participant D as İş kuralı (domain)
  participant DB as PostgreSQL
  K->>E: Düğmeye basar (ör. Sevki onayla)
  E->>E: Tek kullanımlık anahtar üretir
  E->>A: İstek + anahtar
  A->>A: Oturum, firma, yetki, hız sınırı
  A->>D: executeStockCommand
  D->>DB: İşlem başlar, tekrar kaydı kontrol
  alt Aynı anahtar daha önce işlendi
    DB-->>D: Saklı sonuç
    D-->>E: Aynı sonuç, ikinci kayıt yok
  else İlk kez
    D->>DB: Stok kilitleri (acquireStockLocks)
    D->>DB: Kurallar, fiş, defter, bakiye, rezervasyon
    D->>DB: Denetim kaydı ve fiş numarası
    D->>DB: İşlemi tamamla
    D-->>E: Başarılı (fiş no)
  end
  E-->>K: Yeşil balon ve ses / hata ise kırmızı balon ve uyarı sesi
```

### 0.4 Roller ve izinler (düğmelerin kimde açık olduğu)

Kaynak: `packages/domain/src/identity/permissions.ts`.

| İzin anahtarı | Sade anlamı | Yönetici (TENANT_ADMIN) | Depo yöneticisi | Toplayıcı (PICKER) | Sayımcı (COUNTER) | Salt okur |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| `stock.view` | Stoğu ve işleri görme | ✓ | ✓ | ✓ | ✓ | ✓ |
| `stock.post` | Stoğu hareket ettirme (yerleştir, topla, sevk, üret, transfer) | ✓ | ✓ | ✓ | – | – |
| `document.create` | Belge/sayım satırı oluşturma | ✓ | ✓ | – | ✓ | – |
| `document.approve` | Onaylama, görev atama/iptal, sipariş ayırma, sayım başlatma | ✓ | ✓ | – | – | – |
| `count_diff.approve` | Sayım farkını onaylama ve işleme | ✓ | ✓ | – | – | – |
| `reversal.create` | Ters kayıt | ✓ | ✓ | – | – | – |
| `audit.view` | Kim ne yaptı? | ✓ | ✓ | – | – | – |
| `settings.manage` | Ayarlar, reçete tanımı, vardiya | ✓ | – | – | – | – |
| `data.import` | Excel içeri/dışarı aktarma | ✓ | – | – | – | – |

Özel **yetki grupları** ile bir kişiye ek izin verilebilir (`stock.post`, `document.create`, `document.approve`, `count_diff.approve`,
`reversal.create`, `data.import`); onay türü izinler iki adımlı doğrulama (MFA) ister. **Depo kapsamı**: bir kişi yalnız atandığı depoları görebilir (A-46).
**Görev ayrılığı** (`tenant_settings.separation_of_duties`, varsayılan kapalı): açıksa sayımı yapan kişi kendi sayımını onaylayamaz.

### 0.5 Kaynakta kapanan ürün (T-1067 / T-1068)

Paraşüt gibi dış kaynakta arşivlenen ya da silinen ürünün kartı `items.source_disposition` (0062) ile işaretlenir. **Yeni kullanım kapanır**
(ör. yeni giriş fişi, reçete/üretim — `production.ts` içinde `assertItemsActive`), ama elde kalan stoğun çıkışı, raf içi taşınması ve sayım
farkı ile önceden açılmış işler tamamlanabilir (`packages/domain/src/stock/reservation-reads.ts` `assertItemsActive`, `allowSourcePending`).
Ret kodu `VALIDATION_FAILED` / `IN_USE`. STATE T-1068 kaydına göre bu davranış canlıdadır.

### 0.6 Ortak kabuk — her ekranda aynı olan parçalar (T-1042, T-1053, T-1102)

Bütün kalıp ekranları (`kalip/ekran.tsx`) ve ana ekran panosu (`pano/pano-shell.tsx`) aynı üst çubuğu ve alt cam çubuğu çizer
(masaüstü standardı `docs/design/STANDART.md` §1).

| UI Bileşeni / Buton / Alan | Tipi | Kullanıcı Aksiyonu | Tetiklenen API / Servis | Etkilenen DB Tablosu & Kolonu | İş Kuralı / Validasyon | Mevcut Durum |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Üst çubuk: canlı saat + tarih | Metin | Görüntülenir | Tarayıcı (`kalip/ust-standart.tsx` `StSaat`) | — | Sunucu çiziminde boş (saat dilimi farkı hatası olmasın) | [TAMAMLANDI] |
| Tema seçici (açık/koyu) | Düğme | Dokunulur | Çerez (`design/theme.ts` `temaYaz`) | — | Telefonda Hesap menüsünde | [TAMAMLANDI] |
| **Son işlemler** (saat simgeli düğme + rozet) | Düğme → pencere | Açılır | `myTodayActionsAction` (`son-islemler-actions.ts`) → `listMyActionsToday` (`packages/domain/src/audit/today-impl.ts`) | Okur: `audit_logs` (yalnız kendi satırları, bugün, firmanın saat dilimi) | `stock.view`; yalnız eylem anahtarı + saat döner; yalnız masaüstünde (≥1100 px); sekme içi önbellek, dakikada en çok bir çağrı | [TAMAMLANDI] (T-1053) |
| Sorun (bayrak) | Düğme → form | Gönderilir | `reportProblemAction` (`work-actions.ts`) | Bkz. Modül 1 "Sorun bildir" | — | [TAMAMLANDI] |
| Destek / Taleplerim | Düğme → pencere | Talep yazılır / yanıtlanır | `submitSupportTicketAction`, `listMySupportTicketsAction`, `replySupportTicketAction`, `markSupportSeenAction` (`support-actions.ts`) | Destek talebi tabloları (0054, RLS + tetikleyici) | Not metni loga yazılmaz | [TAMAMLANDI] |
| Ayarlar, Hesap (baş harf) | Bağlantı / menü | Dokunulur | Yönlendirme | — | Ayarlar yalnız `settings.manage` sahibinde | [TAMAMLANDI] |
| Alt cam çubuk: Geri · Ana ekran · **OKUT** · Modüller · **Etkin** | Çubuk | Dokunulur | `kabuk/kabuk-bar.tsx`; Modüller listesi `kabuk/modules.ts` (rol/yetki/grup ekranları) | — | İstemci içi geçiş; yarım işte ortak çıkış koruması sorar | [TAMAMLANDI] |
| Yüzen kısayol (şimşek) + "Düzenle" | Yüzen düğme + seçici | Kısayol seçilir | `kabuk/kisayol.tsx` (`KabukKisayol`) | — (seçim ve konum yalnız bu cihazda) | En çok 6; yalnız üyenin Modüller'deki modülleri (YAKINDA hariç) | [TAMAMLANDI] (T-1102, her ekranda) |
| İşlem rehberi ("Nasıl kullanırım?") | Buzlu perde + delik + tek satır ipucu | İş yapıldıkça ilerler | `kalip/rehber.tsx` + `rehber-plan.ts` (Mal kabul, Yerleştir, Çıkış, Transfer, Sayım); aktarma rehberi `kalip/adim-rehber.tsx` | — (eylem çağırmaz; durum yalnız cihazda) | Algılanamayan adımda küçük ok; perdeye dokununca yüzen "Kaldığın yerden" | [TAMAMLANDI] (T-1095, T-1100, T-1105) |
| Rehber hoparlörü | Düğme | Dokunulur | `kalip/sesli-oku.ts` (`useSesliOku`) → `etkinSoyleAction` (`etkin/actions.ts`) → iç ses servisi `/tts` | — (metin saklanmaz) | `stock.view`; kişi başına dakikada 30; ≤ 400 karakter; servis yoksa cihaz sesi; "Sessiz" tercihi kapatır | [TAMAMLANDI] kodda (T-1106); VPS ses servisi kurulumu B-130 |

> Not: rehberin "görüldü" bilgisi henüz sunucuda değil, cihazda tutulur (B-75 kalanı).

---

## 1. Modül: Ana ekran (Pano / Görevlerim / Genel bakış)

- **Modül Durumu:** [TAMAMLANDI] mevcut panolar için; **onaylı masaüstü tuvalindeki yeni yönetici ana ekranı [PLANLANDI]** (aşağıda "Tuvalle fark").
  "Tüm raporlar" kartı için bkz. Modül 14 [PLANLANDI]. Canlı: UNKNOWN.
- **Ekran:** `/t/<firma>` — `page.tsx`. Hangi ana ekranın çizileceğine sunucu rol ve `view` çerezine bakarak karar verir.
- **Ekranın Amacı ve İşlevi:** Girişten sonra açılan ilk ekran **role göre** değişir. Her ana ekranda selam aynıdır: "Merhaba <ad>"
  (masaüstü/tablette üst çubukta firma · rol ile, telefonda içerikte; T-1045, T-1050). "Bugün yaptıkların" listesi ana ekrandan kalktı;
  yerini üst çubuktaki **Son işlemler** aldı (Bölüm 0.6, T-1053).
  - **Hesap sahibi (TENANT_ADMIN) → Depo panosu** (`pano/pano-board.tsx`, veri `getBoard` — `packages/domain/src/operations/board.ts`):
    Raporlar kartları (Kritik stok, Bekleyen sipariş, Devir hızı, Satın alma, Sayım farkı, Tüm raporlar), "Dikkat isteyenler" (kritik stok,
    bekleyen sipariş, onay bekleyen sayım, sahadan sorun), "Satın alınması gerekenler", "Bekleyen siparişler", "Stok devir hızı"
    (hızlı / yavaş / hareketsiz ürün), "Bugün depoda" sayaçları (giriş, çıkış, transfer, sayım).
  - **Depo yöneticisi (WAREHOUSE_MANAGER) → Depom panosu** (aynı bileşen, yönetici görünümü): bugünkü iş halkası (biten / atanan /
    atanmayan görev), hızlı kutular (Planla → `/tasks?status=OPEN`, Etiket bas → `/labels`, Raporlar → `/stock`), "Atanmayı bekleyen işler"
    (kişi seçerek **Ata**), "Ekip şu an" (OKUTUYOR / GÖREVDE / BOŞTA / BUGÜN GİRİŞ YOK), "Bugün depoda" sayaçları.
  - İki panoda da üst çubukta **zil** (kritik stok + açık sorun sayısı; sahipte uyarılar bölümüne, yöneticide `/tasks`'a götürür) ve kurulum
    bitmemişse "Merhaba" satırının sağında **Rehber** halka simgesi (kurulum yolculuğu `getSetupJourney`, T-1006/T-1100) vardır.
  - **Toplayıcı / Sayımcı → Görevlerim / Sayımlarım** (`pano/pano-home.tsx`, veri `getWorkSummary` — `operations/work-summary.ts`):
    Giriş, Çıkış, Transfer, Üretim, Sayım bölümlerinde açık iş + kalem sayısı, ACİL rozeti, vardiya satırı, SORUN kartı.
  - **Diğer roller → Görevlerim (Bakış)** (`easy-operations.tsx`, aynı `getWorkSummary`; bölüm döşemeleri ilgili iş ekranına gider).
  - **"Genel bakış" görünümü** (`kokpit.tsx`; `view=cockpit` çerezi, karşılama başlığındaki görünüm seçiminden): "Şimdi" (açık teslimler ve
    yerleştirme görevleri, sıradaki en çok 2 iş doğrudan bağlantı), saha rolünde "Görevlerim" sayısı, yetkiye göre İşler listesi (etkin /
    kilitli / yakında).
- **Arayüz Elemanları ve Aksiyon Tablosu:**

| UI Bileşeni / Buton / Alan | Tipi | Kullanıcı Aksiyonu | Tetiklenen API / Servis | Etkilenen DB Tablosu & Kolonu | İş Kuralı / Validasyon | Mevcut Durum |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| İş halkası ("Bugün n iş · atandı · atanmadı") — yalnız Depom | Grafik halka | Görüntülenir | `getBoard` (`operations/board.ts`) | Okur: `warehouse_tasks.status`, `completed_at` | Yalnız `stock.view`; yalnız kişinin depo kapsamı; değerler gerçek tablolardan (uydurma sayı yok) | [TAMAMLANDI] |
| "Kritik stok" / "Satın alma" kartı + "Satın alınması gerekenler" | Kart (bağlantı) | Dokunulur → `/stock`; satırdaki "+n" → ürün kartı | `getBoard` | Okur: `item_stock_policies.min_quantity/max_quantity`, `stock_balances.quantity` | Kritik = eldeki < min × 0,35; öneri = max − eldeki; satın alma listesi özelliği yok (yalnız bağlantı) | [TAMAMLANDI] |
| "Bekleyen sipariş" kartı + "Bekleyen siparişler" | Kart | Dokunulur → `/shipping` | `getBoard` | Okur: `sales_orders.status='OPEN'`, `sales_order_lines`, `work_priorities` | Siparişte teslim tarihi kolonu yok → "bekleme günü" = oluşturulmadan bu yana | [TAMAMLANDI] |
| "Sayım farkı · onay bekliyor" | Kart | Dokunulur → `/tasks?kind=COUNT` | `getBoard` | Okur: `count_sessions.status='SUBMITTED'` | — | [TAMAMLANDI] |
| "Devir hızı" / "Stok devir hızı" | Kart | Dokunulur → `/stock` | `getBoard` | Okur: `stock_ledger` (son 90 gün çıkış) | Hareketsiz ürün = stoklu ama 90 gün hareketsiz | [TAMAMLANDI] |
| "Sahadan sorun" uyarısı | Kart | Dokunulur → `/tasks` | `getBoard` | Okur: `problem_reports` (açık sayısı, son sebep + dakika) | Sorunu kapatma düğmesi yok → bkz. Gap | [TAMAMLANDI] |
| "Ekip şu an" satırları — yalnız Depom | Liste | Görüntülenir | `getBoard` | Okur: `tenant_memberships`, `warehouse_task_progress`, `audit_logs` | Kişisel veri en az (yalnız durum) | [TAMAMLANDI] |
| "Atanmayı bekleyen işler" → kişi seçimi ("Ata") — yalnız Depom | Liste + kişi düğmeleri | Kişi seçilir | `assignTaskAction` (`tasks/actions.ts`) → `assignTask` (`operations/tasks.ts`); `pano/assign-who.tsx` | Yazar: `warehouse_tasks.status='ASSIGNED'`, `assigned_membership_id`, `version` + `audit_logs` | `document.approve`; kişi listesi `listMembers` (ACTIVE, o görev türünü yapma izni olan, en çok 3 öneri); sürüm kontrolü | [TAMAMLANDI] |
| "Bugün depoda" sayaçları | Sayaç | Görüntülenir | `getWorkSummary` | Okur: giriş/çıkış biten kalem, bugünkü transfer, açık sayım | Gün sınırı `tenant_settings.time_zone` | [TAMAMLANDI] |
| Zil (üst çubuk) | Düğme | Dokunulur | `getBoard` | Okur: kritik stok + açık sorun sayısı | Yalnız yönetici panolarında; ayrı bildirim kutusu yok | [TAMAMLANDI] |
| Rehber halka simgesi | Simge | Dokunulur → kurulum yolculuğu | `getSetupJourney` (`packages/domain/src/onboarding/journey`) | Okur: kurulum durumu | Kurulum bitince görünmez; okunamazsa çizilmez, pano düşmez | [TAMAMLANDI] (T-1100) |
| Görevlerim bölüm kartları (Giriş/Çıkış/Transfer/Üretim/Sayım) | Kart | Dokunulur → ilgili saha ekranı | `getWorkSummary` (`operations/work-summary.ts`) | Okur: `inbound_receipts`, `sales_orders`, `documents`, `stock_document_links`, `warehouse_tasks`, `count_session_lines` | Gün sınırı firmanın saat dilimine göre (`tenant_settings.time_zone`) | [TAMAMLANDI] |
| ACİL rozeti | Rozet | Görüntülenir | `getWorkSummary` | Okur: `work_priorities.urgent` | Yazan ekran yok → bkz. Gap | [GELİŞTİRİLİYOR] |
| Vardiya satırı | Metin | Görüntülenir | `getWorkSummary` | Okur: `tenant_settings.shift_start/shift_end` (varsayılan 08:00–17:00) | Değiştiren ekran yok → bkz. Gap | [GELİŞTİRİLİYOR] |
| "SORUN" kartı / üst çubuk bayrağı → Sorun bildir | Alt sayfa (form, `problem-sheet.tsx`) | Sebep seçilir + not → Gönder | `reportProblemAction` (`work-actions.ts`) → `reportProblem` (`operations/work-signals.ts`) | Yazar: `problem_reports` (`reason`, `note`, isteğe bağlı konu `subject_kind/subject_id`, `status='OPEN'`, `reported_by`) + `audit_logs` | `stock.post` veya `document.create` gerekir (salt okur bildiremez); sebep listesi: `DAMAGED`, `MISSING`, `WRONG_ITEM`, `NO_LABEL`, `LOCATION`, `OTHER` | [TAMAMLANDI] |
| Sorunu "Çözüldü" yapma | — | — | `resolveProblemAction` → `resolveProblem` (kodda var) | Yazacağı: `problem_reports.status='RESOLVED'`, `resolved_by/at` | `document.approve` | [GELİŞTİRİLİYOR] (ekranda düğmesi yok) |
| Genel bakış: "Şimdi" satırları | Liste (bağlantı) | Dokunulur → `/field/receive?receipt=…` ya da `/field/putaway?task=…` | `listInboundReceipts` (OPEN, ≤ 50) + `listMyTasks` (PUTAWAY) | Okur: `inbound_receipts`, `warehouse_tasks` | Yalnız `stock.post` sahibine; hata ana ekranı düşürmez (mesaj + kod) | [TAMAMLANDI] |

- **Tuvalle fark (yönetici ana ekranı; 28 Ekim incelemesi):** onaylı masaüstü standardı tuvali (`docs/design/source/Standart*.dc.html`,
  26 Ekim) yönetici için **3 bekleyen iş kutusu + 8'li "İşler" ızgarası + sürükle-bırak düzen** gösterir. Kodda hâlâ eski Pano panosu
  (`pano/pano-board.tsx`) çizilir. Veri yeterli (yeni tablo gerekmez); iş yalnız arayüz, orta boy. STATE T-1045 kaydı da "işleri sürükle-bırak
  düzenleme, sayılı bekleyen iş kutucukları" maddesini kalan olarak yazar. → [PLANLANDI]

- **İş Akış Şeması:**

```mermaid
flowchart TD
  G[Giriş yapıldı] --> V{view=cockpit çerezi?}
  V -- Evet --> K[Genel bakış: Şimdi + İşler]
  V -- Hayır --> R{Rol}
  R -- Hesap sahibi --> P[Depo panosu: getBoard + getWorkSummary]
  R -- Depo yöneticisi --> M[Depom: halka, Atanacak işler, Ekip]
  R -- Toplayıcı --> H[Görevlerim: getWorkSummary]
  R -- Sayımcı --> S[Sayımlarım: getWorkSummary yalnız sayım]
  R -- Diğer --> E[Görevlerim Bakış: getWorkSummary]
  P --> A1[Kart dokun: Stok / Sevkiyat / Görevler]
  M --> A2[Ata: assignTask]
  H --> B1[Bölüme dokun: saha ekranı açılır]
  H --> B2[SORUN: reportProblem]
```

---

## 2. Modül: Görevler (yönetici) ve Görevlerim (saha)

- **Modül Durumu:** [TAMAMLANDI] — görev ilerleme kaydı ve "Yeniden yerleştirme" saha ekranı [GELİŞTİRİLİYOR]. Canlı: UNKNOWN.
- **Ekranlar:** Yönetici `/t/<firma>/tasks` (`tasks/page.tsx`, `tasks/tasks-view.tsx`); saha `/t/<firma>/field/tasks` (`field/tasks/page.tsx`).
- **Ekranın Amacı ve İşlevi:** Depo görevleri kendiliğinden doğar: mal kabulde **Yerleştirme**, sipariş toplama atamasında **Toplama**,
  sipariş iptalinde **Yeniden yerleştirme**, sayım başlatıldığında ve toplamada mal bulunamadığında **Sayım**. Yönetici kime yapacağını atar
  ya da iptal eder; sahadaki kişi "Üstlen" ile işi alır, "Başla" ile ilgili saha ekranına gider.
- **Görev türü → yapabilmek için gereken izin** (`TASK_KIND_PERMISSION`): Yerleştirme, Toplama, Yeniden yerleştirme = `stock.post`; Sayım = `document.create`.
- **Arayüz Elemanları ve Aksiyon Tablosu:**

| UI Bileşeni / Buton / Alan | Tipi | Kullanıcı Aksiyonu | Tetiklenen API / Servis | Etkilenen DB Tablosu & Kolonu | İş Kuralı / Validasyon | Mevcut Durum |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Tür çipleri (Yerleştirme/Toplama/Yeniden yerleştirme/Sayım) ve Durum çipleri | Filtre çipi | Seçilir | `listTasks` / `listMyTasks` (`operations/tasks.ts`) | Okur: `warehouse_tasks.kind`, `status` | Sayfa başına en çok 200; depo kapsamı | [TAMAMLANDI] |
| Liste sonu (yönetici) | Otomatik yükleme | Kaydırılır | `loadMoreTasksAction` (`tasks/actions.ts`) → `listTasks` | Okur: aynı | Aynı süzgeç + imleç; sayfa düğmesi yok (T-1059). Saha listesinde hâlâ "Daha" düğmesi | [TAMAMLANDI] |
| Arama kutusu | Input | Yazılır | `listTasks` | Okur: ürün/raf adı (ILIKE) | — | [TAMAMLANDI] |
| "Ata" / "Yeniden ata" | Buton → kişi seçimi → Kaydet | Tıklanır | `assignTaskAction` → `assignTask` | Yazar: `warehouse_tasks.status='ASSIGNED'`, `assigned_membership_id`, `version+1`; `audit_logs` | `document.approve`; seçilen kişi ACTIVE, işi yapma izni var, depo kapsamında; `expectedVersion` uyuşmazsa "başkası değiştirdi" | [TAMAMLANDI] |
| "İptal et" + gerekçe | Buton + zorunlu metin | Onaylanır | `cancelTaskAction` → `cancelTask` | Yazar: `warehouse_tasks.status='CANCELLED'`; gerekçe `audit_logs.reason` | `document.approve`; gerekçe 1–500 karakter, kontrol karakteri yok; stok etkisi yok | [TAMAMLANDI] |
| Saha: "Üstlen" | Buton | Tıklanır | `claimTaskAction` → `claimTask` | Yazar: `warehouse_tasks.status='ASSIGNED'`, `assigned_membership_id = ben` | Yalnız `OPEN` görev; kişinin o türü yapma izni olmalı | [TAMAMLANDI] |
| Saha: "Başla" | Bağlantı | Tıklanır | Yönlendirme: Yerleştirme → `/field/putaway`, Toplama → `/field/pick`, Sayım (oturumlu) → `/field/count` | — (yalnız ekran açar) | Yeniden yerleştirme ve oturumsuz sayım için "Bu iş ekranı henüz açılmadı" | [TAMAMLANDI] / Yeniden yerleştirme [GELİŞTİRİLİYOR] |
| Adım adım ilerleme kaydı (okut → miktar → onay → kaydediliyor) | — | — | `recordTaskStepAction`, `beginSaveAction`, `saveTaskAction`, `resetTaskProgressAction`, `nextTaskAction` (`tasks/actions.ts` → `operations/task-progress.ts`) | Yazacağı: `warehouse_task_progress` (`step`: `SCAN_TARGET`/`ENTER_QUANTITY`/`CONFIRM`/`SAVING`) | Kodda ve testte var; **hiçbir ekran çağırmıyor** | [GELİŞTİRİLİYOR] |

- **Görev durum makinesi** (DB kısıtı `warehouse_tasks_status_chk` + `nextTaskStatus`, `operations/tasks.ts`; biten görev DB tetikleyicisiyle değişmez):

```mermaid
stateDiagram-v2
  [*] --> OPEN : Görev doğar (kabul, toplama ataması, sayım, iptal)
  OPEN --> ASSIGNED : Ata (yönetici) veya Üstlen (saha)
  ASSIGNED --> ASSIGNED : Yeniden ata
  OPEN --> DONE : İş tamamlandı (yerleştir, topla, sayım işlendi)
  ASSIGNED --> DONE : İş tamamlandı
  OPEN --> CANCELLED : İptal (gerekçe zorunlu)
  ASSIGNED --> CANCELLED : İptal
  DONE --> [*]
  CANCELLED --> [*]
```

Durum kodları: `OPEN` Açık · `ASSIGNED` Atandı · `DONE` Tamamlandı · `CANCELLED` İptal edildi.
Görevin kaynağı (`source_kind`): `INBOUND_RECEIPT` mal kabul, `SALES_ORDER` sipariş, `CUSTOMER_RETURN` iade, `COUNT_SESSION` sayım.

---

## 3. Modül: Saha ana ekranı — OKUT (hızlı okutma)

- **Modül Durumu:** [TAMAMLANDI] — Canlı: STATE 21 Ekim kaydına göre T-446 (hızlı OKUT) canlıda; gerçek iPhone kamerası kullanıcı denemesi bekler.
- **Ekran:** `/t/<firma>/field` — `field/page.tsx`, `field/okut-view.tsx`, `field/saha-shell.tsx`; alt çubuktaki **OKUT** düğmesi buraya açar.
- **Ekranın Amacı ve İşlevi:** Sahada çalışan kişi hiçbir menüye girmeden **kodu okutur** (kamera, NFC, el terminali ya da elle yazma);
  sistem kodun ne olduğunu bulur ve **doğru işe kendiliğinden geçer**. Okuttuğu şey ürünse bekleyen kabule, raf ise yerleştirmeye veya o raftaki
  sayım/toplama görevine, paket QR'ı ise paket ekranına gider.
- **Arayüz Elemanları ve Aksiyon Tablosu:**

| UI Bileşeni / Buton / Alan | Tipi | Kullanıcı Aksiyonu | Tetiklenen API / Servis | Etkilenen DB Tablosu & Kolonu | İş Kuralı / Validasyon | Mevcut Durum |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Kamera çerçevesi | Kamera (barkod/QR çözücü, cihazda) | Kod çerçeveye getirilir | `resolveFieldScanAction` (`field/actions.ts`) → `resolveFieldScan` (`operations/field-scan.ts`) + `findFieldWork` (`operations/field-work.ts`) | Okur: `item_barcodes`, `items.code`, `inbound_receipts.number`, `locations.code`, `warehouse_tasks` | Yalnız okuma (`stock.view`); arama sırası: ürün barkodu (GS1 dahil) → ürün kodu → açık teslim no → raf kodu; başka firmanın kodu "tanınmadı" döner (varlık sızmaz); depo kapsamı | [TAMAMLANDI] |
| "NFC'ye dokun" | Buton | Etikete dokunulur | Aynı eylem | Aynı | Cihazda NFC yoksa uyarı | [TAMAMLANDI] |
| "Kodu yaz" + "Bul" | Input + Buton | Elle yazılır | Aynı eylem | Aynı | Boş/çok uzun/kontrol karakterli kod reddedilir | [TAMAMLANDI] |
| Paket QR (`EWMS:PKG:1:<kimlik>`) | Okutma | Okutulur | `resolveCurrentPackageQr` | Okur: `receipt_packages`, `handling_units` | Paket akışı ayarı (`PACKAGE_RECEIVING_ENABLED`) kapalıysa "tanınmadı" | [GELİŞTİRİLİYOR] (ayar kapalı) |
| Sonuç yönlendirmesi | Otomatik geçiş | — | Aynı eylem | — | Öncelik: bana atanmış iş → bekleyen kabul → üstlenilebilir iş → ürün kartı / stok; stok yazma yetkisi yoksa yalnız bilgi ekranına gider | [TAMAMLANDI] |
| Ses ve titreşim | Geri bildirim | — | Cihaz | — | Bulundu: olumlu ses; tanınmadı: uyarı sesi | [TAMAMLANDI] |

- **İş Akış Şeması:**

```mermaid
flowchart TD
  O[OKUT: kamera / NFC / kodu yaz] --> P{Paket QR mı?}
  P -- Evet --> PF{Paket akışı açık mı?}
  PF -- Hayır --> U[Kod tanınmadı]
  PF -- Evet --> PK[Paket ekranı /field/packages]
  P -- Hayır --> C[resolveFieldScan: kod nedir?]
  C -- Bilinmiyor --> U
  C -- Raf --> L{Bu rafta iş var mı?}
  L -- Bana atanmış sayım veya toplama --> W[Sayım veya Toplama ekranı]
  L -- Üstlenilebilir iş --> W
  L -- Yok --> PA[Yerleştirme ekranı / yetki yoksa Stok]
  C -- Ürün --> I{Bekleyen toplama veya kabul?}
  I -- Toplama --> PI[Toplama ekranı]
  I -- Açık kabul var --> RC[Kabul ekranı]
  I -- Yok --> IC[Ürün kartı]
  C -- Teslim numarası --> RC
```

---

## 4. Modül: Yerleştirme (rafa koyma)

- **Modül Durumu:** [TAMAMLANDI] — Canlı: UNKNOWN.
- **Ekran:** `/t/<firma>/field/putaway` — `field/putaway/page.tsx`, `field/putaway/putaway-flow.tsx`.
- **Ekranın Amacı ve İşlevi:** Kabul alanına (RECEIVING) gelen ya da sevk alanından geri dönen malı **depolama rafına** (STORAGE) taşır.
  Toplam stok değişmez; yalnız yeri değişir. Görevle başlandıysa görev aynı anda "Tamamlandı" olur.
- **Arayüz Elemanları ve Aksiyon Tablosu:**

| UI Bileşeni / Buton / Alan | Tipi | Kullanıcı Aksiyonu | Tetiklenen API / Servis | Etkilenen DB Tablosu & Kolonu | İş Kuralı / Validasyon | Mevcut Durum |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Görev listesi (Yerleştirme görevlerim) | Liste | Görev seçilir | `listMyTasks` (sayfa sunucuda) | Okur: `warehouse_tasks` (kind=PUTAWAY) | Yalnız bana atanmış veya açık görev | [TAMAMLANDI] |
| İşlem rehberi "Yerleştir" | Buzlu perde + tek satır | İş yapıldıkça ilerler | `kalip/rehber.tsx` (`putaway` planı) | — | Bkz. Bölüm 0.6 | [TAMAMLANDI] (T-1105) |
| Ürün okut | Okutma alanı | Barkod okutulur | `resolveItemScanAction` (`receipts/actions.ts`) → `resolveBarcodeQuery` + `getItem` | Okur: `item_barcodes`, `items` | Görevdeki ürünle aynı olmalı | [TAMAMLANDI] |
| Raf okut | Okutma alanı | Raf etiketi okutulur | `resolveLocationScanAction` → `findLocationByCode` | Okur: `locations` | Hedef raf `STORAGE` türünde ve kaynaktan farklı olmalı | [TAMAMLANDI] |
| "Rafta n" bilgisi | Metin | Görüntülenir | `availableAtLocationAction` | Okur: `stock_balances` | — | [TAMAMLANDI] |
| Miktar tuş takımı / "TÜMÜ" | Sayı girişi | Tuşlanır / aynı barkod tekrar okutulur | Ekranda | — | Görevli yerleştirmede miktar görevle **birebir** eşleşmeli (kısmi yerleştirme görevi bitirmez) | [TAMAMLANDI] |
| "ONAYLA" | Buton | Tıklanır | `putawayAction` (`receipts/actions.ts`) → `putaway` (`operations/putaway.ts`) | Yazar: `documents` (kind=`STOCK_MOVE`, `POSTED`), `document_lines`, `stock_ledger` (kaynaktan −, hedefe +), `stock_balances`, `warehouse_tasks.status='DONE'`, `audit_logs` | `stock.post`; tek işlem; raf sayımda kilitliyse `LOCATION_LOCKED`; başkasına atanmış görevi yalnız onay yetkilisi bitirebilir; görevsiz yerleştirme eşleşen açık görevleri sırayla kapatır | [TAMAMLANDI] |

- **İş Akış Şeması:**

```mermaid
sequenceDiagram
  actor S as Saha personeli
  participant E as Yerleştirme ekranı
  participant A as putawayAction
  participant D as putaway (domain)
  participant DB as Veritabanı
  S->>E: Görevi seç veya ürünü okut
  E->>A: resolveItemScanAction / resolveLocationScanAction
  A-->>E: Ürün ve raf doğrulandı
  S->>E: Miktarı gir, ONAYLA
  E->>A: putawayAction (anahtar ile)
  A->>D: putaway
  D->>DB: Kilitler, STOCK_MOVE fişi, defter ve bakiye
  D->>DB: Görev DONE, denetim kaydı
  DB-->>D: Tamam
  D-->>E: Fiş no
  E-->>S: Rafa kondu · n (yeşil, ses)
```

---

## 5. Modül: Paket işlemleri (kalite onayı, paketi rafa koy, paketi başka depoya taşı)

- **Modül Durumu:** [GELİŞTİRİLİYOR] — kod tam; ama **`PACKAGE_RECEIVING_ENABLED` ayarı açılmadıkça** paket ekranları kapalıdır
  (`apps/web/lib/package-receiving-config.ts`, güvenli varsayılan "kapalı"). BACKLOG B-50: "Paketli/QR akışını normal girişe bağla, ayarı aç".
- **Ekran:** `/t/<firma>/field/packages` — `field/packages/package-flow.tsx`, `field/packages/actions.ts`.
- **Ekranın Amacı ve İşlevi:** Her koli/varil/palet tekil bir QR ile izlenir. Bu ekranda paket okutulur ve **bütün paket** olarak işlem yapılır:
  karantinadaki paketin kalitesini onaylamak, paketi rafa koymak veya başka depoya taşımak.
- **Arayüz Elemanları ve Aksiyon Tablosu:**

| UI Bileşeni / Buton / Alan | Tipi | Kullanıcı Aksiyonu | Tetiklenen API / Servis | Etkilenen DB Tablosu & Kolonu | İş Kuralı / Validasyon | Mevcut Durum |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| "Paket okut" | Okutma | QR okutulur | `resolveCurrentPackageQrAction` / `getCurrentPackageAction` → `getCurrentPackage` (`operations/package-movement-queries.ts`) | Okur: `receipt_packages`, `handling_units`, `package_movement_steps`, `stock_balances` | `stock.view`; paketin güncel yeri ve durumu son adımdan hesaplanır | [GELİŞTİRİLİYOR] |
| "Kaliteyi onayla" | Buton | Tıklanır | `qualityReleasePackageAction` → `approvePackageQuality` (`operations/package-movement.ts`) | Yazar: `documents` + `stock_ledger` (KARANTİNA → KULLANILABİLİR), `package_movement_steps` (`operation='QC_RELEASE'`), `audit_logs` | `document.approve`; paketin bilinen son sürümü (`predecessorVersion`, `currentBalanceVersion`) eşleşmeli, aksi "güncel durumu al" | [GELİŞTİRİLİYOR] |
| "Yer okut" / "Yer seç" → "Buraya yerleştir" | Okutma / liste + buton | Raf seçilir, onaylanır | `resolvePackageDestinationAction`, `packageStorageLocationsAction`, `putawayPackageAction` → `putawayPackage` | Yazar: `package_movement_steps` (`PUTAWAY`), `documents`, `stock_ledger`, `stock_balances` | `stock.post`; bütün paket taşınır (bölme yok); hedef aynı depoda | [GELİŞTİRİLİYOR] |
| "Depoya taşı" → "Hedef depo" → "Yer seç" → "Taşımayı onayla" | Seçim + buton | Onaylanır | `packageTransferWarehousesAction`, `packageTransferLocationsAction`, `resolvePackageTransferDestinationAction`, `transferPackageAction` → `transferPackage` (`operations/package-transfer.ts`) | Yazar: iki bağlı fiş (kaynak deposunda `STOCK_OUT`, hedef deposunda `STOCK_IN`), `stock_document_links` (`kind='TRANSFER'`), `package_movement_steps` (`WAREHOUSE_TRANSFER`) | `stock.post`; kaynak ve hedef depo farklı, hedef raf STORAGE; iki fiş tek işlemde | [GELİŞTİRİLİYOR] |

- **İş Akış Şeması (paket durum makinesi, `package_movement_steps.operation`):**

```mermaid
stateDiagram-v2
  [*] --> KABUL_ALANINDA : Paketli kabul işlendi (2B)
  KABUL_ALANINDA --> KULLANILABILIR : QC_RELEASE (Kaliteyi onayla)
  KULLANILABILIR --> RAFTA : PUTAWAY (Buraya yerleştir)
  RAFTA --> HEDEF_DEPODA : WAREHOUSE_TRANSFER (Depoya taşı)
  HEDEF_DEPODA --> RAFTA : PUTAWAY
  RAFTA --> URETIMDE_TUKETILDI : Paketli üretim (Modül 11)
```

---

## 6. Modül: Depolar arası transfer (paketsiz)

- **Modül Durumu:** [TAMAMLANDI] — Canlı: UNKNOWN.
- **Ekran:** Stok işlemleri formundaki "Transfer" (`/stock/documents?new=TRANSFER`, `stock/documents/document-form.tsx`, ayrıntı 2B; belge
  ayrıntısı T-1091'den beri kayıt kartı kalıbında) ve Etkin sesli komut onay kartı (`kabuk/etkin.tsx`). Formda odaklı "Transfer" işlem rehberi
  var (`kalip/rehber.tsx`, T-1105).
- **Ekranın Amacı ve İşlevi:** Bir depodaki raftan başka bir depodaki rafa mal göndermek. Arka planda **iki fiş** oluşur (çıkış + giriş) ve
  ikisi birbirine bağlanır; biri kaydolup diğeri kalamaz.
- **Arayüz Elemanları ve Aksiyon Tablosu:**

| UI Bileşeni / Buton / Alan | Tipi | Kullanıcı Aksiyonu | Tetiklenen API / Servis | Etkilenen DB Tablosu & Kolonu | İş Kuralı / Validasyon | Mevcut Durum |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Kaynak raf, hedef raf, ürün, miktar, açıklama | Seçim + Input | Doldurulur | `stockChoicesAction` (seçenek arama) | Okur: `locations`, `items`, `stock_balances` | — | [TAMAMLANDI] |
| "Onayla" (transfer) | Buton | Tıklanır | `transferStockAction` (`stock/documents/actions.ts`) → `transferBetweenWarehouses` (`operations/warehouse-transfer.ts`) | Yazar: `documents` ×2 (`STOCK_OUT` kaynak depo, `STOCK_IN` hedef depo, ikisi `POSTED`), `document_lines`, `stock_ledger`, `stock_balances`, `audit_logs` | `stock.post`; açıklama zorunlu; miktar > 0; kaynak ve hedef **farklı depoda** olmalı (aynı depoda raf değişimi = yerleştirme/taşıma fişi); stok yetersizse ret; iki fiş tek işlem | [TAMAMLANDI] |

> Not: Paketsiz transferde iki fiş arasında `stock_document_links` kaydı yazılmaz; bağ yalnız paketli transferde ve üretimde yazılır
> (kod: `warehouse-transfer.ts` yalnız iki fişi işler). Ana ekrandaki "Transfer" sayacı kaynaksız `STOCK_MOVE` ve `TRANSFER` bağlarını sayar
> (`work-summary.ts`); paketsiz depolar arası transferin sayaca nasıl yansıdığı bu belgede doğrulanmadı (UNKNOWN).

---

## 7. Modül: Sipariş ve Sevkiyat yönetimi (masa)

- **Modül Durumu:** [TAMAMLANDI] — yalnız lot/seri takibi olmayan ürünler; sipariş düzenleme, satır iptali, cari bağlantısı [GELİŞTİRİLİYOR]. Canlı: UNKNOWN.
- **Ekran:** `/t/<firma>/shipping` — `shipping/page.tsx`, `shipping/shipping-form.tsx`, `shipping/actions.ts`.
- **Ekranın Amacı ve İşlevi:** Müşteri siparişini açar, stoktan **ayırır** (rezervasyon), toplama görevlerini üretir, toplanan malı **sevk eder**.
  Sipariş kaydı stok düşürmez; stok yalnız "Sevki onayla" ile düşer.
- **Arayüz Elemanları ve Aksiyon Tablosu:**

| UI Bileşeni / Buton / Alan | Tipi | Kullanıcı Aksiyonu | Tetiklenen API / Servis | Etkilenen DB Tablosu & Kolonu | İş Kuralı / Validasyon | Mevcut Durum |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Sipariş listesi + arama | Liste + Input | Aranır / dokunulur | `listShippingOrders` (`operations/shipping-queries.ts`) | Okur: `sales_orders`, `sales_order_lines` | Arama ≤ 128 karakter; toplam sayı gösterilir | [TAMAMLANDI] |
| "Müşteri / sipariş açıklaması" | Input (serbest metin) | Yazılır | — | Yazacağı: `sales_orders.customer_ref` | 1–100 karakter; **Cari kartına bağlı değil** (bkz. Gap) | [TAMAMLANDI] |
| Ürün seç + miktar, "Ekle" / "Kaldır" | Seçim + Input + Buton | Satır eklenir | `stockChoicesAction` | — | En çok 200 satır; takipli (lot/seri) ürün reddedilir | [TAMAMLANDI] |
| "Siparişi oluştur" | Buton | Tıklanır | `createShippingOrderAction` → `createSalesOrder` (`operations/orders.ts`) | Yazar: `sales_orders` (`number` sistemden, `status='OPEN'`), `sales_order_lines.requested_quantity`, `audit_logs` | `document.create`; miktar temel birime çevrilir, ondalık uymuyorsa `QUANTITY_SCALE`; stok değişmez | [TAMAMLANDI] |
| "Stok ayır" | Buton | Tıklanır | `shippingOrderAction` (operation=`reserve`) → `reserveOrder` | Yazar: `reservations` (`status='ACTIVE'`), `stock_balances.reserved_quantity` | `document.approve`; ayrılabilir = açık − aktif ayrım; sayımdaki raf, toplama engelli raf, takipli stok ayrılmaz | [TAMAMLANDI] |
| "Toplama görevlerini oluştur" | Buton | Tıklanır | `shippingOrderAction` (operation=`assign`) → `createPickAssignment` (`operations/picking.ts`) | Yazar: `warehouse_tasks` (kind=`PICK`, ortak `group_id`), `audit_logs` | `document.approve`; stok etkisi yok; raf kodu sırasıyla görev; ayrılmamış satır görev üretmez | [TAMAMLANDI] |
| Görev satırında okut + "İşlemi kontrol et" + "Toplamayı onayla" | Okutma + Buton | Masadan toplama onayı | `previewShippingPickAction` → `confirmShippingPickAction` → `confirmPick` | Bkz. Modül 8 | Bkz. Modül 8 | [TAMAMLANDI] |
| "Sevke hazır miktar" satırı + "Sevk edilecek miktar" + "Sevki onayla" | Input + Buton | Tıklanır | `postShipmentAction` → `shipOrder` (`operations/shipping.ts`) | Yazar: `documents` (`STOCK_OUT`, kaynak `SALES_ORDER`, `POSTED`), `stock_ledger`, `stock_balances` (quantity ve reserved azalır), `reservations.status='CONSUMED'`, `sales_order_lines.shipped_quantity`, tüm satırlar bitince `sales_orders.status='CLOSED'`, `audit_logs` | `stock.post`; yalnız sevk alanında (STAGING) duran ve ayrılmış mal sevk edilir; fazlası `INSUFFICIENT_STOCK`; tek depodan sevk; DB kısıtı `shipped + cancelled ≤ requested` | [TAMAMLANDI] |
| "Siparişi iptal et" → "İptali onayla" | Buton (iki adım) | Onaylanır | `shippingOrderAction` (operation=`cancel`) → `cancelSalesOrder` | Yazar: `sales_orders.status='CANCELLED'`, `sales_order_lines.cancelled_quantity`, `reservations.status='RELEASED'`, sevk alanında kalan mal için `warehouse_tasks` (kind=`REPUTAWAY`) | `document.approve`; sürüm kontrolü; sevk edilmiş kısım iptal edilmez; fiziksel stok silinmez | [TAMAMLANDI] |
| Sipariş düzenleme, satır iptali, yeniden ayırma | — | — | `updateDraftOrder`, `cancelOrderLine`, `reallocateOrderLine` (kodda var) | `sales_order_lines` | Ekranda düğmesi yok | [GELİŞTİRİLİYOR] |

- **Sipariş durum makinesi** (`sales_orders_status_chk`: `OPEN`, `CLOSED`, `CANCELLED`):

```mermaid
stateDiagram-v2
  [*] --> OPEN : Siparişi oluştur
  OPEN --> OPEN : Stok ayır / Toplama / Kısmi sevk
  OPEN --> CLOSED : Son satır da tam sevk edildi
  OPEN --> CANCELLED : Siparişi iptal et
  CLOSED --> [*]
  CANCELLED --> [*]
```

Satır miktarları: `requested_quantity` istenen · `shipped_quantity` sevk edilen · `cancelled_quantity` iptal · `returned_quantity` iade.
Açık miktar = istenen − sevk − iptal (kolon değil, hesaplanır). İade açık miktarı değiştirmez, siparişi yeniden açmaz.

- **Rezervasyon durum makinesi** (`reservations_status_chk`):

```mermaid
stateDiagram-v2
  [*] --> ACTIVE : Stok ayır
  ACTIVE --> ACTIVE : Toplama ile raftan sevk alanına taşındı
  ACTIVE --> CONSUMED : Sevki onayla
  ACTIVE --> RELEASED : Sipariş iptali veya ürün bulunamadı
  CONSUMED --> [*]
  RELEASED --> [*]
```

---

## 8. Modül: Toplama (saha)

- **Modül Durumu:** [TAMAMLANDI] — "rafta hiç ürün yok" bildirimi ve eksikten doğan sayımın sahadan başlatılması [GELİŞTİRİLİYOR] (BACKLOG B-96). Canlı: UNKNOWN (PR #140 main'de).
- **Ekran:** `/t/<firma>/field/pick` — `field/pick/page.tsx`, `field/pick/pick-flow.tsx`; veri `getPickWork` (`operations/field-work.ts`).
- **Ekranın Amacı ve İşlevi:** Toplayıcı rafa gider, raf etiketini ve ürün barkodunu okutur, kaç tane aldığını girer. Mal raftan **sevk alanına**
  (STAGING) taşınır, siparişe ayrılan stok da malla birlikte taşınır. Eksik bulunursa eksik kısmın ayrımı bırakılır, raf toplamaya kapatılır ve
  o raf için sayım görevi açılır.
- **Arayüz Elemanları ve Aksiyon Tablosu:**

| UI Bileşeni / Buton / Alan | Tipi | Kullanıcı Aksiyonu | Tetiklenen API / Servis | Etkilenen DB Tablosu & Kolonu | İş Kuralı / Validasyon | Mevcut Durum |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| İş kartı ("n birim · RAF X", "İSTENEN n") | Kart | Görüntülenir | `getPickWork` | Okur: `warehouse_tasks`, `sales_orders`, `reservations`, `locations` | Başkasına atanmış görev yalnız onay yetkilisine görünür | [TAMAMLANDI] |
| "Rafı okut" | Okutma | Raf etiketi okutulur | Ekranda karşılaştırma; sunucu onayda tekrar denetler | — | Yanlış raf: "Bu raf değil. Doğru raf: X" | [TAMAMLANDI] |
| "Ürünü okut" | Okutma | Barkod okutulur | `previewShippingPickAction` → `previewShippingPick` | Okur: `item_barcodes`, `unit_conversions` | Yanlış ürün: `SCAN_MISMATCH`; koli barkodu temel birime çevrilir, tam sayıya inmiyorsa uyarı | [TAMAMLANDI] |
| "Kaç tane aldın?" tuş takımı | Sayı girişi | Tuşlanır / aynı barkod tekrar okutulur | Ekranda | — | İstenenden fazlası reddedilir | [TAMAMLANDI] |
| "Toplamayı onayla" | Buton | Tıklanır | `confirmShippingPickAction` → `confirmPick` (`operations/picking.ts`) | Yazar: `documents` (`STOCK_MOVE`, POSTED), `stock_ledger`, `stock_balances`, `reservations` (yeni boyuta taşınır), `warehouse_tasks.status='DONE'`, `audit_logs`. **Eksikte ek:** `reservations.status='RELEASED'` (eksik kısım), `locations.pick_blocked=true`, yeni `warehouse_tasks` (kind=`COUNT`, kaynak sipariş) | `stock.post`; raf + ürün okutması zorunlu; eksikte defter değişmez; ardından ayrı işlemde `reallocateOrderLine` ile başka raftan yeniden ayırma denenir ve sonucu ekranda görünür | [TAMAMLANDI] |
| "Sıradaki toplama (n)" / "Sevke geç" | Bağlantı | Tıklanır | Yönlendirme | — | — | [TAMAMLANDI] |

- **İş Akış Şeması:**

```mermaid
sequenceDiagram
  actor T as Toplayıcı
  participant E as Toplama ekranı
  participant D as confirmPick
  participant DB as Veritabanı
  T->>E: Rafı okut, ürünü okut, miktarı gir
  E->>D: previewShippingPick (kontrol, yazmaz)
  D-->>E: Temel birim miktarı
  T->>E: Toplamayı onayla
  E->>D: confirmShippingPickAction (anahtar ile)
  D->>DB: Stok kilitleri, sipariş ve görev kilidi
  D->>DB: STOCK_MOVE raf -> sevk alanı, ayrım taşınır
  alt Bulunan = beklenen
    D->>DB: Görev DONE
  else Eksik bulundu
    D->>DB: Eksik ayrım serbest, raf toplamaya kapalı, COUNT görevi
    D->>DB: Ayrı işlem: başka raftan yeniden ayır
  end
  D-->>E: Sonuç (eksik varsa kırmızı uyarı)
  E-->>T: Toplandı · n
```

---

## 9. Modül: Sevk (saha)

- **Modül Durumu:** [TAMAMLANDI] — Canlı: UNKNOWN (PR #140 main'de).
- **Ekran:** `/t/<firma>/field/ship` — `field/ship/page.tsx`, `field/ship/ship-flow.tsx`; veri `getShippingOrder`.
- **Ekranın Amacı ve İşlevi:** Sevk alanında toplanmış malı araca yüklerken satır seçilir, miktar girilir, "yükleme onayı" verilir. Masadaki
  "Sevki onayla" ile aynı komuttur (Modül 7).

| UI Bileşeni / Buton / Alan | Tipi | Kullanıcı Aksiyonu | Tetiklenen API / Servis | Etkilenen DB Tablosu & Kolonu | İş Kuralı / Validasyon | Mevcut Durum |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Sevke hazır satırlar | Liste | Satır seçilir | `getShippingOrder` | Okur: `reservations` (STAGING'deki ACTIVE), `sales_order_lines` | — | [TAMAMLANDI] |
| Miktar + "Sevki onayla" | Input + Buton | Tıklanır | `postShipmentAction` → `shipOrder` | Modül 7'deki "Sevki onayla" satırı ile aynı | Aynı | [TAMAMLANDI] |

---

## 10. Modül: Sayım (yönetici + saha)

- **Modül Durumu:** [TAMAMLANDI] — Canlı: UNKNOWN (PR #140 main'de). Kalan: B-96 (toplama eksiğinden doğan oturumsuz sayım görevinin sahadan başlatılması).
- **Ekranlar:** Yönetici `/t/<firma>/counts` (`counts/page.tsx`, `counts/counts-forms.tsx`, `counts/actions.ts`);
  saha `/t/<firma>/field/count` (`field/count/count-flow.tsx`, veri `getCountWork`). Sayım için odaklı işlem rehberi var (`kalip/rehber.tsx`, T-1105).
- **Ekranın Amacı ve İşlevi:** Yönetici sayılacak rafları seçip sayımı başlatır; raflar sayım bitene kadar **kilitlenir** (o raflara giriş/çıkış
  yapılamaz) ve her raf için sahada sayım görevi açılır. Sayımcı rafı ve ürünü okutup saydığı miktarı girer. "Kör sayım" seçilirse sayımcı sistemdeki
  miktarı görmez. Bütün satırlar sayılınca yönetici farkları inceler, onaylar ve **fark fişini işler**; stok sayılan miktara eşitlenir.
- **Arayüz Elemanları ve Aksiyon Tablosu:**

| UI Bileşeni / Buton / Alan | Tipi | Kullanıcı Aksiyonu | Tetiklenen API / Servis | Etkilenen DB Tablosu & Kolonu | İş Kuralı / Validasyon | Mevcut Durum |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Sayım listesi (durum rozetleri) | Liste | Satıra dokunulur | `listCountSessions`, `getCountReview` (`operations/count-queries.ts`) | Okur: `count_sessions`, `count_session_lines`, `warehouse_tasks` | `stock.view` + depo kapsamı | [TAMAMLANDI] |
| "Yeni sayım": Depo, Raf kodları, "Kör sayım" | Seçim + çok satırlı Input + onay kutusu | Doldurulur | — | — | En çok 200 raf kodu; depoda olmayan kodlar listelenir | [TAMAMLANDI] |
| "Sayımı başlat" | Buton | Tıklanır | `startCountAction` → `startCount` + `createCountTasks` (`operations/counting.ts`) | Yazar: `count_sessions` (`status='COUNTING'`, `blind`, `started_by`), `count_session_lines` (`reference_quantity`), `location_count_locks` (raf kilidi), `warehouse_tasks` (kind=`COUNT`, kaynak `COUNT_SESSION`), `audit_logs` | `document.approve`; raf kilitleri yalnız `acquireStockLocks` ile | [TAMAMLANDI] |
| Saha: rafı okut → ürünü okut/seç → sayı → "Kaydet" | Okutma + sayı + buton | Kaydedilir | `recordCountAction` → `recordCount` | Yazar: `count_session_lines.counted_quantity`, `counted_by`, `counted_at` (sistemde olmayan bulgu için yeni satır) | `document.create`; tekrar güvenliği; miktar ≥ 0, ondalık ürün ölçeğine uymalı; kapanmış oturuma yazılamaz (DB tetikleyicisi) | [TAMAMLANDI] |
| Saha: "Onaya gönder" | Buton | Tıklanır | `submitCountAction` → `submitCount` | Yazar: `count_sessions.status='SUBMITTED'` | Bütün satırlar sayılmış olmalı (sayılmayan satır sıfır sayılmaz) | [TAMAMLANDI] |
| "Farkı onayla" → "Onayı ver" | Buton | Tıklanır | `approveCountAction` → `approveCount` | Yazar: `count_sessions.status='APPROVED'`, `approved_by`, `approved_at` | `count_diff.approve`; **görev ayrılığı açıksa sayımı yapan onaylayamaz** (`assertSeparated`); COUNTING'den çağrılırsa önce SUBMITTED yapılır | [TAMAMLANDI] |
| "Fark fişini işle" → "Fişi işle" | Buton | Tıklanır | `postCountAction` → `postCountAdjustment` | Yazar: `documents` (kind=`COUNT_ADJUSTMENT`, numara `SAY-YYYY-nnnnnn`, `POSTED`), `stock_ledger`, `stock_balances`, `location_count_locks` → boşta, `locations.pick_blocked=false`, `count_sessions.status='POSTED'`, açık sayım görevleri `DONE`, `audit_logs` | `count_diff.approve`; fark **kilitli anlık bakiyeye göre** hesaplanır (sayım sırasında gösterilen sistem miktarına göre değil); fark ayrılmış miktarın altına inemez (`INSUFFICIENT_STOCK`); sayım farkı fişi ters kayıtla geri alınamaz | [TAMAMLANDI] |
| "Sayımı iptal et" + gerekçe → "İptali onayla" | Buton + Input | Onaylanır | `cancelCountAction` → `cancelCount` | Yazar: `count_sessions.status='CANCELLED'`, `cancel_reason`, kilitler açılır | `document.approve`; gerekçe 1–500 karakter; fark uygulanmaz | [TAMAMLANDI] |
| Terk edilmiş sayım uyarısı | Arka plan | — | `findAbandonedCounts` (worker) | Okur: `count_sessions`, `tenant_settings.count_abandon_hours` (1–168 saat) | — | [TAMAMLANDI] (ekranda gösterimi bu belgede doğrulanmadı) |

- **Sayım oturumu durum makinesi** (`count_sessions_status_chk` + 0017 tetikleyicisi atlamaya izin vermez):

```mermaid
stateDiagram-v2
  [*] --> COUNTING : Sayımı başlat (raflar kilitlenir)
  COUNTING --> SUBMITTED : Onaya gönder (tüm satırlar sayıldı)
  SUBMITTED --> APPROVED : Farkı onayla
  APPROVED --> POSTED : Fark fişini işle (stok eşitlenir, kilit açılır)
  COUNTING --> CANCELLED : İptal (gerekçe)
  SUBMITTED --> CANCELLED : İptal
  APPROVED --> CANCELLED : İptal
  POSTED --> [*]
  CANCELLED --> [*]
```

Durum kodları: `COUNTING` Sayılıyor · `SUBMITTED` Onay bekliyor · `APPROVED` Onaylandı · `POSTED` İşlendi · `CANCELLED` İptal.

- **İş Akış Şeması:**

```mermaid
sequenceDiagram
  actor Y as Yönetici
  actor S as Sayımcı
  participant C as Sayım komutları (counting.ts)
  participant DB as Veritabanı
  Y->>C: Sayımı başlat (depo, raflar, kör?)
  C->>DB: count_sessions COUNTING, satırlar, raf kilitleri, COUNT görevleri
  S->>C: Raf + ürün okut, sayı gir (recordCount)
  C->>DB: counted_quantity, counted_by
  S->>C: Onaya gönder (submitCount)
  C->>DB: SUBMITTED
  Y->>C: Farkı onayla (approveCount)
  C->>C: Görev ayrılığı kontrolü
  C->>DB: APPROVED, approved_by
  Y->>C: Fark fişini işle (postCountAdjustment)
  C->>DB: COUNT_ADJUSTMENT fişi, defter, bakiye, kilit açılır, POSTED
  C-->>Y: Fiş no SAY-YYYY-nnnnnn
```

---

## 11. Modül: Üretim (reçete + üretim kaydı)

- **Modül Durumu:** Reçete ve paketsiz üretim [TAMAMLANDI]; **paketli üretim** (QR'lı koli/varil çıktısı) [GELİŞTİRİLİYOR] — arka uç ve tablolar hazır,
  ekran çağırmıyor. BACKLOG B-53 (üretim test düzeneği hataları). Canlı: UNKNOWN.
- **Ekran:** `/t/<firma>/production` — `production/page.tsx`, `production/production-form.tsx`, `production/actions.ts`.
- **Ekranın Amacı ve İşlevi:** Mamulün hangi hammaddelerden ne kadar yapıldığı **reçete** olarak tanımlanır. Üretim kaydında hammaddeler
  kaynak raflardan düşülür, mamul hedef rafa eklenir; hepsi tek işlemdir. Reçete kaydetmek stok değiştirmez; kaydedilen reçete sürümü değiştirilemez,
  değişiklik yeni sürümle yapılır.
- **Arayüz Elemanları ve Aksiyon Tablosu:**

| UI Bileşeni / Buton / Alan | Tipi | Kullanıcı Aksiyonu | Tetiklenen API / Servis | Etkilenen DB Tablosu & Kolonu | İş Kuralı / Validasyon | Mevcut Durum |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Reçete listesi + "Reçete ara" | Liste + Input | Aranır / dokunulur | `listProductionRecipes`, `getProductionRecipe` (`operations/production.ts`) | Okur: `production_recipes`, `production_recipe_lines` | — | [TAMAMLANDI] |
| "Yeni reçete": Reçete kodu, Sürüm, Reçete adı, Mamul, Üretilecek miktar, Malzeme + Reçete miktarı, "Malzeme ekle/kaldır" | Input + Seçim | Doldurulur | `stockChoicesAction` | — | Kod ≤ 64, ad ≤ 200 karakter; 1–100 malzeme; mamul malzeme olamaz; aynı malzeme iki kez olamaz; miktar > 0 | [TAMAMLANDI] |
| "Reçeteyi kaydet" | Buton | Tıklanır | `createRecipeAction` → `createProductionRecipe` | Yazar: `production_recipes` (`code`, `version`, `output_item_id`, `output_quantity`), `production_recipe_lines`, `audit_logs` (`production_recipe.created`) | `settings.manage`; ürünler aktif olmalı; aynı kod+sürüm ikinci kez kaydedilemez | [TAMAMLANDI] |
| Üretim kaydı: üretilecek miktar, her malzeme için Depo/Konum/Parti/Seri, mamul Konum, "Üretim açıklaması" | Seçim + Input | Doldurulur | `previewProductionAction` (reçete miktarlarını ölçekler, yazmaz) | — | Açıklama zorunlu | [TAMAMLANDI] |
| "Tüketimi ve üretimi kontrol et" → "Onayla ve üret" | Buton (iki adım) | Tıklanır | `produceAction` → `produceFromRecipe` | Yazar: her kaynak depo için `documents` (`STOCK_OUT`), mamul için `documents` (`STOCK_IN`), hepsi `POSTED`; `stock_ledger`, `stock_balances`; `stock_document_links` (`kind='PRODUCTION'`, `recipe_id`); `audit_logs` | `stock.post`; malzeme yetersizse ret (eksi stok yok); bütün fişler tek işlem; reçete belgeye sabitlenir (sonradan reçete değişse eski üretim değişmez); reçetedeki mamul ya da malzeme kaynakta kapanmışsa ret (`assertItemsActive`, T-1067; Bölüm 0.5) | [TAMAMLANDI] |
| Paketli üretim (girdi paketleri, çıktı koli/varil QR'ları) | — | — | `previewPackageProductionAction`, `preparePackageProductionAction`, `postPackageProductionAction`, `getPackageProductionBatchAction` → `preparePackageProduction`, `postPackageProduction` | Yazacağı: `production_batches`, `production_inputs`, `production_packages`, `handling_units.package_production_id` | Kodda ve testte var; **ekranda düğmesi yok** | [GELİŞTİRİLİYOR] |

- **İş Akış Şeması:**

```mermaid
sequenceDiagram
  actor U as Üretim sorumlusu
  participant E as Üretim ekranı
  participant D as produceFromRecipe
  participant DB as Veritabanı
  U->>E: Reçete seç, miktar ve raflar
  E->>D: previewProductionAction (yalnız hesap)
  D-->>E: Gereken malzeme miktarları
  U->>E: Onayla ve üret
  E->>D: produceAction (anahtar ile)
  D->>DB: Kilitler (tüm kaynak ve hedef raflar)
  D->>DB: Her kaynak depo STOCK_OUT, mamul STOCK_IN
  D->>DB: stock_document_links PRODUCTION + recipe_id
  D->>DB: Denetim kayıtları, fiş numaraları
  D-->>E: Fiş numaraları
```

---

## 12. Modül: Müşteri iadesi

- **Modül Durumu:** [GELİŞTİRİLİYOR] — **ekranı yok**; iş kuralı `createCustomerReturn` (`packages/domain/src/operations/returns.ts`) kodda ve testli.
  BACKLOG B-52 kalanı: "iade ekranı (domain `returns.ts` var)".
- **Ekranın Amacı ve İşlevi (hedef):** Sevk edilmiş sipariş satırına bağlı iade almak. Mal kabul alanındaki seçilen rafa **karantina** durumunda girer
  (hemen satılabilir sayılmaz).

| UI Bileşeni / Buton / Alan | Tipi | Kullanıcı Aksiyonu | Tetiklenen API / Servis | Etkilenen DB Tablosu & Kolonu | İş Kuralı / Validasyon | Mevcut Durum |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| (Ekran yok) İade kaydet | — | — | `createCustomerReturn` (sunucu eylemi yok) | Yazacağı: `documents` (`STOCK_IN`, kaynak `SALES_ORDER`, `reason` zorunlu), `stock_ledger` (neden `RETURN`), `stock_balances` (QUARANTINE boyutu), `sales_order_lines.returned_quantity` | `document.approve`; iade ≤ sevk − önceki iade (`RETURN_EXCEEDS_SHIPPED`); gerekçe zorunlu ≤ 500; kapalı sipariş yeniden açılmaz | [GELİŞTİRİLİYOR] |

> `customer_returns` / `customer_return_lines` tabloları (0016) var ama bu komut onları **kullanmıyor** (iade başlığı açılmaz, A-308-5);
> şu an bu tablolara yazan kod yok.

---

## 13. Modül: Kim ne yaptı? (İşlem kaydı) ve dışa aktarma

- **Modül Durumu:** [TAMAMLANDI] — Canlı: UNKNOWN.
- **Ekranlar:** `/t/<firma>/audit` (`audit/page.tsx`, `audit/audit-view.tsx`, `audit/satirlar.ts`, `audit/actions.ts`); CSV indirme
  `GET /api/t/<firma>/audit/export` (`apps/web/app/api/t/[slug]/audit/export/route.ts`); Excel dışa aktarma `GET /api/t/<firma>/export/<tür>`
  (`apps/web/app/api/t/[slug]/export/[kind]/route.ts`), düğmesi yalnız **Ayarlar › Bağlantılar** ekranında (`settings/baglantilar/baglantilar-view.tsx`).
- **Ekranın Amacı ve İşlevi:** Firmada kimin ne zaman hangi işlemi yaptığını gösterir (stok, üye, ayar, rol değişiklikleri). Kayıtlar silinemez.
  Yönetici tarih/işlem/arama ile süzer ve CSV indirir. Liste kalıbındadır (kart: işlem adı, kişi · zaman, kayıt türü, gerekçe; karta dokununca
  tam kayıt balonda). Kişinin yalnız **kendi bugünkü** işleri ayrıca üst çubuktaki "Son işlemler" penceresindedir (Bölüm 0.6).

| UI Bileşeni / Buton / Alan | Tipi | Kullanıcı Aksiyonu | Tetiklenen API / Servis | Etkilenen DB Tablosu & Kolonu | İş Kuralı / Validasyon | Mevcut Durum |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Hızlı çipler: Tümü / Bugün / Son 7 gün / seçili işlem | Filtre çipi (adresi değiştirir) | Seçilir | `listAudit` (`packages/domain/src/audit/audit-query.ts`) | Okur: `audit_logs` (`occurred_at`, `action`, `entity_type`, `actor_user_id`, `reason`) | `audit.view`; çiplerde sayı yok (bilinçli fark) | [TAMAMLANDI] |
| Başlangıç / Bitiş tarihi, İşlem seçimi (aramalı seçim sayfası), arama | Tarih + Seçim + Input | "Süz" / seçim | `listAudit` (GET formu, JS yokken de çalışır) | Aynı | Arama: kişi adı / gerekçe / kayıt kimliği; metindeki e-postalar maskelenir | [TAMAMLANDI] |
| Liste sonu | Otomatik yükleme | Kaydırılır | `loadMoreAuditAction` (`audit/actions.ts`) → `listAudit` | Okur: `audit_logs` | Aynı süzgeç + imleç (imleç domain'de doğrulanır); "Daha fazla" düğmesi kalktı (T-1059) | [TAMAMLANDI] |
| "CSV İNDİR" (alt çubuk ana işlemi) | Düğme (dosya) | Tıklanır | `openAuditExport` | Okur: `audit_logs`; yazar: `audit_logs` (`audit.exported`) | Yeniden kimlik doğrulama isteyebilir; dakikada en çok 2; dosyada ip/tarayıcı/istek kimliği/e-posta yok; indirme sürerken eklenen kayıt dosyaya girmez | [TAMAMLANDI] |
| Excel dışa aktarma (Ürünler, Cariler, Depolar, Raflar, Açılış stoku) | Ayarlar › Bağlantılar'daki "Dışarı aktar" / şablon | Tıklanır | `exportData` (`packages/domain/src/onboarding/data-export.ts`) | Okur: ilgili tablolar; yazar: `audit_logs` (`data.exported`) | `data.import` (+ MFA); cari kişisel alanları yalnız `settings.manage` sahibine; depo kapsamı. Listelerdeki Excel düğmesi kalktı (T-1092, T-1094) | [TAMAMLANDI] |

---

## 14. Modül: Raporlar

- **Modül Durumu:** [PLANLANDI] — ayrı bir rapor ekranı yok (28 Ekim'de de değişmedi). Bugün "rapor" olarak yalnız Depo panosundaki kartlar var
  (Modül 1); "Tüm raporlar" kartı ve Depom'daki "Raporlar" hızlı kutusu **Stok durumu** ekranına (`/stock`) gider. Ürün kartının (T-1049) ve raf
  yeri kartının (T-1082) "son hareketler" bölümleri sınırlı salt okuma görünümleridir, rapor değildir (2B). BACKLOG'da ayrı rapor satırı bulunmadı.
- **Bugün elde olan veri kaynakları:** `stock_ledger` (hareket geçmişi), `stock_balances` (anlık stok), `audit_logs` (işlem geçmişi), `count_sessions`
  (sayım farkları), `sales_orders` (sipariş). Rapor ekranı istenirse bunlardan üretilebilir; önce tasarım tuvaline eklenmesi gerekir (I-18).

---

## 15. Modül: Etkin — sesli komut ve sesli yanıt

- **Modül Durumu:** [GELİŞTİRİLİYOR] — `main` kodunda: bas-konuş, konuşmayı yazıya çevirme, kural tabanlı niyet, "Anladım" onay kartı
  (T-1002, PR #158), iPhone bas-konuş düzeltmeleri (T-1103, PR #235), **doğal Türkçe ses** (EMA Lightning `/tts`, T-1106, PR #241) ve
  **firma "Etkin sesli yanıt" ayarı** (T-1109, PR #243, migration 0063). Kalan: VPS'te ses servisinin kurulumu (B-130, kullanıcı root adımı),
  Etkin yetki grubu izni (B-131), canlı yazı / arama mikrofonu (B-132). **Doğal komutlar (T-1110) 28 Ekim'de `main`'e birleşti (PR 245, `0c199aa`; canlı: UNKNOWN)** — bu
  belgede anlatılmaz. Doğal dil için yerel küçük dil modeli kararı kullanıcıda bekliyor. Ses servisi çalışmıyorsa Etkin "şu an kullanılamıyor"
  der, rehber hoparlörü cihaz sesine düşer. Canlı: UNKNOWN (gerçek iPhone denemesi kayıtlı değil).
- **Ekran:** Alt çubuktaki **Etkin** düğmesi (`kabuk/etkin.tsx`, durum yazısını okunur cümleye çeviren `kabuk/okunacak.ts`); sunucu
  `etkinAnlaAction` ve `etkinSoyleAction` (`etkin/actions.ts`, ses sınırları `apps/web/lib/voice.ts`); niyet ayrıştırma ve eşleştirme
  `packages/shared/src/voice/niyet.ts`, `cozum.ts`, `eslestir.ts`, `turkce.ts`; kiracı verisiyle arama `packages/domain/src/voice/yanit.ts`,
  `sorgu.ts`; ayar `packages/domain/src/voice/ayar.ts`; ses servisi `services/voice/app.py` (yazıya çevirme: faster-whisper "small" int8 +
  Silero VAD; sese çevirme: EMA Lightning; modeller imajda, sunucuda yerel, internete çıkmaz).
- **Ekranın Amacı ve İşlevi:** Elleri dolu çalışan kişi düğmeye basılı tutup (≥ 0,3 sn) ya da iki kez dokunup (uzun dinleme; sessizlikte ya da
  "bitti" ile biter) konuşur ("C bir rafında ne var"). Okuma soruları (rafta ne var, kaç tane var, görevlerim, görev no) hemen sonuç açar;
  "aç/git" ekranı açar. Stoğu değiştiren isteklerde (giriş, çıkış, transfer, sayım başlat) "Anladım" kartı çıkar; **Onayla** denmeden hiçbir
  şey kaydedilmez ve kayıt mevcut ekranların komutlarıyla yapılır. Firma ayarı açıksa cevap (sonuç, onay sorusu, okuma özeti) doğal Türkçe sesle
  okunur. Niyet ayrıştırıcı kural tabanlıdır (dil modeli yok).

| UI Bileşeni / Buton / Alan | Tipi | Kullanıcı Aksiyonu | Tetiklenen API / Servis | Etkilenen DB Tablosu & Kolonu | İş Kuralı / Validasyon | Mevcut Durum |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Etkin düğmesi (basılı tut / iki kez dokun, "bitti") | Buton (mikrofon) + buzlu dinleme perdesi | Konuşulur | `etkinAnlaAction` → iç ses servisi `/stt` → `answerVoiceCommand` (`voice/yanit.ts`) | Okur: `items`, `locations`, `stock_balances`, `warehouse_tasks`, `tenant_settings.voice_reply` | `stock.view`; kişi başına dakikada 20 konuşma; ses en çok 8,5 sn 16 kHz WAV, yalnız bellekte (işlem sonrası sıfırlanır), kaydedilmez; ses bağlamı dokunuş içinde açılır (iPhone), sistem iptali kayıt göndermez | [GELİŞTİRİLİYOR] |
| Okuma sonucu kartı ("Aç", "Tümünü aç") | Kart | Dokunulur | Yönlendirme | — | Yalnız gösterir; belirsiz eşleşmede aday satırları + "Seç" | [GELİŞTİRİLİYOR] |
| "Anladım" kartı: İŞLEM / MİKTAR / ÜRÜN / YER, "Onayla" / "Düzelt" / "Vazgeç" | Kart + Buton (ya da kart açıkken tam "onayla") | Onaylanır | `createManualStockAction`, `transferStockAction` (`stock/documents/actions.ts`), `startCountAction` (`counts/actions.ts`) — mevcut eylemler | İlgili modülün tabloları (Modül 6, 10; giriş/çıkış 2B) | O eylemin kendi yetkisi, kapsamı, kilidi (I-15) ve tekrar güvenliği (I-06); yeni yazma yolu yok. Eksik bilgide ilgili form açılır | [GELİŞTİRİLİYOR] |
| Sesli yanıt (cevabın okunması) | Ses | — | `etkinSoyleAction` → ses servisi `/tts` (EMA Lightning) | — (metin saklanmaz/loglanmaz) | Yalnız `tenant_settings.voice_reply` açıksa ve kullanıcı "Sessiz" değilse; ≤ 400 karakter, kişi başına dakikada 30; aynı durum yazısı iki kez okunmaz | [GELİŞTİRİLİYOR] (kodda; B-130 kurulum bekliyor) |
| Ayarlar › Firma: "Etkin sesli yanıt" anahtarı | Anahtar (Kaydet) | Açılır / kapatılır | Ayarlar formu (`settings/form-actions.ts`) → `setVoiceReply` (`voice/ayar.ts`) | Yazar: `tenant_settings.voice_reply` (0063, varsayılan kapalı) + `audit_logs` (`tenant.settings_changed`) | `settings.manage`; değişiklik yoksa yazmaz; yeniden giriş istemez (sunum tercihi) | [TAMAMLANDI] kodda (T-1109) |

```mermaid
sequenceDiagram
  actor K as Kullanıcı
  participant E as Etkin düğmesi
  participant A as etkinAnlaAction
  participant V as Ses servisi (yerel)
  participant D as Niyet ve arama (voice)
  K->>E: Basılı tut ve konuş
  E->>A: Ses kaydı (yalnız bellekte)
  A->>V: /stt sesi yazıya çevir
  V-->>A: Metin
  A->>D: answerVoiceCommand (yalnız okuma) + voice_reply ayarı
  alt Okuma sorusu
    D-->>E: Sonuç kartı
  else Stok değiştiren istek
    D-->>E: Anladım kartı (taslak)
    K->>E: Onayla
    E->>E: Mevcut eylemi çağırır (ör. transferStockAction)
  end
  opt Sesli yanıt açık ve Sessiz değil
    E->>A: etkinSoyleAction (cevap metni)
    A->>V: /tts doğal Türkçe ses
    V-->>E: WAV, cihazda çalınır
  end
```

---

## 16. Bu bölümün GAP bulguları (eksik ve bekleyenler)

### 16.1 Arka ucu hazır, ekranı olmayan

| Konu | Hazır olan kod | Eksik |
| :--- | :--- | :--- |
| Görev adım adım ilerleme / kaldığı yerden devam | `tasks/actions.ts` (`recordTaskStepAction`, `beginSaveAction`, `saveTaskAction`, `resetTaskProgressAction`, `nextTaskAction`), tablo `warehouse_task_progress` | Hiçbir ekran çağırmıyor; panodaki "OKUTUYOR" durumu bu tabloya baktığı için şu an pratikte boş kalır. |
| ACİL işaretleme ve hedef saat | `setWorkPriorityAction` → `work_priorities` | Ekranda düğme yok; ACİL rozeti hiç yanmaz. |
| Vardiya saatleri | `updateWorkShiftAction` → `tenant_settings.shift_start/shift_end` | Ayarlar ekranında alan yok; herkes varsayılan 08:00–17:00 görür. |
| Sahadan bildirilen sorunu kapatma | `resolveProblemAction` → `problem_reports.status='RESOLVED'` | Ekranda "Çözüldü" düğmesi yok; açılan sorunlar hep açık kalır. |
| Paketli üretim | `production/actions.ts` paket eylemleri, tablolar `production_batches`, `production_inputs`, `production_packages` | Ekran yok. |
| Müşteri iadesi | `createCustomerReturn` (`operations/returns.ts`) | Sunucu eylemi ve ekran yok (B-52 kalanı). |
| Sipariş düzenleme, satır iptali, yeniden ayırma | `updateDraftOrder`, `cancelOrderLine`, `reallocateOrderLine` | Ekranda yok (yeniden ayırma yalnız toplama eksiğinde otomatik). |
| Yeniden yerleştirme görevi | Görev doğuyor (sipariş iptali / tahsis uzlaştırması) | Görevlerim'de "Başla" yok ("ekran henüz açılmadı"). |
| Paket işlemleri | Tam akış | `PACKAGE_RECEIVING_ENABLED` kapalı (B-50). |
| Etkin sesli yanıt ve rehber doğal sesi | `etkinSoyleAction`, ses servisi `/tts`, `tenant_settings.voice_reply` | Ekran hazır; VPS'te ses servisi kurulumu (B-130) yapılmadıkça çalışmaz (cihaz sesine düşer). |

> 28 Ekim kontrolü: `resolveProblemAction`, `setWorkPriorityAction`, `updateWorkShiftAction`, görev ilerleme eylemleri, paketli üretim eylemleri,
> `createCustomerReturn`, `updateDraftOrder`/`cancelOrderLine` için web kodunda hâlâ çağıran ekran yok (23 Ekim'den beri değişmedi).

### 16.1b Onaylı tuvalde olup kodda olmayan (bu bölümün ekranları)

| Konu | Tuval | Kod | Boyut |
| :--- | :--- | :--- | :--- |
| Yönetici ana ekranı | `Standart*.dc.html` (26 Ekim onaylı): 3 bekleyen iş kutusu + 8'li İşler ızgarası + sürükle-bırak düzen | Eski Pano panosu (`pano/pano-board.tsx`) | Yalnız arayüz, orta; veri var |

### 16.2 Veritabanında olup ekranda görünmeyen

- `customer_returns`, `customer_return_lines`: tablo var, yazan kod yok.
- `sales_orders` müşteri bağlantısı yalnız serbest metin (`customer_ref`); **Cariler** (`parties`, 0050) ile bağlı değil. Siparişte teslim tarihi ve
  depo kolonu yok.
- `stock_alerts` (min/max uyarıları, 0017): tablo var ama web, iş kuralı ve worker kodunda **onu okuyan ya da yazan yer yok**. Pano kartları
  uyarıyı doğrudan `item_stock_policies` + `stock_balances`'tan hesaplıyor. Min/max değerini (`item_stock_policies`) giren ekran 2B'de ayrıca kontrol edilmeli.
- `tenant_settings.count_abandon_hours` (terk edilmiş sayım süresi): worker kullanıyor; kullanıcıya gösterildiği bu belgede doğrulanmadı.
- İşlem rehberlerinin "görüldü" bilgisi sunucuda yok; yalnız cihazda tutulur (B-75 kalanı).

### 16.3 Eksik kural / kısıt

- Sevkiyat, toplama ve sayım yalnız **lot/seri takibi olmayan** ürünlerde çalışır; takipli ürün sevk formunda reddedilir.
- Toplamada "rafta ürün hiç yok" barkodsuz bildirilemez; eksikten doğan oturumsuz sayım görevi sahada açılmaz (B-96).
- Paketsiz depolar arası transferde iki fiş arasında `stock_document_links` bağ kaydı yazılmıyor (paketli transfer ve üretimde yazılıyor);
  raporlamada iki fişin eşleştirilmesi için gerekirse eklenmeli (karar gerektirir).
- İade üst sınırı (`sevk − iade`) DB kısıtı değil, komut kuralıdır (kilit altında denetleniyor; bilinçli tasarım A-150).

### 16.4 Transaction (hep-ya-da-hiç) gerektiren noktalar — mevcut durum

- Transfer (iki fiş), üretim (çok fiş + bağ), sevk (fiş + rezervasyon + sipariş satırı + sipariş kapanışı), sayım fişi (defter + kilit açma +
  görevler) **tek işlemde** yapılıyor.
- Bilinçli istisna: toplamada "eksik" sonrası **yeniden ayırma ayrı işlemdir**; arada hata olursa satır ayrımsız açık kalır ve ekranda görünür
  (`picking.ts` açıklaması). Yönetici "Stok ayır" ile yeniden deneyebilir.

### 16.5 Güvenlik

- Bu bölümün ekranları için ayrıntı yazılmaz (depo herkese açık). İlgili genel başlıklar BACKLOG'daki 🔒 satırlarındadır: B-17, B-18, B-20, B-21.

### 16.6 Önerilen sıra (bu bölüm için)

1. B-130: VPS ses servisi kurulumu (kullanıcı root adımı) — Etkin, doğal ses ve sesli yanıt kodu `main`'de hazır; kurulmadıkça çalışmaz.
   T-1110 (doğal komutlar) birleşti; yerel dil modeli kararı kullanıcıda.
2. Yönetici ana ekranını onaylı tuvale getir (3 bekleyen iş kutusu, 8'li İşler, sürükle-bırak) — veri var, yalnız arayüz (28 Ekim önerilen sıranın 2. maddesi).
3. B-50: paket akışını aç (ayar + normal girişe bağlama) — kod hazır.
4. Sorun kapatma + ACİL + vardiya ayarı ekranları — arka uç hazır, küçük iş; ana ekrandaki rozetler gerçekten çalışır hâle gelir.
5. B-96: toplamada "ürün yok" ve eksikten doğan sayımı sahadan başlatma.
6. İade ekranı (B-52 kalanı) — önce tasarım tuvaline eklenmeli.
7. Görev adım adım ilerleme ekranı ve Yeniden yerleştirme saha ekranı.
8. Sipariş ↔ Cari bağlantısı ve sipariş düzenleme (kullanıcı kararı gerekir: şema değişikliği).
9. Rapor modülü (önce tuval + kullanıcı onayı).
