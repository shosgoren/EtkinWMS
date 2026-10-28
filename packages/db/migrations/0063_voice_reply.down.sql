-- 0063_voice_reply geri alma (G-08): sütun ve yetkisi kaldırılır. Kaybolan veri yalnız firma tercihidir (sesli yanıt kapalıya döner);
-- güvenlik denetimi değildir, bu yüzden allow_destructive_down istenmez.
ALTER TABLE public.tenant_settings DROP COLUMN voice_reply;

DO $verify$
BEGIN
  IF NOT pg_catalog.has_column_privilege('wms_app', 'public.tenant_settings', 'separation_of_duties', 'UPDATE') THEN
    RAISE EXCEPTION '0063_voice_reply down: önceki ayar yetkisi kayboldu';
  END IF;
END
$verify$;
