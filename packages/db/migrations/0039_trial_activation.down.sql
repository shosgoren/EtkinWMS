-- 0039_trial_activation geri alma (G-08, ADR-015 §9): up'ın yarattığını ters sırayla kaldırır.
-- VERİ KAYBETTİRİR: abonelik satırı ya da verilmiş aktivasyon bağlantısı varsa yalnızca wms_meta.allow_destructive_down = 'on'
-- (WMS_ENV local|ci) iken çalışır (0038 ile aynı kural).
DO $guard$
BEGIN
  IF (EXISTS (SELECT 1 FROM wms_platform.subscriptions)
      OR EXISTS (SELECT 1 FROM wms_platform.demo_requests WHERE activation_token_hash IS NOT NULL))
     AND coalesce(pg_catalog.current_setting('wms_meta.allow_destructive_down', true), '') <> 'on' THEN
    RAISE EXCEPTION '0039_trial_activation down: abonelik ya da aktivasyon kaydı var; veri kaybettiren geri alma bu ortamda kapalı';
  END IF;
END
$guard$;

-- 0038 gövdesindeki listeyi yeniden kurmak için geçici CREATE (up ile aynı kalıp).
GRANT CREATE ON SCHEMA wms_probe TO wms_identity_probe;
SET ROLE wms_identity_probe;
DROP FUNCTION wms_probe.platform_activation_release(text, uuid);
DROP FUNCTION wms_probe.platform_workspace_name_taken(text, text);
DROP FUNCTION wms_probe.platform_tenant_subscription();
DROP FUNCTION wms_probe.platform_activation_consume(text, uuid, uuid, boolean);
DROP FUNCTION wms_probe.platform_activation_for_account_creation(text, uuid);
DROP FUNCTION wms_probe.platform_activation_claim(text);
DROP FUNCTION wms_probe.platform_activation_preview(text);
DROP FUNCTION wms_probe.platform_prepare_activation_delivery(uuid, text);
DROP FUNCTION wms_probe.platform_issue_activation(uuid, text, text);
DROP FUNCTION wms_probe.platform_demo_request_email(uuid);
-- Operatör listesi 0038 gövdesine döner.
DROP FUNCTION wms_probe.platform_list_demo_requests(integer);
CREATE FUNCTION wms_probe.platform_list_demo_requests(p_limit integer)
RETURNS TABLE (id uuid, received_at timestamptz, name text, company text, email text, sector text, message text,
               status text, decided_at timestamptz)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF NOT wms_probe.platform_is_operator() THEN
    RAISE EXCEPTION 'platform_list_demo_requests: operatör değil' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'platform_list_demo_requests: limit 1..200' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT d.id, d.received_at, d.name, d.company, d.email, d.sector, d.message, d.status, d.decided_at
      FROM wms_platform.demo_requests d
     ORDER BY (d.status = 'PENDING') DESC, d.received_at DESC, d.id
     LIMIT p_limit;
END
$fn$;
REVOKE ALL ON FUNCTION wms_probe.platform_list_demo_requests(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wms_probe.platform_list_demo_requests(integer) TO wms_app;
RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;

REVOKE UPDATE (activation_token_hash, activation_delivery, activation_expires_at, activation_claim_id, activation_claim_expires_at,
               activated_at, activation_sample) ON wms_platform.demo_requests FROM wms_identity_probe;
DROP TABLE wms_platform.subscriptions;
DROP INDEX wms_platform.demo_requests_activation_token_key;
ALTER TABLE wms_platform.demo_requests
  DROP CONSTRAINT demo_requests_activation_chk,
  DROP CONSTRAINT demo_requests_email_lower_chk,
  DROP COLUMN activation_sample,
  DROP COLUMN activated_at,
  DROP COLUMN activation_claim_expires_at,
  DROP COLUMN activation_claim_id,
  DROP COLUMN activation_expires_at,
  DROP COLUMN activation_delivery,
  DROP COLUMN activation_token_hash;
