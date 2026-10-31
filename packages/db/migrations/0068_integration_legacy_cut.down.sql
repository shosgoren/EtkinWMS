-- 0068_integration_legacy_cut geri alma (T-1139): BİLEREK NO-OP (belgeli; ADR-015 / 0066 "veri düzeltmesi geri alınmaz" deseni).
-- up yalnız veri düzeltmesidir (şema değişmez): eski "e-posta + parola" yöntemiyle kurulmuş Paraşüt bağlantılarının mühürlü kimlik kutusu ve
-- webhook anahtarları silindi. Silinen belirteçler geri getirilemez; bağlantıyı CONNECTED'a döndürmek kimliksiz (CHECK ihlali) ya da sahte
-- kimlikli bir satır üretirdi. Kullanıcı kararı (31 Ekim) eski yönteme dönüşü de dışlar. audit satırları append-only'dir.
-- Bu yüzden down hiçbir satırı değiştirmez; yalnız defter kaydı düşer. Kesilen bağlantı DISCONNECTED + `LEGACY_METHOD_REMOVED` kalır ve
-- müşteri OAuth ile yeniden bağlanır. up yeniden uygulanırsa (idempotent) kesilmiş satırları yeniden seçmez (status <> 'DISCONNECTED').
DO $noop$
BEGIN
  RAISE NOTICE '0068 down: veri düzeltmesi geri alınmaz (silinen kimlik bilgisi geri getirilemez); şema değişikliği yok';
END
$noop$;
