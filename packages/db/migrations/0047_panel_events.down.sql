-- 0047_panel_events geri alma (G-08): up'ın yarattığını ters sırayla kaldırır. Veri kaybettirmez (yalnız işlev ve dizin).
GRANT CREATE ON SCHEMA wms_probe TO wms_identity_probe;
SET ROLE wms_identity_probe;
DROP FUNCTION wms_probe.platform_list_events(integer);
RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;
REVOKE SELECT (id, occurred_at, user_id, event_type, detail) ON public.security_events FROM wms_identity_probe;
DROP INDEX public.security_events_platform_occurred_idx;
