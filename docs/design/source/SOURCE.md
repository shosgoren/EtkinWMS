# Tasarım kaynakları (I-18)

Bu klasördeki dosyalar Claude Design tuvalinden **değiştirilmeden** alınmış tam kaynaklardır. Elle düzenlenmez; tasarım değişince yeniden alınır ve aşağıdaki satır güncellenir.

| Dosya | Tuval | Tuval sürümü | Alındı | sha256 |
|---|---|---|---|---|
| `Bakis.dc.html` | https://claude.ai/artifact/4nmGwfnN4BfL6bkfWbLJC3 (sayfa "Uygulama · Görevlerim") | 1792049254-270d | 2026-10-15 | `f38a508b237a99683972698d34fdc639467864b4763f66d48e1c77d357bff457` |
| `Giris.dc.html` | https://claude.ai/artifact/4nmGwfnN4BfL6bkfWbLJC3 (sayfa "Uygulama · Giriş ve hesap") | 1792178725-d0cf | 2026-10-16 (T-998 ekleri kullanıcı onayı "Hepsini onaylıyorum" 17 Ekim 11:12; T-998: Cihazlar ekranına onay durumu (talep eden cihaz, terminaldeki 6 haneli doğrulama kodu alanı, ONAYLA/REDDET, onaysız cihaz giriş yapamaz bandı, otomatik durdurma uyarı bandı + OTURUMLARI KAPAT) ve terminal kaydı ekranı `v.enr` (cihaz adı → onay bekleniyor + doğrulama kodu → hazır) eklendi; önceki: T-412 hoş geldiniz e-postası kurumsal düzene geçti: lacivert marka bandı, sarı çizgi, düğme bilgilerin üstünde, ham bağlantı yok, şirket alt bilgisi; kullanıcı onayı "evet tamamdır" 16 Ekim 16:50; önceki: T-995 aktivasyon durumları eklendi: geçersiz bağlantı, MFA anahtarı + yedek kodlar, posta kapalı metni, hata satırı, MFA adımında geri yok; sol panel satırlarının boş çizilmesi düzeltildi; ilk sürüm onayı "Onaylıyorum" 15 Ekim 19:41; ek onay "onaylıyorum" 16 Ekim) | `29be2d2d85fa6605eca86869d5073e6d57759eb47cd5e81ddcc6e36a352b1d1f` |
| `Yonet.dc.html` | https://claude.ai/artifact/4nmGwfnN4BfL6bkfWbLJC3 (sayfa "Yönetim paneli") | 1792181577-b73c | 2026-10-16 (T-407 ekleri kullanıcı onayı "Hepsini onaylıyorum" 17 Ekim 11:12; T-407 Satış sayfası: VURGULU SATIR alanı, önizlemede vurgulu satır, SON YAYIN satırı, 30 dk önizleme bağlantısı kutusu; önceki: T-406 Ödemeler: satırda "Ödendi işaretle" + "Ödeme kaydı" penceresi (tarih, yöntem, not), başlıkta "Dönem tahakkuku" + onay penceresi; önceki: T-995 talep durumları eklendi: bağlantıyı iletin / süresi doldu / alan açıldı, Yeni bağlantı, tek seferlik bağlantı kutusu; ilk sürüm onayı "Tamam İyzico devam edebilirsin" 15 Ekim 22:36; ek onay "onaylıyorum" 16 Ekim) | `5135ec250d1dd609b2415d5d834fc73d21b2a79df273d5cc44f21d4c4bfff425` |

Not: Kaynaktaki ürün fotoğrafları (`/_blob/…`, cloudfront) tasarımın örnek verisidir; uygulamada ürün görseli gerçek üründen gelir.

Not (Giris): ekran seçici (`EKRAN` çubuğu), "Önizleme: kayıtsız cihazı göster" bağlantısı, örnek PIN (`482916`), QR desenleri ve `[Firma adı]` gibi yer tutucular tasarım aracının benzetimidir (DESIGN-PARITY §5); uygulamada gerçek veri ve gerçek QR kullanılır.

Not (Yonet): `[fiyat]`, `[Firma adı]`, `[tutar]`, `[son 4]` yer tutucularıdır; paket sınırları ve müşteri sayıları örnektir (Motive Rubber dışında gerçek müşteri yok). Uygulamada gerçek veri gelir; değer uydurulmaz (I-18 §4).

Not (Saha / satış sitesi): landing tuvali `Saha.dc.html` repoda `marketing/src/landing.dc.html` (üretim düzeltmeleriyle) olarak tutulur. T-407 fiyat bölümü tuvale (16 Ekim) ve üretim kopyasına aynı işaretlemeyle eklendi; tuvalde örnek üç paket ve `[fiyat]`, üretimde panelden yayınlanan paketler. Kullanıcı onayı 17 Ekim 11:12.
