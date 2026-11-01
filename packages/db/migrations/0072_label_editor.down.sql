-- Empty rollback is safe; populated production rollback refuses without explicit destructive-down mode.
DO $guard$
DECLARE t text; used boolean := false; n boolean;
BEGIN
 FOREACH t IN ARRAY ARRAY['label_templates','label_template_versions','label_assets','label_printers','label_preferences','label_defaults','label_print_jobs'] LOOP
  EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)',t) INTO n;
  used := used OR n;
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
 END LOOP;
 IF used AND COALESCE(pg_catalog.current_setting('wms_meta.allow_destructive_down',true),'off') <> 'on' THEN
  RAISE EXCEPTION '0072_label_editor down: label data exists; destructive rollback disabled';
 END IF;
END $guard$;
ALTER TABLE public.label_templates DROP CONSTRAINT label_templates_published_fk;
DROP TABLE public.label_print_jobs;
DROP TABLE public.label_defaults;
DROP TABLE public.label_preferences;
DROP TABLE public.label_printers;
DROP TABLE public.label_assets;
DROP TABLE public.label_template_versions;
DROP TABLE public.label_templates;
