# EtkinWMS bağımsız pilot durumu

Hedef: 12 Ekim 2026, 22:00 Europe/Istanbul; Motive Rubber üç depo pilotu.
Kaynak: shosgoren/2027-WMS-1 salt okunur kopya; orijinal depo/kaynaklara yazılmaz.
Hedef depo: shosgoren/EtkinWMS. Eski çalışma notları UPSTREAM_STATE.md içinde yalnız referanstır.

Hazır: bağımlılıklar; 27 yerel migration; ayrı etkinwms-pilot-local compose ortamı; SVG/Code128 etiketleri; A4 ve mm ölçü ayarları; kamera altyapısı.
Kontrol: lint/typecheck ve 3726 birim testi geçti. Web ve worker üretim build geçti. Stok, firma izolasyonu, oturum ve etiket için 82 entegrasyon testi geçti.
Bulut: yeni Neon Motive (autumn-lake-32406096, Frankfurt, PG18, free), ayrı uygulama/auth/worker rolleri ve 27 migration hazır. Hedef GitHub main yüklendi. Ücretli Fly kurulmadı; ayrı Hostinger KVM2 VPS hazır (Almanya, Ubuntu24.04, 2 CPU, 8GB RAM, 100GB disk). SSH bağlantısı doğrulandı.
Yayın: deploy/vps web/worker/Caddy yapılandırması ve üretim Docker derlemesi doğrulandı. VPS üzerinde süreçler çalışıyor; derin sağlık kontrolü DB/kuyruk/worker OK. Kullanıcı yayın adresini wms.etkinyazilim.com olarak seçti; A kaydı eklendi, geçerli HTTPS sertifikası doğrulandı. Bazı istemcilerde DNS negatif önbelleği henüz temizlenmedi. Gizli ayarlar Git'e girmez, VPS'de web ve worker için ayrı dosyalarda tutulur.
Kalan: müşteri bootstrap ve MFA, üretim ve sevkiyat ekranları, tarayıcıdan müşteri kabul kontrolü, cihaz kabul denemeleri. Müşteriye hazır kullanım henüz doğrulanmadı.
