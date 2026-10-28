-- Never discard old provider identity history during rollback.
ALTER TABLE public.external_refs NO FORCE ROW LEVEL SECURITY;
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM public.external_refs WHERE cardinality(retired_external_ids)>0) THEN
   RAISE EXCEPTION '0064_product_recreate down: identity history exists';
 END IF;
END $guard$;
ALTER TABLE public.external_refs FORCE ROW LEVEL SECURITY;
SET ROLE wms_identity_probe;
DROP FUNCTION wms_probe.replace_deleted_product_identity(uuid,integer,text);
RESET ROLE;
DROP TRIGGER external_refs_identity_guard ON public.external_refs;
DROP FUNCTION public.external_refs_identity_guard();


REVOKE SELECT(tenant_id,id,system,entity_type,entity_id,external_id,version,retired_external_ids) ON public.external_refs FROM wms_identity_probe;
REVOKE UPDATE(external_id) ON public.external_refs FROM wms_identity_probe;
-- tenant_id/status SELECT already exists since0042 and must survive down.
REVOKE SELECT(id,source_state,source_managed_archive,source_disposition) ON public.items FROM wms_identity_probe;
REVOKE UPDATE(id) ON public.items FROM wms_identity_probe;

ALTER TABLE public.external_refs DROP COLUMN retired_external_ids;
