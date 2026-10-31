-- 0066_integration_guards (T-1135; kullanıcı kararı 30 Ekim: stok miktarının sahibi Etkin'dir, Paraşüt'e yalnız irsaliye gider):
-- ERP akış kilitleri ve gönderim kuyruğu/işaret düzeltmeleri. 0055 tablolarına yalnız EK sütun/kısıt/tetikleyici; veri silinmez.
--
-- * (A) STOCK ⟂ SHIPMENTS: aynı bağlantıda ikisi birden açık olamaz (tetikleyici, 23514 `INTEGRATION_FLOW_EXCLUSIVE`; yalnız kapalı → açık
--   geçişinde denetlenir. Seri hâle getirme: önce üst `integrations` satırı FOR UPDATE (bağlantı başına tek kilit; domain de aynı satırı
--   kilitler), sonra karşı akış satırı koşulsuz FOR UPDATE ile okunur: READ COMMITTED'da en son commit edilmiş hâli görülür, REPEATABLE READ'de
--   eşzamanlı değişmişse 40001 ile düşer — iki eşzamanlı açma birlikte commit edilemez). Bugün ikisi de açık olan bağlantıda STOCK kapatılır ve audit yazılır
--   (`integration.flow_changed`, via `migration_0066`; I-12). Varsayılan değişmedi: bütün akışlar kapalı doğar; irsaliye tercih edilen akıştır.
-- * (B) Stok gönderimi kapısı: `integration_stock_push_ready(tenant, bağlantı)` TEK tanımdır (domain ve tetikleyici aynı işlevi çağırır):
--   Devir tamam = Paraşüt açılış stoku alındı (`integrations.opening_stock_taken_at`) YA DA işlenmiş açılış stoku belgesi var
--   (`documents` STOCK_IN POSTED, reason `import.opening_stock` | `integration.opening_stock`). Devir yoksa STOCK açılamaz (23514
--   `OPENING_STOCK_INCOMPLETE`). Okutmalı Devir fişi gelince bu işleve eklenir.
-- * (D) `integration_flows.first_enabled_at`: akışın İLK açılış anı; kapat/aç sıfırlamaz (0055 `enabled_at` sıfırlanıyordu → kapalıyken
--   işlenen irsaliyeler sonsuza dek kaçırılıyordu). İstemci yazamaz (yetki yok; tetikleyici doldurur). Geriye dönük: açık akışta `enabled_at`,
--   kapalı irsaliye akışında kuyruğun ilk satırı.
-- * (E) `integration_stock_marks`: kesin 4xx reddi için `failed_quantity` + `failed_at` + `last_error_code`; aynı toplam yeniden
--   denenmez (toplam değişince gider). `quantity`/`sent_at` artık NULL olabilir (yalnız başarısız olmuş çift). Stok kaynağı DEĞİLDİR.
--   `as_of_snapshot` (pg_snapshot): son BAŞARILI gönderimin toplamının okunduğu anlık görüntü. Stok modundan irsaliyeye dönüşte bir sevk
--   belgesi yalnız BÜTÜN (ürün, depo) çiftlerinin bu görüntüsünde işlenmişse (`pg_visible_in_snapshot(POSTED xid)`) Paraşüt toplamına girmiş
--   sayılır ve irsaliye olarak gönderilmez; reddedilen/sınır yüzünden gönderilmeyen çiftin belgesi gider (I-16: zaman değil görünürlük).
-- * (G) `integration_runs`: wms_app DELETE (yalnız bu tablo; RLS altında) + silme bekçisi: yalnız taze, sayaçsız, hatasız zamanlı RUNNING
--   satırı (değişiklik getirmeyen koşunun kendi satırı) ya da 7 günden eski biten satır silinir; yakın geçmiş silinemez. 40 dk'yı aşan RUNNING satırını koşu FAILED/TIMEOUT yapar.
-- * (H) `integration_outbox` kart akışlarına açılır (PRODUCTS/ITEM, CONTACTS/PARTY, WAREHOUSES/WAREHOUSE): Etkin -> ERP kart gönderiminde
--   bulunan dış kayıt başka bir Etkin kaydına bağlıysa satır bir kez FAILED `EXTERNAL_ALREADY_LINKED` yazılır ve her koşuda yeniden denenmez.

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.integration_flows') IS NULL OR pg_catalog.to_regclass('public.integration_stock_marks') IS NULL THEN
    RAISE EXCEPTION '0066_integration_guards: 0055 önkoşulu yok';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.integrations'::regclass AND attname = 'opening_stock_taken_at' AND NOT attisdropped) THEN
    RAISE EXCEPTION '0066_integration_guards: 0056 önkoşulu yok';
  END IF;
