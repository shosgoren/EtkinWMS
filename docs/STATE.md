# EtkinWMS bağımsız pilot durumu

Güncel devir: [PILOT_HANDOFF.md](PILOT_HANDOFF.md), son “Paket8 güncel yayın devri” bölümü.
Yalnız shosgoren/EtkinWMS; 2027-WMS-1 ve eski Fly/Neon kaynaklarına işlem yok.
Cloud geliştirme bilgisayardan bağımsız çalışıyor; kullanıcı kalan işi bu Cloud görevine devretti.
GitHub runner → VPS bağlantısı ve yeni ürün yayını henüz doğrulanmadı; kişisel/root anahtar alınmaz.

Ürün kodu adayı: `b7e24a8b8bbf2ff63ed682d3e75cc9a2322bd3db`; son push/CI aşağıdaki zincirle izlenir.
Dal: feat/T-903c-pilot-ui; worktree: /workspace/EtkinWMS-packet-c.
Sonraki belge commit'leri aday kodu değiştirmez; yayın hedefi hareketli dal adı değildir.
Orijinal /workspace/EtkinWMS çalışma ağacı korunuyor; reset yapılmadı.
Başlangıç: uygulama024a800bace33c2dc3df397d56fda7e449d1d9dc, T904belge966079e6f8a5d4fb9ec01b0798c4ef3464f20699; main geridedir.

[PR #5 A](https://github.com/shosgoren/EtkinWMS/pull/5): feat/T-903a-cloud-tests → int/pilot-base(966079e), 17 dosya.
A HEAD: 48184f824e3f06d885aa9502559e776961b08b53; kod incelemesi: 48184f824e3f06d885aa9502559e776961b08b53.
[PR #6 B](https://github.com/shosgoren/EtkinWMS/pull/6): feat/T-903b-pilot-domain → int/pilot-infra(A HEAD), 30 dosya.
B HEAD: e14fd11fc0a697ecf6db2d668ced5c6ad42db82e; kod incelemesi: 59af35db7c92f924ccd8a47f90b534770c8feb91.
[PR #7 C](https://github.com/shosgoren/EtkinWMS/pull/7): feat/T-903c-pilot-ui → int/pilot-domain(B HEAD), 30 dosya.
C b7e24a8 security0/0/0, QA/tasarımBLOCKER1; A481 ve B59af bağımsız incelemeleri0/0/0.
Manifest ve raporlar docs/tasks/T-903a.md, T-903b.md, T-903c.md içindedir. PR'lar taslak; merge/deploy yapılmadı.

Son C verify: lint/typecheck ve 3752 unit PASS; C166 integration PASS; B85 integration PASS (sayımlar örtüşür).
Son aday masaüstü/mobil E2E2/2 PASS (stok/transfer/üretim/sevkiyat, yanıt kaybında aynı istek ve tek etki).
Son aday web ve worker üretim build PASS. Tam üretim Docker imajı/digest henüz yok.
Yerel tüm bekçiler PASS; adayın9commit geçmişinde gitleaks0bulgu.
Tam loopback suite:1881PASS/11FAIL/22beforeAll nedeniyle çalışmayan test; yeni schema/registry/AC eksikleri düzeltildi.
MinIO403 ve dolu demo/job fixture sınırları açık; genel loopback suite yeşil sayılmaz.
A önceki b265 CI dokuz işSUCCESS, E2E72/72PASS; yeni A481 CI izleniyor.
B önceki51b CI sekiz işPASS, E2E70PASS/2FAIL eski locale başlığı; A düzeltmesi alındı.
C önceki77d CI sekiz işPASS, E2E74PASS/4FAIL: iki fixture kirlenmesi, iki Şimdi çakışması.
Son C build3PASS; Şimdi2/2PASS, ayrı pilot fixture ile birleşik empty/easysetup/stock6/6PASS; lint/tscPASS.
C TASARIM KAPISI AÇIK: dolu7iş ana ekranında son iki iş kaydırma gerektiriyor; DESIGN_REVIEW§7.4 kaydırmasız ister.
390x664: mevcut D04b min109.8px×4+32aralık+48Yakında=519.2px >498px kullanılabilir alan, Şimdi hariç.
Eşik/spec/guard gevşetilmedi; CI yeşil olsa bile bu tasarım kabulü tamamlanmış değildir.
PR5 yenihead APPROVED-BY güncellemesi otomatik incelemede CI/exactreview beklediği için reddedildi; eklenmedi.
A exactreview şimdi0/0/0; tümCI tamamlanmadan onay/merge yok. B ve C yeni exactCI ayrıca izlenecek.

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
PR8feat/T-905-automatic-deploy exact head2a706b3dae936d2d94b19b132cad1b7ba99ffc13.
Bağımsız security0BLOCKER/0MAJOR/0MINOR; QA12/12 ve Bash PASS. Schema imaj etiketi attestation'a bağlı.
Yerel operatör sınırlı kimlik/helper kurulumunu ve check başarısını bildirdi; Cloud runner kanıtı değildir.
Environment etkinwms-production yalnız main; ETKINWMS_DEPLOY_KEY/ETKINWMS_KNOWN_HOSTS hazır bildirildi.
PR8ci38268388457 tamamlandı: verify/infra/secrets/deps/int/E2E SUCCESS.
Gerçek bağımsız rapor PR8 açıklamasında; guards38269540155 yalnız PROTECTED_NO_APPROVAL nedeniyle kırmızı.
test-ac bu kapıya bağlı atlandı; Supervisor onay satırı henüz yok. Parent'a exactSHA/onay kapsamı iletildi.
Kalan otomasyon işi Cloud'a devredildi. Yeşil CI/inceleme → normal merge → main mode=check ve runURL kanıtı.
VPS approved schema27 fingerprint: b5a999421a7528cb8b1c1f3f77dcee6769c30397f8af69fea9522af2342717ae.
Cloud HTTPS health denemesi proxy403 ile reddedildi; erişim kısıtı aşılmadı, canlı sağlık iddiası yok.
Kişisel/root anahtar Cloud'a istenmez. CI/rollback açık aday için otomatik deployment tetiklenmez.

Temel satış sunucusu malformedURL MAJOR düzeltmesi a6f3f15ac342e9a802e6606aab794cf2ddd3a22a dalına push edildi.
Bağımsız a7080db kod incelemesi0/0/0 ve yerel1/1PASS; ürün adayı/main ile henüz birleşmedi.
İlk hesap/owner bootstrap ve MFA açık; TENANT_ADMIN daveti is_owner=false oluşturur, ilk sahip yaratmaz.
Owner yoksa dar/testli bootstrap gerekir; production signup veya DB rol provisioning çözüm değildir.
Hazırlık7/8, paket8 açık. Müşteri/cihaz kabulü0/13; kamera/yazıcı kabulü bekliyor. Üç depo ürün sınırı değildir.
Sosyal üyelik, Google/Apple ve platform yönetim paneli sekiz pilot paketinin dışında en sona ertelendi.
