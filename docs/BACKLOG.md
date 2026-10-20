# Etkin WMS — tek yapılacaklar listesi

Bu dosya bütün açık işlerin **tek listesidir**; kural metni burada tekrar yazılmaz (otorite: [INVARIANTS](INVARIANTS.md), [ALTIN-KURAL](design/ALTIN-KURAL.md), [PROTOCOL](agents/PROTOCOL.md)). Canlı durum [STATE](STATE.md)'tedir.
İş başlarken satıra T-numarası (T-915+ boş numara) ve kart açılır; bitince satır silinmez, durumu `BİTTİ <PR/SHA>` olur, sonraki temizlikte Git geçmişine bırakılır.

Kaynak: 20.10.2026 statik inceleme (kod okuması; test/DB/canlı koşturulmadı). Etiketler [UPDATE_PROTOCOL](continuity/UPDATE_PROTOCOL.md) ile aynı.
Öncelik: **P0** canlı müşteri açılmadan · **P1** en kısa sürede (0051/0052 19 Ekim 21:18'de canlıya çıktı, main `0993416`) · **P2** ilk ücretli müşteri öncesi · **P3** ölçek/kalite.

**Güvenlik satırları (🔒):** depo herkese açık olduğundan ayrıntı (dosya:satır, senaryo, düzeltme) burada yazılmaz; depo yöneticilerine açık gizli danışma taslağı **GHSA-jxfh-5j2f-4mvg** içindedir (GitHub → Security → Advisories). Düzeltme birleşip canlıya çıkınca ayrıntı kart/PR'a taşınabilir. Yeni güvenlik bulgusu da önce oraya, burada yalnız kimlik + genel başlıkla eklenir.

## P0 — veri kaybı ve görünürlük
| ID | İş | Kim |
|---|---|---|
| B-01 | Günlük şifreli sunucu dışı yedek + saklama politikası 🔒 | AI betik, kullanıcı hesap + kurulum |
| B-02 | WAL arşivi + PITR, RPO/RTO kararı (Q-25), aylık otomatik geri yükleme tatbikatı | AI + kullanıcı |
| B-03 | Dış izleme ve alarm (sağlık, disk, sertifika, worker) + bildirim kanalı | AI + kullanıcı |
| B-04 | Hata izleme (Q-21), KVKK uyumlu maskeleme | Kullanıcı kararı |

## P1 — yetki ve RLS (ilk güvenlik paketi; 0051/0052 canlıda; security-reviewer + QA zorunlu)
| ID | İş |
|---|---|
| B-10 | Global kimlik/olay tablolarında uygulama rolü okuma yetkisini daralt 🔒 — `security_events` kısmı T-919 (0053, KODDA VAR); kalan kısım açık |
| B-11 | Ekibe katılma onayını DB'de kod doğrulamasına bağla 🔒 — T-919 (0053, KODDA VAR; canlıya çıkınca BİTTİ) |
| B-12 | Saha girişi migration'larının geri almasına veri bekçisi 🔒 |
| B-13 | Pano bölümlerinde depo kapsamı tutarlılığı 🔒 — T-920 (KODDA VAR) |
| B-14 | Paket/palet oluşturmada depo kapsamı 🔒 — T-920 (KODDA VAR) |
| B-15 | İzolasyon testini (AC-04) RLS'siz tabloların yetkilerini kapsayacak şekilde genişlet |
| B-16 | Yöneticiyi yalnız hesap sahibi yönetir (kullanıcı kararı 20 Ekim: evet) 🔒 — T-922 (KODDA VAR) |
| B-17 | DB işlevlerinde aktör kimliğini oturum bağlamından al 🔒 |
| B-18 | Kuyruk RLS politikası simetrisi 🔒 |
| B-19 | Hassas işlemlerde yeniden doğrulama tutarlılığı 🔒 — T-920 (KODDA VAR) |

## P1 — DB ikinci savunma
| ID | İş |
|---|---|
| B-20 | Üyelik/rol/grup yazmalarında DB düzeyi yetki denetimi; tek sahip kısıtı 🔒 |
| B-21 | Depo kapsamını RLS'e taşı; kapsam bayrağı yoksa üretimde fail-closed 🔒 |
| B-22 | I-08/I-09 için DB CHECK'leri (ters kayıt üst sınırı, temel miktar kesin çarpım) |
| B-23 | Görev ayrılığı: ayar yetkisi ve kapsamın genişletilmesi; DB tetikleyicisi 🔒 |
| B-24 | Tenant bağlamı güven sınırını ADR'ye yaz; ham SQL lint kilidi; worker/operatör için ayrı DB rolü değerlendirmesi 🔒 |
| B-25 | Eksik tekil kısıt ve indeksler (saha girişi, ekibe katılma, abonelik) |
| B-26 | Hız sınırı tablosu yetkisi; bileşik FK eksikleri 🔒 |

## P1 — altyapı sıkılaştırma
| ID | İş |
|---|---|
| B-30 | Docker ağ ayrımı (ön yüz / DB) 🔒 |
| B-31 | Konteyner sıkılaştırma (salt okunur kök, yetenek düşürme, süreç sınırı) |
| B-32 | Proxy: imaj sabitleme, güvenlik başlıkları tüm sitelerde, erişim günlüğü, iç uçların dışarı kapatılması 🔒 |
| B-33 | Canlı compose/Caddyfile sürümleme (config drift); eski `deploy/vps/compose.yml` kaldır |
| B-34 | Migration sırasında bütün yazıcıları durdur; eski imaj temizliği + disk alarmı; belgelenmiş `rollback <tag>` |
| B-35 | Eski `etkinwms-motive_*` birim/ağ temizliği (önce yedek, kullanıcı onayı) |
| B-36 | Neon/Fly kalıntıları: `restore-drill`, `deploy-migrate`, `deploy-smoke`, `uptime-check` betikleri, RUNBOOK-ops, Dockerfile/compose yorumları |
| B-37 | Satış sitesi form/önizleme sıkılaştırma 🔒 |
| B-38 | Panel kökeninde gereksiz kimlik uçlarını kapat 🔒 |
| B-39b | CI hızlandırma: int/e2e paralel parçalar, yalnız belge PR'da ağır testler atlanır, yayın tek tetikleme. T-925 (KODDA VAR) |
| B-39 | Dependabot/Renovate; `pnpm audit` CI işi; DB TLS sertifika yenileme otomasyonu |

## P2 — satılabilir SaaS
| ID | İş | Bağlı |
|---|---|---|
| B-40 | iyzico abonelik + webhook (imza doğrulama, idempotent tüketim, retry), otomatik aylık tahakkuk, "Hatırlat" | T-405, şirket kuruluşu |
| B-41 | Deneme bitiş davranışı | Q-127 |
| B-42 | Kullanım koşulları, DPA, mesafeli satış, veri sorumlusu kimliği, saklama süresi; yurt dışı aktarım hukuk onayı | Q-07, avukat |
| B-43 | Veri dışa aktarma (takeout) + kapatma süreci | I-13, AC-24/26/29/30, Faz 4P |
| B-44 | Destek erişimi (audit'li, süreli) | T-409 |
| B-45 | e-Arşiv/e-Fatura | ADR-008 Faz 4S |
| B-46 | Kesintisiz yayın: expand/contract migration kuralı; yazıcıları durdurmadan migration | — |

## P2 — ürün akışları
| ID | İş | Bağlı |
|---|---|---|
| B-50 | Paketli/QR akışı normal girişe bağla, `PACKAGE_RECEIVING_ENABLED` aç | T-975 |
| B-51 | Sayım saha + yönetici ekranları (domain hazır) | T-990/T-991 |
| B-52 | Toplama saha ekranı, iade ekranı (domain `returns.ts` var) | — |
| B-53 | Üretim fixture hataları + kapılar; siparişsiz sevk kapıları | T-964, T-970–974 |
| B-54 | Yetki grupları, ekibe katılma QR, Ekip ekranı: canlıda (main `0993416`, 19 Ekim 21:18 deploy-vps 39326385152); kullanıcı kabulü ve P1 düzeltmeleri bekliyor | T-421, T-429 |
| B-55 | Pasif üyelik; davet/saha hesabı yaşam döngüsü tutarlılığı | — |
| B-56 | Donanım kabulü: telefon/notebook kamera, Epson/ZPL, Bluetooth, el terminali (AC-35) | Q-103 |
| B-57 | Offline gereksinim ölçümü | Q-102, ADR-025 |

## P3 — Altın Kural / tasarım ve kod kalitesi
| ID | İş |
|---|---|
| B-60 | Ortak alt ekran çubuğu (Geri + Ana ekran · ana işlem · Etkin) + kaydedilmemiş iş uyarısı (T-423 kalanı) |
| B-61 | Ortak ses/geri bildirim modülü (`beep()` üç kopya); saha akışlarına sesli geri bildirim |
| B-62 | Etkin sesli asistan (T-424); sesle miktar/görev arama |
| B-63 | Tasarım kaynağı olmayan ~49 ekran (stok, kabul, sevk, üretim, etiket, ayarlar, saha) için tuval → birebir aktarım (I-18) |
| B-64 | İstemci `void action().then()` zincirlerine hata yakalama (ör. `apps/web/app/activate/[token]/flow.tsx`); `loading.tsx`, panel `error.tsx`, `global-error`, `not-found` |
| B-65 | `apps/web/app/t/[slug]/page.tsx` üyelik yoksa `return null` → `notFound()`; tanımsız roller için açılış ekranı |
| B-66 | Panel hata kodlarını kullanıcı diline çevir |
| B-69 | Üyeler ekranı ve davet penceresi: sahip olmayan yöneticide yönetici hedefli rol/çıkarma/sıfırlama düğmeleri ve TENANT_ADMIN davet seçeneği kilitli + nedeni görünür (sunucu zaten reddediyor; T-922 inceleme MINOR-2) |
| B-67 | Cari kişisel alanlarının görünürlüğünü daralt; `settings.manage`'i böl; kullanılmayan `takeout.request` 🔒 |
| B-68 | Defter–bakiye denetiminin ölçeği (her yazımda tüm geçmiş toplamı) — checkpoint tasarımı |

## Belge düzeltmeleri
| ID | İş |
|---|---|
| B-70 | STATE.md 93 satır (kural ≤80); başlık tarihi 17.10 ama 19 Ekim kayıtları var; "MAIL_MODE disabled" ve "sahip/yönetici Görevlerim'de" satırları eskimiş |
| B-71 | T-430 kimlik çakışması (STATE: müşteri sil/sıfırla; `tasks/T-430.md`: Ekip ekranı) |
| B-72 | Spec `outbox_events` tablosu yok — I-07 pg-boss aynı transaction ile karşılanıyor; spec güncellensin |
| B-73 | README "Yayın kaynakları" Neon satırı eskimiş |