END
$pre$;

-- Veri düzeltmeleri bütün tenant'larda koşar: tablo sahibi FORCE RLS altındadır (0020/0024 deseni) → NO FORCE, işlem, sonda FORCE geri
-- (koşturucu tek transaction'dır; hata hepsini geri alır).
ALTER TABLE public.integration_flows NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.integration_outbox NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.integrations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs NO FORCE ROW LEVEL SECURITY;

-- (D) İlk açılış anı -------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.integration_flows ADD COLUMN first_enabled_at timestamptz;
UPDATE public.integration_flows f
   SET first_enabled_at = COALESCE(f.enabled_at, (SELECT min(o.created_at) FROM public.integration_outbox o
                                                    WHERE o.tenant_id = f.tenant_id AND o.integration_id = f.integration_id AND o.flow = f.flow));

CREATE OR REPLACE FUNCTION public.integration_flows_on_update() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF NEW.enabled AND NOT OLD.enabled THEN
    NEW.enabled_at := pg_catalog.now();
    NEW.first_enabled_at := COALESCE(OLD.first_enabled_at, pg_catalog.now());
  ELSIF NOT NEW.enabled THEN
    NEW.enabled_at := NULL;
    NEW.first_enabled_at := OLD.first_enabled_at;
  ELSE
    NEW.enabled_at := OLD.enabled_at;
    NEW.first_enabled_at := OLD.first_enabled_at;
  END IF;
  NEW.version := OLD.version + 1;
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION public.integration_flows_on_insert() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  NEW.enabled_at := CASE WHEN NEW.enabled THEN pg_catalog.now() ELSE NULL END;
  NEW.first_enabled_at := CASE WHEN NEW.enabled THEN pg_catalog.now() ELSE NULL END;
  RETURN NEW;
END
$fn$;

-- (B) Stok gönderimi kapısı: tek tanım ------------------------------------------------------------------------------------------------
CREATE FUNCTION public.integration_stock_push_ready(p_tenant uuid, p_integration uuid) RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.integrations i
                  WHERE i.tenant_id = p_tenant AND i.id = p_integration AND i.opening_stock_taken_at IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.documents d
                  WHERE d.tenant_id = p_tenant AND d.kind = 'STOCK_IN' AND d.status = 'POSTED'
                    AND d.reason IN ('import.opening_stock', 'integration.opening_stock'));
$fn$;
REVOKE ALL ON FUNCTION public.integration_stock_push_ready(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.integration_stock_push_ready(uuid, uuid) TO wms_app;

-- (A) Bugün ikisi de açık olan bağlantı: STOCK kapanır, audit yazılır (veri sessizce değişmez; I-12).
DO $fix$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT s.tenant_id, s.integration_id, s.direction, i.provider
      FROM public.integration_flows s
      JOIN public.integration_flows h ON h.tenant_id = s.tenant_id AND h.integration_id = s.integration_id AND h.flow = 'SHIPMENTS' AND h.enabled
      JOIN public.integrations i ON i.tenant_id = s.tenant_id AND i.id = s.integration_id
     WHERE s.flow = 'STOCK' AND s.enabled
  LOOP
    UPDATE public.integration_flows SET enabled = false
     WHERE tenant_id = r.tenant_id AND integration_id = r.integration_id AND flow = 'STOCK';
    INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, change_summary)
    VALUES (r.tenant_id, NULL, 'integration.flow_changed', 'integration', r.integration_id::text,
            pg_catalog.jsonb_build_object('provider', r.provider, 'flow', 'STOCK', 'enabled', false, 'direction', r.direction,
                                          'before', pg_catalog.jsonb_build_object('enabled', true, 'direction', r.direction),
                                          'via', 'migration_0066', 'reason', 'INTEGRATION_FLOW_EXCLUSIVE'));
  END LOOP;
