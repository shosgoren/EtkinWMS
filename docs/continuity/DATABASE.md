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

## Tekil fiziksel paket — T-931 hedef sözleşmesi
- Ürün barkodu, lot, ürün seri numarası ve fiziksel paket kimliği farklıdır. KG varili SERIAL miktar=1 olarak modellenmez. Mevcut stock_dimensions.handling_unit_id fiziksel paket bakiyesi için kullanılır; ayrı değişebilir toplam stok tablosu kaynak olmaz.
- 0032 kaynak şemasında HU türleri KOLI/PALET/VARIL; canlı0031 kanıtı bu yeni şemanın uygulandığı anlamına gelmez. field-posting şu an HU taşımıyor; receiveGoods takipli ürünleri reddediyor. Ürün/lokasyon etiket kaynağı paket etiketi değildir.
- Tasarım: scope/idempotency denetlenmiş komutta paketler+lot+HU'lu stok belgesi DRAFT aynı transaction'da oluşur (stok yok). Ardından tam belge/boyut kilit planıyla posting tüm paketlerin defter/bakiye/receipt durumunu atomik işler. plan içinde INSERT veya stok kilidi sonrasında yeni boyut ekleme yok.
- POSTED olmadan kabul başarılı/etiket hazır gösterilmez; kesilen bağlantı aynı anahtarla aynı taslağı ve kimlikleri döndürür. Baskı iptali stok tekrar yazmaz; yeniden etiket aynı QR. Boşalan paket kimliği yeniden kullanılmaz.
- Lot üretim/SKT paket kabulüne sabitlenir; çelişkili mevcut lot tarihi sessiz değiştirilmez. Paket ve lot üyeliği tenant+ürün bileşik FK ile korunur. Tam/kısmi tüketim, bölme/birleştirme ve üretim çıktı soy ağacı sonraki dilimlerde ayrıca test edilir.
- Tek fiziksel paket iki konuma aynı anda taşınmaz: normal transfer kalan içeriğin tamamıdır. Bölerek başka kaba aktarma ayrı çocuk kimliği ve kaynak/çıktı defter bağlantısı ister; üretimde kısmi tüketim aynı kaynak QR'nin kalan miktarını azaltır.
- Eski kimliksiz stok otomatik varillere dağıtılmaz; sayımla doğrulanmış, defteri koruyan dönüşüm ayrı kontrollü işlem olur. Palet konteyneri alt paket kimliklerini silmez.
- Bu bölüm HEDEF'tir. T-931 ilk dilim yalnız saf girdi/QR sözleşmesi; migration, server komutu, UI ve canlı kabul henüz yok.

## T-932 kaynak şeması — canlı kabul kanıtı değildir
- `0032_receipt_packages` kabul başlığını tek tenant-scoped `package_document_id` ile origin belgeye bağlar. Paket id mevcut HU id'sidir; FK olmadan otomatik UUID geçerli paket oluşturamaz. Miktar kopyalanmaz: origin document line otoritedir.
- Deferred guards receipt/header/line/source/item/unit/factor/HU/location/status zincirini, pending sıfır stok/counter ve POSTED tam miktar+CLOSED koşullarını doğrular. Paket metadata ve origin içerik DRAFT dahil değişmez; runtime yalnız SELECT ve dar INSERT alır.
- LOT snapshot `catalog_lot_id` ve NULL elemanlarını koruyan generated `date[]` composite FK ile kataloğa bağlanır. FK'nin kendi anahtar kilidi tarih UPDATE/INSERT yarışını korur; yeni manuel/advisory kilit yoktur. NONE üründe fiziksel lot/tarih snapshot'ı katalog lotu üretmeden korunur.
- INBOUND kaynaklı belge INSERT anında gerçek aynı-tenant receipt görmelidir; binding varsa yalnız origin id kabul edilir. Binding NULL dahil sonradan değişemez; böylece görünmeyen yeni/concurrent parent source olamaz. Gerçek legacy receipt birden fazla kısmi giriş ve QC MOVE kaynağı olmaya devam eder.
- İlk dilim mapped HU ledger'ında yalnız mühürlü origin STOCK_IN/line kabul edilir; generic MOVE/OUT/COUNT/RETURN/REVERSAL ret. Paket toplamı/origin sınırı ve tek pozitif konum ek tutarlılık kontrolüdür, concurrency kilidi yerine geçmez. Sonraki hareket kartı origin balance anchor ve mevcut `acquireStockLocks` planını taşımadan hareket açılmaz; RR altında değişmeden kalan sıfır anchor kilidi tek başına yeterli değildir, ortak gerçek version write/CAS veya onaylı kilit sözleşmesi gerekir.
- Boş0032→0031 rollback desteklenir; paket, binding veya VARIL verisi varsa down veriyi silmeden reddeder. Komut/UI/baskı bu migration ile bağlanmış sayılmaz; T933/T934 ve bağımsız inceleme beklenir.

