# İlk sahip kurulumu — T-909

Bu araç yalnız **yeni** kullanıcı ve yeni tenant içindir. Public signup açmaz, mevcut hesabı/tenantı devralmaz, parola almaz, migration çalıştırmaz. İşletmeci yetkili CLI çalıştırır; sahibi mevcut HTTPS `/reset-password` ekranında kendi parolasını belirler. MFA kapıları değişmez. E-posta gönderilmez; bağlantı teslimi ayrı onaylı operatör işidir. Kod/test hazırlığı canlı apply onayı değildir.

## Sabit sınırlar ve hedef doğrulaması

- Yalnız schema27 kaynak ağacından build edilir; 0001–0027 up+NUL+down SHA256 defteri pakete gömülür. PG18 ve defterin her sürüm/ad/checksum değeri eşleşmelidir; schema30 reddedilir.
- `DATABASE_URL`: wms_app; `AUTH_DATABASE_URL`: wms_auth. Her ikisinin gerçek DB adı/rolü/PG18 sürümü ve NOSUPERUSER/NOBYPASSRLS niteliği kontrol edilir.
- `INITIAL_OWNER_PROOF_DATABASE_URL`: mevcut yetkili operatörün aynı DB'ye bağlantısı. Yalnız sabit READ ONLY transaction içindeki SELECT'ler için kullanılır: metadata/defter, tam görünür mevcut email/slug önkontrolü. wms_meta uygulama rollerine yasak olduğundan bu üçüncü bağlantı gerekir. Yeni rol/grant/BYPASSRLS ayarı oluşturulmaz. Tam görünürlük için mevcut owner/superuser yetkisi yoksa araç durur.
- Üç URI da açık port ve yalnız `sslmode=verify-full` parametresi kullanır. Başka query seçenekleri/fragment reddedilir. VPS CA'sı Node'un güvenilir CA deposunda veya operatörün mevcut `NODE_EXTRA_CA_CERTS` dosyasında olmalıdır; TLS doğrulaması kapatılmaz.
- `WMS_ENV=production|staging`, `SIGNUP_ENABLED=false`, `AUTH_REQUIRE_EMAIL_VERIFICATION=false`, `MAIL_MODE=disabled` açıkça verilmelidir. Araç bayrakları değiştirmez. Email verification true/belirsizse durur; emailVerified false kalır, e-posta sahipliği kanıtlanmış sayılmaz.
- Operatör app/auth/proof hostlarının gerçekten aynı yeni VPS DB'ye ulaştığını bağımsız doğrulamalıdır. Aynı DB adı tek başına aynı sunucu kanıtı değildir. Neon veya başka DB'ye eski URI kullanılmaz. Migration/başka bootstrap ile eşzamanlı çalıştırılmaz.

## Paketleme ve kapalı smoke

Node24 ve kilitli bağımlılıkları kurulu exact incelenmiş kaynakta:

```sh
node scripts/build-initial-owner.mjs
node --check .artifacts/initial-owner/initial-owner.mjs
```

Çıktı `.artifacts/initial-owner/initial-owner.mjs` ve `node_modules/@node-rs/*` yerel Argon2 bileşenleridir. Build ağdan paket kurmaz. Kaynak/operatör makine mimarisi, libc ve Node24 uyumlu olmalıdır. Bundle tek başına taşınmaz; node_modules kardeş diziniyle, hashleri doğrulanarak teslim edilir. Kaynakta doğrudan CLI çalıştırılması gömülü defter boş olduğundan apply için desteklenmez. Ürün imajı, Dockerfile veya sunucu helper'ı değiştirilmez.

## Özel operatör dizini

Operatör yalnız VPS üzerinde root-owned0700 bir dizin oluşturur. Bu dizinde root-owned0600 `plan.json` hazırlanır; kullanıcı/target alanları yerel somut onayla doğrulanır. Yeni rastgele UUID'ler `userId` ve `requestId` içindir. Onaydan sonra dosya değişmez.

```json
{
  "plan": {
    "userId": "<new UUID>",
    "requestId": "<new UUID>",
    "email": "<approved lowercase email>",
    "userName": "<approved name>",
    "slug": "<approved new slug>",
    "tenantName": "<approved tenant name>",
    "operator": "<actual operator/change authorization reference>"
  },
  "target": {
    "appHost": "<verified VPS DB host:port>",
    "authHost": "<verified VPS DB host:port>",
    "proofHost": "<verified VPS DB host:port>",
    "proofRole": "<existing operator DB role>",
    "database": "<verified database>",
    "baseUrl": "https://<verified WMS host>"
  }
}
```

