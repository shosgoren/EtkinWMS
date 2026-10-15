-- 0037_work_signals geri alma: öncelik/sorun kayıtları ve özel vardiya varsa veri kaybettirmez (bayrak: wms_meta.allow_destructive_down).
-- Bekçi sayımı RLS'ten bağımsız olmalı (0003 down BLOKER-1): sayımdan önce NO FORCE.
DO $guard$
DECLARE
  t text;
  has_rows boolean;
  allow boolean := coalesce(pg_catalog.current_setting('wms_meta.allow_destructive_down', true), '') = 'on';
BEGIN
  FOREACH t IN ARRAY ARRAY['work_priorities', 'problem_reports'] LOOP
    IF pg_catalog.to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', t);
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)', t) INTO has_rows;
      IF has_rows AND NOT allow THEN
        RAISE EXCEPTION '0037_work_signals down: public.% tablosunda satır var; veri kaybettiren geri alma bu ortamda kapalı', t;
      END IF;
    END IF;
  END LOOP;
  ALTER TABLE public.tenant_settings NO FORCE ROW LEVEL SECURITY;
  IF EXISTS (SELECT 1 FROM public.tenant_settings WHERE shift_start <> '08:00' OR shift_end <> '17:00') AND NOT allow THEN
    RAISE EXCEPTION '0037_work_signals down: özel vardiya ayarı var; veri kaybettiren geri alma bu ortamda kapalı';
  END IF;
  ALTER TABLE public.tenant_settings FORCE ROW LEVEL SECURITY;
END
$guard$;

DROP TRIGGER problem_reports_guard ON public.problem_reports;
DROP FUNCTION public.problem_reports_guard();
DROP TABLE public.problem_reports;
DROP TABLE public.work_priorities;
REVOKE UPDATE (shift_start, shift_end) ON public.tenant_settings FROM wms_app;
ALTER TABLE public.tenant_settings
  DROP CONSTRAINT tenant_settings_shift_chk,
  DROP COLUMN shift_end,
  DROP COLUMN shift_start;
