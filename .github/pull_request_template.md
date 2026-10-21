## Yapılan

## Doğrulama (komut + sayı)

## Durum (kod / CI / migration / canlı)

## ALTIN-KURAL kontrolü
<!-- Ekran işi olan her PR'da zorunlu (CLAUDE.md, kullanıcı kararı 21 Ekim). Her madde "uyuldu" ya da gerekçeli "uygulanamaz". Kaynak: docs/design/ALTIN-KURAL.md §Ekran standardı. -->
- [ ] Yalnız `kalip/` ortak bileşenleri (form `KalipFormEkran`, seçim `KalipSecim`, çıkış `useCikisKorumasi`, perde `KalipPerdeKatman`, balon/ses `useKalipToast`/`tone`):
- [ ] Perde / cam kutu: her menü, sayfa, pencere tek buzlu perde (≥8px + belirteçli karartma), arka plan net kalmıyor:
- [ ] Çıkış uyarısı: yarım işte her çıkışta yalnız uygulamanın cam kutusu; değişiklik yoksa sormadan; tarayıcı uyarısı yalnız sekme kapatma/yenileme:
- [ ] Form doğrulama: zorunlu "*", kırmızı çerçeve + sarsılma + alan altı neden, ilk hatalı alana odak, balon + ses; sunucu alan hatası ilgili alanda:
- [ ] Ana işlem sessiz kapanmıyor: pasif görünüm + dokununca neden balonu ve hata sesi; değişiklik rozeti:
- [ ] Görsel ve sesli geri bildirim (başarı / uyarı / hata):
- [ ] Kilitli / boş / hata / yükleniyor durumları tasarım dilinde (ham hata metni yok):
- [ ] Alt cam çubuk (Geri · Ana ekran · ana işlem · Modüller · Etkin) ve üst çubuk (Sorun bildir · Destek · Hesap) standardı:
- [ ] Yerel `<select>` / elle `<dialog>` / `window.confirm` yok (ESLint `wms/ui-standard`, `ui-standards.test.ts`):
- [ ] Karanlık tema:
- [ ] Dokunma hedefi ≥44 px (sahada 48 px), telefonda yatay kaydırma yok:
- [ ] Hareket azaltma:

