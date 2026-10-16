-- 0041_plans geri alma (G-08, ADR-015 §9): up'ın yarattığını ters sırayla kaldırır.
-- VERİ KAYBETTİRİR: paket ya da paketi atanmış abonelik varsa yalnızca wms_meta.allow_destructive_down = 'on' (WMS_ENV local|ci) iken çalışır.
DO $guard$
BEGIN
  IF (EXISTS (SELECT 1 FROM wms_platform.plans) OR EXISTS (SELECT 1 FROM wms_platform.subscriptions WHERE plan_id IS NOT NULL))
     AND coalesce(pg_catalog.current_setting('wms_meta.allow_destructive_down', true), '') <> 'on' THEN
    RAISE EXCEPTION '0041_plans down: paket kaydı var; veri kaybettiren geri alma bu ortamda kapalı';
  END IF;
END
$guard$;

DROP TRIGGER membership_roles_plan_limit ON public.membership_roles;
DROP TRIGGER tenant_memberships_plan_limit ON public.tenant_memberships;
DROP TRIGGER items_plan_limit ON public.items;
DROP TRIGGER warehouses_plan_limit ON public.warehouses;
DROP FUNCTION public.plan_limit_guard();
DROP FUNCTION public.plan_member_count(uuid, text, uuid);
DROP FUNCTION public.plan_member_class(uuid, uuid, text);
DROP FUNCTION public.plan_limit_exempt();

GRANT CREATE ON SCHEMA wms_probe TO wms_identity_probe;
SET ROLE wms_identity_probe;
DROP FUNCTION wms_probe.platform_assign_default_plan();
DROP FUNCTION wms_probe.platform_tenant_plan_limit(uuid, text);
DROP FUNCTION wms_probe.platform_published_plans();
DROP FUNCTION wms_probe.platform_save_plan(uuid, text, numeric, integer, integer, integer, integer, boolean, boolean, boolean, boolean, boolean, boolean);
DROP FUNCTION wms_probe.platform_list_plans();
RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;

REVOKE UPDATE (plan_id, plan_version) ON wms_platform.subscriptions FROM wms_identity_probe;
ALTER TABLE wms_platform.subscriptions
  DROP CONSTRAINT subscriptions_plan_pair_chk,
  DROP CONSTRAINT subscriptions_plan_version_fkey,
  DROP COLUMN plan_version,
  DROP COLUMN plan_id;
DROP TABLE wms_platform.plan_versions;
DROP TABLE wms_platform.plans;
