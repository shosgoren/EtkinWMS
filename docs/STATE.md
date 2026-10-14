# Etkin WMS — güncel devam durumu

Son doğrulama: **14.10.2026 11:36 Europe/Istanbul**. Kaynak/CI/yayın/cihaz kabulü ayrı durumdur.

## Canlı — doğrulandı
- Repo: https://github.com/shosgoren/EtkinWMS ; `2027-WMS-1` yalnız salt okunur.
- Main ve canlı kaynak: `53ed35e756e5ceb616326bd28adef869bd2963a2`, [PR29](https://github.com/shosgoren/EtkinWMS/pull/29).
- PR dokuz kapı PASS: ci38532830145 + guards38533321538; main dokuz kapı PASS: ci38534665126 + guards38534665085.
- [Deploy38536026685](https://github.com/shosgoren/EtkinWMS/actions/runs/38536026685) SUCCESS; receiver job115759663421 `deployed53ed/healthok`, 08:36:32UTC.
- VPS Hostinger187.7.76.72: web, worker, marketing, Caddy, PostgreSQL18; DB public port yok/TLSverify-full. Neon/Fly canlı bağımlılığı yok.
- Uygulama https://wms.etkinyazilim.com ; satış https://etkinyazilim.com .
- Son doğrudan DB defteri0033/33; fingerprint `63869a172f9738df7c4e41fe7e4c57a7c43abdd9c352d9b9b33006ee33222e72`. PR29 şema değişmedi.
- Motive owner ACTIVE; yönetici13Ekim parola/MFA kurdu. Hesabı yeniden oluşturma/sıfırlama.
- Paket kabul/etiket **kodu yayımlandı**, `PACKAGE_RECEIVING_ENABLED` varsayılanfalse. QR hareketi bitmeden yeni kabul normal kullanıma açılmadı.

## Hazır kod ve kanıt
- T931–934: exactdecimal paket miktarı; 5VARIL×200KG=5HU/1000KG; immutable origin/QR, lot/üretim/SKT, RLS, idempotent taslak/atomik kabul.
- T939/PR28: append0033 assertion planı; gerçek200KGpaket kabulü12.525s<30s. Motor/timeout/locking gevşetilmedi; bağımsız QA84/84 ve güvenlik0/0/0.
- T935–938/T940: dört adımlı kabul ve aynıQR yeniden etiket; readonly yetkili GET, hydration hazır kontroller, server flag, kısa yönlendirme.
- UI finalverify3915PASS; gerçek paket tarayıcı6/6PASS, AC04161/161PASS/schema33; kodarama legacy4/4PASS, skip0. Final CI ayrıca dokuzPASS.
- PR30 ortak Typeahead hydration onarımı, PR31 yalnız AC baseline artışı; ikisi birleşti. **Baseline artışı korunan değişiklik değildir; yalnız düşüş korunan.**
- Hata/onarım geçmişi Git, görev kartları, PR raporları ve JOURNAL'dadır; eski pending satırları bu snapshot yerine kullanma.

## Aktif — bir sonraki tek adım
- Dal `int/package-movement`, çalışma ağacı `/private/tmp/etkin-package-performance`; taban canlı53ed.
- **T941 DB engineer**: append0034 step zinciri + tamHU QC_RELEASE/PUTAWAY dar allowlist; RR fork, RLS, down/rollback gerçek testleri. Aynı anda tek migration yazarı.
- Sonra seri T942 komut → T943 currentQR/action → T944 ekran → T945 bağımsız QA+güvenlik ve dokuz kapı; beş kart/≤30 dosya.
- İlk dilim aynıQR kalite onayı ve aynıdepo yerleştirmesidir. Warehouse-transfer ve üretim tüketim/çıktıQR soy ağacı **sonraki ayrı paketler**, tamamlandı sayılmaz.
- Tamamlanmış kaynak incelemesi/kapılar/main/yayın/schema kanıtı olmadan flag açılmaz; Supervisor uygulama kodu yazmaz.
- Lokal GitHub/SSH bağlantısı reset/banner timeout verdi; resmi GitHub bağlantısı çalışıyor. Yeni erişim başarısı ölçülmeden yerel bağlantı düzeldi deme.

## Açık kabul ve işler
- Gerçek kamera/Epson/el terminali kabulü **UNKNOWN**; PDF/tarayıcı testi fiziksel yazıcı başarısı değildir.
-13Ekim16:38UTC pg_dump/izole restore schema31/ledger-balance fark0 PASS; günlükoffsite/WAL/PITR/RPO/RTO ve authrestore doğrulanmadı.
- Taslak düzenleme/iptal, yetkili düzeltme/ters kayıt, ERP aktarımı henüz bu paket kapsamında tamamlanmadı. Posted defter fiziksel silinmez.
- Üretim domain0029/0030 temeli var; HM→YM→MM reçete/emir ve paket izlenebilirliği tam saha kabulü bekler.
- Excel ürün/birim barkodu akışı, görsel ürün resmi, SelectField yayılımı ve mailteslimi (`MAIL_MODE=disabled`) kalan alanlardır; çalışma kodundan ayrı doğrula.
- v3 mal kabul eki belirtilen yerel yolda bulunamadı; okundu diye raporlama. Açık kullanıcı kararları uygulanır.

## Kalıcı kullanıcı kararları
- Marka Etkin WMS; ilk müşteri Motive Rubber; sektör bağımsız aylık SaaS.
- İlk kez kullanan kişi: az yazı, ikon+renk, kısa işlem, masaüstü/tablet/telefon ayrı düzen; dokunma48px, ana eylem/geri56px.
- HM/YM/MM/TM kartları; kod HM-000001. Standart birimler ve doğru çevrim; bilinmeyen katsayı/ADET uydurma.
- TekilQR fiziksel paketindir; ürün barkodu/lot/seri/palet ayrıdır. Fiş/satır kimlikleri değişmez; posted düzeltme append-only.
- CI/e2e/guard atlama veya test sınırı düşürme yok. Sır/şifre/MFA bağlantıları belgelere girmez.
- Giriş rehberi: [continuity/README](continuity/README.md); VPS/yedek/yayın: [OPERATIONS](continuity/OPERATIONS.md).
