# JOURNAL (tek satır / görev; Supervisor yazar, ajanlar istenmedikçe okumaz)
- 2026-10-05 Bootstrap: master v3.6 parçalara bölündü.
- 2026-10-05 T-001/T-001b ADR-001…012 önerildi; Faz 0 kart seti yazıldı; Q-09 kapandı; E-01 ortam engeli (npm/pip/Docker Hub 403).
- 2026-10-05 T-006 PILOT.md (varsayımsal); Q-08 Etkin WMS; ADR-012 ayrı kimlik yok kaydı.
- 2026-10-05 ADR-012 rev.: kullanıcı PR incelemez, Supervisor birleştirme kapısıyla birleştirir; ADR-001…012 kabul; ADR-013 Fly.io+GitHub Actions; I-17/AC-43/AC-44 yeni onay kuralına uyarlandı; E-01 kapandı.
- 2026-10-05 #1 iskelet, #3 STACK/MAP, #2+#4 CI (5 güvenlik turu), #8 test:ac+bekçiler-1 (3 tur) main'de; pooler paketi T-005a/b/c/g + T-015 entegrasyon; bekçiler-2 T-008d/f birleşti, T-008e sürüyor; T-010 Fly staging; kullanıcı Neon/Fly/Resend sırlarını ekledi.
- 2026-10-05 Faz 1 plan güvenlik 3. tur @b400466: BLOCKER 0 · MAJOR 0 · MINOR 8 → kartlara işleniyor; T-110 başladı; #25 T-109, #26 T-008k, #27 T-005d düzeltmesi CI kuyruğunda.
- 2026-10-05 20:15Z E-02 runner kapasitesi; #26 T-008k güvenlik @524ce26 BLOCKER 1 (tazelik ağaç girdisiyle yeniden yazılıyor); Faz 1 plan delta @251503f BLOCKER 0 · MAJOR 0 · MINOR 6 (işleniyor); #28 T-110 açıldı (güvenlik 0/0/4).
- 2026-10-05 20:35Z #29 Faz 1 planı açıldı (6 güvenlik turu, son @8335c6b 0·0·6, ADR-014/015/016 kabul); int/faz1-sema açıldı, T-101 başladı.
- 2026-10-05 20:50Z T-008k @a425180 0·0·2; T-005d düzeltmesi 0·0·5; T-101 #30 0·0·8 (→T-101d); T-101b 0·0·3 (→T-101c); T-102 MAJOR 1 (security_events zaman damgası) düzeltiliyor; E-02 sürüyor, gereksiz push koşuları iptal edildi.
- 2026-10-05 21:45Z int/faz1-sema yığını: T-101b/c/d, T-102, T-103 (BLOCKER down bekçisi + MAJOR grant eşleşmesi düzeltildi, son inceleme 0·0·5 → düzeltildi), T-104 QA AC-04/AC-18 PASS; T-110b; T-107 başladı. E-02 sürüyor.
- 2026-10-05 22:45Z #25 T-109 ve #27 T-005d düzeltmesi birleşti; neon-spike koşu 2: Q-01…Q-06 ölçüldü (PG 18.6, düz parola), AC-05 pool=1 gecikme zaman aşımı → #31; T-005e PG 18 hazır; T-107 5 inceleme turu; T-108, T-111, T-112 başladı.

## 2026-10-05 23:30Z — Supervisor turu
- #31 (T-005d gecikme ölçümü) CI yeniden koşu yeşil → main (9f96a6b); neon-spike koşu 3 dispatch (run 37388724069).
- #26 T-008k tüm işler yeşil → int/faz0-kapanis (b012964).
- #28 T-110: E-02 nedeniyle iptal olan int/infra/deps işleri yeniden koşturuldu.
- T-112c kartı yazıldı (int/faz1-sema 83fe4ff): kimlik olaylarını yalnızca wms_auth yazar; T-102/T-112 inceleme takibi.

