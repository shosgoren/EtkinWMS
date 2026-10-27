-- Source lifecycle is metadata. Native archive semantics, stock, RLS and durable item identities remain intact.
ALTER TABLE public.items
 ADD COLUMN source_state text NOT NULL DEFAULT 'ACTIVE',
 ADD COLUMN source_disposition text NOT NULL DEFAULT 'NONE',
 ADD COLUMN source_managed_archive boolean NOT NULL DEFAULT false,
 ADD COLUMN source_checked_at timestamptz,
 ADD COLUMN source_missing_since timestamptz,
 ADD COLUMN source_missing_context text;
ALTER TABLE public.items ADD CONSTRAINT items_source_lifecycle_chk CHECK (
 (source_missing_context IS NULL OR source_missing_context ~ '^[0-9a-f]{64}$')
 AND ((source_missing_since IS NULL) = (source_missing_context IS NULL))
 AND source_state IN ('ACTIVE','ARCHIVED','DELETED')
 AND source_disposition IN ('NONE','PENDING','ARCHIVED','REMOVED')
 AND (source_state <> 'ACTIVE' OR (source_disposition='NONE' AND NOT source_managed_archive))
 AND (source_disposition NOT IN ('ARCHIVED','REMOVED') OR status='ARCHIVED')
 AND (source_disposition<>'REMOVED' OR source_state='DELETED')
 AND (NOT source_managed_archive OR (status='ARCHIVED' AND source_state<>'ACTIVE'))
);
CREATE INDEX items_source_check_idx ON public.items(tenant_id,source_checked_at,id);
GRANT UPDATE(source_state,source_disposition,source_managed_archive,source_checked_at,source_missing_since,source_missing_context) ON public.items TO wms_app;
