# Etkin WMS — Motive pilotu ve Cloud devir kaydı

**Belge sürümü:** 1.8 (T-903 paket8 push edilmiş aday ve yayın devri)
**Son doğrulama:** 12 Ekim 2026 — aşağıdaki paket8 kaydı günceldir; eski bölümler tarihsel kanıttır
**Durum:** Altyapı yayında; müşteri pilotu tamamlanmadı.  
**Bugünkü hedef:** 12 Ekim 2026, 22:00 Europe/Istanbul. Teslim garantisi verilmedi.

Bu dosya, sonraki geliştirme görevinin başlangıç kaydıdır. Sohbet belleği yerine Git'teki bu belgeyi ve gerçek kod/test durumunu kullan. Buradaki eski bir doğrulamayı yeni çalışma ortamının doğrulaması gibi sunma. Belgeyi her anlamlı değişiklikte güncelle; sır, parola, özel anahtar veya bağlantı parolası ekleme.

## 1. Değişmez kullanıcı talimatları

- Ürün adı **Etkin WMS**. Motive WMS adı kullanılmaz. Motive Rubber ilk müşteridir; ürün yalnız bu müşteriye özel tasarlanmaz.
- Ürün, sektör bağımsız depo/stok/operasyon SaaS'ı olarak ileride diğer müşterilere aylık kiralanacak.
- İlk öncelik Motive Rubber pilotunda gerçek çalışan miktarsal stok, üretim ve sevkiyattır. **Son kullanıcı düzeltmesi:** üç depo bir ürün şartı/sınırı değildir; yalnız ilk pilot örneğidir. Kullanıcı birden çok depo ve her depoya bağlı birden çok raf/lokasyon açabilmeli; raflar toplu otomatik oluşturulabilmelidir.
- Barkod okuma ve etiket çıktısı pilot kapsamındadır. Öncelik telefon kamerası ve notebook kamerasıdır; Android el terminalleri de düşünülmelidir.
- Kullanıcı hızlı ilerleme ve kullanım hakkının ekonomik kullanılmasını istiyor. Gereksiz yeniden yazım, uzun loglar, tekrar test ve gereksiz izin soruları azaltılır; doğrulama atlanmaz.
- **shosgoren/2027-WMS-1 deposuna ve o projenin çalışan servislerine ASLA değişiklik yapılmaz.** Kod yalnız okunabilir ve uygun parçalar EtkinWMS'ye alınabilir. Hata düzeltmesi bile kaynak projeye yazılmaz.
- Yeni değişikliklerin hedefi yalnız **shosgoren/EtkinWMS** deposudur.
- Yeni ücretli servis veya ek abonelik kurma. Fly maliyeti onaylanmadı; kullanıcı ayrı VPS satın aldı.
- Kullanıcı telefonundan sorulara cevap verebilir. Cloud geliştirmesi bilgisayarındaki tarayıcı, terminal ve kişisel SSH anahtarına bağımlı olmamalıdır.

## 2. Kullanım ve tasarım sözleşmesi

**Ana ilke:** Müşteri sisteme hizmet etmemeli; sistem müşteriyi korumalı, hizmet ve fayda sağlamalı. İlk defa bilgisayar kullanan kişinin de anlayabilmesi hedeflenir; bu hedef gerçek kullanıcıyla test edilmeden doğrulanmış sayılmaz.

- Özgün lacivert/turuncu tasarım. Referans projenin mavi ekranlarının aynısını kopyalamak kullanıcı tarafından reddedildi.
- Mevcut ortak palet: ana yazı/lacivert `#172e42`, turuncu `#c64a19`, sayfa zemini `#f5f7f8`. Durum ve iş kategorisi renklerinin anlamı ve kontrastı korunur.
- Satış sitesi ve uygulama aynı tasarım ailesini kullanır.
- Web, telefon, tablet ve dokunmatik terminal uyumu. Ana dokunma alanları 56px, diğerleri en az 48px; yakınlaştırma engellenmez.
- Büyük renkli simge + 1–3 kelimelik işlem adı. Renk tek başına anlam taşımaz; simge ve kısa durum etiketi eşlik eder.
- Tek ekranda tek ana karar; belirgin sonraki adım. Uzun düz yazı ve kalabalık form yerine kısa adımlar, görsel özet ve gerektiğinde açılan yardım.
- İlk açılışta kısa rehber; her işlemde ihtiyaç halinde yeniden açılabilen yardım. Mevcut üç adımlı rehberin paragraf yoğunluğu azaltılmalıdır.
- Kayıttan önce ürün, depo/konum, miktar ve işlemin etkisi görünür olmalı.
- Hata: ne oldu + şimdi ne yapmalı. Ham SQL, stack trace veya teknik jargon kullanıcıya gösterilmez; hata başarı gibi sunulmaz.
- Yanlış depo, yetersiz stok, yetkisiz işlem, başka firmanın verisi ve mükerrer kayıt sunucuda engellenir.
- Hiçbir ekran için kullanıcı testinden önce “ilk defa bilgisayar kullanan herkes sorunsuz kullanır” iddiası verilmez.

## 3. Kod ve dal kaydı

| Konu | Son doğrulanmış değer |
| --- | --- |
| Yazılabilir depo | `https://github.com/shosgoren/EtkinWMS` |
| Son uygulama dalı | `feat/T-902-guided-ui` |
| Son uygulama commit'i | `024a800bace33c2dc3df397d56fda7e449d1d9dc` |
| Bu devir belgesinin dalı | `feat/T-904-pilot-handoff` — T-902 üzerine yalnız belge değişiklikleri |
| Yerel hedef checkout | `/Users/shosgoren/Documents/2027/ChatGPT - Codex/WMS/EtkinWMS` |
| Yerel salt okunur referans | `/Users/shosgoren/Documents/2027/ChatGPT - Codex/WMS/reference-2027-wms` |
| Beklenen bağlı Cloud checkout | `/workspace/EtkinWMS` — her görevde ayrıca doğrulanır |
| Teknoloji | Node 24, pnpm 10.28.0, Next 16, React 19, PostgreSQL 18, Drizzle, Better Auth, pg-boss |

`main`, son uygulama sürümünden geridedir. İlk iş fetch + status + SHA kontrolüdür. T-904 dalından yeni geliştirme dalı açmak hem son uygulamayı hem bu belgeyi taşır. Mevcut çalışma ağacını veya başkasının değişikliklerini sıfırlama.

Mevcut PR'lar: [#1 VPS](https://github.com/shosgoren/EtkinWMS/pull/1), [#2 satış sitesi](https://github.com/shosgoren/EtkinWMS/pull/2), [#3 kullanım rehberi](https://github.com/shosgoren/EtkinWMS/pull/3). Bunları birleştirilmiş kabul etme; gerçek durumunu GitHub'dan oku. T-902 PR'ının tabanı T-901'dir.

Depoya uygulanabilen AGENTS/skill talimatlarını oku. `apps/web/AGENTS.md`, Next'in paket içindeki ilgili belgelerini koddan önce okumayı gerektirir. Önceki projenin `docs/UPSTREAM_STATE.md` ve eski görev kartları tarihsel referanstır; bugünkü ürünün tamamlanma kanıtı değildir.

## 4. Yayın ve kaynak sınırları

| Kaynak | Son doğrulanmış durum |
| --- | --- |
| Uygulama | `https://wms.etkinyazilim.com` |
| Satış sitesi | `https://etkinyazilim.com` |
| İkinci satış alan adı | `https://etkinyazilim.com.tr` → HTTPS ile `.com` yönlendirmesi |
| Sunucu | Kullanıcının yeni Hostinger VPS'si, `187.7.76.72`, Düsseldorf, Ubuntu 24.04 |
| Kapasite | KVM2, 2 vCPU, 8 GB RAM, 100 GB disk |
| Compose projesi | `etkinwms-motive`: web, worker, Caddy proxy, marketing |
| Son etkin yayın | `/opt/etkinwms/current` → `/opt/etkinwms/releases/guided-20261012` |
| Son imaj | `etkinwms:guided-20261012`; önceki imaj geri dönüş için saklandı |
| Yeni veritabanı | Neon **Motive**, proje `autumn-lake-32406096`, Frankfurt, PG18, Free |
| VPS runtime sırları | `/opt/etkinwms/secrets/web.env` ve `worker.env`, ayrı ve 0600 |
| Ağ | HTTPS geçerli; dışarı yalnız SSH/HTTP/HTTPS, uygulama ve worker iç ağda |

Başlangıçta geçen `etkinwms.com` yayın hedefi kullanıcı tarafından değiştirilmiştir. Aktif hedef `wms.etkinyazilim.com`dur. Eski yerel `.env.motive.local` içindeki `BETTER_AUTH_URL` hâlâ eski alan adını içerebilir; kullanılmadan önce kontrol edilir. VPS runtime URL'si güncellendi.

Ana satış alan adları yeni VPS'ye yönlendirildi; mevcut mail ve diğer alt alan adı kayıtları korunmuştur. DNS kayıtlarını topluca değiştirme. Kaynak projenin eski sunucusuna, Fly uygulamasına veya Neon veritabanına dokunma.

Üretimde `DEMO_MODE=0`. Gerçek veritabanı bağlantısı vardır; tarayıcı localStorage örnek stok ekranı üretim sistemi değildir. Kaynak demo kullanıcıları yeni üretim sistemi için yetkili hesap sayılmaz.

## 5. Gerçek hazır durum / kalan işler

