# Etkin WMS — güncel devam durumu

Son canlı doğrulama: **14.10.2026 01:50 Europe/Istanbul** (salt okunur VPS receiver); son oturumlu üç cihaz kontrolü13 Ekim18:24.
Sahip: bu teslimi yapan operatör/AI. Bu tarih sonrası değişiklik varsa yeniden dar kontrol yap.

## Doğrulanmış durum
- Repo: https://github.com/shosgoren/EtkinWMS ; referans repo 2027-WMS-1 salt okunur.
- Canlı ve main: `0fe2e80213095cac3d9be55a160458fbba30c6eb` (PR28/0033 performans). SSH release/health/schema ve migration defteri doğrulandı; UI PR29 henüz canlı değil.
- Son kesim ci38478944602 + guards38478944569 dokuz kontrolPASS; deploy38480106163 SUCCESS. VPS release0fe2e80/health=ok/auto_migrate=true; schema33 fingerprint63869a…22e72.
- Yayın callback'leri farklı sırada tamamlanabilir; eksik CI varken RELEASE_BLOCKED ret, tüm dokuz kontrol geçince son callback yayın yapar (son kesimde doğrulandı).
- PR15 pilot zinciri + PR16 kart türleri/standart birimler + PR17 MFA QR/rehber/SelectField + PR18/19 belgeler main'de.
- VPS Hostinger `187.7.76.72`; uygulama https://wms.etkinyazilim.com ; satış https://etkinyazilim.com .
- Beş servis: web, worker, marketing, Caddy proxy, PostgreSQL18 (`etkinwms-postgres`, public port yok, TLS verify-full).
- Canlı migration defteri **0033 / 33**; receiver schema `63869a172f9738df7c4e41fe7e4c57a7c43abdd9c352d9b9b33006ee33222e72` (kesim ayrıntısı: [OPERATIONS](continuity/OPERATIONS.md#13-ekim-schema31-kesimi--gerçek-kayıt)).
- Motive: ACTIVE owner/yönetici hesabı var; hedef yönetici 13 Ekim'de parola + MFA kurup giriş yaptı.
- Gerçek cihaz (kamera/Epson/el terminali) kabulü yok; ürün iş akışı kabulü kullanıcıyla yapılmadı.

## Kullanıcı kararları (13 Ekim)
- "Bana iş yaptırma": operatör adımı gerekiyorsa tek yapıştırmalık, idempotent komut; sır/bağlantı sohbete istenmez.
- Kart türleri Logo ERP gibi: HM Hammadde, YM Yarı Mamul, MM Mamul, TM Ticari Mal; kod `HM-000001` (tireden sonra 6 hane). Ambalaj/Sarf yok.
- Standart birimler hazır gelir (ADET, KG, GR, MT, CM, LT, M2, M3, KOLI, PALET); her birimin kendi barkodu olabilir.
- Birim çevrimi "çok önemli" — doğru çalışmalı. Reçete sırası: hammadde → yarı mamul → mamul.
- CI e2e için `paths-ignore`/paralelleştirme REDDEDİLDİ: zorunlu `e2e` raporlanmazsa PR kilitlenir; deploy kapısı e2e=success ister; G-11; kazanç ~2 dk.

- Excel→ürün/birim/barkod→paket etiketi, yetkili fiş düzeltme/geri alma ve ileride ERP senkronu yeni hedeflerdir; ayrım/korumalar ARCHITECTURE/UI_UX kısa rehberlerinde. İşlenmiş defteri fiziksel silme uygulanmadı.

## Sıradaki işler — öncelik sırası
1. **Tekil fiziksel paket QR / mal kabul (T-931, kullanıcı başlatma kararı):** 5 varil × ayrı KG miktarı →5 kimlik/etiket; lot/üretim/SKT; sonraki taşıma/tüketim/üretim çıktısı paketle izlenir. DB/domain kabul paketi geliştirme dalında tamam; UI/baskı/hareket bağlı değil ve yeni akış yayımlanmadı. v3 ek dosyası belirtilen yerel yolda bulunamadı; ayrıntı doğrulaması açık. 13 Ekim izole dump/restore geçti; günlük offsite ve WAL/PITR hâlâ doğrulanmış değil.
2. **Üretim reçeteleri ve emirleri:** çok seviyeli HM→YM→MM reçete ekranı, üretim emri, tüketim/çıktı stok kaydı. Domain `packages/domain/src/operations/production.ts` + migration 0029/0030 hazır; UI `apps/web/app/t/[slug]/production/` asgari.
3. **Ürün resmi:** kartta görsel yükleme/gösterim; `packages/storage` S3 adaptörü var, VPS'te nesne deposu (MinIO) kurulmadı.
4. **SelectField yayılımı:** `@wms/ui` `SelectField` hazır ama ekranlarda kullanılmıyor; tüm seçim alanlarına uygula.
5. **Birim çevrimi + birim barkodu sağlamlaştırma:** çevrim katsayısı doğrulama, stok/hareketlerde dönüşüm testleri, birim başına barkod UI.
6. Gerçek cihaz kabulü (kamera, Epson etiket, el terminali); otomatik offsite DB yedeği + ölçülmüş iş akışı restore tatbikatı (RPO/RTO); mail teslimi (MAIL_MODE=disabled).

## Çakışma / yanlış devam önleme
- Eski açık PR'lar (#3 #4 #5 #6 #7 #10 #12 #13 #14) PR15/16/17 ile main'e geçti veya eskidi; yeniden merge/cherry-pick etme, `git merge-base --is-ancestor` ile kanıtla. Kapatılmaları kullanıcıya soruldu, yanıt yok.
- Canlıya şema değiştiren her iş tek operatörle; iki AI aynı anda migration/approve yapmaz.
- Yeni kart T-916+; dal adı `feat|fix/T-xxx-…` (scope bekçisi `claude/…` dalını reddeder).
- Kod merge, deploy ve kullanıcı kabulü ayrı durumlardır; birinden diğerini varsayma.

## Son teslim / aktif çalışma
- T-928 kolay ana ekran canlı; dört işlem kartı ve korunmuş Genel bakış.
- T-929/T-930 tamamlandı: ortak iç ekran kabuğu, cihazlara ayrı düzen, alt geri/ana ekran ve erişilebilir form ana eylemi. Yerel verify3772, temiz DB26 cihaz/saha E2E ve2 import yatay ekran testi PASS; son PR/main88 E2E PASS. Geçici çift SSR kartı count=1 assertionıyla beklenir; testler gevşetilmedi.
- Oturumlu canlı kontrol: masaüstü1470×745, telefon390×740, tablet1024×740; taşma yok, telefon geri/ana ekran56px, son alan görünür; üretim/sevkiyat/transfer form bölümleri doğrulandı. Gerçek stok yazımı ve yazıcı testi yapılmadı.
- Kanıt: [PR23](https://github.com/shosgoren/EtkinWMS/pull/23#issuecomment-6149097341), [PR24](https://github.com/shosgoren/EtkinWMS/pull/24#issuecomment-6149098075).
- T-931 PR25 main'e geçti; ilk saf paket miktar/tarih/QR sözleşmesi hazır;13 unit senaryosu, bağımsız121 QA probu ve güvenlik0 bulgu. Yerel lint+unit3785 PASS; tüm paket typecheck PASS (eski üretilmiş .next tip kopyaları taşındı). ardından migration → taslak/atomik kabul → etiket/okutma/UI. Mevcut stok motoru HU bazlı KG destekliyor, saha komutları henüz HU taşımıyor. Stok/RLS değişikliği bağımsız güvenlik + QA ister. DB/UI/kimlik üretimi/baskı bağlanmadı; yeni QR akışı canlıda var diye raporlanmaz. GitHub tam CI/birleşme durumu PR kanıtından kontrol edilir.

- PR25 E2E/typecheck sorunları düzeltildi: streaming görünür tek alan, hydration-ready lokasyon kontrolü, iki ayrı gerçek signup/MFA stok test hesabı. Renk/odak/geometri assertionları ve limitler korundu; bağımsız QA0 bulgu. Son exact-head/main dokuz kontrol ve otomatik yayın PASS (yukarıdaki SHA/run kanıtı).
- 13 Ekim16:38UTC: VPS canlı DB pg_dump -Fc, izole scratch restore --exit-on-error PASS; defter0031/31, ledger/balance fark0. Scratch kaldırıldı, canlı değişmedi; ayrıntı OPERATIONS. Günlük offsite/RPO/RTO veya auth kabulü kanıtlanmadı.

- T-932/T-933/T-934 paketi PR26 ile geliştirme dalına birleştirildi: `int/package-receiving`, merge `49de679107b90c048c0633e0dccada02543c0db2` (14 Ekim 00:01 Istanbul). Ardından PR27 main69d1fbe birleşti (14 Ekim00:32). PR27 ci38470011292 + guards38470011315 dokuzkontrolPASS; main CI38471430417 intFAIL2028/2029 (200outer30s), guards38471430852PASS; T939 onardı. Son canlı doğrulama PR25/schema31.
- İncelenen kaynak `34e0334061d35571c3a1e452109e75c08a7b3aed`: bağımsız güvenlik BLOCKER0/MAJOR0/MINOR0; bağımsız QA86/86 PASS, skip0. Gerçek KG birimiyle 5VARIL×200=1000KG ve GR→KG çevrimi ayrıca doğrulandı. [Raporlar](https://github.com/shosgoren/EtkinWMS/pull/26#issuecomment-6154851235).
- PR26 dokuz zorunlu kontrol PASS: ci38465167535 ve guards38465559418. Merge ile incelenen kaynağın Git ağacı aynı (`bc57cdec6eeb15a76e8cb7e57adce6520474bf77`). Önceki başarısız denemeler JOURNAL'da korunur.
- Hazır kapsam: immutable fiziksel paket kimliği, lot/üretim/SKT, tenant/RLS ilişkileri, idempotent taslak ve atomik kabul, yetkili QR sorgusu. İlk ledger allowlist yalnız origin STOCK_IN; legacy akışlar korunur.
- T935–T938/T940 dalında kabul ekranı ve POSTED aynı kimlik etiketleri hazır; gerçek tarayıcı E2E6/6 PASS, skip0, şema32/32. Kamera/Epson fiziksel kabulü, paketle transfer/üretim, taslak düzenleme/iptal açık. UI PR29 açıldı; henüz main/canlı teslimi değildir.
- Sıradaki adım: UI PR29 dokuz kapı → merge/main dokuz kapı → VPS doğrulama; QR transfer/üretim ayrı teslim. Dal int/package-receiving-ui; server flag varsayılanfalse, paket hareketi hazır olmadan normal Mal geldi değişmez. Yeni QR akışı canlıda diye raporlanmaz.
- PR28 kaynak7dd20fd: bağımsız security0/0/0 + QA84/84 PASS; 200 paket gerçek KG kabulü12.525s, unchanged30s sınırı. Dokuz PR/main kapısı PASS; merge0fe2e80 deploy38480106163 SUCCESS ve schema33 SSH doğrulandı. İlk erken deploy callback38479313958 eksik kapıda durdu; sonraki callback geçti.
- T938 dört koşunun geçmişi kart/JOURNAL'da korunur. Son app48ff436 + dondurulmuş dört E2E/setup dosyası: 6PASS/0FAIL/0skip/0flaky,32.94s; 5VARIL1000KG, GR→KG3.5, kayıp yanıt/yenileme/aynıID, QRdecode/XSS/baskı/erişim ve dört ekran geometrisi PASS. Fiziksel cihaz veya şema33 E2E kanıtı değildir.
- Son kaynak default200prepare6688.2/post14542.5ms, tüm test22770ms<değişmeyen30s; final bağımsız QA200prepare5906/post13166ms. Motor/timeout/GUC/trigger/cache gevşetilmedi. Bunlar izole test ortamı ölçümüdür, canlı SLA değildir.
- Gelecek paket hareketinde yalnız değişmeyen origin anchor kilidi RR yarışını çözmez; ortak version/CAS, exact reversal ve depo/sayım kapsamı ayrı tasarım/test ister. Günlük offsite/RPO/RTO ve gerçek cihaz kabulü hâlâ açık.

- T939 ayrıperformans onarımı: fix/T-939-package-assert-plan, yeni0033append yalnız assertfunctionplan;0032/engine/timeout unchanged. Kaynak82/82PASS, fresh200fullcase10092ms, seeded32→33→32→33 data/ACL/RLS/body roundtripPASS. Exact7dd20fd bağımsızsecurity0/0/0 + QA84/84PASS/skip0; fullverify3798PASS/check:allOK. PR28 dokuzCI PASS ve main0fe2e80 birleşti; main CI/yayın PASS ve schema33 canlı; detay DATABASE/JOURNAL.

- UI PR29 head65b6191: eski kaynakfd86b70 security0/0/0/fullverify3915PASS/checkall6OK. CI38480544015(push) E2EPASS/intFAIL; CI38480550586(PR) E2EFAIL/intFAIL; guards38480597782 test-acFAIL. Her iki int2029/2030 yalnız AC-04 iki eksik yükleyici; WIP düzeltme161/161PASS/schema33,12 yeni yetki senaryosu. PR tarayıcı hatası mevcut mobil kod aramasında doğal hydration metni sıfırlıyor; yalnız seçici değiştirilmeyecek. Yeni paket senaryoları geçti; tüm9kapı/finalkaynak review olmadan merge yok, flag kapalı.
- Son onarım kaynakcb7f292: güvenlik0/0/0; AC04gerçek161/161 ve aynıwidgetblobuyla değişmeyen kodedit4/4PASS/skip0, doğal eski-kod POST200. Fullverify3915PASS. Checkall scope/tests/protected/docsPASS; artırılanAC04 kayıtları nedeniyle baseline112→119 ve assertions96→134 stale, ayrı küçük protectedPR ile yalnız yukarı güncellenecek. Arama PR30/b4ba414 dokuzPASS→main d67b82da; main ci38530824944+guards38530824878 dokuzPASS. Yayın38531988425 Docker HTTP500 nedeniyle tekfailedjob tekrarıyla sürüyor. Bu ayrı teslimden sonra finalUI beş kart/≤30dosya ve exact-source kapıları korunur.

- PR31/8b35d2b sayaç artışı dokuzPASS (ci38531182211/guards38531182246)→int9d02d305; finalUI30dosya. Gerçek kural: JSON eşik artışı korunan değişiklik değildir; yalnız düşüş insan/supervisor kaydı gerektirir. Ayrı küçük teslim/bağımsız0review korunur; bekçi değişmedi. PR29 son9kapı+main+VPS bekler; arama/kabul paket hareketi veya gerçek yazıcı kabulü değildir.

- T-941 (14 Ekim, dal `feat/T-941-new-landing`): etkinyazilim.com satış sitesi kullanıcının onayladığı yeni tanıtım sayfasıyla değiştirildi (kaynak `marketing/src/landing.dc.html`, üretici `marketing/build.mjs`, eski app.js/stil/metin kaldırıldı, dış yazı tipi/betik yok, CSP script-src self korunur). Yerel tarayıcı denetimi 1440×900/390×844: konsol/CSP hatası0, TR/EN, form değer koruma, /api/demo kaydı PASS; marketing testleri 7/7 (yerel). Kullanıcı onayıyla PR32 main `908c22a` olarak birleşti; main ci+guards PASS, deploy38550135723 SUCCESS (ilk erken callback38549334726 eksik kapıda durdu, beklenen). Canlı kontrol 14 Ekim: etkinyazilim.com yeni başlık/H1, /privacy yeni sürüm, /site.js yeni, eski /app.js 404.

- T-942 (14 Ekim, PR35): kullanıcı isteğiyle satış sitesi girişi tam ekran sinema düzenine geçti (film 100svh, metin film üstünde, 4. sahnede gerçekçi telefon, sarı gölge kaldırıldı, giriş butonu dil seçiciyle aynı 48px hap). Yerel 7 çözünürlük (360–2560) taşma/hata0, marketing testleri 7/7; kullanıcı yayın onayı verdi.

- T-943 (14 Ekim): QR satırı + etiketler ≥1200×780 ekranlarda filmin alt şeridine taşındı; küçük/kısa ekranlarda ayrı şerit korunur. Yerel 5 çözünürlük PASS.
