-- 0038_demo_requests geri alma (G-08, ADR-015 §9): up'ın yarattığını ters sırayla kaldırır.
-- VERİ KAYBETTİRİR: talep satırı (kişisel veri ve operatör kararları) varsa yalnızca wms_meta.allow_destructive_down = 'on'
-- (WMS_ENV local|ci) iken çalışır (0014 ile aynı kural; inceleme M-1/m-5).
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM wms_platform.demo_requests)
     AND coalesce(pg_catalog.current_setting('wms_meta.allow_destructive_down', true), '') <> 'on' THEN
    RAISE EXCEPTION '0038_demo_requests down: wms_platform.demo_requests tablosunda satır var; veri kaybettiren geri alma bu ortamda kapalı';
  END IF;
END
$guard$;

-- security_events tetikleyici işlevi 0007 gövdesine döner (platform[_.] kuralı kalkar).
CREATE OR REPLACE FUNCTION public.security_events_restrict_identity_writers() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF pg_catalog.lower(NEW.event_type) ~ '^(login_|logout|password[_.]|two_factor_|reauth[_.]|session[_.]|mfa[_.]|account[_.]|password_reset_link[_.]|demo\.(account|password)[_.])'
     AND current_user::text <> 'wms_auth' THEN
    RAISE EXCEPTION 'security_events: kimlik olayı (%) yalnızca wms_auth tarafından yazılabilir', NEW.event_type
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$fn$;

-- İşlevler: sahiplik SET ROLE kalıbıyla (migration rolü probe'a INHERIT FALSE üyedir; 0014 down ile aynı).
SET ROLE wms_identity_probe;
DROP FUNCTION wms_probe.platform_decide_demo_request(uuid, text);
DROP FUNCTION wms_probe.platform_list_demo_requests(integer);
DROP FUNCTION wms_probe.platform_ingest_demo_request(uuid, timestamptz, text, text, text, text, text);
DROP FUNCTION wms_probe.platform_is_operator();
RESET ROLE;

REVOKE INSERT (user_id, event_type, detail) ON public.security_events FROM wms_identity_probe;
DROP TABLE wms_platform.demo_requests;
DROP TABLE wms_platform.operators;
DROP SCHEMA wms_platform;
