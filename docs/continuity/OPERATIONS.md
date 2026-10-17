# VPS, GitHub, yayın ve yedek işletimi

Bu dosya bağlantı **metadatasını** içerir; parola/özel anahtar/URI/bearer bağlantısı içermez. Erişim sahipliği oturum başında doğrulanır; dokümanda bir yolun yazması erişim yetkisi vermez.

## Bağlantı envanteri
| Kaynak | Adres / kimlik | Sınır |
|---|---|---|
| GitHub yazılabilir repo | https://github.com/shosgoren/EtkinWMS | Normal branch/PR; force push yok |
| Referans repo | https://github.com/shosgoren/2027-WMS-1 | Salt okunur; hiçbir kaynak değişmez |
| VPS | Hostinger Ubuntu24.04,187.7.76.72 | Mevcut operatör SSH; kullanıcı hesabı hPanel |
| WMS | https://wms.etkinyazilim.com | HTTPS Caddy→web |
| Satış | https://etkinyazilim.com | www ve .com.tr yönlendirmeleri |
| DB | etkinwms-postgres:5432 / etkinwms | Yalnız uygulama Docker ağı; public DB portu yok |
| Operatör SSH | root@187.7.76.72, TCP22 | Mevcut yetkili anahtar; genel erişim yalnız operatörde |
| Otomatik kimlik | etkinwms-deploy | Forced command check/deploy; genel shell/SCP/forwarding yok |
| GitHub Environment | etkinwms-production | Yalnız main |
| Secret **adları** | ETKINWMS_DEPLOY_KEY,ETKINWMS_KNOWN_HOSTS | Değerler yalnız sağlayıcı güvenli ayarlarında |

Host anahtarı 12 Ekim kaydında `SHA256:b9ipBdrYLPBxkdy0Xm7r1nDQCwC7SOMTs1PBXWaS9Xs`; strict known-host doğrulanır. Yeni host key veya farklı VPS için otomatik kabul yok. Yerel private root anahtarı Cloud/GitHub'a taşınmaz; otomasyon ayrı kısıtlı anahtarı kullanır. Anahtar yoksa token/chat üzerinden sır isteme; kullanıcı mevcut erişimi yetkili ortamda sağlar.

Yerel mevcut çalışma alanında anahtar referansı `.deploy-access/etkinwms_vps`, host pin dosyası `.deploy-access/known_hosts`; bunlar repo dışında tutulur, dosya içeriği yayımlanmaz. Yeni makine/AI için var sayılmaz. Boşluklu dosya yolları SSH option içinde de doğru tırnaklanır. GitHub CLI erişimi `gh auth status` ile doğrulanır; token yazdırılmaz.

## Sunucu yolları
- `/opt/etkinwms/current` → aktif release symlink; gerçek hedefini oku.
- `/opt/etkinwms/releases/` → eski/yeni immutable release kayıtları.
- `/opt/etkinwms/secrets/web.env`, `worker.env` → root600 runtime ayarlar.
- `/opt/etkinwms/automation/` → root-owned receiver/Compose/Caddyfile/approved-schema/state.
- `/opt/etkinwms/database/` → DB Compose,TLS,operatör özel ayarlar,yedek/kesim dosyaları.
- `/opt/etkinwms/enrollment/` → operatör kurulum aracı/journal; token/link dosyaları gizli.
- App project `etkinwms` (T-410; önceki `etkinwms-motive`, birimleri yedek olarak durur); app network `etkinwms_default`; DB project `etkinwms-database`. DB volume `etkinwms-database_postgres-data`; app caddy-data/caddy-config/marketing-leads korunur.
- Gerçek Compose rollback yolu STATE/automation state'ten alınır; eski göreli bind-mount ile yanlış kaynak bağlama.

