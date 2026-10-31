-- 0067_integration_webhooks (T-1138, B-110 notu; kullanıcı önceliği 30 Ekim: ürün/depo/cari kartları Paraşüt'ten Etkin'e ANINDA aksın):
-- Paraşüt webhook kaydı (model × eylem başına bir satır) ve bağlantıda anlık bildirim durumu. Tam katalog taraması 30 sn'den
-- uzlaştırma (15 dk kart, 3 dk depo) kademesine düşer; depolar Paraşüt webhook modelinde olmadığı için taramada kalır.
--
-- BİLİNÇLİ KARARLAR (inceleme için):
-- * İmza anahtarı (Paraşüt'ün verdiği ya da bizim ürettiğimiz "encryption key") YALNIZ mühürlü kutudur (`@wms/shared/seal`,
--   AAD = iş türü + sağlayıcı + tenant; 0055 `credentials` ile aynı CHECK şekli). Düz anahtar DB'ye yazılamaz. Kutu webhook satırındadır:
--   Paraşüt webhook başına anahtar verirse hepsi saklanır; doğrulama o tenant'ın bütün etkin anahtarlarını dener. Silinen kayıtta anahtar NULL.
-- * Alıcı uç herkese açıktır (`/api/integrations/parasut/webhook`); tenant, isteğin `company_id` alanından DEĞİL, bizim eşlememizden
--   (`integrations.account_ref`) bulunur ve imza o tenant'ın anahtarıyla doğrulanır. Bu arama tenant bağlamı olmadan yapılır:
--   yalnız dar SECURITY DEFINER işlev `wms_probe.integration_webhook_lookup` (0003/0038 SET ROLE kalıbı) — döndürdüğü tek şey
--   tenant/bağlantı kimliği ve mühürlü kutular; kutu tenant AAD'si olmadan açılmaz. `wms_identity_probe` yalnız bu sütunları okur.
-- * Teslim yükü (`data`) karta YAZILMAZ: iş kaydı Paraşüt'ten kimliğiyle yeniden okur (404 = kaynakta yok → mevcut yaşam döngüsü
--   kuralları, fiziksel silme yok). Tekrar teslim `processed_events` (I-07) + kuyruk singletonKey ile tek etkilidir.
-- * `wms_app` yalnız sütun düzeyi INSERT/UPDATE; DELETE yok (silinen webhook satırı DELETED olur). ENABLE + FORCE RLS (0055 metni).

ALTER TABLE public.integrations
  ADD COLUMN webhook_status          text        NOT NULL DEFAULT 'OFF',
  ADD COLUMN webhook_checked_at      timestamptz,
  ADD COLUMN webhook_last_event_at   timestamptz,
  ADD COLUMN webhook_last_error_code text,
  ADD CONSTRAINT integrations_webhook_status_chk CHECK (webhook_status IN ('OFF', 'ACTIVE', 'FAILED')),
  ADD CONSTRAINT integrations_webhook_error_chk CHECK (webhook_last_error_code IS NULL OR webhook_last_error_code ~ '^[A-Z][A-Z0-9_]{0,40}$');
GRANT UPDATE (webhook_status, webhook_checked_at, webhook_last_event_at, webhook_last_error_code) ON public.integrations TO wms_app;

CREATE TABLE public.integration_webhooks (
  tenant_id      uuid        NOT NULL,
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  integration_id uuid        NOT NULL,
  model          text        NOT NULL,
  action         text        NOT NULL,
  external_id    text        NOT NULL,
  key_box        jsonb,
  status         text        NOT NULL DEFAULT 'ACTIVE',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_webhooks_pkey PRIMARY KEY (id),
  CONSTRAINT integration_webhooks_tenant_id_id_key UNIQUE (tenant_id, id),
  -- Model × eylem başına tek kayıt (yeniden kayıt satırı günceller, çoğaltmaz).
  CONSTRAINT integration_webhooks_model_action_key UNIQUE (tenant_id, integration_id, model, action),
  CONSTRAINT integration_webhooks_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants (id),
  CONSTRAINT integration_webhooks_integration_fkey FOREIGN KEY (tenant_id, integration_id) REFERENCES public.integrations (tenant_id, id),
  CONSTRAINT integration_webhooks_model_chk CHECK (model IN ('product', 'contact')),
  CONSTRAINT integration_webhooks_action_chk CHECK (action IN ('create', 'update', 'delete')),
  CONSTRAINT integration_webhooks_external_chk CHECK (external_id ~ '^[0-9A-Za-z_-]{1,64}$'),
  CONSTRAINT integration_webhooks_status_chk CHECK (status IN ('ACTIVE', 'DELETED')),
  -- Bağlantı kesilince/silinince anahtar silinir (NULL): DELETED <=> anahtar yok.
  CONSTRAINT integration_webhooks_key_chk CHECK ((status = 'DELETED') = (key_box IS NULL)),
  CONSTRAINT integration_webhooks_key_sealed_chk CHECK (
    key_box IS NULL OR jsonb_typeof(key_box) = 'object'
    AND key_box ?& ARRAY['v', 'kid', 'iv', 'tag', 'ct']
    AND (key_box - 'v' - 'kid' - 'iv' - 'tag' - 'ct') = '{}'::jsonb
  )
);

