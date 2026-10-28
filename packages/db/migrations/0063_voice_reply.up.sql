-- 0063_voice_reply (T-1109, B-134; kullanıcı kararı 22 Ekim): Etkin sesli yanıt firma ayarı. G-08: yalnızca GENİŞLETME (bir sütun, bir
-- sütun yetkisi).
--
-- BİLİNÇLİ KARARLAR (inceleme için):
-- * Varsayılan KAPALI (kullanıcı kararı): mevcut firmalarda Etkin sessiz kalır; yönetici Ayarlar'dan açar. Kullanıcının "Sessiz" tercihi
--   (cihazda) ayrıca kapatır.
-- * Yazan: yalnız `wms_app`, yalnız bu sütun; komut `settings.manage` ister ve `tenant.settings_changed` kaydı yazar. Okuma her üyenin
--   (`stock.view`; yalnız bu bayrak döner, başka ayar sızmaz).
-- Koşturucu tek transaction içinde çalıştırır.

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'items' AND column_name = 'source_state') THEN
    RAISE EXCEPTION '0063_voice_reply: 0062 önkoşulu yok';
  END IF;
END
$pre$;

ALTER TABLE public.tenant_settings ADD COLUMN voice_reply boolean NOT NULL DEFAULT false;
GRANT UPDATE (voice_reply) ON public.tenant_settings TO wms_app;

DO $verify$
DECLARE
  r text;
BEGIN
  IF NOT pg_catalog.has_column_privilege('wms_app', 'public.tenant_settings', 'voice_reply', 'UPDATE') THEN
    RAISE EXCEPTION '0063_voice_reply: wms_app ayarı yazamıyor';
  END IF;
  FOREACH r IN ARRAY ARRAY['wms_auth', 'wms_worker'] LOOP
    IF pg_catalog.to_regrole(r) IS NOT NULL
       AND pg_catalog.has_column_privilege(r, 'public.tenant_settings', 'voice_reply', 'UPDATE') THEN
      RAISE EXCEPTION '0063_voice_reply: % rolü ayarı yazabiliyor', r;
    END IF;
  END LOOP;
END
$verify$;
