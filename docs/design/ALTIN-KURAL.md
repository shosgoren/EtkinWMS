# Altın kural (kullanıcı kararı 19 Ekim 2026 — her ekran ve alt ekran için ilk kural)

Kullanıcının ifadesiyle "aşılmaması gereken en baş kural". Tasarım tuvali, kod aktarımı ve inceleme bu listeye göre yapılır; kullanıcının
her seferinde hatırlatması beklenmez.

1. **Eğitim gerektirmez.** Program kullanmayı hiç bilmeyen biri ilk bakışta ne yapacağını anlar. Az tıklama, hızlı işlem.
2. **Yazıdan çok görsel.** İşlemi ifade eden anlamlı, renkli ve hareketli ikonlar. "Standart" form/tablo görünümü teslim sayılmaz.
3. **Geri bildirim görsel ve sesli.** Başarı, uyarı ve hata hem görsel (renk, hareket) hem ses ile fark edilir.
4. **Sesle işlem.** Miktarı yazmak yerine söylemek; görev numarası ya da cari adı söyleyince ilgili görev(ler)in hemen listelenmesi; yetkisi
   olan kullanıcı ayarlara kadar (ör. kullanıcı yetkisi) sesle ilerleyebilir. Etkin AI ("Etkin") yetki verilen kullanıcıya açılır.
5. **Okutma istisnası.** NFC ile dokunma ve kamerayla okutma zorunlu kalır; ses bunların yerine geçmez.
6. **Alt ekranlar dahil.** Tıklanınca açılan her pencere, liste ve form aynı kurala göre elden geçirilir.

## Role göre beklenti (aynı karar)
- **Hesap sahibi / yönetici:** ilk ekran anlık, dinamik depo panosu — yolunda gitmeyenler, satın alınması gereken ürünler, stok devir hızı,
  geciken siparişler. Okutma odaklı görev kartı ekranı onun açılışı değildir.
- **Depo yöneticisi:** masaüstü web ağırlıklı — planlama, depo(lar)ının raporları, saha personeli ve yetkileri; mobil yazıcı yoksa giriş/çıkış
  hareketinden etiketi (ürün giriş, sevk) yeniden basma.
- **Sayım kullanıcısı:** yalnız kendisine atanmış sayım görevleri; diğer görev ekranları görünmez.
- **Saha personeli:** görev kartlı okutma ekranı; yalnız grubunun izin verdiği görev ekranları.
- **Yetki grupları:** sabit roller yerine özel isimli gruplar — grup oluştur → yetkileri ve görünecek görev ekranlarını ikonlarla seç → kullanıcıları
  ekle; 50 kullanıcıda bile birkaç dokunuş. Bugünkü roller hazır şablon olarak kalır.
- **Üst çubuk:** sağ üstte ayarlara kolay erişen anlamlı, hareketli ikonlar ve Etkin AI düğmesi.

## Ekran standardı (19 Ekim, tuvalde onaylandı; her yeni ekran buna uyar)
- **Alt cam çubuk (tek el; 20 Ekim kullanıcı onayı, kaynak `Kabuk.dc.html`):** saydam buzlu oval; içerik altında kalmaz. Solda **Geri + Ana ekran** (20 Ekim kullanıcı kararı: sol düğme **her ekranda Geri**; ana ekranda gidecek yer yoksa pasif) · ortada yükseltilmiş ana işlem (ana ekranda OKUT, yumuşak yeşil #5FAF8A; alt ekranlarda ekranın ana işlemi, etiket altında: EKLE, ONAYLA…) · sağda **Modüller** (2×2 ızgara; yetkiye göre açılan modül sayfası) ve **Etkin** (bas-konuş; iki kez dokununca uzun dinleme, "bitti" ile biter). Masaüstünde çubuk ortalı hap (≤ 720 px). Üstte geri ya da ana ekran düğmesi yok.
- **Modüller sayfası:** buzlu perde + cam panel; yalnız rolün/yetkinin açtığı modüller (renkli ikon kutusu, ad, kısa alt yazı); henüz yapılmamış modülde "YAKINDA"; telefon 3, tablet 4, masaüstü 5 sütun; sığmayan "+N daha · ara ya da söyle"; üstte "Modül ara ya da söyle".
- **Etkin (sesli komut):** basılı tutunca hafif büyüyen düğme + buzlu dinleme perdesi, nabız halkası, canlı yazı; stok ya da yetki değiştiren komutta önce "Anladım" kartı (ikonlu özet + Onayla / Düzelt, "onayla" demek de yeter); salt okuma komutu sonucu doğrudan açar; başarı/hata renk + ses.
- **İlk kullanım rehberi:** her ekran ilk açılışta en çok 5 adım (hedef sarı çerçeve, kart: ADIM n/N, başlık, tek cümle, sesli anlat, Atla, İleri / Bitti); vurgulanan öğeye dokunmak da ilerletir; görüldü bilgisi kullanıcıya bağlı (sunucuda); tekrar açmak Destek penceresindeki "Rehberi aç" ile.
- **Kaydedilmemiş iş uyarısı:** yarım iş varken Geri veya Ana ekran → yüzen kısayoldaki gibi engelleyen buzlu perde + cam kutu: "… ve çık" · "Kaydetmeden çık" · "Vazgeç, burada kalayım". Değişiklik yoksa sormadan geçer.
- **Üst çubuk:** hareketli logo noktası (sitedeki `animateMotion` yolu) + çevrimiçi noktası, "Etkin WMS" + çalışma alanı adı; sağda **yazısız iki ikon** (20 Ekim kullanıcı kararı, kaynak `Destek.dc.html`): **Sorun bildir** (sarı üçgen → yöneticiye) ve **Destek** (kulaklık → Etkin ekibine; ekip yanıtında rozet) — her ekranda, kalıp ekranlarında da aynı yerde; ardından Bildirim, Ekip (menü: Kullanıcılar, Onay bekleyenler, Yetki grupları, Çıkış yap; saha/sayımda Hesap: Kullanıcı değiştir, Çıkış yap), Ayarlar. Menüler kısayol halkasıyla aynı perde + cam kutudur.
- **Yüzen kısayol:** küçük saydam lacivert, 2×2 kare ikon, sürüklenir; dokununca dikey menü + engelleyen perde; rol ve izne göre, kullanıcı "Düzenle" ile seçer (en çok 6, yalnız yetkili ekranlar).
- **Telefon ve tablette dikey/yatay kaydırma yok;** sığmayan liste "+N daha · ara ya da söyle" satırıyla biter.
- **Renk (trafik ışığı):** yalnız sorunlu kart dolu renk (kırmızı / turuncu); sakin kartlar beyaz, renk ikon ve sayıda. Düğme ikonları hareketsiz; hareket yalnız logo noktası, çevrimiçi nabız, zil ve Etkin halkası.
- **Arka plan** #EEF1F4 → #DCE3EA; **karanlık tema** saf siyah değil (#121B24 → #0F171F), yazı #E6EBEF, vurgular kısık.
- **Otomatik cihaz:** < 700 px telefon, < 1100 px ya da dokunmatik tablet, diğerleri masaüstü (Görevlerim `detect()` ile aynı).
