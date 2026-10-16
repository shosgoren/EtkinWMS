-- 0040_sample_data (T-996, ADR-026 §4): deneme alanında "Örnek depo" verisi ve "Örnek verileri temizle". G-08: yalnızca GENİŞLETME
-- (üç tabloya `is_sample` sütunu, beş tabloya dar DELETE yolu ve onu sınırlayan dört tetikleyici işlevi).
--
-- BİLİNÇLİ KARARLAR (inceleme için):
-- * ÖRNEK İŞARETİ YALNIZ OLUŞTURMADA: `warehouses/locations/items.is_sample` (varsayılan false). wms_app yalnız INSERT'te yazabilir;
--   UPDATE yetkisi YOK. Gerçek bir kayıt sonradan örnek yapılamaz, dolayısıyla aşağıdaki silme yolu gerçek kayda hiçbir koşulda açılmaz.
-- * SİLME YASAĞININ TEK İSTİSNASI (T-202/T-204 kuralı korunur): wms_app'e bu beş tabloda DELETE verilir; her tabloda BEFORE DELETE ROW
--   tetikleyicisi (ENABLE ALWAYS, SECURITY INVOKER, sabit search_path) wms_app için yalnız örnek satırın silinmesine izin verir, örnek
--   olmayan satırı SESSİZCE ATLAR (RETURN NULL; satır yerinde kalır, etkilenen satır sayısı düşer). Atlama, RLS'in yabancı satırı
--   gizlemesiyle aynı davranıştır: domain beklenen sayıyı denetler, sapmada geri alır. Hata yerine atlama, AC-04'ün genel "kendi
--   satırını silebilir" denetiminin örnek satırlarla sınanabilmesi içindir.
--     - warehouses / items: `OLD.is_sample`; locations: `OLD.is_sample` + aynı tetikleyicide lokasyonun sayım kilidini siler.
--     - unit_conversions: ürünü örnek olan dönüşüm.
--     - location_count_locks: lokasyonu örnek olan ve sayımda olmayan (`IDLE`) kilit.
--   Tetikleyici yalnız `current_user = 'wms_app'` iken sınar; başka rollerin bu tablolarda DELETE yetkisi yoktur (sahip/migration rolü
--   fikstür ve geri alma temizliği içindir). TRUNCATE verilmez.
-- * KULLANILMIŞ ÖRNEK SİLİNEMEZ: tüm bağlı tablolar (stok boyutu → defter, belge satırı, görev, sayım, rezervasyon …) bu tablolara
--   ON DELETE NO ACTION ile bağlıdır. İşlenmiş hareketi olan örnek satır 23503 ile reddedilir (I-08: defter silinmez); domain bu
--   durumda silmez, pasife alır (status = ARCHIVED).
-- * RLS DEĞİŞMEZ: tek izolasyon politikası (FOR ALL, USING + WITH CHECK) aynen kalır; yabancı tenant satırı silme için görünmez.
-- Koşturucu tek transaction içinde çalıştırır.

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.location_count_locks') IS NULL OR pg_catalog.to_regclass('public.unit_conversions') IS NULL THEN
    RAISE EXCEPTION '0040_sample_data: depo/katalog tabloları yok (0010/0011 önkoşulu)';
  END IF;
END
$pre$;

ALTER TABLE public.warehouses ADD COLUMN is_sample boolean NOT NULL DEFAULT false;
ALTER TABLE public.locations ADD COLUMN is_sample boolean NOT NULL DEFAULT false;
ALTER TABLE public.items ADD COLUMN is_sample boolean NOT NULL DEFAULT false;

GRANT INSERT (is_sample) ON public.warehouses TO wms_app;
GRANT INSERT (is_sample) ON public.locations TO wms_app;
GRANT INSERT (is_sample) ON public.items TO wms_app;

-- Temizlik sorguları için (tenant + örnek işareti; kısmi, küçük).
CREATE INDEX warehouses_tenant_sample_idx ON public.warehouses (tenant_id) WHERE is_sample;
CREATE INDEX locations_tenant_sample_idx ON public.locations (tenant_id, warehouse_id) WHERE is_sample;
CREATE INDEX items_tenant_sample_idx ON public.items (tenant_id) WHERE is_sample;

