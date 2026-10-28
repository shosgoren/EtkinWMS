-- T-1071: retain retired provider identities on the existing tenant-isolated mapping.
ALTER TABLE public.external_refs ADD COLUMN retired_external_ids text[] NOT NULL DEFAULT '{}'::text[];
CREATE FUNCTION public.external_refs_identity_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE eligible boolean;
BEGIN
 IF TG_OP='UPDATE' AND NEW.external_id IS NOT DISTINCT FROM OLD.external_id THEN
   NEW.retired_external_ids:=OLD.retired_external_ids;
   RETURN NEW;
 END IF;
 -- A single namespace lock covers current AND retired aliases; uniqueness cannot race an INSERT.
 -- Wrong-tenant INSERT still reaches the existing RLS WITH CHECK, without reading that tenant.
 IF current_user = 'wms_app' AND NEW.tenant_id IS DISTINCT FROM NULLIF(current_setting('app.current_tenant_id',true),'')::uuid THEN
   RETURN NEW;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('external-ref:'||NEW.tenant_id::text||':'||NEW.system||':'||NEW.entity_type,0));
 IF TG_OP='UPDATE' AND NEW.external_id IS DISTINCT FROM OLD.external_id THEN
   IF NEW.tenant_id<>OLD.tenant_id OR NEW.id<>OLD.id OR NEW.system<>OLD.system OR NEW.entity_type<>OLD.entity_type OR NEW.entity_id<>OLD.entity_id
      OR OLD.system<>'PARASUT' OR OLD.entity_type<>'ITEM' OR OLD.external_id !~ '^[0-9]{1,18}$' OR NEW.external_id !~ '^[0-9]{1,18}$' THEN
     RAISE EXCEPTION 'external identity replacement denied' USING ERRCODE='23514';
   END IF;
   SELECT EXISTS(SELECT 1 FROM public.items i WHERE i.tenant_id=OLD.tenant_id AND i.id=OLD.entity_id
     AND i.source_state='DELETED' AND (i.source_managed_archive OR (i.status='ACTIVE' AND i.source_disposition='PENDING'))) INTO eligible;
   IF NOT eligible THEN RAISE EXCEPTION 'source identity is not eligible' USING ERRCODE='23514'; END IF;
   NEW.retired_external_ids := array_append(OLD.retired_external_ids,OLD.external_id);
 ELSIF TG_OP='UPDATE' THEN
   NEW.retired_external_ids := OLD.retired_external_ids;
 ELSE
   NEW.retired_external_ids := '{}'::text[];
 END IF;
 IF NEW.external_id=ANY(NEW.retired_external_ids) OR EXISTS(SELECT 1 FROM public.external_refs r
   WHERE r.tenant_id=NEW.tenant_id AND r.system=NEW.system AND r.entity_type=NEW.entity_type
   AND r.id<>NEW.id AND NEW.external_id=ANY(r.retired_external_ids)) THEN
   RAISE EXCEPTION 'source identity has been retired' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.external_refs_identity_guard() FROM PUBLIC;
CREATE TRIGGER external_refs_identity_guard BEFORE INSERT OR UPDATE ON public.external_refs
 FOR EACH ROW EXECUTE FUNCTION public.external_refs_identity_guard();
-- Runtime still cannot UPDATE external_id directly. A narrow definer command locks the item first.
GRANT SELECT(tenant_id,id,system,entity_type,entity_id,external_id,version,retired_external_ids) ON public.external_refs TO wms_identity_probe;
GRANT UPDATE(external_id) ON public.external_refs TO wms_identity_probe;
GRANT SELECT(tenant_id,id,status,source_state,source_managed_archive,source_disposition) ON public.items TO wms_identity_probe;
GRANT UPDATE(id) ON public.items TO wms_identity_probe;
GRANT CREATE ON SCHEMA wms_probe TO wms_identity_probe;
SET ROLE wms_identity_probe;
CREATE FUNCTION wms_probe.replace_deleted_product_identity(p_ref uuid,p_version integer,p_external_id text) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE t uuid; item uuid; affected integer;
BEGIN
 t:=NULLIF(current_setting('app.current_tenant_id',true),'')::uuid;
 IF t IS NULL THEN RAISE EXCEPTION 'tenant context required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('external-ref:'||t::text||':PARASUT:ITEM',0));
 SELECT entity_id INTO item FROM public.external_refs WHERE tenant_id=t AND id=p_ref AND system='PARASUT' AND entity_type='ITEM';
 IF item IS NULL THEN RETURN false; END IF;
 PERFORM 1 FROM public.items WHERE tenant_id=t AND id=item FOR UPDATE;
 UPDATE public.external_refs SET external_id=p_external_id WHERE tenant_id=t AND id=p_ref AND version=p_version;
 GET DIAGNOSTICS affected=ROW_COUNT;
 RETURN affected=1;
END $fn$;
REVOKE ALL ON FUNCTION wms_probe.replace_deleted_product_identity(uuid,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wms_probe.replace_deleted_product_identity(uuid,integer,text) TO wms_app;

RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;
