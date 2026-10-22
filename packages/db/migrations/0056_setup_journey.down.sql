-- 0056_setup_journey geri alma (G-08). Yolculuk seçimleri ve açılış stoku ayarı/kilidi silinir; dolu veride `allow_destructive_down`
-- olmadan REDDEDİLİR (alınmış açılış stokunun kilidi kaybolursa ikinci kez alınabilirdi). Açılış stoku BELGESİ ve stok defteri dokunulmadan
-- kalır (I-04/I-08). Uygulama (web) önce geri alınmalıdır.
DO $guard$
DECLARE
  has_rows boolean;
  allow boolean := coalesce(pg_catalog.current_setting('wms_meta.allow_destructive_down', true), '') = 'on';
BEGIN
  IF pg_catalog.to_regclass('public.setup_journeys') IS NOT NULL THEN
    ALTER TABLE public.setup_journeys NO FORCE ROW LEVEL SECURITY;
    SELECT EXISTS (SELECT 1 FROM public.setup_journeys) INTO has_rows;
    IF has_rows AND NOT allow THEN
      RAISE EXCEPTION '0056_setup_journey down: public.setup_journeys tablosunda satır var; veri kaybettiren geri alma bu ortamda kapalı';
    END IF;
  END IF;
  ALTER TABLE public.integrations NO FORCE ROW LEVEL SECURITY;
  SELECT EXISTS (SELECT 1 FROM public.integrations WHERE opening_stock_enabled OR opening_stock_taken_at IS NOT NULL) INTO has_rows;
  ALTER TABLE public.integrations FORCE ROW LEVEL SECURITY;
  IF has_rows AND NOT allow THEN
    RAISE EXCEPTION '0056_setup_journey down: açılış stoku ayarı/kilidi dolu; veri kaybettiren geri alma bu ortamda kapalı';
  END IF;
END
$guard$;
REVOKE UPDATE (opening_stock_enabled, opening_stock_taken_at, opening_stock_document_id) ON public.integrations FROM wms_app;
DROP TRIGGER integrations_opening_stock_posted ON public.integrations;
DROP FUNCTION public.integrations_opening_stock_posted();
DROP TRIGGER integrations_opening_stock_guard ON public.integrations;
DROP FUNCTION public.integrations_opening_stock_guard();
DROP INDEX public.integrations_opening_stock_once;
ALTER TABLE public.integrations
  DROP CONSTRAINT integrations_opening_document_fkey,
  DROP CONSTRAINT integrations_opening_stock_chk,
  DROP COLUMN opening_stock_document_id,
  DROP COLUMN opening_stock_taken_at,
  DROP COLUMN opening_stock_enabled;
DROP TABLE public.setup_journeys;
DROP FUNCTION public.setup_journeys_guard();
