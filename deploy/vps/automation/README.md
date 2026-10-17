# EtkinWMS GitHub → Hostinger bağlantısı

T-905: bilgisayardan bağımsız, yalnız `shosgoren/EtkinWMS` için yayın hattı. Kullanıcı 12.10.2026'da bu bağlantının kurulmasını istedi. Kişisel/root SSH anahtarı aktarılmaz; ayrı kimlik kullanılır. Üretim sırları VPS'de kalır.

## Yayın sınırları

- `check`: gerçek GitHub runner → sınırlı SSH kimliği → HTTPS derin health. Uygulama/migration değiştirmez.
- `deploy`: yalnız exact **güncel main SHA**, `verify/infra/secrets/deps/int/e2e/check-all/test-ac/check-pilot` GitHub Actions kontrollerinin en son sonucu success ise kabul edilir. Kontroller runner'da ve VPS'de tekrar denetlenir.
- İlk aday canlı T-902 baseline `024a800` commit'ini içermelidir; sonraki adaylar önceki yayın SHA'sının devamı olmalıdır. Main eski olduğu için yalnız otomasyon PR'ının birleşmesi eski ürün kodunu canlıya geri gönderemez. Eski/divergent kod reddedilir.
- Payload yalnız digest'i eşleşen, tam olarak iki imaj (`etkinwms:<SHA>` uygulama, `etkinwms-migrate:<SHA>` migration aracı; T-916) içeren, ikisi de `node` kullanıcı/revision/schema etiketli Docker imaj arşividir. Genel shell, SCP, forwarding, dosya extraction ve genel sudo yok. Sabit root-sahipli Compose, yalnız EtkinWMS kaynakları ve volume'ları kullanır.
- İmaj etiketi tek başına güven kanıtı değildir. Exact arşiv için GitHub OIDC build attestation gerekir; VPS resmi ve checksum-pinlenmiş GitHub CLI ile certificate issuer/repo/workflow/main-ref/source+signer digest ve hosted runner kimliğini doğrular. Üretim token'ı gerektirmeyen public API + disk bundle yolu kullanılır. Eksik/geçersiz attestations Docker load'dan önce reddedilir. Gerçek imaj attestation akışı ilk yeşil main build'inden sonra ayrıca doğrulanır.
- Schema iddiası SSH argümanına güvenilerek kabul edilmez. Checked-out exact SHA migration fingerprint'i build öncesi hesaplanıp imaj config etiketine yazılır; OIDC attestation aynı arşivi imzalar. VPS etiketi approved schema ile eşleştirir; eksik/farklı değer Docker load öncesi reddedilir.
- Migration (T-916): aday schema etiketi approved schema'dan farklıysa ve operatör bir kez `install-migrate.sh` ile `/opt/etkinwms/automation/migrate.env` (migration rolünün DSN'i, root600) kurduysa alıcı sırasıyla: migration rolünü doğrular (ledger sahibi; kendisi ve üyelikleri NOSUPERUSER/NOBYPASSRLS/NOCREATEROLE/NOCREATEDB/NOREPLICATION) → web/worker durdur → `pg_dump -Fc` → `/opt/etkinwms/backups/` (root700/600, ≥1 GB boş alan, yarım dosya silinir, son 10) → imzalı `etkinwms-migrate:<SHA>` adlı konteynerle `migrate.ts up` (read-only, cap-drop, çıktı bastırılır) → state ve approved-schema (`.bak-<epoch>`) ilerler → normal yayın. `migrate.env` yoksa eski davranış: `SCHEMA_OPERATOR_APPROVAL_REQUIRED`. Önceki state schema'sı approved'a eşit olmalı.
- **Güven sınırı değişikliği (kullanıcı kararı 13 Ekim):** migrate.env kurulduktan sonra main'e birleşen yeni migration dosyası, CI ve imza kapılarından geçince üretimde migration sahibi rolüyle DDL çalıştırır (sahip olduğu tablolarda RLS'yi atlayabilir, DROP/ALTER yapabilir). Superuser/rol oluşturma/BYPASSRLS yetkisi yoktur. Migration dosyaları bu yüzden korunan inceleme ile birleşir; kapatmak için `migrate.env` silinir.
- Hata kodları: yedek/durdurma hatası → önceki imaj açılır (`BACKUP_FAILED_PREVIOUS_RESTARTED`); migration hatası ve konteyner sonlandırılıp DB'de `wms-migrate` oturumu kalmadıktan sonra defter hiç ilerlemediyse önceki imaj açılır (`MIGRATION_FAILED_PREVIOUS_RESTARTED`); aksi halde servis DURUR (`MIGRATION_PARTIAL_SERVICE_STOPPED`) — yedekten dönüş/ileri onarım operatör kararıdır. Migration sonrası state/onay yazılamazsa `POST_MIGRATION_STATE_WRITE_FAILED_SERVICE_STOPPED`. Migration sonrası yeni imaj sağlıksızsa önceki imaj yeni şema üzerinde en iyi çaba geri dönüştür; kurtarma noktası yedektir. Yedekler aynı diskte; sunucu kaybına karşı yedek değildir.
- Sağlık başarısızsa schema-compatible önceki Compose/imaj geri getirilir. Volume silme/prune yok. Yeni imaj marketing kaynağını da içerir; kaynak host bind-mount'a ihtiyaç duymaz.
- Aynı üretim SHA'sının tekrar yayını sağlıklıysa no-op'tur; aktif rollback tag'i yeni imajla ezilmez. State yazımı başarısızlığında eski Compose/imajla birlikte current symlink ve state kaydı da geri yüklenir.
- Runtime/db/secrets kullanıcı scope'unu yalnız uygulama içinde kullanır. İmaj kodu uygulama sırlarına erişebilir; bu yüzden main/CI/inceleme kapıları korunur. Sınırlı kimlik uygulama yayını yetkisidir, genel sunucu yönetimi yetkisi değildir.

