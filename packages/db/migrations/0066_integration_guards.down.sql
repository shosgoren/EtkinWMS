-- 0066_integration_guards geri alma (G-08). 0055/0056 nesneleri birebir geri yüklenir. Veri kaybettiren adımlar (kart akışı kuyruk satırı,
-- yalnız başarısız işaret satırı, ilk açılış anı) dolu veride `allow_destructive_down` olmadan REDDEDİLİR; STOCK'u kapatan veri düzeltmesi
-- ve audit satırı geri alınmaz (audit append-only; akış tercihi kullanıcı kararıdır).
DO $guard$
DECLARE
  allow boolean := coalesce(pg_catalog.current_setting('wms_meta.allow_destructive_down', true), '') = 'on';
  n_cards integer;
  n_failed integer;
BEGIN
  -- Tablo sahibi FORCE RLS altında: sayım ve silme bütün tenant'larda olsun diye NO FORCE (sonda FORCE geri).
  ALTER TABLE public.integration_outbox NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE public.integration_stock_marks NO FORCE ROW LEVEL SECURITY;
  SELECT count(*) INTO n_cards FROM public.integration_outbox WHERE flow <> 'SHIPMENTS';
  SELECT count(*) INTO n_failed FROM public.integration_stock_marks WHERE quantity IS NULL;
  IF (n_cards > 0 OR n_failed > 0) AND NOT allow THEN
    RAISE EXCEPTION '0066_integration_guards down: kart kuyruğu (%) ya da yalnız başarısız stok işareti (%) satırı var; veri kaybettiren geri alma bu ortamda kapalı', n_cards, n_failed;
  END IF;
  DELETE FROM public.integration_outbox WHERE flow <> 'SHIPMENTS';
  DELETE FROM public.integration_stock_marks WHERE quantity IS NULL;
  UPDATE public.integration_stock_marks SET sent_at = pg_catalog.now() WHERE sent_at IS NULL;
END
$guard$;

ALTER TABLE public.integration_outbox
  DROP CONSTRAINT integration_outbox_flow_entity_chk,
  DROP CONSTRAINT integration_outbox_flow_chk,
  DROP CONSTRAINT integration_outbox_entity_type_chk,
  ADD CONSTRAINT integration_outbox_flow_chk CHECK (flow IN ('SHIPMENTS')),
  ADD CONSTRAINT integration_outbox_entity_type_chk CHECK (entity_type IN ('DOCUMENT'));

REVOKE DELETE ON public.integration_runs FROM wms_app;
DROP TRIGGER integration_runs_delete_guard ON public.integration_runs;
DROP FUNCTION public.integration_runs_delete_guard();

REVOKE INSERT (failed_quantity, last_error_code) ON public.integration_stock_marks FROM wms_app;
REVOKE UPDATE (failed_quantity, last_error_code) ON public.integration_stock_marks FROM wms_app;
DROP TRIGGER integration_stock_marks_on_insert ON public.integration_stock_marks;
DROP FUNCTION public.integration_stock_marks_on_insert();
ALTER TABLE public.integration_stock_marks
  DROP CONSTRAINT integration_stock_marks_error_chk,
  DROP CONSTRAINT integration_stock_marks_failed_chk,
  DROP CONSTRAINT integration_stock_marks_sent_chk,
  DROP CONSTRAINT integration_stock_marks_state_chk,
  DROP COLUMN last_error_code,
  DROP COLUMN failed_at,
  DROP COLUMN failed_quantity;
ALTER TABLE public.integration_stock_marks
  ALTER COLUMN sent_at SET DEFAULT now(),
  ALTER COLUMN sent_at SET NOT NULL,
  ALTER COLUMN quantity SET NOT NULL;
CREATE OR REPLACE FUNCTION public.integration_stock_marks_on_update() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  NEW.sent_at := pg_catalog.now();
  RETURN NEW;
END
$fn$;

DROP TRIGGER integration_flows_exclusive_guard ON public.integration_flows;
DROP FUNCTION public.integration_flows_exclusive_guard();
DROP FUNCTION public.integration_stock_push_ready(uuid, uuid);

CREATE OR REPLACE FUNCTION public.integration_flows_on_update() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF NEW.enabled AND NOT OLD.enabled THEN
    NEW.enabled_at := pg_catalog.now();
  ELSIF NOT NEW.enabled THEN
    NEW.enabled_at := NULL;
  ELSE
    NEW.enabled_at := OLD.enabled_at;
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
  RETURN NEW;
END
$fn$;
ALTER TABLE public.integration_flows DROP COLUMN first_enabled_at;
ALTER TABLE public.integration_outbox FORCE ROW LEVEL SECURITY;
ALTER TABLE public.integration_stock_marks FORCE ROW LEVEL SECURITY;
