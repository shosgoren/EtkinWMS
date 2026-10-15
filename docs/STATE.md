# Etkin WMS — güncel devam durumu

Son doğrulama: 14.10.2026 Europe/Istanbul; kod, CI, main ve VPS ayrı otoritelerdir.
Önce continuity/README, sonra yalnız görev alanı. Sırlar ve tek kullanımlık bağlantılar kaydedilmez.

## Canlı / erişim
- Repo https://github.com/shosgoren/EtkinWMS; 2027-WMS-1 salt okunur.
- WMS https://wms.etkinyazilim.com; satış https://etkinyazilim.com; .com.tr yönlendirmesi.
- Hostinger VPS187.7.76.72; PostgreSQL18 VPS özel Docker ağında. Neon/Fly canlı değildir.
- Beş servis: web, worker, marketing, Caddy, postgres. Erişim metadatası continuity/OPERATIONS.
- Son doğrudan receiver: release fdf9d6ee88a4a5af58092568faf069bbcd723f23, healthok, auto_migrate=true; schema34 fingerprint c8e5f225d5c818f3ddda4691b198bd77564e098ca26cbbd18115e80bcd5f179d.
- Son main metadata ayrı ilerleyebilir; canlı SHA'yı GitHub main'den varsayma.
- Motive ACTIVE owner hosgorens@gmail.com; 13 Ekim parola/MFA ile giriş yaptı. Yeniden oluşturma/reset/owner-session üretme yok.
- PACKAGE_RECEIVING_ENABLED false; bütün QR pipeline tamamlanmadan normal kullanıcı akışı açılmaz.

## Kullanıcı ana kuralları
- Marka Etkin WMS; ilk müşteri Motive Rubber,3depo; sektör bağımsız aylık SaaS hedefi.
- İlk bilgisayar kullanımı düzeyinde kısa ikon/renk/eylem; desktop/tablet/telefon ayrı,48kontrol/56anaeylem, tek el alt geri/ana ekran.
- 5VARIL×200KG=5tekilHU/QR+1000KG; ürün barkodu, paketQR, lot/seri ve palet ayrı kimliklerdir.
- QR EWMS:PKG:1:<uuid>; lot/üretim/SKT ve immutableoriginfactor; kalan değişir, kimlik değişmez.
- Stable belge/satır ID; POSTED defter append-only/ters kayıt, fiziksel silme yok; motor/tenant/RLS/yetki korunur.
- HM/YM/MM/TM, kod HM-000001; standart birimler ve çevrim/birim barkodu; reçete HM→YM→MM.
- Docs her teslimde güncellenir; yalnız gerekli rehber/kartı oku, geçmiş JOURNAL/Git'te.

## Kabul / yayın zinciri
- PR29 mal kabul/etiket UI ve PR37 gerçek izole fixture actorları main'de. QRflag kapalı.
- PR39 kalite/yerleştirme main/canlı schema34; bağımsız security0/0/0 ve dokuz kapı geçti.
- PR40 transfer kaynak05f56b ordinary-runtime güvenlik bulguları kapalı; bağımsız fresh35 165/165, gerçek browser16/16 PASS. Main belge merge sonrası exacthead CI tekrar doğrulanır;35 canlı varsayılmaz.
- PR41 üretim veri: prepare yalnız gerçek APPROVED IN/HU/LOT/plan; post freshOUT+existingIN atomik. Aynı kaynak depo, farklı çıktıdepo; mixedsources önce QRtransfer.
- C bağımsız d4c22b fresh36 schema184/domain138/unfilterednative207 PASS; boundary33PASS. Public yarış doğal motor; native forcedRR ayrı doğru adlandırılır.
- B/C security BLOCKER0/MAJOR0/MINOR1: yalnız privileged eski stock_document_links UPDATE adoption sınırı. wms_app UPDATEgrant/publiccaller yok; pilot kabulü, raw privileged link UPDATE yapılmaz; owner-alltamper garantisi verilmez, hardening backlog.
- PR41 fullint dört eski restore/ledger fixture hatasıyla durdu: yeni36 trigger inventorysine uyarlama T964; assertion/SQL/config/timeouts korunur. Yeni exacthead dokuzCI sonra merge.
- PR42 T963 üretim UI: güncel36 gerçek4viewport E2E4/4 PASS; yeni UIsecurity0, inheritedminor1. Legacy2 browser savedrecipe ?id regression düzeltmesi; explicitmode=packages ile QR/legacy korunur; finalrerun/dokuzCI bekler.
- T970–974 siparişsiz QR tam paket çıkışı37: DB219/nativeAC292, domain mevcut90/native10 PASS; boundary/UI/yeni dispatch QA/security/9CI henüz tamam değil.
- D37 fullcurrentremaining AVAILABLE/reserved0, müşteri/reference; siparişsiz açık ad. Gerçek sipariş rezervasyon/picking/STAGING entegrasyonu bu teslim değildir.
- T975 normal giriş yönlendirmesi/flag activation sonraki operatör teslimi: Mal geldi→paket kabul, Taşı→QR, Üret→QRmode, Sevk→siparişsiz çıkış. Henüz yapıldı denmez.