| Alan | Doğrulanmış durum | Kalan |
| --- | --- | --- |
| Altyapı | Ayrı Neon, 27 migration, web/worker/Caddy çalışıyor; son sağlık kontrolü DB/kuyruk/worker OK | Her yeni sürümde yeniden sağlık ve geri dönüş kontrolü |
| Tasarım | T-902 açılış/giriş, lacivert/turuncu palet, parola göster/gizle, yeniden açılan rehber | Rehber metinlerini kısalt; kalan gerçek işlem ekranlarında aynı deneyimi uygula |
| İlk müşteri | Yönetici e-postası kullanıcıdan alındı: `hosgorens@gmail.com` | Motive tenant, ilk yönetici, güvenli ilk giriş ve MFA kurulumu **yapılmadı** |
| Çoklu depo ve raf/lokasyon | Depo/konum yönetimi ve toplu raf oluşturucu mevcut; sabit üç depo sınırı yok | Müşterinin istediği depo/raf düzenini gerçek verilerle kabul et; Hammadde / Üretim / Sevkiyat yalnız pilot örneği, gerçek stok miktarı uydurma |
| Ürün ve birim | Ürün, birim, barkod/dönüşüm altyapısı ve yönetim ekranları var | Müşterinin gerçek ürünlerini ve kg/adet gibi birimlerini hazırla; karışık birimleri toplam tek sayı gibi sunma |
| Mal kabul / yerleştirme | Mevcut çalışan domain komutları ve saha ekranları var | Yeni müşteri, gerçek kayıtlar ve cihazlarla uçtan uca kabul testi |
| Stok / transfer / çıkış | Stok ledger, transaction, rezervasyon ve kilit altyapısı var | Stok görünümü, giriş/çıkış ve atomik transfer yerel teknik kabulü geçti; son birleşik yazılım/CI ve gerçek müşteri kabulü açık |
| Üretim | Genel stok çekirdeği kullanılabilir | Reçete/BOM, atomik tüketim/çıktı ve ekranların yerel teknik kabulü tamam; canlı yayın/müşteri kabulü açık |
| Sevkiyat | Sipariş, tahsis, toplama, kısmi sevk domain komutları var | Sorgular, action ve form dosyaları kısmi; sayfa/çeviri/uçtan uca kabul eksik. İptalde expectedVersion zorunlu hale getirildi; tip hatası giderildi |
| Kamera | Tarayıcı kamera/scanner altyapısı var | Gerçek telefon/notebook kamera kabul testi yapılmadı |
| Etiket | SVG/Code128, A4 ve mm ölçü ayarları; ZPL çıktısı yalnız mevcut 100×50mm desteğinde | Gerçek yazıcı testi, farklı ölçülerde okunabilirlik; cihaz/bağlantı bazında desteği doğrula |
| Satış | Web/mobil site, HTTPS, form doğrulama ve kalıcı talep kaydı doğrulandı | Otomatik e-posta bildirimi yok; talebin inbox'a gönderildiğini iddia etme |
| Aylık SaaS | Ürün yönü ve firma/rol izolasyonu altyapısı var | Abonelik, otomatik ödeme ve ticari süreçler tamamlanmadı; bugün hazırmış gibi satma |

Satış talepleri `etkinwms-motive_marketing-leads` named volume içinde 0600 JSONL dosyada tutulur. `EtkinWMS — TEST KAYDI` olarak işaretlenen `qa@example.invalid` kaydı gerçek talep değildir. Loglara talep içeriğini veya kişisel veriyi basma.

## 6. Stok ve güvenlik kuralları

- Stok bakiyesine veya ledger'a doğrudan SQL ile miktar yazma. Mevcut domain komutlarını, transaction'ları, tenant RLS ve stok kilitlerini kullan.
- Miktarlar decimal metin/tam sayı ölçeği ile taşınır; JavaScript float ile stok hesabı yapılmaz.
- Yazma eylemleri sunucu tarafı oturum, tenant/rol, Origin, hız sınırı ve idempotency kontrolünden geçer. UI'da düğmeyi kapatmak güvenlik kontrolünün yerine geçmez.
- Yetersiz stok, sayım kilidi, arşivlenmiş ürün/konum, yanlış depo ve mükerrer kayıt için anlamlı negatif test gerekir.
- Üretim tüketimi ve mamul girişi tamamı başarılı veya tamamı geri alınmış olmalıdır. Başarısız tüketimden sonra mamul stoğu oluşmaz.
- Mevcut posting motoru belge lokasyonlarının belge deposunda olmasını denetler. Depolar arası transferi bu kuralı kaldırarak çözme; kaynak ve hedef etkilerini aynı transaction ve tam kilit planında güvenli tasarla.
- `TENANT_ADMIN` için üretimde MFA zorunludur. İlk giriş kolay olsun diye MFA veya HTTPS zorunluluğu kapatılmaz.
- İlk müşteri hesabı güvenli bootstrap ile oluşturulur. Parola/anahtar sohbet veya Git üzerinden paylaşılmaz; existing gerçek hesabın parolası izinsiz sıfırlanmaz.
- Gitleaks, korunan dosya kuralları, assertion/kontrast testleri ve CI bekçileri gevşetilmez.

## 7. Donanım kapsamı ve dürüst destek sınırı

Kullanıcı model bağımsız yazıcı, network/Wi-Fi, USB, Bluetooth ve taşınabilir cihazlardan müşterinin seçtiği etiket ölçüsünde çıktı istiyor. Bu bir ürün hedefidir; bugün her cihaz için sağlanmış destek değildir.

- İlk doğrulama: işletim sistemi yazıcı sürücüsü üzerinden tarayıcı yazdırma/PDF; kullanıcı evindeki Wi-Fi bağlı normal Epson yazıcıda test yapabilir.
- Etiket eni/boyu mm ile seçilebilmeli; A4 üzerinde yerleşim ve yazıcıdaki gerçek ölçek doğrulanmalı. Barkod okunabilirliği ölçülür.
- Tarayıcı her USB/Bluetooth yazıcıya sessiz ve doğrudan yazamaz. Böyle bir gereksinimde uygun yerel köprü, üretici SDK'sı veya terminal uygulaması ayrı cihazla doğrulanır; evrensel çalışıyor diye iddia edilmez.
- Kamera için HTTPS, izin, ön/arka kamera seçimi, yeniden deneme ve manuel giriş yedeği gerekir.
- Android el terminalinde native uygulama otomatik şart değildir. Tarayıcı/PWA ve klavye gibi veri veren okuyucu yeterli olabilir; SDK veya özel doğrudan donanım erişimi gerekiyorsa cihaz bazında native/köprü değerlendirilir.

## 8. Cloud durumu — kritik ayrım

1. Eski kurulum görevi **“EtkinWMS kurulumunu yap”**, id `01a12f85-7a19-7158-a10d-a456d6425046`, son uygulama SHA'sını çekip gerçek geliştirme ortamında testleri çalıştırdı.
2. EtkinWMS adlı özel Cloud ortamı tarayıcı ayarlarında kaydedildi ve **“Ortam yayımlandı”** sonucu görüldü. Kurulum betiği ve başlatma becerisi ayarlı; yalnız EtkinWMS deposu seçili. Üretim sırları eklenmedi.
3. Açılan **“Etkin WMS — Motive pilotunu tamamla”** görevi, id `01a12fdc-b7eb-7118-97a7-333259bad05d`, `/workspace/scratch/5817143ae162` altında açıldı; `/workspace/EtkinWMS` yoktu. **Bu görev ortama bağlanmadı ve geliştirme yapmadı.** GitHub araçlarının bulunması bağlı geliştirme ortamının kanıtı değildir.
4. Kullanıcının gönderdiği **“Ayarlarını gözden geçir: Bu ayarlar değişti veya şu anda kullanımda”** ekranı eski taslak ile güncel kayıt çakışması olabilir; kesin kök neden doğrulanmadı. Eski taslağı tekrar kaydederek güncel ortamın üzerine yazma. Ortam listesinden güncel kaydı aç.
5. **v1.0 hazırlanırken** aktif ana sohbet yerel bilgisayardaydı. T-903'te doğru Cloud checkout, GitHub erişimi, `024a800` ve devir commit'i `966079e` doğrulandı; kod/test işlemleri `/workspace/EtkinWMS` içinde bilgisayardan bağımsız yürütüldü. Bu doğrulama Cloud görevinin durduktan sonra kendiliğinden çalışmaya devam ettiği anlamına gelmez.

Doğru başlangıç: Yeni görev → Cloud → yayımlanan **EtkinWMS** ortamını seç. Görevin gerçek checkout, son SHA, araçlar ve sağlık kontrolünü doğrulamasını bekle. Yerel SSH/Chrome oturumları Cloud'a otomatik taşınmaz. Cloud görevi durduğunda veya onay beklediğinde sonsuza dek çalışıyor sayılmaz; ilerleme ve sorular o görevden izlenir.

Cloud'da mevcut runtime skill'i oku. Kurulum betiği Node24/pnpm10.28.0, frozen install, yalnız yerel örnek `.env`, rastgele yerel sırlar, Docker test Postgres/PgBouncer/Mailpit ve yerel migration kurar. Başlatma becerisi süreçleri yeniden başlatmayı anlatır. Yeni restore/görevde dosya, helper ve Docker volume'ları gerçekten var mı kontrol et; eski kurulum workspace'indeki dosyaların otomatik taşındığını varsayma.

## 9. Bilgisayardan bağımsız yayın — henüz kurulmadı

- VPS ve uygulama kullanıcı bilgisayarı kapalıyken çalışır. Cloud'da kod geliştirme bunun dışında bir süreçtir.
- Otomatik Cloud → VPS dağıtım erişimi **YOK**. Kaynak kodu push etmek canlı sürümü değiştirmez.
- Yerel kişisel/root SSH özel anahtarını Cloud'a veya GitHub'a kopyalama. Yeni uygulamaya özgü dağıtım kimliği gerekir.
- Hazırlanacak yöntem: ayrı GitHub Actions workflow, EtkinWMS'ye özel izinler, doğrulanmış exact commit/imaj digest'i, pinlenmiş host key, kök sahipli forced-command giriş noktası, yalnız EtkinWMS release/compose işlemleri, sağlık kontrolü ve geri dönüş.
- Dağıtım kullanıcısı genel root shell, genel sudo veya Docker grubu erişimi almaz. Docker grubu root eşdeğeridir.
- Üretim env dosyaları VPS'de kalır. Migration-owner bağlantısı Cloud/GitHub'a taşınmaz; gerekli schema migration yolu ayrıca sınırlandırılır.
- Yeni üretim kimliğine erişim verme ve anahtar aktarımı için somut, dar kapsamlı kullanıcı onayı gerekir. Daha önce verilen GitHub `workflow` yetkisi yeni VPS kimliğinin onayı değildir.
- Caddy dosyası dosya bind-mount olduğundan dosya değiştirme/eski inode sorununa dikkat et; yeni release/proxy recreate ile gerçekten yüklenen yapılandırmayı ve HTTPS'i doğrula.

## 10. Doğrulama kaydı ve CI eksikleri

**Yerel T-902 doğrulamaları:** lint/typecheck ve 3.727 birim testi geçti; mevcut kontrast testleri değişmeden 313 test geçti; seçili stok/tenant/auth/etiket entegrasyonlarında 82 test geçti; üretim Docker build geçti. Web/mobil 390px rehber ve giriş etkileşimleri tarayıcıda kontrol edildi. Son canlı derin sağlık kontrolü başarılıydı.

