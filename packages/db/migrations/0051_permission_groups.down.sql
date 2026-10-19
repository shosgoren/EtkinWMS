-- 0051_permission_groups geri alma: grup ya da gruptaki üye varsa veri kaybettirmez (bayrak: wms_meta.allow_destructive_down).
DO $guard$
DECLARE
  t text;
  has_rows boolean;
  allow boolean := coalesce(pg_catalog.current_setting('wms_meta.allow_destructive_down', true), '') = 'on';
BEGIN
  FOREACH t IN ARRAY ARRAY['member_groups', 'permission_groups'] LOOP
    IF pg_catalog.to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', t);
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)', t) INTO has_rows;
      IF has_rows AND NOT allow THEN
        RAISE EXCEPTION '0051_permission_groups down: public.% tablosunda satır var; veri kaybettiren geri alma bu ortamda kapalı', t;
      END IF;
    END IF;
  END LOOP;
END
$guard$;

DROP TRIGGER member_groups_touch ON public.member_groups;
DROP FUNCTION public.member_groups_touch();
DROP TRIGGER permission_groups_touch ON public.permission_groups;
DROP FUNCTION public.permission_groups_touch();
DROP TABLE public.member_groups;
DROP TABLE public.permission_groups;
