-- Seal recipe lines at the creating transaction boundary. Existing revisions are sealed at migration commit.
ALTER TABLE public.production_recipes ADD COLUMN created_xid xid8 NOT NULL DEFAULT pg_catalog.pg_current_xact_id();
CREATE FUNCTION public.production_recipe_lines_guard_insert() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE recipe_xid xid8;
BEGIN
 SELECT created_xid INTO recipe_xid FROM public.production_recipes
 WHERE tenant_id=NEW.tenant_id AND id=NEW.recipe_id;
 IF recipe_xid IS DISTINCT FROM pg_catalog.pg_current_xact_id() THEN
  RAISE EXCEPTION 'production recipe revision is sealed' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.production_recipe_lines_guard_insert() FROM PUBLIC;
CREATE TRIGGER production_recipe_lines_insert_guard BEFORE INSERT ON public.production_recipe_lines
 FOR EACH ROW EXECUTE FUNCTION public.production_recipe_lines_guard_insert();
-- No INSERT/UPDATE grant on created_xid: the application cannot forge the creating transaction.
