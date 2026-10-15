-- 0038_demo_requests (T-994, ADR-026 §3): satış sitesi demo talepleri platform tablosunda; YALNIZ platform operatörü listeler ve
-- onaylar/reddeder. G-08: yalnızca GENİŞLETME (yeni şema + iki tablo + üç işlev).
--
-- BİLİNÇLİ KARARLAR (inceleme için):
-- * AYRI ŞEMA (`wms_platform`), `public` DEĞİL ve hiçbir uygulama rolüne tablo yetkisi YOK: talepler kişisel veri (ad, firma, e-posta,
--   mesaj) taşır ve tenant'a ait değildir. Erişim yalnızca aşağıdaki SECURITY DEFINER işlevleriyle (sahibi wms_identity_probe,
--   ADR-015 SET ROLE kalıbı, sabit search_path, gövde şema nitelikli). `public` drift testi etkilenmez.
-- * OPERATÖR VERİTABANINDA ZORLANIR: `wms_platform.operators` (normalize e-posta). İşlev çağıranı transaction-yerel
--   `app.current_user_id`'den (withUser) okur, `users.email` ile eşler; listede değilse 42501. Uygulama koduna "operatör mü" kararını
--   bırakmaz (ortam değişkeni ya da kod hatası operatör yetkisi vermez). Operatör eklemek/çıkarmak migration'dır (git kaydı).
--   Operatör hesabında iki adımlı doğrulama KURULU olmalıdır (`users.two_factor_enabled`): yönetici kaynaklı parola sıfırlama
--   bağlantısı tek başına operatörlüğü devralamaz (inceleme m-4; işletim kuralı: operatör hesabı müşteri alanına üye yapılmaz).
--   Oturum düzeyi MFA ve yakın zamanda doğrulama (A-39) uygulama katmanında ayrıca zorunludur.
-- * İÇE ALMA (`platform_ingest_demo_request`): worker satış sitesinin JSONL kaydını okur ve bu işlevle ekler. Kimlik satış sitesinin
--   ürettiği uuid'dir; aynı kayıt ikinci kez gelirse eklenmez (idempotent). Uzunluklar satış sitesindeki doğrulamayla aynı sınırlarla
--   yeniden denetlenir. EXECUTE yalnızca wms_worker (worker'ın kuyruk bağlantısı; web katmanı talep ekleyemez — inceleme m-2,
--   active_tenant_ids emsali). Eklenen talep her zaman PENDING'dir.
-- * KARAR (`platform_decide_demo_request`): yalnızca PENDING → APPROVED | REJECTED; karar zamanı veritabanı saati, karar veren çağıran
--   kullanıcı. Aynı transaction'da `security_events` satırı (`platform.demo_request.approved|rejected`, kişisel veri yok: yalnız
--   talep kimliği) yazılır; audit_logs tenant'a bağlı olduğu için kullanılmaz. Kimlik olayı öneklerine girmez (0005 tetikleyicisi).
-- * Aktivasyon bağlantısı ve tenant kurulumu bu migration'da YOK (T-995).
-- Koşturucu tek transaction içinde çalıştırır.

DO $pre$
DECLARE
  r text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'wms_probe') THEN
    RAISE EXCEPTION '0038_demo_requests: wms_probe şeması yok (0003_tenancy önkoşulu)';
  END IF;
  IF pg_catalog.to_regclass('public.users') IS NULL OR pg_catalog.to_regclass('public.security_events') IS NULL THEN
    RAISE EXCEPTION '0038_demo_requests: users/security_events tabloları yok (0002 önkoşulu)';
  END IF;
  FOREACH r IN ARRAY ARRAY['wms_app', 'wms_auth', 'wms_worker', 'wms_ops', 'wms_identity_probe'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = r) THEN
      RAISE EXCEPTION '0038_demo_requests: % rolü yok (altyapı adımı)', r;
    END IF;
  END LOOP;
END
$pre$;

-- ---------------------------------------------------------------------------------------------
-- 1. Şema ve tablolar (uygulama rollerine yetki YOK)
-- ---------------------------------------------------------------------------------------------
CREATE SCHEMA wms_platform;
REVOKE ALL ON SCHEMA wms_platform FROM PUBLIC;