## 2026-10-05 23:55Z — Supervisor turu
- Neon koşu 3 PASS (https://github.com/shosgoren/2027-WMS-1/actions/runs/37388724069): Q-01…Q-06 yanıtlandı (PgBouncer sürümü gözlenemedi), AC-05 pool1/2 + AC-28 + harness PASS (kapı ve tanı koşuları). T-005f architect'e verildi.
- #33 T-005e (compose PG 18.6, korunan; inceleme 0·0·2) → int/faz0-neon. #28 T-110 → int/faz1-ui-temel (iptal işler yeniden koşuldu, hepsi yeşil).
- T-115: T-115b incelemesi BLOCKER (index.ts→migrate.ts worker bundle'ında; açılışta migrate main) → kök T-115'te düzeltildi (connection-target.ts + gerileme testi + Dockerfile bundle kontrolü). Son: T-115 0·0·1, T-115b 0·0·0.
- T-112b: A-41 e-posta kilidi T-112 IP testinin öncülünü bozdu → kart eki (farklı e-postalar, assertion sayısı korunur) → test:int 245/245. reauth.succeeded T-112c'ye devredildi.
- T-116 kapsam eki (shared exports, MAIL_FROM, platform işi). T-113, T-112c başlatıldı.

## 2026-10-06 00:20Z — FAZ 0 KAPI RAPORU (Supervisor, ADR-012 rev. §3)
- `main` c6103a7 (#36 int/faz0-neon + #37 int/faz0-kapanis birleşik).
- `pnpm test:ac -- --phase 0` → 5 AC · PASS 5 · FAIL 0 · NO_TEST 0 · SKIPPED 0 (AC-05 4 test, AC-28 105, AC-37 78, AC-43 12, AC-44 11); ayrıntı `.artifacts/test-ac/0.json` (yerel).
- `pnpm check:pilot` OK · `pnpm verify` lint OK · typecheck OK · unit OK (904 test) · `check:all` CI'da #36/#37'de yeşil (yerelde main ayrık HEAD → scope GIT_ERROR; kart yok).
- Neon gerçek pooler: koşu 3 PASS (https://github.com/shosgoren/2027-WMS-1/actions/runs/37388724069); ADR-004 teknik alanları dolduruldu (Q-01…Q-06; Q-02 PgBouncer sürümü gözlenemedi).
- **Bilinen risk (ADR-012):** onay değişikliği yapan sistemden bağımsız değil; mekanik bekçiler + bağımsız security-reviewer ile azaltıldı.
- Açık takipler: T-008j (bekçi MINOR'ları + taban birleştirmesinde scope/protected yanlış pozitifleri + protected.test.mjs yük altında 5 s zaman aşımı), A-56 düz parola (yalnızca spike), Q-31/Q-32.
- Faz 1'e geçildi.

## 2026-10-06 00:25Z — Supervisor turu (gece)
- Birleşenler: #35 T-005f, #36, #37 (main), #34 T-110b, #33 T-005e, #28 T-110. Açık: #38 T-110c.
- T-115/T-115b: BLOCKER (migrate.ts worker bundle'ında) kökten düzeltildi → 0·0·1 / 0·0·0. T-116: 0·0·7 → 3 MINOR düzeltildi → 0·0·6 (kalanlar T-105/T-117 eklerinde).
- T-112b: 0·2·7 (e-posta kilidi TOCTOU, sosyal örtük kayıt) → düzeltildi → 0·0·3 (T-114). T-113: 0·0·5 → 0·0·2. T-112c: T-112b ile birleşti (262/262), inceleme sürüyor. T-110c 0·0·3 (T-131).
- Yeni kartlar: T-105c (operasyon rolü), T-110c, T-112c, T-133 (hata kodları); ekler: T-105, T-112b, T-113, T-114, T-115, T-115b, T-115c, T-116, T-117.

## 2026-10-06 00:45Z — Supervisor turu
- #29 Faz 1 planı → main (413a547 tazeleme 0·0·8). #38 T-110c → int/faz1-ui-temel. #30 kapatıldı (T-101 #39 içinde).
- int/faz1-sema dilimi kuruldu (main + 7 kart), entegrasyon düzeltmeleri (KNOWN_APP_SETTINGS, drift importu, PG 18.6 nonsuper testi), paket incelemesi 0·1·2 → 0·0·1; #39 açıldı.
- T-112c düzeltmeleri 0·0·2 ile geçti; T-133 hata kodu listesi yazıldı.
- int/faz1-auth entegrasyonu sürüyor (T-101d × T-115 connection-target çakışması).

## 2026-10-06 01:45Z — Supervisor turu
- E-03: 00:32Z'den beri Actions işleri başlamıyor (tüm dallar, docs-only dahil; yeniden koşu da aynı) → U-08 kullanıcıya (Actions dakika/harcama sınırı). Birleştirme durdu.
- Hazır: #39 (şema dilimi), #40 (ui dilimi), int/faz1-auth paketi (0·0·2; T-113 × T-115 connection-target çakışması sertleştirilmiş sürümle çözüldü; kuyruk kartları auth dilimine).
- Yeni kartlar: T-109b (paket bağlantıları ✓), T-116b, T-117c (not), T-105c→0007. Kararlar: T-117 B seçeneği (probe salt okunur; tek okuma işlevi + token bağlı withInvitationTenant). OPEN_QUESTIONS: Q-33, A-57…A-59.
- T-121 ✓, T-125 MAJOR düzeltiliyor, T-117 inceleniyor.

## 2026-10-06 02:45Z — Supervisor turu
- E-03 sürüyor (Actions). Yerel hat: T-117 (davet; 0006 tek okuma işlevi + withInvitationTenant; teslim tx dışı; web kuyruğu; getAppDb) ✓, T-118 (kimlik ekranları; Principal isDemo/twoFactorEnabled) ✓, T-121 ✓, T-125 (bağlam üreticisi storage iç modülü) ✓, T-127a lint sınırları ✓ (0·0·0), T-116b ✓ (kritik bulgu → T-115c öncelik).
- Yeni kartlar: T-116c, T-127a, T-109b; ekler: T-115c (öncelik + job.output), T-129 (log maskeleme), T-118 (QR/önizleme kararları).
- Tekrarlayan kırılganlık: scripts/guards/protected.test.mjs 5 s zaman aşımı (paralel ajan yükü) → T-008j önceliği.

## 2026-10-06 03:45Z — Supervisor turu
- E-03 sürüyor (Actions: 03:35Z koşuları 4 s'de logsuz FAIL). Birleştirme yok; yerel hat tam kapasite.
- T-117b HAZIR @ee15ffa: B1 (saklanan yönetici kimliği belirteç olarak kullanılabiliyordu) → `reset-password:h.<özet>` + before kancasında belirteç biçimi kısıtı (POST ve GET); MINOR 1/2/3/5 ve yeniden inceleme MINOR'ları kapandı; son inceleme 0·0·0, identity 96/96, tam test:int 483/483.
- T-115c: inceleme 0·1·6 → job.output temizliği (SanitizedJobError, safeErrorName), platform işi görünürlüğü nullif, RLS+yetki tek tx, job üst tablo INSERT kaldırıldı, MFA testi; yeniden 0·0·2 → 0·0·1 (son tek satır). Q-34/A-60 (FORCE RLS altında pg-boss bakımı).
- T-127: CSP nonce, Origin denetimi, DB hız sınırı üretimde bağlı (`@wms/db consumeRateLimit`). İnceleme 0·2·11 → MAJOR tenant kovası istemci slug'ıyla tüketiliyordu (DoS) → doğrulanmış tenant; server-only worker/vitest'i bozduğu için T-127b (korunan lint kuralı) kartına taşındı.
- T-119 DUR (okuma verisi yok) → T-119a kartı (domain okuyucuları). T-119a inceleme 0·1·7: liste yolunda `users FOR UPDATE` kilidi (tenant'lar arası login bekletme) → karar: liste probsuz, `resetLinkAvailable` iyimser, kesin karar sıfırlama komutunda; A-61 (üye listesi görünürlüğü).
- T-008l: protected.test kök nedeni (git spawn 2092→~1550, 4×paralel 5 tur yeşil). İnceleme BLOCKER 2 · MAJOR 2: check:scope gevşemişti (geri alma, sahte merge, uç öneki, iç merge konusu) → kart keşfi değişikliği geri, taban birleştirme düşürmesi yalnızca dar biçimde; negatif testler.
- T-116c başladı (taban T-116b + T-117).
- Yeni kayıtlar: T-119a, T-127b kartları; T-115c/T-127/T-117b/T-119 ekleri; T-105, T-129, T-131 notları; Q-34, A-60, A-61.

## 2026-10-06 04:45Z — Supervisor turu
- E-03 sürüyor (04:42Z koşuları 3 s'de logsuz FAIL). Birleştirme yok.
- T-008l HAZIR @eea351e: check:scope gevşemesi tamamen geri alındı (scope.mjs/cards.mjs c181ac5 ile birebir), A–D saldırıları negatif testlerle FAIL, protected.test spawn azaltma + SHA anahtarlı fileAtRef önbelleği; yeniden inceleme 0·0·1 (önceden var olan revParse MINOR → T-008m adayı).
- T-115c 932dab0 (son kontrol 0·0·1 kapandı; queue 52/52) — verify yalnızca protected.test yük zaman aşımı; düşük yükte tekrar.
- T-127 yeniden inceleme 0·1·5: MAJOR-1 kapandı; yeni MAJOR saate bağlı üretim guard testi (dakika sınırında kırılıyor) → sabit saat; Fly-Client-IP varsayımı → T-105.
- T-119a 0·1·7 → 0·0·3 (liste probsuz, membershipId, maskEmail); T-119 UI tamam (rol değişimi gerçek DB'de, bağlantı yenilemede yok), inceleme 0·0·3.
- T-116c 0·1·2 → 0·0·1 (web eylem testi mutasyonla kanıtlandı).
- T-123 (demo seed) 0·0·4; hesap bağdaştırıcısı T-123a kartına ayrıldı; A-62; T-105/T-106 notları. Ajan trailer'ı yanlış model adıyla yazmıştı → kart dalında amend.
- Yük notu: load 16–30; protected.test (5 s) ve migrations.int (30 s) zaman aşımları yük kaynaklı, eşikler gevşetilmedi.

## 2026-10-06 05:45Z — Supervisor turu
- E-03 sürüyor. Repo private (doğrulandı); işler adım çalışmadan 1–2 s'de düşüyor → büyük olasılıkla ücretsiz plan Actions kotası (2000 dk/ay) doldu. Kullanıcı 08:30 TR'de durum sordu; seçenekler (kart + Actions bütçesi önerisi / public / ay başını bekleme) ve public'in güvenlik etkisi açıklandı; karar bekleniyor.
- HAZIR olanlar: T-116c 0203602, T-119a eb6c733, T-119 0ed52df (error.tsx — Next 16 retry() kurulu dokümanla doğrulandı), T-123 a4a5fb7, T-127 e11695f (son kontrol 0·0·2; MINOR'lar T-131), T-127b 6a943ff (istemci içe aktarım grafı testi fail-closed; 0·0·2 gelecek notları).
- T-123a: BLOCKER (worker argon2 statik import → imajda yok, worker çöker) kapandı — createRequire ile ilk kullanımda, Dockerfile @node-rs kopyası, imajda kanıt; devralma koruması A-64 (ayrılmış alan, migration yok); A-63 worker wms_auth yalnızca demo. Yeniden inceleme 0·0·5.
- T-129 (izleme): log maskeleme, request ID, derin sağlık, uptime.yml. İnceleme 1·2·7 — kimliksiz ReDoS (proxy her istekte maskeleme regex'i), sağlık yoklaması havuzu tüketebiliyor, gömülü key:value maskelenmiyor → düzeltiliyor; sığ /api/health/live Fly için.
- Entegrasyon düzeltmeleri (dilim birleşiminde tekrar): T-117b×T-116b memberships.ts `tenantId: null`; T-115c×T-116c STACK.md; T-116c×T-127 actions.ts (kip denetimi önce, limitVerifiedTenant sonra) + actions.test.ts hız sınırı/tenant mock'ları.
- Kayıtlar: A-62, A-63, A-64; T-123a, T-127b kartları; T-105 (Fly-Client-IP, DEMO_PASSWORD, prod migrate ortamı), T-106 (staging migrate/DEMO_*), T-131 notları.

## 2026-10-06 06:45Z — Supervisor turu
- E-03 sürüyor (06:41Z 3 s'de FAIL). Kullanıcı kararı bekleniyor (Actions bütçesi / public).
- HAZIR: T-123a e002035 (Dockerfile korunan; son kontrol 0·0·1 → T-106 staging demo/argon2 doğrulaması), T-129 ce74c03 (ReDoS BLOCKER kapandı; maskeleme turları 1·2·7 → 0·0·6 → 0·0·3 → kapandı; uptime.yml son rapor sonrası değişmedi), T-122a eeb6c60 (A-65; now genel API'den çıktı).
- T-122: landing, demo girişi (demo-config ortak karar, DEMO_EMAIL_DOMAIN fail-closed), sihirbaz (POST + httpOnly taslak çerezi, sabit requestId, guard), ana ekran + "Bugün yaptıkların" + ayarlar (47 IANA saat dilimi sabit listesi); inceleme turları 0·1·6 → 0·0·3 → 0·0·2; son tur sürüyor.
- Yeni kartlar: T-122a. Kayıtlar: A-65; T-106, T-131 notları (layout next hedefi, demo giriş sayacı, maskeli members logu, saat dilimi tek kaynak, toplam karakter bütçesi, CSP oturumlu denetim, isProductionEnv tek kaynak).

## 2026-10-06 07:45Z — Supervisor turu
- E-03 sürüyor (07:20Z 4 s'de FAIL). Kullanıcı kararı bekleniyor.
- HAZIR: T-122 eb64192 (landing, demo girişi, sihirbaz, ana ekran, Bugün yaptıkların, ayarlar — inceleme turları 0·1·6 → 0·0·3 → 0·0·2 → kapandı), T-112d 7d0e0de (migration 0007 kimlik olayı sınıfı: account[_.], demo.(account|password)[_.]; demo.action_forbidden wms_app'e açık), T-116d 6263a75 (self-servis sıfırlama e-postası üretimde; kuyruk yalnızca reset isteğinde, backgroundTasks ile zamanlama farkı kapandı — 20/20 ölçüm), T-115c düşük yükte verify OK.
- Yeni kartlar: T-112d, T-116d, T-117d (davet önizlemesi, 0008). Migration numaraları: 0007 T-112d, 0008 T-117d, 0009 T-105c.
- Başladı: T-126 (denetim ekranı + CSV export), T-117d.

## 2026-10-06 08:50Z — Supervisor turu
- E-03 kapandı: kullanıcı repoyu PUBLIC yaptı (07:55Z); Actions koşuyor.
- MERGED: #39 99f2130, #40 5ac419b, #41 int/faz1-auth 5353a06 (paket 0·0·4), #42 int/faz1-ekran df5205c (paket 0·0·2).
- #43 int/faz0-kapanis → main açıldı (T-008l + T-008m; güvenlik @f1e2d77 0·0·0). Bulgu: check:scope MERGED_BRANCH `(feat/…` öncesini eşlemez → birleştirme konusunda dal adları boşlukla ayrılır (T-131 notu; bekçi gevşetilmedi).
- T-126 HAZIR e6545f0: deterministik kesit yarışı testi (dışlama kaldırılınca kırmızı), route testleri (Sec-Fetch-Site 403 sayaç tüketmez, akış ortası oturum düşmesi, maskeli onError). Dev hot-reload havuz kapatma bilerek yapılmadı (canlı kardeş kopyanın havuzunu öldürür; ADR gerekir). Risk: route `@wms/auth` doğrudan içe aktarıyor — #42 sonrası entegrasyonda lint ile kontrol.
- Birikmiş tur notları (state-pending):
  - T-008m kartı + ajan (wt-T-008m tabanı T-008l eea351e) — revParse hata ayrımı.
  - T-117d @34b4122 (0008 invitation_preview_for_token; previewInvitation; sayfa IP sınırı; tam test:int 618/618, verify 1710, build OK; iki allowlist testine yalnızca yeni işlev eki — kart eki) → güvenlik incelemesi.
  - T-117d inceleme @34b4122 0·0·3 GEÇTİ → IP çözülemezse 500 yerine nötr metin + test son tur; MINOR 2-3 T-131.
  - T-117d HAZIR @c02ddf5 (invite-guard: IP çözülemezse nötr metin, hız sınırı, beklenmeyen hata fail-closed; verify 1714, build OK).
  - T-008m @83ccccf (revParse yalnızca çıkış 1 + boş çıktı → null; ^{commit} soyulması kaldırıldı — gerekçeli sapma; guards 545, 4×3 paralel yeşil) → güvenlik incelemesi (korunan).
  - 07:55Z kullanıcı repoyu PUBLIC yaptı → Actions işleri başlıyor (E-03 çözülüyor). #39 gövdesi APPROVED-BY @041afb6 güncellendi; CI yeniden koşuyor. int/faz1-sema'ya #39 birleşene kadar docs push yok (kart notları beklemede).
  - T-008m inceleme @83ccccf 0·0·4 GEÇTİ (gevşeme yok, bazı durumlarda daha sıkı) → son tur: GitError ham stdout yok, yorum, findPull/stderr testleri, güçlü silinmiş ebeveyn testi; korunan → son SHA kontrolü gerekecek.
  - T-126 @6c11483 (listAudit keyset, openAuditExport snapshot kesiti + parça başı tx, csv enjeksiyon kaçışı, route guard 2/dk; tam test:int 594/594, verify 1715, build OK, Playwright) → güvenlik incelemesi. Kart eki BEKLİYOR (int/faz1-sema #39 birleşince yazılacak): packages/db/src/client.ts (rawByClient globalThis — Next çoklu bundle hatası), packages/domain/package.json, apps/web/lib/action-guard.ts. T-128 (qa) önerildi.
  - T-008m HAZIR @f1e2d77 (son kontrol 0·0·0; korunan). #39 MERGED 99f2130 (08:00Z). #40: main birleştirildi 5672d8d (verify 1034 OK, check:all OK) → CI.
  - int/faz1-auth hazırlığı (wt-auth yerel d2a55b6, push YOK): T-116b + T-115c tabanında T-117 (+T-109b) ve ui-temel var → check:scope 28 dosya (14 ui-temel, 14 T-117). Plan: #40 main'e birleşince yeniden kur: 181756a ← T-117 (konu T-117, T-109b) ← T-116b ← T-115c ← main; verify + test:int + check:all; paket incelemesi; PR int/faz1-auth → main.
  - T-126 inceleme @6c11483 1·2·5: BLOCKER client.ts globalThis rawByClient (RLS atlatma yolu) → geri al, serverExternalPackages ya da kopya başı havuz; MAJOR export olayı kesitte görünür (createdXid dışla), CSV ';' enjeksiyonu. Ajan düzeltiyor.
  - 08:10Z #40 MERGED 5ac419b. int/faz1-auth yeniden kuruldu (wt-auth 5adced9 yerel: 181756a ← T-117 ← T-116b ← T-115c ← main; check:all OK) — verify + test:int arka planda (ilk koşu konteyner yeniden başlatmasında/OOM 137 ile düştü). Konteyner yeniden başladı: T-126 ajanı yeniden başlatıldı (yarım değişikliklerden devam).
  - int/faz1-auth @5adced9 push + PR #41 → main açıldı (verify 1308, test:int 469/469, check:all OK); paket incelemesi sürüyor; PR etkinliğine abone.
  - #41 paket incelemesi @5adced9 0·0·4 → gövde APPROVED-BY + security-reviewer eklendi. MINOR takipleri (main birleşince kartlara): deliver-invitation platform/BETTER_AUTH_URL kalıcı hata (T-131 ya da T-116 takibi), staging DATABASE_URL_WORKER/wms_worker/installQueueSchema (T-105/T-106), STACK pg-boss yetki notu düzelt, 15-engineering AppError tablosu VALIDATION_FAILED.
  - 08:20Z #41 int/faz1-auth MERGED → main 5353a06. T-126 @5da58eb (BLOCKER geri alındı: rawByClient modül yerel, getAppDb kopya başı havuz; serverExternalPackages işe yaramadı; MAJOR'lar + MINOR'lar; tam test:int 596/596) → yeniden inceleme. Kapsam dışı bulgu: workspace.ts Symbol.for('wms.onboarding.appDb') yuvası.
  - int/faz1-ekran yerel (wt-ekran d1c7cf0): main + T-117d üst kümesi (T-112d, T-123a, T-123, T-117b, T-118, T-121, T-122/a, T-119/a, T-127/a, T-116c, T-125, T-109b) + T-127b + T-129 + T-116d; çakışmalar: .env.example/db index (iki taraf), invite page (önizleme + auth-service yolu); kart eşleme boş-ağaç birleşimi 24a7e5f; kart ekleri d1c7cf0; check:all OK. verify/test:int/build arka planda.
  - T-126 yeniden inceleme @5da58eb 0·0·4 GEÇTİ (BLOCKER kapandı) → son tur: deterministik yarış testi, dev hot-reload havuz sızıntısı, route testleri.
  - int/faz1-ekran @d1c7cf0 push; verify 1922, test:int 630/630, build OK; PR #42 → main açıldı, paket incelemesi sürüyor, abone.
  - #42 paket incelemesi @d1c7cf0 0·0·2 → gövde APPROVED-BY + security-reviewer eklendi. MINOR → T-131: /login demo bandı demo-config yardımcısını kullansın; @wms/auth portsuz dışa aktarım lint koruması (zaten not).

- 2026-10-13 T-914: eski kart/master/devir kopyaları Git geçmişine bırakıldı; gerekli sözleşmeler korundu. Bu temizlik ürün tamamlanma kanıtı değildir; önceki snapshot decbbe03fe1192473e096a1feb60cf090ca1fcf2.

- 2026-10-13 T-928: VPS WMS için dört işlemli kolay Akış + korunmuş Kokpit tasarımı; UI/i18n/E2E kapsamı, domain/DB/auth/CI değişmez. Merge/yayın kanıtı PR'da doğrulanır.

- 2026-10-13 T-929: kullanıcı iç ekranlarda tutarlılık ve tek elle geri/ana ekran erişimi istedi; masaüstü/tablet/telefon ayrı düzenleri kartta sınırlandı. Yerel verify3772 + temiz DB'de 26 E2E PASS; GitHub CI/yayın sonucu ilgili PR'da gerçek kanıtla kayıtlanır.

- 2026-10-13 T-930: PR23 88 E2E PASS sonrası main receiving-mobile87/88; SSR gizli fragmentiyle geçici çift seçici. Tek kart yerleşmesi için kesin count assertion eklendi; kayıt/veri/geometry assertionları korunur. Yayın sonucu ilgili PR'da.

- 2026-10-13 T-929/T-930 canlı doğrulama: main/live1cf81ed1; CI38418935906 + deploy38420413300 SUCCESS,88 E2E, ledger0031/31; üç cihazda oturumlu arayüz kontrolü. T-931 tekil fiziksel paket QR mal kabulü kullanıcı tarafından başlatıldı; henüz QR teslimi yok.

- 2026-10-13 T-931 ilk saf sözleşme:13 unit senaryosu, bağımsız121 QA probu PASS, güvenlik0/0/0; source hash0dc4917c…b6e44. Yerel lint+unit3785 PASS, üretilmiş tip kopyaları taşındıktan sonra tüm workspace typecheck PASS; check:all PASS. DB/UI/kabul/etiket akışı henüz yok; Excel/fiş/ERP ek hedefleri mevcut kısa rehberlere işlendi.

- 2026-10-13 T-931 hosted ilk E2E86/88 streaming çift seçici; görünür tek parent/alan ve gerçek kart geometrisine test kapsamı daraltıldı, ek cardinality assertionları eklendi; eşik/veri/negatif kontroller korunur. Yerel4 cihaz+son2 receiving PASS, ESLint/check:all PASS; yeni CI gerekir.

- 2026-10-13 T-931: b1f0afa hosted verify DOM tipi + mobile dialog kırmızı; structural tip root tsc PASS, client-ready dar koruma. Yerel desktop stock PASS; mobile RATE_LIMITED iki deneme sonrası durdu, bağımsız QA ortak pilot-user kovasını teşhis etti; gerçek signup/MFA ile ayrı cihaz fikstürleri, tek eskalasyon koşusu2/2 PASS55.4s, bağımsız QA0. Lint/unit3785 PASS; generated Git dışı tip kopyaları taşınarak workspace typecheck PASS; check:all PASS. Hosted son kapılar bekleniyor, merge/yayın yok. VPS16:38UTC dump→izole restore PASS,0031/31 ve ledger/balance fark0; scratch kaldırıldı. Offsite/PITR/iş akışı kabulü açık.

- 2026-10-13 T-931: PR25 exact-head3dc57e41 dokuz kontrol PASS, ci38441189572/guards38441278515; merge531e9034. main CI/yayın henüz bekleniyor. T932 bağımlılığı sağlandı; yeni0032 immutable paket şeması dalı açıldı, hiçbir canlı migration uygulanmadı.

- 2026-10-13 21:11 T931 main531e9034: ci38442505462/guards38442505492 + deploy38443949741 SUCCESS, VPS healthok/release exact/schema31 fingerprint eşleşti. Erken guards callback RELEASE_BLOCKED:int ile güvenle durdu. T932 hedefli59 PASS; lot snapshot manuel lock yerine date[]FK, syntax escalasyon rollback-only PASS; fullint/verify ve yeni negatifler sürüyor, bağımsız paket incelemesi açık.

- 2026-10-13 T932 ilkfullint1942/1983PASS,19FAIL+22setup-unexecuted: mapped-onlyWHEN ile legacyctx/pending-trigger uyumu, ac04 sealed chain/isolatedscratch; source-documentbypass negatif test ekleniyor. STS eksik local adapter yerine son normalfresh compose seçildi. Operatorfixture tempalias üstfocused2/2PASS; source/config değişmedi. Bunlar son tam kabul kanıtı değildir.

- 2026-10-13 T932: önceki kaynak fresh-compose fullint1992 PASS, verify3785 PASS; insert-order sonrası scoped215 PASS. Yeni bounded RR kaynak-parent yarışında iki COMMIT/iki source belge/+1 izlenmeyen onhand kanıtlandı; görünür parent BEFOREINSERT guard ve negatif iki-sıra testleri aktif. Son kaynak kabulü/bağımsız paket incelemesi henüz yok; canlıschema31.

- 2026-10-13 T932 kaynak freeze eb28928cfb765feeffd1bc367b4954913850f52fd7ae3acee333283fd3b90466: yeni görünür-parent guard,10 dosya318 PASS27.65s, paket46 test/iki RR kaynak sırası/iki lot sırası; eski receiving28/reversal27/operations-schema44 dahil. Scoped eslint/check:all/diffcheck PASS, skip0. T933 ile birleşik fullverify/fullint ve bağımsız inceleme sonrası PR; prod0032 yok.

- 2026-10-13 T933: prepare/post/yetkili QR sorgusu hazır; fresh-compose15 integration ve13 unit PASS, root/domain typecheck+eslint PASS. 5×200=>5kalıcıkimlik/1000KG, draftstock0, canonical/concurrent replay tek etki, gerçek QC/lot/scope/MFA/count-lock/archived kaynak rollback. UI/etiket/hareket açılmadı; T932+T933 finalpaket inceleme ve tüm kapılar bekler.

- 2026-10-13 int/package-receiving f9948aad: bağımsız security BLOCKER0/MAJOR1, eski HU binding/RR generic ledger yarışı gerçek scratchta iki COMMIT ve DRAFT nonoriginstock3 ile kanıtlandı. Normal prepare eskiHU kabul etmiyor; DB garanti düzeltilecek, paket merge/prod0032 yok. Fullverify3798 PASS; finalallgates henüz yok.

- 2026-10-13 f9948 bağımsız QA67/67 PASS (61 mevcut+6 bağımsız, final ledger fault rollback/concurrentpost/identity/LOT/foreignQR), skip0; private test helper text/UUID hatası düzeltildi, product source değişmedi. Security MAJOR geçerli; constructor-only HU binding reciprocalFK tasarım probu6 koşulda legacyret/newpaircommit/staleRRret kanıtladı. Gerçek0032 uygulama ve yeniSHA review gereklidir.

- 2026-10-13 f9948 tam int108 dosya/2011PASS/1FAIL (2012),499.60s; tek hata tasks public export exact-list yeni5yetkili paket girişini beklemiyor. completeTask/createTasks private deny assertions aynen korunacak. Bu koşu PASS değildir; T934 binding düzeltmesi ve explicit export expectation sonrası finalsource/gates tekrar gerekir.

- 2026-10-13 T934 şema ajanı provider güvenlik filtresiyle durdu; partial kaynak korunuyor, tamamlandı/testPASS sayılmadı. Normal iş-şeması/FK/Drizzle ve mevcut mal kabul regresyonları backend göreviyle devam; yeni saldırı probu istenmedi, canlı erişimi yok.

- 2026-10-13 T934 kaynak freeze: HU constructor-only marker/composite+deferredreciprocalFK/T933 INSERT bind düzeltmesi; final6 dosya146PASS62.69s, fullverify lint/typecheck/unit3798 PASS, scopedlint/roottsc/diffcheckPASS. İlk145/146 ordinaryTRUNCATE yeniFK0A000 önceliği: eski guardedCASCADE23514 ve her iki ret sonrası kimlikkoruma assertions eklendi; hiçbir grant/engine/config gevşetilmedi. Independent newSHA review/protectedapproval/fullgates hâlâ açık.

- 2026-10-13 3af124security0/0/0 +independentQA79PASS; iki gerçekFKvisibility senaryosuPASS. Default200paket functionalSUCCESS ama prepare30.706s/post46.353s toplam77.554s; ilkouter30sFAIL nedenDBtimeout değildir, bounded120sobserver sonucu yakaladı. T934 dar packageassert SQL aggregate optimizasyonu eklendi, kaynakraporu yeniSHA için geçerli sayılmaz.

- 2026-10-13 T934SQL aggregate WIP: bounded testsyntax iki parsehata sonrası tekupperrepair(roottsc0); thenruntime153/154 and77/78 (200outer30sFAIL iki optimize deneme),61schemaPASS/5pack~39msprepare/~51mspost. Author durdu; tekupperEXPLAIN performansdiagnosis, no timeout/GUC/cache/trigger change, WIPfreeze/merge/prod yok.

- 2026-10-13 T934 tekupperperformance repair: gerçekEXPLAIN JITetkisi yok, planner1estimate/200actual lot/location40600calls; MATERIALIZED package_lines→origins sınırı query77.853→17.992ms. Sonfresh78/78PASS(61schema17command), default2006688.2/14542.5ms ve fulltest22770ms<30s;5paket37.3/34.4ms. No timeout/GUC/trigger/cache/enginechange, scratchcleaned. YeniSHA bağımsız review ve tamgates bekler.

- 2026-10-14 T932+T933+T934 PR26 MERGED→int49de679 (kaynak34e0334); aynı Git tree bc57cdec. Final bağımsızsecurity0/0/0 + QA86/86PASS/skip0 (gerçekKG/GR çevrimi dahil), ci38465167535 ve guards38465559418 dokuzkontrolSUCCESS. Rapor: PR26#issuecomment-6154851235. Main/live531e9034/schema31; yeni UI/etiket/hareket yok, main paket PR/yayın sırada.

- 2026-10-14 00:33 Istanbul PR27→main69d1fbed; source11b56a6 dokuz soncheckSUCCESS (ci38470011292/guards38470011315), genuine34e security0+QA86 aynıappsource. MainCI38471430417/guards38471430852 açık; SSHreceiver sağlıkok/live531e/schema31. T935 webactions ayrıfeatdalında fc82949; 73scopedPASS/lint/types, fullverify3842 tekmarketingEPERM (atlama yok); supervisor doğruVitest yetkili1/1PASS, önce yanlışnode:test koşusu suite-contextFAIL korunur. T936UI başladı, T937etiket/T938bağımsızdikeykabul henüz yok.

- 2026-10-14 T936 kabulUI source hazır; son67scopedPASS/skip0/lint/types/diffcheck. Rootreview: paddedSQLdecimal+scale9 exactBigInt, NONEoptional metadata, count1default, definiteprepareret edit ve unknownoutcome samekeyfreeze testleri eklendi. Gerçekbrowser/cihaz/etiket/stocktraceability kabulü henüz yok; T937 ayrıworktree, serverflagdefaultfalse.

- 2026-10-14 T938 dört gerçek koşu: önce yanlış Depo helper seçicisi; ikinci GET Origin sınırı + eski etiket ölçüsü; üçüncü3PASS/3FAIL (Next boş alert çakışması + kanıtlanan mobil hydration erken tıklaması). Assertions/timeout/guard gevşetilmedi. T940 server readonly GET ve mount-ready kabul düğmesi düzeltildi. Dördüncü app48ff436 + frozen test tuple:6/6PASS/skip0/flaky0,32.94s, şema32/32. Gerçek KG5×200=1000, GR→KG3.5, kayıp yanıt/resume/replayID/DB, QRdecode/XSS/print ve dört geometri; gerçek kamera/Epson UNKNOWN. Kanıtlar /private/tmp/etkin-t938-passing-report.txt ve /private/tmp/etkin-t938-passing-source-tuple.json; final CI ve bağımsız güvenlik ayrı.
- 2026-10-14 T939 PR28 dokuz kapı PASS (ci38476331997/guards38476332028), kaynak7dd20fd security0/0/0 + QA84/84, fullverify3798/checkallPASS. PR28 merge0fe2e80213 (22:36:42UTC); main guards38478944569 PASS/ci38478944602 sürüyor. Erken deploy38479313958 eksik CI ile durdu; son doğrulanmış canlı531e/schema31. 0033 eski migration dosyasını değiştirmeyen invoker assert plan düzeltmesidir; gerçekKG200 tümtest12.525s, değişmeyen30s sınırı; kaynak/down/ACL/RLS/data restore kanıtı korunur.
- 2026-10-14 main69d CI38471430417 int2028PASS/1FAIL:200outer30s, prepare10865.9ms, postcompletekanıtı yok; yayın durdu. T939 üstboundedonarım yeni0033scalarflags+identityLATERAL:82/82PASS/skip0, default2001730.1/6739.9ms, fullcase10092ms; seeded32→33→32→33 prosrc/owner/ACL/RLS/ledger/balances aynı. Original0032/engine/dependencies/timer değişmedi; sharedE2E55432 untouched, ayrırandomcompose/DB temizlendi. Plan id-indexseek kanıtı yok; scalar-only18.5s targetFAIL ve öncehelpermoduleidentityINTERNAL raporda korunur. Exactreview/QA/CI henüz yok; canlı31.

- 2026-10-14 T939 exact7dd20fd genuine security0/0/0 +independentfreshQA84/84PASS/skip0 (82existing+literalKG5/200), sourcehashes unchanged. 200originalfull10969ms, KG20012525ms; seededrestore285.3ms; ownrandomfreshstack cleanup0. Rootfullverify lint/types/unit3798PASS, checkall6OK; CI/main/yayın henüz yok. Raporlar private/tmp/etkin-t939/{security,qa}.md; GitHubPRkanıtıyla bağlanacak.

- 2026-10-14 01:50 Istanbul: PR28main0fe2e80 ci38478944602 + guards38478944569 tüm9PASS; deploy38480106163SUCCESS. SaltokunurSSH healthok/release0fe2e80/auto_migratetrue/schema63869a…22e72, defter0033|33. UI PR29 açıldı/fd86b70; bağımsızsecurity0/0/0, finalverify3915PASS/checkall6OK/gitleaksnone. Öncekiverify3914PASS/1tokenFAIL+E2Ebrowserglobals typeFAIL, scopeworkbranchFAIL korunur; semanticpalette ve explicitbrowsertyping düzeltildi, gerçek5kart28dosya entegrasyonu ile scopePASS; assertion/guard/config gevşemedi. FinalUI9CI/şema33renderedQR kabulü ve hareket/üretim henüz açık.

- PR29 exact65b6191: pushCI38480544015 E2EPASS/intFAIL ve PRCI38480550586 E2EFAIL/intFAIL; guards38480597782 test-acFAIL. Ortak int2029/2030 hataAC04 exactpageinventory iki yenipage eksik. T940 QA tekfile mevcut149+12=161PASS/0skip/schema33, type/lintPASS, gerçektenant/stock.view/flag/GET ve etkiyok kapsamı; kendi randomcompose55073/55076 kapandı. PR E2Ezz-code-edit.mobile183: doğaltrace girileneskiürünkodu hazırlık sırasında siliniyor, arama isteği oluşmuyor; nativeHepsi fallback sonuç, yalnız seçici hatası diye yama yapılmadı. WIP kaynakfix/finalkapılar açık. 20 doğrulanmış eş/historik untracked “ 2” kopya /private/tmp/etkin-untracked-duplicate-backup-20261014 altında korundu; farklı T938doc kopyası yerinde bırakıldı.

- T940 gerçektrace tabanlı tek-source Typeahead onarımı:3satır SSRclientReadyfalse/mounttrue/inputdisabled; q/200msdebounce/seq/handler/geometry değişmez. Scopedlint/roottypes ve gerçekSSRdisabled/defaultValuePASS. Ekwebtypes20ignored generated “ 2–6” kopya yüzündenFAIL; trackedkaynak olmayan buildkopyaları /private/tmp/etkin-generated-type-copies-20261014 altında korundu; QA temizbuild ve değişmeyen gerçek desktop/mobile kodedit koşusu sırada. Beş kart/30 dosya; yeni aynalı unittest/legacyselector/config/guard değişimi yok.

- Son onarımcb7f292 güvenlik0/0/0; gerçek değişmeyen kodedit4/4PASS/skip0/flaky0/34.8s, doğal giriş korunuyor ve eski-kodPOST200/doğruürün-yenikod; AC04161PASS/schema33. Fullverify3915PASS; checkall4altPASS,2BASELINE_STALE (AC04taban112<119,assertions96<134). Korunan taban yalnız artırılarak ayrı küçük PR/exact-source review/supervisoronayıyla güncellenecek. Arama komponent3satır +T940card ayrı PR30/b4ba414 (sameTypeaheadblob),6bekçiOK/güvenlik0; bu küçük teslim finalpaketin5kart/≤30dosya sınırını da korur. Hiçbir test/assertion/config/guard düşürülmedi.

- PR30 kaynakb4ba414 dokuzPASS ci38529048834/guards38529048371→main d67b82da; mainci38530824944/guards38530824878 dokuzPASS. Deploy38531988425 yalnız dışDocker registryHTTP500 buildFAIL, aynıfailedjob tekretry sürüyor. PR31 kaynak8b35d2b bağımsız0+gerçekAST119/134 ve dokuzPASS ci38531182211/guards38531182246→int9d02d305; finalUI30dosya. protected-paths gerçekkural yalnızbaseline düşüşü korunan: ikiartışın ayrıincelemesi korunur, insanonayı gerekli diye varsayılmaz; yanlışgenel ifade düzeltilir. Uygulama/testler8b sonrası değişmedi; sonUI/main/yayın/cihaz ayrı doğrulanacak.

- 2026-10-14 T-941 yeni satış sitesi (marketing/): dc kaynak + eval'siz runtime + ön-çizim, yerel WOFF/WEBP, sunucu dosya haritası ve CSP font/style güncellemesi; eski site dosyaları silindi. Yerel tarayıcı QA ve marketing testleri PASS; CI ve canlı yayın bekliyor.
- 2026-10-14 T-941 canlı: PR32→main908c22a, deploy38550135723 SUCCESS; etkinyazilim.com yeni sayfa, eski app.js 404.
- 2026-10-14 T-942 tam ekran sinema girişi + telefon çerçevesi + giriş butonu hizası; yerel 7 çözünürlük PASS, PR35.