## Konteynerler (17 Ekim'den proje `etkinwms`)
web=müşteri UI/API (`wms.`); panel=aynı imaj `APP_SURFACE=panel` (`yonet.`, yalnız operatör + MFA); worker=kuyruk/outbox/arka plan
(demo talebi alımı, aktivasyon ve hoş geldiniz postası); marketing=satış sitesi, demo formu, panelden yayınlanan içerik
(`SITE_CONTENT_URL=http://web:3000/api/public/site`, iç ağ); proxy=Caddy TLS/yönlendirme (`wms.` kökeninde `/api/public/*` 404);
leads-init=bir kerelik birim sahipliği; postgres=veri (ayrı `etkinwms-database` projesi). Test konteynerleri kalıcı servis değildir.
“Running” bütün ürün kabulü değildir. `down -v`, volume prune veya kontrolsüz imaj/tag overwrite yasak.

Proje taşıması (T-410, 17 Ekim 10:55, kullanıcı root): `rename-project.sh` çıktısı `tamam`, yedekler `/opt/etkinwms/automation/*.20261017T075531Z`
ve `/usr/local/sbin/etkinwms-release.bak-20261017T075531Z`, `/opt/etkinwms/database/compose.yml.20261017T075531Z`. Eski
`etkinwms-motive_*` birimleri ve `etkinwms-motive_default` ağı silinmedi; DB konteyneri iki ağa bağlı. Bunlar DB konteyneri kurulu yeni
`database/compose.yml` ile planlı bakımda yeniden oluşturulduktan sonra elle kaldırılabilir. `state.json` artık `project: etkinwms` taşır;
`release.py`/`update-config.sh`/`install-migrate.sh` adı oradan okur.

## Güvenilir IP / kimlik
Caddy uygulamaya `header_up Fly-Client-IP {http.request.remote.host}` yazar; gelen sahte başlık ezilir. Bu eski auth politikasına VPS uyumluluğudur, IP/hız sınırı kapatılmaz. Web doğrudan host portuna açılmaz. Yeni CDN/proxy varsa güven sınırı ayrı tasarlanır; X-Forwarded-For'a kör güven yok. CLIENT_IP_REQUIRED geldiğinde auth'u local moda alma veya guard'ı kapatma.

## Salt okunur durum kontrolü
Mevcut güvenli SSH oturumunda yalnız metadata:
```sh
docker ps --format '{{.Names}} {{.Image}} {{.Status}}'
readlink /opt/etkinwms/current
/usr/local/sbin/etkinwms-release check
docker exec --user postgres etkinwms-postgres psql -X -U postgres -d etkinwms -Atc 'SELECT max(version),count(*) FROM wms_meta.schema_migrations;'
```
URL/secret/env içeriğini veya kişisel kullanıcı satırlarını yazdırma. Deep health `status/db/queue/worker=ok`; TLS/rol/iş akışı kabulü ayrıca.

## Normal otomatik yayın
`.github/workflows/deploy-vps.yml` + `deploy/vps/automation/README.md` gerçek uygulamadır:
1. Güncel exact main SHA, bütün dokuz zorunlu GitHub Actions check'i son success ve önceki canlı ancestry.
2. Immutable image tag/revision, kaynak schema label, arşiv digest ve GitHub OIDC provenance. Sadece isim/etiket güven kanıtı değil.
3. Sınırlı kimlik, root-owned sabit receiver/Compose, tek release lock. Runtime sırları VPS'de kalır.
4. Schema hash approved-schema ile eşleşir; farklıysa ve `migrate.env` kuruluysa alıcı yedek alıp imzalı migrator ile migration uygular (T-916, ayrıntı `deploy/vps/automation/README.md`). Kurulu değilse migration otomatik değil.
5. Başarılı deep health sonrası current/state atomik; aynı SHA sağlıklıysa no-op. Hata varsa sadece schema-compatible önceki imaj/Compose rollback.
6. Gerçek run URL, image digest, current SHA/tag ve migration defteri STATE'e kaydedilir. check mode ürün yayımlamaz.

Mevcut tetikleyici hem ci hem guards tamamlanmasını dinler; aynı SHA için iki workflow callback'i oluşabilir. Aynı PR başlığı altında ci ve guards farklı kontrollerdir; deploy tekrarını azaltmak ayrı korunan workflow değişikliğidir, belge temizliği kapsamında kapatılmaz.