**Cloud kurulum doğrulamaları:** aynı uygulama SHA'sı üzerinde lint/typecheck + 3.727 birim testi, web/worker derlemeleri, 6 seçili entegrasyon dosyasında 114 test ve `/`, `/login`, `/api/health` kontrolü geçti. Bu sonuçlar yeni Cloud görevinde restore başarısının yerine geçmez.

**GitHub CI tamamen yeşil değildir:** T-900 dalı `feat/T-900` beklenen açıklamalı dal kalıbını karşılamadı. Gitleaks başlangıç geçmişinde üç bulgu verdi; eski projeye ait ignore fingerprint'leri yeni commit geçmişine uymuyor olabilir. Bulgular tek tek doğrulanmadan gerçek sır veya yalnız sentetik fixture olduklarına kesin hükmetme. Denetimi kapatma veya geniş ignore ekleme. Yerel testlerin geçmesi CI başarısı demek değildir.

Yeni kod için uygun `pnpm verify`, ilgili anlamlı entegrasyon testleri ve build çalıştırılır. Aynı sonuçları değişiklik veya açık sorun yokken tekrar tekrar çalıştırma. Cihaz testlerini yazılımsal test sonuçlarıyla ikame etme.

## 11. Pilot kabul listesi

- [ ] Motive çalışma alanı, `hosgorens@gmail.com` ilk yönetici, güvenli giriş/MFA.
- [ ] Müşterinin istediği sayıda gerçek depo ve depo bazlı kabul/raf/sevk konumları; toplu raf oluşturma kabulü; hiçbir uydurma açılış stoğu yok.
- [ ] Ürün, temel birim ve barkod tanımı; kg/adet ayrımı.
- [ ] Giriş sonrası doğru depoda bakiye ve hareket kaydı.
- [ ] Depolar arası transfer: kaynaktan eksilir, hedefe eklenir, toplam korunur; başarısızlıkta hiçbir yarım kayıt yok.
- [ ] Üretim: tüketim + mamul girişi birlikte; yetersiz stokta tamamı geri alınır.
- [ ] Çıkış/sevkiyat: doğru ürün/depo/miktar, bakiye ve takip izi.
- [ ] İkinci müşteri/başka kullanıcı verisine erişim engellenir; yetkisiz yazma reddedilir.
- [ ] Çift dokunma/ağ yeniden deneme aynı hareketi iki kez oluşturmaz.
- [ ] Telefon/notebook kamera, manuel yedek giriş ve mümkünse Android terminal tarama.
- [ ] Epson test çıktısı, müşterinin etiket ölçüsü ve çıktının tekrar barkodla okunması.
- [ ] Web/mobil dokunma alanları, yatay taşma, kısa rehber, gerçek ilk kullanıcı denemesi.
- [ ] Son sürüm Git SHA'sı, build, canlı sağlık kontrolü, kalıcılık ve rollback doğrulandı.

Tamamlanmamış maddeyi sadece düğme/ekran ekleyerek işaretleme. Gerçek işlemi ve sonucu test et.

## 12. Sonraki görevin uygulayacağı kayıt yöntemi

1. Bu belgeyi, `docs/STATE.md` ve gerçek Git durumunu oku; kullanıcıdan aynı bilgileri yeniden isteme.
2. Çalışma ortamını, repo remote'unu, branch/SHA'yı ve gerekli erişimi doğrula. Eksik erişimde bağımsız kod/test işine devam et; erişim varmış gibi davranma.
3. Tek aktif geliştirme dalı/sorumlu kullan. Aynı dosyaları iki görevde eşzamanlı değiştirme; yeni başlatılan görev varsa önce durumunu oku.
4. Önce müşteri giriş/kurulum ve stok akışları, sonra atomik üretim ve sevkiyat, ardından cihaz kabulü. Yeni ürün kapsamı icat etme.
5. Her anlamlı sonuçta bu dosyanın tarih/sürümünü, durum tablosunu ve aşağıdaki günlüğü güncelle. Doğrulanmış kanıt, bekleyen iş ve varsayımı ayrı yaz.
6. Kod + test + devir kaydını aynı commit/PR'da taşı. Git'te olmayan yerel dosyayı Cloud'un görebildiğini varsayma.
7. Son mesajda gerçek branch/SHA, geçen kontroller, canlı yayın durumu ve kalan engelleri kısa yaz. Test/işlem tamamlanmadıysa açıkça belirt.

### Değişiklik günlüğü

| Tarih (İstanbul) | Değişiklik | Kanıt / sınır |
| --- | --- | --- |
| 12.10.2026 14:39 | Devir belgesi v1.0; kullanıcı talimatları ve son doğrulanmış durum birleştirildi | Uygulama baseline `024a800`; bu değişiklik yalnız dokümantasyon. Cloud geliştirme görevi bağlı değil; pilot hazır değil. |
| 12.10.2026 — T-903 | Cloud checkout `/workspace/EtkinWMS`, GitHub fetch ve exact SHA doğrulandı. `966079e6f8a5d4fb9ec01b0798c4ef3464f20699`, `024a800` üzerine yalnız üç belge değişikliği getiriyor; `feat/T-903-motive-pilot` bu commit'e fast-forward edildi. | Bu görev kullanıcı bilgisayarından bağımsızdır. Tek geliştirme dalı; commit/push/PR ve canlı işlem yapılmadı. |
| 12.10.2026 — T-903 | Rehberin globalSetup formunu kapatma engeli için gerçek ileri/tamam etkileşimleri ve masaüstü/mobil regresyon testleri eklendi. | Henüz kabul geçti iddiası yok; test sonuçları aşağıda güncellenir. |
| 12.10.2026 — T-903 | Gitleaks 8.30.1, depodaki sabit SHA256 ile doğrulandı. Üç bulgu ilk bağımsız commit'teki sentetik test fikstürleridir; eski muafiyetler kaynak commit kimliklerini taşıyordu. Yalnız üç exact fingerprint eklendi. | 7 commit tarandı, 0 bulgu. Değerler rapora yazılmadı. Korunan dosya incelemesi birleştirme öncesinde açık; CI başarısı iddiası yok. |

### T-903 Cloud doğrulama notları

- Geçerli sıra bu devir belgesinin §12'sidir. Eski `PHASES.md` / `PILOT.md` tek depo varsayımı güncel çoklu depo hedefinin yerine geçmez. Giriş/kurulum test kapısı geçmeden bağımlı stok/üretim/sevkiyat adımına geçilmez.
- Node 24.19.0, pnpm 10.28.0 frozen/ignore-scripts kurulumu tamamlandı. Runtime skill veya `.agents/skills` bu checkout'ta bulunmadı; varmış gibi davranılmadı.
- Test altyapısı yalnız `etkinwms-t903-local` Compose projesidir. Postgres/PgBouncer/Mailpit sağlıklı; 27 migration yerel E2E hazırlığında uygulandı. Gerçek müşteri veya başlangıç stoğu oluşturulmadı.
- Restore edilen public init dosyalarının izinleri konteyner kullanıcısına okunabilir değildi. Aynı public dosyaların `/tmp/etkin-test-infra` kopyaları ve geçici Compose bind-mount override kullanıldı; depo izinleri, daemon/ağ ayarları değiştirilmedi. Yerel örnek ortamdan rastgele test sırları oluşturuldu; değerler Git/log/mesaja yazılmadı.
- Playwright Chromium indirmesi `403 Domain forbidden` verdi. Ağ kısıtı değiştirilmedi; ortamda mevcut Chromium `154.0.8037.57`, desteklenen `executablePath` ile seçildi. Bu koşu CI'ın sabit Chromium 141 sürümünün yerine geçti diye raporlanmaz.
- Host web build `ERR_SWC_NATIVE_CACHE` ile durdu: `cache root has a parent writable by another user without trusted sticky protection`. SWC kontrolü kapatılmadı. Aynı bağımlılıklar/Node, ağsız yerel konteynerde standart Next build ile **geçti**. Web E2E sunucuları Next'in belgelenmiş standalone çıktısından çalıştırıldı. Worker build de E2E globalSetup içinde geçti.
- İlk `pnpm verify`: lint OK, yeni E2E DOM tip hataları giderildi; 3726/3727 unit geçti. Kalan `deploy-migrate` dosya izin testi, ortamın `umask 077` değeri yüzünden 0644 fikstürü üretemedi. Yalnız test sürecinde `umask 022` ile ilgili 27 test geçti; üretim sır izin kontrolü değiştirilmedi.
- Son tam unit koşusu: `umask 022; pnpm exec vitest run --maxWorkers=2` → **101 dosya, 3727/3727 test PASS** (`.artifacts/t-903/unit-final.json`). Derlemeyle eşzamanlı önceki koşudaki 50ms performans testi 54ms ölçülmüştü; eşik değiştirilmedi, ilgili 106 test ve son tam koşu geçti.
- Lint PASS; kök `tsc --noEmit` PASS; tüm workspace `pnpm -r --if-present run typecheck` ağsız yerel konteynerde PASS (`.artifacts/t-903/workspace-typecheck.log`). Host `pnpm verify` komutu SWC nedeniyle bütünüyle yeşil sayılmıyor; ayrı doğrulamalar açıkça kaydediliyor.
- Boş tenant E2E: masaüstü + mobil **2/2 PASS**; globalSetup kayıt → `/onboarding` → rehberi tamamla → çalışma alanı → yerel MFA adımları geçti. Bu hesaplar yalnız yerel test fikstürleridir; Motive üretim tenantı/MFA kurulmadı.
- Son rehber E2E koşusu: masaüstü + mobil **8/8 PASS** (`.artifacts/t-903/e2e-final.log`): gerçek/paylaşılan demo giriş yardımcıları, üç adım, tamamla/kapat/Escape, yeniden açma, yenilemede tercih korunması, odak geri dönüşü ve ekrana sığma. Önceki geometri testindeki dize değerlendirme hatası gerçek `boundingBox` ölçümüyle düzeltildi; assertion kaldırılmadı.
- Audit export entegrasyonu: **12/12 PASS**; uygulama/auth/worker/migration bağlantılarının tamamı loopback olarak doğrulandı. Harness'in haricî bağlantı kipinin adı `neon` olsa da bu koşu yalnız yerel Postgres/PgBouncer kullandı; Neon'a bağlanılmadı.
- `check:scope --base 966079e6f8a5d4fb9ec01b0798c4ef3464f20699`, tests, ac-ratchet, assertions, pilot ve docs kontrolleri PASS. **`check:all --local` tamamen yeşil değil:** varsayılan `origin/main` (`c7200c7`) T-900–T-904 değişikliklerini de T-903 kapsamında arıyor. Bu önceden gelen değişiklikler silinmedi, kart kapsamına topluca eklenmedi ve bekçi gevşetilmedi (`.artifacts/t-903/guards.log`).
- `.gitleaksignore` ve `playwright.config.ts` korunan değişikliklerdir. İlk yedi dosya için kullanıcı tarafından yetkilendirilen tek salt okunur security-reviewer: **BLOCKER 0 / MAJOR 0 / MINOR 0**. Manifest hashleri başlangıç/sonda doğrulandı. Bu çalışma ağacı incelemesi commit/PR onayı değildir; korunan paket ayrı küçük PR ve SHA bağlı onay gerektirir. Doğru tabandaki teknik test/inceleme kapısı tamamlanınca salt okunur stok dilimine geçildi; üretim/transfer yazma adımı henüz başlamadı.

