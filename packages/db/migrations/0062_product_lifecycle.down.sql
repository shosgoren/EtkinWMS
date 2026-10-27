DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.items WHERE source_state<>'ACTIVE' OR source_disposition<>'NONE' OR source_managed_archive OR source_checked_at IS NOT NULL OR source_missing_since IS NOT NULL OR source_missing_context IS NOT NULL) THEN
  RAISE EXCEPTION 'product lifecycle data exists; rollback refused';
 END IF;
END $$;
REVOKE UPDATE(source_state,source_disposition,source_managed_archive,source_checked_at,source_missing_since,source_missing_context) ON public.items FROM wms_app;
DROP INDEX public.items_source_check_idx;
ALTER TABLE public.items DROP CONSTRAINT items_source_lifecycle_chk;
ALTER TABLE public.items DROP COLUMN source_state, DROP COLUMN source_disposition, DROP COLUMN source_managed_archive, DROP COLUMN source_checked_at, DROP COLUMN source_missing_since, DROP COLUMN source_missing_context;
