# Etkin WMS — AI başlangıç talimatı

Önce `docs/continuity/README.md` ve `docs/STATE.md` oku. Sonra yalnız görev alanının kural dosyasını ve ilgili kodu aç. Bütün geçmişi veya bütün depoyu bağlama doldurma.

- Kullanıcı hedefi: sektör bağımsız, aylık kiralanabilir SaaS; ilk müşteri Motive Rubber. Marka **Etkin WMS**.
- Yalnız `shosgoren/EtkinWMS` değiştirilebilir. `2027-WMS-1` salt okunur referanstır; oraya push, PR, servis veya veri değişimi yapılmaz.
- Çalışma ağacını/dalı önce kontrol et; başka AI'ın değişikliğini reset, checkout-overwrite veya force push ile silme.
- GitHub kodu, CI, canlı imaj ve gerçek DB migration defteri ayrı durumdur. Birinden diğerini varsayma.
- Sırlar, özel anahtarlar, DB URI'leri, MFA anahtarları, yedek kodlar ve tek kullanımlık bağlantılar dokümana/loga/sohbete girmez.
- `docs/INVARIANTS.md`, `docs/agents/PROTOCOL.md` ve mekanik bekçiler geçerlidir. Bu dosya onları gevşetmez; üst düzey talimat ve açık kullanıcı kararı önceliklidir.
- Roller sorumluluktur; otomatik çoklu ajan veya belli bir model kullanma talimatı değildir. Riskin istediği bağımsız incelemeyi gerçek kanıtla sağla; rapor uydurma.
- Web kodunda `apps/web/AGENTS.md` ve kurulu Next.js sürümünün yerel belgelerini ayrıca oku.
- **Tasarım birebir (I-18):** Ekran işi `docs/design/DESIGN-PARITY.md` ile başlar. Kaynak `docs/design/source/*.dc.html`; CSS `scripts/design/port.mjs` ile üretilir, işaretleme ve ikonlar kaynaktan aktarılır; teslimde tasarım/uygulama ekran görüntüsü karşılaştırması zorunludur. "Benzer", "esinlenilmiş" veya kütüphane ikonuyla yaklaşık uygulama teslim sayılmaz.
- Her anlamlı teslimde `docs/STATE.md` ve değişen alanın kısa rehberini aynı PR'da güncelle. Başarı, hata ve eksik doğrulamayı birlikte kaydet.
- Belge değişikliği yeni yayın yetkisi değildir. Kullanıcıdan parola alma; parola/MFA girişini kullanıcı yapar.
