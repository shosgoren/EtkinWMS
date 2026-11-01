-- 0074_item_images geri alma (T-1200, G-08): görsel satırı varsa veri kaybettirmez (bayrak: wms_meta.allow_destructive_down). Bekçi sayımı
-- RLS'ten bağımsız olmalı: sayımdan önce NO FORCE, sonra yeniden FORCE. Dönüşüm silme bekçisi 0040 sürümüne döner (örnek olmayan dönüşüm
-- yine her zaman sessizce atlanır).
DO $guard$
DECLARE
  used boolean;
BEGIN
  ALTER TABLE public.item_images NO FORCE ROW LEVEL SECURITY;
  SELECT EXISTS (SELECT 1 FROM public.item_images) INTO used;
  ALTER TABLE public.item_images FORCE ROW LEVEL SECURITY;
  IF used AND COALESCE(pg_catalog.current_setting('wms_meta.allow_destructive_down', true), 'off') <> 'on' THEN
    RAISE EXCEPTION '0074_item_images down: ürün görseli var; veri kaybettiren geri alma bu ortamda kapalı';
  END IF;
END
$guard$;

DROP TABLE public.item_images;
DROP FUNCTION public.item_images_guard();

CREATE OR REPLACE FUNCTION public.unit_conversions_sample_delete_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN
  IF current_user <> 'wms_app'
     OR EXISTS (SELECT 1 FROM public.items i WHERE i.tenant_id = OLD.tenant_id AND i.id = OLD.item_id AND i.is_sample) THEN
    RETURN OLD;
  END IF;
  RETURN NULL;
END; $fn$;
REVOKE ALL ON FUNCTION public.unit_conversions_sample_delete_guard() FROM PUBLIC;
