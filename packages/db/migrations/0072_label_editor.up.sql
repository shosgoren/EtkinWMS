-- 0072_label_editor (T-1148, B-166): additive tenant-scoped label editor storage.
-- Existing labels, stock and roles are untouched. Published versions/assets/jobs are append-only for wms_app.
-- Coordinates are integer micrometres, never inventory quantities. JSON is bounded here and strictly parsed in domain.
-- Printer profiles are browser/OS hints only; no arbitrary network endpoints or enabled bridge.
DO $pre$ BEGIN
 IF pg_catalog.to_regclass('public.permission_groups') IS NULL THEN RAISE EXCEPTION '0072_label_editor: prerequisite missing'; END IF;
END $pre$;

CREATE TABLE public.label_templates (
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
 context text NOT NULL CHECK (context IN ('PRODUCT','RECEIPT','LOCATION','SHIPMENT')),
 draft jsonb NOT NULL CHECK (jsonb_typeof(draft) = 'object' AND octet_length(draft::text) <= 131072),
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 published_version_id uuid,
 archived_at timestamptz,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id,id),
 UNIQUE (tenant_id,id,context),
 FOREIGN KEY (tenant_id,created_by) REFERENCES public.tenant_memberships(tenant_id,id)
);
CREATE INDEX label_templates_list_idx ON public.label_templates(tenant_id,context,updated_at DESC,id);
CREATE TABLE public.label_template_versions (
 tenant_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 template_id uuid NOT NULL,
 context text NOT NULL,
 revision integer NOT NULL CHECK (revision > 0),
 design jsonb NOT NULL CHECK (jsonb_typeof(design) = 'object' AND octet_length(design::text) <= 131072),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id,id),
 UNIQUE (tenant_id,template_id,revision),
 UNIQUE (tenant_id,id,template_id,context),
 FOREIGN KEY (tenant_id,template_id,context) REFERENCES public.label_templates(tenant_id,id,context),
 FOREIGN KEY (tenant_id,created_by) REFERENCES public.tenant_memberships(tenant_id,id)
);
ALTER TABLE public.label_templates ADD CONSTRAINT label_templates_published_fk
 FOREIGN KEY (tenant_id,published_version_id,id,context) REFERENCES public.label_template_versions(tenant_id,id,template_id,context);
CREATE TABLE public.label_assets (
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 png bytea NOT NULL CHECK (octet_length(png) BETWEEN 67 AND 131072),
 sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
 width integer NOT NULL CHECK (width BETWEEN 1 AND 1024),
 height integer NOT NULL CHECK (height BETWEEN 1 AND 1024),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id,id),
 UNIQUE (tenant_id,sha256),
 FOREIGN KEY (tenant_id,created_by) REFERENCES public.tenant_memberships(tenant_id,id)
);
CREATE TABLE public.label_printers (
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
 mode text NOT NULL DEFAULT 'SYSTEM_DIALOG' CHECK (mode = 'SYSTEM_DIALOG'),
 dpi integer NOT NULL DEFAULT 203 CHECK (dpi IN (203,300,600)),
 offset_x integer NOT NULL DEFAULT 0 CHECK (offset_x BETWEEN -10000 AND 10000),
 offset_y integer NOT NULL DEFAULT 0 CHECK (offset_y BETWEEN -10000 AND 10000),
 active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id,id),
 FOREIGN KEY (tenant_id,created_by) REFERENCES public.tenant_memberships(tenant_id,id)
);
CREATE TABLE public.label_preferences (
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 template_id uuid,
 membership_id uuid,
 device_id uuid,
 printer_id uuid,
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id,id),
 UNIQUE NULLS NOT DISTINCT (tenant_id,template_id,membership_id,device_id),
 CHECK ((membership_id IS NULL) = (device_id IS NULL)),
 FOREIGN KEY (tenant_id,template_id) REFERENCES public.label_templates(tenant_id,id),
 FOREIGN KEY (tenant_id,printer_id) REFERENCES public.label_printers(tenant_id,id),
 FOREIGN KEY (tenant_id,membership_id) REFERENCES public.tenant_memberships(tenant_id,id)
);
CREATE TABLE public.label_defaults (
 tenant_id uuid NOT NULL,
 context text NOT NULL,
 template_id uuid NOT NULL,
 version_id uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id,context),
 FOREIGN KEY (tenant_id,version_id,template_id,context) REFERENCES public.label_template_versions(tenant_id,id,template_id,context)
);
CREATE TABLE public.label_print_jobs (
 tenant_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 template_id uuid NOT NULL,
 version_id uuid NOT NULL,
 context text NOT NULL,
 snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'array' AND jsonb_array_length(snapshot) BETWEEN 1 AND 100 AND octet_length(snapshot::text) <= 524288),
 copies integer NOT NULL CHECK (copies BETWEEN 1 AND 100),
 printer_id uuid,
 created_by uuid NOT NULL,
 reprint_of uuid,
 reason text CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 120),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id,id),
 CHECK (reprint_of IS NULL OR reason IS NOT NULL),
 FOREIGN KEY (tenant_id,version_id,template_id,context) REFERENCES public.label_template_versions(tenant_id,id,template_id,context),
 FOREIGN KEY (tenant_id,printer_id) REFERENCES public.label_printers(tenant_id,id),
 FOREIGN KEY (tenant_id,created_by) REFERENCES public.tenant_memberships(tenant_id,id),
 FOREIGN KEY (tenant_id,reprint_of) REFERENCES public.label_print_jobs(tenant_id,id)
);
CREATE INDEX label_print_jobs_recent_idx ON public.label_print_jobs(tenant_id,created_at DESC,id);

