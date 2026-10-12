# Etkin WMS — Hostinger yayın devir notu

**Son kontrol:** 12 Ekim 2026 17:16 Europe/Istanbul. Bu dosya erişim bilgisi ve yayın prosedürüdür; yeni sürümün yayınlandığına kanıt değildir. Parola, özel anahtar veya veritabanı bağlantı parolası içermez.

## Mevcut ve doğrulanmış kurulum

| Konu | Değer |
| --- | --- |
| Sunucu | Kullanıcının yeni Hostinger VPS'si, `187.7.76.72` |
| Sistem | Ubuntu 24.04, KVM2, 2 vCPU / 8 GB RAM / 100 GB disk |
| Uygulama | `https://wms.etkinyazilim.com` |
| Satış | `https://etkinyazilim.com`; `.com.tr` ve www adresleri ana satış adresine yönlenir |
| Etkin release | `/opt/etkinwms/current` → `/opt/etkinwms/releases/guided-20261012` |
| Etkin imaj | `etkinwms:guided-20261012` |
| Compose | `etkinwms-motive`; `deploy/vps/compose.yml` |
| Servisler | `web`, `worker`, `proxy` (Caddy), `marketing` |
| Web runtime sırları | `/opt/etkinwms/secrets/web.env`, 0600 |
| Worker runtime sırları | `/opt/etkinwms/secrets/worker.env`, 0600 |
| Veritabanı | Yeni Neon Motive, `autumn-lake-32406096`; uygulama/auth/worker rolleri ayrı |
| Kalıcı veriler | Neon veritabanı, Compose Caddy volume'ları ve `etkinwms-motive_marketing-leads` |

Yerel ana görev, önceden kullanıcı tarafından onaylanan SSH erişimiyle sunucuya bağlandı. 17:16 kontrolünde dört container çalışıyordu, web healthy idi; HTTPS `/api/health` sonucu `status/db/queue/worker=ok` döndü. Bu kontrol salt okunurdu; deployment, migration veya hesap işlemi yapılmadı.

## Cloud neden yayın yapamıyor?

- Cloud çalışma ortamında bu VPS için yetkili SSH kimliği yok. Kullanıcının bilgisayarındaki anahtar/Chrome oturumu Cloud'a otomatik taşınmaz.
- GitHub kod erişimi VPS erişimi değildir. Kodun push edilmesi mevcut container'ları güncellemez.
- EtkinWMS'ye özel GitHub Actions deployment workflow'u ve sınırlı VPS dağıtım kimliği henüz kurulmadı.
- Aktif Cloud görevi **EtkinWMS bulut bağlantısını doğrula**, id `01a12fe6-af69-74e9-b916-9fb67dd900ff`. Bağlı ortamda stok/üretim/sevkiyat kodu geliştirmiştir; eski boş-workspace göreviyle karıştırılmaz.
- 17:16 GitHub kontrolünde yeni çalışma için yalnız #5 T-903a test altyapısı PR'ı görünüyordu. Tam ürün adayının push/PR işlemleri sürüyordu; yalnız #5'i yayınlayarak pilotun yeni kodları yayınlanmış olmaz.

**Mevcut çözüm:** Cloud doğrulanmış kodu ve yayın devir sonucunu GitHub'a gönderir. Yerel yetkili görev o aday SHA'yı alır, yayın kapılarını doğrular ve mevcut onaylı SSH erişimiyle deploy eder. Bu yöntem yerel bilgisayarın açık olmasını gerektirir; tamamen bağımsız otomatik Cloud yayını değildir.

**Kalıcı çözüm:** Yalnız EtkinWMS için ayrı dağıtım workflow'u ve forced-command VPS kimliği hazırlanır, incelenir ve somut erişim onayından sonra kurulur. Kişisel/root SSH özel anahtarı Cloud'a, sohbete veya GitHub'a kopyalanmaz. Ayrı kimliğin credential'ı gerekiyorsa güvenli GitHub environment secret olarak tutulur; üretim env dosyaları VPS'de kalır. Genel shell/sudo/Docker grup erişimi verilmez; host key pinlenir. Cloud'un workflow tetikleyebildiği ayrıca doğrulanır. Tasarımın kayıtta olması kurulduğu anlamına gelmez.

## Yayın kapıları — atlama

1. Tek yayın adayı: EtkinWMS deposunda push edilmiş **tam SHA**, dal/PR zinciri ve değişiklik manifesti. Çalışma ağacı veya hareketli branch adına dayanarak yayınlama.
2. SHA'ya karşılık gelen lint/tip/test/build, GitHub CI ve korunan değişiklik incelemeleri. Kırmızı kontrolü yeşil veya onaylanmış sayma; bekçileri kapatma.
3. Mevcut canlı müşteri/tenant/stock durumunun ve migration seviyesinin yetkili, salt okunur tespiti. Loglarda env/SQL sırları gösterilmez.
4. Veritabanının özel yedeği veya sağlayıcı restore noktası; **geri yükleme denemesinin kanıtı**. Sadece “yedek dosyası var” yeterli değil. Başka müşterinin/orijinal projenin DB'si kullanılmaz.
5. Aday migration'larının sürüm ve veri uyumluluğu. Aktif Cloud kodunda 27→30 migration söz konusu; Cloud'un yerel 30→27→30 testleri eski guided uygulamasının gerçek veride güvenli çalışacağını kanıtlamıyor. Veri varken down migration reddedilebiliyor. Eski imaja dönüşün güvenli olmadığı engeli açık; uyumlu rollback/roll-forward planı olmadan uygulanmaz.
6. İlk müşteri bootstrap/MFA eksikleri ayrı teslim kapısıdır. Yeni ekranların yayını ilk yönetici hesabını otomatik oluşturmaz.
7. Gerçek cihaz/kullanıcı kabulü ayrıca raporlanır. Deployment teknik başarısı “pilot tamam” demek değildir.

