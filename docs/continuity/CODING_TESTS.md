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
- Kural, yetki, RLS ve stok doğruluğu birim + entegrasyon testlerinde (hızlı, kapsam kaybı yok). **PR'da yalnız etkilenen int/e2e testleri koşar (kullanıcı kararı 22 Ekim, T-1022):** seçici `scripts/ci/affected.mjs` (korunan; CI'da TABANIN kopyasından koşar) içe aktarma grafiğiyle değişen dosyayı kullanan int testlerini ve web bölümünü (`app/t/[slug]/<bölüm>`) anan e2e spec'lerini seçer; hesaplanmış yolla içe aktaran/dosya okuyan int testleri ("joker") her kaynak değişikliğinde koşar. **Tam takım:** kalip/kabuk/layout/globals.css, `packages/db|auth|shared|ui|queue-adapter|storage`, `packages/domain/src/identity` (yetki/üyelik), migration, workflow, `package.json`/lockfile, playwright/vitest/tsconfig ayarı, compose/.env.example, deploy, silinen ya da eşlemesi olmayan dosya, seçici hatası. Ortak web dosyasına (kalip, api, ana ekran, worker…) dolaylı ulaşan değişiklik e2e'yi tam yapar (int grafikle kalır). DB/RLS değişikliği ilgisiz testleri kırabildiği için (T-919) `packages/db` ve migration her zaman tam takımdır. main ve int dallarına push **her zaman tam takım**; yayın kapısı main'in tam sonucunu ister (deploy-vps dokuz kapıya ek olarak o SHA'da main push `ci` koşusunun başarısını arar). Seçimin nedeni `changes` işinin günlüğündedir.
- Hız paralellikten gelir: `int` üç parçaya (`vitest --shard=k/3`), `e2e` iki proje grubu (masaüstü / mobil) × iki dilime (`playwright --shard=k/2`; dosyalar bölünmez, sıra korunur) — 4 makine (T-445); PR'da seçim küçükse parça sayısı da küçülür (int <15 dosya 1, <40 dosya 2; e2e <4 spec grup başına 1 dilim); her parça kendi ortamını kurar. Sabit adlı `int` / `e2e` toplayıcı işleri parçaların sonucunu raporlar. Önbellek: pnpm deposu (setup-node) ve Next derleme önbelleği (`actions/cache`). e2e parçaları digest ile sabit resmî Playwright imajında (`docker run --network host`, runner'ın Node 24/pnpm'i bağlı) koşar; tarayıcı/işletim sistemi bağımlılığı kurulmaz. `@playwright/test` yükseltilirse `ci.yml`'deki imaj etiketi + digest birlikte güncellenir (sürüm etiketten okunur) (eşleşmezse iş kırmızı). İmajda `psql` yok; fikstür `psql` çağrıları köprüyle compose postgres konteynerinde koşar (T-1020).
- Yalnız belge (`docs/**`, `*.md`) değişen PR'da int/e2e parçaları koşmaz (`changes` işi; `--no-renames`, belirsizlikte kod sayılır). main ve int dallarına push her zaman tam takım; yayın kapısı main sonucunu ister.
- e2e parçaları ayrı veritabanlarında koşar: bir parça diğerinin bıraktığı veriyi görmez; bir spec dosyası kendinden önceki dosyanın verisine dayanmamalı (dilim sınırı test sayısıyla kayabilir).
- Yayın (`deploy-vps`) yalnız `ci` tamamlanınca tetiklenir ve guards kapılarını ≤ 15 dk bekler; arka arkaya birleşmede eski SHA'nın imaj kurulumu (`build`) iptal edilir, main ilerlediyse eski SHA "SUPERSEDED" ile yeşil atlanır, çalışan yayın (`deploy`, migration dahil) asla iptal edilmez (T-445); guards sonradan yeniden koşturulup yeşile dönerse otomatik yayın olmaz — `workflow_dispatch mode=deploy` ile elle başlatılır.
- E2E yalnız kritik uçtan uca akışlar + ortak yerleşim taraması (telefon/tablet/masaüstü; taşma, kaydırma, örtme) içindir; her hata için ayrı e2e yazılmaz (B-60). Gerçek cihaz (iPhone Safari çubukları vb.) kontrolü kullanıcı/ekip tarafından.

Zorunlu check adları: **verify, infra, secrets, deps, int, e2e, check-all, test-ac, check-pilot**. Ayrı build/deploy/check işleri ürün CI veya canlı kabul yerine geçmez. Aynı exact SHA'nın son `github-actions` sonucunu doğrula; eski dal testi yeni birleşik SHA testi değildir.

Yasak: `skip/only/todo`, assertion/taban azaltma, boş yeşil adım, genel secret tarama kuralı kapatma. Mevcut karantina yalnız PROTOCOL şartlarıyla, bitiş tarihiyle; kapı AC'si karantinaya alınamaz. Sentetik secret istisnası exact fingerprint + gerçek onay/inceleme, genel yol kuralı değil.

