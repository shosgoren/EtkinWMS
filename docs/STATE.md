# Etkin WMS — güncel devam durumu

Son doğrulama: **13.10.2026 ~10:30 Europe/Istanbul** (GitHub run/PR metadata; canlı DB defteri 09:25 operatör çıktısı).
Sahip: bu teslimi yapan operatör/AI. Bu tarih sonrası değişiklik varsa yeniden dar kontrol yap.

## Doğrulanmış durum
- Repo: https://github.com/shosgoren/EtkinWMS ; referans repo 2027-WMS-1 salt okunur.
- main = canlı: `5d7e7c62991db3b625f0926e46d7a5d9df6838e7` (PR19 belge). Uygulama kodu a6d2ef4 ile aynı.
- deploy-vps run38362235031 success (07:24Z); receiver deep health sonrası current'ı değiştirir, hata olsa rollback eder.
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

## Sıradaki işler — öncelik sırası
1. **Yayında otomatik yedek + migration (onaylandı, ilk iş; T-916 PR'da, iki bağımsız güvenlik incelemesi düzeltildi; birleşince VPS'e tek komutluk `install-migrate.sh`):** şema değişen yayında receiver `pg_dump -Fc` alsın, web/worker durdursun, migration sahibi rolüyle imzalı migrator imajını koşsun, approved-schema/state'i kendisi ilerletsin. Migration hiç uygulanmadan düşerse önceki imaj açılır; defter kısmen ilerlediyse eski imaj otomatik AÇILMAZ (her migration ayrı transaction) — servis durur, yedekten dönüş veya ileri onarım operatör kararıdır. VPS'e bir kerelik root kurulumu gerekir (migration rolü kimliği root600 dosyada; 13 Ekim kesiminde `postgres` sahipli kalan 3 tablo + 1 fonksiyonun sahibine iadesi). İmza/provenance kapıları korunur.
2. **Üretim reçeteleri ve emirleri:** çok seviyeli HM→YM→MM reçete ekranı, üretim emri, tüketim/çıktı stok kaydı. Domain `packages/domain/src/operations/production.ts` + migration 0029/0030 hazır; UI `apps/web/app/t/[slug]/production/` asgari.
3. **Ürün resmi:** kartta görsel yükleme/gösterim; `packages/storage` S3 adaptörü var, VPS'te nesne deposu (MinIO) kurulmadı.
4. **SelectField yayılımı:** `@wms/ui` `SelectField` hazır ama ekranlarda kullanılmıyor; tüm seçim alanlarına uygula.
5. **Birim çevrimi + birim barkodu sağlamlaştırma:** çevrim katsayısı doğrulama, stok/hareketlerde dönüşüm testleri, birim başına barkod UI.
6. Gerçek cihaz kabulü (kamera, Epson etiket, el terminali); otomatik offsite DB yedeği + restore tatbikatı (RPO/RTO); mail teslimi (MAIL_MODE=disabled).

## Çakışma / yanlış devam önleme
- Eski açık PR'lar (#3 #4 #5 #6 #7 #10 #12 #13 #14) PR15/16/17 ile main'e geçti veya eskidi; yeniden merge/cherry-pick etme, `git merge-base --is-ancestor` ile kanıtla. Kapatılmaları kullanıcıya soruldu, yanıt yok.
- Canlıya şema değiştiren her iş tek operatörle; iki AI aynı anda migration/approve yapmaz.
- Yeni kart T-916+; dal adı `feat|fix/T-xxx-…` (scope bekçisi `claude/…` dalını reddeder).
- Kod merge, deploy ve kullanıcı kabulü ayrı durumlardır; birinden diğerini varsayma.

## Aktif teslim — T-928
- Kullanıcı isteği: Sites kolay tasarımını VPS WMS'ye önce aktar; QR şartnamesi henüz geliştirilmez. Dal feat/T-928-easy-live-design: dört gerçek işlem kartı + sade kısayollar, korunmuş Kokpit; schema/auth/domain/CI değişmez.
- Başlangıç readonly receiver: f1e6e447d7fbadbde78ef71b30b5384ad6fc3e37, schema31 d6b6b9d7…88dd, health OK, auto_migrate=true. Kod/test/CI/son yayın kanıtı PR'da; bu satır yayın iddiası değildir.
