# Etkin WMS — güncel devam durumu

Son salt okunur doğrulama: **13.10.2026 10:00 (canlı release/schema); hesap snapshot 09:21–09:25 Europe/Istanbul**.
Sahip: bu teslimi yapan operatör/AI. Bu tarih sonrası değişiklik varsa yeniden dar kontrol yap.

## Doğrulanmış durum
- Repo: https://github.com/shosgoren/EtkinWMS ; referans repo 2027-WMS-1 salt okunur.
- Son incelenen main/live SHA: `decbbe03fe1192473e096a1feb60cf090ca1fcf2` (PR18 belge merge; uygulama kodu a6d2ef4 snapshot'ıyla aynı).
- PR15 pilot zinciri + PR16 ürün kart türleri/birimler + PR17 MFA QR/rehber/SelectField main'de.
- Aynı SHA'da verify/infra/secrets/deps/int/e2e/check-all/test-ac/check-pilot success.
- GitHub deploy run38359525975 success; SSH release/current ve DB defteri ayrıca doğrulandı. Önceki başarısız run canlı durum değildir.
- VPS: Hostinger `187.7.76.72`; uygulama https://wms.etkinyazilim.com .
- Satış: https://etkinyazilim.com ; .com.tr ve www adresleri ana satış adresine yönlenir.
- Canlı current: `/opt/etkinwms/releases/auto-decbbe03fe1192473e096a1feb60cf090ca1fcf2`.
- Canlı web/worker/marketing imajı: `etkinwms:decbbe03fe1192473e096a1feb60cf090ca1fcf2`.
- Beş servis çalışıyor: web, worker, marketing, Caddy proxy, VPS PostgreSQL18.
- Gerçek DB: `etkinwms-postgres:5432/etkinwms`; public port yok, doğrulanan TLS.
- Canlı migration defteri **0031 / 31 kayıt**; kaynak ağacında da **0031** var.
- Deep health: status/db/queue/worker `ok`; bu iş akışlarının tamamının kabulü değildir.
- Motive `motive`: ACTIVE owner/admin var; hedef yönetici parola ve MFA kurmuş.
- Gerçek kullanıcıyla bu oturumda login/cihaz kabulü yeniden denenmedi; hazır varsayma.
- Otomasyon main-only forced-command SSH; gerçek GitHub→VPS check run38276859152 geçti (12 Ekim).
- Receiver'ın doğruladığı schema31 fingerprint: `d6b6b9d7fb725f66b773e7c4fa42df63cdf90db4fe94ee86bfb22e1e9f8488dd`.
- Neon'dan VPS'ye restore/kesim doğrulandı; Neon runtime bağımlılığı yok. Kaynak silinmedi.

## Kalan iş — öncelik sırası
1. Yeni kullanıcı/ilk giriş durumunu yeniden kullanma: parola ve MFA zaten var. Eski INVALID_TOKEN / eksik-owner durumu çözülmüş olabilir; bu snapshot'ta yeni hesap açma gerekmez.
2. Canlı schema31 geçişinin backup/restore/fallback kanıtını ilgili operatör kaydından doğrula; bu belge oturumu kesimi yapmadı. Yalnız approved hash değiştirme YASAK.
3. Sonraki uygulama yayını exact imaj/digest/provenance ve zorunlu CI ister. Mevcut release health OK; kullanıcı iş akışı kabulü ayrıca yapılmalı.
4. Motive üç depo, kartlar/birimler, giriş/transfer/üretim/sevkiyat ve ters kayıt; kamera ve Epson/etiket çıktısını gerçek cihazlarda doğrula. Gerçek cihaz kanıtı henüz bu teslimde yok.
5. Otomatik DB yedeği, ayrı yerde şifreli kopya, restore tatbikatı ve RPO/RTO ölçümü: yapılandırma/başarı henüz doğrulanmadı.
6. Mail teslimi ve parola kurtarma işletimi; mevcut MAIL_MODE=disabled. Abonelik/ödeme/hukuki metinler ticari SaaS kabulüyle ayrı iş.

## Çakışma / yanlış devam önleme
- Repo T-911 artık ürün kartı türü/birimlerdir; eski Cloud'un yayımlanmamış T911 renewal çalışması aynı ID değildir. Yeni kart için önce dosya ve PR taraması yap.
- Cloud görevinde 12 Ekim kullanım limiti yüzünden duruş ve commit edilmemiş renewal kodu bildirildi. O çalışma main'e geçti varsayılmaz; bu oturum Cloud kodunu değiştirmedi.
- Eski açık PR'ların bir kısmı PR15 zincirinde bulunuyor; aynı kodu tekrar merge/cherry-pick etme. `git merge-base --is-ancestor` ile kanıtla.
- Sonraki AI önce bu 50 satırı, sonra yalnız gerekli kısa rehberi okusun.
- Bu oturum sadece belge düzeni/readonly kontrol yaptı; canlı release/schema dış yayın akışında değişti. Hesap veya yayın korumaları bu oturumdan değiştirilmedi.

## Son belge teslimi
- T-914: eski görev kartları, toplu master ve tekrarlanan üç devir snapshot'ı ağaçtan kaldırıldı; önceki içerik decbbe03 Git snapshot'ında korunuyor. Başlangıç docs/README.md → continuity + STATE. Yeni task ID T-915+. Ürün/canlı/DB durumuna bu belge işi müdahale etmedi.
