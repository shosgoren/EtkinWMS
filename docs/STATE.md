# Etkin WMS — güncel devam durumu

Son kayıt: 14 Ekim2026. Kaynak, GitHub kontrolleri, canlı sürüm ve fiziksel cihaz kabulü ayrı doğrulanır.

## Canlı doğrulandı
- Yalnız shosgoren/EtkinWMS yazılabilir; 2027-WMS-1 salt okunur.
- Son doğrudan VPS receiver: release `908c22a0ee6da4e23a81c9286acbb732f141b621`, health=ok, auto_migrate=true; satış PR32 ve önceki WMS PR29 kaynakları içerir.
- Hostinger187.7.76.72; WMS https://wms.etkinyazilim.com ; satış https://etkinyazilim.com . PostgreSQL18 VPS özel Docker ağında, Neon/Fly bağımlılığı yok.
- Son schema0033/33 fingerprint `63869a172f9738df7c4e41fe7e4c57a7c43abdd9c352d9b9b33006ee33222e72`. Web/worker/marketing/Caddy/PostgreSQL beş servis.
- Motive sahibi hosgorens@gmail.com ACTIVE;13Ekim parola/MFA kuruldu. Hesabı yeniden oluşturma/sıfırlama/impersonate etme.
- Paket kabul/etiket kodu yayımlandı; PACKAGE_RECEIVING_ENABLED varsayılanfalse. Hareket/üretim zinciri bitmeden normal kullanıma açılmadı.

## Şimdi yapılan bağımsız test ortamı düzeltmesi
- T956 / feat/T-956-package-fixture-isolation: paket receiving/movement/transfer/production akışları desktop/mobile gerçek ayrı signup/workspace/MFA kullanıcıları kullanır. Legacy stock kullanıcıları aynı kalır; seedPackage optionalworkflow defaultreceiving, label rol sorgusu gerçekreceiving kullanıcıyla yapılır.
- CI38553064258 web.log aynı stockMobile hesabının sabit dakikada121POST ürettiğini gösterir;120 kullanıcı sınırı aşıldı. Hız sınırları/counter/config/testcase/assertion/timer değişmedi; aynı kullanıcı bütçesi çakışması giderilir.
- Gerçek schema33 freshbrowser8/8PASS (receiving+label6 ve değişmeyen stock2), skip/retry0; roottypes/lintPASS. On gerçek actor için farklıtenant/user, aktifadmin/MFA ve KG/GR booleansalltrue. İlk6/6 ve staleetiket-kullanıcısı nedeniyle6/8FAIL geçmişi korunur.
- Auth/secrets bağımsız inceleme, verify ve dokuzGitHub/main kapısı henüz tamam değildir. Bu kayıt yayın başarısı değildir.

## Devam eden QR paketleri
- [PR33](https://github.com/shosgoren/EtkinWMS/pull/33), int/package-movement:0034 sameQR kalite/aynıdepo yerleştirme. BeşQR kartı T951/T942–945,30dosya; T941 satış kartıdır. 3d4ef8b verify/int/AC/guardPASS fakat tarayıcı iki hata: geçiciSSRçiftDOM count1assert ile4/4freshPASS; ortakstockactor hız bütçesi T956 ile ayrılır. Güncel629fc0e CI/canlı sonucu yeniden doğrulanır.
- int/package-transfer yerel geliştirme:0035 ikiPOSTED OUT/IN, sharedHU/predecessor zinciri, currentwarehouseACL. Bağımsız414+23 ve final363PASS, schema156/browser4PASS; security0 @0383722. Test-onlyhelper/hydration düzeltmesi feec102 kaydedildi; T956 üstdalına aktarılınca tüm kapılar yeniden doğrulanır. Henüz canlıschema35 değil.
- int/package-production yerel C-data:0036 partialconsume/newoutputQR. Engine immediateFK+tekexistingdoc nedeniyle yalnızoutputIN/HU/LOT hazırlanır; post freshOUT ve existingIN stok etkilerini atomik tamamlar. Aynı kaynakWH, farklıoutputWH olabilir; farklıkaynak önceQRtransfer. UI sonraki ayrı teslim; kaynak/test/CI başarısı henüz yok.

## Kalıcı kurallar ve açık kabul
- Marka Etkin WMS; Motive Rubber ilk müşteri, sektör bağımsız aylık SaaS. İlk kez kullanıcı: azmetin, ikon+renk,48px kontrol/56px anaeylem/geri, desktop/tablet/telefon ayrı düzen.
- 5VARIL×200KG→5immutableHU/QR/1000KG; ürün barkodu/lot/seri/palet kimliği farklı. AynıQR bütün hareketlerde kalır; posteddefter fiziksel silinmez.
- Şifre/anahtar/URI/MFA/bearer bağlantıları belge/log/chat'e girmez; CI/guard/limit/timeout/locking zayıflatılmaz. Rootuygulama kodu yazmaz.
- Kamera/Epson/elterminali fiziksel kabulü UNKNOWN. Günlükoffsite/WAL/PITR/RPO/RTO/authrestore doğrulanmadı;13Ekim izolepgdump/restore schema31/netledger0 kanıtı var.
- Excel/ürünbirim barkodu, yetkilifişdraftedit/iptal/terskayıt, ERP aktarımı ve QRsevkiyat kalan ayrı işlerdir; tamamlandı sayılmaz.
- Giriş [continuity/README](continuity/README.md); erişim/yayın/yedek [OPERATIONS](continuity/OPERATIONS.md). Güncel kalan kart/GitSHA/run/VPSdefter kanıtı sohbet tahmininden üstündür.