Korunan dosyalarda ayrı küçük PR, gerçek güvenlik raporu ve SHA'ya bağlı onay kaydı; `docs/agents/PROTOCOL.md` otoritedir. İnceleme bağımsızlığı veya kapı eksikse merge yapılmaz. CI fail/skipped/unknown, başarı değildir; korumayı geçirene kadar gevşetme.

Rapor: incelenen SHA, test adı/komut/sonuç/gerçek sayı, atlanan/karantina, eksik cihaz/çevre, bulgu ve kanıt URL'si. “Bütün testler geçti” ifadesi kapsamı belirtmeden kullanılmaz.

## Sık hatalar — tekrarlanmasın (T-1083, kullanıcı 27 Ekim: "sorunsuz geçen bir iş görmedim")
Her iş bu listeyle başlar ve PR açmadan önce tek tek kontrol edilir. Yeni ders çıkarsa aynı PR'da buraya eklenir.

**Birleştirme ve numara**
- PR birleştirme **yalnız `merge`** (merge commit). Squash, G-08 bekçisini (`MAIN_DIRECT_PUSH`) kırar ve deploy-vps durur (27 Ekim, PR 204).
- Kart numarası iş başında alınır ve **hemen** uzak dala push edilerek sahiplenilir. Paralel oturumlar sırayla numara alır (27 Ekim'de T-1060 ve T-1063 iki kez çakıştı, PR iki kez yeniden açıldı). PR'dan önce `git ls-remote --heads origin`, açık PR başlıkları ve `docs/tasks/` yeniden taranır; çakışırsa boş, uzak bir numaraya geçilir.
- Birleştirmeden önce PR tabanı güncel mi (`mergeable_state`) bakılır; çakışma varsa main dala birleştirilir, prepush yeniden koşar.

**Ekran metni ve test**
- Görünen bir yazıyı, etiketi ya da öğeyi kaldırmadan/taşımadan önce **bütün** `tests/` altında o metni ve seçiciyi ara (`grep -rn "<metin>" tests apps/web --include=*.ts`). prepush yalnız değişen e2e spec'lerini koşar; dokunulmayan spec'teki eski beklenti CI'da kırılır (27 Ekim: `demo-flow` kilit açıklaması). Metin `aria-label`'a taşındıysa test `toHaveAttribute("aria-label", …)` ile güncellenir.
- Yeni bağlantı/düğme ≥ 44 px dokunma hedefi (`smallTouchTargets` bekçisi): satır içi `Link`'e `minHeight: 44` + blok düzen.
- Portal'a taşınan katman (perde, menü) `body` altına gider: testlerde ekran kabı içinden aranan seçiciler (`page.getByTestId(...)` kapsamı) güncellenir; kaydedilmemiş iş kutusu menü katmanının üstünde kalmalı (`.dzp.hmenu-kok` kuralı).
- `"use client"` modülünden sunucu bileşenine DEĞER (sabit, dizi) aktarılmaz; istemci referansı vekili gelir ve ekran çöker (T-1057). Ortak sabit `@wms/domain/...` ya da ayrı `*.ts` dosyasında.
- `"use server"` dosyası yalnız async fonksiyon dışa aktarır; sabitler `list-page.ts` gibi ayrı dosyada.
- Yeni eylem (server action) `ac-04-api-slug.int.test.ts` tablolarına eklenir; yoksa AC-04 kırmızı.

**Yerel ortam (bu konteyner)**
- Docker sık düşer: `(nohup dockerd --registry-mirror=https://mirror.gcr.io >/tmp/dockerd.log 2>&1 &)` sonra `docker compose up -d --wait`. e2e "db:migrate ECONNREFUSED" = compose kapalı.
- Boş kiracı hazırlığı (`global-setup` → MFA mağaza QR'ı) bu konteynerde düz main'de de kırılır; o spec'ler (empty-tenant, groups, excel-export, z-join-share…) yerelde koşmaz, CI'da koşar. Bu durum PR'da açıkça yazılır.
- Arka planda test koşarken aynı çalışma ağacında dosya düzenlenmez; düzenlendiyse prepush yeniden koşar.

**CI ve yayın**
- main CI'da ilgisiz bir spec kırılırsa: aynı spec önceki main SHA'da geçmiş mi bak, bir kez yeniden koştur; ikinci kırmızı gerçektir. Kırılgan test BACKLOG'a yazılır (ör. `zz-stock-documents` sayım depo seçimi).
- deploy-vps "ssh: connect … Connection timed out": kod değil sunucu erişimi; başarısız işi bir kez yeniden koştur. Yine olursa kullanıcıya VPS panelini sor.
- Yayın main CI bittikten sonra başlar (~10 dk CI + ~5 dk yayın); kullanıcıya süre bu toplamla verilir, birleşme anı "canlı" denmez.
