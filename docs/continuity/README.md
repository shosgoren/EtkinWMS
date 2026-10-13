# Etkin WMS devam dizini

Bu dizin yeni bir AI'ın bütün sohbeti okumadan devam etmesi içindir. Başlangıç okuma bütçesi: bu dosya + [STATE](../STATE.md); sonra **yalnız görev alanı**. Link verilen uzun kaynakları ihtiyaç olduğunda aç.

## Nerede ne var?

| İhtiyaç | Kısa kaynak | Ayrıntı / kod otoritesi |
|---|---|---|
| Bugün nerede kaldık? | [STATE](../STATE.md) | Gerçek GitHub/run/VPS/DB kanıtı |
| Proje ve DB mimarı, görev sahipleri | [ARCHITECTURE](ARCHITECTURE.md) | `docs/spec/`, `docs/adr/`, paket girişleri |
| Kodlama ve test | [CODING_TESTS](CODING_TESTS.md) | `package.json`, `docs/agents/PROTOCOL.md`, workflow'lar |
| Web/mobil/tablet ve görsel dil | [UI_UX](UI_UX.md) | `docs/design/`, `docs/ux/`, `apps/web/app/globals.css` |
| Tenant, stok, migration, RLS | [DATABASE](DATABASE.md) | `docs/INVARIANTS.md`, `packages/db/`, `packages/domain/` |
| VPS/GitHub erişimi, yayın, yedek | [OPERATIONS](OPERATIONS.md) | `deploy/vps/`, gerçek operatör dosyaları |
| Güncel tutma / az token / teslim | [UPDATE_PROTOCOL](UPDATE_PROTOCOL.md) | Görev kartı + kısa kanıt kaydı |

## Gerçek otoriteler

1. Açık kullanıcı kararı ve üst düzey oturum talimatları.
2. Korunan invariants/ADR ve etkin CI/bekçiler. Bu özetler yeni istisna üretmez.
3. Çalıştırılmış komut, gerçek deploy state, DB defteri ve aynı SHA'ya ait CI.
4. Tarihli STATE özeti. Eski sohbet, PR açıklaması veya eski devir notu canlı kanıt değildir.

`docs/PILOT_HANDOFF.md`, `HOSTINGER_RUNBOOK.md` ve eski STATE commit'leri tarihsel ayrıntı sağlar. Eski “Neon canlı”, “owner yok”, “tam 27 kaynak” veya “ürün yayımlandı” satırlarını güncel veri yerine kullanma.

## Yeni AI'a verilecek kısa mesaj

```text
Etkin WMS'ye devam et. Önce AGENTS.md, docs/continuity/README.md ve docs/STATE.md oku.
Yalnız mevcut görev alanının kısa rehberini ve ilgili kodu incele. Çalışma ağacını koru.
Kod/CI/canlı imaj/DB şemasını ayrı doğrula; sır isteme veya yayımlama.
Görev: <tek somut sonuç>. Bitince gerçek kanıtla STATE ve ilgili rehberi güncelle.
```

Sürekli güncellik, [UPDATE_PROTOCOL](UPDATE_PROTOCOL.md)'ün her teslimde uygulanmasıyla sağlanır. Bu belgeler kendi kendine VPS izlemez veya zamanlanmış iş çalıştırmaz.