## Doğrulanmayan / sonraki
- Fiziksel telefon/notebook kamera, Epson/yazıcı, Bluetooth/elterminal kabulü UNKNOWN; browser/QRdecode/printdialog donanım başarısı değildir.
- 13 Ekim16:38UTC isolated pg_dump/restore schema31 ledgerbalance fark0 PASS; günlük offsite/WAL/PITR/RPO/RTO/authrestore hâlâ UNKNOWN.
- MAIL_MODE disabled; mail teslimi varsayılmaz.
- Excel anaürün/birim/standartbarkod otomasyonu, paletgruplama/split, yetkili draftedit/cancel/reversal, ERPsenkron/billing, ürün görseli ve fullsiparişQR ayrı backlog.
- Migration tek yazar/operatör; birleşmiş migration değiştirilmez. Dokuz PR/main kapısı ve receiverbackup/schema/health ayrı doğrulanır.
- Eski/stacked PRları kör yeniden birleştirme; git ancestry ve exacthead kontrol et. Başarısız geçmiş/ölçüm sınırları JOURNAL ve kartlarda korunur.

- T-945 (14 Ekim): demo talebi kaydından sonra Resend ile e-posta bildirimi (marketing/notify.mjs; ayar ortam ya da /data/notify.json; saatlik 20 üst sınır; hata kaydı bozmaz). Bağımsız security-reviewer 0/0/4 MINOR → dördü düzeltildi. Kullanıcı Resend hesabı + anahtar ekleyene kadar bildirim kapalı; gerçek gönderim doğrulanmadı.

