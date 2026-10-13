# Etkin WMS — güncel devam durumu

Son canlı doğrulama: **13.10.2026 21:11 Europe/Istanbul** (GitHub CI/yayın + receiver); son oturumlu üç cihaz kontrolü18:24.
Sahip: bu teslimi yapan operatör/AI. Bu tarih sonrası değişiklik varsa yeniden dar kontrol yap.

## Doğrulanmış durum
- Repo: https://github.com/shosgoren/EtkinWMS ; referans repo 2027-WMS-1 salt okunur.
- Canlı ve main: `531e9034440ac1dc0d67fb11353a7ea09785c9f1` (PR25/T-931; önceki cihaz düzenini içerir).
- main CI38442505462 + guards38442505492 SUCCESS; dokuz kontrol geçti, deploy38443949741 SUCCESS. VPS release531e9034/health=ok/auto_migrate=true; schema31 fingerprintd6b…88dd. T9320032 geliştirme şeması canlıda değil.
- Yayın callback'leri farklı sırada tamamlanabilir; eksik CI varken RELEASE_BLOCKED ret, tüm dokuz kontrol geçince son callback yayın yapar (son kesimde doğrulandı).
- PR15 pilot zinciri + PR16 kart türleri/standart birimler + PR17 MFA QR/rehber/SelectField + PR18/19 belgeler main'de.
- VPS Hostinger `187.7.76.72`; uygulama https://wms.etkinyazilim.com ; satış https://etkinyazilim.com .
- Beş servis: web, worker, marketing, Caddy proxy, PostgreSQL18 (`etkinwms-postgres`, public port yok, TLS verify-full).
- Canlı migration defteri **0031 / 31**; approved schema `d6b6b9d7…88dd` (kesim ayrıntısı: [OPERATIONS](continuity/OPERATIONS.md#13-ekim-schema31-kesimi--gerçek-kayıt)).
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
1. **Tekil fiziksel paket QR / mal kabul (T-931, kullanıcı başlatma kararı):** 5 varil × ayrı KG miktarı →5 kimlik/etiket; lot/üretim/SKT; sonraki taşıma/tüketim/üretim çıktısı paketle izlenir. Mevcut handling-unit/stock-dimension ve etiket sınırları inceleniyor; henüz uygulanmış/yayımlanmış değil. v3 ek dosyası belirtilen yerel yolda bulunamadı; ayrıntı doğrulaması açık. 13 Ekim izole dump/restore geçti; günlük offsite ve WAL/PITR hâlâ doğrulanmış değil.
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

- T-932 geliştirme commit70282ce entegrasyon dalında; aktif T933 dalı `feat/T-933-package-receiving-commands` → `int/package-receiving`: yalnız yeni0032 şema/tenant ilişkileri, immutable paket origin ve migration testleri. İlk paket ledger allowlist origin STOCK_IN; generic paket hareket/reversal destek açılana kadar ret, legacy HU korunur. Domain/QR hareket/etiket/UI sonraki bağlı kartlar; canlıya şema yazımı yok.

- T932 önceki kaynakta fresh-compose tam int107 dosya/1992 PASS; verify lint/typecheck/unit3785 PASS. Sonraki insert-order korumasında odaklı7 dosya/215 PASS; bunlar henüz son guard kaynak kanıtı değildir. İlk başarısız adapter koşusu1942/1983PASS,19FAIL+22setup-unexecuted; gerçek legacy regresyonları düzeltildi, STS/demo bulaşması fresh-compose ile ayrıldı. Hiçbir test atlanmadı veya kapı gevşetilmedi.
- Son bounded RR kanıtında görünmeyen yeni receipt-parent ile ikinci source document her iki transaction COMMIT edebildi. BEFORE INSERT görünür gerçek parent/tek origin ve binding immutability koruması tamam: son kaynak eb28928c,10 dosya/318 PASS (paket46, iki RR sıra, gerçek eski partial/QC/reversal dahil), scoped eslint/bekçiler PASS. T933 komutları hazır: fresh-compose15 integration +13 unit/typecheck/eslint PASS; kalıcı5×200 kimlik/replay/atomik1000KG/QC/lot/scope/MFA/rollback kanıtlandı. Birleşik bağımsız güvenlik/QA ve tam kapılar hâlâ açık.
- Gelecek paket hareketinde yalnız değişmeyen origin anchor kilidi RR yarışını çözmez; gerçek ortak version/CAS, exact reversal ve depo/sayım kapsamı ayrı tasarım/test ister. Bu dilimde hareket/üretim/etiket/UI açık değildir.

- Birleşik f9948aad güvenlik incelemesi BLOCKER0/MAJOR1: önceden var legacy HU→paket binding ile RR generic ledger yarışı iki COMMIT/DRAFT üzerinde non-origin stok3 üretti (gerçek scratch probu; silindi). T933 clientprepare yeniHUyalnız, ama DB garanti düzeltilmeden merge/yayın yok. Architect deklaratif immutable HU-origin binding çözümü hazırlıyor. Son verify lint/typecheck/unit3798 PASS; f9948 QA67/67 PASS ama fullint2011/2012: yalnız operations public export allowlist yeni5komutu beklemiyor. Eski private-helper ret assertions korunarak açık liste güncellenecek; bu SHA final kabul edilmedi.
