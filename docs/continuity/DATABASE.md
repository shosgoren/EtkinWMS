# Veri tabanı kuralları ve mimarı

Otorite: `docs/INVARIANTS.md`, `docs/spec/04-data-model.md`, `05-stock-engine.md`, `16-stock-effects.md`; gerçek DDL `packages/db/migrations`.

## Tenant ve rol sınırı
- Paylaşımlı PostgreSQL, tenant bazlı veri izolasyonu. Kimlik kullanıcısı ile tenant üyeliği farklı varlıklardır.
- Context sunucuda doğrulanmış üyelikten; `withTenant` transaction-local `set_config(...,true)` ile. Context eksikse ret; bağlantı havuzunda önceki tenant context'i sızmaz.
- `wms_app`: uygulama tenant verisi; `wms_auth`: platform kimlik/oturum; `wms_worker`: işçi/kuyruk. Runtime NOSUPERUSER/NOBYPASSRLS/NOCREATE; tablo/fonksiyon sahipliği operatör ve dar NOLOGIN rollerde.
- Uygulama izinleri kodda tek kaynak (`packages/domain/src/identity/permissions.ts`: rol × izin A-45, gruba verilebilen kapalı liste `GRANTABLE` = `0051` CHECK). T-1141: kart yazmaları bölüm × işlem anahtarı (`items|parties|warehouses|locations` · `create|edit|archive`) ister; rollerde yalnız TENANT_ADMIN, gruba verilemez (CHECK değişmedi). Gruba açmak migration ile CHECK genişletmesi ister (T-1142).
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

## T946–950: geliştirme şeması0035, canlı kabulü ayrı
- Tek shared package_movement_steps sırası/predecessor uniq; WAREHOUSE_TRANSFER target IN ve source OUT gerçek FK, iki POSTED belge/TRANSFERlink/exact±fullqty. Kaynak ve hedef depo farklı, hedef STORAGE; originwarehouse/lot/unitfactor immutable.
- Currentwarehouse terminalstep+pozitifbalance ile doğrulanır; originwarehouse hareket/yetki kaynağı değildir. QC/putaway hedefdepoda çalışır. Generic mapped ledger/reversal ve kayıt değişimi ret; legacyNULLHU korunur.
- Boşdown exact0034 function/ACL/RLS oracle; transferverisi varsa down silmeden ret. Schema owner/foreign/RLS ve ters iki gerçekRR winner bağımsız154/authorgap156PASS; canonicalcommand+rollback27PASS. Tam güvenlik/CI/VPS schema35 sonucu henüz bekler.

## Platform katmanı (0038–0047, 17 Ekim'de canlı)
- `wms_platform` şeması tenant verisi değildir: demo talepleri (0038), deneme aboneliği/aktivasyon (0039), paketler ve sürümleri (0041),
  tahakkuklar (0043), satış sayfası içerik sürümleri ve önizleme özetleri (0046). Uygulama rollerinin bu tablolara yetkisi yoktur; okuma/yazma
  yalnız `wms_probe.platform_*` SECURITY DEFINER işlevleriyle (sahip `wms_identity_probe`, `search_path` sabit, PUBLIC EXECUTE yok, operatör
  denetimi `platform_is_operator`).
- Paket sınırları (0041) tenant tablolarında BEFORE tetikleyicisiyle uygulanır (`PLAN_LIMIT`, 0 = sınırsız, paketsiz tenant sınırsız).
- Müşteri sayımları (0042) probe'a yalnız sayım sütunlarında okuma verir; içerik okunmaz. İşlem kaydı (0047) `security_events` `platform.*`
  olaylarından, probe'a sütun düzeyinde okuma (ip/user_agent/request_id yok).
- Saha girişi (0044) ve ortak cihazlar (0045): `field_logins`, `field_devices`, `field_enrollments` (tenant), `field_sessions`,
  `field_device_lockouts` (platform); işlevler `wms_probe.field_*`.
- Son kullanılan alan (0048, T-999): `tenant_memberships.last_used_at`; `wms_app` yalnız bu sütunu yazar (tenant bağlamı + kendi satırı,
  tenant kabuğu); okuma `getMembershipSummary` (kendi satırları). Yetki kararına girmez, yalnız açılış yönlendirmesi.
  Kişisel veri: üye listesi, denetim/dışa aktarım ve panel ekranlarına konmaz.
- Görev ayrılığı (0049, T-416): `tenant_settings.separation_of_duties` (varsayılan false); `wms_app` yalnız bu sütunu yazar; kural domain
  komutlarında (onay, sayım onayı, ters kayıt), DB tetikleyicisi yok.
