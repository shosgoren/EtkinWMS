-- A production output can link to consumption documents from several warehouses.
ALTER TABLE public.stock_document_links DROP CONSTRAINT stock_document_links_tenant_id_target_document_id_key;
CREATE INDEX stock_document_links_target_idx ON public.stock_document_links(tenant_id,target_document_id);
-- Additive, immutable recipe revisions. Quantities use the item's base unit.
CREATE TABLE public.production_recipes (
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 code text NOT NULL CHECK (char_length(code) BETWEEN 1 AND 64),
 version integer NOT NULL CHECK (version>0),
 name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
 output_item_id uuid NOT NULL,
 output_quantity numeric(20,6) NOT NULL CHECK (output_quantity>0),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id,id), UNIQUE (tenant_id,code,version),
 FOREIGN KEY (tenant_id,output_item_id) REFERENCES public.items(tenant_id,id)
);
CREATE TABLE public.production_recipe_lines (
 tenant_id uuid NOT NULL,
 recipe_id uuid NOT NULL,
 line_no integer NOT NULL CHECK (line_no BETWEEN 1 AND 100),
 item_id uuid NOT NULL,
 quantity numeric(20,6) NOT NULL CHECK (quantity>0),
 PRIMARY KEY (tenant_id,recipe_id,line_no), UNIQUE (tenant_id,recipe_id,item_id),
 FOREIGN KEY (tenant_id,recipe_id) REFERENCES public.production_recipes(tenant_id,id),
 FOREIGN KEY (tenant_id,item_id) REFERENCES public.items(tenant_id,id)
);
ALTER TABLE public.stock_document_links ADD COLUMN recipe_id uuid;
ALTER TABLE public.stock_document_links ADD CONSTRAINT stock_document_links_recipe_fk
 FOREIGN KEY (tenant_id,recipe_id) REFERENCES public.production_recipes(tenant_id,id);
ALTER TABLE public.stock_document_links ADD CONSTRAINT stock_document_links_recipe_chk
 CHECK ((kind='PRODUCTION')=(recipe_id IS NOT NULL));
GRANT INSERT (recipe_id) ON public.stock_document_links TO wms_app;
ALTER TABLE public.production_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_recipes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.production_recipe_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_recipe_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY production_recipes_isolation ON public.production_recipes
 USING (tenant_id=NULLIF(pg_catalog.current_setting('app.current_tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id=NULLIF(pg_catalog.current_setting('app.current_tenant_id',true),'')::uuid);
CREATE POLICY production_recipe_lines_isolation ON public.production_recipe_lines
 USING (tenant_id=NULLIF(pg_catalog.current_setting('app.current_tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id=NULLIF(pg_catalog.current_setting('app.current_tenant_id',true),'')::uuid);
REVOKE ALL ON public.production_recipes,public.production_recipe_lines FROM PUBLIC;
GRANT SELECT ON public.production_recipes,public.production_recipe_lines TO wms_app;
GRANT INSERT (tenant_id,id,code,version,name,output_item_id,output_quantity,created_by) ON public.production_recipes TO wms_app;
GRANT INSERT (tenant_id,recipe_id,line_no,item_id,quantity) ON public.production_recipe_lines TO wms_app;
-- No UPDATE or DELETE grant: a used recipe revision cannot silently change.
