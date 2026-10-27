# Paraşüt ürünleri ve okutmalı Devir — 27 Ekim 2026 onaylı plan

Bu dosya bu akışın tek devam kaydıdır. API bilgileri bekleniyor; sırlar dosya/sohbete yazılmaz. Başlangıç incelemesi main `27103be`; eski not canlı kanıt değildir.

## Kararlar
- **27 Ekim ek kullanıcı kararı:** Ürün fiyatları çekilmez veya WMS'de tutulmaz; alış/satış fiyatı, döviz ve fiyat hesaplama kapsam dışıdır. WMS miktarsal stok yönetimidir.
- Paraşüt → WMS yalnız ürün kartları, stok miktarsız. API'nin desteklediği alanlar eşlenir; WMS üretim/takip bilgilerini sonraki senkron ezmez.
- Barkod al/alma ayarı: alınırsa dış barkod, yoksa dahili barkod. Kapalıysa mevcut korunur, eksikse dahili oluşturulur. Açma/kapatma eski barkodu silmez; dış barkod alternatif olur. GTİP barkod değildir. Çakışan barkod kontrol ister.
- Ürün etiketi ürün kartını, tekil QR fiziksel ambalajı tanımlar. Standart barkod QR basılabilir; EAN13/Code128 okutma korunur.
- Ürün listesinde tür/kategori/takip/barkod süzgeci ve toplu etiket.
- Devir: depo/yer → okut → gerekirse takip seç → miktar/ambalaj → etiket → tamamla. Cihazlar: web/tablet/telefon, ortak kalıp, az yazı, renk+ikon+ses, yetki sunucuda.
- Takip kararı üç durumlu: belirlenmedi / açıkça takipsiz / tanımlı takip. Yalnız belirlenmediyse yetkili kişiye bir kez sorulur; çıkmak karar değildir. Lot ve tekil ambalaj birlikte olabilir; tarih zorunluluğu karttan gelir. Hareketli eski kartlar yeniden tanımlanmaz.
- Ambalaj: koli/paket/palet/varil/çuval/poşet/kutu, eşit veya farklı gerçek net miktarlar. Lotlar ayrı gruplar. Palet içeriği toplar, ikinci stok oluşturmaz.
- Taslak saklanır; baskı stok oluşturmaz, yeniden baskı aynı QR. Kesinleştirme ayrı Devir fişi ve bağlı hareketleri tekilleştirir; bağlantı kesilmesi/çift tıklama çoğaltmaz. Büyük giriş parçalı ve devam edebilir. İşlenmiş fiş yalnız kontrollü ters kayıtla düzelir.
- Devir tamamlanmadan ve ayrıca etkinleştirilmeden WMS → Paraşüt stok gönderimi açılmaz. Mevcut canlı müşterinin stok/yön ayarları kendiliğinden değiştirilmez.

## Seri uygulama sırası
1. **T-1060 — #209 CANLIDA:** miktarsız aktarımın birim/hassasiyet ve eşleme güvenliği; bilinmeyen birimi ADET sayma kaldırılır, mevcut kart birimi korunur. Main/CI ve deploy `40477830376` başarılı; VPS `health:ok`, release `5c7c00695b1ab4113bcb30ad06a739aab291ccbb` doğrulandı.
2. **T-1061 — #210 CANLIDA:** barkod alma parametresi + kalıcı dahili barkod/alternatifler; prepush ve 20 DB testi geçti, bağımsız inceleme temiz. Deploy `40480901139` başarılı; 27 Ekim doğrudan VPS kontrolü `health:ok`, release `800b43b82dde3b603916377556dd912560df0633`. **T-1062 — #212 BİRLEŞTİ, YAYIN BEKLİYOR:** alan sahipliği ve kaynak kategori/GTİP/durum bilgisi; fiyat, döviz, vergi ve stok miktarı saklanmaz. Resmî API şeması doğrulandı. Prepush ve DB 47/47, PR CI geçti; inceleme 0B/0MA/0MI. Main `9437b85` CI sonraki birleşmeyle iptal; birleşik main `152f9d3` CI geçti, deploy `40483396590` sürüyor. Kartta gösterim sonraki ekran adımında.
3. **T-1063 — YEREL DOĞRULAMA TAMAM:** kategori/takip/barkod süzgeçli okuma ve sınırlı toplu etiket kaynağı (aynı keyset/toplam, en çok 100). DB 18/18, prepush yeşil (4992 birim + AC-04). **SONRAKİ SERİ ADIM:** ortak kalıpla süzgeç ekranı, kaynak kategori/GTİP gösterimi, QR ürün etiketi önizleme ve gruplu baskı; standart okutma korunur. Bu altyapı tek başına kullanıcı ekranının tamamlandığı anlamına gelmez.
4. **BEKLİYOR:** belirlenmemiş takip durumu + yetkili ilk seçim; mevcut kayıtları koruyan migration.
5. **BEKLİYOR:** ayrı Devir fişi ve okutmalı taslak; lot/tarih/ambalaj, palet, tekil QR, baskı.
6. **BEKLİYOR:** kesinleştirme/yarım işlem kurtarma/ters kayıt, stok gönderme açılış kapısı.
7. **BEKLİYOR:** gerçek API ile kontrollü miktarsız deneme; cihaz okutma ve Epson baskı doğrulaması.

Her iş yeni boş T numarasıyla ayrı dalda; task + changes parçası + bu dosyanın ilgili satırı aynı PR'da. STATE/BACKLOG doğrudan düzenlenmez. Stok ve entegrasyon riskine göre bağımsız inceleme, prepush/gitleaks/CI/yayın kapıları korunur. Çalıştırılmayan test UNKNOWN; her aşama için gerçek sonuç kaydedilir.
