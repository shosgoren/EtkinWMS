# Etkin WMS — güncel devam durumu

Son salt okunur doğrulama: **13.10.2026 09:21–09:25 Europe/Istanbul**.
Sahip: bu teslimi yapan operatör/AI. Bu tarih sonrası değişiklik varsa yeniden dar kontrol yap.

## Doğrulanmış durum
- Repo: https://github.com/shosgoren/EtkinWMS ; referans repo 2027-WMS-1 salt okunur.
- Son incelenen uygulama kodu/main snapshot SHA: `a6d2ef4979451b21cd986d3be5ff94ddc1e6ddae` (PR15 merge).
- PR15 pilot zinciri + PR16 ürün kart türleri/birimler + PR17 MFA QR/rehber/SelectField main'de.
- Aynı SHA'da verify/infra/secrets/deps/int/e2e/check-all/test-ac/check-pilot success.
- Aynı SHA deploy işinde failure var; kod/CI başarısı canlıya geçtiği anlamına gelmez.
- VPS: Hostinger `187.7.76.72`; uygulama https://wms.etkinyazilim.com .
- Satış: https://etkinyazilim.com ; .com.tr ve www adresleri ana satış adresine yönlenir.
- Canlı current: `/opt/etkinwms/releases/guided-20261012`.
- Canlı web/worker/marketing imajı: `etkinwms:guided-20261012`; bu etiket Git SHA'sı değildir.
- Beş servis çalışıyor: web, worker, marketing, Caddy proxy, VPS PostgreSQL18.
- Gerçek DB: `etkinwms-postgres:5432/etkinwms`; public port yok, doğrulanan TLS.
- Canlı migration defteri **0027 / 27 kayıt**; kaynak ağacında **0031** var.
- Deep health: status/db/queue/worker `ok`; bu iş akışlarının tamamının kabulü değildir.
- Motive `motive`: ACTIVE owner/admin var; hedef yönetici parola ve MFA kurmuş.
- Gerçek kullanıcıyla bu oturumda login/cihaz kabulü yeniden denenmedi; hazır varsayma.
- Otomasyon main-only forced-command SSH; gerçek GitHub→VPS check run38276859152 geçti (12 Ekim).
- Approved schema27 fingerprint: `b5a999421a7528cb8b1c1f3f77dcee6769c30397f8af69fea9522af2342717ae`.
- Neon'dan VPS'ye restore/kesim doğrulandı; Neon runtime bağımlılığı yok. Kaynak silinmedi.

## Kalan iş — öncelik sırası
1. Yeni kullanıcı/ilk giriş durumunu yeniden kullanma: parola ve MFA zaten var. Eski INVALID_TOKEN / eksik-owner durumu çözülmüş olabilir; bu snapshot'ta yeni hesap açma gerekmez.
2. Güncel main için schema27→31 yayın planı: backup + izole restore + migration testleri + schema31 uyumlu fallback imajı + koordineli kesim. Yalnız approved hash'i değiştirmek YASAK.
3. Exact yeni imaj/digest/provenance ve son zorunlu CI; sonra gerçek yayın, health ve iş akışı kabulü.
4. Motive üç depo, kartlar/birimler, giriş/transfer/üretim/sevkiyat ve ters kayıt; kamera ve Epson/etiket çıktısını gerçek cihazlarda doğrula. Gerçek cihaz kanıtı henüz bu teslimde yok.
5. Otomatik DB yedeği, ayrı yerde şifreli kopya, restore tatbikatı ve RPO/RTO ölçümü: yapılandırma/başarı henüz doğrulanmadı.
6. Mail teslimi ve parola kurtarma işletimi; mevcut MAIL_MODE=disabled. Abonelik/ödeme/hukuki metinler ticari SaaS kabulüyle ayrı iş.

## Çakışma / yanlış devam önleme
- Repo T-911 artık ürün kartı türü/birimlerdir; eski Cloud'un yayımlanmamış T911 renewal çalışması aynı ID değildir. Yeni kart için önce dosya ve PR taraması yap.
- Cloud görevinde 12 Ekim kullanım limiti yüzünden duruş ve commit edilmemiş renewal kodu bildirildi. O çalışma main'e geçti varsayılmaz; bu oturum Cloud kodunu değiştirmedi.
- Eski açık PR'ların bir kısmı PR15 zincirinde bulunuyor; aynı kodu tekrar merge/cherry-pick etme. `git merge-base --is-ancestor` ile kanıtla.
- Sonraki AI önce bu 50 satırı, sonra yalnız gerekli kısa rehberi okusun.
- Bugünkü iş sadece belge düzeni; canlı release, hesap, schema veya yayın korumaları değiştirilmedi.

## Son belge teslimi
- T-914: eski görev kartları, toplu master ve tekrarlanan üç devir snapshot'ı ağaçtan kaldırıldı; önceki içerik decbbe03 Git snapshot'ında korunuyor. Başlangıç docs/README.md → continuity + STATE. Yeni task ID T-915+. Ürün/canlı/DB durumuna bu belge işi müdahale etmedi.
