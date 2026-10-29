-- 0065_item_fixed_fields (T-1129, B-188; A-87/A-107 güncellemesi, kullanıcı kararı 27 Ekim):
-- Hiç kullanılmamış üründe temel birim, miktar hassasiyeti ve takip modu değiştirilebilir; ilk kullanımla kilitlenir.
--
-- * "Kullanılmış" tek tanımdır: `public.item_fixed_usage` (domain okuması ve tetikleyici aynı fonksiyonu çağırır). Ürüne bağlı
--   satırı olan her tablo sayılır (stok boyutu ⇒ defter/bakiye/rezervasyon/sayım satırı, lot, seri, birim dönüşümü, birimli ya da
--   miktarlı barkod, belge/kabul/sipariş/iade satırı, görev, sayım, reçete, stok politikası/uyarısı, entegrasyon stok işareti).
--   Bağlı sistemden (Paraşüt) gelen üründe temel birim ayrıca kilitlidir (eşitleme birimi karşılaştırır).
-- * wms_app'e yalnız bu üç sütunda UPDATE verilir; tetikleyici (ENABLE ALWAYS; sahip ve replica modu dahil) kullanılmış üründe her
--   değişikliği reddeder. Okumalar RLS altında: tenant bağlamı satırın tenant'ı değilse fail-closed ret.
-- * Yarış: tetikleyici ürün satırını FOR UPDATE kilitler → ürüne FK ile satır ekleyen (KEY SHARE) açık işlemler bitene kadar bekler,
--   sonra yeni anlık görüntüyle sayar. Ters yön: stok boyutu eklenirken takip modu ürün satırı FOR KEY SHARE ile okunur → açık
--   değişiklik commit olana kadar bekler ve yeni değeri görür. 0013'teki tablo geneli `LOCK TABLE stock_dimensions IN SHARE MODE`
--   bu satır kilidiyle değişir (wms_app tablo kilidi alamaz; diğer tenant'ların boyut eklemesi artık beklemez).

-- 1. Kullanım tanımı (tek kaynak).
CREATE FUNCTION public.item_fixed_usage(p_tenant uuid, p_item uuid) RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid IS DISTINCT FROM p_tenant THEN
    RAISE EXCEPTION 'STOCK_TENANT_CONTEXT_MISMATCH: ürün kullanım denetimi için tenant bağlamı ürünün tenant''ı olmalı' USING ERRCODE = '23514';
  END IF;
  -- Stok boyutu: defter, bakiye, rezervasyon ve boyutlu sayım satırı bileşik FK ile boyuta bağlıdır (boyut yoksa onlar da yoktur).
  IF EXISTS (SELECT 1 FROM public.stock_dimensions x WHERE x.tenant_id = p_tenant AND x.item_id = p_item) THEN RETURN 'STOCK'; END IF;
  IF EXISTS (SELECT 1 FROM public.document_lines x WHERE x.tenant_id = p_tenant AND x.item_id = p_item)
     OR EXISTS (SELECT 1 FROM public.inbound_receipt_lines x WHERE x.tenant_id = p_tenant AND x.item_id = p_item)
     OR EXISTS (SELECT 1 FROM public.customer_return_lines x WHERE x.tenant_id = p_tenant AND x.item_id = p_item) THEN
    RETURN 'DOCUMENT';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sales_order_lines x WHERE x.tenant_id = p_tenant AND x.item_id = p_item) THEN RETURN 'ORDER'; END IF;
  IF EXISTS (SELECT 1 FROM public.lots x WHERE x.tenant_id = p_tenant AND x.item_id = p_item)
     OR EXISTS (SELECT 1 FROM public.serials x WHERE x.tenant_id = p_tenant AND x.item_id = p_item) THEN
    RETURN 'TRACKING';
  END IF;
  -- Birim dönüşümü temel birime göredir; birimli ya da miktarlı barkod birim/ölçek anlamı taşır (birimsiz, miktarsız barkod taşımaz).
  IF EXISTS (SELECT 1 FROM public.unit_conversions x WHERE x.tenant_id = p_tenant AND x.item_id = p_item)
     OR EXISTS (SELECT 1 FROM public.item_barcodes x WHERE x.tenant_id = p_tenant AND x.item_id = p_item AND (x.unit_id IS NOT NULL OR x.quantity IS NOT NULL)) THEN
    RETURN 'UNIT';
  END IF;
  IF EXISTS (SELECT 1 FROM public.warehouse_tasks x WHERE x.tenant_id = p_tenant AND x.item_id = p_item)
     OR EXISTS (SELECT 1 FROM public.warehouse_task_progress x WHERE x.tenant_id = p_tenant AND x.item_id = p_item)
     OR EXISTS (SELECT 1 FROM public.count_session_lines x WHERE x.tenant_id = p_tenant AND x.item_id = p_item) THEN
    RETURN 'TASK';
  END IF;
  IF EXISTS (SELECT 1 FROM public.production_recipes x WHERE x.tenant_id = p_tenant AND x.output_item_id = p_item)
     OR EXISTS (SELECT 1 FROM public.production_recipe_lines x WHERE x.tenant_id = p_tenant AND x.item_id = p_item) THEN
    RETURN 'RECIPE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.item_stock_policies x WHERE x.tenant_id = p_tenant AND x.item_id = p_item)
     OR EXISTS (SELECT 1 FROM public.stock_alerts x WHERE x.tenant_id = p_tenant AND x.item_id = p_item)
     OR EXISTS (SELECT 1 FROM public.integration_stock_marks x WHERE x.tenant_id = p_tenant AND x.item_id = p_item) THEN
    RETURN 'POLICY';
  END IF;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION public.item_fixed_usage(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.item_fixed_usage(uuid, uuid) TO wms_app;

-- 2. Değişiklik bekçisi: kullanılmış üründe üç alanın hiçbiri değişmez; bağlı sistemden gelen üründe temel birim değişmez; yeni temel
--    birim aynı tenant'ın etkin birimi olmalıdır (bileşik FK tenant'ı, bu denetim durumu bağlar).
CREATE FUNCTION public.items_guard_fixed_fields() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  usage text;
BEGIN
  IF NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'STOCK_TENANT_CONTEXT_MISMATCH: ürünün sabit alan değişimi için tenant bağlamı satırın tenant''ı olmalı' USING ERRCODE = '23514';
  END IF;
  -- FOR UPDATE, ürüne FK ile satır ekleyip henüz commit etmemiş işlemlerin KEY SHARE kilidiyle çakışır: onlar bitince sayılır.
  PERFORM 1 FROM public.items i WHERE i.tenant_id = OLD.tenant_id AND i.id = OLD.id FOR UPDATE;
  usage := public.item_fixed_usage(OLD.tenant_id, OLD.id);
  IF usage IS NOT NULL THEN
    RAISE EXCEPTION 'ITEM_FIXED_IN_USE: ürün kullanıldı (%); temel birim, miktar hassasiyeti ve takip modu değiştirilemez', usage USING ERRCODE = '23514';
  END IF;
  IF NEW.base_unit_id IS DISTINCT FROM OLD.base_unit_id THEN
    IF EXISTS (SELECT 1 FROM public.external_refs r WHERE r.tenant_id = OLD.tenant_id AND r.entity_type = 'ITEM' AND r.entity_id = OLD.id) THEN
      RAISE EXCEPTION 'ITEM_FIXED_SOURCE_LINKED: bağlı sistemden gelen ürünün temel birimi değiştirilemez' USING ERRCODE = '23514';
    END IF;
    -- FOR SHARE: eşzamanlı birim arşivlemesiyle (NO KEY UPDATE) sıralanır; arşivli birime bağlanılmaz.
    IF NOT EXISTS (SELECT 1 FROM public.units u WHERE u.tenant_id = NEW.tenant_id AND u.id = NEW.base_unit_id AND u.status = 'ACTIVE' FOR SHARE) THEN
      RAISE EXCEPTION 'ITEM_FIXED_UNIT_INVALID: yeni temel birim bu tenant''ın etkin birimi olmalı' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.items_guard_fixed_fields() FROM PUBLIC;
