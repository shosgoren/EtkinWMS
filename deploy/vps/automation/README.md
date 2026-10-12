# EtkinWMS GitHub → Hostinger bağlantısı

T-905: bilgisayardan bağımsız, yalnız `shosgoren/EtkinWMS` için yayın hattı. Kullanıcı 12.10.2026'da bu bağlantının kurulmasını istedi. Kişisel/root SSH anahtarı aktarılmaz; ayrı kimlik kullanılır. Üretim sırları VPS'de kalır.

## Yayın sınırları

- `check`: gerçek GitHub runner → sınırlı SSH kimliği → HTTPS derin health. Uygulama/migration değiştirmez.
- `deploy`: yalnız exact **güncel main SHA**, `verify/infra/secrets/deps/int/e2e/check-all/test-ac/check-pilot` GitHub Actions kontrollerinin en son sonucu success ise kabul edilir. Kontroller runner'da ve VPS'de tekrar denetlenir.
- İlk aday canlı T-902 baseline `024a800` commit'ini içermelidir; sonraki adaylar önceki yayın SHA'sının devamı olmalıdır. Main eski olduğu için yalnız otomasyon PR'ının birleşmesi eski ürün kodunu canlıya geri gönderemez. Eski/divergent kod reddedilir.
- Payload yalnız digest'i eşleşen, `etkinwms:<SHA>` olarak tek etiketli ve `node` kullanıcı/revision etiketli Docker imaj arşividir. Genel shell, SCP, forwarding, dosya extraction ve genel sudo yok. Sabit root-sahipli Compose, yalnız EtkinWMS kaynakları ve volume'ları kullanır.
- İmaj etiketi tek başına güven kanıtı değildir. Exact arşiv için GitHub OIDC build attestation gerekir; VPS resmi ve checksum-pinlenmiş GitHub CLI ile certificate issuer/repo/workflow/main-ref/source+signer digest ve hosted runner kimliğini doğrular. Üretim token'ı gerektirmeyen public API + disk bundle yolu kullanılır. Eksik/geçersiz attestations Docker load'dan önce reddedilir. Gerçek imaj attestation akışı ilk yeşil main build'inden sonra ayrıca doğrulanır.
- Migration'lar otomatik çalışmaz. Aday migration dosya fingerprint'i hem operator-approved schema hem önceki çalışan imajın schema kaydıyla aynı olmalıdır. 27→30 değişikliği, önceki imajla uyumlu geri dönüş hazırlanıp yetkili operatör yeni baseline'ı kurmadan reddedilir.
- Sağlık başarısızsa schema-compatible önceki Compose/imaj geri getirilir. Volume silme/prune yok. Yeni imaj marketing kaynağını da içerir; kaynak host bind-mount'a ihtiyaç duymaz.
- Aynı üretim SHA'sının tekrar yayını sağlıklıysa no-op'tur; aktif rollback tag'i yeni imajla ezilmez. State yazımı başarısızlığında eski Compose/imajla birlikte current symlink ve state kaydı da geri yüklenir.
- Runtime/db/secrets kullanıcı scope'unu yalnız uygulama içinde kullanır. İmaj kodu uygulama sırlarına erişebilir; bu yüzden main/CI/inceleme kapıları korunur. Sınırlı kimlik uygulama yayını yetkisidir, genel sunucu yönetimi yetkisi değildir.

## Kurulum sırası

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
- Sınır testi11/11, Bash syntax ve YAML parser kontrolleri başarılı. Bunlar GitHub runner uçtan uca sonucu değildir. Token'sız CLI disk-bundle yolu, malformed test bundle'ını reddederek doğrulandı; gerçek signed image olumlu testi henüz yok.
- GitHub runner bağlantısı: main workflow inceleme/onay ve birleşmesi bekleniyor; henüz doğrulanmadı.
- Main'den gelen üç sentetik fixture tarama engeli için PR #5 / 72262ee'nin `.gitleaksignore` kaydı byte-identical taşınır; yeni kural/yol muafiyeti yok. Korunan fingerprint değişikliğinin inceleme kaydı da PR #8'e bağlanır.
- Protected inceleme ve main'e birleştirme: bekliyor.
- Yeni ürün sürümünün yayını: yapılmadı; ayrı CI/schema/rollback kapıları vardır.
