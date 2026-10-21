# Değişiklik parçaları (`docs/changes/`)

Kullanıcı kararı 21 Ekim ("süreler çok uzun", T-445): paralel PR'lar `docs/STATE.md` ve `docs/BACKLOG.md`'de çakışmasın diye **iş PR'ları bu iki dosyaya dokunmaz**. Her iş kendi kaydını `docs/changes/<T-xxx>.md` dosyasına yazar; "her iş STATE ve BACKLOG'u günceller" kuralı bu parça dosyasıyla karşılanır. Koordinatör birleşen parçaları tek komutla işler:

```bash
node scripts/changes/fold.mjs            # STATE + BACKLOG'a işle, parçaları sil (sonra commit)
node scripts/changes/fold.mjs --dry-run  # ne yapılacağını göster, yazma
node scripts/changes/fold.mjs --check    # yalnız biçim + BACKLOG kimlik doğrulaması (CI verify işinde koşar)
```

Komut idempotenttir (aynı satır/durum ikinci kez eklenmez; parça yoksa değişiklik yok) ve hepsi-ya-da-hiçbiri çalışır (bir parça hatalıysa hiçbir dosya yazılmaz).

## Biçim

Dosya adı kart numarasıdır: `T-445.md`, `T-979b.md`, `T-1001.md`. Yalnız iki bölüm işlenir; başka `##` bölümleri (ör. `## Not`) ve HTML yorumları yok sayılır.

```markdown
# T-445 — teslim hattı hızı

## STATE
- **T-445 (21 Ekim, dal `fix/T-445-hat-hizi`, PR {PR}, KODDA VAR, canlı değil; B-103):** tek satırlık STATE özeti …

## BACKLOG
- B-103: BİTTİ {PR} (T-445)
- yeni [Eklemeler]: | Yeni bulgu metni |
- yeni [P2 — ürün akışları]: | Yeni iş metni | B-50 |
```

- **STATE:** her `- ` maddesi tek satırdır; STATE'te `<!-- changes:state -->` satırının altına, o yoksa ilk `- **T-` maddesinin önüne (en yeni üstte) eklenir.
- **Durum (`- B-xx: metin`):** o satırın iş hücresinin başına `**metin** — ` eklenir. Satır silinmez (BACKLOG kuralı).
- **Yeni satır (`- yeni [Bölüm]: | … |`):** `## <Bölüm>` ile başlayan başlığın tablosunun sonuna eklenir; B numarasını fold verir (paralel PR'lar aynı numarayı almaz). Hücre sayısı = o tablonun sütun sayısı − 1 (ID hariç). Bölüm verilmezse `Eklemeler`.
- **Yer tutucular:** `{PR}` → `#<numara>`, `{SHA}` → birleşme commit'inin kısa SHA'sı; fold main geçmişindeki `Merge pull request #N from …/feat|fix/<T-xxx>-…` commit'inden çözer. Birleşmemiş parçada fold durur (yalnız `--check` çözmeden geçer).

## Kim ne yapar
- **İş PR'ı:** kart (`docs/tasks/T-xxx.md`) + parça (`docs/changes/T-xxx.md`). STATE.md ve BACKLOG.md'ye dokunmaz.
- **Koordinatör:** birleşmelerden sonra main'den bir dal açar, `node scripts/changes/fold.mjs` koşar, STATE ≤80 satır kuralını gözden geçirir ve tek belge PR'ı açar (yalnız belge PR'ında ağır CI işleri atlanır). Kesilen işin dal/commit durumu da parçaya yazılır.