CREATE TABLE wms_platform.operators (
  email_normalized text        NOT NULL,
  added_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operators_pkey PRIMARY KEY (email_normalized),
  CONSTRAINT operators_email_chk CHECK (email_normalized = pg_catalog.lower(pg_catalog.btrim(email_normalized))
                                        AND email_normalized ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' AND char_length(email_normalized) <= 254)
);

CREATE TABLE wms_platform.demo_requests (
  id          uuid        NOT NULL,
  received_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  name        text        NOT NULL,
  company     text        NOT NULL,
  email       text        NOT NULL,
  sector      text        NOT NULL DEFAULT '',
  message     text        NOT NULL DEFAULT '',
  status      text        NOT NULL DEFAULT 'PENDING',
  decided_at  timestamptz,
  decided_by  uuid,
  CONSTRAINT demo_requests_pkey PRIMARY KEY (id),
  CONSTRAINT demo_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.users (id),
  CONSTRAINT demo_requests_status_chk CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  CONSTRAINT demo_requests_decision_chk CHECK ((status = 'PENDING') = (decided_at IS NULL AND decided_by IS NULL)),
  CONSTRAINT demo_requests_len_chk CHECK (
    char_length(btrim(name)) BETWEEN 1 AND 100 AND char_length(btrim(company)) BETWEEN 1 AND 150
    AND char_length(email) BETWEEN 3 AND 254 AND email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
    AND char_length(sector) <= 100 AND char_length(message) <= 2000)
);
CREATE INDEX demo_requests_status_received_idx ON wms_platform.demo_requests (status, received_at DESC);

REVOKE ALL ON wms_platform.operators FROM PUBLIC;
REVOKE ALL ON wms_platform.demo_requests FROM PUBLIC;

-- İlk operatör (kullanıcı kararı 15 Ekim 2026: "benim onayım ile açılmalı"; Etkin Yazılım hesabı).
INSERT INTO wms_platform.operators (email_normalized) VALUES ('hosgorens@gmail.com');

-- İşlev sahibi (probe) yalnız işlevlerin ihtiyacı kadar: operatör listesi okuma, talep ekleme/okuma, yalnız karar sütunlarını güncelleme,
-- security_events'e yalnız kullanıcı/olay/ayrıntı sütunlarıyla ekleme.
GRANT USAGE ON SCHEMA wms_platform TO wms_identity_probe;
GRANT SELECT ON wms_platform.operators TO wms_identity_probe;
GRANT SELECT, INSERT ON wms_platform.demo_requests TO wms_identity_probe;
GRANT UPDATE (status, decided_at, decided_by) ON wms_platform.demo_requests TO wms_identity_probe;
GRANT INSERT (user_id, event_type, detail) ON public.security_events TO wms_identity_probe;

-- ---------------------------------------------------------------------------------------------
-- 2. İşlevler (SET ROLE kalıbı, 0014 ile aynı)
-- ---------------------------------------------------------------------------------------------
GRANT CREATE ON SCHEMA wms_probe TO wms_identity_probe;

SET ROLE wms_identity_probe;

-- Çağıran platform operatörü mü (transaction-yerel kullanıcı kimliği → e-posta → operatör listesi). Bağlam yoksa false.
CREATE FUNCTION wms_probe.platform_is_operator() RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_raw text := pg_catalog.current_setting('app.current_user_id', true);
  v_uid uuid;
BEGIN
  IF v_raw IS NULL OR v_raw !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN false;
  END IF;
  v_uid := v_raw::uuid;
  RETURN EXISTS (
    SELECT 1 FROM public.users u
      JOIN wms_platform.operators o ON o.email_normalized = pg_catalog.lower(pg_catalog.btrim(u.email))
     WHERE u.id = v_uid AND u.email_verified AND u.two_factor_enabled);
END
$fn$;

CREATE FUNCTION wms_probe.platform_ingest_demo_request(
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

CREATE FUNCTION wms_probe.platform_decide_demo_request(p_id uuid, p_decision text) RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_uid uuid;
  v_status text;
BEGIN
  IF NOT wms_probe.platform_is_operator() THEN
    RAISE EXCEPTION 'platform_decide_demo_request: operatör değil' USING ERRCODE = '42501';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'platform_decide_demo_request: karar APPROVED|REJECTED' USING ERRCODE = '22023';
  END IF;
  v_uid := pg_catalog.current_setting('app.current_user_id', true)::uuid;
  SELECT d.status INTO v_status FROM wms_platform.demo_requests d WHERE d.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform_decide_demo_request: talep yok' USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'PENDING' THEN
    RAISE EXCEPTION 'platform_decide_demo_request: talep zaten karara bağlandı (%)', v_status USING ERRCODE = '55000';
  END IF;
  UPDATE wms_platform.demo_requests SET status = p_decision, decided_at = pg_catalog.now(), decided_by = v_uid WHERE id = p_id;
  INSERT INTO public.security_events (user_id, event_type, detail)
  VALUES (v_uid, CASE p_decision WHEN 'APPROVED' THEN 'platform.demo_request.approved' ELSE 'platform.demo_request.rejected' END,
          pg_catalog.jsonb_build_object('demo_request_id', p_id::text));
  RETURN p_decision;
END
$fn$;

REVOKE ALL ON FUNCTION wms_probe.platform_is_operator() FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.platform_ingest_demo_request(uuid, timestamptz, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.platform_list_demo_requests(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.platform_decide_demo_request(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wms_probe.platform_is_operator() TO wms_app;
GRANT EXECUTE ON FUNCTION wms_probe.platform_ingest_demo_request(uuid, timestamptz, text, text, text, text, text) TO wms_worker;
GRANT EXECUTE ON FUNCTION wms_probe.platform_list_demo_requests(integer) TO wms_app;
GRANT EXECUTE ON FUNCTION wms_probe.platform_decide_demo_request(uuid, text) TO wms_app;

RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;

-- ---------------------------------------------------------------------------------------------
-- 3. security_events: `platform.*` olaylarını yalnız işlev sahibi yazar (inceleme m-1; 0007 gövdesi + yeni önek kuralı)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.security_events_restrict_identity_writers() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF pg_catalog.lower(NEW.event_type) ~ '^(login_|logout|password[_.]|two_factor_|reauth[_.]|session[_.]|mfa[_.]|account[_.]|password_reset_link[_.]|demo\.(account|password)[_.])'
     AND current_user::text <> 'wms_auth' THEN
    RAISE EXCEPTION 'security_events: kimlik olayı (%) yalnızca wms_auth tarafından yazılabilir', NEW.event_type
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF pg_catalog.lower(NEW.event_type) ~ '^platform[_.]' AND current_user::text <> 'wms_identity_probe' THEN
    RAISE EXCEPTION 'security_events: platform olayı (%) yalnızca platform işlevleriyle yazılabilir', NEW.event_type
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$fn$;

-- ---------------------------------------------------------------------------------------------
-- 4. Doğrulama
-- ---------------------------------------------------------------------------------------------
DO $verify$
DECLARE
  f text;
  r text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'wms_probe.platform_is_operator()',
    'wms_probe.platform_ingest_demo_request(uuid, timestamptz, text, text, text, text, text)',
    'wms_probe.platform_list_demo_requests(integer)',
    'wms_probe.platform_decide_demo_request(uuid, text)'] LOOP
    IF NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_proc p
          WHERE p.oid = f::regprocedure
            AND p.proowner = pg_catalog.to_regrole('wms_identity_probe')
            AND p.prosecdef
            AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']
            AND p.proacl IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a WHERE a.grantee = 0)) THEN
      RAISE EXCEPTION '0038_demo_requests: % sahibi/SECURITY DEFINER/search_path/ACL beklenenden farklı', f;
    END IF;
    FOREACH r IN ARRAY ARRAY['wms_app', 'wms_auth', 'wms_worker', 'wms_ops'] LOOP
      IF pg_catalog.has_function_privilege(r, f, 'EXECUTE')
         <> (r = CASE WHEN f LIKE '%platform_ingest_demo_request%' THEN 'wms_worker' ELSE 'wms_app' END) THEN
        RAISE EXCEPTION '0038_demo_requests: % rolünün % EXECUTE yetkisi beklenenden farklı', r, f;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['wms_app', 'wms_auth', 'wms_worker', 'wms_ops'] LOOP
    IF pg_catalog.has_schema_privilege(r, 'wms_platform', 'USAGE')
       OR pg_catalog.has_table_privilege(r, 'wms_platform.demo_requests', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       OR pg_catalog.has_table_privilege(r, 'wms_platform.operators', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') THEN
      RAISE EXCEPTION '0038_demo_requests: % wms_platform üzerinde yetki taşımamalı', r;
    END IF;
  END LOOP;
  IF pg_catalog.has_table_privilege('wms_identity_probe', 'wms_platform.operators', 'INSERT, UPDATE, DELETE, TRUNCATE')
     OR pg_catalog.has_table_privilege('wms_identity_probe', 'wms_platform.demo_requests', 'DELETE, TRUNCATE')
     OR pg_catalog.has_column_privilege('wms_identity_probe', 'wms_platform.demo_requests', 'email', 'UPDATE')
     OR pg_catalog.has_schema_privilege('wms_identity_probe', 'wms_probe', 'CREATE') THEN
    RAISE EXCEPTION '0038_demo_requests: wms_identity_probe yetkisi beklenenden geniş';
  END IF;
  IF NOT pg_catalog.has_schema_privilege('wms_worker', 'wms_probe', 'USAGE') THEN
    RAISE EXCEPTION '0038_demo_requests: wms_worker wms_probe şemasında USAGE taşımalı (0014)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid = 'public.security_events_restrict_identity_writers()'::regprocedure AND prosecdef) THEN
    RAISE EXCEPTION '0038_demo_requests: tetikleyici işlevi SECURITY INVOKER olmalı';
  END IF;
END
$verify$;
