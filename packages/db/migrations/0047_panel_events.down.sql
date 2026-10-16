-- 0047_panel_events geri alma (G-08): up'ın yarattığını ters sırayla kaldırır. Veri kaybettirmez (yalnız işlev ve dizin).
GRANT CREATE ON SCHEMA wms_probe TO wms_identity_probe;
SET ROLE wms_identity_probe;
DROP FUNCTION wms_probe.platform_list_events(integer);
RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;
-- Yalnız 0047'nin eklediği sütun geri alınır; 0042'nin verdiği (zaman/kullanıcı/tür/ayrıntı) müşteri işlevi için kalır (inceleme M1).
REVOKE SELECT (id) ON public.security_events FROM wms_identity_probe;
DROP INDEX public.security_events_platform_occurred_idx;

DO $verify$
BEGIN
  IF NOT pg_catalog.has_column_privilege('wms_identity_probe', 'public.security_events', 'detail', 'SELECT') THEN
    RAISE EXCEPTION '0047_panel_events down: 0042 olay okuma yetkisi kayboldu';
  END IF;
END
$verify$;
