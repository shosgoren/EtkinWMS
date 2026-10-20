@AGENTS.md

## Claude Code için ek
- Oturum başı okuma sırası: `docs/continuity/README.md` → `docs/STATE.md` → `docs/BACKLOG.md` (yalnız ilgili satır) → görev alanının kısa rehberi. Bütün `docs/`, JOURNAL veya spec okunmaz.
- İş seçimi BACKLOG'dan yapılır; iş başlarken T-915+ boş numarayla kart açılır, bitince BACKLOG satırı `BİTTİ <PR/SHA>` olur ve STATE güncellenir (aynı PR).
- Yeni bir eksik bulunursa BACKLOG'a satır eklenir; sohbette kalan bulgu kayıp sayılır.
- Sohbet uzarsa veya yeni oturuma geçilirse süreklilik bu dosyalardan sağlanır; önceki sohbet canlı kanıt değildir. Kesilen işin dalı/commit durumu STATE'e yazılır.
- Kod/CI/canlı imaj/DB defteri ayrı doğrulanır; doğrulanmayan "UNKNOWN" yazılır, tahmin "DOĞRULANDI" yazılmaz.
- Web kodunda ayrıca `apps/web/AGENTS.md`; ekran işinde `docs/design/ALTIN-KURAL.md` + `docs/design/DESIGN-PARITY.md`.
