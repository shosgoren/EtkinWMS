# Sürekli güncel ve az token ile devam

## Tek durum kaynağı
`docs/STATE.md` ≤80 satır. Geçmişi buraya biriktirme. Son snapshot: tarih/saat/timezone, kaynak kod SHA, canlı image/current, schema/approved hash, kanıt, açık iş, görev sahibi ve çakışma. Eski STATE Git geçmişinde korunur; uzun teknik ayrıntı ilgili kart/PR/rehberde kalır.

Kısa rehberler tekrar eden metin deposu değildir; invariant/ADR/kod otoritesine link verir. Aynı kuralı beş dosyada farklı cümlelerle değiştirme. Değişen teknoloji/URL/rol/yayın akışı ilgili tek rehberde güncellenir; uzun otorite gerekiyorsa ayrı kartla güncellenir, sessiz çelişki yok.

## Her görevin teslim kapısı
1. Git status + mevcut branch/HEAD; diğer AI'ın işini ve task ID'lerini kontrol et.
2. Tek somut sonuç, kapsam, risk, gerekli kanıt ve en fazla5 okuma kaynağı. Karttaki dosya globs gerçek değişiklikle eşleşsin.
3. Uygula; anlamlı test/check; riskin istediği bağımsız exact diff incelemesi. Sırf rapor büyütmek için tekrar test yok.
4. Aynı PR'da STATE ve etkilenen kısa rehberi güncelle. Sadece belgenin adı değil, çalışan davranış/kanıt değişir.
5. CI/run/commit linkleri, actual command sonucu ve eksik doğrulama. Fake APPROVED-BY/security-reviewer raporu yok.
6. Merge sonrası PR merge ile source HEAD; deploy varsa gerçek release/DBkanıtı. Kod merge, deploy ve kullanıcı kabulünü ayrı işaretle.

## Durum etiketleri
- **DOĞRULANDI:** tarihli gerçek komut/CI/cihaz kanıtı.
- **KODDA VAR:** kaynakta var; canlıya geçiş kanıtı yok.
- **BİLDİRİLDİ:** başka görev/PR bildirdi; kendin doğrulamadın.
- **HEDEF/ÖNERİ:** istenen politika; uygulanmış sayılmaz.
- **UNKNOWN/BLOCKED:** erişim, test, karar veya kanıt eksik; neyin gerektiği açık.

## Başlangıç / token ekonomisi
- İlk tur: index + STATE + bir ilgili rehber. `rg` ile dar dosya/simge araması; `rg --files` keşfi. Bütün spec/sohbet/Cloud tool geçmişini okumak varsayılan değildir.
- Bağımsız metadata okumalarını bir çağrıda topla; sır okumayı/toplu env çıktısını buna katma.
- CI'nin exact SHA'daki son sonucu kaydet; durum değişmeden sık poll ve yeniden koşu yok. Testlerin terminal sonuçları eski commit içinse yeni commit geçti deme.
- Birden çok AI aynı DB/migration/VPS kesimini yapmaz. Tek operatör/sahip; paralellik ancak ayrık dosyalar ve gerçek yetkilendirme/koordinasyonla.
- Kısa rapor: sonuç, kanıt, kalan iş. Tüm geçmişi her mesaja kopyalama; tarihli dosyaya link ver.
- Limit kesilirse STATE/git status/commit edilmiş ve edilmemiş işin konumu kaydedilir. Limit hatası “iş güvensiz” veya “iş tamamlandı” değildir; approval/CI bypass yok.

## Devir şablonu
```text
Tarih/timezone:
Görev / sahip / branch:
Kaynak kod SHA / PR:
Canlı image/digest/current / DB schema:
Ne değişti:
Gerçek test/review/run kanıtı:
Yapılmayan / unknown:
Sırların güvenli konumu (değer yok):
Bir sonraki tek adım:
```

## Eski belgeyi nasıl yorumla?
Eski Fly/Neon, owner-yok, tam27 veya T911renewal satırı güncel STATE ile çelişirse onu tarihsel not olarak işaretle; geçmişin üstüne yeni doğrulama uydurma. Kod kuralları/spec çelişkisi bir “override” cümlesiyle çözülmez; ilgili tasarım/ADR/test etkisi gerekçelendirilir. Canlı gerçek durum ölçümü ise eski sohbet varsayımından önceliklidir.

Bu düzeni her AI uygularsa güncel kalır. Henüz bir scheduler, CI doküman freshness botu veya otomatik VPS monitor kurulmuş değildir; kurulması ayrı yetkili görevdir.