Bağlantı URI'leri ve BETTER_AUTH_SECRET yalnız VPS0600 env dosyasında; plan/komut satırı/Cloud/PR/log içine konmaz. node `--env-file` kullanımı mevcut operatör dosyasını yükler. Ortamın `PG*`/Node ayarları operatör tarafından kontrol edilmelidir. Docker içinden çalıştırılırsa yalnız doğrulanmış özel DB ağı, onaylı Node24 imajı ve gerekli özel dosya mountları kullanılır; bu belge ağ/erişim kurmaz.

```sh
node --env-file=/root/private/enrollment.env /root/tools/initial-owner/initial-owner.mjs --directory /root/private/enrollment
```

Varsayılan salt okunur kontrol başarılıysa `PRECHECK_OK_NO_WRITES` döner. Kontrol sonucu canlı kurulumu veya kullanıcı girişini kanıtlamaz. Tam hedef ve private-file delivery yetkisi onaylandıktan sonra aynı komuta `--apply` eklenir. Başarı çıktısı yalnız `ENROLLMENT_LINK_WRITTEN_PRIVATE` olur. Sıfırlama bağlantısı **yalnız** exclusive0600 `enrollment-link.txt` dosyasına yazılır; çıktıya/token günlüğüne yazılmaz. Dosyayı `cat`, CI artifact veya sohbetle aktarmayın. Yetkili güvenli teslim kanalını kullanın. Link15dk geçerli, tek kullanımlıktır. Tüketimden sonra giriş ve MFA kurulumu sahibi tarafından doğrulanmalıdır.

## Ayrı transaction ve kesinti davranışı

Auth kullanıcısı ile tenant aynı transaction değildir. Tenant+owner+TENANT_ADMIN+GENERIC_V1 ayarları+`tenant.created` audit tek transaction'dadır. Audit aktörü yeni kullanıcı gibi gösterilmez: actor=null, operatör/change referansı reason/summary'dedir. GENERIC_V1 iki gerçek onboarding adımını içerir; stok veya depo verisi yaratılmaz.

- Root0700 dizin, root0600 dosya, symlink/hardlink/overwrite kontrolleri vardır. Lock ve journal/link yazımları fsync edilir. Aynı dizinde eşzamanlı çalıştırma reddedilir; başka dizindeki yarış DB user/slug unique constraints ile kapanır.
- İlk apply exclusive `journal.jsonl` oluşturur: exact plan fingerprint ve planlanan user/request kimlikleri. Sonra user-ready, tenant-ready, token-started, complete checkpointleri eklenir; token journal'a girmez.
- Normal başarısızlıkta lock kaldırılır. Süreç çöküp lock kalırsa **otomatik silinmez**; operatör süreç kalmadığını ve journal tutarlılığını doğrulamadan müdahale etmez.
- Yalnız token-started ÖNCESİ, aynı değişmemiş özel journal ve `--apply --resume` ile devam desteklenir. Mevcut hesap yalnız journal'ın planladığı exact userId/email/name, credentialsız/oturumsuz/MFA'sız durumdaysa kabul edilir. Rastgele orphan hesap sahiplenilmez veya silinmez.
- Slug yarışı veya tenant transaction hatası credentialsız auth hesabı bırakabilir. Ret her zaman “sıfır yazı” anlamına gelmez. Kayıtlar korunur; farklı slug/kimlikle kör retry yapılmaz. Ayrı incelenmiş operatör recovery gerekir.
- Token-started sonrası crash/replay/yeniden üretim fail-closed'dur. Issue ile filewrite arasındaki crash'te teslim edilmemiş token en geç15dk içinde biter. Sonraki apply otomatik token yenilemez.
- Link yazımı veya son journal checkpoint hatası token revoke dener. DB erişimi de kaybolursa iptal garantisi verilemez; teslim durur ve15dk expiry beklenir. Yarım/iptal edilmiş private dosya başarı sayılmaz, otomatik overwrite yapılmaz.

Zorunlu kabul: exact kaynak incelemesi, sentetik schema27 adapter/reset/MFA testleri, yanlış schema/TLS/target reddi ve özel dosya testleri. Ardından operatörün canlı read-only hedef kanıtı ve ayrı apply/teslim onayı. Hazır kullanıcı/başarılı MFA iddiası yalnız canlı kullanıcı doğrulamasıyla yapılır.
