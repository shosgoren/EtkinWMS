-- 0050_parties geri alma: cari kart varsa veri kaybettirmez (bayrak: wms_meta.allow_destructive_down).
-- Bekçi sayımı RLS'ten bağımsız olmalı (0003 down BLOKER-1): sayımdan önce NO FORCE.
DO $guard$
DECLARE
  has_rows boolean;
  allow boolean := coalesce(pg_catalog.current_setting('wms_meta.allow_destructive_down', true), '') = 'on';
BEGIN
  IF pg_catalog.to_regclass('public.parties') IS NOT NULL THEN
    ALTER TABLE public.parties NO FORCE ROW LEVEL SECURITY;
    SELECT EXISTS (SELECT 1 FROM public.parties) INTO has_rows;
    IF has_rows AND NOT allow THEN
      RAISE EXCEPTION '0050_parties down: public.parties tablosunda satır var; veri kaybettiren geri alma bu ortamda kapalı';
    END IF;
  END IF;
END
$guard$;

DROP TRIGGER parties_touch ON public.parties;
DROP FUNCTION public.parties_touch();
DROP TABLE public.parties;
