# Etkin WMS — Motive pilotu ve Cloud devir kaydı

**Belge sürümü:** 1.0  
**Son doğrulama:** 12 Ekim 2026, 14:39 Europe/Istanbul  
**Durum:** Altyapı yayında; müşteri pilotu tamamlanmadı.  
**Bugünkü hedef:** 12 Ekim 2026, 22:00 Europe/Istanbul. Teslim garantisi verilmedi.

Bu dosya, sonraki geliştirme görevinin başlangıç kaydıdır. Sohbet belleği yerine Git'teki bu belgeyi ve gerçek kod/test durumunu kullan. Buradaki eski bir doğrulamayı yeni çalışma ortamının doğrulaması gibi sunma. Belgeyi her anlamlı değişiklikte güncelle; sır, parola, özel anahtar veya bağlantı parolası ekleme.

## 1. Değişmez kullanıcı talimatları

- Ürün adı **Etkin WMS**. Motive WMS adı kullanılmaz. Motive Rubber ilk müşteridir; ürün yalnız bu müşteriye özel tasarlanmaz.
- Ürün, sektör bağımsız depo/stok/operasyon SaaS'ı olarak ileride diğer müşterilere aylık kiralanacak.
- İlk öncelik Motive Rubber'ın üç deposunda gerçek çalışan miktarsal stok, üretim ve sevkiyat pilotudur.
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
| Üç depo | Domain'de depo/konum altyapısı var | Gerçek Motive tenant içinde Hammadde / Üretim / Sevkiyat depolarını kur; gerçek stok miktarı uydurma |
| Ürün ve birim | Ürün, birim, barkod/dönüşüm altyapısı ve yönetim ekranları var | Müşterinin gerçek ürünlerini ve kg/adet gibi birimlerini hazırla; karışık birimleri toplam tek sayı gibi sunma |
| Mal kabul / yerleştirme | Mevcut çalışan domain komutları ve saha ekranları var | Yeni müşteri, gerçek kayıtlar ve cihazlarla uçtan uca kabul testi |
| Stok / transfer / çıkış | Stok ledger, transaction, rezervasyon ve kilit altyapısı var | Bazı UI işlemleri hâlâ kilitli; kullanılabilir stok görünümü, giriş/çıkış ve üç depo transferini tamamla |
| Üretim | Genel stok çekirdeği kullanılabilir | Reçete/BOM ve üretim tüketimi/mamul girişi tam uygulanmadı; atomik işlem ve miktar izini tamamla |
| Sevkiyat | Sipariş, tahsis, toplama, kısmi sevk domain komutları var | Müşteriye kullanılabilir sevkiyat ekranlarını tamamla; eksikliği görünmez kılma |
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
5. **Bu devir kaydı hazırlanırken aktif ana sohbet hâlâ yerel bilgisayarda çalışıyor.** Sonraki doğru Cloud görevi henüz doğrulanmadı. Kullanıcıya bilgisayar kapalıyken geliştirme sürüyor deneme.

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
- [ ] Üç gerçek depo ve uygun kabul/raf/sevk konumları; hiçbir uydurma açılış stoğu yok.
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

### Yeni Cloud görevine verilecek kısa başlangıç mesajı

```text
Motive pilotunu tamamla. Yayımlanan EtkinWMS Cloud ortamını kullan.
Yalnız shosgoren/EtkinWMS deposuna yaz; 2027-WMS-1 ve kaynak servisleri salt okunur.
Önce origin/feat/T-904-pilot-handoff dalını fetch et; temiz çalışma durumunu koruyarak
bu dalın docs/PILOT_HANDOFF.md ve docs/STATE.md dosyalarını oku.
Son uygulama baseline SHA'sı 024a800bace33c2dc3df397d56fda7e449d1d9dc.
Repo/ortam/SHA ve restore sağlık kontrolünü doğrula; sonra yeni geliştirme dalında
belgedeki kalan işleri tamamla. Her anlamlı sonuçta aynı devir belgesini güncelle.
Üretim erişiminin var olduğunu varsayma; sırları sohbet veya Git'e koyma.
Bilgisayarımdan bağımsız ilerle, gerekli soruları bu Cloud görevinden sor.
```