-- Ad sırası: 0013 `items_guard_tracking_mode`'dan SONRA çalışır (boyutlu üründe takip modu reddi TRACKING_VIOLATION olarak kalır).
CREATE TRIGGER items_guard_unused_fixed BEFORE UPDATE OF base_unit_id, tracking_mode, quantity_scale ON public.items
  FOR EACH ROW
  WHEN (OLD.base_unit_id IS DISTINCT FROM NEW.base_unit_id OR OLD.tracking_mode IS DISTINCT FROM NEW.tracking_mode
        OR OLD.quantity_scale IS DISTINCT FROM NEW.quantity_scale)
  EXECUTE FUNCTION public.items_guard_fixed_fields();
ALTER TABLE public.items ENABLE ALWAYS TRIGGER items_guard_unused_fixed;

-- 3. 0013 takip modu bekçisi: tablo geneli SHARE kilidi yerine ürün satırı FOR UPDATE (aynı yarış garantisi, wms_app'in de alabildiği
--    kilit; yalnız o ürünün eklemeleri bekler).
CREATE OR REPLACE FUNCTION public.stock_guard_item_tracking() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'STOCK_TENANT_CONTEXT_MISMATCH: tracking_mode değişimi için tenant bağlamı satırın tenant''ı olmalı' USING ERRCODE = '23514';
  END IF;
  -- T-1129: eşzamanlı boyut INSERT'i ürün satırını KEY SHARE (FK) ile tutar; FOR UPDATE onunla çakışır → onun commit'ini bekleyip
  -- boyutu görürüz. Ters yönde boyut tetikleyicisi ürünü FOR KEY SHARE okur → bizim commit'imizi bekler ve yeni modu görür.
  PERFORM 1 FROM public.items i WHERE i.tenant_id = OLD.tenant_id AND i.id = OLD.id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.stock_dimensions d WHERE d.tenant_id = OLD.tenant_id AND d.item_id = OLD.id) THEN
    RAISE EXCEPTION 'TRACKING_VIOLATION: ürünün stok boyutu var; tracking_mode değiştirilemez (A-87)' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.stock_guard_item_tracking() FROM PUBLIC;

-- 4. Boyut eklerken takip modu ürün satırı FOR KEY SHARE ile okunur (FK'nin aldığı kilidin aynısı; yeni çakışma yok): açık takip modu
--    değişikliği commit olana kadar bekler, sonra yeni değeri denetler.
CREATE OR REPLACE FUNCTION public.stock_dimensions_check_tracking() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  mode text;
  s_lot uuid;
  s_found boolean;
BEGIN
  SELECT i.tracking_mode INTO mode FROM public.items i WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.item_id FOR KEY SHARE;
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

-- 5. Yetki: yalnız üç sütun (A-87 güncellemesi). Diğer değişmez sütunlar (tenant_id, id, created_at) dokunulmaz.
GRANT UPDATE (base_unit_id, tracking_mode, quantity_scale) ON public.items TO wms_app;
