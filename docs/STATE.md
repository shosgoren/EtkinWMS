# Etkin WMS — güncel devam durumu

Son kayıt: 14 Ekim2026. Kaynak, GitHub kontrolleri, canlı sürüm ve fiziksel cihaz kabulü ayrı doğrulanır.

## Canlı doğrulandı
- Yalnız shosgoren/EtkinWMS yazılabilir; 2027-WMS-1 salt okunur.
- Son doğrudan VPS receiver: release `d2dbc9be1bf1be838dbe9973c36ee896190c2878`, health=ok, auto_migrate=true; satış PR35 ve önceki WMS PR29 kaynakları içerir.
- Hostinger187.7.76.72; WMS https://wms.etkinyazilim.com ; satış https://etkinyazilim.com . PostgreSQL18 VPS özel Docker ağında, Neon/Fly bağımlılığı yok.
- Son schema0033/33 fingerprint `63869a172f9738df7c4e41fe7e4c57a7c43abdd9c352d9b9b33006ee33222e72`. Web/worker/marketing/Caddy/PostgreSQL beş servis.
- Motive sahibi hosgorens@gmail.com ACTIVE;13Ekim parola/MFA kuruldu. Hesabı yeniden oluşturma/sıfırlama/impersonate etme.
- Paket kabul/etiket kodu yayımlandı; PACKAGE_RECEIVING_ENABLED varsayılanfalse. Hareket/üretim zinciri bitmeden normal kullanıma açılmadı.

## Şimdi yapılan bağımsız test ortamı düzeltmesi
- T956 / feat/T-956-package-fixture-isolation: paket receiving/movement/transfer/production akışları desktop/mobile gerçek ayrı signup/workspace/MFA kullanıcıları kullanır. Legacy stock kullanıcıları aynı kalır; seedPackage optionalworkflow defaultreceiving, label rol sorgusu gerçekreceiving kullanıcıyla yapılır.
- CI38553064258 web.log aynı stockMobile hesabının sabit dakikada121POST ürettiğini gösterir;120 kullanıcı sınırı aşıldı. Hız sınırları/counter/config/testcase/assertion/timer değişmedi; aynı kullanıcı bütçesi çakışması giderilir.
- Gerçek schema33 freshbrowser8/8PASS (receiving+label6 ve değişmeyen stock2), skip/retry0; roottypes/lintPASS. On gerçek actor için farklıtenant/user, aktifadmin/MFA ve KG/GR booleansalltrue. İlk6/6 ve staleetiket-kullanıcısı nedeniyle6/8FAIL geçmişi korunur.
- T956 PR37 auth/secrets review0 ve verify3921PASS; sekizGitHub kapısı PASS, tarayıcı93PASS/1FAIL eski mobil arama geometrisi. Gerçek CI trace hiddenSuspense geometri ölçümü gösterdi; shareditemshelper count1+visible kabuk/nav sonrası tüm özgün geometri ölçümlerini korur. Freshdesktop/mobile2PASS/74.487s;427productionhashunchanged; yeni9CIhead bekler. Bu kayıt yayın başarısı değildir.

## Devam eden QR paketleri
- [PR33](https://github.com/shosgoren/EtkinWMS/pull/33), int/package-movement:0034 sameQR kalite/aynıdepo yerleştirme. BeşQR kartı T951–955,30dosya; T941–943 satış kartlarıdır. 3d4ef8b verify/int/AC/guardPASS fakat tarayıcı iki hata: geçiciSSRçiftDOM count1assert ile4/4freshPASS; ortakstockactor hız bütçesi T956 ile ayrılır. 629fc0e son test assertion kaynağıdır; QR kartları T951–955 olarak ayrıldı. Güncelmainba21dfa satış PR36 kaynakları korunarak birleşir, bu henüz CI/canlı sonucu değildir.
- int/package-transfer yerel geliştirme:0035 ikiPOSTED OUT/IN, sharedHU/predecessor zinciri, currentwarehouseACL. Bağımsız414+23 ve final363PASS, schema156/browser4PASS; security0 @0383722. Test-onlyhelper/hydration düzeltmesi feec102 kaydedildi; T956 üstdalına aktarılınca tüm kapılar yeniden doğrulanır. Henüz canlıschema35 değil.
- int/package-production yerel C-data:0036 partialconsume/newoutputQR. Engine immediateFK+tekexistingdoc nedeniyle yalnızoutputIN/HU/LOT hazırlanır; post freshOUT ve existingIN stok etkilerini atomik tamamlar. Aynı kaynakWH, farklıoutputWH olabilir; farklıkaynak önceQRtransfer. C-data schema146/nativeAC04tag292 ve domainfrozen134PASS; boundary33PASS; UI authoring başladı. Fullverify ilk guardunit5000ms timeout, eşik değişmeden yeniden kontrol edilir; security/CI/yayın pending.

## Kalıcı kurallar ve açık kabul
- Marka Etkin WMS; Motive Rubber ilk müşteri, sektör bağımsız aylık SaaS. İlk kez kullanıcı: azmetin, ikon+renk,48px kontrol/56px anaeylem/geri, desktop/tablet/telefon ayrı düzen.
- 5VARIL×200KG→5immutableHU/QR/1000KG; ürün barkodu/lot/seri/palet kimliği farklı. AynıQR bütün hareketlerde kalır; posteddefter fiziksel silinmez.
- Şifre/anahtar/URI/MFA/bearer bağlantıları belge/log/chat'e girmez; CI/guard/limit/timeout/locking zayıflatılmaz. Rootuygulama kodu yazmaz.
- Kamera/Epson/elterminali fiziksel kabulü UNKNOWN. Günlükoffsite/WAL/PITR/RPO/RTO/authrestore doğrulanmadı;13Ekim izolepgdump/restore schema31/netledger0 kanıtı var.
- Excel/ürünbirim barkodu, yetkilifişdraftedit/iptal/terskayıt, ERP aktarımı ve QRsevkiyat kalan ayrı işlerdir; tamamlandı sayılmaz.
- Giriş [continuity/README](continuity/README.md); erişim/yayın/yedek [OPERATIONS](continuity/OPERATIONS.md). Güncel kalan kart/GitSHA/run/VPSdefter kanıtı sohbet tahmininden üstündür.

- A kaynak aktarımı int/package-movement-ready: aynı incelenmiş30Gitblob, beş gerçekT951–955 author teslimi; eski çakışan kart history guard hatası korunur. YerelT956 actor üstü henüzmain/yayın değildir; yeni actualbase kapıları bekler.

- B int/package-transfer-ready: önceki reviewedfeec102 kaynakları mevcutA/T956 üstüne Gitblob olarak taşındı; test-only workflowcall adoption ve exactheadfullverify/CI bekler. Eski kaynak incelemesi0@0383722, yeni sourcecode aynı fakat branch ancestry yeni.

- C-data int/package-production-ready: dörtT960/T961/T962/T964,30actualpaths; sourcec73816c exactapplication/QA blobs. Finalindependent domain138/schema171/nativeACtag292+unfiltered38/boundary33PASS; linkcardinality andprepareplay repaired. UIfreshbrowserpending; newexactheadsecurity/verify/9CI/main/live36 separate.