### T-903 kapsam ve inceleme kapısı — takip

- Kanıt: `HEAD`, `origin/feat/T-904-pilot-handoff` ve `git merge-base HEAD origin/feat/T-904-pilot-handoff` aynı **966079e6f8a5d4fb9ec01b0798c4ef3464f20699** değerini verdi. `origin/main` **c7200c7ee0102da2faad01096a49ef56d70d2ee3**; doğru T-903 karşılaştırma tabanı değildir. Çalışma ağacı/indeks/izlenmeyen dosyaları da kapsayan desteklenen `scope --base origin/feat/T-904-pilot-handoff` PASS. Aynı tabanda ac-ratchet ve assertions PASS. Ref'ler sahteleştirilmedi, miras değişiklikler karta eklenmedi.
- Bekçi uygulaması incelendi: `scope.mjs` açık `--base` kabul eder; `all.mjs` yalnız `--local` kabul eder. Varsayılan scope tabanı karttaki `→ int/...` veya `origin/main`dir. `guards.yml` PR tabanından güvenilir bekçi kodunu seçer fakat scope'a ayrıca `--base` geçirmez. Bu nedenle yalnız PR hedefini T-904 feature dalı yapmak scope hatasının çözümünü garanti etmez. Mevcut protokolün gerçek `int/...` dalı akışı veya ayrı testli bekçi düzeltmesi gerekir; hiçbiri bu kayıtta yapılmış sayılmaz. Main/remote ref'lerini yerelde başka commit'e işaret ettirerek yeşil sonuç üretilmedi.
- Uygulayıcı ön incelemesi: Gitleaks değişikliği üç exact commit/dosya/kural/satır fingerprint'iyle sınırlı; kural/yol muafiyeti ve scanner bayrağı değişikliği yok. Playwright değişikliği yalnız çağıranın açık ortam değişkeniyle yerel executable seçer; varsayılan tarayıcı, TLS, assertion, retry ve timeout kuralları aynı. Standalone başlatma loopback'te; globalSetup'ın dört DB bağlantısı için loopback koruması ve MFA akışı korunuyor. Rehber yardımcısı tercihi yalnız okur ve gerçek düğmelere basar. Bu inceleme **bağımsız onay değildir**.
- Bağımsız incelemeye sunulacak yedi kod/konfigürasyon dosyasının SHA256 manifesti `.artifacts/t-903/review-manifest.json` içinde; sır dosyaları manifestte yok. `docs/agents/PROTOCOL.md` §2.5 ve §Onay kaynağı bağımsız `security-reviewer`, korunan değişiklikler için ayrı küçük PR ve gerçek head SHA'sına bağlı rapor/onay kaydı ister. Henüz commit/PR yoktur; bu kayıtlar uydurulmadı. Kullanıcı tek salt okunur bağımsız incelemeciye açık yetki verdi; aynı ajan incelemeyi 0/0/0 ile tamamladı. Yeni stok dilimini de aynı ajan 0/0/0 ile inceledi; yeni geliştirme ajanı açılmadı.

### T-903 stok görünümü ve ilerleme sayacı

- İkinci dilim: `listStockOverview`, `/t/[slug]/stock` ve ana menü bağlantısı. Ürün/depo/temel birim ayrı; fiziksel/rezerve/kullanılabilir decimal metin, kural 5, tenant/depo kapsamı ve en çok 100 satırlık keyset sorgusu. Uygulama stok yazmıyor.
- Yerel gerçek PostgreSQL entegrasyonu **6/6 PASS**: kg/adet ayrımı, iki depo, rezervasyon, hasarlı/kabul/pick-blocked dışlama, altı ondalık hassasiyet, tenant/MFA, depo kapsamı, sayfalama ve filtre doğrulaması. Kök TypeScript, hedefli lint ve ağsız web build PASS. Aynı bağımsız incelemeci son 10 dosya manifestini ve ilk 7 korunan dosyanın değişmediğini doğruladı: **0 BLOCKER / 0 MAJOR / 0 MINOR**. Normal kota penceresi sonrasında son stok + ana menü E2E koşusu **8/8 PASS**, 1.2 dakika (`.artifacts/t-903/stock-e2e-complete.log`). Böylece bu salt okunur dilimin teknik kabulü tamamlandı; CI/commit/PR ve gerçek müşteri kabulü ayrı açık kapılardır.
- **İlerleme temeli:** §11 nihai pilot kabul listesinde **13 madde, 0 kapanan, 13 açık**. Bu ölçüyle kabul kapılarının %100'ü açıktır; kodun ne kadarının yazıldığına veya kalan mühendislik eforuna karşılık gelmez. Kod/test tarafında Cloud ortamı, rehber/kurulum engeli ve stok görünümü doğrulandı; aşağıdaki sekiz hazırlık paketi sayımı bu ilerlemeyi ayrıca gösterir. Depolar arası transfer, atomik üretim, sevkiyat ekranları, gerçek müşteri verileri ve cihaz kabulü bitmedi. Bu işlerin ağırlıkları/eforu bilinmediğinden güvenilir bir toplam proje yüzdesi/aralığı verilmez. Test adetleri proje yüzdesine çevrilmez.
- Mobil regresyonlar düzeltildi: rehber düğmesi iş kartlarını örtmeyecek üst çubuk alanına taşındı; kısa stok başlığı ve en az 88px saha kartları korundu. Önceki sürümden kalma menü test metinleri gerçek çevirilere eşlendi; `/help` hedefi ve rehber aç/kapat assertion’ları eklendi. Geometri/timeout/rate limit eşikleri değiştirilmedi. İlk menü testi masaüstü/mobil 2/2, stok ekranı önceki koşuda 4/4, düzen testi önceki koşuda 2/2 geçti. Sık tekrarlar yerel demo 10 giriş/10 dakika kotasını doldurdu; son toplu koşu doğal pencere sonrasında 8/8 geçti. Sayaç silinmedi ve istemci kimliği değiştirilmedi.
- Kullanıcı model tercihi: basit alt görevlerde hafif model; karmaşık geliştirme/güvenlikte uygun güçlü model. Çalışan inceleme sırf model değişimi için yeniden başlatılmaz; gereksiz alt görev oluşturulmaz.

- Son ek kanıt: tam lint, kök ve tüm workspace TypeScript PASS; son web build PASS; stok/kontrast **448/448 unit PASS**; son 10 dosyalık stok/UI kaynağında Gitleaks **0 bulgu** (`stock-unit.log`, `stock-workspace-types.log`, `stock-build-final.log`, `stock-gitleaks.json`). Bu sayılar önceki tam 3727 unit koşusunu yeni diff üzerinde tekrar yapılmış gibi göstermez.

### Kullanıcı düzeltmesi — çoklu depo ve otomatik raf

- Ürün herhangi sabit üç depo varsayımı taşımaz. İlk konuşmadaki üç depo yalnız pilot örneğidir; önceki metinlerle çelişirse bu son kullanıcı talimatı uygulanır. Depo sayısı ile teknik sayfalama/batch sınırları farklıdır.
- Mevcut özellik bulundu: `packages/domain/src/warehouse/bulk-locations.ts`, `apps/web/app/t/[slug]/easy-setup/bulk-builder.tsx`, depo detayındaki `location-tree.tsx`. Kullanıcı **bölge öneki + raf aralığı + göz aralığı** girer; ör. A, 1–10, 1–5 → 50 konum (`A-01-01 … A-10-05`). İsteğe bağlı mevcut üst lokasyon altında oluşturabilir. Koridor–raf–kat–göz ve serbest adlandırma şablonu kullanıcı tarafından kesinleştirilmiş dört boyutlu gereksinim değildir; mevcut kavramlar korunur, desteklenmeyen şablon seçimi varmış gibi gösterilmez.
- Mevcut korumalar: yazmayan sunucu önizlemesi, sayı/ilk/son/örnek kodlar, çakışma sayısı/listesi; `settings.manage`, tenant ve depo aidiyeti, üst lokasyon aynı depoda; transaction ile hepsi/hiçbiri; UUID idempotency ve eşzamanlılık kilidi. Teknik sınırlar bir işlemde 2.000, depoda toplam 50.000 lokasyondur; bunlar üç depo kısıtı değildir.
- Yeni kod yazmadan mevcut entegrasyon **36/36 PASS** (`.artifacts/t-903/bulk-locations-integration.log`): önizleme, oluşturma, çakışma/kısmi yazmama, tekrar/eşzamanlılık, tenant/yetki, ebeveyn ve kapasite. Mevcut 375px depo → 50 raf → ürün kurulum E2E **2/2 PASS** (`.artifacts/t-903/bulk-locations-e2e.log`). Yalnız yerel sentetik tenant/lokasyonlar; gerçek müşteri verisi oluşturulmadı.
- Plan: depo/kurulum aşamasında mevcut oluşturucunun görünürlüğü ve müşteri akışı doğrulanır; eksik bulunursa kontrollü düzeltme yapılır. Salt okunur stok görünümü tüm depoları aynı sorgu modelinde kapsar; pilot isimleri veya depo sayısı kodda sabitlenmez.


### Paket 4/5 son kabul — 12.10.2026 16:24 İstanbul

