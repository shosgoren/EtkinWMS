-- Empty-database rollback only; never discard a durable deduplication decision.
DO $$ BEGIN
IF EXISTS (SELECT 1 FROM wms_platform.demo_status_deliveries) OR EXISTS (SELECT 1 FROM wms_platform.demo_email_reservations) OR EXISTS (SELECT 1 FROM wms_platform.demo_request_keys) THEN
RAISE EXCEPTION '0057 rollback requires empty demo ledgers';
END IF;
END $$;
DROP FUNCTION wms_probe.demo_status_consume(text,text);
DROP FUNCTION wms_probe.demo_delivery_finish(uuid);
DROP FUNCTION wms_probe.demo_delivery_claim();
DROP FUNCTION wms_probe.demo_submit(uuid,text,text,text,text,text,text,jsonb,jsonb);
DROP TABLE wms_platform.demo_status_deliveries;
DROP TRIGGER demo_email_reserve ON wms_platform.demo_requests;
DROP FUNCTION wms_probe.demo_email_reserve();
DROP TABLE wms_platform.demo_request_keys;
DROP TABLE wms_platform.demo_email_reservations;
GRANT CREATE ON SCHEMA wms_probe TO wms_identity_probe;
SET ROLE wms_identity_probe;
CREATE OR REPLACE FUNCTION wms_probe.platform_ingest_demo_request(
  p_id uuid, p_received_at timestamptz, p_name text, p_company text, p_email text, p_sector text, p_message text
) RETURNS boolean
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_n integer;
BEGIN
  IF p_id IS NULL OR p_received_at IS NULL THEN
    RAISE EXCEPTION 'platform_ingest_demo_request: kimlik ve zaman zorunlu' USING ERRCODE = '22023';
  END IF;
  IF p_received_at > pg_catalog.now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'platform_ingest_demo_request: gelecek tarihli kayıt' USING ERRCODE = '22023';
  END IF;
  INSERT INTO wms_platform.demo_requests (id, received_at, name, company, email, sector, message)
  VALUES (p_id, p_received_at, pg_catalog.btrim(p_name), pg_catalog.btrim(p_company), pg_catalog.lower(pg_catalog.btrim(p_email)),
          COALESCE(pg_catalog.btrim(p_sector), ''), COALESCE(pg_catalog.btrim(p_message), ''))
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END
$fn$;


CREATE OR REPLACE FUNCTION wms_probe.platform_issue_activation(p_id uuid, p_token_hash text, p_delivery text) RETURNS timestamptz
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_uid uuid;
  v_status text;
  v_activated timestamptz;
  v_expires timestamptz;
BEGIN
  IF NOT wms_probe.platform_is_operator() THEN
    RAISE EXCEPTION 'platform_issue_activation: operatör değil' USING ERRCODE = '42501';
  END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' OR p_delivery IS NULL OR p_delivery NOT IN ('EMAIL', 'SCREEN') THEN
    RAISE EXCEPTION 'platform_issue_activation: özet/teslim yolu biçimsiz' USING ERRCODE = '22023';
  END IF;
  v_uid := pg_catalog.current_setting('app.current_user_id', true)::uuid;
  SELECT d.status, d.activated_at INTO v_status, v_activated FROM wms_platform.demo_requests d WHERE d.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform_issue_activation: talep yok' USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'APPROVED' OR v_activated IS NOT NULL THEN
    RAISE EXCEPTION 'platform_issue_activation: talep onaylı ve etkinleşmemiş olmalı' USING ERRCODE = '55000';
  END IF;
  v_expires := pg_catalog.now() + interval '72 hours';
  UPDATE wms_platform.demo_requests
     SET activation_token_hash = p_token_hash, activation_delivery = p_delivery, activation_expires_at = v_expires,
         -- Talep kimliği KORUNUR (yalnız süresi biter): yarıda kalan denemenin açtığı hesap yeni bağlantıyla da kullanılır (inceleme M-1).
         activation_claim_expires_at = CASE WHEN activation_claim_id IS NULL THEN NULL ELSE pg_catalog.now() END
   WHERE id = p_id;
  INSERT INTO public.security_events (user_id, event_type, detail)
  VALUES (v_uid, 'platform.activation.issued',
          pg_catalog.jsonb_build_object('demo_request_id', p_id::text, 'delivery', p_delivery));
  RETURN v_expires;
END
$fn$;

-- Worker (yalnız wms_worker): e-postayla teslim bekleyen geçerli bağlantıya YENİ belirteç özeti yazar; alıcı ve firma adını döndürür.
-- Geçerli değilse satır dönmez (iş sessizce biter).
CREATE OR REPLACE FUNCTION wms_probe.platform_prepare_activation_delivery(p_id uuid, p_token_hash text)
RETURNS TABLE (email text, company text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'platform_prepare_activation_delivery: özet biçimsiz' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    WITH rotated AS (
      UPDATE wms_platform.demo_requests d
         SET activation_token_hash = p_token_hash
       WHERE d.id = p_id AND d.status = 'APPROVED' AND d.activation_delivery = 'EMAIL' AND d.activated_at IS NULL
         AND d.activation_expires_at > pg_catalog.now()
         -- Süren bir kurulum varken belirteç döndürülmez (inceleme M-1): devam eden aktivasyon bozulmaz.
         AND (d.activation_claim_expires_at IS NULL OR d.activation_claim_expires_at <= pg_catalog.now())
      RETURNING d.email AS r_email, d.company AS r_company)
    SELECT rotated.r_email, rotated.r_company FROM rotated;
END
$fn$;

RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;

ALTER TABLE wms_platform.demo_requests DROP COLUMN owner_link_issued_at;
