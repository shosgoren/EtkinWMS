-- T-1062: yalnız miktarsal ürün yönetimi için kaynak kart bilgisi. Fiyat/stok alanı kabul edilmez.
ALTER TABLE public.items ADD COLUMN source_product_info jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.items ADD CONSTRAINT items_source_product_info_chk CHECK (
  jsonb_typeof(source_product_info) = 'object'
  AND (source_product_info - ARRAY['PARASUT','LOGO']) = '{}'::jsonb
  AND (NOT source_product_info ? 'PARASUT' OR (
    jsonb_typeof(source_product_info->'PARASUT') = 'object'
    AND ((source_product_info->'PARASUT') - ARRAY['unit','gtip','categoryId','categoryName','archived','inventoryTracking']) = '{}'::jsonb
  ))
  AND (NOT source_product_info ? 'LOGO' OR (
    jsonb_typeof(source_product_info->'LOGO') = 'object'
    AND ((source_product_info->'LOGO') - ARRAY['unit','gtip','categoryId','categoryName','archived','inventoryTracking']) = '{}'::jsonb
  ))
);
GRANT UPDATE (source_product_info) ON public.items TO wms_app;
