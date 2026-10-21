-- 0055_integrations geri alma (G-08). Bağlantı, akış, çalışma günlüğü, gönderim kuyruğu ve stok işareti silinir; dolu veride
-- `allow_destructive_down` olmadan REDDEDİLİR (bağlantı/gönderim geçmişi kaybolmasın). 0019 `external_refs` eşlemeleri dokunulmadan kalır.
-- Uygulama (web + worker) önce geri alınmalıdır.
DO $guard$
DECLARE
  t text;
  has_rows boolean;
  allow boolean := coalesce(pg_catalog.current_setting('wms_meta.allow_destructive_down', true), '') = 'on';
BEGIN
  FOREACH t IN ARRAY ARRAY['integration_stock_marks', 'integration_outbox', 'integration_runs', 'integration_flows', 'integrations'] LOOP
    IF pg_catalog.to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', t);
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)', t) INTO has_rows;
      IF has_rows AND NOT allow THEN
        RAISE EXCEPTION '0055_integrations down: public.% tablosunda satır var; veri kaybettiren geri alma bu ortamda kapalı', t;
      END IF;
    END IF;
  END LOOP;
END
$guard$;
DROP TABLE public.integration_stock_marks;
DROP TABLE public.integration_outbox;
DROP TABLE public.integration_runs;
DROP TABLE public.integration_flows;
DROP TABLE public.integrations;
DROP FUNCTION public.integration_stock_marks_on_update();
DROP FUNCTION public.integration_outbox_guard();
DROP FUNCTION public.integration_runs_guard();
DROP FUNCTION public.integration_flows_on_insert();
DROP FUNCTION public.integration_flows_on_update();
DROP FUNCTION public.integrations_on_update();
