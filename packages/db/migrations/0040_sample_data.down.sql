-- 0040_sample_data geri alma (G-08, ADR-015 §9): up'ın yarattığını ters sırayla kaldırır.
-- VERİ KAYBETTİRİR: örnek işaretli satır varsa (işaret sütunla birlikte gider; satırlar gerçek veri gibi kalır) yalnızca
-- wms_meta.allow_destructive_down = 'on' (WMS_ENV local|ci) iken çalışır (0038/0039 ile aynı kural).
DO $guard$
BEGIN
  IF (EXISTS (SELECT 1 FROM public.warehouses WHERE is_sample)
      OR EXISTS (SELECT 1 FROM public.locations WHERE is_sample)
      OR EXISTS (SELECT 1 FROM public.items WHERE is_sample))
     AND coalesce(pg_catalog.current_setting('wms_meta.allow_destructive_down', true), '') <> 'on' THEN
    RAISE EXCEPTION '0040_sample_data down: örnek işaretli kayıt var; veri kaybettiren geri alma bu ortamda kapalı';
  END IF;
END
$guard$;

REVOKE DELETE ON public.warehouses, public.locations, public.items, public.unit_conversions, public.location_count_locks FROM wms_app;

DROP TRIGGER location_count_locks_sample_delete_guard ON public.location_count_locks;
DROP TRIGGER unit_conversions_sample_delete_guard ON public.unit_conversions;
DROP TRIGGER items_sample_delete_guard ON public.items;
DROP TRIGGER locations_sample_delete_guard ON public.locations;
DROP TRIGGER warehouses_sample_delete_guard ON public.warehouses;
DROP FUNCTION public.location_count_locks_sample_delete_guard();
DROP FUNCTION public.unit_conversions_sample_delete_guard();
DROP FUNCTION public.locations_sample_delete_guard();
DROP FUNCTION public.sample_row_delete_guard();

DROP INDEX public.items_tenant_sample_idx;
DROP INDEX public.locations_tenant_sample_idx;
DROP INDEX public.warehouses_tenant_sample_idx;

ALTER TABLE public.items DROP COLUMN is_sample;
ALTER TABLE public.locations DROP COLUMN is_sample;
ALTER TABLE public.warehouses DROP COLUMN is_sample;
