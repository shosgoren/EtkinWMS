# Etkin WMS — güncel devam durumu

Son canlı doğrulama: **13.10.2026 18:24 Europe/Istanbul** (GitHub CI/yayın + receiver + DB defteri + oturumlu cihaz kontrolü).
Sahip: bu teslimi yapan operatör/AI. Bu tarih sonrası değişiklik varsa yeniden dar kontrol yap.

## Doğrulanmış durum
- Repo: https://github.com/shosgoren/EtkinWMS ; referans repo 2027-WMS-1 salt okunur.
- Canlı ve main: `1cf81ed1b9e80f2707145d62896019766e540ee5` (PR24, T-930; PR23/T-929 iç ekran düzenini içerir).
- main CI38418935906 ve deploy38420413300 SUCCESS; dokuz zorunlu kontrol ve88 E2E PASS. Receiver health=ok, current=auto-1cf81ed1…, auto_migrate=true, ledger0031/31. 13 Ekim yeni görev başlangıcında main/yayın sonucu tekrar okundu.
- Aynı SHA için önce `ci`, sonra `guards` callback'i gelir; ilk koşu RELEASE_BLOCKED ile düşüp ikincisi geçer (bilinen, zararsız).
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
- T-931 aktif dal `feat/T-931-package-receiving`: ilk saf paket miktar/tarih/QR sözleşmesi hazır;13 unit senaryosu, bağımsız121 QA probu ve güvenlik0 bulgu. Yerel lint+unit3785 PASS; tüm paket typecheck PASS (eski üretilmiş .next tip kopyaları taşındı). ardından migration → taslak/atomik kabul → etiket/okutma/UI. Mevcut stok motoru HU bazlı KG destekliyor, saha komutları henüz HU taşımıyor. Stok/RLS değişikliği bağımsız güvenlik + QA ister. DB/UI/kimlik üretimi/baskı bağlanmadı; yeni QR akışı canlıda var diye raporlanmaz. GitHub tam CI/birleşme durumu PR kanıtından kontrol edilir.

- PR25 ilk hosted E2E86/88: streaming sırasında gizli fragment çift seçici (#from/now-receive). Görünür tek alan/satır assertionı eklendi; renk/odak/veri/geometri eşikleri korunuyor. Yerel4 cihaz testi PASS; görünür karta bağlı son ölçüm değişikliğiyle2 receiving testi tekrar PASS. Bağımsız QA:0 bulgu, eşikler/negatif kontroller korundu. Hosted tam CI tekrar geçmeden merge/yayın yok.

- PR25 b1f0afa hosted: E2E87/88 (mobile lokasyon dialogu), verify iki root DOM tipi hatası; diğer yedi kontrol PASS. Structural tip düzeltmesi root tsc PASS; client-ready koruması hazır. Yerel stock desktop PASS; iki mobile picker timeout RATE_LIMITED, bağımsız QA ortak kullanıcı kovasını işaret etti. İki ayrı gerçek signup/MFA test hesabıyla tek eskalasyon koşusu2/2 PASS55.4s; bağımsız QA0 bulgu. Son lint/unit3785 PASS, root ve workspace typecheck PASS, check:all PASS; limit/timeout gevşetilmedi. PR25 hosted son kontroller bekleniyor; merge/yayın YOK.
- 13 Ekim16:38UTC: VPS canlı DB pg_dump -Fc, izole scratch restore --exit-on-error PASS; defter0031/31, ledger/balance fark0. Scratch kaldırıldı, canlı değişmedi; ayrıntı OPERATIONS. Günlük offsite/RPO/RTO veya auth kabulü kanıtlanmadı.
