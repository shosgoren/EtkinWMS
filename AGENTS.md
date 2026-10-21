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
- **ALTIN KURAL (kullanıcı, 19 Ekim):** her ekran ve alt ekran `docs/design/ALTIN-KURAL.md`ye uyar — eğitim gerektirmeyen, az tıklamalı, yazıdan çok anlamlı renkli/hareketli ikon, görsel+sesli geri bildirim, sesle işlem (NFC/kamera okutma hariç), role göre açılış. Kullanıcıya tekrar hatırlatılmaz.
- **Tasarım birebir (I-18):** Ekran işi `docs/design/DESIGN-PARITY.md` ile başlar. Kaynak `docs/design/source/*.dc.html`; CSS `scripts/design/port.mjs` ile üretilir, işaretleme ve ikonlar kaynaktan aktarılır; teslimde tasarım/uygulama ekran görüntüsü karşılaştırması zorunludur (kullanıcı kararı 20 Ekim: görüntü karşılaştırması ve ekran başı e2e zorunlu değil; CI yeşil + kaynak birebir). "Benzer", "esinlenilmiş" veya kütüphane ikonuyla yaklaşık uygulama teslim sayılmaz.
- Her anlamlı teslimde STATE/BACKLOG kaydını aynı PR'da `docs/changes/<T-xxx>.md` parçasına yaz (iş PR'ı `docs/STATE.md`/`docs/BACKLOG.md`'ye dokunmaz; koordinatör `node scripts/changes/fold.mjs` ile işler; biçim `docs/changes/README.md`) ve değişen alanın kısa rehberini güncelle. Başarı, hata ve eksik doğrulamayı birlikte kaydet.
- Belge değişikliği yeni yayın yetkisi değildir. Kullanıcıdan parola alma; parola/MFA girişini kullanıcı yapar.