## T-933 kaynak komutları — inceleme/yayın bekler
- `operations/package-receiving.ts`: `preparePackageReceipt` document.create ile tek kalıcı DRAFT origin belge, paket başına receipt line/document line/HU ve immutable metadata yaratır; `postPackageReceipt` stock.post ile mevcut `buildPostCommand.plan` ve posting çekirdeğini kullanıp receipt counters+CLOSED+iki audit+son POSTED numarasını tek transaction'da tamamlar. Motor/locking/idempotency whitelist değişmedi.
- Canonical equal/explicit fiziksel satırlar aynı hash'i verir; requestId, UUID, katsayı/temel miktar ve tenant istemciden özete alınmaz. Kaynak warehouse/RECEIVING location/item/unit/conversion/QC apply'da doğrulanır; SERIAL/LOT_AND_SERIAL, hasar/iptal/client server-field injection ret.
- LOT aynı item/code kaydını tam tarih snapshot'ıyla kullanır, belirtilen tarih çelişkisini reddeder; NONE fiziksel metadata saklar ama katalog lotu yaratmaz. Immediate generated-date FK kilidi receipt numarasından önce metadata INSERT ile alınır; receipt/origin ebeveyn FK'ları deferred tamamlanır. Sistem type-version düz SELECT mevcut field-posting sözleşmesidir; runtime UPDATE grant/manual lock eklenmedi. Receipt önce, source document sonra INSERT edilir.
- `package-receiving-queries.ts` stock.view ve warehouse görünürlüğüyle salt metadata döndürür; versioned QR önce decode edilir, sonra aynı yetkili tenant DB sorgusu yapılır. DRAFT metadata stok/etiket hazır kabulü değildir.
- İlk dilimde immutable taslak edit/cancellation, generic paket movement/reversal, etiket/baskı ve UI yoktur; T932 guard legacy receive/generic post bypass'ını reddeder. Kod, bağımsız paket incelemesi, CI ve gerçek canlı0032 defteri ayrı doğrulamalardır.

## T-934 oluşturma anında HU/kabul bağı
- Yeni paket HU `package_receipt_id` marker'ını yalnız INSERT sırasında alır; legacyNULL kimlik sonradan pakete çevrilemez. UPDATE grant yoktur; owner dahil marker upgrade/removal/replacement trigger tarafından reddedilir.
- Paket `(tenant_id,id,receipt_id)` anahtarı HU'nun aynı constructor key'ine immediate FK ile bağlıdır; reciprocal deferred HU→paket FK marker'ın metadata olmadan commit edilmesini engeller. LegacyNULL HU ilişki dışında kalır, eski stok akışı korunur.
- T933 yeni kimlik üretimi aynı receiptId marker'ını HU INSERT'ine taşır. HU→metadata→receipt→origin sırası ve lot FK iç kilidinin receipt numarasından önce alınması korunur; motor/kilit/whitelist değişmez. Bu geliştirme0032 düzeltmesi bağımsız exact paket incelemesi ve tam kapılar öncesinde canlı uygulanmış sayılmaz.

- T934 paket tutarlılık denetimi satır başına ayrı SQL döngüsü yerine MATERIALIZED package_lines→origins ve ayrı ledger/balance aggregates kullanır; callback sayısı, kilitler, RLS ve hata kategorileri korunur. Ledger/balance birleşmeden önce hesaplanır, toplam çarpılmaz; NULL/wrong HU ve missing ledger negatifleri korunur. Son yerel200 prepare6.688s/post14.543s (önce30.706/46.353s);5paket37/34ms, ortam ölçümüdür/SLA değildir. Son exact CI/canlı kanıtı STATE'den ayrı doğrulanır.

## T939 — geliştirme performans onarımı, canlı kanıtı değil
Main69d 200paket outer30sFAIL (2028/2029); PR yeşilleri bu sonucu silmez. Yeni0033 yalnız aynı invoker assert fonksiyonunu scalar flags + kimlik-filtreli LATERAL OFFSET0 planıyla değiştirir; bütün callbacks/altı hata/NULL-HU/kapsam/ayrıledger-balance kontrolü korunur. LIMIT/GUC/cache/SECDEF/timeout değişimi yok; down exact0032 bodyyi veri silmeden geri yükler.
Fresh82/82PASS; 200prepare1730.1/post6739.9ms, tamsemantic/replay10092ms. Seeded32→33→32→33 owner/ACL/search_path/RLS/veri aynı PASS. Gerçek plan id-indexseek göstermiyor; bu iddia yapılmaz. Kaynak frozen; bağımsızreview/CI/yayın ayrı kapılardır, canlısonşema31.
