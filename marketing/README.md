# Etkin WMS satış sitesi

Node 24 ile `PORT=3200 LEAD_DIR=/tmp/etkin-sales-test node marketing/server.mjs`.
Ana adres etkinyazilim.com; .com.tr ve www adresleri HTTPS ile ana adrese yönlendirilir.
WMS uygulaması wms.etkinyazilim.com adresinde ayrı çalışır.

Demo formu gerçek talepleri `/data/demo-requests.jsonl` dosyasına, Docker named volume üzerinde saklar. E-posta göndermez. Kayıtlar herkese açık bir API'den okunamaz. Bu sürümde talepleri sunucu erişimi olan işletmeci kontrol eder. Formda iletişim onayı, kaynak denetimi, 8KB gövde sınırı ve IP başına saatte 5 deneme sınırı vardır.

Ürün arayüzleri temsili olarak etiketlenmiştir. Müşteri referansı, fiyat veya tamamlanmamış modülün hazır olduğuna dair iddia içermez. Cihaz uyumluluğu ve pilot kabul kapsamı açıkça belirtilir.