CREATE FUNCTION public.sample_row_delete_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN
  IF current_user <> 'wms_app' OR OLD.is_sample THEN
    RETURN OLD;
  END IF;
  RETURN NULL;
END; $fn$;
REVOKE ALL ON FUNCTION public.sample_row_delete_guard() FROM PUBLIC;

-- Lokasyon: örnek lokasyon silinirken sayım kilidi de (aynı rol, aynı tenant bağlamı) silinir; kilit sayımdaysa kilit tetikleyicisi atlar,
-- kilit kalır ve lokasyon silinmesi FK ile reddedilir (kullanılmış örnek → pasife alma). Uygulama kodu kilit tablosuna yazmaz (T-210 lint).
CREATE FUNCTION public.locations_sample_delete_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN
  IF current_user <> 'wms_app' THEN
    RETURN OLD;
  END IF;
  IF NOT OLD.is_sample THEN
    RETURN NULL;
  END IF;
  DELETE FROM public.location_count_locks WHERE tenant_id = OLD.tenant_id AND location_id = OLD.id;
  RETURN OLD;
END; $fn$;
REVOKE ALL ON FUNCTION public.locations_sample_delete_guard() FROM PUBLIC;

CREATE FUNCTION public.unit_conversions_sample_delete_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN
  IF current_user <> 'wms_app'
     OR EXISTS (SELECT 1 FROM public.items i WHERE i.tenant_id = OLD.tenant_id AND i.id = OLD.item_id AND i.is_sample) THEN
    RETURN OLD;
  END IF;
  RETURN NULL;
END; $fn$;
REVOKE ALL ON FUNCTION public.unit_conversions_sample_delete_guard() FROM PUBLIC;

CREATE FUNCTION public.location_count_locks_sample_delete_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN
  IF current_user <> 'wms_app'
     OR (OLD.status = 'IDLE'
         AND EXISTS (SELECT 1 FROM public.locations l WHERE l.tenant_id = OLD.tenant_id AND l.id = OLD.location_id AND l.is_sample)) THEN
    RETURN OLD;
  END IF;
  RETURN NULL;
END; $fn$;
REVOKE ALL ON FUNCTION public.location_count_locks_sample_delete_guard() FROM PUBLIC;

CREATE TRIGGER warehouses_sample_delete_guard BEFORE DELETE ON public.warehouses
 FOR EACH ROW EXECUTE FUNCTION public.sample_row_delete_guard();
ALTER TABLE public.warehouses ENABLE ALWAYS TRIGGER warehouses_sample_delete_guard;
CREATE TRIGGER locations_sample_delete_guard BEFORE DELETE ON public.locations
 FOR EACH ROW EXECUTE FUNCTION public.locations_sample_delete_guard();
ALTER TABLE public.locations ENABLE ALWAYS TRIGGER locations_sample_delete_guard;
CREATE TRIGGER items_sample_delete_guard BEFORE DELETE ON public.items
 FOR EACH ROW EXECUTE FUNCTION public.sample_row_delete_guard();
ALTER TABLE public.items ENABLE ALWAYS TRIGGER items_sample_delete_guard;
CREATE TRIGGER unit_conversions_sample_delete_guard BEFORE DELETE ON public.unit_conversions
 FOR EACH ROW EXECUTE FUNCTION public.unit_conversions_sample_delete_guard();
ALTER TABLE public.unit_conversions ENABLE ALWAYS TRIGGER unit_conversions_sample_delete_guard;
CREATE TRIGGER location_count_locks_sample_delete_guard BEFORE DELETE ON public.location_count_locks
 FOR EACH ROW EXECUTE FUNCTION public.location_count_locks_sample_delete_guard();
ALTER TABLE public.location_count_locks ENABLE ALWAYS TRIGGER location_count_locks_sample_delete_guard;

GRANT DELETE ON public.warehouses, public.locations, public.items, public.unit_conversions, public.location_count_locks TO wms_app;