END
$fix$;

ALTER TABLE public.integration_flows FORCE ROW LEVEL SECURITY;
ALTER TABLE public.integration_outbox FORCE ROW LEVEL SECURITY;
ALTER TABLE public.integrations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;

CREATE FUNCTION public.integration_flows_exclusive_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  other text;
  other_on boolean;
BEGIN
  -- Yalnız kapalı → açık geçişi denetlenir: açık akışın yön/koşu alanı güncellemeleri ve kapatma serbesttir.
  IF NOT NEW.enabled OR (TG_OP = 'UPDATE' AND OLD.enabled) THEN
    RETURN NEW;
  END IF;
  IF NEW.flow NOT IN ('STOCK', 'SHIPMENTS') THEN
    RETURN NEW;
  END IF;
  other := CASE WHEN NEW.flow = 'STOCK' THEN 'SHIPMENTS' ELSE 'STOCK' END;
  -- Bağlantı başına tek kilit: eşzamanlı ikinci açma burada bekler. Sonra karşı satır koşulsuz FOR UPDATE ile (yeni ifade, son commit) okunur.
  PERFORM 1 FROM public.integrations i WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.integration_id FOR UPDATE;
  SELECT f.enabled INTO other_on FROM public.integration_flows f
    WHERE f.tenant_id = NEW.tenant_id AND f.integration_id = NEW.integration_id AND f.flow = other
    FOR UPDATE;
  IF other_on IS TRUE THEN
    RAISE EXCEPTION 'INTEGRATION_FLOW_EXCLUSIVE: stok toplamı ve irsaliye gönderimi aynı bağlantıda birlikte açılamaz (stok sahibi Etkin)'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.flow = 'STOCK' AND NOT public.integration_stock_push_ready(NEW.tenant_id, NEW.integration_id) THEN
    RAISE EXCEPTION 'OPENING_STOCK_INCOMPLETE: Devir (açılış stoku) tamamlanmadan stok gönderimi açılamaz' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.integration_flows_exclusive_guard() FROM PUBLIC;
CREATE TRIGGER integration_flows_exclusive_guard BEFORE INSERT OR UPDATE OF enabled ON public.integration_flows
  FOR EACH ROW EXECUTE FUNCTION public.integration_flows_exclusive_guard();

-- (E) Stok işareti: kesin red kaydı ---------------------------------------------------------------------------------------------------
ALTER TABLE public.integration_stock_marks
  ALTER COLUMN quantity DROP NOT NULL,
  ALTER COLUMN sent_at DROP NOT NULL,
  ALTER COLUMN sent_at DROP DEFAULT,
  ADD COLUMN failed_quantity numeric(20, 6),
  ADD COLUMN failed_at timestamptz,
  ADD COLUMN last_error_code text,
  ADD COLUMN as_of_snapshot pg_snapshot,
  ADD CONSTRAINT integration_stock_marks_state_chk CHECK (quantity IS NOT NULL OR failed_quantity IS NOT NULL),
  ADD CONSTRAINT integration_stock_marks_sent_chk CHECK ((quantity IS NULL) = (sent_at IS NULL)),
  ADD CONSTRAINT integration_stock_marks_failed_chk CHECK ((failed_quantity IS NULL) = (failed_at IS NULL) AND (failed_quantity IS NULL) = (last_error_code IS NULL)),
  ADD CONSTRAINT integration_stock_marks_error_chk CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{0,40}$');

