# EtkinWMS bağımsız pilot durumu

Hedef: 12 Ekim 2026, 22:00 Europe/Istanbul; Motive Rubber üç depo pilotu.
Kaynak: shosgoren/2027-WMS-1 salt okunur kopya; orijinal depo/kaynaklara yazılmaz.
Hedef depo: shosgoren/EtkinWMS. Eski çalışma notları UPSTREAM_STATE.md içinde yalnız referanstır.

Hazır: bağımlılıklar; 27 yerel migration; ayrı etkinwms-pilot-local compose ortamı; SVG/Code128 etiketleri; A4 ve mm ölçü ayarları; kamera altyapısı.
Kontrol: lint/typecheck geçti; ilk 3726 unit koşusunda 16 Mac geçici dizin yolu hatası çıktı. Koşturucu realpath düzeltmesi sonrası ilgili 135 test geçti. Tam tekrar ve üretim build sürüyor.
Bulut: yeni Neon Motive (autumn-lake-32406096, Frankfurt, PG18, free) oluşturuldu. Fly hesabı açık fakat GitHub entegrasyonu henüz yok.
Kalan: Fly ayrı uygulama + yetkilendirme, yeni Neon rol kurulumu/migration, müşteri bootstrap, üretim ve sevkiyat ekranları, alan adı + HTTPS, cihaz kabul denemeleri.
