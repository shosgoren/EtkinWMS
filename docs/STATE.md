# Etkin WMS — güncel devam durumu

Son canlı doğrulama: **13.10.2026 12:50 Europe/Istanbul** (GitHub run/PR + receiver + canlı giriş); yeni T-929 teslimi ayrıca doğrulanacak.
Sahip: bu teslimi yapan operatör/AI. Bu tarih sonrası değişiklik varsa yeniden dar kontrol yap.

## Doğrulanmış durum
- Repo: https://github.com/shosgoren/EtkinWMS ; referans repo 2027-WMS-1 salt okunur.
- main = canlı: `a07fc1a5d2964aa96c438dfb390892bebb941874` (PR22, T-928). Yeniden kontrol edilmeden sonraki sürüm varsayılmaz.
- deploy-vps run38378834142 success; receiver health=ok, current=auto-a07fc1a5…, ledger0031/31. Aynı SHA'nın dokuz CI kontrolü geçti; 82 masaüstü/mobil E2E geçti.
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
1. **İç ekranların cihaz düzeni (T-929, kullanıcının yeni önceliği):** masaüstü/tablet/telefon farklı düzen; tek elle geri/ana ekran/ana işlem erişimi, ortak görsel dil. DB/auth/domain değişmez. T-916 receiver artık auto_migrate=true (12:50 readonly kanıt); günlük offsite yedek ve restore tatbikatı hâlâ doğrulanmış değil.
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

## Son teslim / aktif çalışma
- T-928 canlı: dört işlem kartı ve sade kısayollar, korunmuş Genel bakış. Kullanıcı girişinden sonra gerçek Motive ekranı doğrulandı. Kanıt: https://github.com/shosgoren/EtkinWMS/pull/22#issuecomment-6143042188 . QR v3 geliştirmesi başlamadı.
- T-929 aktif dal `feat/T-929-consistent-touch-screens`: iç ekranlarda ortak renk/ikon/form düzeni ve telefon/tablet alt geri/ana ekran. Yerel verify: lint/typecheck PASS, 3772 unit PASS; temiz ayrı DB ile 26 cihaz/ana ekran/saha E2E PASS. GitHub CI ve canlı yayın henüz doğrulanmadı; son kanıt ilgili PR'da kayıtlanır. Görev: docs/tasks/T-929.md.
