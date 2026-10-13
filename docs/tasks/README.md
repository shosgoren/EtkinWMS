# Görev kartları

Burada güncel çalışmanın kartı, [yeni kart şablonu](_TEMPLATE.md) ve bekçilerin atıf yaptığı [pilot tablo sözleşmesi](T-006.md) kalır. Önce [STATE](../STATE.md)'teki sıradaki işi seçin; yalnız o işin kartını yazın.

Önceden yazılmış planlar ve eski teslimler [13 Ekim temizlik öncesi snapshot'ta](https://github.com/shosgoren/EtkinWMS/tree/decbbe03fe1192473e096a1feb60cf090ca1fcf2/docs/tasks) korunur; mevcut dosya ağacında ikinci arşiv tutulmaz. Dosyanın kaldırılması tamamlandı/iptal edildi demek değildir. Gerekirse tek kartı `git show decbbe03fe1192473e096a1feb60cf090ca1fcf2:docs/tasks/T-xxx.md` ile okuyun; kaynak kod/CI/canlı kanıtı ayrıca kontrol edin.

- **Yeni kart numaraları T-915 ve sonrasından devam eder.** Eski T-001…T-913 kimliklerini yeniden kullanmayın; dalları/açık PR'ları da kontrol edin.
- Sıradaki planın alanını spec/, ADR ve STATE'ten bulun; eski kartın kapsamını bugünkü koda uyarlamadan yeniden başlatmayın.
- Bir kart yalnız o görev dalı/PR'ının kapsamıdır. Tamamlanan kartı sonraki temizlikte Git geçmişine bırakın; CI'nin o dal için okuduğu kartı erken silmeyin.
- Tamamlanma kanıtı PR/CI/STATE'tedir. Yeni numara vermek eski işin kabulü sayılmaz.
