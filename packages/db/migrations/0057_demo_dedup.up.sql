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
-- CREATE TRIGGER checks EXECUTE even for the table owner. The migration role
-- has SET but no INHERIT membership; this transaction-only grant is removed below.
DO $grant$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION wms_probe.demo_email_reserve() TO %I', session_user);
END $grant$;
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
SET ROLE wms_identity_probe;
DO $revoke$ BEGIN
  EXECUTE format('REVOKE EXECUTE ON FUNCTION wms_probe.demo_email_reserve() FROM %I', session_user);
END $revoke$;
RESET ROLE;

ALTER TABLE wms_platform.demo_requests ADD COLUMN owner_link_issued_at timestamptz;
GRANT UPDATE(owner_link_issued_at) ON wms_platform.demo_requests TO wms_identity_probe;

-- Owner verification outbox: ciphertext uses the existing queue sealer; only hashes are searchable.
CREATE TABLE wms_platform.demo_status_deliveries (
 id uuid PRIMARY KEY,
 email text NOT NULL,
 token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
 sealed jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
 consumed_at timestamptz,
 sent_at timestamptz,
 lease_until timestamptz,
 attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX demo_status_delivery_email ON wms_platform.demo_status_deliveries(email, created_at);
REVOKE ALL ON wms_platform.demo_status_deliveries FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON wms_platform.demo_status_deliveries TO wms_identity_probe;
GRANT CREATE ON SCHEMA wms_probe TO wms_identity_probe;
SET ROLE wms_identity_probe;
CREATE FUNCTION wms_probe.demo_submit(p_id uuid, p_name text, p_company text, p_email text, p_sector text, p_message text, p_hash text, p_sealed jsonb, p_legacy jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE v_new boolean; v_email text := lower(btrim(p_email)); v_replay boolean;
BEGIN
 IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' OR p_sealed IS NULL OR jsonb_typeof(p_sealed) <> 'object' OR octet_length(p_sealed::text)>8192 THEN
  RAISE EXCEPTION 'invalid verification payload' USING ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(5725,1025);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,5725));
 PERFORM pg_advisory_xact_lock(hashtextextended(v_email,5726));
 SELECT EXISTS(SELECT 1 FROM wms_platform.demo_request_keys WHERE id=p_id) INTO v_replay;
 -- The marketing server supplies a matching historical JSONL row, never visitor-provided JSON.
 IF p_legacy IS NOT NULL AND p_legacy <> 'null'::jsonb THEN
  IF lower(btrim(p_legacy->>'email')) IS DISTINCT FROM v_email THEN RAISE EXCEPTION 'legacy email mismatch' USING ERRCODE='22023'; END IF;
  PERFORM wms_probe.platform_ingest_demo_request((p_legacy->>'id')::uuid,(p_legacy->>'createdAt')::timestamptz,p_legacy->>'name',p_legacy->>'company',v_email,p_legacy->>'sector',p_legacy->>'message');
 END IF;
 v_new := wms_probe.platform_ingest_demo_request(p_id,now(),p_name,p_company,v_email,p_sector,p_message);
 -- Retries never create another email. New requests are rate limited persistently per address.
 IF NOT v_replay AND NOT EXISTS(SELECT 1 FROM wms_platform.demo_status_deliveries WHERE email=v_email AND created_at > now()-interval '15 minutes')
 AND (SELECT count(*) FROM wms_platform.demo_status_deliveries WHERE email=v_email AND created_at>now()-interval '1 day')<3
 AND (SELECT count(*) FROM wms_platform.demo_status_deliveries WHERE created_at>now()-interval '1 hour')<100 THEN
  INSERT INTO wms_platform.demo_status_deliveries(id,email,token_hash,sealed) VALUES(p_id,v_email,p_hash,p_sealed);
 END IF;
 RETURN v_new;
