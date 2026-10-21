-- 0055_integrations (T-991): sağlayıcıdan bağımsız ERP bağlantısı — bağlantı, akış (aç/kapa + yön), çalışma günlüğü, gönderim kuyruğu
-- (outbox) ve stok seviyesi işareti. İlk sağlayıcı Paraşüt; Logo aynı tablolara ikinci sağlayıcı olarak girer.
--
-- BİLİNÇLİ KARARLAR (inceleme için):
-- * Kayıt eşlemesi (Etkin kaydı <-> dış kimlik) YENİ TABLO DEĞİLDİR: 0019 `external_refs` (iki yönlü tekillik, sistem = sağlayıcı kodu)
--   kullanılır; aynı ürün / cari / depo / belge iki kez bağlanamaz, iki kez yaratılmaz.
-- * `integrations.credentials` YALNIZ mühürlü kutudur (AES-256-GCM, `@wms/shared/seal`; AAD = iş türü + sağlayıcı + tenant): CHECK yalnız
--   {v, kid, iv, tag, ct} anahtarlarına izin verir; düz metin parola / belirteç nesnesi DB'ye yazılamaz. Kullanıcı parolası hiç saklanmaz
--   (yalnız istemci kimliği/sırrı + yenileme ve erişim belirteci). Bağlantı kesilince kutu NULL olur (CHECK: DISCONNECTED <=> NULL).
-- * Akış yönü kuralı DB'de de vardır (INVARIANTS I-04: stok yalnız belgeyle değişir): STOCK ve SHIPMENTS yalnız Etkin -> ERP (PUSH);
--   SALES_ORDERS yalnız ERP -> Etkin (PULL). Sağlayıcının desteklemediği akış (ör. Paraşüt'te sipariş yok) domain'de reddedilir.
-- * `enabled_at` istemciden yazılamaz: tetikleyici akış açıldığı anda yazar; "açıldıktan sonra oluşan belge" kesimi bu alandandır.
-- * Çalışma kaydı bitince değişmez (tetikleyici); gönderim kuyruğunda SENT satırı değişmez; DELETE yetkisi yok.
-- * `wms_app` yalnız sütun düzeyi INSERT/UPDATE; ENABLE + FORCE RLS, tenant izolasyonu (0019 ile aynı politika metni).

CREATE TABLE public.integrations (
  tenant_id               uuid        NOT NULL,
  id                      uuid        NOT NULL DEFAULT gen_random_uuid(),
  provider                text        NOT NULL,
  status                  text        NOT NULL DEFAULT 'CONNECTED',
  account_label           text,
  account_ref             text,
  credentials             jsonb,
  connected_by            uuid,
  connected_membership_id uuid,
  connected_at            timestamptz,
  last_checked_at         timestamptz,
  last_error_code         text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  version                 integer     NOT NULL DEFAULT 1,
  CONSTRAINT integrations_pkey PRIMARY KEY (id),
  CONSTRAINT integrations_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT integrations_tenant_provider_key UNIQUE (tenant_id, provider),
  CONSTRAINT integrations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants (id),
  CONSTRAINT integrations_membership_fkey FOREIGN KEY (tenant_id, connected_membership_id) REFERENCES public.tenant_memberships (tenant_id, id),
  CONSTRAINT integrations_provider_chk CHECK (provider IN ('PARASUT', 'LOGO')),
  CONSTRAINT integrations_status_chk CHECK (status IN ('CONNECTED', 'ERROR', 'DISCONNECTED')),
  CONSTRAINT integrations_credentials_chk CHECK ((status = 'DISCONNECTED') = (credentials IS NULL)),
  CONSTRAINT integrations_credentials_sealed_chk CHECK (
    credentials IS NULL OR (
      jsonb_typeof(credentials) = 'object'
      AND credentials ?& ARRAY['v', 'kid', 'iv', 'tag', 'ct']
      AND (credentials - 'v' - 'kid' - 'iv' - 'tag' - 'ct') = '{}'::jsonb
    )
  ),
  CONSTRAINT integrations_connected_chk CHECK (status = 'DISCONNECTED' OR (connected_by IS NOT NULL AND connected_membership_id IS NOT NULL AND connected_at IS NOT NULL)),
  CONSTRAINT integrations_label_chk CHECK (account_label IS NULL OR (btrim(account_label) <> '' AND char_length(account_label) <= 120)),
  CONSTRAINT integrations_ref_chk CHECK (account_ref IS NULL OR account_ref ~ '^[0-9A-Za-z_-]{1,32}$'),
  CONSTRAINT integrations_error_chk CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{0,40}$'),
  CONSTRAINT integrations_version_chk CHECK (version >= 1)
);

CREATE TABLE public.integration_flows (
  tenant_id       uuid        NOT NULL,
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  integration_id  uuid        NOT NULL,
  flow            text        NOT NULL,
  enabled         boolean     NOT NULL DEFAULT false,
  direction       text        NOT NULL,
  enabled_at      timestamptz,
  cursor          text,
  last_run_at     timestamptz,
  last_success_at timestamptz,
  last_status     text,
  error_count     integer     NOT NULL DEFAULT 0,
  last_error_code text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  version         integer     NOT NULL DEFAULT 1,
  CONSTRAINT integration_flows_pkey PRIMARY KEY (id),
  CONSTRAINT integration_flows_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT integration_flows_flow_key UNIQUE (tenant_id, integration_id, flow),
  CONSTRAINT integration_flows_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants (id),
  CONSTRAINT integration_flows_integration_fkey FOREIGN KEY (tenant_id, integration_id) REFERENCES public.integrations (tenant_id, id),
  CONSTRAINT integration_flows_flow_chk CHECK (flow IN ('PRODUCTS', 'CONTACTS', 'WAREHOUSES', 'SALES_ORDERS', 'SHIPMENTS', 'STOCK')),
  CONSTRAINT integration_flows_direction_chk CHECK (direction IN ('PULL', 'PUSH', 'BOTH')),
  -- I-04: stok ve irsaliye ERP'den Etkin'e akmaz; sipariş Etkin'den ERP'ye gönderilmez.
  CONSTRAINT integration_flows_direction_rule_chk CHECK (
    (flow IN ('STOCK', 'SHIPMENTS') AND direction = 'PUSH')
    OR (flow = 'SALES_ORDERS' AND direction = 'PULL')
    OR flow IN ('PRODUCTS', 'CONTACTS', 'WAREHOUSES')
  ),
  CONSTRAINT integration_flows_cursor_chk CHECK (cursor IS NULL OR cursor ~ '^[0-9]{1,9}$'),
  CONSTRAINT integration_flows_status_chk CHECK (last_status IS NULL OR last_status IN ('SUCCESS', 'PARTIAL', 'FAILED')),
  CONSTRAINT integration_flows_error_count_chk CHECK (error_count >= 0),
  CONSTRAINT integration_flows_error_chk CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{0,40}$'),
  CONSTRAINT integration_flows_version_chk CHECK (version >= 1)
);

CREATE TABLE public.integration_runs (
  tenant_id      uuid        NOT NULL,
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  integration_id uuid        NOT NULL,
  flow           text        NOT NULL,
  trigger        text        NOT NULL,
  status         text        NOT NULL DEFAULT 'RUNNING',
  requested_by   uuid,
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  created_count  integer     NOT NULL DEFAULT 0,
  updated_count  integer     NOT NULL DEFAULT 0,
  linked_count   integer     NOT NULL DEFAULT 0,
  skipped_count  integer     NOT NULL DEFAULT 0,
  failed_count   integer     NOT NULL DEFAULT 0,
  error_code     text,
  CONSTRAINT integration_runs_pkey PRIMARY KEY (id),
  CONSTRAINT integration_runs_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT integration_runs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants (id),
  CONSTRAINT integration_runs_integration_fkey FOREIGN KEY (tenant_id, integration_id) REFERENCES public.integrations (tenant_id, id),
  CONSTRAINT integration_runs_flow_chk CHECK (flow IN ('PRODUCTS', 'CONTACTS', 'WAREHOUSES', 'SALES_ORDERS', 'SHIPMENTS', 'STOCK')),
  CONSTRAINT integration_runs_trigger_chk CHECK (trigger IN ('SCHEDULE', 'MANUAL')),
  CONSTRAINT integration_runs_status_chk CHECK (status IN ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED')),
  CONSTRAINT integration_runs_counts_chk CHECK (created_count >= 0 AND updated_count >= 0 AND linked_count >= 0 AND skipped_count >= 0 AND failed_count >= 0),
  CONSTRAINT integration_runs_error_chk CHECK (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{0,40}$')
);
CREATE INDEX integration_runs_recent_idx ON public.integration_runs (tenant_id, integration_id, started_at DESC);

CREATE TABLE public.integration_outbox (
  tenant_id       uuid        NOT NULL,
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  integration_id  uuid        NOT NULL,
  flow            text        NOT NULL,
  entity_type     text        NOT NULL,
  entity_id       uuid        NOT NULL,
  status          text        NOT NULL DEFAULT 'PENDING',
  attempts        integer     NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text,
  external_id     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  CONSTRAINT integration_outbox_pkey PRIMARY KEY (id),
  CONSTRAINT integration_outbox_tenant_id_id_key UNIQUE (tenant_id, id),
  -- Aynı Etkin kaydı aynı akışta bir kez kuyruğa girer (tekrar tarama ON CONFLICT DO NOTHING).
  CONSTRAINT integration_outbox_entity_key UNIQUE (tenant_id, integration_id, flow, entity_id),
  CONSTRAINT integration_outbox_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants (id),
  CONSTRAINT integration_outbox_integration_fkey FOREIGN KEY (tenant_id, integration_id) REFERENCES public.integrations (tenant_id, id),
  CONSTRAINT integration_outbox_flow_chk CHECK (flow IN ('SHIPMENTS')),
  CONSTRAINT integration_outbox_entity_type_chk CHECK (entity_type IN ('DOCUMENT')),
  -- SENDING: dış çağrı öncesi kalıcı işaret. Çağrı sırasında kopma olursa satır CHECK'e düşer (kör yeniden gönderim yok: çift irsaliye olmaz).
  CONSTRAINT integration_outbox_status_chk CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED', 'CHECK')),
  CONSTRAINT integration_outbox_attempts_chk CHECK (attempts >= 0 AND attempts <= 100),
  CONSTRAINT integration_outbox_sent_chk CHECK ((status = 'SENT') = (sent_at IS NOT NULL AND external_id IS NOT NULL)),
  CONSTRAINT integration_outbox_external_chk CHECK (external_id IS NULL OR external_id ~ '^[0-9A-Za-z_-]{1,64}$'),
  CONSTRAINT integration_outbox_error_chk CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{0,40}$')
);
CREATE INDEX integration_outbox_due_idx ON public.integration_outbox (tenant_id, integration_id, flow, next_attempt_at) WHERE status = 'PENDING';

-- Etkin -> ERP stok seviyesi: son gönderilen miktar (yalnız değişen satır gönderilir). Stok kaynağı DEĞİLDİR (yalnız işaret).
CREATE TABLE public.integration_stock_marks (
  tenant_id      uuid           NOT NULL,
  integration_id uuid           NOT NULL,
  item_id        uuid           NOT NULL,
  warehouse_id   uuid           NOT NULL,
  quantity       numeric(20, 6) NOT NULL,
  sent_at        timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT integration_stock_marks_pkey PRIMARY KEY (tenant_id, integration_id, item_id, warehouse_id),
  CONSTRAINT integration_stock_marks_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants (id),
  CONSTRAINT integration_stock_marks_integration_fkey FOREIGN KEY (tenant_id, integration_id) REFERENCES public.integrations (tenant_id, id),
  CONSTRAINT integration_stock_marks_item_fkey FOREIGN KEY (tenant_id, item_id) REFERENCES public.items (tenant_id, id),
  CONSTRAINT integration_stock_marks_warehouse_fkey FOREIGN KEY (tenant_id, warehouse_id) REFERENCES public.warehouses (tenant_id, id)
);

CREATE FUNCTION public.integrations_on_update() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.integrations_on_update() FROM PUBLIC;
CREATE TRIGGER integrations_on_update BEFORE UPDATE ON public.integrations
  FOR EACH ROW EXECUTE FUNCTION public.integrations_on_update();

CREATE FUNCTION public.integration_flows_on_update() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF NEW.enabled AND NOT OLD.enabled THEN
    NEW.enabled_at := pg_catalog.now();
  ELSIF NOT NEW.enabled THEN
    NEW.enabled_at := NULL;
  ELSE
    NEW.enabled_at := OLD.enabled_at;
  END IF;
  NEW.version := OLD.version + 1;
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.integration_flows_on_update() FROM PUBLIC;
CREATE TRIGGER integration_flows_on_update BEFORE UPDATE ON public.integration_flows
  FOR EACH ROW EXECUTE FUNCTION public.integration_flows_on_update();

CREATE FUNCTION public.integration_flows_on_insert() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  NEW.enabled_at := CASE WHEN NEW.enabled THEN pg_catalog.now() ELSE NULL END;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.integration_flows_on_insert() FROM PUBLIC;
CREATE TRIGGER integration_flows_on_insert BEFORE INSERT ON public.integration_flows
  FOR EACH ROW EXECUTE FUNCTION public.integration_flows_on_insert();

CREATE FUNCTION public.integration_runs_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF OLD.status <> 'RUNNING' THEN
    RAISE EXCEPTION 'integration_runs: biten çalışma kaydı değiştirilemez' USING ERRCODE = '55000';
  END IF;
  IF NEW.status <> 'RUNNING' THEN
    NEW.finished_at := pg_catalog.now();
  ELSE
    NEW.finished_at := NULL;
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.integration_runs_guard() FROM PUBLIC;
CREATE TRIGGER integration_runs_guard BEFORE UPDATE ON public.integration_runs
  FOR EACH ROW EXECUTE FUNCTION public.integration_runs_guard();

CREATE FUNCTION public.integration_outbox_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF OLD.status = 'SENT' THEN
    RAISE EXCEPTION 'integration_outbox: gönderilmiş kayıt değiştirilemez' USING ERRCODE = '55000';
  END IF;
  NEW.sent_at := CASE WHEN NEW.status = 'SENT' THEN pg_catalog.now() ELSE NULL END;
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.integration_outbox_guard() FROM PUBLIC;
CREATE TRIGGER integration_outbox_guard BEFORE UPDATE ON public.integration_outbox
  FOR EACH ROW EXECUTE FUNCTION public.integration_outbox_guard();

CREATE FUNCTION public.integration_stock_marks_on_update() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  NEW.sent_at := pg_catalog.now();
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.integration_stock_marks_on_update() FROM PUBLIC;
CREATE TRIGGER integration_stock_marks_on_update BEFORE UPDATE ON public.integration_stock_marks
  FOR EACH ROW EXECUTE FUNCTION public.integration_stock_marks_on_update();

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['integrations', 'integration_flows', 'integration_runs', 'integration_outbox', 'integration_stock_marks'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I
         USING      (tenant_id = NULLIF(pg_catalog.current_setting(''app.current_tenant_id'', true), '''')::uuid)
         WITH CHECK (tenant_id = NULLIF(pg_catalog.current_setting(''app.current_tenant_id'', true), '''')::uuid)',
      t || '_isolation', t);
  END LOOP;
END
$rls$;

GRANT SELECT ON public.integrations TO wms_app;
GRANT INSERT (tenant_id, id, provider, status, account_label, account_ref, credentials, connected_by, connected_membership_id, connected_at, last_checked_at)
  ON public.integrations TO wms_app;
GRANT UPDATE (status, account_label, account_ref, credentials, connected_by, connected_membership_id, connected_at, last_checked_at, last_error_code)
  ON public.integrations TO wms_app;

GRANT SELECT ON public.integration_flows TO wms_app;
GRANT INSERT (tenant_id, id, integration_id, flow, enabled, direction) ON public.integration_flows TO wms_app;
GRANT UPDATE (enabled, direction, cursor, last_run_at, last_success_at, last_status, error_count, last_error_code) ON public.integration_flows TO wms_app;

GRANT SELECT ON public.integration_runs TO wms_app;
GRANT INSERT (tenant_id, id, integration_id, flow, trigger, requested_by) ON public.integration_runs TO wms_app;
GRANT UPDATE (status, created_count, updated_count, linked_count, skipped_count, failed_count, error_code) ON public.integration_runs TO wms_app;

GRANT SELECT ON public.integration_outbox TO wms_app;
GRANT INSERT (tenant_id, id, integration_id, flow, entity_type, entity_id) ON public.integration_outbox TO wms_app;
GRANT UPDATE (status, attempts, next_attempt_at, last_error_code, external_id) ON public.integration_outbox TO wms_app;

GRANT SELECT ON public.integration_stock_marks TO wms_app;
GRANT INSERT (tenant_id, integration_id, item_id, warehouse_id, quantity) ON public.integration_stock_marks TO wms_app;
GRANT UPDATE (quantity) ON public.integration_stock_marks TO wms_app;
