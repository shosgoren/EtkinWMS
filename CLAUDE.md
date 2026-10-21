@AGENTS.md

# Claude Code için ek (projeye özgü; genel kuralların otoritesi INVARIANTS / PROTOCOL — burada tekrar yazılmaz)

## Oturum başı
1. `docs/continuity/README.md` → `docs/STATE.md` → `docs/BACKLOG.md` (yalnız ilgili satır ve bağımlılıkları) → görev alanının kısa rehberi (`docs/continuity/*`, web için `apps/web/AGENTS.md`). Bütün `docs/`, JOURNAL, spec ya da kod topluca okunmaz.
2. Git durumu (dal, çalışma ağacı, commit edilmemiş değişiklik), açık PR'lar ve main'in son yayını kontrol edilir. Önceki sohbet, STATE ya da tahmin canlı kanıt değildir.

## Yetki ve canlıya alma (kullanıcı kararı 20 Ekim 2026: "her şeyi sen yap, bana sadece rapor ver")
- PR'ları ajan birleştirir; **main'e birleştirme = otomatik canlıya çıkış** (deploy-vps: yedek → migration → kuyruk → derin sağlık). Migration dahil kullanıcıya her seferinde sorulmaz.
- Kapılar gevşemez: CI dokuz kapı yeşil, PROTOCOL risk matrisinin istediği bağımsız security-reviewer (BLOCKER/MAJOR 0), bekçiler; korunan dosyada `security-reviewer: … @ <sha>` + `APPROVED-BY: supervisor (ADR-012 rev.) @ <head sha>` (rebase sonrası SHA güncellenir).
- Her yayından sonra canlı sağlık ve deploy sonucu doğrulanır, STATE'e yazılır.
- Müşteri verisini kalıcı silen işlem (ör. panelden müşteri silme) yapılmadan önce kullanıcıya haber verilir. Force push yalnız kendi PR dalına `--force-with-lease`; main'e asla.

## İş ve kart
- İş BACKLOG'dan seçilir (`B-xx`); her bağımsız iş `docs/tasks/T-xxx.md` kartı + `fix|feat/T-xxx-…` dalı. Boş numara: `docs/tasks/`, uzak dallar, PR başlıkları ve STATE/BACKLOG/JOURNAL birlikte taranır (ör. T-928/T-929 eski işlerde kullanılmış). Kartın "Dokunulacak dosyalar" listesi `check:scope` ile birebir; `[slug]` yerine `*`.
- **STATE/BACKLOG güncellemesi parça dosyasıyla yapılır (kullanıcı kararı 21 Ekim, T-445):** iş PR'ı `docs/STATE.md` ve `docs/BACKLOG.md`'ye **dokunmaz**; bitince aynı PR'da `docs/changes/<T-xxx>.md` yazar: STATE satırı + BACKLOG değişiklikleri (`- B-xx: BİTTİ {PR}` / `KODDA VAR`, yeni bulgu `- yeni [Bölüm]: | … |`; B numarasını fold verir). Biçim: `docs/changes/README.md`. "Her iş STATE ve BACKLOG'u günceller" kuralı bu parçayla karşılanır; parçasız iş PR'ı eksik teslimdir. İlgili kısa rehber yine aynı PR'da güncellenir. Yeni bulgu hemen parçaya; sohbette kalan bulgu kayıptır.
- **Koordinatör** birleşmelerden sonra main'den açtığı belge dalında `node scripts/changes/fold.mjs` koşar (parçaları STATE + BACKLOG'a işler ve siler; idempotent, hata varsa hiçbir dosya yazılmaz; önce `--dry-run`), STATE ≤80 satırı gözden geçirir ve tek belge PR'ı açar. Böylece paralel PR'lar STATE/BACKLOG'da çakışmaz; kesilen işin dal/commit durumu da parçaya yazılır. CI `verify` parçaları `fold --check` ile doğrular.
- Kart numarası 3 ya da 4 hanedir (T-1000+ geçerli; B-103).

## Güvenlik bilgisi (depo herkese açık)
- Açık depodaki belgeye güvenlik zayıflığı ayrıntısı (dosya:satır, senaryo) yazılmaz: BACKLOG'da yalnız 🔒 genel başlık; ayrıntı gizli danışma taslağında (GitHub Security Advisory **GHSA-jxfh-5j2f-4mvg**). Düzeltilip canlıya çıkan açık PR'da anlatılabilir.
- Veri ve yetki kuralları INVARIANTS kimlikleriyle uygulanır: tenant I-01…I-03 (+ negatif test), defter/negatif stok/idempotency/ters kayıt/decimal I-04…I-09, kilit yalnız `acquireStockLocks` I-15 (elle FOR UPDATE yok), audit I-12, tasarım I-18.