```sh
gh workflow run deploy-vps.yml --repo shosgoren/EtkinWMS --ref main -f mode=check
```
Deploy mode yalnız yayın kapıları kapanınca, doğrulanmış full SHA ile. Hata logunda SCHEMA_OPERATOR_APPROVAL_REQUIRED normal güven kapısı olabilir; hash/state değiştirerek geçirme.

## Schema değiştiren ilk kesim
13 Ekim 10:00 defter/current kontrolünde canlı31 doğrulandı; kesim/yedek kanıtları ayrıca incelenir. Sonraki schema değişimi için: tek operatör; yazmaları durdur; source/target kimliğini doğrula; tutarlı yedek ve izole restore; gerekli roller/ACL/RLS/checksum paritesi; migration ileri ve dolu veride geri dönüş/ret; **yeni şemayla uyumlu fallback image/digest** ve deploy planı. Sonra yetkili migration, runtime health ve iş akışı kabulü. Bağlı veri sonrası guided27 veya down31→27'yi otomatik güvenli sayma. Approved fingerprint/state ancak gerçek uyumlu baseline ve inceleme/izin sağlanınca ilerler.

## 13 Ekim schema31 kesimi — gerçek kayıt
Kullanıcının root Web konsolunda çalıştırdığı tek seferlik kesim (operatör çıktısı, DOĞRULANDI):
- Kaynak: main `a6d2ef4979451b21cd986d3be5ff94ddc1e6ddae` codeload tarball; şema 27→31 (`b5a99942…` → `d6b6b9d7…`).
- Yedek: migration öncesi `pg_dump -Fc` → `/root/etkinwms-cutover-a6d2ef49…/backup-before-<sha>.dump` (~540 KB). Restore denemesi YAPILMADI.
- web/worker durduruldu, `migrate.ts up`: "4 migration uygulandı (0028–0031); toplam 31". Kesinti ~1 dk.
- `queue-adapter install-cli` rol kontrolünde reddedildi (postgres `wms_meta.schema_migrations` sahibi değil). pg-boss sürümü ilk commit'ten beri değişmediği için kuyruk şeması zaten günceldi; atlandı.
- approved-schema yedeği `.bak-<epoch>` ile alınıp `d6b6b9d7…` yazıldı, state.json `schema` güncellendi; sonra deploy run38349324566 success.

Operatör betiği tuzakları (aynı hataları tekrarlama):
- VPS'te `/opt/etkinwms/automation/schema.py` YOK; hash'i indirilen kaynaktaki `deploy/vps/automation/schema.py` ile hesapla.
- `admin.env`'de `POSTGRES_USER` satırı yok; `set -o pipefail` altında `grep` boş dönünce betik web/worker durmuşken çıkar. Bilgileri durdurmadan ÖNCE oku, `trap … EXIT` ile web/worker'ı her durumda başlat.
- Parola URI'ye `urllib.parse.quote` ile girer; argv/loga yazılmaz.
- `bash <<'X'` içinde `docker exec -i` heredoc'un kalanını yutar; `-i` kullanma veya `</dev/null` ver.
- Migration rolü (schema_migrations sahibi) postgres değil; queue install gerekiyorsa o rolle çalıştırılmalı.