- Mevcut menü düzeltmesi doğrulandı: çıkış/transfer, ana menüye iki ek döşeme bindirmek yerine stok ekranındaki görünür bağlantılardan açılır. Ana menü 7 etkin/2 yakında iş; toplayıcı 4 etkin/3 yetkisiz iş. Geometri sınırları, 140px döşeme üst sınırı ve dokunma/taşma assertion'ları değiştirilmedi. Önceki dört hata son koşuda kapandı.
- Masaüstü/mobil **6/6 E2E PASS**: menü 4, stok/transfer işlem senaryosu 2 (`.artifacts/t-903/packages45-e2e.log`). Mevcut senaryodaki üretim adımları da geçti; üretim dosyası/testi bu tur genişletilmedi ve paket 6 bundan dolayı tamam sayılmadı.
- Ortak regresyon **8 dosya, 152/152 entegrasyon PASS**: belge UI, transfer, stok komutu, posting, rezervasyon, reversal, picking, shipping/returns (`packages45-integration.log`). Yalnız loopback test DB; 30 mevcut migration, bu tur yeni migration yok.
- Son ek testlerle belge/transfer **9/9 PASS**: belge 5, transfer 4 (`packages45-final-integration-recheck.log`). Başarılı manuel çıkış ve tekrarın tek stok etkisi oluşturması ayrıca sınandı. İlk ek test kesirsiz ADET fikstürüne 1.000001 verdiğinden `VALIDATION_FAILED: QUANTITY_SCALE` aldı; test verisi 1.000000 olarak düzeltildi, stok ölçek kuralı korunuyor. İlk kırmızı log saklandı (`packages45-final-integration.log`).
- İlgili stok/picking/shipping/kontrast/action unit koşusu **479/479 PASS** (`packages45-unit.log`); ardından transfer action kimlik/Origin/miktar/anahtar sınır testi eklendi, action dosyası son **5/5 PASS** (`packages45-actions-final.log`). Bunlar üst üste binen sayımlardır, toplanmaz.
- Tam lint ve kök TypeScript PASS; ek iki test dosyası lint PASS. **Genel web TypeScript FAIL:** `apps/web/app/t/[slug]/shipping/actions.ts:24`, `CancelSalesOrderInput.expectedVersion` eksik. Paket 7 kısmi dosyası kullanıcı kapsamı gereği bu tur değiştirilmedi. Genel build/verify/CI yeşil iddiası yok; paket 8 açık. Önceki `production-build.log` paket 4/5 uygulama kodunu içerir, sonraki kısmi sevkiyat dosyalarının doğrulaması değildir.
- Son dar bağımsız inceleme 0 BLOCKER / 0 MAJOR / 0 MINOR; çalışma ağacı incelemesi commit/PR onayı değildir. İlk 17 dosyalık manifest `a7eac98c7ab861b58c3570ddfe3a366879a8df18f6c8667cf257119cb677a709`; son iki test eki ve bağımsız QA kanıt değerlendirmesi de 0/0/0 ile kapandı. Son hashler ve rapor `.artifacts/t-903/packages45-review.txt` içinde.
- Üretim/sevkiyatın mevcut kısmi kodu korundu. Commit/push/PR/deploy yok. Gerçek müşteri/cihaz kabulü hâlâ **0/13**; paket 4/5 tamam ifadesi yalnız yerel yazılım kabulüdür.


### Paket 6 ve güncel yayın engeli — 12.10.2026 16:36 İstanbul

- Kullanıcı, EtkinWMS'yi son kullanıcı testine yayınlama yetkisi verdi; gerekli commit/push/taslak PR hazırlığı da bu kapsamda yetkili. CI, inceleme ve güvenli operasyon kapıları geçmeden merge/deploy yok. Yeni credential/kalıcı erişim, DNS/güvenlik ayarı, ücretli kaynak ve veri kaybettiren işlem ayrıca yetkilendirilmiş değildir. 2027-WMS-1 ve eski Fly/Neon kaynakları kapsam dışıdır.
- Üretim yerel teknik kabulü: reçete değişmezliği, çok depodan atomik tüketim/çıktı, eşzamanlı aynı anahtar, rollback, tenant/MFA/stock.post ve kaynak/hedef depo kapsamı **5/5 entegrasyon**. Mevcut sipariş sürüm/yarış regresyonuyla toplam **27/27 PASS** (`package6-integration.log`). Üretim ölçek unit 2 ve yeni action sınırları 4, **6/6 PASS** (`package6-unit.log`).
- Masaüstü/mobil **2/2 E2E PASS** (`package6-e2e.log`): reçete kaydı, gerçek tüketim/çıktı özeti, bağlı CKS/GRS belgeleri, mamul artışı ve hammadde azalışı, ikinci üretimde yetersiz stok reddi ve iki bakiyenin korunması, yatay taşma kontrolü. Eski stok/transfer adımları da aynı senaryoda geçti.
- Shipping iptal action şeması üç literal kola ayrıldı; yalnız cancel için pozitif tamsayı expectedVersion zorunlu. UI görülen sürümü ve belirsiz tekrarın aynı girdisini korur; domain sürüm/yarış kontrolü kaldırılmadı. İlk düzeltmedeki TypeScript daraltma hatası giderildi; son web typecheck ve Next build PASS (`package6-web-types-final.log`, `package6-build-final.log`). Worker build PASS (`package6-worker-build.log`).
- Tam unit regresyonunda bulunan reçete audit çeviri/allowlist eksikleri ve yeni menü yapısında null React çocuğunu okuyamayan test yardımcısı düzeltildi. Geometri/yetki/assertion kuralları azaltılmadı. Hedefli son düzeltme regresyonu162/162 PASS (`package6-regression-fixes.log`); son tam koşu **104 dosya, 3747/3747 PASS** (`package6-unit-verified.log`). Son audit çevirilerini içeren yeniden build, tam lint ve kök TypeScript de PASS (`package6-build-verified.log`, `package6-lint-verified.log`, `package6-root-types-verified.log`). Önceki kırmızı loglar silinmedi.
- Bağımsız üretim güvenlik/QA incelemesi **0 BLOCKER / 0 MAJOR / 0 MINOR**; ilgili core incelemesi korunuyor. Bu çalışma ağacı kabulüdür; gerçek commit SHA/CI/korunan PR onayı değildir.
- Güvenli yayın adayı kapsamı: tamamlanan paket1–6. Kısmi sevkiyatın `page.tsx`/menü yolu yok; yeni kullanıcı akışı yayına hazır değil. Sürüm henüz commit/imaj digest'ine bağlanmadı ve yayınlanmadı.
- **Gerçek erişim:** bu Cloud oturumunda SSH agent ve kullanıcı SSH yapılandırma dizini yok. §9'daki uygulamaya özel dağıtım yolu kurulmuş değil. Checkout'ta yalnız ci/guards workflow'ları var. `gh api .../actions/workflows` → `Forbidden`; bağlayıcının workflow-list URL'si desteklenmiyor. Bunlar canlı CI'nın yeşil olduğu veya uzak VPS erişiminin mevcut olduğu kanıtı değildir. Credential/host güveni/ağ ayarı değiştirilmedi; sunucuya bağlanılmadı.
- **Operasyon kapısı:** canlı migration sayısı son belgede27; VPS/DB güncel durumu okunamadı. 0028–0030 mevcut stok miktarını değiştirmeyen ek tablolar/kısıtlardır. Yayından önce mevcut EtkinWMS DB'nin doğrulanmış yedeği ve geri yükleme kanıtı, tam sürüm/imaj kimliği gerekir; sonra migration → worker → web, ardından derin sağlık/DB/kuyruk ve uygulama kontrolü. Yedek alındığı veya migration yapıldığı iddia edilmez.
- **Kritik rollback sınırı:** yeni bağlı transfer/üretim verisi sonrası eski guided imajı `stock_document_links` ilişkisini tanımaz; tek bacak ters kayda izin verebilir. 0028–0030 down migration'ları veri varsa bilerek reddedilir. Uyumlu ve test edilmiş rollback imajı/forward-fix veya yazmaların kapatıldığı doğrulanmış bakım prosedürü olmadan eski sürüme dönmek güvenli değildir. Veri silerek downgrade yapılmaz. Bağımsız incelemeci bu riski doğruladı; paket8 açık.
- En küçük desteklenen yayın adımı: mevcut yetkili EtkinWMS VPS yöneticisinin güvenli yönetim kanalı üzerinden yalnız bu uygulama için sınırlandırılmış dağıtım erişimini sağlaması veya doğrulanmış sürümü mevcut yetkili yoldan uygulaması. Yeni kalıcı kimlik/forced-command kurulumu ayrı somut onay ve sunucu tarafı kurulum gerektirir; kişisel SSH anahtarı veya sır sohbete istenmez. Bu görev erişim varmış gibi deploy yapmadı.
- **Login:** devir/STATE ve auth/onboarding kayıtlarında hosgorens@gmail.com hesabının canlıda oluşturulduğunu gösteren kanıt yok; müşteri bootstrap/MFA açık. Yayın hesabı oluşturmaz. Canlı hesap/reset/sır okuma işlemi yapılmadı; kullanıcının daha önce parola belirleyip belirlemediği koordinasyonda soruldu. Depoda doğrulanmış ilk yönetici bootstrap CLI yok. `packages/db/scripts/provision-motive.mjs` yalnız DB rolleri/sırları için ilk provisioning aracıdır, kullanıcı hesabı oluşturmaz ve yeniden çalıştırılmamalıdır. Bu kaynakta MAIL_MODE=disabled; canlı e-posta ayarı okunmadı. Güvenli ilk parola yöntemi kullanıcıya süreli tek-kullanımlık HTTPS davet/ilk-parola akışı olmalıdır; ilk yönetici bootstrap entegrasyonu henüz hazır değildir. Mevcut Hostinger VPS yönetim/terminal erişimini yetkili hesap sahibi doğrulamalı; kişisel anahtar/parola sohbete istenmez.

### Ertelenen yeni ürün kapsamı — sekiz pilot paketinin dışında

Kullanıcının son önceliği: önce mevcut uygulamayı görmek; aşağıdaki işler **en sona ertelendi**, şimdi uygulanmaz.

1. Self-service müşteri üyeliği: mevcut onboarding var, fakat signup ve workspace oluşturma güvenlik politikası yalnız local/ci ortamında açık; üretimde yalnız bayrak çevrilerek açılamaz. Doğrulanmış e-posta, kötüye kullanım sınırları ve tenant sahipliğiyle ayrı geliştirme/kabul gerekir.
2. Google/Apple giriş: mevcut Google/Microsoft adaptörü ve bayraklı UI var; Apple uygulanmamış. OAuth sağlayıcı uygulamaları, izinli callback/domain ve güvenli secret depolama kurulumu doğrulanmadı. Yeni sağlayıcı/credential oluşturulmadı. Mevcut account linking kapalı; e-posta eşleşmesinden platform yöneticiliği veya tenant sahipliği verilmez.
3. Platform sahibi paneli: müşteriler/tenantlar, kullanıcı adetleri ve yetkili yönetim. Mevcut tenant üyelik/owner yönetimi platform yöneticisi değildir. Ayrı platform yetkisi, MFA/audit ve tenant izolasyon testleri gerekir; varsayılan müşteri verisi erişimi yok.
4. Hedef adresler `yonet.etkinyazilim.com` ve `yonet.etkinyazilim.com.tr`; mevcut Caddy dosyasında bu hostlar yok. Salt okunur DNS sorguları bu ortamda ECONNREFUSED verdi; kayıt yok veya adres yayında sonucu çıkarılamaz. DNS/TLS/yayın doğrulanmadı, ayar değiştirilmedi.

