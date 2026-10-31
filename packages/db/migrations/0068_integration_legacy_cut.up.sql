-- 0068_integration_legacy_cut (T-1139; kullanıcı kararı 31 Ekim 2026: "eski yöntem olmasın"): Paraşüt'e eski "e-posta + parola" yöntemiyle
-- kurulmuş bağlantılar zorla kesilir; müşteri OAuth ile (Etkin'in ortak uygulaması ya da kendi uygulaması) yeniden bağlanır. Yalnız VERİ
-- düzeltmesidir: şema, yetki ve politika değişmez. Müşteri verisi SİLİNMEZ: ürün, cari, depo, stok, belge, dış eşleme (`external_refs`),
-- gönderim kuyruğu, çalışma günlüğü ve akış tercihleri (aç/kapa + yön) yerinde kalır; kesilen yalnız bağlantıdır.
--
-- BİLİNÇLİ KARARLAR (inceleme için):
-- * Eski yöntem bağlantısının tanımı T-1137 ekran işaretiyle (`getIntegrationOverview` `legacy`) BİREBİR aynıdır: kesilmemiş Paraşüt
--   bağlantısı + aynı tenant'ta bağlanma anını (`connected_at`) önceleyen 1 saat içinde TAMAMLANMIŞ (COMPLETE) OAuth denemesi YOK.
--   OAuth bağlantısında deneme COMPLETE'e bağlantı satırıyla AYNI transaction'da geçer (oauth.ts `selectParasutOAuthCompany` → beforeWrite;
--   `connected_at = now()`), deneme en çok 10 dk yaşar (0061 CHECK) ve `wms_app`'in denemelerde DELETE yetkisi yoktur (0061) → her OAuth
--   bağlantısının penceresinde bir COMPLETE deneme vardır; ortak uygulama ile kendi uygulaması aynı tabloyu kullanır. Pencere bilerek
--   geniştir (1 saat > 10 dk): şüphede bağlantı OAuth sayılır ve DOKUNULMAZ. T-1137 yayınından beri yeni parola bağlantısı kurulamaz
--   (sunucu eylemi UNSUPPORTED), T-1139 ile yol koddan da kalktı: küme donmuştur.
-- * Kimlik bilgisi silinir (mühürlü kutu NULL; 0055 CHECK: DISCONNECTED <=> NULL). Belirteçler bu yüzden geri getirilemez → down
--   bilerek no-op'tur (aşağıda değil, down dosyasında gerekçesi).
-- * `last_error_code = 'LEGACY_METHOD_REMOVED'`: ekran bu kodla kesilmiş bağlantıyı AUTH "Yeniden bağlan" olarak gösterir (health.ts).
--   OAuth ile yeniden bağlanma (`connectParasutAuthorized` UPSERT) kodu temizler; `connected_at` korunur → ilk bağlantı varsayılanı yeniden
--   uygulanmaz, akış tercihleri olduğu gibi geri gelir. `account_ref` korunur → eşleme varken başka şirkete bağlanma yine reddedilir.
-- * Akış satırları açık kalabilir: hiçbir eşitleme yolu kesilmiş bağlantıda koşmaz (zamanlayıcı/el ile koşu/webhook araması/yaşam döngüsü
--   `status = 'CONNECTED'` ister; senkron `DISCONNECTED`'ı atlar; belirteç okuması NOT_CONNECTED döner).
-- * Anlık bildirim (T-1138) kayıtları: anahtarlar silinir (NULL), satırlar DELETED, bağlantıda durum OFF (`clearWebhooksInTx` ile aynı).
--   Migration ağ çağrısı yapamaz: Paraşüt'te kalan kayıt, OAuth ile yeniden bağlanınca kayıt işi tarafından kimliğiyle silinir
--   (webhook-register.ts, en iyi çaba); o zamana dek gelen teslim, alıcı uçta bağlı (CONNECTED) bağlantı bulamadığı için işlenmez.
-- * Yarım kalmış OAuth denemelerine dokunulmaz (müşteri yeniden bağlanırken kullanır; tek kullanımlık, 10 dk).
-- * Bağlantı başına bir `integration.disconnected` audit satırı (I-12; 0066 `migration_0066` deseni): via `migration_0068`, reason
--   `LEGACY_METHOD_REMOVED`, silinen webhook sayısı ve açık bırakılan akışlar. Sır, belirteç, şirket adı audit'e yazılmaz.

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.integration_oauth_attempts') IS NULL OR pg_catalog.to_regclass('public.integration_webhooks') IS NULL THEN
    RAISE EXCEPTION '0068_integration_legacy_cut: 0061/0067 önkoşulu yok';
  END IF;
END
$pre$;

-- Veri düzeltmesi bütün tenant'larda koşar: tablo sahibi FORCE RLS altındadır (0066 deseni) → NO FORCE, işlem, sonda FORCE geri
-- (koşturucu tek transaction'dır; hata hepsini geri alır).
ALTER TABLE public.integrations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.integration_flows NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.integration_webhooks NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.integration_oauth_attempts NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs NO FORCE ROW LEVEL SECURITY;

DO $cut$
DECLARE
  r record;
  n_hooks integer;
  on_flows jsonb;
BEGIN
  FOR r IN
    SELECT i.tenant_id, i.id, i.provider
      FROM public.integrations i
     WHERE i.provider = 'PARASUT'
       AND i.status <> 'DISCONNECTED'
       AND NOT EXISTS (
             SELECT 1 FROM public.integration_oauth_attempts a
              WHERE a.tenant_id = i.tenant_id AND a.phase = 'COMPLETE'
                AND a.created_at <= i.connected_at AND a.created_at >= i.connected_at - interval '1 hour')
     ORDER BY i.tenant_id, i.id
       FOR UPDATE OF i
  LOOP
    WITH d AS (
      UPDATE public.integration_webhooks SET status = 'DELETED', key_box = NULL
       WHERE tenant_id = r.tenant_id AND integration_id = r.id AND status = 'ACTIVE'
      RETURNING 1)
    SELECT count(*)::int INTO n_hooks FROM d;
    SELECT COALESCE(pg_catalog.jsonb_agg(f.flow ORDER BY f.flow), '[]'::jsonb) INTO on_flows
      FROM public.integration_flows f
     WHERE f.tenant_id = r.tenant_id AND f.integration_id = r.id AND f.enabled;
    UPDATE public.integrations
       SET status = 'DISCONNECTED', credentials = NULL, last_error_code = 'LEGACY_METHOD_REMOVED',
           webhook_status = 'OFF', webhook_checked_at = NULL, webhook_last_error_code = NULL
     WHERE tenant_id = r.tenant_id AND id = r.id;
    INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, change_summary)
    VALUES (r.tenant_id, NULL, 'integration.disconnected', 'integration', r.id::text,
            pg_catalog.jsonb_build_object('provider', r.provider, 'via', 'migration_0068', 'reason', 'LEGACY_METHOD_REMOVED',
                                          'webhooks_removed', n_hooks, 'flows_kept', on_flows));
  END LOOP;
END
$cut$;

ALTER TABLE public.integrations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.integration_flows FORCE ROW LEVEL SECURITY;
ALTER TABLE public.integration_webhooks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.integration_oauth_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;