## Yedek kuralları — hedef, kurulu iş iddiası değil
- Mevcut kanıt: 12 Ekim custom schema27 dump + ağsızPG18 restore + VPS kesim/parite testi. Zamanlanmış offsite/WAL/PITR başarısı doğrulanmış değil.
- Her migration/yayın öncesi tutarlı `pg_dump -Fc`; ayrı rol/global yetki planı. PostgreSQL18 ile uyumlu araç, verified TLS; URI/parola argv veya loga girmez.
- Yedek ve plan root700 dizin/root600 dosya; işlenen kişisel veri varsa şifreli ve erişimi sınırlı ayrı lokasyonda ikinci kopya. VPS'deki aynı disk tek felaket yedeği sayılmaz.
- Saklama/otomasyon kurulacaksa öneri: günlük7,haftalık4,aylık3; kapasite/hukuki saklama kullanıcıyla netleşir. Bu süreler kurulmuş retention iddiası değildir.
- Sözleşmedeki RPO≤15dk/RTO≤4saat hedefleri için günlük dump yeterli değil; WAL/PITR veya uygun hizmet ve ölçülmüş tatbikat gerekir. Hedefi test etmeden sağlandı deme.
- Restore izole DB'de; schema/defter, ACL/RLS/fonksiyon owner, sayımlar ve hedef imaj health/iş akışı. Canlı DB'ye yanlışlıkla test restore yok.
- Her yedekte saat, kaynakDB kimlik metadatası, schema, checksum/boyut, saklama yeri, restore denemesi/sonuç. Backup/restore komutları task+planla review edilir; veri silen reset kullanıcı onayı ister.

## Hesap / kurtarma
Yeni tenant/ilk-owner tekrar açılmadan mevcut üyelik, password/MFA boolean'ları kontrol edilir. İlk sahip aracı source ledger=DBledger eşleşmesine göre çalışır; eski “tam27” notu güncel build için kör uygulanmaz. MAIL_MODE disabled ise mail teslimini varsayma. Private tek kullanımlık link sohbet/log/CI artifact'a konmaz; kullanıcı kendi parolasını ve MFA'sını girer. Geçersiz/expired link için journal'ı silme veya normal resume guard'ını aşma; aynı hedefe bağlı incelenmiş recovery kullan. Şu an Motive'de password veMFA var; geçmiş başarısız kurulum yeniden uygulanmaz.

## 13 Ekim 16:38 UTC — izole geri yükleme doğrulaması
Yeni canlı DB yedeği `pg_dump -Fc` ile `/root/etkinwms-backups/before-package-schema-20261013163858.dump` içine alındı (dizin700/dosya600; VPS dışına taşınmadı). Yalnız yeni scratch DB'ye `pg_restore --exit-on-error` uygulandı: defter0031/31 ve ledger/balance farkı0; scratch EXIT temizliğiyle kaldırıldı. Canlı DB değişmedi; receiver health=ok, release auto-1cf81ed1…, auto_migrate=true. Bu yeni prova önceki schema31 kesimindeki “restore denenmedi” tarihli kaydı değiştirmez. Login/iş akışı restore kabulü, günlük offsite, WAL/PITR, RPO/RTO ve retention doğrulanmış değildir.

## 17 Ekim — panel paketi canlı yayını ve proje taşıması
- Önce kullanıcı (root) aynı commit'in `release.py`'sini kurdu (sha256 `67b5e64d…`, `check` health ok).
- PR #79 `int/panel-2` → main `9d5159d8b783f83ec7a1025aa404797b56005f31`. İlk deploy koşusu (guards callback) CI bitmeden kapıda durdu
  (beklenen); ci tamamlanınca deploy run 39015057320 SUCCESS: yedek + migration 0041–0047, `"queues": "installed"`, health ok.
- Ardından `rename-project.sh` (yukarıda). Dış doğrulama: `wms.` deep health ok, `/api/public/site` 404, `etkinyazilim.com` ve
  `yonet.` giriş açılıyor. Satış sayfası içeriği henüz panelden yayınlanmadı (site tasarım metninde).

## 13 Ekim 21:11 — T931 otomatik yayın
main531e9034440ac1dc0d67fb11353a7ea09785c9f1 için ci38442505462/guards38442505492 SUCCESS; deploy38443949741 SUCCESS. Salt okunur receiver check: release531e9034, health=ok, auto_migrate=true, schema31 fingerprintd6b6b9d7…88dd. Önce guards callback yayını38443064499 RELEASE_BLOCKED:int ile durdurdu; CI tamamlandıktan sonraki koşu geçti. T9320032 henüz geliştirme dalında, canlıya uygulanmadı. Yeni fiziksel QR kabul ekranı/etiket özelliği bu yayında yok.