Bu ek kapsam **7/8 pilot hazırlık sayımına dahil değildir**. OAuth/DNS/platform yönetimi için sır veya kalıcı erişim bu tur istenmedi.

### Paket7 son yerel teknik kabul — 12.10.2026

- Sevkiyat sayfası, stok ekranı bağlantısı ve tr/en metinleri tamamlandı. Sipariş açma → stok ayırma → toplama görevi → konum/ürün barkodu ve birim önizlemesi → STAGING → kısmi/tam sevk → numaralı belge geçmişi; açık/sevk edilmemiş sipariş için iki adımlı, expectedVersion korumalı iptal. Kamera mevcut bileşenle açılabilir, elle giriş kullanılabilir. İlk ekran lot/seri takipsiz ürünlerle sınırlıdır; gerçek kamera/yazıcı kabulü açık.
- Tenant/MFA/rol/depo kapsamı, sınırlı keyset sorguları, barcode birim dönüşümü ve kesin decimal miktarlar sınandı. Mevcut domain stok komutları kullanıldı; yeni migration yok. Onay beklerken düzenleme kilitli; belirsiz sonuçta aynı anahtar ve miktar korunuyor.
- Yeni sevkiyat entegrasyonu **4/4**; picking/orders/shipping-returns dahil ortak **59/59 PASS** (`package7-regression-integration.log`). Shipping ve production action sınırları **8/8 PASS** (`package7-actions.log`). Tam unit **105 dosya, 3752/3752 PASS** (`package7-unit-full.log`); ardından yalnız iki UI düzenleme kilidi ve eksik yardım metni düzeltildi, son build/lint/tip ve E2E bunları içerir.
- Son Next üretim build ve web tip kontrolü PASS (`package7-build-final.log`); tam lint/kök TypeScript PASS (`package7-lint-final.log`, `package7-root-types-final.log`). E2E hazırlığındaki worker build de geçti. Bunlar CI veya tüm `pnpm verify/check:all` kapılarının geçtiği iddiası değildir.
- Masaüstü **1/1 PASS**,28s (`package7-e2e-final.log`); mobil değişikliksiz tekrar **1/1 PASS**,26.5s (`package7-e2e-mobile-recheck.log`). Gerçek sevk response'u sunucu işlemi sonrasında düşürülür; pending düzenleme kilidi, belirsiz miktar kilidi, birebir aynı request/key ile tekrar, kalan miktar1, ikinci sevkte tamamlanma ve toplam2 belge doğrulanır. Sipariş iptali ve önceki stok/transfer/üretim akışları da geçer. Sistem Chromium154 kullanılır; sabit CI tarayıcısı ve fiziksel cihaz kabulünün yerine geçmez.
- Önceki E2E hataları saklandı: ilkinde “Tamamlandı” seçicisi işlem bildirimlerini de eşliyordu; tam durum metnine daraltıldı. Son birleşik koşuda yalnız mobil, mamul oluştururken boş ürün kodu ve “Kod önerisi alınamadı” ile sevkiyata ulaşmadan durdu; aynı kaynak/timeout/assertion ile mobil yeniden çalıştırıldığında geçti. Bu tek geçici öneri başarısızlığının kök nedeni kesinleşmedi; kalıcı ürün hatası giderildi iddiası yok. Limit/sayaç/istemci kimliği değiştirilmedi.
- Bağımsız son güvenlik/QA sonucu ve dosya manifesti `.artifacts/t-903/package7-review.txt` içinde; çalışma ağacı incelemesi commit/SHA-bağlı PR onayı değildir. Paket8 CI/korunan küçük PR/erişim/yedek-restore/uyumlu rollback kapıları açık. Commit/push/PR/deploy ve canlı hesap işlemi yapılmadı; önceki kod korundu. Müşteri/cihaz kabulü0/13.

### İlk yönetici için en küçük güvenli yol — paket7 sırasında salt okunur inceleme

- Mevcut, güvenilir tenant sahibi varsa `users.manage` yetkisiyle mevcut TENANT_ADMIN daveti kullanılabilir. E-posta teslimi hazır değilse mevcut SCREEN teslimi bağlantıyı yöneticiye yalnız bir kez gösterir; bağlantı güvenli kanaldan alıcıya iletilir. Süre72 saat, DB'de token hash'i tutulur. Yeni kullanıcı HTTPS davet ekranında parolasını kendisi belirler, sonra giriş/MFA akışını tamamlar. Bu tur davet/token/parola üretilmedi veya gönderilmedi.
- Davet kabulü `is_owner=false` üyelik oluşturur; TENANT_ADMIN rolü ilk tenant sahipliğinin yerine geçmez. Gerekirse mevcut sahip, mevcut denetlenmiş `transferOwnership` komutunu kullanır. Mevcut hesap için parola üzerine yazılmaz; eşleşen doğrulanmış e-posta gerekir.
- Hiç tenant sahibi yoksa hazır bootstrap komutu bulunmuyor. Yetkili VPS yolunda çalışacak, tek tenant/ilk sahip için dar kapsamlı ve test edilmiş bir bootstrap tamamlaması geliştirilmelidir; mevcut davet/parola ekranı yeniden kullanılabilir, ancak ilk sahipliği güvenli biçimde tamamlama ayrıca uygulanıp incelenmelidir. DB rol provisioning betiği veya production signup bayrağı bunun alternatifi değildir. Önce mevcut tenant/hesap durumu yetkili kanaldan doğrulanmalı; canlı hesap işlemi bu tur yapılmadı.

### Kod/test hazırlığı için ayrı kapı sayımı

Nihai müşteri kabulünden ayrı, §5 ve §12 sırasındaki yazılım işlerini izlemek için sekiz paket kullanılır. Eşit kapı sayımı efor/takvim yüzdesi değildir; eksik gereksinimler ve saha bulguları işi büyütebilir.

| Hazırlık paketi | Durum | Kanıt / açık iş |
| --- | --- | --- |
| 1. Bilgisayardan bağımsız Cloud geliştirme ve yerel test ortamı | Tamam | Repo/SHA/fetch, bağımlılıklar, loopback DB, ağsız build |
| 2. Giriş/kurulum/rehber yazılım engeli | Tamam | Boş tenant 2/2, rehber 8/8, otomatik raf entegrasyonu 36/36 ve E2E 2/2, ilk bağımsız inceleme 0/0/0 |
| 3. Depo/birim ayrımlı salt okunur stok görünümü | Tamam | Domain 6/6, stok + menü E2E 8/8, 448 ilgili unit, lint/typecheck/build, sır taraması ve bağımsız inceleme 0/0/0 |
| 4. Kullanılabilir stok giriş/çıkış ekranları | Tamam — yerel teknik kabul | Taslak/onay/işleme/iptal; son entegrasyon 5/5, action/transfer sınır testleri 5/5, masaüstü/mobil işlem E2E 2/2 |
| 5. Depolar arasında atomik transfer | Tamam — yerel teknik kabul | İki depo/iki belge tek transaction, rollback/replay/toplam korunumu 4/4; işlem E2E 2/2, menü 4/4 |
| 6. Atomik üretim tüketimi ve mamul girişi | Tamam — yerel teknik kabul | Üretim entegrasyonu 5/5, ölçek unit 2/2, action 4/4; başarı+yetersiz stok masaüstü/mobil E2E 2/2, build/tipler ve bağımsız inceleme |
| 7. Kullanılabilir sevkiyat ekranları | Tamam — yerel teknik kabul | Sipariş/ayırma/toplama/kısmi-tam sevk/iptal/geçmiş; yeni entegrasyon4/4, ortak59/59, action8/8, masaüstü ve mobil E2E; gerçek yanıt kaybında aynı istek/tek stok etkisi |
| 8. Son yazılım paketi/CI/inceleme kapısı | Açık | Gerçek dal tabanı ile tüm CI, commit SHA bağlı inceleme/korunan küçük PR, son regresyon |

Şu anda **7/8 tamam, 1/8 açık**. Hazırlık kapısı sayımıyla **1/8 = %12,5** açık kalır. Bu oran toplam mühendislik eforu veya canlı pilotun tamamlanma yüzdesi değildir. Canlı pilot/cihaz kabulü ayrıca **0/13 tamam** olarak izlenir.

### Yeni Cloud görevine verilecek kısa başlangıç mesajı

```text
Motive pilotunu tamamla. Yayımlanan EtkinWMS Cloud ortamını kullan.
Yalnız shosgoren/EtkinWMS deposuna yaz; 2027-WMS-1 ve kaynak servisleri salt okunur.
Mevcut feat/T-903-motive-pilot dalı ve commit edilmemiş çalışmayı koru;
docs/PILOT_HANDOFF.md ve docs/STATE.md içindeki son doğrulama kaydını oku.
T-904 tabanı 966079e; main başlangıç değildir. Üç depo ürün sınırı değildir.
Son uygulama baseline SHA'sı 024a800bace33c2dc3df397d56fda7e449d1d9dc.
Yalnız ortam değiştiyse erişim/restore kontrolünü yenile; tek aktif geliştirme dalında
belgedeki kalan işleri tamamla. Her anlamlı sonuçta aynı devir belgesini güncelle.
Üretim erişiminin var olduğunu varsayma; sırları sohbet veya Git'e koyma.
Bilgisayarımdan bağımsız ilerle, gerekli soruları bu Cloud görevinden sor.
```


## Paket8 güncel yayın devri — 12 Ekim 2026

Bu bölüm önceki “commit/push yok”, erişim ve dal durumu kayıtlarının güncel karşılığıdır. **Yayına hazır değil; otomatik deployment tetiklenmez.** Cloud geliştirme kullanıcı bilgisayarından bağımsız çalışmaktadır; bu görev VPS erişimi kurmadı ve canlıya bağlanmadı.

### Tek ürün adayı ve PR zinciri

