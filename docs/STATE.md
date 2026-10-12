# EtkinWMS bağımsız pilot durumu

Güncel devir: [PILOT_HANDOFF.md](PILOT_HANDOFF.md), son “Paket8 güncel yayın devri” bölümü.
Yalnız shosgoren/EtkinWMS; 2027-WMS-1 ve eski Fly/Neon kaynaklarına işlem yok.
Cloud geliştirme bilgisayardan bağımsız çalışıyor; Cloud VPS erişimi ve yayın hazırlığı doğrulanmadı.

Tek ürün adayı: `24bfcca8f6f19d1431b11bb6722e0f9f6a90d65b`, push edildi.
Dal: feat/T-903c-pilot-ui; worktree: /workspace/EtkinWMS-packet-c.
Sonraki belge commit'leri aday kodu değiştirmez; yayın hedefi hareketli dal adı değildir.
Orijinal /workspace/EtkinWMS çalışma ağacı korunuyor; reset yapılmadı.
Başlangıç: uygulama024a800bace33c2dc3df397d56fda7e449d1d9dc, T904belge966079e6f8a5d4fb9ec01b0798c4ef3464f20699; main geridedir.

[PR #5 A](https://github.com/shosgoren/EtkinWMS/pull/5): feat/T-903a-cloud-tests → int/pilot-base(966079e), 8 dosya.
A HEAD: 72262ee2de741c09e688dcfd86089177cb8020a8; kod incelemesi: bc2efd34764a146b7bdfda874821a943071e096b.
[PR #6 B](https://github.com/shosgoren/EtkinWMS/pull/6): feat/T-903b-pilot-domain → int/pilot-infra(A HEAD), 30 dosya.
B HEAD: 1d2223edb4f2337f22a587b939cbc838f768edb5; kod incelemesi: 7b7d9f1fe4f17a976abdd0e53a5fbd9d4e6bc0b3.
[PR #7 C](https://github.com/shosgoren/EtkinWMS/pull/7): feat/T-903c-pilot-ui → int/pilot-domain(B HEAD), 29 dosya.
C incelemesi tek aday SHA üzerindedir. Üç bağımsız inceleme 0 BLOCKER / 0 MAJOR / 0 MINOR.
Manifest ve raporlar docs/tasks/T-903a.md, T-903b.md, T-903c.md içindedir. PR'lar taslak; merge/deploy yapılmadı.

Son C verify: lint/typecheck ve 3752 unit PASS; C166 integration PASS; B85 integration PASS (sayımlar örtüşür).
Son aday masaüstü/mobil E2E2/2 PASS (stok/transfer/üretim/sevkiyat, yanıt kaybında aynı istek ve tek etki).
Son aday web ve worker üretim build PASS. Tam üretim Docker imajı/digest henüz yok.
Yerel tüm bekçiler PASS; adayın9commit geçmişinde gitleaks0bulgu.
Tam loopback suite:1881PASS/11FAIL/22beforeAll nedeniyle çalışmayan test; yeni schema/registry/AC eksikleri düzeltildi.
MinIO403 ve dolu demo/job fixture sınırları açık; genel loopback suite yeşil sayılmaz.
GitHub A guards SUCCESS; A ci int/verify/secrets/deps/infra SUCCESS, E2E sürüyor.
C guards (38263327751) check-all/check-pilot/test-ac SUCCESS. B guards da SUCCESS; B ve C genel CI kesinleşmedi.
Sonraki iş exact SHA güncel CI sonuçlarını oku; bütün kapılar yeşil olmadan merge/deploy yok.

Yerel migration30; canlı27 yalnız eski bildirim, Cloud doğrulamadı.
28 belge bağları,29 reçeteler,30 transaction mührü ekler; mevcut miktarları yeniden yazmaz.
Scratch DB3/3PASS: boş30→27→30; verili down reddi ve kayıtların korunması.
Yeni bağlı stok verisinden sonra guided-20261012 tek bacak tersleme riski taşır; eski imaja/down otomatik dönüş yok.
Plan: yazmaları durdur → yedek ve izole restore →30uyumlu fallback/ileri düzeltme testi → migration → worker → web → health.
Canlı yedek/restore ve uyumlu fallback imaj/digest kanıtı YOK; yayın KAPALI.
Public compose sentaksı geçici boş env referanslarıyla PASS; gerçek env okunmadı.

Yerel HOSTINGER_RUNBOOK commit23ef67e537415d82431802d3963bf0e86c4fe922 yalnız okundu.
Yerel görev bildirimi12.10.2026 17:16İstanbul: onaylı SSH, guided-20261012, dört servis ve HTTPS deep health OK.
Bu Cloud'un canlı kontrolü veya yeni adayın yayın kanıtı değildir.
Son yetkiyle yerel görev GitHubActions ve EtkinWMS forced-command otomasyonunu kuruyor; başarı kanıtı bekleniyor.
.github/workflows/deploy* ve deploy/vps/automation* yerel göreve ait; burada değiştirilmez.
Kişisel/root anahtar Cloud'a istenmez. CI/rollback açık aday için otomatik deployment tetiklenmez.

İlk hesap/owner bootstrap ve MFA açık; TENANT_ADMIN daveti is_owner=false oluşturur, ilk sahip yaratmaz.
Owner yoksa dar/testli bootstrap gerekir; production signup veya DB rol provisioning çözüm değildir.
Hazırlık7/8, paket8 açık. Müşteri/cihaz kabulü0/13; kamera/yazıcı kabulü bekliyor. Üç depo ürün sınırı değildir.
Sosyal üyelik, Google/Apple ve platform yönetim paneli sekiz pilot paketinin dışında en sona ertelendi.