- T-980 (14 Ekim, kullanıcı isteği): uygulama /login yeni dinamik sahne (solda canlı saha haritası + akış, sağda form); eski kart görünümü kaldırıldı, form mantığı/etiketleri aynı. Next yerelde derlenemedi (npm kapalı); statik önizleme ve CI ile doğrulanır.
- T-981 (14 Ekim, kullanıcı onayı "Tamam olur"): /login hareketli Rota e sahnesi (istasyonlar, QR yaka kartı yazıcısı, parola göster, Caps Lock, adresi hatırla), mobilde tek satır bant; üst bar ve PWA simgeleri Rota e; T-980 harita sahnesi kaldırıldı. Next yerelde derlenemedi (npm kapalı); renk tarayıcısı yerelde geçti, asıl doğrulama CI + canlı kontrol.
- T-982 (14 Ekim, kullanıcı isteği): satış sitesi demo formu KVKK düzeltmesi — onay kutusu "Aydınlatma Metni'ni okudum", açıklama alanına hassas veri uyarısı, /privacy aydınlatma metni (amaç, hukuki sebep, yurt dışı aktarım: Hostinger + Resend ABD, çerez yok, m.11 hakları). Açık: veri sorumlusu kimliği/saklama süresi (henüz şirket yok, kullanıcı kararıyla bekliyor) ve yurt dışı aktarım için standart sözleşme (hukuki süreç, avukat).
- T-983 (14 Ekim, kullanıcı isteği): giriş ekranında kök üst bar (Kolay mod, Nasıl kullanırım?, Yardım) gizlendi, ilk rehber girişte açılmaz (girişten sonraki ilk ekranda açılır); canlıda (demo ve kayıt kapalı) eski karşılama ekranı "/" yerine doğrudan /login. Demo/kayıt açık ortamlarda karşılama ekranı demo girişleri için kalır. e2e rehber testleri "/" üzerine taşındı, sade giriş testi eklendi.
- T-984 (15 Ekim, kullanıcı kararı: tasarım ekranları aşamalı, Kokpit şimdilik aynı): Aşama 1 — Akış ana ekranı "Görevlerim" tasarımı (gerçek özet: bekleyen/bana atanan/bugün; Giriş-Çıkış-Transfer-Üretim döşemeleri aynı hedeflere; Sayım "Yakında"; Plan dışı manuel giriş/çıkış). Sonraki aşamalar: 2 mal kabul+yerleştirme görünümü, 3 transfer+manuel, 4 toplama+sayım saha ekranları (alan bağlantısı, güvenlik incelemesi).
- T-985 (15 Ekim): Aşama 2 — saha adım çerçevesi (mal kabul, yerleştirme, paket akışları ortak FlowShell) Görevlerim bandına geçti: kategori koyu tonunda üst bant, kesik çerçeveli tarama paneli; mantık/test kimlikleri aynı. T-984 canlıda (PR49).
- T-986 (15 Ekim): Aşama 3 — stok/transfer/manuel belge ekranlarında Görevlerim başlık bandı (yalnız CSS, data-section stock/transfer; transfer moru ana ekran döşemesiyle aynı). Yönetici ekranları aynı. Aşama 4 (toplama + sayım saha ekranları) alan bağlantısı ve güvenlik incelemesi gerektirir; kapsam kullanıcıyla netleşecek.
- T-987 (15 Ekim, kullanıcı kararı: önce sayım, yönetici atar): Aşama 4a alan — `createCountTasks` (raf başına COUNT görevi + atama), `cancelCount` kendi görevlerini kapatır, okumalar `getCountWork` (kör), `listCountSessions`, `getCountReview`. Migration yok. Sonraki: yönetici ve saha sayım ekranları (T-990/T-991; T-988/T-989 başka işlere verildi).
- T-988 (15 Ekim, kullanıcı kararı: "tasarım birebir olmalı, her şeyiyle; standart kural haline getir" + "altyapısını da kur"): **I-18 Tasarım birebir** kuralı (INVARIANTS, AGENTS.md, `docs/design/DESIGN-PARITY.md`); kaynak `docs/design/source/Bakis.dc.html` (sha256 kayıtlı); CSS ve renk belirteçleri `scripts/design/port.mjs` ile üretilir, bekçi `design-parity.test.ts`. Görevlerim ekranı kaynaktan birebir (ikon yolları, açık/koyu tema, mobil başparmak çubuğu, ⚠ açılır kutusu: Sorun bildir · Nasıl kullanılır? · Menü; yönetim sayfa bağlantıları uygulama menüsünde). Kanıt `docs/design/parity/gorevlerim/`: aynı veriyle 390/1180/1440'ta piksel farkı 0 (koyu tema 2 px kenar yumuşatma). Migration **0037_work_signals**: vardiya (`tenant_settings.shift_*`), `work_priorities` (ACİL + saat), `problem_reports` (OPEN→RESOLVED). Domain: setWorkPriority, reportProblem, resolveProblem, updateWorkShift, listOpenProblems; getWorkSummary sorunlu iş/ACİL/vardiya/manuel. **Canlı (15 Ekim, PR #53 → main a024053, deploy-vps başarılı, migration 0037 uygulandı).** Güvenlik incelemesi 0/0/0 @1c3a733. Eksik: bölüm/durum listesi, giriş, sayım, toplama, manuel ekranları sıradaki işler (geçici olarak döşemeler eski ekranlara gider); ACİL/vardiya için yönetici giriş ekranı henüz yok (komutlar hazır); Üretim emri kavramı yok (Üretim açık işi gerçek 0). Int ve e2e testleri yalnız CI'da koşar.
- T-989 (15 Ekim, kullanıcı kararı): **I-18 Tasarım birebir** değişmez kuralı (INVARIANTS, AGENTS.md, `docs/design/DESIGN-PARITY.md`). Korunan değişiklik ayrı küçük PR (I-17). **Birleşti (PR #54 → main 22bed7e).** Uygulaması ve bekçisi T-988 (PR #53).
- T-945 canlı: Resend alan adı (etkinyazilim.com) doğrulandı, anahtar kullanıcı tarafından eklendi; 14 Ekim 18:2x deneme talebi hosgorens@gmail.com'a Delivered.
- T-992 (15 Ekim, kullanıcı kararları): **ADR-026 önerildi** — demo talebi operatör onayıyla aktivasyon bağlantısı; müşteri çalışma alanı adını seçer, adres `wms.etkinyazilim.com/<alan>` (yol tabanlı; alt alan çerez/TLS/olta riski nedeniyle sonraya); 3 ay deneme, örnek verili/boş + ayarlardan temizleme; sırsız hoş geldiniz e-postası; e-postasız saha personeli = kullanıcı adı + etkinleştirme kodu + 6 hane PIN, yalnız kayıtlı cihazda (kişisel telefon ve ortak el terminali). Kartlar T-993 tasarım kaynağı → T-994 onay → T-995 aktivasyon → T-996 örnek veri → T-997 saha PIN → T-998 ortak cihaz → T-999 giriş yönlendirmesi. Sonraki eklemeler: geçiş anahtarı (Face ID/parmak izi), yaka kartı/barkod girişi, vanity alt alan/kendi alan adı, SSO. Açık: Q-127 deneme bitişi, Q-128 PIN uzunluğu. Kod yok.
- T-993 (15 Ekim, kullanıcı onayı "Onaylıyorum"): giriş ve hesap ekranları tasarım kaynağı `docs/design/source/Giris.dc.html` (tuval sayfası "Uygulama · Giriş ve hesap", sha256 kayıtlı): giriş (e-posta / saha PIN), doğrulama, alan seçimi, 4 adım aktivasyon, saha etkinleştirme, ortak cihaz kullanıcı değiştir, saha personeli + etkinleştirme kartı, cihazlar, operatör demo talepleri, hoş geldiniz e-postası. Mevcut /login (T-981) bu kaynağa göre T-999'da birebir değişecek. Bilinen eksik: üreteç tema paletini Bakış'a özgü okuyor; Giris için ilk ekran PR'ında genişletilecek. Kod yok.
- T-400 (15 Ekim, kullanıcı kararları: "yönetim paneli", "yonet.etkinyazilim.com olsun", paketler panelde ve satış sayfasında, "Tamam İyzico devam edebilirsin"): **ADR-027 önerildi** — panel ayrı kökende (`yonet.etkinyazilim.com`, aynı imaj panel kipinde), müşteri içeriği görülmez yalnız sayılar, paketler sürümlü + sınırlar veritabanında, iyzico Abonelik (yükseltme hemen / düşürme sonraki dönem, kısmi dönem farkı yok), şirket kurulana dek ödeme elle işaretlenir. Tasarım kaynağı `docs/design/source/Yonet.dc.html` (sha256 kayıtlı). Kartlar T-401…T-409. T-994 ekranı panele taşınacak (T-402). Kullanıcı adımı: Hostinger DNS `A yonet → 187.7.76.72`. Kod yok.
