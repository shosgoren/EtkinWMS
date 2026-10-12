DO $check$ BEGIN
 IF EXISTS (SELECT 1 FROM public.production_recipes) THEN
  RAISE EXCEPTION '0029: recipes exist; rollback would lose production definitions';
 END IF;
END $check$;
ALTER TABLE public.stock_document_links DROP CONSTRAINT stock_document_links_recipe_chk;
ALTER TABLE public.stock_document_links DROP CONSTRAINT stock_document_links_recipe_fk;
ALTER TABLE public.stock_document_links DROP COLUMN recipe_id;
DROP TABLE public.production_recipe_lines;
DROP TABLE public.production_recipes;

DROP INDEX public.stock_document_links_target_idx;
ALTER TABLE public.stock_document_links ADD UNIQUE (tenant_id,target_document_id);
