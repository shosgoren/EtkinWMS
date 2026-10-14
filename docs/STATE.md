# Etkin WMS — güncel devam durumu

Son durum kaydı: **14.10.2026 12:29 Europe/Istanbul**. Bu oturumda doğrudan VPS receiver release53ed/healthok/schema33 doğrulandı. Kaynak/CI/yayın/cihaz kabulü ayrı durumdur.

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
- T941 append0034 taslağı: Node24 gerçek100/100 testPASS (16yeni+61legacy+23drift); iki tekrar fixture42P08 üst onarımla çözüldü, kaynakguard değişmedi. Bağımsız125/125PASS owner/foreign/cycle/original33oracle/twoRR; mevcutkabul roundtrip54/54PASS/200paket17.078s<30s. Güvenlik/CI/yayın henüz tamam değil.
- T942/T943 gerçek58/58PASS (30core/28legacy), schema34; bağımsız final283PASS+schema125PASS+AC04loader169PASS, security6c7e7d0/0/0. T944 gerçek4/4E2EPASS/39.8s, skip/retry0; sameQR/lot/dates/diğer800KG/dörtviewport/56nav doğrulandı. Verify3929 ve checkall6PASS; son test-onlydelta/üçüncüpilotinventory fixture sonrası dokuzCI/yayın kapıları; beş kart/≤30dosya.
- İlk dilim aynıQR kalite onayı ve aynıdepo yerleştirmesidir. Warehouse-transfer ve üretim tüketim/çıktıQR soy ağacı **sonraki ayrı paketler**, tamamlandı sayılmaz.
- Tamamlanmış kaynak incelemesi/kapılar/main/yayın/schema kanıtı olmadan flag açılmaz; Supervisor uygulama kodu yazmaz.
- Lokal GitHub/SSH geçici reset/banner timeout sonrası dar gerçek okuma/fetch/VPSreceiver başarılı. Kısa devam belgeleri int/package-movement dalında; main ile geliştirme dalını karıştırma.
- PR33 ilk tam CI: AC04 yeni tablo fixture ve dört public export envanteri kırmızıydı; kaynak/RLS değişmeden düzeltildi. Gerçek207/207 AC04, tasks15+movement30=45/45, birebir schema konsolidasyonu125/125 PASS. E2E konsolidasyonu4/4PASS58.6s, verify3929/checkall6PASS; ilk verify guard-unit5000ms timeout saklandı, eşik değiştirilmeden tekrar PASS. Security0/0/0 @0ef57e8637231d45e73ef2e5295a5a21846ebc6e; production13hash aynı. Yeni exact-head dokuz CI/yayın bekler; önceki push legacyE2E hata/aynıhead PR E2E PASS ayrı kaydedildi.

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

## Ana dal uyumu
- Satış PR32 main908c22a ile birleşti; marketing kaynakları aynen korundu, canlı deploy sonucu bu kayıtla varsayılmaz. Güncel QR şema kartı T951 (önceki geliştirme kimliği T941); satış kartı T941 ile karıştırma. Kaynak A0ef57e8 review değişmez; son birleştirme belgeler ve mevcut main satış kaynaklarıdır. Yeni exact-head dokuz kapı bekler.
