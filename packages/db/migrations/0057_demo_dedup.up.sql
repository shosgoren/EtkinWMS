-- T-1025: preserve historical rows; reserve each normalized email permanently.
-- All writers (including ingestion) share this transaction-safe constraint.
LOCK TABLE wms_platform.demo_requests IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE wms_platform.demo_email_reservations (
  email_normalized text PRIMARY KEY,
  CONSTRAINT demo_email_reservations_normalized CHECK (email_normalized = lower(btrim(email_normalized)))
);
REVOKE ALL ON wms_platform.demo_email_reservations FROM PUBLIC;
INSERT INTO wms_platform.demo_email_reservations(email_normalized)
SELECT DISTINCT lower(btrim(email)) FROM wms_platform.demo_requests;
GRANT SELECT, INSERT ON wms_platform.demo_email_reservations TO wms_identity_probe;
CREATE TABLE wms_platform.demo_request_keys (id uuid PRIMARY KEY, digest bytea NOT NULL);
REVOKE ALL ON wms_platform.demo_request_keys FROM PUBLIC;
INSERT INTO wms_platform.demo_request_keys
SELECT id, sha256(convert_to(jsonb_build_array(name, company, lower(btrim(email)), sector, message)::text, 'UTF8'))
FROM wms_platform.demo_requests;
GRANT SELECT, INSERT ON wms_platform.demo_request_keys TO wms_identity_probe;

GRANT CREATE ON SCHEMA wms_probe TO wms_identity_probe;
SET ROLE wms_identity_probe;
CREATE FUNCTION wms_probe.demo_email_reserve() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE v_count integer;
BEGIN
  -- Serialize reused IDs before reserving an email; conflicting IDs cannot reserve another address.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(NEW.id::text, 5725));
  IF EXISTS (SELECT 1 FROM wms_platform.demo_requests WHERE id = NEW.id) THEN RETURN NULL; END IF;
  NEW.email := pg_catalog.lower(pg_catalog.btrim(NEW.email));
  INSERT INTO wms_platform.demo_email_reservations VALUES (NEW.email) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN RETURN NULL; END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION wms_probe.demo_email_reserve() FROM PUBLIC;
-- Existing narrow worker entry point: ID is the durable idempotency key.
CREATE OR REPLACE FUNCTION wms_probe.platform_ingest_demo_request(
  p_id uuid, p_received_at timestamptz, p_name text, p_company text, p_email text, p_sector text, p_message text
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE v_n integer; v_digest bytea; v_old bytea;
BEGIN
  IF p_id IS NULL OR p_received_at IS NULL OR p_received_at > pg_catalog.now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'invalid demo request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text, 5725));
  v_digest := sha256(convert_to(jsonb_build_array(btrim(p_name), btrim(p_company), lower(btrim(p_email)), COALESCE(btrim(p_sector), ''), COALESCE(btrim(p_message), ''))::text, 'UTF8'));
  SELECT digest INTO v_old FROM wms_platform.demo_request_keys WHERE id = p_id;
  IF FOUND THEN
    IF v_old IS DISTINCT FROM v_digest THEN
      RAISE EXCEPTION 'idempotency conflict' USING ERRCODE = '22023';
    END IF;
    RETURN false;
  END IF;
  INSERT INTO wms_platform.demo_request_keys VALUES (p_id, v_digest);
  INSERT INTO wms_platform.demo_requests(id, received_at, name, company, email, sector, message)
  VALUES(p_id, p_received_at, btrim(p_name), btrim(p_company), lower(btrim(p_email)), COALESCE(btrim(p_sector), ''), COALESCE(btrim(p_message), ''));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END
$fn$;
RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;
CREATE TRIGGER demo_email_reserve BEFORE INSERT ON wms_platform.demo_requests
FOR EACH ROW EXECUTE FUNCTION wms_probe.demo_email_reserve();
