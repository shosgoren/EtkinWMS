# İlk yönetici hesabı: uygulanabilir önkontrol

Kaynak: canlı olarak bildirilen `024a800bace33c2dc3df397d56fda7e449d1d9dc`, schema27. Bu dal yalnız önkontrol SQL'i ve işletim notudur; yeni yayın veya hesap hazırlamaz.

## Yetkili operatörün tek ilk adımı

Hostinger `187.7.76.72` üzerinde yalnız EtkinWMS'nin doğru veritabanını ve Motive tenant'ının **tam slug** değerini kendi mevcut yetkili kaydından doğrula. Cloud'a bağlantı URL'si/parola/özel anahtar gönderme. Mevcut güvenli operatör bağlantısıyla aşağıdaki dosyayı çalıştır; bağlantı sırlarını komut satırına yazma.

```sh
psql -X -v ON_ERROR_STOP=1 -v target_slug='<doğrulanmış-tam-slug>' -f pilot-account-preflight.sql
```

Komuttaki dosya bu dizindeki SQL'dir; örnek slug yer tutucusunu gerçek doğrulanmış değerle değiştir. Dosya READ ONLY transaction açar; RLS görünürlüğü veya SELECT yetkisi eksikse durur. Hiçbir rol/RLS ayarı değiştirme. Hata halinde sonuç UNKNOWN/BLOCKED'dır; "hesap/sahip yok" değildir. Doğrulanmış slug bilinmiyorsa tahminle hesap açma; operatör önce kendi yetkili kurulum kaydını kontrol etmelidir.

Çıktı: tenant UUID/slug/status/is_demo, aktif owner/admin sayıları, yalnız `hosgorens@gmail.com` için varlık/üyelik/yetki boolean'ları ve migration sürümü. Parola, token, e-posta listesi veya kullanıcı satırı çıkmaz. `expected_schema27=false/NULL`, hedef uyuşmazlığı veya demo/askıdaki tenant halinde canlı kurulum ilerletilmez. Sayımlar yöneticinin gerçekten giriş yapabildiğini kanıtlamaz.

## Sonuca bağlı desteklenen giriş yolu

Mevcut gerçek tenant ve giriş yapabilen yetkili yönetici varsa, mevcut HTTPS uygulamada `/t/<slug>/members` üzerinden `hosgorens@gmail.com` için `TENANT_ADMIN` daveti çıkarılır. Davet72saat/tek kullanımlıktır; e-posta teslimi uygun değilse uygulama tek seferlik ekran bağlantısını destekler. Kullanıcı `/invite/<token>` üzerinde **kendi** parolasını seçer; ardından login/MFA kurar. Bağlantı bearer credential'dır: Git'e, CIloguna veya kamuya açık belgeye yazılmaz. Bu akış migration30 veya yeni ürün yayınını gerektirmez.

Davet `is_owner=false` oluşturur. Sahiplik gerekiyorsa mevcut sahip uygulamadaki `transferOwnership` akışını kullanır; admin daveti ilk-sahip bootstrap değildir. Hesap zaten varsa normal mevcut-hesap kabul/giriş yolu uygulanır, parola zorla değiştirilmez.

Hiç yetkili yönetici/ilk sahip yoksa024a800'de desteklenen ilk-sahip bootstrap bulunmuyor. Üretimde signup açmak, ortamı local/ci göstermek, sahte davetçi yaratmak veya doğrudan owner alanını güncellemek çözüm değildir. İncelenmiş yeni enrollment/operatör aracı gerekir; kullanıcı parolası CLI'a/Cloud'a alınmadan tek kullanımlık kurulum tasarlanmalıdır. Henüz bu araç uygulanmış değildir. Hesap mutasyonu onayı ancak exact tenant, rol, veri etkisi ve incelenmiş araç somutlaştıktan sonra istenir.

## Erişim ve doğrulama sınırı

Kurulu forced-command `check/deploy` kimliği bu DBönkontrolüne veya bootstrap'a yetmez. Yetkili VPSoperatörü gerekir; yeni credential veya kişisel/root anahtar Cloud'a istenmez. Yerel operatörün geri döndüğü veya bu komutu çalıştırdığı henüz doğrulanmadı.

SQL mevcut sentetik loopback schema30DB'de exit0 ile denendi; beklenen27=false döndürdü. Bu canlı schema27 uygulama kanıtı değildir. Log Cloud `.artifacts/t-903/pilot-account-preflight-local.log`. Salt okunur inceleme kaydı görev kartına eklenir. Canlı hesap/parola/token oluşturulmadı.

Schema alanı yalnız migration satır sayısı/min/max için bilgilendirici önkontroldür; tam sürüm kümesi, checksum veya fiziksel şema doğrulaması değildir. True değeri bootstrap/yayın izni vermez; güçlü şema kanıtı ayrıca exactmigration/checksum karşılaştırması gerektirir. Hesap-varlığı metadata’sı yalnız yetkili operatörle paylaşılır.