- Yayınlanmış satış içeriği ve ödenmiş tahakkuk tetikleyiciyle değişmez. Veri kaybettiren down migration'lar dolu veride
  `allow_destructive_down` olmadan reddeder.
- 0053 (T-919): `wms_app` `security_events`'ten yalnız `id` okur (içerik yok); MFA kefaleti `wms_probe.credentials_changed_since`
  (evet/hayır, yalnız geçerli tenant üyesi, bağlam yoksa fail-closed). Ekibe katılma onayı DB'de kod doğrulamasına bağlı:
  `field_join_verify` damga basar (yalnız probe yazar), `team_join_requests_transition_guard` (ENABLE ALWAYS) geçişleri ve sunucu
  tarafı `decided_*`'ı zorlar. Down yalnız kısa ömürlü doğrulama damgasını siler.
- 0054 (T-967, B-84; kaynakta, canlı değil): `support_tickets` + `support_ticket_messages` tenant tablolarıdır (ENABLE + FORCE RLS, TO'suz
  izolasyon). Ek RESTRICTIVE TO wms_app politika: üye yalnız kendi talebini, TENANT_ADMIN firmanın tümünü görür (mesaj görünürlüğü talepten
  türer); AC-04 matrisi bu iki tabloda A sahibinin kimliğiyle koşar (`USER_SCOPED_TABLES`, katalogla birebir). Tetikleyiciler: sunucu alanları,
  yalnız ANSWERED → OPEN müşteri geçişi, okundu damgası, append-only yazışma, kapalı talebe yazma reddi (55000), hız sınırı 10 dk'da 5 talep /
  20 yanıt (`P0429`), demo/ACTIVE olmayan tenant reddi. Operatör yalnız `wms_probe.platform_support_*` (SECDEF, yalnız wms_app EXECUTE,
  `platform_is_operator`; probe'a tenant politikası yok, bağlam işlevde kurulup geri yüklenir); denetim `security_events` `platform.support.*`.
  Kısa numara küresel kimlik sütunu. Down dolu veride `allow_destructive_down` olmadan reddeder. Ekran görüntüsü eki yok (sonraki tur).
- 0055 (T-991; kaynakta, canlı değil): ERP entegrasyonu — `integrations` (sağlayıcı başına tek bağlantı; `credentials` yalnız mühürlü kutu
  {v,kid,iv,tag,ct}, CHECK; DISCONNECTED ⇔ NULL; parola saklanmaz), `integration_flows` (aç/kapa, yön; CHECK: STOCK/SHIPMENTS yalnız PUSH,
  SALES_ORDERS yalnız PULL — I-04; `enabled_at` tetikleyicide), `integration_runs` (biten koşu değişmez, 55000), `integration_outbox` (irsaliye;
  belge başına tekil; SENT değişmez; belirsiz sonuç CHECK — kör yeniden gönderim yok), `integration_stock_marks` (son gönderilen stok toplamı;
  stok kaynağı değil). Eşleme 0019 `external_refs` (`system = PARASUT`). Hepsi ENABLE + FORCE RLS, TO'suz izolasyon, wms_app sütun düzeyi
  INSERT/UPDATE, DELETE yok. Down dolu veride `allow_destructive_down` olmadan reddeder. Ayrıntı: [T-991](../changes/T-991.md).
- **0056 (T-1006):** `setup_journeys` (tenant başına tek satır: atlanan adımlar CHECK listesi, üretim cevabı, kart kaynağı, Excel açılış stoku isteği, etiket basıldı bir kez, kutlama kapatıldı; ENABLE + FORCE RLS, DELETE yok) ve `integrations.opening_stock_enabled` (varsayılan kapalı) + `opening_stock_taken_at` / `opening_stock_document_id` (birlikte dolar, bir kez; tetikleyici 55000 ile değişmez, ayar kapalıyken ve POSTED STOCK_IN olmadan yazılamaz; tenant başına tekil indeks). ERP'den stok yalnız bu bir kezlik açılış yolunda, domain stok komutuyla (`integrations/opening-stock.ts`). Ayrıntı: [T-1006](../changes/T-1006.md).

## T-1129 — ürün sabit alanları (0065, B-188)
- `items.base_unit_id`/`tracking_mode`/`quantity_scale` yalnız hiç kullanılmamış üründe değişir; tek tanım `public.item_fixed_usage(tenant, item)` (domain `updateItem`/`getItemFixedState` ve tetikleyici aynı fonksiyonu çağırır). Bağlı sistemden gelen üründe temel birim ayrıca kilitli. Yeni ürüne bağlı tablo eklenirse bu fonksiyona da eklenir (birim testi kod listesini migration'la karşılaştırır).
- Kilit: değişiklik ürün satırını FOR UPDATE alır (FK KEY SHARE tutan açık eklemeleri bekler); boyut tetikleyicisi takip modunu FOR KEY SHARE okur. 0013'teki `LOCK TABLE stock_dimensions IN SHARE MODE` kalktı (tenant'lar arası bekleme yok). Sınır: temel birim/ölçek için ürünü kilitsiz okuyup sonra satır yazan yollar bayat değer yazabilir (belge satırı birimi katalogla DB'de doğrulanmıyor; BACKLOG maddesi). Ürüne FK veren yeni tablo `item_fixed_usage`'a eklenmezse int kapsam bekçisi kırılır.

## T-1135 — Paraşüt akış kilitleri (0066)
- `integration_flows_exclusive_guard`: aynı bağlantıda STOCK ve SHIPMENTS birlikte açılamaz (yalnız kapalı → açık geçişinde; karşı satır FOR KEY SHARE); STOCK yalnız `integration_stock_push_ready` doğruysa (Devir: `integrations.opening_stock_taken_at` ya da işlenmiş `import.opening_stock`/`integration.opening_stock` STOCK_IN). Mevcut ikisi-açık bağlantıda migration STOCK'u kapatıp `integration.flow_changed` (via `migration_0066`) yazdı.
- `integration_flows.first_enabled_at`: ilk açılış anı, kapat/aç sıfırlamaz (irsaliye keşfi alt sınırı; işlenme anı `document_status_history`'den).
- `integration_stock_marks`: `quantity`/`sent_at` NULL olabilir; `failed_quantity`/`failed_at`/`last_error_code` kesin 4xx kaydı (aynı toplam yeniden denenmez); `as_of_snapshot` son başarılı toplamın okuma görüntüsü (irsaliye keşfi stok toplamına girmiş belgeyi çift başına `pg_visible_in_snapshot` ile ayıklar). Akış tetikleyicisi önce `integrations` satırını FOR UPDATE kilitler (eşzamanlı iki açma seri). `integration_runs` RUNNING silmesi yalnız taze, sayaçsız, hatasız SCHEDULE satırı.
- `integration_runs`: wms_app DELETE (yalnız bu tablo) + `integration_runs_delete_guard` (yalnız RUNNING ya da 7 günden eski biten satır). `integration_outbox` kart akışlarına açık (PRODUCTS/ITEM, CONTACTS/PARTY, WAREHOUSES/WAREHOUSE; "dış kayıt başka karta bağlı" kalıcı FAILED). Down veri kaybettirecekse `allow_destructive_down` ister; STOCK kapatma ve audit geri alınmaz.

## T-1139 — eski Paraşüt yöntemi bağlantılarının kesilmesi (0068, yalnız veri)
- Şema/yetki/politika değişmez. Seçici (tek tanım, migration dosyasında; T-1137 ekran işaretiyle aynı): `provider='PARASUT'`, `status<>'DISCONNECTED'` ve aynı tenant'ta `connected_at`'i önceleyen 1 saat içinde `phase='COMPLETE'` OAuth denemesi YOK. OAuth bağlantısında deneme bağlantı satırıyla aynı transaction'da COMPLETE olur, en çok 10 dk yaşar ve wms_app silemez → OAuth bağlantısı (ortak ya da kendi uygulaması) seçiciye girmez (int testi gerçek domain akışıyla kanıtlar).
- Seçilen satır: `status='DISCONNECTED'`, `credentials=NULL` (0055 CHECK), `last_error_code='LEGACY_METHOD_REMOVED'`, webhook durumu OFF; `integration_webhooks` ACTIVE → DELETED + `key_box=NULL`; 0068 `connected_at`/`account_ref`/akışlara dokunmaz; OAuth ile yeniden bağlanınca UPSERT `connected_at`'i now() yapar, akış satırları ve `account_ref` korunur (önceki `connected_at` dolu olduğundan ilk bağlantı varsayılanı yeniden uygulanmaz; eşleme varken şirket değişimi reddedilir). Bağlantı başına `integration.disconnected` audit (`via: migration_0068`, actor NULL; I-12). Ürün/cari/depo/stok/belge/eşleme/kuyruk dokunulmaz.
- Down bilerek no-op (silinen kimlik geri getirilemez); up yeniden uygulanınca kesik satırları seçmez (yeni audit yok). Kod tarafında yeni parola bağlantısı kurulamaz (yol kaldırıldı), küme donmuştur.
