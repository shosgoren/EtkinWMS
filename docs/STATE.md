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
- T-945 canlı: Resend alan adı (etkinyazilim.com) doğrulandı, anahtar kullanıcı tarafından eklendi; 14 Ekim 18:2x deneme talebi hosgorens@gmail.com'a Delivered.