## Kurulum sırası

0. T-916 bir kerelik kurulum (root, exact main kaynağının bu dizininde): `bash install-migrate.sh` — migration rolünü seçer (ledger sahibi yetkisizse o, değilse yeni `wms_migrator`), uygulama şemalarında `postgres`/eski sahip nesnelerini tek transaction'da ona devreder (kalan varsa ret), rastgele parolayı yalnız SCRAM doğrulayıcısı olarak gönderir, TLS girişini doğrular, receiver'ı yayın kilidi altında kurar.
1. Sınır testleri: `python3 -m unittest discover -s deploy/vps/automation -p 'test_*.py' -v`; Bash ve Python sözdizimi; workflow incelemesi.
2. Yerelde yalnız bu bağlantıya özel Ed25519 anahtar oluştur. Özel anahtar Git'e/Cloud sohbete girmez. Onaylı administrator erişimiyle installer ve **public key** VPS'ye aktarılır; `install.sh <public-key-file>` çalıştırılır.
3. GitHub `etkinwms-production` Environment **yalnız main** dalına açıktır. `ETKINWMS_DEPLOY_KEY` ayrı özel anahtar; `ETKINWMS_KNOWN_HOSTS` mevcut onaylı host-key kaydıdır. Host key yeniden körlemesine `ssh-keyscan` ile kabul edilmez.
4. `.github` korunan kaynak değişikliğidir; inceleme/onay kaydı olmadan main'e birleşmez ve yayın yetkisi hazır sayılmaz. Main'e onaylı birleşmeden sonra `mode=check` ile GitHub runner bağlantısı test edilir; bu test uygulamayı yayınlamaz. Geliştirme dalına geçici üretim erişimi talebi otomatik onay denetimince reddedildi, böyle bir izin verilmedi. Güvenli alternatif olarak tüm işlem main'den yürür.
5. Kontrol ve incelemeden sonra workflow main'de bulunur. `ci` veya `guards` başarıyla tamamlandığında yayın gate'i çalışır; biri eksik/kırmızıysa ret. Manuel `workflow_dispatch mode=deploy sha=<tam-main-SHA>` da aynı kapılardan geçer; bypass yok.
6. Environment izinli dal listesinde yalnız main bulunması ve genel SSH komutlarının reddedilmesi periyodik operasyon kontrolünün bir parçasıdır; bu dosya zamanlanmış kontrol kurmaz.

## Durum ve işletim

Kurulum/test çıktısını aşağıya gerçek zaman/SHA/workflow run URL'si ile kaydet. Sadece dosyaların hazırlanması kurulum kanıtı değildir. Key rotation root operatörünün onaylı public key'i değiştirmesi ve GitHub secret güncellemesiyle yapılır; eski kişisel anahtar bu işlemde kullanılmaz.

