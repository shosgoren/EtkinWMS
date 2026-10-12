# Hostinger PostgreSQL işletimi

Kullanıcı 12 Ekim 2026 tarihinde veritabanının da satın alınan VPS'de olmasını açıkça istedi. T-907, mevcut schema27 Neon yedeğinin VPS PostgreSQL18'e aktarımıdır; migration30 veya ilk hesabı kendiliğinden uygulamaz.

PostgreSQL resmi mevcut imaj digest'iyle sabittir. Host portu yoktur; yalnız etkinwms-motive_default Docker ağında etkinwms-postgres adıyla erişilir. Kalıcı veri ayrı etkinwms-database_postgres-data volume'undadır. Uygulama yayını bu volume'u silmez. TLS server sertifikası kendi CA'sıyla imzalanır; CA özel anahtarı DB konteynerine veya uygulamaya verilmez. Web/worker yalnız CA.crt dosyasını salt okunur görür. HBA yalnız hostssl/SCRAM kabul eder; şifresiz TCP reddedilir. Bağlantılar sslmode=verify-full ve sslrootcert=/run/etkinwms-db-ca.crt kullanır. Runtime roller NOSUPERUSER/NOBYPASSRLS/NOCREATEROLE/NOCREATEDB kalır; operatör URL'si runtime env'e girmez.

Geçiş: uygulama yazmaları durdurulur; exact son custom pg_dump yedeği alınır; rol sahipleri ve uygulama ACL/RLS korunarak pg_restore yapılır. Yalnız Neon sağlayıcı rolleri cloud_admin/neon_superuser için iki DEFAULT ACL TOC kaydı dışarıda kalır; uygulama ACL'leri atlanmaz. identity_probe yalnız NOLOGIN/NOBYPASSRLS ve operatör SET TRUE/INHERIT FALSE/ADMIN FALSE üyeliğiyle korunur. Yeni yerel rol parolaları güvenli rastgele üretilir ve yalnız root600 dosyalarda bulunur.

Önce ağsız yerel PostgreSQL18 test geri yüklemesi geçmelidir. VPS'de restore sonrası migration satırları/checksum, tablo sayımları, fonksiyon sahipleri, RLS ve rol bayrakları kaynakla karşılaştırılır. Sonra mevcut guided schema27 web/worker env ve CA mount'ları atomik olarak çevrilir; HTTPS status/db/queue/worker OK ve gerçek DB host/SSL kanıtı alınır. Hata halinde runtime yazmaları durdurularak önceki env/Compose geri alınır; veri yazılmış iki DB arasında kör geri dönüş yoktur.

İşletim: günlük yedekler VPS'de root700 dizine, dosyalar600; salt okunur restore denemesi ayrıca tutulur. Sunucu arızasında tek VPS üzerindeki yedek yeterli değildir; ayrı konuma şifreli yedek politikası kullanıcıyla ayrıca belirlenmelidir. TLS sertifikası 365 gün, CA1825 gün; süre dolmadan aynı güven zinciriyle server sertifikası yenilenir. Kaynak Neon verisi kesim doğrulanmadan silinmez. Parola, DSN, bearer token veya özel anahtar repo/log/sohbete girmez.

Hazırlık kanıtı: schema27 custom521KB; port/ağ olmayan yerel PostgreSQL18 restore PASS,27 migration/tenant0/user0, üç runtime rol güvenli. Bunlar VPS geçişi başarı iddiası değildir; gerçek VPS/health/kesim kanıtı ayrıca kaydedilir.
