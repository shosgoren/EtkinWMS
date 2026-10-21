# Etkin WMS devam dizini

Bu dizin yeni bir AI'ın bütün sohbeti okumadan devam etmesi içindir. Başlangıç okuma bütçesi: bu dosya + [STATE](../STATE.md); sonra **yalnız görev alanı**. Link verilen uzun kaynakları ihtiyaç olduğunda aç.

## Nerede ne var?

| İhtiyaç | Kısa kaynak | Ayrıntı / kod otoritesi |
|---|---|---|
| Bugün nerede kaldık? | [STATE](../STATE.md) + henüz işlenmemiş [parçalar](../changes/) | Gerçek GitHub/run/VPS/DB kanıtı |
| Proje ve DB mimarı, görev sahipleri | [ARCHITECTURE](ARCHITECTURE.md) | `docs/spec/`, `docs/adr/`, paket girişleri |
| Kodlama ve test | [CODING_TESTS](CODING_TESTS.md) | `package.json`, `docs/agents/PROTOCOL.md`, workflow'lar |
| Web/mobil/tablet ve görsel dil | [UI_UX](UI_UX.md) | `docs/design/`, `docs/ux/`, `apps/web/app/globals.css` |
| Tenant, stok, migration, RLS | [DATABASE](DATABASE.md) | `docs/INVARIANTS.md`, `packages/db/`, `packages/domain/` |
| VPS/GitHub erişimi, yayın, yedek | [OPERATIONS](OPERATIONS.md) | `deploy/vps/`, gerçek operatör dosyaları |
| Açık işler / öncelik | [BACKLOG](../BACKLOG.md) | İlgili T- kartı, PR |
| Güncel tutma / az token / teslim | [UPDATE_PROTOCOL](UPDATE_PROTOCOL.md) | Görev kartı + kısa kanıt kaydı |

## Gerçek otoriteler

1. Açık kullanıcı kararı ve üst düzey oturum talimatları.
2. Korunan invariants/ADR ve etkin CI/bekçiler. Bu özetler yeni istisna üretmez.
3. Çalıştırılmış komut, gerçek deploy state, DB defteri ve aynı SHA'ya ait CI.
4. Tarihli STATE özeti. Eski sohbet, PR açıklaması veya eski devir notu canlı kanıt değildir.

Eski master/devir notları ve görev kartları güncel ağaçtan kaldırılmıştır; gerektiğinde [temizlik öncesi snapshot](https://github.com/shosgoren/EtkinWMS/tree/decbbe03fe1192473e096a1feb60cf090ca1fcf2/docs) içinden yalnız ilgili dosyayı oku. Kalan otoritelerin dizini [docs/README](../README.md) içindedir. Eski “Neon canlı”, “owner yok”, “tam 27 kaynak” veya “ürün yayımlandı” satırlarını güncel veri yerine kullanma.

## Yeni AI'a verilecek kısa mesaj

```text
Etkin WMS'ye devam et. Önce AGENTS.md, docs/continuity/README.md ve docs/STATE.md oku.
Yalnız mevcut görev alanının kısa rehberini ve ilgili kodu incele. Çalışma ağacını koru.
Kod/CI/canlı imaj/DB şemasını ayrı doğrula; sır isteme veya yayımlama.
Görev: <tek somut sonuç>. Bitince gerçek kanıtla docs/changes/<T-xxx>.md parçasını (STATE + BACKLOG) ve ilgili rehberi güncelle.
```

**STATE/BACKLOG nasıl güncellenir (kullanıcı kararı 21 Ekim, T-445):** iş PR'ı `docs/STATE.md` ve `docs/BACKLOG.md`'ye dokunmaz; kaydını `docs/changes/<T-xxx>.md` parçasına yazar ([biçim](../changes/README.md)). "Her iş STATE ve BACKLOG'u günceller" kuralı bu parçayla karşılanır. Koordinatör birleşmelerden sonra `node scripts/changes/fold.mjs` ile parçaları işler ve siler. Son durumu okurken STATE'e ek olarak `docs/changes/` altındaki işlenmemiş parçalara da bak.

Sürekli güncellik, [UPDATE_PROTOCOL](UPDATE_PROTOCOL.md)'ün her teslimde uygulanmasıyla sağlanır. Bu belgeler kendi kendine VPS izlemez veya zamanlanmış iş çalıştırmaz.