- Hazırlanan kod: T-905 dalı; uygulama kodu değişmez.
- VPS kısıtlı kullanıcı/forced command/sudo helper kuruldu; gerçek yeni kimlikle `check` başarılı, genel `id` komutu reddedildi. Root Compose config --quiet geçerli; mevcut guided yayını/health korunuyor.
- GitHub production environment ve ayrı key/known_hosts secret adları doğrulandı; değerler yazdırılmadı. Ortam dal listesi yalnız main. Kişisel/root anahtar aktarılmadı.
- Installer'ın ilk sshd kontrolünde Match bloğunda desteklenmeyen PermitUserEnvironment satırı reddedildi; kaldırılıp genel etkin değerin no olduğu doğrulandı. sshd -t ve reload başarılı. Kaynak installer da düzeltildi; başarısız syntax dosyası için cleanup eklendi.
- Yerel known-host dosya yolunda boşluk ayrıştırması tespit edildi. Önceden güvenilir kayıttaki açık anahtar, authenticated strict SSH sunucu anahtarıyla karşılaştırılarak doğru dosyaya kaydedildi. Yeni host kabul edilmedi. Yerel SSH option içinde boşluklu yol ayrıca tırnaklanır.
- İlk independent review: 0 BLOCKER / 2 MAJOR / 1 MINOR; imaj build provenance, aynı SHA/tag üzerine yazma ve state failure/current geri dönüşü. Üçü yeni kod ve regresyon testleriyle düzeltildi; yeni SHA bağımsız tekrar incelemesi bekleniyor.
- Sınır testi12/12, Bash syntax ve YAML parser kontrolleri başarılı. Bunlar GitHub runner uçtan uca sonucu değildir. Token'sız CLI disk-bundle yolu, malformed test bundle'ını reddederek doğrulandı; gerçek signed image olumlu testi henüz yok.
- GitHub runner bağlantısı: main workflow inceleme/onay ve birleşmesi bekleniyor; henüz doğrulanmadı.
- Main'den gelen üç sentetik fixture tarama engeli için PR #5 / 72262ee'nin `.gitleaksignore` kaydı byte-identical taşınır; yeni kural/yol muafiyeti yok. Korunan fingerprint değişikliğinin inceleme kaydı da PR #8'e bağlanır.
- Protected inceleme ve main'e birleştirme: bekliyor.
- Yeni ürün sürümünün yayını: yapılmadı; ayrı CI/schema/rollback kapıları vardır.

## Canlı ayar güncellemesi (update-config.sh, T-401)

`install.sh` tek seferliktir ve yayınlar `/opt/etkinwms/automation/{compose.yml,Caddyfile}` dosyalarını güncellemez. Yeni servis/birim/alan adı
(T-994 `demo-leads`, ADR-027 `panel` + `yonet.etkinyazilim.com`) için VPS yöneticisi, ilgili sürüm canlıya çıktıktan sonra:

1. DNS: `A yonet → VPS IP` (Hostinger). Caddy sertifikayı ilk istekte alır.
2. Depodan üç dosyayı (aynı commit) VPS'te bir klasöre kopyalar: `deploy/vps/automation/compose.yml`, `deploy/vps/Caddyfile`, `deploy/vps/automation/update-config.sh`.
3. Root olarak `bash update-config.sh <klasör>`: önce `docker compose config` ve `caddy validate` ile doğrular, eski dosyaları zaman damgalı yedekler, kurar, servisleri mevcut sürüm etiketiyle ayağa kaldırır ve Caddy'yi yeniden başlatır.

Bilinen sınır: `release.py` göç öncesi yalnız `web` ve `worker`'ı durdurur; `panel` açık kalır (yedek `pg_dump` tutarlı anlık görüntüdür; panel yazmaları seyrek operatör kararlarıdır). `release.py` de root kurulumludur; değişikliği ayrı adımdır.

## Proje adının taşınması (T-410, bir kez)

Canlı Compose projesi `etkinwms-motive` (tek müşteri adı) → `etkinwms`. `release.py`, `update-config.sh` ve `install-migrate.sh` proje ve
uygulama ağı adını `state.json`'daki `project` alanından okur (yoksa eski ad; yalnız `etkinwms-motive`/`etkinwms` kabul edilir), bu yüzden
yeni `release.py` taşımadan önce de sonra da çalışır.

