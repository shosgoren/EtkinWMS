-- 0042_customers geri alma (G-08, ADR-015 §9): up'ın yarattığını ters sırayla kaldırır.
-- 'ACTIVE' abonelik varsa (operatörün açtığı) yalnızca wms_meta.allow_destructive_down = 'on' (WMS_ENV local|ci) iken çalışır ve o satırlar silinir.
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM wms_platform.subscriptions WHERE plan = 'ACTIVE')
     AND coalesce(pg_catalog.current_setting('wms_meta.allow_destructive_down', true), '') <> 'on' THEN
    RAISE EXCEPTION '0042_customers down: operatörün açtığı abonelik var; veri kaybettiren geri alma bu ortamda kapalı';
  END IF;
END
$guard$;

GRANT CREATE ON SCHEMA wms_probe TO wms_identity_probe;
SET ROLE wms_identity_probe;
DROP FUNCTION wms_probe.platform_change_customer_plan(uuid, uuid);
DROP FUNCTION wms_probe.platform_extend_trial(uuid);
DROP FUNCTION wms_probe.platform_set_customer_status(uuid, boolean, text);
DROP FUNCTION wms_probe.platform_customer_activity(uuid);
DROP FUNCTION wms_probe.platform_list_customers();
RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;

DROP INDEX public.security_events_platform_tenant_idx;
REVOKE EXECUTE ON FUNCTION public.plan_member_count(uuid, text, uuid) FROM wms_identity_probe;
REVOKE EXECUTE ON FUNCTION public.plan_member_class(uuid, uuid, text) FROM wms_identity_probe;
REVOKE UPDATE (status) ON public.tenants FROM wms_identity_probe;
REVOKE SELECT (occurred_at, user_id, event_type, detail) ON public.security_events FROM wms_identity_probe;
REVOKE SELECT (user_id, created_at) ON public.sessions FROM wms_identity_probe;
REVOKE SELECT (tenant_id, occurred_at) ON public.stock_ledger FROM wms_identity_probe;
REVOKE SELECT (tenant_id, status, is_sample) ON public.items FROM wms_identity_probe;
REVOKE SELECT (tenant_id, status, is_sample) ON public.warehouses FROM wms_identity_probe;

REVOKE UPDATE (trial_ends_at) ON wms_platform.subscriptions FROM wms_identity_probe;
DELETE FROM wms_platform.subscriptions WHERE plan = 'ACTIVE';
ALTER TABLE wms_platform.subscriptions DROP CONSTRAINT subscriptions_active_plan_chk;
ALTER TABLE wms_platform.subscriptions DROP CONSTRAINT subscriptions_plan_chk;
ALTER TABLE wms_platform.subscriptions ADD CONSTRAINT subscriptions_plan_chk CHECK (plan IN ('TRIAL'));
