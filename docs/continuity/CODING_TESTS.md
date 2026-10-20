# Kodlama ve test kuralları

## Kodlama
- Node24, pnpm10.28.0 ve lockfile kaynak otoritesidir; `pnpm install --frozen-lockfile --ignore-scripts`. Sürüm/bağımlılık değişimi ayrı gerekçe ve ilgili korunan kapıyla.
- TypeScript/ESLint sınırları korunur; `any`, type suppression veya lint kapatma ile kural aşılmaz.
- HTTP/Server Action ince kalır; ortak domain komutuna yetkili context ile gider. UI stok/yetki hesabının otoritesi olmaz.
- Tenant context oturum + doğrulanmış üyelikten gelir. İstemcinin tenant/depo/ürün ID'si güvenilir kabul edilmez.
- Zod/ortak şemalarla giriş doğrulama; kullanıcı metni/HTML güven sınırında işlenir. Hata kodu kullanıcıya kısa çözüme çevrilir, stack/SQL/sır gösterilmez.
- Miktarlar decimal; idempotency her stok yazımında. Dış API veya yazıcı, stok transaction'ı içinde bloklayıcı çağrı yapmaz.
- TR/EN metinleri `apps/web/messages` sözleşmesinde; teknik durum müşteriye 1–3 kelimelik etiket + gerekirse kısa çözümle gösterilir.
- Next.js değişikliğinde `apps/web/AGENTS.md` + kurulu `next/dist/docs` ilgili bölümü. Ezber API ile değişiklik yapma.
- Görev kartı kapsamı ve çalışma ağacı korunur. Referans depoya yazı, force push, reset-hard veya ilgisiz toplu refactor yok.

## Test seviyeleri
| Risk | Gerekli kanıt |
|---|---|
| Saf dönüşüm/doğrulama | Anlamlı unit / property test |
| Auth/tenant/RLS/yetki | Bağımsız güvenlik + izolasyon entegrasyonu |
| Stok/kilit/idempotency/ters kayıt | Gerçek PG entegrasyonu; yarış, tekrar, negatif stok ve iki bacağın atomikliği |
| Migration | Defter/checksum; ileri/geçerli geri dönüş; dolu veride korunma/ret; izole restore |
| UI/form/kamera | Gerçek tarayıcı, klavye ve touch; mobil/tablet/masaüstü; hata ve boş durum |
| Yayın/TLS/erişim | Gerçek runner/SSH, doğru hedef, deep health; pozitif ve negatif sınır |
| Yalnız doküman | Yol/link, scope/docs/secret/diff kontrolleri; sırf tekrar için bütün ürün testlerini yerelde koşturma |

## Komutlar / zorunlu kapılar
```sh
pnpm verify
pnpm check:all
pnpm test:int
pnpm test:e2e
pnpm test:ac --ci
```
`test:ac` bayraksız yalnız mevcut fazı kapsar; geçmiş kapıları geçtiği iddia edilmez. Belge/test komutlarının gerçek argümanları `package.json` ve workflow otoritesidir.

Test dengesi (T-925, kullanıcı kararı 20 Ekim: hatasız + hızlı):
- Kural, yetki, RLS ve stok doğruluğu birim + entegrasyon testlerinde (hızlı, kapsam kaybı yok). Bu projede DB/RLS değişikliği ilgisiz test dosyalarını kırabildiği için (T-919: 6 dosya) kod değişen PR'da "yalnız ilgili test" seçimi yapılmaz; TAM takım koşar.
- Hız paralellikten gelir: `int` iki parçaya (`vitest --shard`), `e2e` iki proje grubuna (masaüstü / mobil) bölünür; her parça kendi ortamını kurar. Sabit adlı `int` / `e2e` toplayıcı işleri parçaların sonucunu raporlar.
- Yalnız belge (`docs/**`, `*.md`) değişen PR'da int/e2e parçaları koşmaz (`changes` işi; belirsizlikte kod sayılır). main ve int dallarına push her zaman tam takım; yayın kapısı main sonucunu ister.
- E2E yalnız kritik uçtan uca akışlar + ortak yerleşim taraması (telefon/tablet/masaüstü; taşma, kaydırma, örtme) içindir; her hata için ayrı e2e yazılmaz (B-60). Gerçek cihaz (iPhone Safari çubukları vb.) kontrolü kullanıcı/ekip tarafından.

Zorunlu check adları: **verify, infra, secrets, deps, int, e2e, check-all, test-ac, check-pilot**. Ayrı build/deploy/check işleri ürün CI veya canlı kabul yerine geçmez. Aynı exact SHA'nın son `github-actions` sonucunu doğrula; eski dal testi yeni birleşik SHA testi değildir.

Yasak: `skip/only/todo`, assertion/taban azaltma, boş yeşil adım, genel secret tarama kuralı kapatma. Mevcut karantina yalnız PROTOCOL şartlarıyla, bitiş tarihiyle; kapı AC'si karantinaya alınamaz. Sentetik secret istisnası exact fingerprint + gerçek onay/inceleme, genel yol kuralı değil.

Korunan dosyalarda ayrı küçük PR, gerçek güvenlik raporu ve SHA'ya bağlı onay kaydı; `docs/agents/PROTOCOL.md` otoritedir. İnceleme bağımsızlığı veya kapı eksikse merge yapılmaz. CI fail/skipped/unknown, başarı değildir; korumayı geçirene kadar gevşetme.

Rapor: incelenen SHA, test adı/komut/sonuç/gerçek sayı, atlanan/karantina, eksik cihaz/çevre, bulgu ve kanıt URL'si. “Bütün testler geçti” ifadesi kapsamı belirtmeden kullanılmaz.
