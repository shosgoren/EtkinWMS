-- Empty-database rollback only; never discard a durable deduplication decision.
DO $$ BEGIN
IF EXISTS (SELECT 1 FROM wms_platform.demo_email_reservations) OR EXISTS (SELECT 1 FROM wms_platform.demo_request_keys) THEN
RAISE EXCEPTION '0057 rollback requires empty demo ledgers';
END IF;
END $$;
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


RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;