Sıra (bu özelliği içeren sürüm main'e birleşmeden ÖNCE 1, yayından SONRA 2):
1. Root: aynı commit'teki `release.py`'yi kur (`install -m 755 -o root -g root release.py /usr/local/sbin/etkinwms-release`). T-411
   kuyruk kurulumu da bununla gelir; yayın bu sürümün imzalı migration imajını kullanır.
2. Yayın sağlıklı bitince, düşük trafik saatinde root: depodan `deploy/vps/automation/compose.yml`, `deploy/vps/Caddyfile`,
   `deploy/vps/automation/release.py`, `deploy/vps/automation/rename-project.sh` ve `deploy/vps/database/compose.yml` (adı
   `database-compose.yml` olarak) aynı klasöre kopyalanır; SSH kopmasına karşı `setsid bash rename-project.sh <klasör>` (ya da
   `systemd-run --wait --pty`). Betik: yayın kilidini beklemeden alır (yayın sürüyorsa reddeder) → önkoşulları ve mevcut sağlığı denetler
   → yedekler (`*.<zaman>`) → eski yığını durdurur →
   yeni compose/Caddyfile'ı kurar → yeni projenin ağ/birim/konteynerlerini oluşturur → `caddy-data`, `caddy-config`, `marketing-leads`,
   `demo-leads` birimlerini KOPYALAR (eskiler silinmez) → `etkinwms-postgres`'i yeni ağa da bağlar → yeni yığını başlatır → derin sağlık →
   `state.json`'a `project: etkinwms` yazar, `release.py`'yi ve veritabanı compose dosyasını kurar (DB konteyneri yeniden
   OLUŞTURULMAZ) → eski (durmuş) konteynerleri kaldırır. Herhangi bir hatada ya da kesilme sinyalinde (HUP/INT/TERM): yeni birimlerin
   içeriği eskilere geri kopyalanır (bu arada gelen demo talepleri kaybolmaz), yeni kaynaklar (konteyner, ağ, kopya birimler) kaldırılır,
   dosyalar ve `state.json` geri yüklenir, eski proje ayağa kalkar. Kesinti hedefi < 2 dk. Yerel Docker'da başarılı taşıma, sağlık
   hatasında geri dönüş (yeni yığına gelen talep eskiye geri yazıldı), kesilme sinyalinde geri dönüş, yayın kilidi meşgulken ret ve ikinci
   çalıştırmanın reddi denendi.
3. Eski birimler (`etkinwms-motive_*`) ve ağ, bir sonraki planlı DB bakımında DB konteyneri (kurulu yeni `database/compose.yml` ile)
   yeniden oluşturulduktan sonra elle kaldırılabilir; o zamana dek DB konteyneri iki ağa bağlı kalır.

## İş kuyruklarının kurulumu (T-411)

Yeni iş türleri (ör. `platform.activation.deliver`, `trial.welcome`) şema değişmeden de eklenebilir. `release.py`, `migrate.env`
kuruluysa HER yayında aynı imzalı migration imajındaki `/queue-installer/sync.mjs`'i migration rolüyle çalıştırır: yalnız eksik
kuyrukları oluşturur (pg-boss şema yükseltmesi ve yetki değişikliği yapmaz). Göç yoksa önceki sürüm çalışırken koşar; hata olursa yayın
`QUEUE_INSTALL_FAILED_PREVIOUS_RUNNING` ile durur, hiçbir servis durdurulmaz. Göç varsa onaylı göçten sonra koşar; hata önceki imajı
yeniden başlatır. Yanıtta `"queues": "installed"` (ya da `migrate.env` yoksa `"skipped"`) yazar.

`release.py` root kurulumludur (`/usr/local/sbin/etkinwms-release`) ve yayınla güncellenmez. Bu özelliği içeren sürüm canlıya
çıktıktan SONRA VPS yöneticisi bir kez kurar (aynı commit'teki dosya; önce kurulursa eski imajda yükleyici olmadığı için bir sonraki
yayın güvenle durur):

```bash
install -m 755 -o root -g root release.py /usr/local/sbin/etkinwms-release
```
