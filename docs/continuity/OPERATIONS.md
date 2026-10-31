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
- **Gizli olmayan ayarlar kodda (T-426, 19 Ekim kullanıcı kararı "bunları senin yapman gerekiyor"):** bayraklar `Dockerfile` runtime `ENV` ile imaja girer ve normal yayınla canlıya gider; sunucuda elle değişiklik gerekmez. Sunucudaki env dosyası aynı adı yazarsa o geçerlidir (acil geri alma). Sırlar (anahtar, parola, DB URI) imaja girmez, yalnız sunucu env dosyasında kalır. Şu an: `WAREHOUSE_SCOPE_ENABLED=true`.
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

Mevcut deploy tetikleyicisi main push `ci` tamamlanmasını dinler; deploy kapısı ayrıca guards sonucunu bekler (T-925). Aynı PR başlığı altında ci ve guards farklı kontrollerdir; biri test, diğeri bekçidir.

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
- **Müşteri sıfırlama (T-1005):** bütün kiracıları silip panel operatörünü koruyan betik `deploy/vps/ops/reset-tenants.sql`; adımlar (durdur → `reset-*.dump` yedek → kuru → gerçek → demo JSONL'i taşı → başlat) `deploy/vps/ops/RESET.md`. Yalnız kullanıcı root olarak çalıştırır; canlıda çalıştırıldığı ayrıca kaydedilir.

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

## 17 Ekim — T-999 + T-999b canlı yayını
- main `6dd9880` (PR #85), deploy-vps 39042736174 başarılı (17:56): yedek → 0048 (`tenant_memberships.last_used_at`) → sağlık ok.
- İlk deploy-vps koşusu (guards bitince) "tüm kontroller" kapısında durdu (beklenen); main e2e bir kez dalgalı (mobile-shell) → iş yeniden koşuldu.
- Canlı doğrulama: `/login` yeni tasarım; sentetik adresle yanlış giriş 401 + `x-attempts-left: 4`.

## 22 Ekim — Etkin ses servisi (T-1002, B-62)
Yeni iç servis `voice` (ayrı imaj, iç ağ, port yok). Canlıya çıkması için bir kez root adımı gerekir: aynı commit'in `release.py`'si
`/usr/local/sbin/etkinwms-release`'e ve `update-config.sh` ile yeni `compose.yml`. Ayrıntı: `deploy/vps/automation/README.md` §Etkin ses
servisi. Bu adım yapılmadan yayınlar iki imajlı sürer; Etkin "şu an kullanılamıyor" der. VPS'te `/stt` süresi: UNKNOWN (ölçülmedi).


## 25 Ekim — Haftalık güvenlik taraması (T-1030)
`.github/workflows/security-scan.yml` her pazartesi 05:17 UTC (elle: Actions → security-scan → Run workflow) main üzerinde koşar: `pnpm audit` (high/critical), ses servisi `pip-audit`, `scripts/security-scan.mjs` (Dockerfile Node sürümü ↔ nodejs.org güvenlik yayını; PostgreSQL imajı ↔ yeni ara sürüm; sabitlenmemiş imaj uyarısı). Kırmızı iş GitHub e-postasıyla bildirilir; düzeltme normal PR akışıyla (T-1029/T-1031 örnek).

## Paraşüt ortak OAuth uygulaması (T-1133, 30 Ekim kullanıcı kararı)
Etkin TEK ortak Paraşüt uygulaması kaydeder; müşteri Application Id / Secret / Callback girmez (Bağlan = BAĞLAN → Paraşüt'te giriş + izin → şirket seç). Değerleri yalnız sahip sunucuya girer; repo, belge, log, sohbet ve audit'e yazılmaz. Bağlantı yenilemesi için kimlik + sır, her ortak uygulama bağlantısının `integrations.credentials` mühürlü kutusuna (QUEUE_SEAL_KEY) da girer (mevcut bağlantı yolu).
1. **Bir kez, Paraşüt'te:** Etkin'in Paraşüt hesabında Ayarlar → Entegrasyonlar → Yeni uygulama. Dönüş (callback / redirect) adresi: `https://wms.etkinyazilim.com/api/integrations/parasut/callback` (genel kural: `<BETTER_AUTH_URL>/api/integrations/parasut/callback`; sonda `/` yok, sorgu yok).
2. **Sunucu:** `/opt/etkinwms/secrets/web.env` (root600) içine iki ad: `PARASUT_OAUTH_CLIENT_ID`, `PARASUT_OAUTH_CLIENT_SECRET`. Worker'a gerekmez (yenileme, bağlantı kutusundaki mühürlü kimlikle yapılır). Değer boşluk/denetim karakteri içeremez, en çok 200; geçersizse ortak uygulama kapalı sayılır (sessiz geri düşüş yok, ekran "henüz hazır değil" der).
3. **Uygula:** web konteynerini yeniden başlat (normal yayın da okur). Doğrulama: Ayarlar › Entegrasyonlar › Bağlantı bölümünde "Anahtar girmen gerekmez" ve Gelişmiş satırında "Etkin'in ortak uygulaması". Değeri yazdırma; yalnız bu ekran durumu ve sağlık.
- Çözüm sırası: müşterinin kendi uygulaması (Gelişmiş, `integration_oauth_apps`) → ortak uygulama → yok. Ortak uygulamayla yapılan bağlantıda ürün yaşam döngüsü, tamamlanmış yetki kodu denemesine (sabit ortak sürüm) bağlanır. **Döndürme:** yeni değerleri env'e yaz + web'i yeniden başlat → yeni bağlantılar yeni sırla kurulur; mevcut bağlantılar kutudaki eski sırla yenilenmeye devam eder. Eski sır Paraşüt'te iptal edilince o bağlantılar `REAUTH_REQUIRED` olur ve müşteri yeniden BAĞLAN der; eski sır kopyaları yedeklerde de kalır (kutuya işaret yazıp sırrı ortamdan çözme ayrı iş, BACKLOG).
- Canlı durum: kod T-1133 dalında; sunucu değerleri sahip tarafından girilecek (UNKNOWN), gerçek Paraşüt ile ortak uygulama bağlantısı doğrulanmadı (B-110).

## Son doğrulanmış Paraşüt yayını (T-1066, 27 Ekim)
- [PR227](https://github.com/shosgoren/EtkinWMS/pull/227): boş OAuth alanları, formda recentAuth yönlendirmesi, 30 sn ERP zamanlayıcı ve açık ürün listesi yenilemesi. Son birleşik main T1095 rehberini de içerir.
- Çalışan release: `48755d227dc3dd25188f1f8492ce4111c57dd129`. [Ana CI40572609077](https://github.com/shosgoren/EtkinWMS/actions/runs/40572609077), [guards40572609041](https://github.com/shosgoren/EtkinWMS/actions/runs/40572609041), [deploy40574232524](https://github.com/shosgoren/EtkinWMS/actions/runs/40574232524) başarılı.
- Doğrudan VPS: health `ok`, auto_migrate `true`; gerçek DB defteri `0061/61`; schema `24a0e643da9b3a89e3df69396eac4edacd54d108c099225c2dd7a8bacf01babe`. Sır veya ürün içeriği okunmadı; yalnız durum/sayı metadata kontrol edildi.
- Motive ilk bağlantı ve 2 kart aktarımı başarılı. Yeni sürümde PRODUCTS/SCHEDULE koşuları UTC20:06:02 ve20:06:30 SUCCESS; yeni/değişen kart yoksa sayılar0 normaldir. Büyük katalog/kuyruk/sağlayıcı sorunu hedef30–60sn süreyi uzatabilir.
- Sentetik kod taşıyan cookiesiz callback:400/INVALID_OAUTH_CALLBACK,Cache-Control:no-store,Referrer-Policy:no-referrer. Boş/kodsuz istek ile karıştırılmaz.
- Canlı Chrome gözlem izni reddedildi: tarayıcı oturumu/görsel kontrol yapılmadı. Yerel telefon/masaüstü testleri ve390/1180/1440 kontrolleri geçti; fiziksel cihaz UNKNOWN. Gerçek Secret, token, kod, DB bağlantısı loga/belgeye yazılmaz.
- [Ürün yaşam döngüsü229](https://github.com/shosgoren/EtkinWMS/issues/229) henüz uygulanmadı; [PRODUCT_IMPORT](PRODUCT_IMPORT.md) kararları otoritedir. Sonraki belge-only commit uygulama ağacını değiştirmez; çalışan release ile main SHA’sını kör eşitleme.

## 28 Ekim — Paraşüt ürün yaşam döngüsü (CANLIDA)

| Kanıt | Doğrulanan değer |
|---|---|
| Kod | Temel [PR233](https://github.com/shosgoren/EtkinWMS/pull/233), aktivasyon [PR234](https://github.com/shosgoren/EtkinWMS/pull/234); ikisinde de 18 kontrol yeşil |
| Çalışan release | `6b2f81dc3c7e2864bcfe21514a6e19e079350147` |
| Main kontrolleri | [CI40590857610](https://github.com/shosgoren/EtkinWMS/actions/runs/40590857610), [guards40590857597](https://github.com/shosgoren/EtkinWMS/actions/runs/40590857597): SUCCESS |
| Yayın | [deploy40591974518](https://github.com/shosgoren/EtkinWMS/actions/runs/40591974518): SUCCESS |
| Doğrudan VPS | health `ok`, aynı release; auto_migrate `true` |
| Gerçek DB defteri | `0062/62`; şema `0a9c0dcf5dee544dd1d164920810ccb1f26cbdb2e4f7a6d633d5f1d544d9410e` |
| Motive | CONNECTED; PRODUCTS/PULL açık; tenant OAuth ayarı mevcut; 4 kartta source_checked_at dolu |
| Otomatik koşular | UTC2026-10-27 22:09:41,22:10:11,22:10:41: SCHEDULE/SUCCESS, hata0 |
| Gerçek yaşam döngüsü | İkinci yokluk kontrolünden sonra1kart DELETED/REMOVED;4kart ACTIVE/NONE. Yalnız durum/sayı metadata, manuel test değişikliği yok |

0062 metadata varsa DOWN reddedilir; geçmiş silinmez. Temel paket önce93e6878/CI40588654469/guards40588654499/deploy40590083217 ile doğrulandı; güncel release yukarıdadır. Belge commit'i bu kaynak ağacını değiştirmez; main SHA ile çalışan uygulamayı kör eşitleme.

Yerel: lifecycle10DB+ERP20+ürün61DB; prepush5020birim/AC04375/E2E2/2; güvenlik0B0MA0MI/Gitleaks0. Canlı müşteri tarayıcı izni reddedildi; gerçek cihaz/canlı görsel UNKNOWN. Yalnız SSH sağlık ve durum/sayı metadata okundu; Secret/token/kod/DBURI okunmaz veya loglanmaz. Gerçek müşteri ürünü test amacıyla silinmedi/arşivlenmedi. Arşiv/silinme karar sınırları PRODUCT_IMPORT ve T-1068 kartında.

## 28 Ekim 09:35 — yayın geçişinde 502 (T-1070)
Kullanıcının ARCHIVED listesindeki otomatik yenilemesi sırasında 502. Proxy06:35:21UTC logu `lookup web ... server misbehaving`; yeni web06:35:23UTC başladı. Aynı pencerede deploy40644200421/PR243 vardı. Şu an releaseee6c1d9/healthok,DB0063,webrestart0/OOMfalse. ERP zamanlayıcı son koşuları SUCCESS; kaynak durumundaki arşivden çıkarma hatası kanıtı yok.
T-1070 kısa DockerDNS/bağlantı boşluğuna sınırlı bekleme ekler; upstream'e ulaşan isteği tekrar göndermemek için Caddy retry matcher kapalı ve Go örtükGET tekrarını engelleyen upstream keepalive kapalıdır. Bu tarayıcı TLS/keepalive'ını değiştirmez. İç ağda yeni bağlantı maliyeti kabul edilir. Uzun bakımda sıfır kesinti garantisi değildir. Kaynak Caddyfile otomatik imaj yayınıyla VPS'ye kopyalanmaz; CI/inceleme sonrası yedek+validate+graceful reload ayrıca doğrulanmalıdır. Canlı servisi test için durdurmak yok. Şimdilik kod yerelde, ayar canlıya uygulanmadı.
Resmi davranış: https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#load-balancing ; aynı dokümanın HTTP transport bölümündeki örtük keepalive tekrarları.

## T-1137 — Entegrasyon sağlığı ve kuyruk çözümü (destek notu)
- Sağlık bandı (Ayarlar › Entegrasyonlar): "koptu" = bağlantı ERROR (yeniden bağlan); "yarıda kaldı" = son koşu TIMEOUT; "uzun süredir bitmedi" = 15 dk'dan uzun RUNNING (40 dk'da TIMEOUT); "art arda hata" = 3 FAILED; "eşitlenmedi" = son başarı taramada 10 dk, webhook ACTIVE iken ürün/cari 25 dk'dan eski. Migration yok.
- Kontrol bekleyen irsaliye (CHECK): müşteri Paraşüt'te irsaliyeye bakar → yoksa "Yeniden gönder", varsa "Gönderildi say" (FAILED `MANUAL_SENT`), istemiyorsa "Gönderme" (`MANUAL_SKIPPED`). Elle çözülen satır yeniden gönderilmez; audit `integration.outbox_resolved` / `integration.outbox_retried`. Elle SQL ile kuyruk değiştirilmez.
- Eski parola bağlantısı: T-1139 ile kalmadı (aşağıdaki bölüm).

## T-1139 — Eski Paraşüt yöntemi (e-posta + parola) kaldırıldı, bağlantılar kesildi (kullanıcı kararı 31 Ekim)
- **Ne olur:** yayında migration **0068** çalışır (deploy-vps: yedek → migration). Tamamlanmış OAuth denemesi olmadan kurulmuş her Paraşüt bağlantısı DISCONNECTED + `last_error_code = LEGACY_METHOD_REMOVED` olur; mühürlü kimlik kutusu ve webhook anahtarları silinir, bağlantı başına bir `integration.disconnected` audit satırı (`change_summary.via = migration_0068`, `reason = LEGACY_METHOD_REMOVED`) yazılır. Müşteri verisi silinmez (ürün, cari, depo, stok, belge, eşleme, kuyruk, akış tercihleri). OAuth bağlantılarına (ortak uygulama ya da kendi uygulaması) dokunulmaz.
- **Yayın sonrası kontrol (yalnız sayı/kod okunur):** `SELECT count(*) FROM audit_logs WHERE action='integration.disconnected' AND change_summary->>'via'='migration_0068'` = kesilen bağlantı sayısı (Motive OAuth ile bağlıysa 0 beklenir); `SELECT status, last_error_code, count(*) FROM integrations WHERE provider='PARASUT' GROUP BY 1,2`. Kesilen müşteriye haber: Ayarlar › Entegrasyonlar'da "Yeniden bağlan" → Paraşüt'te giriş + izin; aynı şirket seçilir (eşleme varken başka şirket reddedilir), akışlar olduğu gibi döner.
- **Paraşüt'te kalan webhook kaydı:** migration ağ çağrısı yapamaz; eski kayıtlar Paraşüt'te kalabilir. Teslimler alıcı uçta bağlı bağlantı bulamadığı için işlenmez (401). Müşteri OAuth ile yeniden bağlanınca kayıt işi bu kayıtları kimliğiyle siler ve yenisini kurar.
- **Geri alma:** 0068 down bilerek no-op'tur (silinen kimlik geri getirilemez); eski yönteme dönüş yok. Elle SQL ile bağlantı CONNECTED yapılmaz.

## T-1138 — Paraşüt anlık bildirim (webhook) — yayın sonrası kontrol
- **Açık adres:** `https://wms.etkinyazilim.com/api/integrations/parasut/webhook` (yalnız POST). Caddy yalnız `/api/public/*` yolunu dışarıya kapatır; bu yol kapanmaz ve yeni Caddy kuralı gerekmez. Panel kökeninde (`yonet.`) 404'tür. Dışarıdan duman: imzasız `curl -sS -X POST https://wms.etkinyazilim.com/api/integrations/parasut/webhook -d company_id=1` → `401 rejected` (gövde sabit; 404 ise yol kapanmış demektir).
- **Kayıt adresi:** worker kayıt işi adresi `BETTER_AUTH_URL` kökeninden kurar (`/opt/etkinwms/secrets/worker.env`; davet e-postası da bunu kullanır). Değer `https://wms.etkinyazilim.com` değilse kayıt `FAILED CONFIG` olur ve 30 sn tarama sürer. Değerin kendisi loga/belgeye yazılmaz; yalnız köken doğrulanır.
- **Gerçek hesapta doğrulama (UNKNOWN, BACKLOG):** (1) Yayından sonra Motive bağlantısında Entegrasyonlar › Bağlantı bandında "Anlık bildirim açık" görünmeli (en geç 30 sn + bir kayıt işi; bağlantı yeniden kurulmaz). "kurulamadı" görünürse `integrations.webhook_last_error_code` okunur (yalnız kod): `PROVIDER_INVALID` / `WEBHOOK_KEY_UNKNOWN` = Paraşüt anahtar alanını kabul etmiyor ve anahtar döndürmüyor → kod düzeltmesi gerekir. (2) Paraşüt'te bir ürünün adını değiştir → birkaç saniye içinde Ürünler ekranında yeni ad; `integration_runs` değil `audit_logs` `integration.webhook_received` satırı (outcome UPDATED). Olmazsa ve `webhook_last_event_at` boşsa teslim gelmiyor (Paraşüt tarafı/IP), doluysa ama kart değişmediyse imza yapısı uyuşmuyor olabilir (401 → `webhook_last_event_at` yazılmaz; web loglarında yalnız durum). (3) Gerçek ürün sırf test için silinmez/arşivlenmez.
- **Kademe:** anlık bildirim açıkken ürün/cari taraması 15 dk, depo 3 dk; kapalı/kurulamamışken 30 sn. Bağlantı kesilince Paraşüt'teki kayıtlar silinir (en iyi çaba), anahtar silinir.
