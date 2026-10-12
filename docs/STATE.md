# EtkinWMS pilot durumu — 12.10.2026 Cloud/yerel devir

Yalnız shosgoren/EtkinWMS. 2027-WMS-1 ve eski Fly/Neon kaynaklarına Cloud işlemi yok.
Cloudexecutor /workspace yeniden doğrulandı; geliştirme bilgisayardan bağımsız çalışıyor.
CanlıVPS/DB/yayın/hesap işlemlerinde tek operatör yerelHostinger görevidir; Cloudproductionmutate etmez.
Orijinal /workspace/EtkinWMS değişiklikleri korunuyor; reset/force yok.

Önceki exact C f396b9dd16776fe2cfed4ecf7c4077954fc472bf dokuzzorunluCI SUCCESS.
CI38275122311: E2E78/78PASS8.5m, integration105dosya1934/1934PASS; verify/infra/secrets/deps PASS.
Son guards38276462356 check-all/check-pilot/test-acSUCCESS. FAIL0; atlananürün testi0.
A48184f8 ve Be14fd11 önceki exactdokuzzorunluCI SUCCESS; E2E72/72 herbirinde.
Bunlar yeni main-entegrasyonu SHA'larının CI sonucu değildir.

Güncel main: 2f31481b94cefa52ca4c6eb4f98ad518ae99b223 (PR8 normalmerge, yereloperatör).
PR9foundation8926eec559e5d0e7c2a13c8ff091c1ff17b64b41 → main;18dosya.
PR10guided/test55468dcd70a364615bcb83712b8b075512d4b343 → foundation;30dosya.
PR6B → feat/T-908-guided-integration;30dosya; sonpush PRmetadata'da.
PR7C → int/pilot-domain(B);30dosya; sonpush PRmetadata'da.
Birleşik uygulama kodu adayı41472da714a029ce41eec5e5a98350572c6d809f: T902+T905+foundationfix+A+B+C içerir.
Sonraki commitler yalnız kart/devir/tabanbelgesi; yayın hedefi güncelmainSHA olmalı, aday henüz main değil.
Bağımsız incelemeler: foundation52881e9, guidedfc876bc, B8bc215f, C41472da security0/0/0.
CQA/tasarımBLOCKER1: dolu7iş ana ekranı küçükgörünümde kaydırma gerektiriyor.
Parent kullanıcıya büyükdokunmahedefleri+dikeyscroll kararı sordu; gerçekyanıt bekleniyor.
Spec/eşik/guard sessizce değiştirilmedi; Cmerge/deploy kabulü verilmedi.
Yeni main zincirinde CI yeniden gerekli. T902/schema27 ara-main otomatikyayın tetikleyebilir; yereloperatörkoordinasyonu zorunlu.

PR8 exact2a706b3dae936d2d94b19b132cad1b7ba99ffc13 security0/0/0,QA12/12PASS.
Yereloperatör gerçekuseronayıyla onaykaydı+yeşilCIsonrası normalmerge yaptı.
GitHubrunner→VPS check38276859152 SUCCESS; CloudjobsAPI checkSUCCESS/build+deploySKIPPED doğruladı.
Bu ürün yayını veya signed-positiveimage doğrulaması değildir; kişisel/rootanahtar Cloud'a aktarılmadı.
VPSapprovedschema27 b5a999421a7528cb8b1c1f3f77dcee6769c30397f8af69fea9522af2342717ae.

Kullanıcı DB'nin deVPS'de olmasını istedi. Yereloperatör PG18privatevolume/TLS taşınmasını yürütüyor.
Neonboşlukönkontrolü hedefkarışıklığında askıyaalındı; sonradanactualendpoint eşleşmesi yerelden bildirildi.
YeniVPSDBcutover/sağlık tamamlandığı ayrıca kanıtlanmalı; CloudeskiNeonhedefinemutationyapmaz.
YerelT907/PR11 DBcomposeCA/HBA değişiklikleri yereloperatöre ayrılmıştır.

Migration28belgebağları,29değişmezreçete,30transactionmührü; miktarları yenidenyazmaz.
Scratch3/3PASS: boş30→27→30, verili downreddi/kayıtlarınkorunumu.
Yeni bağlıveri sonrasında guided-20261012 tekbacaktersleme riski taşır; eskiimage/down otomatikrollback değil.
Yazmalarıdurdur→özelbackup+izolerestore→30uyumlufallbackimajtesti→yetkilimigration→worker/web→health→yazmalarıaç.
Canlı30uyumlufallbackimage/digest+restorekanıtı henüzyok; schema/state varsayımla ilerletilmez.

İlkhesap hosgorens@gmail.com: canlıhesap/parola/MFA teslimkanıtı yok.
T906saltreadonlyönkontrol767d827baf24492c7ca43ebba8762b13e40c3006 push edildi.
Mevcutyetkiliowner varsa normaldavet+gerekirseownershiptransfer; yeniürünmigration gerektirmez.
YerelboşDBbildirimi sonrası T909initialowner enrollment ayrı hazırlanıyor; canlıuygulanmadı.
Parolasızkullanıcı+yenitenantowner, mevcutHTTPSnormalreset/MFA; publicsignup/RLS/rolguard değişmez.
MAIL_MODEdisabled: linkyalnız root0700/exclusive0600dosyayla güvenliteslim; buayrıcapability exactonayı gerektirir.
Kaynakşema27/PG18 exactproof mevcutoperatörbağlantısında READONLY; runtimegrantgenişletilmez.
T909bağımsız12/12schema27proof/auth/MFA testleriPASS; exactreview/bundle/fileteslim kapıları henüzaçık.
Ürün yeni özellike eklenmiyor; hesapkurulumuaracı ürünUI'den ayrı ve yayınhazırlığı demekdeğil.

Gerçekcihaz/kamera/yazıcı kabulü0/13; sosyalüyelik/platformadmin ve yeniSMTP altyapısı bu işte eklenmiyor.
Güncel ayrıntılı kanıt ve rollback planı PILOT_HANDOFF.md sonkayıttadır.
