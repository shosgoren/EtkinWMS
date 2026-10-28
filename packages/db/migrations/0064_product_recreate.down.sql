-- Never discard old provider identity history during rollback.
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM public.external_refs WHERE cardinality(retired_external_ids)>0) THEN
   RAISE EXCEPTION '0064_product_recreate down: identity history exists';
 END IF;
END $guard$;
DROP FUNCTION public.replace_deleted_product_identity(uuid,integer,text);
DROP TRIGGER external_refs_identity_guard ON public.external_refs;
DROP FUNCTION public.external_refs_identity_guard();
ALTER TABLE public.external_refs DROP COLUMN retired_external_ids;
