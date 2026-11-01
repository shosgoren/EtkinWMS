-- T-1149: refuse populated grant rollback unless destructive-down was explicitly allowed.
DO $guard$ BEGIN
 ALTER TABLE public.permission_groups NO FORCE ROW LEVEL SECURITY;
 IF EXISTS (SELECT 1 FROM public.permission_groups WHERE NOT grants <@ ARRAY['stock.post','document.create','document.approve','count_diff.approve','reversal.create','data.import','items.create','items.edit','items.archive','parties.create','parties.edit','parties.archive','warehouses.create','warehouses.edit','warehouses.archive','locations.create','locations.edit','locations.archive']::text[])
 AND COALESCE(pg_catalog.current_setting('wms_meta.allow_destructive_down',true),'off') <> 'on' THEN
  RAISE EXCEPTION '0073_label_permissions down: label grants exist; destructive rollback disabled';
 END IF;
 UPDATE public.permission_groups SET grants = ARRAY(SELECT g FROM unnest(grants) g WHERE g = ANY(ARRAY['stock.post','document.create','document.approve','count_diff.approve','reversal.create','data.import','items.create','items.edit','items.archive','parties.create','parties.edit','parties.archive','warehouses.create','warehouses.edit','warehouses.archive','locations.create','locations.edit','locations.archive']::text[]))
 WHERE NOT grants <@ ARRAY['stock.post','document.create','document.approve','count_diff.approve','reversal.create','data.import','items.create','items.edit','items.archive','parties.create','parties.edit','parties.archive','warehouses.create','warehouses.edit','warehouses.archive','locations.create','locations.edit','locations.archive']::text[];
 ALTER TABLE public.permission_groups FORCE ROW LEVEL SECURITY;
END $guard$;
ALTER TABLE public.permission_groups DROP CONSTRAINT permission_groups_grants_chk,
 ADD CONSTRAINT permission_groups_grants_chk CHECK (grants <@ ARRAY['stock.post','document.create','document.approve','count_diff.approve','reversal.create','data.import','items.create','items.edit','items.archive','parties.create','parties.edit','parties.archive','warehouses.create','warehouses.edit','warehouses.archive','locations.create','locations.edit','locations.archive']::text[] AND cardinality(grants) <= 18);
