-- T-1061: ürün barkodu alma tercihi. Mevcut bağlantı davranışı korunur (varsayılan kapalı).
ALTER TABLE public.integrations ADD COLUMN pull_product_barcodes boolean NOT NULL DEFAULT false;
GRANT UPDATE (pull_product_barcodes) ON public.integrations TO wms_app;
