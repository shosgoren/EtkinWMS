-- 0047_panel_events (T-408, ADR-027 §9): panel işlem kaydı. G-08: yalnızca GENİŞLETME (bir işlev, bir kısmi dizin).
--
-- BİLİNÇLİ KARARLAR (inceleme için):
-- * KAYNAK `public.security_events` içindeki `platform.*` olaylarıdır (silinemez kayıt; yazanlar 0038–0046 probe işlevleri). Panel
--   okuması operatör denetimli `platform_list_events` ile (operatör değilse 42501); ayrıntı izinli anahtarlarla süzülür.
-- * DÖNEN BİLGİ SINIRLI: zaman, olay türü, operatör mü sistem mi (kullanıcı kimliği/e-postası DÖNMEZ), ilgili firma adı (tenant ya da demo
--   talebi), paket adı ve olay ayrıntısının yalnız izinli anahtarları (sürüm, yayın, dönem, adet, yöntem, gerekçe, deneme bitişi, teslim yolu).
--   IP, tarayıcı, istek kimliği ve diğer anahtarlar dönmez.
-- * Probe'a olay tablosunda yalnız SÜTUN düzeyinde okuma (id, zaman, kullanıcı var/yok, tür, ayrıntı); ip/user_agent/request_id yok.
-- * En yeni önce, en çok 200 satır.
-- Koşturucu tek transaction içinde çalıştırır.

DO $pre$
BEGIN
  IF pg_catalog.to_regprocedure('wms_probe.platform_site_public(text)') IS NULL THEN
    RAISE EXCEPTION '0047_panel_events: platform_site_public yok (0046 önkoşulu)';
  END IF;
END
$pre$;

CREATE INDEX security_events_platform_occurred_idx ON public.security_events (occurred_at DESC) WHERE event_type LIKE 'platform.%';
-- İşlevin okuması için sütun düzeyinde: IP, tarayıcı ve istek kimliği sütunlarına yetki VERİLMEZ.
GRANT SELECT (id, occurred_at, user_id, event_type, detail) ON public.security_events TO wms_identity_probe;

GRANT CREATE ON SCHEMA wms_probe TO wms_identity_probe;
SET ROLE wms_identity_probe;

-- Operatör: panel işlem kaydı (platform.* olayları), en yeni önce.
CREATE FUNCTION wms_probe.platform_list_events(p_limit integer)
RETURNS TABLE (at timestamptz, kind text, by_operator boolean, company text, plan text, info jsonb)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF NOT wms_probe.platform_is_operator() THEN
    RAISE EXCEPTION 'platform_list_events: operatör değil' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT e.occurred_at, e.event_type, e.user_id IS NOT NULL,
           coalesce(t.name, d.company), p.name,
           pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
             'version', e.detail -> 'version', 'published', e.detail -> 'published', 'period', e.detail -> 'period',
             'count', e.detail -> 'count', 'method', e.detail -> 'method', 'reason', e.detail -> 'reason',
             'trial_ends_at', e.detail -> 'trial_ends_at', 'delivery', e.detail -> 'delivery'))
      FROM public.security_events e
      LEFT JOIN public.tenants t ON t.id::text = e.detail ->> 'tenant_id'
      LEFT JOIN wms_platform.demo_requests d ON d.id::text = e.detail ->> 'demo_request_id'
      LEFT JOIN wms_platform.plans p ON p.id::text = e.detail ->> 'plan_id'
     WHERE e.event_type LIKE 'platform.%'
     ORDER BY e.occurred_at DESC, e.id DESC
     LIMIT LEAST(GREATEST(coalesce(p_limit, 100), 1), 200);
END
$fn$;

REVOKE ALL ON FUNCTION wms_probe.platform_list_events(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wms_probe.platform_list_events(integer) TO wms_app;

RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;

DO $verify$
DECLARE
  f text := 'wms_probe.platform_list_events(integer)';
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
    RAISE EXCEPTION '0047_panel_events: % sahibi/SECURITY DEFINER/search_path/ACL beklenenden farklı', f;
  END IF;
  FOREACH r IN ARRAY ARRAY['wms_app', 'wms_auth', 'wms_worker', 'wms_ops'] LOOP
    IF pg_catalog.has_function_privilege(r, f, 'EXECUTE') <> (r = 'wms_app') THEN
      RAISE EXCEPTION '0047_panel_events: % rolünün % EXECUTE yetkisi beklenenden farklı', r, f;
    END IF;
  END LOOP;
  IF pg_catalog.has_column_privilege('wms_identity_probe', 'public.security_events', 'ip', 'SELECT')
     OR pg_catalog.has_column_privilege('wms_identity_probe', 'public.security_events', 'user_agent', 'SELECT')
     OR pg_catalog.has_column_privilege('wms_identity_probe', 'public.security_events', 'request_id', 'SELECT') THEN
    RAISE EXCEPTION '0047_panel_events: probe olay tablosunda izinsiz sütun okuyabiliyor';
  END IF;
END
$verify$;
