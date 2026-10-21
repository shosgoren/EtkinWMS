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

## Ortak davranış kuralları (kullanıcı onayı 21 Ekim; madde 5–17 — T-436)
Maddeler 1–4 ve ortak perde T-980'dedir. Aşağıdakiler ortak bileşenlerdedir; ekran bunları kullanınca kuralı kendiliğinden alır.

5. **Ses ve titreşim tek kaynaktan.** Tek işlev `@wms/ui` `sesCal` (dokunma/tamam/uyarı/hata, okutma); ekranlar `feedback.*` çağırır.
   **Ses ve balon yalnız anlamlı sonuçlarda kullanılır: kaydetme, okutma, onay, hata, uyarı. Kopyala, aç/kapat, sekme değiştir gibi küçük
   işlemler sessizdir; bunlarda yalnız düğmenin kendi içinde kısa bir görsel değişim olur (ör. tik + "Kopyalandı", 2 sn).** API ayrımı:
   `feedback.minor()` sessiz, `feedback.ok/warn/error()` sesli. Hesap menüsünde "Sessiz" (cihazda saklanır). Balon tek ortak katmandır
   (`kalip/balon.tsx`, kök düzende) ve kendi sesini çalar. Bekçi: `apps/web/app/kural-bekci.test.ts`.
6. **Yükleniyor.** 1 sn'den uzun işlemde düğmede dönen gösterge (`.kyuk`), aynı işlem iki kez gönderilmez (`useTekGonderim`, alt çubuk
   ana işleminde `busy`, `KalipPencereDugme loading`). Kiracı yerleşiminde iskelet ekran (`t/[slug]/loading.tsx`).
7. **Hata ve yeniden dene.** Ortak hata ekranı (`kalip/hata-ekrani.tsx`): ikon, tek cümle, Tekrar dene, destek kodu, hata sesi; ham hata
   metni gösterilmez. Kiracı `error.tsx` + `not-found.tsx`, panel `error.tsx`.
8. **Boş durum.** Her listede ikon + tek cümle + sıradaki adım düğmesi (`KalipBos action.kind`: add/clear/go). Arama sonucu yoksa
   "Bulunamadı · ara ya da söyle".
9. **Çevrimdışı.** Bağlantı kopunca üstte ortak şerit; çevrimdışı gönderim açıkça engellenir, "Bağlantı yok · bağlanınca tekrar dene"
   balonu. Çevrimdışı kuyruk yoktur (saklayıp sonra gönderme yapılmaz).
10. **Silme ve arşivleme.** Geri dönüşü olan işlem onay sormaz; birkaç saniye "Geri al" balonu (`feedback.undo`) sunucuda geri alır.
    Geri dönüşü olmayan işlem onay penceresinde kalır. Gruplama listesi: `docs/tasks/T-436.md`.
11. **Odak ve klavye.** Her perde Esc ile kapanır, odak içinde kalır ve kapanınca açan düğmeye döner (`kalip/odak.ts` `useModalFocus`;
    T-980 ortak perdesi buna bağlanır). Odak çerçevesi 4 px sarı. Balonlar kalıcı `aria-live` bölgesinden duyurulur.
12. **Dokunma hedefi.** En az 44 px, saha ekranlarında 48 px (e2e ölçüm yardımcısı `tests/e2e/support/dokunma.ts`).
13. **Hareket azaltma.** "Hareketi azalt" açıksa CSS animasyonları, SVG `animateMotion` (logo noktası), nabız halkası ve titreşim durur.
14. **Karanlık tema.** Tema seçiminde "Otomatik (sistem)"; eski yüzeyler (alt sayfa, ilk kullanım rehberi, hata ekranı) de temayı izler.
15. **Uzun listeler.** Sunucu sayfalaması ve toplam sayı.
16. **Sayı ve tarih biçimi.** Sabit "tr-TR" yok; kullanıcının dili ortak `@wms/ui` format yardımcısıyla (bekçi: ESLint + birim testi).
17. **Yetkisiz dokunuş.** Kilitli öğe gizlenmezse dokununca sarı "Değiştirme yetkin yok · sorumluna sor" balonu + hata sesi
    (`kalip/kilitli.tsx`, `KalipSatir`/`KalipAnahtar` `locked`).
