# Etkin WMS belgeleri

**Başlangıç:** [Kısa rehberler](continuity/README.md) + [güncel durum](STATE.md). Bütün klasörleri okumayın; görev alanına göre ilerleyin.

| Gerektiğinde | Kaynak / neden kalıyor |
|---|---|
| Mimari, kod, UX, DB, test, VPS, yayın, yedek | [continuity/](continuity/README.md): günlük devam rehberleri |
| Kod konumları ve kilitli sürümler | [MAP](MAP.md), [STACK](STACK.md): CI doğrular |
| Güvenlik ve stok garantileri | [INVARIANTS](INVARIANTS.md), [ACCEPTANCE](ACCEPTANCE.md), ACCEPTANCE.conditions.json: korunan test sözleşmeleri |
| Tasarım kararları | [ADR listesi](DECISIONS.md), adr/: nedenleri ve kısıtları; sıradan devir notu değildir |
| Ayrıntılı ürün kuralları | [spec/](spec/00-index.md): yalnız ilgili bölüm |
| Kullanıcı akışı ve görsel referans | design/, ux/: erişilebilirlik ve tasarım ölçütleri |
| İşletim ve hesap kurtarma | [Operasyon](continuity/OPERATIONS.md), [ops rolü](RUNBOOK-ops.md), [ilk hesap](operations/INITIAL_OWNER_ENROLLMENT.md) |
| Pilot ve varsayım kayıtları | [PILOT](PILOT.md), [PHASES](PHASES.md), [OPEN_QUESTIONS](OPEN_QUESTIONS.md): bazı alanlar bekçilerce okunur; canlı durum için STATE |
| Görev ve teslim disiplini | [tasks/](tasks/README.md), [protokol](agents/PROTOCOL.md), agents/REPORT_TEMPLATE.md |
| Terimler / kısa geçmiş | [GLOSSARY](GLOSSARY.md), [JOURNAL](JOURNAL.md): hedefli başvuru; başlangıçta okunmaz |

Eski toplu master, VPS/devir snapshot'ları ve yüzlerce eski görev kartı güncel ağaçtan kaldırıldı. **Silinmeleri işlerin tamamlandığı anlamına gelmez.** Gerektiğinde [temizlik öncesi Git snapshot'ından](https://github.com/shosgoren/EtkinWMS/tree/decbbe03fe1192473e096a1feb60cf090ca1fcf2/docs) tek dosya geri okunabilir. Kopya arşiv klasörü oluşturmayın.
