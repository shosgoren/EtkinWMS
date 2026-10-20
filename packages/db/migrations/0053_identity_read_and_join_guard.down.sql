-- 0053_identity_read_and_join_guard geri alma (G-08). Uygulama önce geri alınmalıdır: stock/jobs.ts `credentials_changed_since`
-- işlevini çağırır. Silinen tek veri, bekleyen taleplerdeki kısa ömürlü doğrulama damgasıdır (kod yeniden doğrulanır); defter ve kimlik
-- verisi değişmez.
GRANT CREATE ON SCHEMA wms_probe TO wms_identity_probe;
SET ROLE wms_identity_probe;
DROP FUNCTION wms_probe.credentials_changed_since(uuid, timestamptz);
CREATE OR REPLACE FUNCTION wms_probe.field_join_verify(p_request uuid, p_code text)
RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_tenant uuid := NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid;
  v_r public.team_join_requests%ROWTYPE;
BEGIN
  IF v_tenant IS NULL OR p_request IS NULL THEN
    RAISE EXCEPTION 'field_join_verify: tenant bağlamı yok' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_r FROM public.team_join_requests r WHERE r.tenant_id = v_tenant AND r.id = p_request FOR UPDATE;
  IF NOT FOUND OR v_r.status <> 'PENDING' OR v_r.expires_at <= now() THEN
    RETURN 'GONE';
  END IF;
  IF p_code IS NULL OR p_code !~ '^[0-9]{6}$' OR p_code <> v_r.confirm_code THEN
    UPDATE public.team_join_requests r
       SET confirm_failed = r.confirm_failed + 1,
           status = CASE WHEN r.confirm_failed + 1 >= 3 THEN 'CANCELLED' ELSE r.status END
     WHERE r.id = v_r.id;
    RETURN 'WRONG';
  END IF;
  RETURN 'OK';
END
$fn$;
RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;

DROP TRIGGER team_join_requests_transition_guard ON public.team_join_requests;
DROP FUNCTION public.team_join_requests_transition_guard();
REVOKE UPDATE (code_verified_by, code_verified_at) ON public.team_join_requests FROM wms_identity_probe;
ALTER TABLE public.team_join_requests
  DROP CONSTRAINT team_join_requests_verified_chk,
  DROP COLUMN code_verified_at,
  DROP COLUMN code_verified_by;

REVOKE SELECT (id) ON public.security_events FROM wms_app;
GRANT SELECT ON public.security_events TO wms_app;
