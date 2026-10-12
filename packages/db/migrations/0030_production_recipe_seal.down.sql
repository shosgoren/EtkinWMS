-- Removing the seal is only safe when no saved definitions exist.
DO $check$ BEGIN
 IF EXISTS (SELECT 1 FROM public.production_recipes) THEN
  RAISE EXCEPTION '0030: recipes exist; removing the seal would weaken saved recipe integrity';
 END IF;
END $check$;
DROP TRIGGER production_recipe_lines_insert_guard ON public.production_recipe_lines;
DROP FUNCTION public.production_recipe_lines_guard_insert();
ALTER TABLE public.production_recipes DROP COLUMN created_xid;