CREATE FUNCTION public.integration_webhooks_on_update() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.integration_webhooks_on_update() FROM PUBLIC;
CREATE TRIGGER integration_webhooks_on_update BEFORE UPDATE ON public.integration_webhooks
  FOR EACH ROW EXECUTE FUNCTION public.integration_webhooks_on_update();

ALTER TABLE public.integration_webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_webhooks FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.integration_webhooks FROM PUBLIC;
CREATE POLICY integration_webhooks_isolation ON public.integration_webhooks
  USING      (tenant_id = NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid);
GRANT SELECT ON public.integration_webhooks TO wms_app;
GRANT INSERT (tenant_id, id, integration_id, model, action, external_id, key_box, status) ON public.integration_webhooks TO wms_app;
GRANT UPDATE (external_id, key_box, status) ON public.integration_webhooks TO wms_app;

-- Alıcı ucun tenant araması (bağlamsız): yalnız probe rolü, yalnız gerekli sütunlar (0003 `probe_select` kalıbı; permissive politikalar OR'lanır).
CREATE POLICY integrations_probe_select ON public.integrations FOR SELECT TO wms_identity_probe USING (true);
CREATE POLICY integration_webhooks_probe_select ON public.integration_webhooks FOR SELECT TO wms_identity_probe USING (true);
GRANT SELECT (tenant_id, id, provider, status, account_ref, webhook_status) ON public.integrations TO wms_identity_probe;
GRANT SELECT (tenant_id, integration_id, key_box, status) ON public.integration_webhooks TO wms_identity_probe;

GRANT CREATE ON SCHEMA wms_probe TO wms_identity_probe;
SET ROLE wms_identity_probe;
-- Şirket numarasına bağlı, bağlı (CONNECTED) ve anlık bildirimi etkin bağlantılar + mühürlü anahtar kutuları. Başka hiçbir sütun dönmez;
-- aynı şirkete bağlı birden çok tenant olabilir (her biri kendi anahtarıyla doğrulanır). En çok 5 satır.
CREATE FUNCTION wms_probe.integration_webhook_lookup(p_provider text, p_company_ref text)
RETURNS TABLE (tenant_id uuid, integration_id uuid, key_boxes jsonb)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_provider IS NULL OR p_provider !~ '^[A-Z]{1,16}$' OR p_company_ref IS NULL OR p_company_ref !~ '^[0-9]{1,12}$' THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT i.tenant_id, i.id,
           COALESCE((SELECT jsonb_agg(w.key_box) FROM public.integration_webhooks w
                      WHERE w.tenant_id = i.tenant_id AND w.integration_id = i.id AND w.status = 'ACTIVE'), '[]'::jsonb)
      FROM public.integrations i
     WHERE i.provider = p_provider AND i.account_ref = p_company_ref AND i.status = 'CONNECTED' AND i.webhook_status = 'ACTIVE'
     ORDER BY i.tenant_id
     LIMIT 5;
END
$fn$;
REVOKE ALL ON FUNCTION wms_probe.integration_webhook_lookup(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wms_probe.integration_webhook_lookup(text, text) TO wms_app;
RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;

-- Doğrulama (T-1138 inceleme MINOR-3; 0038 kalıbı): sahip, SECURITY DEFINER, search_path, PUBLIC'te EXECUTE yok, yalnız wms_app EXECUTE.
DO $verify$
DECLARE
  f text := 'wms_probe.integration_webhook_lookup(text, text)';
  r text;
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid = f::regprocedure
          AND p.proowner = pg_catalog.to_regrole('wms_identity_probe')
          AND p.prosecdef
          AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']
          AND p.proacl IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a WHERE a.grantee = 0)) THEN
    RAISE EXCEPTION '0067_integration_webhooks: % sahibi/SECURITY DEFINER/search_path/ACL beklenenden farklı', f;
  END IF;
  FOREACH r IN ARRAY ARRAY['wms_app', 'wms_auth', 'wms_worker', 'wms_ops'] LOOP
    IF pg_catalog.has_function_privilege(r, f, 'EXECUTE') <> (r = 'wms_app') THEN
      RAISE EXCEPTION '0067_integration_webhooks: % için % EXECUTE yetkisi beklenenden farklı', r, f;
    END IF;
  END LOOP;
END
$verify$;
