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
