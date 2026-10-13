# Veri tabanı kuralları ve mimarı

Otorite: `docs/INVARIANTS.md`, `docs/spec/04-data-model.md`, `05-stock-engine.md`, `16-stock-effects.md`; gerçek DDL `packages/db/migrations`.

## Tenant ve rol sınırı
- Paylaşımlı PostgreSQL, tenant bazlı veri izolasyonu. Kimlik kullanıcısı ile tenant üyeliği farklı varlıklardır.
- Context sunucuda doğrulanmış üyelikten; `withTenant` transaction-local `set_config(...,true)` ile. Context eksikse ret; bağlantı havuzunda önceki tenant context'i sızmaz.
- `wms_app`: uygulama tenant verisi; `wms_auth`: platform kimlik/oturum; `wms_worker`: işçi/kuyruk. Runtime NOSUPERUSER/NOBYPASSRLS/NOCREATE; tablo/fonksiyon sahipliği operatör ve dar NOLOGIN rollerde.
- DB mimarı migration/RLS/yetki/kilit modelini tasarlar; frontend kolaylığı için grant, owner veya bypass genişletmez.
- Migration/proof/backup bağlantısı runtime env'den ayrı; operatör rolünün yetkisi uygulamaya verilmez.

## Stok doğruluğu
| Kural | Uygulama |
|---|---|
| I-04 | append-only stock_ledger kaynak; balances ve reservations aynı komut transaction'ında |
| I-05 | varsayılan negatif stok ret; istisna politika + özel yetki + gerekçe/audit |
| I-06 | kalıcı idempotency: aynı anahtar/farklı payload ret, tekrar önceki sonuç |
| I-07 | olay aynı transaction'da outbox; relay/tüketici tek etki; kuyruk stok kaynağı değil |
| I-08 | işlenmiş belge silinmez; kontrollü ters kayıt; bağlı işlemler ve kalan miktar |
| I-09 | decimal, belgeye kopyalanmış dönüşüm; float/yuvarlama ile stok üretme yok |
| I-15 | acquireStockLocks ve tam kilit planı; belge→sayım→bakiye→rezervasyon→seri, sıralı anahtar |
| I-16 | sequence/ID commit sırası değil; snapshot/cursor açık doğru görünürlükle |

Transferin giriş/çıkış bacakları, üretimin hammadde tüketimi/mamul çıktısı atomik olmalı. Reçete kullanılan belgeye sabitlenir; sonradan kart değişimi eski üretim miktarını değiştirmez. Fiş, miktar, rol ve audit ilişkileri DB kısıtlarıyla da korunur.

## Migration ve defter
- Çift `.up.sql`/`.down.sql`, ardışık sürüm; birleştirilmiş migration yeniden yazılmaz.
- `wms_meta.schema_migrations`: version/name/checksum_sha256/applied_at/applied_by. Kaynak dosya çifti checksum'u DB defteriyle birebir.
- Migration doğrudan tek host bağlantısı ve migration rolüyle; pooler veya runtime rolüyle değil.
- `db:migrate`/`db:rollback` gerçek script ve `packages/db/src/migrate.ts` sözleşmesi okunur; flag tahmin etme.
- İleri + verili geri dönüş/ret + gerçek backup restore kanıtı. Bağlı veri varsa down'un reddi doğru davranış olabilir; “rollback geçti” diye veri silme yok.

13 Ekim 10:00 readonly snapshot: canlı31, kaynak31. 0028 belge stok bağları,0029 reçeteler,0030 reçete mühürü,0031 kart türü/standart birimler. Kaynak31 olması canlı31 kanıtı değildir. Eski guided imaj, yeni bağlı belge/üretim verisi sonrasında güvenli fallback sayılmaz.

## VPS / TLS farkı
DB `etkinwms-postgres:5432/etkinwms`, Docker özel ağ, public host portu yok. PostgreSQL18 ayrı kalıcı volume. Node runtime URL yalnız `sslmode=verify-full`; CA `NODE_EXTRA_CA_CERTS=/run/etkinwms-db-ca.crt`. postgres.js URL'ye libpq `sslrootcert` dosya parametresi ekleme. psql/pg_dump ayrı `PGSSLMODE=verify-full` + `PGSSLROOTCERT` kullanır.

Server cert/key/HBA tekil ro mount; CA özel anahtarı mount dışında. TCP TLS+SCRAM; plaintext ret. Unix socket yalnız postgres peer; operatör `docker exec --user postgres`. Neon'sağlayıcı rol/default ACL'leri yeni VPS'ye kör kopyalanmaz; uygulama ACL/RLS/owner ve schema paritesi ayrıca kanıtlanır.

Kart türleri HM/YM/MM/TM ve standart birimler kaynak0031'de; Motive verisini örnek veya demo verisiyle overwrite etme. Yeni tenant/user açmadan mevcut kimlik/üyelik varlığını doğru DB'de metadata ile kontrol et.
