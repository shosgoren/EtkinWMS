# Etkin WMS kullanım ilkesi

İlk defa bilgisayar kullanan kişinin de yapacağı işi anlayabilmesi tasarımın temel hedefidir. Bu hedef gerçek kullanıcı kabul denemeleriyle doğrulanır; görsel düzen tek başına yeterli sayılmaz.

- Bir ekranda bir ana karar ve belirgin bir sonraki işlem.
- İşletme dilinde kısa başlık: mal kabul, yerleştir, stok çıkışı. Teknik terim gerekmedikçe görünmez.
- Her aşamada hangi ürün, depo ve miktarın işlendiği açıkça görünür.
- Renk tek başına anlam taşımaz: numara, farklı simge ve açıklama eşlik eder.
- Kaydetmeden önce kullanıcı işlem sonucunu görür. Yetersiz stok, yanlış ürün/konum, yetki ve mükerrer işlem sunucuda engellenir.
- Hata mesajı neyin yanlış olduğunu ve kullanıcının şimdi ne yapacağını açıklar. Hata başarılı işlem gibi gösterilmez.
- Dokunma alanı en az 48px, önemli eylemlerde 56px. Yakınlaştırma engellenmez. Kontrast testleri korunur.
- İlk kullanımda üç adımlı rehber; aynı rehber her ekranın “Nasıl kullanırım?” düğmesinden yeniden açılabilir. İstisna (T-983, kullanıcı kararı): giriş ekranı sade kalır; üst bar ve rehber orada çıkmaz, rehber girişten sonraki ilk ekranda açılır. Rehber kaydı yalnız tarayıcı tercihi olup kimlik/yetki verisi taşımaz.

İlk düzenleme: lacivert/turuncu ortak palet, özgün açılış/giriş ekranı, sade misafir kabuğu, üç aşamalı ilk kullanım rehberi. Mal kabul ve yerleştirme için mevcut aşama/özet/uyarı akışları korunur. Üretim/sevkiyat ekranlarının aynı ilkelerle tamamlanması ve gerçek cihaz kabul testi hâlâ gereklidir.
