-- Additive only: immutable links between the two documents of an atomic warehouse transfer.
-- Existing stock/location guards and privileges remain unchanged.
CREATE TABLE public.stock_document_links (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  source_document_id uuid NOT NULL,
  target_document_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('TRANSFER','PRODUCTION')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,source_document_id),
  UNIQUE (tenant_id,target_document_id),
  CHECK (source_document_id <> target_document_id),
  FOREIGN KEY (tenant_id,source_document_id) REFERENCES public.documents(tenant_id,id),
  FOREIGN KEY (tenant_id,target_document_id) REFERENCES public.documents(tenant_id,id)
);
ALTER TABLE public.stock_document_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_document_links FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_document_links_isolation ON public.stock_document_links
 USING (tenant_id=NULLIF(pg_catalog.current_setting('app.current_tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id=NULLIF(pg_catalog.current_setting('app.current_tenant_id',true),'')::uuid);
REVOKE ALL ON public.stock_document_links FROM PUBLIC;
GRANT SELECT ON public.stock_document_links TO wms_app;
GRANT INSERT (tenant_id,source_document_id,target_document_id,kind) ON public.stock_document_links TO wms_app;