ALTER TABLE public.label_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.label_templates FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.label_templates FROM PUBLIC;
CREATE POLICY label_templates_isolation ON public.label_templates
 USING (tenant_id = NULLIF(pg_catalog.current_setting('app.current_tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id = NULLIF(pg_catalog.current_setting('app.current_tenant_id',true),'')::uuid);
GRANT SELECT ON public.label_templates TO wms_app;

ALTER TABLE public.label_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.label_template_versions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.label_template_versions FROM PUBLIC;
CREATE POLICY label_template_versions_isolation ON public.label_template_versions
 USING (tenant_id = NULLIF(pg_catalog.current_setting('app.current_tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id = NULLIF(pg_catalog.current_setting('app.current_tenant_id',true),'')::uuid);
GRANT SELECT ON public.label_template_versions TO wms_app;

ALTER TABLE public.label_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.label_assets FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.label_assets FROM PUBLIC;
CREATE POLICY label_assets_isolation ON public.label_assets
 USING (tenant_id = NULLIF(pg_catalog.current_setting('app.current_tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id = NULLIF(pg_catalog.current_setting('app.current_tenant_id',true),'')::uuid);
GRANT SELECT ON public.label_assets TO wms_app;

ALTER TABLE public.label_printers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.label_printers FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.label_printers FROM PUBLIC;
CREATE POLICY label_printers_isolation ON public.label_printers
 USING (tenant_id = NULLIF(pg_catalog.current_setting('app.current_tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id = NULLIF(pg_catalog.current_setting('app.current_tenant_id',true),'')::uuid);
GRANT SELECT ON public.label_printers TO wms_app;

ALTER TABLE public.label_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.label_preferences FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.label_preferences FROM PUBLIC;
CREATE POLICY label_preferences_isolation ON public.label_preferences
 USING (tenant_id = NULLIF(pg_catalog.current_setting('app.current_tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id = NULLIF(pg_catalog.current_setting('app.current_tenant_id',true),'')::uuid);
GRANT SELECT ON public.label_preferences TO wms_app;

ALTER TABLE public.label_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.label_defaults FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.label_defaults FROM PUBLIC;
CREATE POLICY label_defaults_isolation ON public.label_defaults
 USING (tenant_id = NULLIF(pg_catalog.current_setting('app.current_tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id = NULLIF(pg_catalog.current_setting('app.current_tenant_id',true),'')::uuid);
GRANT SELECT ON public.label_defaults TO wms_app;

ALTER TABLE public.label_print_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.label_print_jobs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.label_print_jobs FROM PUBLIC;
CREATE POLICY label_print_jobs_isolation ON public.label_print_jobs
 USING (tenant_id = NULLIF(pg_catalog.current_setting('app.current_tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id = NULLIF(pg_catalog.current_setting('app.current_tenant_id',true),'')::uuid);
GRANT SELECT ON public.label_print_jobs TO wms_app;

GRANT INSERT (tenant_id,id,name,context,draft,created_by) ON public.label_templates TO wms_app;
GRANT UPDATE (name,draft,version,published_version_id,archived_at,updated_at) ON public.label_templates TO wms_app;
GRANT INSERT (tenant_id,id,template_id,context,revision,design,created_by) ON public.label_template_versions TO wms_app;
GRANT INSERT (tenant_id,id,png,sha256,width,height,created_by) ON public.label_assets TO wms_app;
GRANT INSERT (tenant_id,id,name,mode,dpi,offset_x,offset_y,active,created_by) ON public.label_printers TO wms_app;
GRANT UPDATE (name,dpi,offset_x,offset_y,active,version) ON public.label_printers TO wms_app;
GRANT INSERT (tenant_id,id,template_id,membership_id,device_id,printer_id) ON public.label_preferences TO wms_app;
GRANT UPDATE (printer_id,version,updated_at) ON public.label_preferences TO wms_app;
GRANT INSERT (tenant_id,context,template_id,version_id) ON public.label_defaults TO wms_app;
GRANT UPDATE (template_id,version_id,version,updated_at) ON public.label_defaults TO wms_app;
GRANT INSERT (tenant_id,id,template_id,version_id,context,snapshot,copies,printer_id,created_by,reprint_of,reason) ON public.label_print_jobs TO wms_app;
