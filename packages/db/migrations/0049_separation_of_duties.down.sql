-- 0049_separation_of_duties geri alma (G-08): sütun ve yetkisi kaldırılır. Kaybolan veri yalnız firma ayarıdır (varsayılan kapalıya döner).
REVOKE UPDATE (separation_of_duties) ON public.tenant_settings FROM wms_app;
ALTER TABLE public.tenant_settings DROP COLUMN separation_of_duties;

DO $verify$
BEGIN
  IF NOT pg_catalog.has_column_privilege('wms_app', 'public.tenant_settings', 'receiving_qc_enabled', 'UPDATE') THEN
    RAISE EXCEPTION '0049_separation_of_duties down: önceki ayar yetkisi kayboldu';
  END IF;
END
$verify$;