**Tek birleşik ürün adayı: `24bfcca8f6f19d1431b11bb6722e0f9f6a90d65b`.** A+B+C ürün kodunu taşır ve GitHub'a push edilmiştir. Sonraki yalnız belge commit'leri yayın adayı değildir; bu kesin SHA değiştirilmedikçe başka branch tipini otomatik yayınlama. Üretim imaj digest'i henüz yok. Main son ürünün başlangıcı değildir.

| Sıra / taslak PR | Dal → gerçek taban | Push edilmiş tam SHA |
| --- | --- | --- |
| [#5 A](https://github.com/shosgoren/EtkinWMS/pull/5), 8 dosya | feat/T-903a-cloud-tests → int/pilot-base (`966079e6f8a5d4fb9ec01b0798c4ef3464f20699`) | `72262ee2de741c09e688dcfd86089177cb8020a8` |
| [#6 B](https://github.com/shosgoren/EtkinWMS/pull/6), 30 dosya | feat/T-903b-pilot-domain → int/pilot-infra (A SHA) | `1d2223edb4f2337f22a587b939cbc838f768edb5` |
| [#7 C](https://github.com/shosgoren/EtkinWMS/pull/7), 29 dosya | feat/T-903c-pilot-ui → int/pilot-domain (B SHA) | `24bfcca8f6f19d1431b11bb6722e0f9f6a90d65b` ürün adayı; takip eden commit'ler yalnız devir belgeleri |

Uygulama başlangıcı `024a800bace33c2dc3df397d56fda7e449d1d9dc` (T-902), belge başlangıcı T-904 `966079e6f8a5d4fb9ec01b0798c4ef3464f20699`. T-900 `80cfb10b5c651c0dfc6aa8aa1b5fd51661f3da83`, T-901 `e076fb72ff25df201c2cdc62db521dd38384aae3`, T-902 ve T-904 eski PR #1–4 ayrı taslak zincirdir; birleşmiş sayılmaz. A/B incelemeleri gerçek küçük paket tabanlarıyladır; tüm kod için tek 60+ dosyalık inceleme iddiası yok. Orijinal `/workspace/EtkinWMS` çalışma ağacı korunmuştur; aday ayrı `/workspace/EtkinWMS-packet-c` worktree'sindedir.

### Test ve inceleme kanıtı

- A bağımsız kod incelemesi `bc2efd34764a146b7bdfda874821a943071e096b`, B son inceleme `7b7d9f1fe4f17a976abdd0e53a5fbd9d4e6bc0b3`, C inceleme tek aday SHA: her biri **0 BLOCKER / 0 MAJOR / 0 MINOR**. Raporlar `docs/tasks/T-903a.md`, `T-903b.md`, `T-903c.md` içinde SHA256 manifestlidir. Bağımsız QA genel CI/restore sınırlarını açık tutar.
- Son C `pnpm verify`: lint/tipler ve **3752/3752 unit PASS**. C API tenant loader147 + operations export15 + shipping4 = **166/166 integration PASS**. B son kod AC04DB35 + export15 + drift23 + migration3 + production5 + transfer4 = **85/85 PASS**. Sayımlar örtüşür, toplanmaz. Yerel `pnpm check:all --local` tüm bekçiler PASS.
- Son aday web ve worker üretim build PASS (`package8-c-build-final.log`, `package8-c-worker-final.log`); bu tam Docker imajı build/digest kanıtı değildir.
- Exact aday Git geçmişi sır taraması: **9 commit, 0 bulgu** (`package8-c-secrets-final.json`). Yeni credential/anahtar veya üretim env dosyası yok.
- Tam loopback integration eski koşusu: **1881 PASS / 11 FAIL / 22 beforeAll nedeniyle çalışmayan test**, 105 dosya. AC04 loader/DB matrix, Drizzle metadata ve API export eksikleri düzeltildi ve hedefli tekrarlar geçti. Önceden dolu demo/job fixture'ları ile MinIO HTTP403/depolama ortamı eksikleri bu koşunun kalan sınırlamalarıdır. Genel suite yeşil sayılmaz; test/guard/baseline gevşetilmedi ve kırmızı loglar saklandı.
- Son adayda masaüstü ve mobil stok/transfer/üretim/sevkiyat E2E **2/2 PASS**, 1.2dakika (`package8-c-e2e-final.log`); gerçek yanıt kaybında aynı istek ve tek stok etkisi dahil. Sistem Chromium154, fiziksel cihaz kabulü değildir. Önceki aynı UI kaynakları masaüstü E2E1/1 ve değişikliksiz mobil tekrar1/1 geçti; son birleşik ilk mobil koşu ürün kodu önerisi alınamadığı için durmuştu. Gerçek yanıt kaybı→aynı request/key→tek stok etkisi sınandı. Bu sonuç tek seferde tüm E2E yeşil veya fiziksel kamera/yazıcı kabulü değildir.
- GitHub A guards [38261028004](https://github.com/shosgoren/EtkinWMS/actions/runs/38261028004) SUCCESS; A ci [38261027971](https://github.com/shosgoren/EtkinWMS/actions/runs/38261027971): int/verify/secrets/deps/infra SUCCESS, E2E son kontrolde sürüyor. A korunan dosya raporu ve SHA bağlı supervisor satırı PR #5'te; mekanik check-all geçti.
- B güncel ci [38263027120](https://github.com/shosgoren/EtkinWMS/actions/runs/38263027120), guards [38263112088](https://github.com/shosgoren/EtkinWMS/actions/runs/38263112088): genel ci sürüyor; guards check-all/check-pilot/test-ac SUCCESS. Eski B test-ac eksik yeni tablo fixture'ı nedeniyle başarısızdı; yeni SHA sonucu yerine eski yeşil/kırmızı kullanılmaz. C [guards38263327751](https://github.com/shosgoren/EtkinWMS/actions/runs/38263327751) check-all/check-pilot/test-ac SUCCESS; [ci38263327769](https://github.com/shosgoren/EtkinWMS/actions/runs/38263327769) henüz kesinleşmedi. **Tüm gerekli GitHub kapıları yeşil olmadan merge yok.**

Yerel ayrıntılı loglar `/workspace/EtkinWMS/.artifacts/t-903/package8-*` altındadır; runtime sırlarını içerdiği varsayılan dosyalar yayımlanmaz. Repo kartları taşınabilir sonuç/manifesttir.

### Migration27→30 ve veri koruyan geri dönüş

1. **0028 up:** değişmez `stock_document_links`, transfer/üretim belge bağları ve tenant/kısıt korumaları. Mevcut miktarları yeniden yazmaz. Down bağlı kayıt varken reddedilir.
2. **0029 up:** değişmez reçete başlığı/satırları, belge-reçete ilişkisi ve birden çok tüketim belgesini üretim çıktısına bağlama. Mevcut stok miktarlarını değiştirmez. Down reçete/ilgili veri varken reddedilir.
3. **0030 up:** reçete satırlarını başlıkla aynı transaction'da oluşturma mührü (`created_xid` ve INSERT tetikleyicisi). Sonradan satır ekleyerek reçete değiştirmek reddedilir. Down reçete varken mührü kaldırmaz.

Yerel scratch DB testleri **3/3 PASS**: boş şemada30→27→30; bağlı transfer varken28down reddi ve stok/bağ korunması; kayıtlı reçetede30down ve29down reddi, tanımların korunması. Bu testler canlı yedek/restore veya eski binary uyumluluğunu kanıtlamaz.

`guided-20261012` yalnız eski `source_kind` ilişkilerini bilir; yeni transfer/üretim bağları `stock_document_links` içindedir. Yeni işlemden sonra eski uygulamaya dönmek tek bacağı tersleyip toplamı bozabilir. **Eski imaja otomatik dönüş ve veri silerek down yasak; eski imajın disk üzerinde bulunması güvenli rollback değildir.**

Veri kaybı olmadan uygulanacak plan (henüz operasyonel olarak kanıtlanmadı):

1. Yetkili operatör canlı migration/tenant/işlem durumunu salt okunur doğrular. Yazmalar durdurulur; EtkinWMS'ye ait özel yedek/restore noktası alınır ve izole geri yükleme sınanır. Restore kanıtı, zaman ve kaynak kimliği kaydedilir; sırlar Cloud/Git'e alınmaz.
2. Adayın30şemasını ve yeni bağlı tersleme korumasını koruyan **uyumlu geri dönüş imajı** hazırlanır; exactSHA/digest ile restore edilmiş test kopyasında okuma/transfer/üretim/tersleme ve health sınanır. Alternatif aynı30şemasında test edilmiş ileri düzeltmedir. Eski guided imajı bu hedef değildir. Şu anda böyle bir imaj/digest/test kanıtı yok.
3. Sürüm kesimi yalnız tüm CI/inceleme, yedek/restore ve fallback kapıları sonrası: yazmalar kapalı → ayrı yetkili migration28→30 → yeni worker → web → HTTPS derin health ve yetkili uygulama doğrulaması → yazmaları açma. Runtime imajında migration CLI olduğu varsayılmaz; ayrı güvenli migrator yolu gerekir.
4. Hata halinde yazmalar kapalı kalır; uyumlu imaj/ileri düzeltme uygulanır ve30şeması/veri korunur. Yeni yazmalar olduysa eski yedeği körlemesine geri yüklemek veri kaybıdır; down veya eski imaja otomatik dönüş yapılmaz. Uyumlu yol yoksa bakımda kalınır ve yayın bloke edilir.

### Yayın dosyaları, erişim ve bootstrap

- `Dockerfile`, `deploy/vps/compose.yml`, `deploy/vps/Caddyfile`, `marketing/server.mjs` ve28–30migration dosyaları adayda mevcuttur. Dockerfile Node24digest'i sabitler ve runtime node kullanıcısıdır; web/worker aynıimajdır. Public compose yalnız geçici kopyada env_file referansları boş test dosyasına çevrilerek `config --quiet` ile doğrulandı. Gerçek `/opt/.../web.env`/`worker.env` okunmadı; bu sentaks doğrulaması runtime yapılandırması kanıtı değildir. Tam aday üretim Docker imajı/digest'i henüz hazırlanmadı.
- Kaynak teslimi `git archive <tam-aday-SHA>` ile yalnız takipli dosyalardan yapılmalı; `.env`, özel anahtar, node_modules, .git veya testlogları eklenmemeli. İmaj, kaynak arşivi ve kullanılan compose/Caddyfile için SHA256 manifesti operatörce karşılaştırılmalı; yeni benzersiz release dizini kullanılmalı. `current`, namedvolume'lar ve eski release üzerinde yıkıcı işlem yok.
- Yerel görevden gelen [Hostinger devir kaydı](https://github.com/shosgoren/EtkinWMS/blob/23ef67e537415d82431802d3963bf0e86c4fe922/docs/HOSTINGER_RUNBOOK.md) yalnız `git show` ile okundu; kendi güncel STATE/PILOT dosyalarımız eski dal üzerine reset/cherry-pick edilmedi. **Yerel görev bildirimi:**12.10.2026 17:16İstanbul, önceden onaylı SSH başarılı, guided-20261012, dörtservis veHTTPS status/db/queue/worker OK. Bu Cloud'un yaptığı canlı kontrol değildir; yeni adayın yayın kanıtı değildir.
- Kullanıcının son yetkisiyle yerel görev bilgisayardan bağımsız GitHubActions + yalnızEtkinWMS forced-command kimliğini kurmaktadır. `.github/workflows/deploy*` ve `deploy/vps/automation*` o göreve ayrılmıştır; burada değiştirilmedi. Kişisel/root özelanahtar Cloud'a alınmaz. Kurulumun ve yetkili tetiklemenin başarı kanıtı gelmedi; erişim hazır sayılmaz. CI/rollback açık aday için otomatik deployment tetiklenmez.
- İlk yönetici hosgorens@gmail.com için canlı hesap/tenant sahipliği/MFA kanıtı yok. Mevcut yetkili owner varsa mevcut72saat tek-kullanımlık HTTPSdavet ve kullanıcının kendi belirlediği parola akışı kullanılabilir. Davet `is_owner=false` oluşturur, TENANT_ADMIN ilk sahip değildir. Owner yoksa dar/testli ilk-sahip bootstrap tamamlanmalıdır; DBrol provisioning betiği veya production signup açmak çözüm değildir. Bu görev hesap/parola/token oluşturmadı.

**Açık kapılar:** sonGitHubCI/E2E + birleşme kapısı; exact üretim imajı/digest ve migration çalıştırma yolu; canlı yedek/restore kanıtı;30şeması uyumlu fallback/ileri düzeltme testi; otomasyon kurulum/tetikleme kanıtı; ilk sahip/bootstrap/MFA; gerçek müşteri/cihaz kabulü0/13. Yazılım hazırlığı7/8; paket8 kapanmadı.

### Cloud devam kaydı — 12.10.2026

Kullanıcı bilgisayarını kapatırken kalan geliştirme ve otomasyon işi Cloud'a devredildi. Eski yerel operatör sahipliği notları bu kayıtla güncellenir; kişisel/root anahtar Cloud'a aktarılmaz. Yalnız EtkinWMS kapsamı geçerlidir.

[PR8](https://github.com/shosgoren/EtkinWMS/pull/8) exact head `2a706b3dae936d2d94b19b132cad1b7ba99ffc13`: bağımsız security-reviewer0BLOCKER/0MAJOR/0MINOR; exact dosyalar üzerinde12/12Python ve Bash PASS. Önceki schema bağı bulgusu kapandı: build öncesi kaynak fingerprint'i image config etiketine yazılır; aynı arşiv attestation ile bağlanır ve receiver approved schema ile Dockerload öncesi eşleştirir. Üç sentetik gitleaks istisnası PR5/72262ee ile byte-identical ve açık kullanıcı onaylıdır.

[CI38268388457](https://github.com/shosgoren/EtkinWMS/actions/runs/38268388457) terminalSUCCESS: verify/infra/secrets/deps/int/E2E. Entegrasyon99dosya/1895test, E2E64test PASS. Bu main tabanlı otomasyon adayının sonucudur; ürünA/B/Csonuçlarının yerine geçmez. Gerçek rapor PRaçıklamasında; guards38269540155 yalnızPROTECTED_NO_APPROVAL nedeniyle kırmızı, bağlıtest-acçalışmadı. Supervisor onay satırı eklenmedi; tüm kapılar yeşil olmadan merge yok.

Yerel operatörün kısıtlı VPSkimliği/checkbaşarısı bildirimi bağımsızCloudrunnerkanıtı değildir. Cloud'dan HTTPShealthsaltokunur denemesi `Tunnel connection failed: 403 Forbidden` verdi; proxy/erişim sınırı aşılmadı. Main'e normalmerge sonrası mevcut environment ile `deploy-vps / mode=check` runURL ve gerçekhealthsonucu kaydedilmelidir. Bu oturumun GitHubconnector araçlarında workflow_dispatch yok; CLI `gh auth status` mevcutGH_TOKEN için invalid bildiriyor. Sır/kişiselanahtar istenmez; desteklenen dispatch yeteneği sağlanmazsa mainworkflow hazır olduğunda GitHubUI'dan yalnızcheck başlatılması gereken en küçük kullanıcı adımıdır.

ÜrünA/B/CeskiCIhead'leri int/verify/infra/secrets/deps yeşil, E2E30dk timeout/cancelled ile sonlandı. A'daki rehber/tema beklentileri, kamera örtüşmesi ve gerçek UI ortak oturum düzeltmesiyle tam72test yeniden doğrulanıyor; kod push/inceleme ve sonrakiA→B→Czinciri tamamlanmadan eski24bfcca yayın adayı güncel/yeşil sayılmaz. Canlı schema27fingerprint `b5a999421a7528cb8b1c1f3f77dcee6769c30397f8af69fea9522af2342717ae` değiştirilmedi. 27→30 yetkili geçiş, yedek/restore, uyumlu30rollbackbaseline, ilkowner/MFA ve cihaz kabulü açık kalır.


Son kaynak teslim kanıtı: `git archive` ile exact adaydan `etkinwms-24bfcca-source.tar.gz` üretildi; SHA256 `4f8e925bd266243ec451bba15bd9bc482b5a7439100262b584366b6adab938db`. Arşiv ve `package8-release-manifest.txt` Cloud `.artifacts/t-903/` dizinindedir; imaj veya canlı release değildir. Dockerfile, compose, Caddyfile, marketing ve altı migration dosyasının SHA256 özetleri manifestte; bunlar exact Git SHA'dan yeniden üretilebilir. Yerel `.env` veya çalışma ağacının takip edilmeyen dosyaları arşive alınmadı; depodaki kamuya açık `.env.example` bir sır değildir.

Yeni A→B→C hazırlık zinciri: PR5 b265a23d6b2e6aa06da940de2602d46fa750bc2b → PR6 51b21ba912b02537ddc90ee3e18fa501ed7a2720 → ürün kodu adayı098a76bf29fdf4f6dfd08051100c626604702643 (PR7son belge head'i ayrıca CIile izlenir). A17/B30/C30dosya; A f0c9009 ve B507df67exact bağımsız incelemeleri0/0/0. C098a76b exact bağımsız incelemesi0/0/0; öncekiC24kod/testdosyası byte-identical, kalan z-index ve menütestdeltaları incelendi. Ason receiving12/12PASS; kesintisiz72test sonkoşu sürüyor. A/B yeniCIhenüzterminaldeğil.

Temel T900/T901 incelemesinde malformedURL ile marketing süreci kapanması MAJOR bulundu ve ayrı feat/T-901a-foundation-fix dalında düzeltildi. Push edilmiş head a6f3f15ac342e9a802e6606aab794cf2ddd3a22a, incelenmiş kod a7080db2fcb1a01b3c1779f103f9ad8e00676f42; bağımsız0/0/0 ve loopbackregresyon1/1PASS. Bu düzeltme henüz yukarıdaki ürün adayı/main içinde değildir; main entegrasyonunda ayrı dar paket olarak alınmalıdır. Canlı forma istek veya e-posta gönderilmedi. Ürün adayı yayına hazır değildir.

## Güncel zincir ve kabul sınırı — 12.10.2026 16:08 UTC

Bu bölüm önceki aday/CI durum kayıtlarını günceller. A PR5 `48184f824e3f06d885aa9502559e776961b08b53` → B PR6 `e14fd11fc0a697ecf6db2d668ced5c6ad42db82e` → C ürün kodu adayı `b7e24a8b8bbf2ff63ed682d3e75cc9a2322bd3db`. Tabanlar sırasıyla int/pilot-base966079e, int/pilot-infraA481, int/pilot-domainBe14; normal merge kullanıldı. C sonraki belge head'i ayrıca PR7/CI üzerinden izlenir. Foundation a6f3f15 ve otomasyon2a706b3 henüz bu ürün adayının parçası değildir; tek yayınlanabilir main adayı oluşmadı.

A önceki b265 exact dokuz GitHub işiSUCCESS/E2E72PASS. B51b exact E2E70PASS2FAIL yalnız eski lookup başlığı; A sabit locale anahtarı bunu düzeltir. C77d exact E2E74PASS4FAIL iki fixture kirlenmesi ve iki Şimdi kartı çakışmasıydı. Yeni C production build PASS; Şimdi desktop/mobile2/2PASS43.6s; ayrı gerçek signup/onboarding/MFA pilot tenant ile stock+empty+easysetup6/6PASS1.7m. Masaüstü stok yazımından sonraki mobil boş tenant/kurulum testleri aynı koşuda geçti. Lint/tsc/diffcheckPASS; test eşikleri, auth/rate-limit ve guardlar değiştirilmedi. Yeni exacthead GitHub sonuçları tamamlanmadan eski sonuçlar yerine konmaz.

**Açık tasarım kabulü:** min-content CSS başlıkla çakışmayı önlüyor; dolu yedi iş ekranında tüm işler360x740 ilkviewport'a sığmıyor. DESIGN_REVIEW§7.4/7.4.1 kaydırmasız görünüm ister.390x664'te mevcut D04b dikey formülü her döşemede en az109.8px: dört satır439.2+aralık32+Yakında48=519.2px; başlık/appbar/nav sonrası498px var, Şimdi kartı hariç. Mevcut testin yeşil olması bu tasarım şartını kanıtlamaz. Yatay kompakt düzen ve gerçek içerik kutusu geometrisinin birlikte tasarlanması ayrı kabul kararı gerektirir; mevcut ölçü/spec/test korumaları gevşetilmedi. Ürün hazır değildir.

PR5 yenihead onay satırının CI tamamlanmadan güncellenmesi otomatik approval review tarafından reddedildi. Satır kaldırıldı; gerçek exacthead bağımsız rapor ve CI tamamlanmadan merge yapılmaz. PR8 için parent'ın exact2a706b3 mainmerge+yalnızcheck kullanıcı sorusunun gerçek cevabı bekleniyor; onay varsayılmadı. Migration27→30, yedek/restore, uyumlu rollback, owner/MFA ve cihaz kabulü engelleri aynen açık.