## Yetkili operatör için uygulama sırası

Bu adımlar aday ve erişim doğrulandıktan sonra uygulanır; Cloud terminalinde mevcut yerel anahtarın var olduğunu varsayarak çalıştırılmaz.

1. Aday SHA'yı temiz ayrı checkout'ta al. Node24 ve pnpm10.28.0 ile bağımlılıkları frozen kur; gerekli kontrolleri tamamla. Kaynak projenin checkout'unu değiştirme.
2. Üretim Docker imajını `linux/amd64` için **tam aday SHA ile ilişkilendirerek** build et. Mevcut `Dockerfile` kullanılır. İmaj ve yalnız Git'te takipli kaynak snapshot'ı hazırlanır; `.env*`, özel anahtar, node_modules, .git, log ve test artifact'ları kaynak paketine girmez. Örneğin Git archive sırları taşımadan exact commit kaynağı üretir.
3. İmaj/kaynak dosyalarının SHA256 özetlerini kaydet; yetkili SSH/SCP ile yeni `/opt/etkinwms/releases/<benzersiz-release>` dizinine aktar ve sunucuda karşılaştır. Mevcut release üstüne dosya açma. Dosya ve imaj manifesti aday Git SHA'sını belirtir.
4. Kaynakta `deploy/vps/compose.yml`, `deploy/vps/Caddyfile` ve `marketing/` bulunmalıdır. İmajı load et. Runtime env dosyaları mevcut özel dizinde kalır. Compose config denetiminde env sırlarını terminal çıktısına basmamak için **`config --quiet`** kullan.
5. Yedek/restore ve uyumlu rollback kapıları kapandıktan sonra gerekli migration'ları ayrı, yetkili ve sınırlı yolla uygula. Migration sahibinin URI'sini runtime container'larına veya Cloud'a aktarma. Eski web/worker ile yeni schema birlikte uyumsuzsa planlı bakım/durdurma sırasını önceden belirle; tahminle çalıştırma.
6. Yeni release içindeki `deploy/vps/compose.yml` ile **aynı Compose proje adı** `etkinwms-motive` korunarak up/recreate yap. `WMS_RELEASE` yüklenen imaj etiketiyle eşleşir. `down -v`, volume prune veya genel Docker prune çalıştırma.
7. Caddy tek dosya bind-mount kullanır; değişen dosyanın eski inode'u bağlı kalabilir. Yeni release yolu/proxy recreate ile etkin konfigürasyonu ve sertifikayı kontrol et. Marketing kaynak bind-mount'u da yeni release'i göstermelidir. Named volume ve mail/DNS kayıtları korunur.
8. İç web liveness ve dış HTTPS derin health kontrolü; `status/db/queue/worker=ok` gerekir. Container çalışıyor veya port açık olması yeterli değildir. Üye giriş/MFA ve en az bir yetkili gerçek uygulama okuması da kontrol edilir; health endpoint'inden ürün hazır sonucu çıkarılmaz.
9. Başarılı kontrollerden sonra current symlink'ini gerçekten çalışan release'e eşleştir; Git SHA, image ID/digest, migration seviyesi, kontrol zamanı ve rollback hedefini devir kaydına yaz.
10. Başarısızlıkta sadece **önceden uyumluluğu doğrulanmış** geri dönüşü uygula. Veriyi koruyan alternatif yoksa otomatik eski imaj/schema down komutu çalıştırma; uygulamayı güvenli bakım durumunda tut ve somut engeli bildir.

## Salt okunur kontrol örneği

Bu komutlar **zaten yetkilendirilmiş SSH oturumunda VPS üzerinde** çalıştırılır. Cloud'a kimlik kazandırmaz; bağlantı anahtarı içermez.

```sh
readlink -f /opt/etkinwms/current
docker ps --format '{{.Names}} {{.Image}} {{.Status}}'
curl -fsS --max-time 10 https://wms.etkinyazilim.com/api/health
```

`cat` ile env dosyalarını yazdırma. `docker inspect` veya `docker compose config` çıktısının sır içerebileceğini dikkate al; tanı çıktısını ihtiyaca göre daralt. Shell komutlarına sır interpolate etme.

## Cloud görevinin yerel yayın görevine bırakacağı sonuç

- Yayına aday tam SHA + PR URL'leri ve sıralı taban zinciri.
- Aday manifesti, doğrulamalar ve kalan kırmızı CI/inceleme kapıları.
- Migration dosyaları/sırası, üretimde beklenen etkiler, down engelleri.
- Yedek/restore ve uyumlu rollback/roll-forward için uygulanabilir plan; doğrulanan ve bekleyen maddeler ayrı.
- İlk yönetici/tenant bootstrap durumunun açık kaydı.
- Hiçbir özel anahtar/parola/DB URI'si olmadan yayın talimatı ve hazır build kaynakları.

Yalnız **shosgoren/EtkinWMS** ve bu yeni VPS/Neon hedefidir. `2027-WMS-1`, o projenin Fly/Neon kaynakları ve diğer Hostinger sunucuları değiştirilemez.
