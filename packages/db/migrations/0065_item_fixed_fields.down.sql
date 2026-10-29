-- 0065_item_fixed_fields geri alma (T-1129): veri silmez. Değiştirilmiş ürünler yeni değerlerinde kalır (geçerli FK/CHECK değerleri);
-- yalnız yetki, bekçi ve kullanım fonksiyonu kalkar, 0013 fonksiyon gövdeleri birebir geri gelir.
REVOKE UPDATE (base_unit_id, tracking_mode, quantity_scale) ON public.items FROM wms_app;
DROP TRIGGER items_guard_unused_fixed ON public.items;
DROP FUNCTION public.items_guard_fixed_fields();
DROP FUNCTION public.item_fixed_usage(uuid, uuid);

CREATE OR REPLACE FUNCTION public.stock_guard_item_tracking() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'STOCK_TENANT_CONTEXT_MISMATCH: tracking_mode değişimi için tenant bağlamı satırın tenant''ı olmalı' USING ERRCODE = '23514';
  END IF;
  -- Eşzamanlı boyut INSERT'iyle yarış: KEY SHARE (FK) ile NO KEY UPDATE çakışmaz; SHARE kipi ROW EXCLUSIVE (INSERT) ile çakışır →
  -- eşzamanlı boyut ekleme commit'e kadar bekler ve sonra yeni değeri görür; ya da biz onun commit'ini bekleyip boyutu görürüz.
  LOCK TABLE public.stock_dimensions IN SHARE MODE;
  IF EXISTS (SELECT 1 FROM public.stock_dimensions d WHERE d.tenant_id = OLD.tenant_id AND d.item_id = OLD.id) THEN
    RAISE EXCEPTION 'TRACKING_VIOLATION: ürünün stok boyutu var; tracking_mode değiştirilemez (A-87)' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.stock_guard_item_tracking() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.stock_dimensions_check_tracking() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  mode text;
  s_lot uuid;
  s_found boolean;
BEGIN
  SELECT i.tracking_mode INTO mode FROM public.items i WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.item_id;
  IF NOT FOUND THEN
    RETURN NEW; -- ürün yok / görünmüyor: bileşik FK 23503 verir
  END IF;
  IF (mode IN ('LOT', 'LOT_AND_SERIAL')) <> (NEW.lot_id IS NOT NULL)
     OR (mode IN ('SERIAL', 'LOT_AND_SERIAL')) <> (NEW.serial_id IS NOT NULL) THEN
    RAISE EXCEPTION 'TRACKING_VIOLATION: ürün takip modu % ile boyutun lot/seri alanları uyuşmuyor', mode USING ERRCODE = '23514';
  END IF;
  IF NEW.serial_id IS NOT NULL THEN
    SELECT sr.lot_id, true INTO s_lot, s_found FROM public.serials sr
     WHERE sr.tenant_id = NEW.tenant_id AND sr.item_id = NEW.item_id AND sr.id = NEW.serial_id;
    IF s_found AND s_lot IS DISTINCT FROM NEW.lot_id THEN
      RAISE EXCEPTION 'TRACKING_VIOLATION: serinin lotu boyutun lotuyla eşleşmiyor' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.stock_dimensions_check_tracking() FROM PUBLIC;

DO $verify$
BEGIN
  IF pg_catalog.has_column_privilege('wms_app', 'public.items', 'base_unit_id', 'UPDATE')
     OR pg_catalog.has_column_privilege('wms_app', 'public.items', 'tracking_mode', 'UPDATE')
     OR pg_catalog.has_column_privilege('wms_app', 'public.items', 'quantity_scale', 'UPDATE') THEN
    RAISE EXCEPTION '0065_item_fixed_fields down: wms_app sabit alan UPDATE yetkisi kalktı sanılırken duruyor';
  END IF;
END
$verify$;