CREATE OR REPLACE FUNCTION public.integration_stock_marks_on_update() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF NEW.quantity IS NULL THEN
    NEW.sent_at := NULL;
  ELSIF NEW.quantity IS DISTINCT FROM OLD.quantity OR OLD.sent_at IS NULL OR (OLD.failed_quantity IS NOT NULL AND NEW.failed_quantity IS NULL) THEN
    NEW.sent_at := pg_catalog.now();
  ELSE
    NEW.sent_at := OLD.sent_at;
  END IF;
  IF NEW.failed_quantity IS NULL THEN
    NEW.failed_at := NULL;
    NEW.last_error_code := NULL;
  ELSIF NEW.failed_quantity IS DISTINCT FROM OLD.failed_quantity OR NEW.last_error_code IS DISTINCT FROM OLD.last_error_code OR OLD.failed_at IS NULL THEN
    NEW.failed_at := pg_catalog.now();
  ELSE
    NEW.failed_at := OLD.failed_at;
  END IF;
  RETURN NEW;
END
$fn$;

CREATE FUNCTION public.integration_stock_marks_on_insert() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  NEW.sent_at := CASE WHEN NEW.quantity IS NULL THEN NULL ELSE pg_catalog.now() END;
  NEW.failed_at := CASE WHEN NEW.failed_quantity IS NULL THEN NULL ELSE pg_catalog.now() END;
  IF NEW.failed_quantity IS NULL THEN
    NEW.last_error_code := NULL;
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.integration_stock_marks_on_insert() FROM PUBLIC;
CREATE TRIGGER integration_stock_marks_on_insert BEFORE INSERT ON public.integration_stock_marks
  FOR EACH ROW EXECUTE FUNCTION public.integration_stock_marks_on_insert();

GRANT INSERT (failed_quantity, last_error_code, as_of_snapshot) ON public.integration_stock_marks TO wms_app;
GRANT UPDATE (failed_quantity, last_error_code, as_of_snapshot) ON public.integration_stock_marks TO wms_app;

-- (G) Koşu günlüğü bakımı -------------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.integration_runs_delete_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  -- RUNNING satırı yalnız değişiklik getirmeyen zamanlı koşunun kendi taze satırıysa silinir (sayaç 0, hata yok, 40 dk'dan genç);
  -- biten satır yalnız 7 günden eskiyse. Diğer her silme 55000.
  IF OLD.status = 'RUNNING' THEN
    IF OLD.trigger = 'SCHEDULE' AND OLD.error_code IS NULL AND OLD.started_at >= pg_catalog.now() - interval '40 minutes'
       AND OLD.created_count = 0 AND OLD.updated_count = 0 AND OLD.linked_count = 0 AND OLD.skipped_count = 0 AND OLD.failed_count = 0 THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'integration_runs: çalışan koşu kaydı silinemez' USING ERRCODE = '55000';
  END IF;
  IF OLD.started_at >= pg_catalog.now() - interval '7 days' THEN
    RAISE EXCEPTION 'integration_runs: yakın geçmişteki biten çalışma kaydı silinemez' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END
$fn$;
REVOKE ALL ON FUNCTION public.integration_runs_delete_guard() FROM PUBLIC;
CREATE TRIGGER integration_runs_delete_guard BEFORE DELETE ON public.integration_runs
  FOR EACH ROW EXECUTE FUNCTION public.integration_runs_delete_guard();
GRANT DELETE ON public.integration_runs TO wms_app;

-- (H) Kart gönderim kuyruğu -------------------------------------------------------------------------------------------------------------
ALTER TABLE public.integration_outbox
  DROP CONSTRAINT integration_outbox_flow_chk,
  DROP CONSTRAINT integration_outbox_entity_type_chk,
  ADD CONSTRAINT integration_outbox_flow_chk CHECK (flow IN ('SHIPMENTS', 'PRODUCTS', 'CONTACTS', 'WAREHOUSES')),
  ADD CONSTRAINT integration_outbox_entity_type_chk CHECK (entity_type IN ('DOCUMENT', 'ITEM', 'PARTY', 'WAREHOUSE')),
  ADD CONSTRAINT integration_outbox_flow_entity_chk CHECK (
    (flow = 'SHIPMENTS' AND entity_type = 'DOCUMENT') OR (flow = 'PRODUCTS' AND entity_type = 'ITEM')
    OR (flow = 'CONTACTS' AND entity_type = 'PARTY') OR (flow = 'WAREHOUSES' AND entity_type = 'WAREHOUSE'));
