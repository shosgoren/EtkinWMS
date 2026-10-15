-- T-989 (I-18, Görevlerim tasarımı birebir): ana ekrandaki VARDİYA satırı, ACİL rozeti ve SORUN kartı için gerçek veri.
-- Kullanıcı kararı 2026-10-15: "Altyapısını da kur". Uydurma değer yok: üç alan da kullanıcı/yönetici girişiyle dolar.
--   1. tenant_settings.shift_start/shift_end: çalışma vardiyası (varsayılan 08:00–17:00; ayarlardan değişir).
--   2. work_priorities: iş başına öncelik (ACİL) ve hedef saat. Konu çok biçimlidir (teslim, satış siparişi, belge, depo görevi);
--      çekirdek tablolara sütun eklenmez (belge sürümü/koruma tetikleyicileri etkilenmez), konunun varlığı komutta doğrulanır.
--   3. problem_reports: sahadan "sorun bildir" kaydı (OPEN → RESOLVED). Konu isteğe bağlıdır (genel bildirim).
-- RLS ADR-015 §5 kalıbı; GRANT'lar sütun bazlı, DELETE yok.

ALTER TABLE public.tenant_settings
  ADD COLUMN shift_start time NOT NULL DEFAULT '08:00',
  ADD COLUMN shift_end time NOT NULL DEFAULT '17:00',
  ADD CONSTRAINT tenant_settings_shift_chk CHECK (shift_start <> shift_end);
GRANT UPDATE (shift_start, shift_end) ON public.tenant_settings TO wms_app;

CREATE TABLE public.work_priorities (
  tenant_id    uuid        NOT NULL REFERENCES public.tenants (id),
  subject_kind text        NOT NULL,
  subject_id   uuid        NOT NULL,
  urgent       boolean     NOT NULL DEFAULT false,
  due_time     time,
  updated_by   uuid        NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_priorities_pkey PRIMARY KEY (tenant_id, subject_kind, subject_id),
  CONSTRAINT work_priorities_kind_chk CHECK (subject_kind IN ('INBOUND_RECEIPT', 'SALES_ORDER', 'DOCUMENT', 'WAREHOUSE_TASK')),
  CONSTRAINT work_priorities_updated_by_fkey FOREIGN KEY (tenant_id, updated_by) REFERENCES public.tenant_memberships (tenant_id, id)
);

CREATE TABLE public.problem_reports (
  tenant_id       uuid        NOT NULL REFERENCES public.tenants (id),
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  warehouse_id    uuid,
  subject_kind    text,
  subject_id      uuid,
  reason          text        NOT NULL,
  note            text,
  status          text        NOT NULL DEFAULT 'OPEN',
  reported_by     uuid        NOT NULL,
  reported_at     timestamptz NOT NULL DEFAULT now(),
  resolved_by     uuid,
  resolved_at     timestamptz,
  resolution_note text,
  CONSTRAINT problem_reports_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT problem_reports_warehouse_fkey FOREIGN KEY (tenant_id, warehouse_id) REFERENCES public.warehouses (tenant_id, id),
  CONSTRAINT problem_reports_reported_by_fkey FOREIGN KEY (tenant_id, reported_by) REFERENCES public.tenant_memberships (tenant_id, id),
  CONSTRAINT problem_reports_resolved_by_fkey FOREIGN KEY (tenant_id, resolved_by) REFERENCES public.tenant_memberships (tenant_id, id),
  CONSTRAINT problem_reports_kind_chk CHECK (subject_kind IS NULL OR subject_kind IN ('INBOUND_RECEIPT', 'SALES_ORDER', 'DOCUMENT', 'WAREHOUSE_TASK')),
  CONSTRAINT problem_reports_subject_pair_chk CHECK ((subject_kind IS NULL) = (subject_id IS NULL)),
  CONSTRAINT problem_reports_reason_chk CHECK (reason IN ('DAMAGED', 'MISSING', 'WRONG_ITEM', 'NO_LABEL', 'LOCATION', 'OTHER')),
  CONSTRAINT problem_reports_note_chk CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 500),
  CONSTRAINT problem_reports_resolution_note_chk CHECK (resolution_note IS NULL OR char_length(resolution_note) BETWEEN 1 AND 500),
  CONSTRAINT problem_reports_status_chk CHECK (status IN ('OPEN', 'RESOLVED')),
  CONSTRAINT problem_reports_resolved_chk CHECK ((status = 'RESOLVED') = (resolved_at IS NOT NULL) AND (status = 'RESOLVED') = (resolved_by IS NOT NULL))
);
CREATE INDEX problem_reports_open_idx ON public.problem_reports (tenant_id, subject_kind, subject_id) WHERE status = 'OPEN';

-- Kapanmış bildirim değişmez; açık bildirimde yalnız OPEN → RESOLVED geçişi yapılır. Zaman damgaları sunucudadır (uygulama rolü yazamaz):
-- resolved_at geçişte now(), work_priorities.updated_at her yazımda now().
CREATE FUNCTION public.problem_reports_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF OLD.status = 'RESOLVED' THEN
    RAISE EXCEPTION 'problem_reports: kapanmış bildirim değiştirilemez' USING ERRCODE = '23514';
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
     OR NEW.subject_kind IS DISTINCT FROM OLD.subject_kind OR NEW.subject_id IS DISTINCT FROM OLD.subject_id OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.note IS DISTINCT FROM OLD.note OR NEW.reported_by IS DISTINCT FROM OLD.reported_by OR NEW.reported_at IS DISTINCT FROM OLD.reported_at THEN
    RAISE EXCEPTION 'problem_reports: bildirim alanları değiştirilemez' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'OPEN' THEN
    IF NEW.resolved_by IS DISTINCT FROM OLD.resolved_by OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at OR NEW.resolution_note IS DISTINCT FROM OLD.resolution_note THEN
      RAISE EXCEPTION 'problem_reports: açık bildirimde kapatma alanları yazılmaz' USING ERRCODE = '23514';
    END IF;
  ELSE
    NEW.resolved_at := now();
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.problem_reports_guard() FROM PUBLIC;
CREATE TRIGGER problem_reports_guard BEFORE UPDATE ON public.problem_reports
  FOR EACH ROW EXECUTE FUNCTION public.problem_reports_guard();

CREATE FUNCTION public.work_priorities_touch() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.work_priorities_touch() FROM PUBLIC;
CREATE TRIGGER work_priorities_touch BEFORE INSERT OR UPDATE ON public.work_priorities
  FOR EACH ROW EXECUTE FUNCTION public.work_priorities_touch();

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['work_priorities', 'problem_reports'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I
         USING      (tenant_id = NULLIF(pg_catalog.current_setting(''app.current_tenant_id'', true), '''')::uuid)
         WITH CHECK (tenant_id = NULLIF(pg_catalog.current_setting(''app.current_tenant_id'', true), '''')::uuid)',
      t || '_isolation', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t);
  END LOOP;
END
$rls$;

GRANT SELECT ON public.work_priorities TO wms_app;
GRANT INSERT (tenant_id, subject_kind, subject_id, urgent, due_time, updated_by) ON public.work_priorities TO wms_app;
GRANT UPDATE (urgent, due_time, updated_by) ON public.work_priorities TO wms_app;

GRANT SELECT ON public.problem_reports TO wms_app;
GRANT INSERT (tenant_id, id, warehouse_id, subject_kind, subject_id, reason, note, reported_by) ON public.problem_reports TO wms_app;
GRANT UPDATE (status, resolved_by, resolution_note) ON public.problem_reports TO wms_app;