## Doğrulama ve kanıt
- **Push'tan önce `pnpm prepush` yeşil olmalı; CI hata bulma aracı değil, son doğrulamadır** (kullanıcı kararı 21 Ekim, T-445). `prepush` = verify + check:all + `test:ac -- AC-04` + dalda değişen e2e spec'leri (Docker yoksa `--skip-e2e`, özet UYARI yazar). Yerel istisnalar yalnız iki: initial-owner (macOS `/var`) ve yerelde doğrulanamayan korunan dosya onayı (UYARI). İsteğe bağlı kanca: `git config etkin.prepush true` → her push önce `pnpm prepush`; atlamak `git push --no-verify`.
- Kod, testler, lint/typecheck, CI, migration (DB defteri), imaj, deploy ve canlı ayrı ayrı raporlanır; biri diğerinin kanıtı değildir. Çalıştırılmayan = UNKNOWN. Testi geçmek için test/bekçi gevşetilmez (G-11).
- Test dengesi (kullanıcı kararı): kural/güvenlik birim + entegrasyonda; kod değişen her PR'da TAM takım (int 3, e2e 4 parçaya bölünmüş; T-445); yalnız `docs/**`/`*.md` PR'da ağır testler atlanır; e2e yalnız kritik akış + ortak yerleşim taraması (`docs/continuity/CODING_TESTS.md`). Gerçek cihaz (iPhone Safari) kontrolü kullanıcıdan istenir.
- Arka planda test koşarken aynı çalışma ağacında dal değiştirilmez / dosya düzenlenmez (sonuç geçersiz olur); paralel iş için ayrı `git worktree`.

## Tasarım
- Ekran işi onaylı tuvalden başlar: https://claude.ai/artifact/4nmGwfnN4BfL6bkfWbLJC3 → kaynak `docs/design/source/*.dc.html` (sha256 `SOURCE.md`) → birebir aktarım (I-18, `DESIGN-PARITY.md`, `ALTIN-KURAL.md`). Tuvalde olmayan ekran kodlanmaz; önce tuvale eklenir, kullanıcı onaylar.
- Parite görüntüsü 390×844 gerçek telefonun görünür yüksekliğini temsil etmez (Safari çubukları ~660–690 pt); telefonda "kaydırma yok" kısa yükseklikte de denetlenir.

## Bu makinenin ortamı (macOS)
- Xcode lisansı onaylı değil: git `/Library/Developer/CommandLineTools/usr/bin/git`; çalışan klon `…/EtkinWMS/EtkinWMS-repo` (indirilen `EtkinWMS-main` git deposu değildir). `gh` girişli; `gh pr create` git ister → PR'lar `gh api …/pulls` ile.
- Node 24: `~/.local/node24/bin` (pnpm 10.28 sarmalayıcısı aynı yerde). Docker Desktop çalışır; `pnpm test:int [dosyalar]` testcontainers ile.
- Paralel çalışma ağaçları (`git worktree`) aynı `.git`'i paylaşır: bu yerel depoda `gc.auto=0`, `maintenance.auto=false`, `fetch.writeCommitGraph=false` (20 Ekim'de eşzamanlı işlemlerde paket bozuldu; onarım: bozuk paketi yedeğe taşı + `fetch --refetch` + multi-pack-index/commit-graph önbelleklerini kaldır).
- Bilinen ortam hatası: `scripts/initial-owner.test.mjs` macOS `/var` sembolik bağı yüzünden `PRIVATE_DIRECTORY_REQUIRED` (gerçek TMPDIR ile geçer; CI'da geçer).

## Raporlama
- Kullanıcıya: sade Türkçe — canlıda / bitti, canlıya çıkıyor / kalan (onaylı sıra) / eklenebilir / senden bekleyen. Teknik ayrıntı PR'da.
- PR açıklaması: Yapılan · Doğrulama (komut + sayı) · Durum (kod / CI / migration / canlı ayrı) · Backlog · Kalanlar (risk, UNKNOWN) · Devir.
