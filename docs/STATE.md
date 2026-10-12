# EtkinWMS bağımsız pilot durumu

Hedef: 12 Ekim 2026, 22:00 Europe/Istanbul; Motive Rubber üç depo pilotu.
Kaynak: shosgoren/2027-WMS-1 salt okunur kopya; orijinal depo/kaynaklara yazılmaz.
Hedef depo: shosgoren/EtkinWMS. Eski çalışma notları UPSTREAM_STATE.md içinde yalnız referanstır.

Hazır: bağımlılıklar; 27 yerel migration; ayrı etkinwms-pilot-local compose ortamı; SVG/Code128 etiketleri; A4 ve mm ölçü ayarları; kamera altyapısı.
Kontrol: lint/typecheck ve 3726 birim testi geçti. Web ve worker üretim build geçti. Stok, firma izolasyonu, oturum ve etiket için 82 entegrasyon testi geçti.
Bulut: yeni Neon Motive (autumn-lake-32406096, Frankfurt, PG18, free), ayrı uygulama/auth/worker rolleri ve 27 migration hazır. Hedef GitHub main yüklendi. Ücretli Fly kurulmadı; ayrı Hostinger KVM2 VPS hazır (Almanya, Ubuntu24.04, 2 CPU, 8GB RAM, 100GB disk). SSH bağlantısı doğrulandı.
Yayın: deploy/vps web/worker/Caddy yapılandırması ve üretim Docker derlemesi doğrulandı. VPS üzerinde süreçler çalışıyor; derin sağlık kontrolü DB/kuyruk/worker OK. Kullanıcı yayın adresini wms.etkinyazilim.com olarak seçti; A kaydı eklendi, geçerli HTTPS sertifikası doğrulandı. Bazı istemcilerde DNS negatif önbelleği henüz temizlenmedi. Gizli ayarlar Git'e girmez, VPS'de web ve worker için ayrı dosyalarda tutulur.
Kalan: müşteri bootstrap ve MFA, üretim ve sevkiyat ekranları, tarayıcıdan müşteri kabul kontrolü, cihaz kabul denemeleri. Müşteriye hazır kullanım henüz doğrulanmadı.

Satış sitesi: etkinyazilim.com HTTPS üzerinden yayında; etkinyazilim.com.tr HTTPS ile ana adrese yönlenir. Web ve 390px mobil görünüm, menü, sektör senaryoları ve gerçek form kaydı doğrulandı. Demo talepleri marketing-leads named volume içinde 0600 dosyada saklanır; bu sürüm otomatik e-posta bildirimi göndermez. Ana alan adlarının A kayıtları yeni VPS'ye alındı; mevcut e-posta ve diğer alt alan adı kayıtları korunur. İlk Motive yönetici e-postası kullanıcı tarafından belirlendi; hesap kurulumu henüz tamamlanmadı.

Tasarım T-902: özgün lacivert/turuncu palet ve yeni açılış/giriş ekranı; misafir kabuğu sadeleştirildi. İlk kullanımda üç aşamalı rehber, her sayfada yeniden açma düğmesi, parolayı göster/gizle ve kısa açıklama eklendi. Masaüstü ve 390px mobilde rehber ileri/tamam/kapat/yeniden aç ile parola göster/gizle kontrol edildi. Lint/typecheck ve 3727 test geçti; mevcut kontrast testleri değiştirilmedi. Üretim Docker doğrulaması geçti; guided-20261012 sürümü VPS üzerinde etkin. Canlı açılış/rehber görüntüsü ve satış paleti doğrulandı. Derin sağlık DB/kuyruk/worker OK. İlk defa bilgisayar kullanan gerçek kişiyle kabul denemesi henüz yapılmadı.
