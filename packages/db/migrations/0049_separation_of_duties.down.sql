-- 0049_separation_of_duties geri alma (G-08): sütun ve yetkisi kaldırılır. Kaybolan veri yalnız firma ayarıdır (varsayılan kapalıya döner).
-- Ayarı açmış firma varsa (güvenlik denetimi kaybolur) yalnız wms_meta.allow_destructive_down = 'on' ile.
DO $pre$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tenant_settings WHERE separation_of_duties)
     AND coalesce(pg_catalog.current_setting('wms_meta.allow_destructive_down', true), '') <> 'on' THEN
    RAISE EXCEPTION '0049_separation_of_duties down: görev ayrılığı açık firma var; allow_destructive_down gerekli';
  END IF;
END
$pre$;

ALTER TABLE public.tenant_settings DROP COLUMN separation_of_duties;

DO $verify$
BEGIN
  IF NOT pg_catalog.has_column_privilege('wms_app', 'public.tenant_settings', 'receiving_qc_enabled', 'UPDATE') THEN
    RAISE EXCEPTION '0049_separation_of_duties down: önceki ayar yetkisi kayboldu';
  END IF;
END
$verify$;
