-- Tercih kaybı sessizce yapılmaz. Barkod kayıtları geri almada silinmez.
DO $guard$
DECLARE used boolean;
BEGIN
  ALTER TABLE public.integrations NO FORCE ROW LEVEL SECURITY;
  SELECT EXISTS (SELECT 1 FROM public.integrations WHERE pull_product_barcodes) INTO used;
  ALTER TABLE public.integrations FORCE ROW LEVEL SECURITY;
  IF used AND COALESCE(current_setting('wms_meta.allow_destructive_down', true), 'off') <> 'on' THEN
    RAISE EXCEPTION '0059 down: product barcode preference is in use';
  END IF;
END
$guard$;
REVOKE UPDATE (pull_product_barcodes) ON public.integrations FROM wms_app;
ALTER TABLE public.integrations DROP COLUMN pull_product_barcodes;
