DO $guard$
DECLARE used boolean;
BEGIN
  ALTER TABLE public.items NO FORCE ROW LEVEL SECURITY;
  SELECT EXISTS (SELECT 1 FROM public.items WHERE source_product_info <> '{}'::jsonb) INTO used;
  ALTER TABLE public.items FORCE ROW LEVEL SECURITY;
  IF used AND COALESCE(current_setting('wms_meta.allow_destructive_down', true), 'off') <> 'on' THEN
    RAISE EXCEPTION '0060 down: product source information is in use';
  END IF;
END
$guard$;
REVOKE UPDATE (source_product_info) ON public.items FROM wms_app;
ALTER TABLE public.items DROP COLUMN source_product_info;
