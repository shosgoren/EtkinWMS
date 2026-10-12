# Etkin WMS

Sektör bağımsız, firma bazlı depo ve stok yönetimi. Motive Rubber pilotu için ayrı uygulama ve ayrı veritabanı kullanılır.

## Kaynak

`shosgoren/2027-WMS-1` deposundan salt okunur bir çalışma kopyası alınarak kullanıcı, firma izolasyonu, stok defteri, kamera okuyucu ve etiket modülleri yeniden kullanıldı. Kaynak depo ve mevcut bulut kaynakları değiştirilmez. Bu deponun kaynakları ve yayınları bağımsızdır.

## Yerel kullanım

Node 24 ve pnpm 10.28.0. `.env.example` üzerinden `.env` hazırlayın; gerçek değerler Git'e alınmaz. Yerel compose proje adını ve portları başka projelerle çakışmayacak şekilde ayarlayın.

1. `pnpm install --frozen-lockfile --ignore-scripts`
2. `docker compose up -d --wait postgres pgbouncer mailpit`
3. `pnpm db:migrate`
4. `pnpm --filter @wms/web dev --port 3100`

Kimlik için ayrıca `BETTER_AUTH_SECRET` ve `BETTER_AUTH_URL` gereklidir. Kuyruk için `QUEUE_SEAL_KEY` rastgele 32 baytlık hex olmalıdır. Demo hesaplarının kurulumu için worker da çalışmalıdır. Demo yalnızca local/staging içindir; gerçek müşteri kurulumunun yerine geçmez.

## Kontroller

`pnpm verify` lint, tip ve birim testlerini çalıştırır. `pnpm test:int` geçici PostgreSQL üzerinde firma izolasyonu ve stok işlemlerini doğrular. `pnpm --filter @wms/web build` üretim paketini oluşturur. Testler geçmeden gerçek müşteri stokları bu sisteme taşınmaz.

## Etiket çıktısı

Etiket sayfasında genişlik/yükseklik mm olarak seçilir. A4 modu normal Epson gibi yazıcılarda deneme ve çoklu etiket baskısı içindir. Rulo modu özel etiket kağıdı içindir. Yazdırma penceresinde %100 ölçek, kapalı üstbilgi/altbilgi ve uygun kağıt seçilir. Barkod gerçek baskıdan tekrar okutularak doğrulanmalıdır.

SVG baskı boyutu seçilebilir; içerik oranı korunur. Çok küçük etiketlerde barkod okunurluğu ve içerik sığması sahada kontrol edilmelidir. ZPL çıktısı bu sürümde yalnız 100×50 mm için açılır. Doğrudan Bluetooth/USB baskı köprüsü henüz uygulanmadı.

## Yayın kaynakları

Yeni Neon projesi: `Motive` / `autumn-lake-32406096`, Frankfurt, PostgreSQL 18. Yayın hedefi bu projeye özel Hostinger VPS ve `https://wms.etkinyazilim.com` adresidir. `deploy/vps/compose.yml` web/worker süreçlerini ve Caddy HTTPS vekilini başlatır. Gizli ortam dosyaları `/opt/etkinwms/secrets/web.env` ve `worker.env` altında tutulur; migration sahibi bağlantısı çalışma zamanına aktarılmaz. Eski Fly/Neon kaynakları bu deponun dağıtım hedefi değildir.

## Henüz tamamlanmayan işler

Gerçek müşteri çalışma alanı ve başlangıç kullanıcılarının kurulumu, üretim reçetesi akışı, saha sevkiyat ekranları, abonelik/ödeme, bulut yayını ve gerçek yazıcı/kamera kabul denemesi. Kodda var olan domain komutları, henüz tamamlanmamış ekranların kullanıcıya açık olduğu anlamına gelmez.