END
$fn$;
CREATE FUNCTION wms_probe.demo_delivery_claim() RETURNS TABLE(id uuid,sealed jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
BEGIN
 RETURN QUERY WITH picked AS (
  SELECT d.id FROM wms_platform.demo_status_deliveries d WHERE d.sent_at IS NULL AND d.expires_at>now()
  AND d.attempts<5 AND (d.lease_until IS NULL OR d.lease_until<now()) ORDER BY d.created_at LIMIT 10 FOR UPDATE SKIP LOCKED
 ), updated AS (
  UPDATE wms_platform.demo_status_deliveries d SET lease_until=now()+interval '2 minutes',attempts=attempts+1
  FROM picked WHERE d.id=picked.id RETURNING d.id,d.sealed
 ) SELECT * FROM updated;
END
$fn$;
CREATE FUNCTION wms_probe.demo_delivery_finish(p_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
 UPDATE wms_platform.demo_status_deliveries SET sent_at=COALESCE(sent_at,now()) WHERE id=p_id;
$fn$;
CREATE FUNCTION wms_probe.demo_status_consume(p_hash text,p_activation_hash text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE v_email text; v_request wms_platform.demo_requests%ROWTYPE;
BEGIN
 IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' OR p_activation_hash IS NULL OR p_activation_hash !~ '^[0-9a-f]{64}$' THEN RETURN 'invalid'; END IF;
 UPDATE wms_platform.demo_status_deliveries SET consumed_at=now()
 WHERE token_hash=p_hash AND consumed_at IS NULL AND expires_at>now() RETURNING email INTO v_email;
 IF NOT FOUND THEN RETURN 'invalid'; END IF;
 -- Legacy duplicates remain intact; an activated record takes precedence over pending copies.
 SELECT * INTO v_request FROM wms_platform.demo_requests WHERE lower(btrim(email))=v_email
 ORDER BY (activated_at IS NOT NULL) DESC,(status='APPROVED') DESC,received_at DESC,id LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN RETURN 'invalid'; END IF;
 IF v_request.activated_at IS NOT NULL THEN RETURN 'ready'; END IF;
 IF v_request.status <> 'APPROVED' THEN RETURN 'pending'; END IF;
 -- Never interrupt an activation already in progress; its existing link remains usable.
 IF v_request.activation_claim_expires_at>now() THEN RETURN 'in_progress'; END IF;
 UPDATE wms_platform.demo_requests SET owner_link_issued_at=now(),activation_token_hash=p_activation_hash,activation_delivery='EMAIL',activation_expires_at=now()+interval '15 minutes',
 activation_claim_expires_at=CASE WHEN activation_claim_id IS NULL THEN NULL ELSE now() END WHERE id=v_request.id;
 INSERT INTO public.security_events(event_type,detail) VALUES('platform.demo_owner.verified',jsonb_build_object('demo_request_id',v_request.id));
 RETURN 'setup';
END
$fn$;
REVOKE ALL ON FUNCTION wms_probe.demo_submit(uuid,text,text,text,text,text,text,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.demo_delivery_claim() FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.demo_delivery_finish(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.demo_status_consume(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wms_probe.demo_submit(uuid,text,text,text,text,text,text,jsonb,jsonb),wms_probe.demo_status_consume(text,text) TO wms_app;
GRANT EXECUTE ON FUNCTION wms_probe.demo_delivery_claim(),wms_probe.demo_delivery_finish(uuid) TO wms_worker;
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
     SET owner_link_issued_at = NULL, activation_token_hash = p_token_hash, activation_delivery = p_delivery, activation_expires_at = v_expires,
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
         AND d.owner_link_issued_at IS NULL
         AND d.activation_expires_at > pg_catalog.now()
         -- Süren bir kurulum varken belirteç döndürülmez (inceleme M-1): devam eden aktivasyon bozulmaz.
         AND (d.activation_claim_expires_at IS NULL OR d.activation_claim_expires_at <= pg_catalog.now())
      RETURNING d.email AS r_email, d.company AS r_company)
    SELECT rotated.r_email, rotated.r_company FROM rotated;
END
$fn$;

RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;
