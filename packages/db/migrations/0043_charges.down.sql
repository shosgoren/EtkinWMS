-- 0043_charges geri alma (G-08, ADR-015 §9): up'ın yarattığını ters sırayla kaldırır; müşteri listesi işlevi 0042 tanımına döner.
-- VERİ KAYBETTİRİR: tahakkuk varsa yalnızca wms_meta.allow_destructive_down = 'on' (WMS_ENV local|ci) iken çalışır.
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM wms_platform.charges)
     AND coalesce(pg_catalog.current_setting('wms_meta.allow_destructive_down', true), '') <> 'on' THEN
    RAISE EXCEPTION '0043_charges down: tahakkuk kaydı var; veri kaybettiren geri alma bu ortamda kapalı';
  END IF;
END
$guard$;

GRANT CREATE ON SCHEMA wms_probe TO wms_identity_probe;
SET ROLE wms_identity_probe;
DROP FUNCTION wms_probe.platform_mark_charge_paid(uuid, date, text, text);
DROP FUNCTION wms_probe.platform_accrue_charges();
DROP FUNCTION wms_probe.platform_list_charges();
DROP FUNCTION wms_probe.platform_list_customers();
CREATE FUNCTION wms_probe.platform_list_customers()
RETURNS TABLE (id uuid, name text, slug text, status text, created_at timestamptz, subscription text, trial_ends_at timestamptz,
               plan_id uuid, plan_name text, price_monthly numeric, max_admins integer, max_field integer, max_warehouses integer,
               max_items integer, admins integer, field integer, warehouses integer, items integer, last_login timestamptz)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  r record;
  v_prev text;
BEGIN
  IF NOT wms_probe.platform_is_operator() THEN
    RAISE EXCEPTION 'platform_list_customers: operatör değil' USING ERRCODE = '42501';
  END IF;
  v_prev := pg_catalog.current_setting('app.current_tenant_id', true);
  FOR r IN
    SELECT t.id AS tid, t.name AS tname, t.slug AS tslug, t.status AS tstatus, t.created_at AS tcreated, s.plan AS splan,
           s.trial_ends_at AS strial, p.id AS pid, p.name AS pname, v.price_monthly AS vprice, v.max_admins AS vadm,
           v.max_field AS vfield, v.max_warehouses AS vwh, v.max_items AS vitems
      FROM public.tenants t
      LEFT JOIN wms_platform.subscriptions s ON s.tenant_id = t.id
      LEFT JOIN wms_platform.plans p ON p.id = s.plan_id
      LEFT JOIN wms_platform.plan_versions v ON v.plan_id = s.plan_id AND v.version = s.plan_version
     WHERE NOT t.is_demo
     ORDER BY t.created_at DESC, t.id
  LOOP
    PERFORM pg_catalog.set_config('app.current_tenant_id', r.tid::text, true);
    id := r.tid; name := r.tname; slug := r.tslug; status := r.tstatus; created_at := r.tcreated; subscription := r.splan;
    trial_ends_at := r.strial; plan_id := r.pid; plan_name := r.pname; price_monthly := r.vprice; max_admins := r.vadm;
    max_field := r.vfield; max_warehouses := r.vwh; max_items := r.vitems;
    admins := public.plan_member_count(r.tid, 'admins', NULL)::integer;
    field := public.plan_member_count(r.tid, 'field', NULL)::integer;
    SELECT count(*)::integer INTO warehouses FROM public.warehouses w WHERE w.tenant_id = r.tid AND w.status = 'ACTIVE' AND NOT w.is_sample;
    SELECT count(*)::integer INTO items FROM public.items i WHERE i.tenant_id = r.tid AND i.status = 'ACTIVE' AND NOT i.is_sample;
    SELECT max(se.created_at) INTO last_login FROM public.sessions se
     WHERE se.user_id IN (SELECT m.user_id FROM public.tenant_memberships m WHERE m.tenant_id = r.tid AND m.status = 'ACTIVE');
    RETURN NEXT;
  END LOOP;
  PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
END
$fn$;
REVOKE ALL ON FUNCTION wms_probe.platform_list_customers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wms_probe.platform_list_customers() TO wms_app;
RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;

DROP TABLE wms_platform.charges;
REVOKE USAGE ON SEQUENCE wms_platform.subscription_no_seq FROM wms_identity_probe;
ALTER TABLE wms_platform.subscriptions DROP CONSTRAINT subscriptions_number_key;
ALTER TABLE wms_platform.subscriptions DROP COLUMN number;
