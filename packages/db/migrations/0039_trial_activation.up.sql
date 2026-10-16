-- 0039_trial_activation (T-995, ADR-026 §3.3–3.5): onaylı demo talebinden tek kullanımlık aktivasyon bağlantısı ile 3 aylık deneme
-- alanı. G-08: yalnızca GENİŞLETME (demo_requests'e aktivasyon sütunları, abonelik tablosu, on yeni işlev; operatör listesi
-- aktivasyon durumunu da döndürecek biçimde yeniden tanımlanır).
--
-- BİLİNÇLİ KARARLAR (inceleme için):
-- * BELİRTEÇ YALNIZ ÖZETİYLE: `activation_token_hash` küçük harf hex SHA-256 (64 karakter). Düz belirteç DB'ye, kuyruğa ya da loga yazılmaz.
--   E-postayla teslimde (`EMAIL`) operatörün yazdığı değer hiçbir belirteçle eşleşmeyen yer tutucunun özetidir; gerçek belirteci worker
--   üretir (`platform_prepare_activation_delivery`, yalnız wms_worker) ve özetini yazar (davet deseni, A-42). Ekranda teslimde (`SCREEN`)
--   belirteci web üretir, düz değer yalnız operatöre bir kez döner.
-- * 72 SAAT, TEK KULLANIM: süre veritabanı saatinden (`now()`). Aktivasyon tamamlanınca `activated_at` dolar; tamamlanmış talebe yeni
--   bağlantı verilemez. Operatör süresi geçen/teslim edilemeyen bağlantıyı yeniden verebilir (eski özet geçersiz olur).
-- * HESAP AÇMA DAVET DESENİNDE (T-117 m8): (1) `platform_activation_claim` talep yazar (10 dk), (2) wms_auth hesabı yalnız talep eşleşirse
--   açar (`platform_activation_for_account_creation`; e-posta ve ad PARAMETRE DEĞİL, talepten okunur), (3) tenant kurulumu ile aynı
--   transaction'da `platform_activation_consume` talebi tüketir. Süresi dolmuş talebin kimliği korunur: yarıda kalan deneme aynı hesabı
--   yeniden kullanır.
-- * DENEME KAYDI PLATFORM TABLOSUNDA (`wms_platform.subscriptions`, tenant başına tek satır): `plan = 'TRIAL'`, `trial_ends_at =
--   now() + 3 ay` yalnız tüketme işlevinde yazılır. `public.tenants` DEĞİŞMEZ: probe tenant tablolarında yalnız okur (0003 ilkesi,
--   with-membership MINOR-1 testi) ve paket/ödeme bilgisi ADR-027 gereği platform tarafındadır (T-404/T-405 bu tabloyu genişletir).
--   Uygulama ve worker kendi tenant'ının kaydını yalnız `platform_tenant_subscription()` ile okur; hiçbir rol tabloya yazamaz.
-- * TÜKETME KİMİN TENANT'I: işlev çağıranın transaction-yerel tenant bağlamı = verilen tenant olmalı; tenant'ı oluşturan kullanıcının
--   e-postası talep e-postasıyla aynı ve o kullanıcı tenant'ın sahip üyesi olmalı. Başka tenant'a ya da başka hesaba deneme bağlanamaz.
-- * GÜVENLİK OLAYLARI yalnız kimliklerle: `platform.activation.issued` (talep + teslim yolu), `platform.demo_request.activated` (talep +
--   tenant). Kişisel veri yok. Yazan probe (0038 tetikleyici kuralı).
-- Koşturucu tek transaction içinde çalıştırır.

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('wms_platform.demo_requests') IS NULL THEN
    RAISE EXCEPTION '0039_trial_activation: wms_platform.demo_requests yok (0038 önkoşulu)';
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------------------------
-- 1. Sütunlar
-- ---------------------------------------------------------------------------------------------
ALTER TABLE wms_platform.demo_requests
  ADD COLUMN activation_token_hash       text,
  ADD COLUMN activation_delivery         text,
  ADD COLUMN activation_expires_at       timestamptz,
  ADD COLUMN activation_claim_id         uuid,
  ADD COLUMN activation_claim_expires_at timestamptz,
  ADD COLUMN activated_at                timestamptz,
  ADD COLUMN activation_sample           boolean,
  ADD CONSTRAINT demo_requests_activation_chk CHECK (
    (activation_token_hash IS NULL OR (status = 'APPROVED' AND activation_token_hash ~ '^[0-9a-f]{64}$'))
    AND ((activation_token_hash IS NULL) = (activation_delivery IS NULL))
    AND ((activation_token_hash IS NULL) = (activation_expires_at IS NULL))
    AND (activation_delivery IS NULL OR activation_delivery IN ('EMAIL', 'SCREEN'))
    AND ((activation_claim_id IS NULL) = (activation_claim_expires_at IS NULL))
    AND (activation_claim_id IS NULL OR activation_token_hash IS NOT NULL)
    AND ((activated_at IS NULL) = (activation_sample IS NULL))
    AND (activated_at IS NULL OR activation_token_hash IS NOT NULL));
-- E-posta küçük harf ve kırpılmış (ingest zaten böyle yazar; tüketme karşılaştırması buna dayanır — inceleme nit).
ALTER TABLE wms_platform.demo_requests ADD CONSTRAINT demo_requests_email_lower_chk CHECK (email = pg_catalog.lower(pg_catalog.btrim(email)));
CREATE UNIQUE INDEX demo_requests_activation_token_key ON wms_platform.demo_requests (activation_token_hash)
  WHERE activation_token_hash IS NOT NULL;

CREATE TABLE wms_platform.subscriptions (
  tenant_id       uuid        NOT NULL,
  plan            text        NOT NULL,
  trial_ends_at   timestamptz,
  started_at      timestamptz NOT NULL DEFAULT now(),
  demo_request_id uuid,
  CONSTRAINT subscriptions_pkey PRIMARY KEY (tenant_id),
  CONSTRAINT subscriptions_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants (id),
  CONSTRAINT subscriptions_demo_request_fkey FOREIGN KEY (demo_request_id) REFERENCES wms_platform.demo_requests (id),
  CONSTRAINT subscriptions_demo_request_key UNIQUE (demo_request_id),
  CONSTRAINT subscriptions_plan_chk CHECK (plan IN ('TRIAL')),
  CONSTRAINT subscriptions_trial_chk CHECK ((plan = 'TRIAL') = (trial_ends_at IS NOT NULL AND trial_ends_at > started_at))
);
REVOKE ALL ON wms_platform.subscriptions FROM PUBLIC;

-- Probe: talepte yalnız aktivasyon sütunları; abonelikte yalnız okuma + ekleme (güncelleme/silme yok).
GRANT UPDATE (activation_token_hash, activation_delivery, activation_expires_at, activation_claim_id, activation_claim_expires_at,
              activated_at, activation_sample) ON wms_platform.demo_requests TO wms_identity_probe;
GRANT SELECT, INSERT ON wms_platform.subscriptions TO wms_identity_probe;

-- ---------------------------------------------------------------------------------------------
-- 2. İşlevler (SET ROLE kalıbı, 0038 ile aynı)
-- ---------------------------------------------------------------------------------------------
GRANT CREATE ON SCHEMA wms_probe TO wms_identity_probe;

SET ROLE wms_identity_probe;

-- Operatör listesi aktivasyon durumuyla (0038 sürümünün yerine; aynı yetki kuralı). Belirteç ve özet DÖNMEZ.
DROP FUNCTION wms_probe.platform_list_demo_requests(integer);
CREATE FUNCTION wms_probe.platform_list_demo_requests(p_limit integer)
RETURNS TABLE (id uuid, received_at timestamptz, name text, company text, email text, sector text, message text,
               status text, decided_at timestamptz, activation_delivery text, activation_expires_at timestamptz,
               activated_at timestamptz)
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
    SELECT d.id, d.received_at, d.name, d.company, d.email, d.sector, d.message, d.status, d.decided_at,
           d.activation_delivery, d.activation_expires_at, d.activated_at
      FROM wms_platform.demo_requests d
     ORDER BY (d.status = 'PENDING') DESC, d.received_at DESC, d.id
     LIMIT p_limit;
END
$fn$;

-- Operatör: onaylanacak/onaylanmış talebin e-postası (teslim yolu seçimi için; `canDeliver` uygulamada).
CREATE FUNCTION wms_probe.platform_demo_request_email(p_id uuid) RETURNS text
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_email text;
BEGIN
  IF NOT wms_probe.platform_is_operator() THEN
    RAISE EXCEPTION 'platform_demo_request_email: operatör değil' USING ERRCODE = '42501';
  END IF;
  SELECT d.email INTO v_email FROM wms_platform.demo_requests d WHERE d.id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform_demo_request_email: talep yok' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_email;
END
$fn$;

-- Operatör: onaylı ve henüz etkinleşmemiş talebe aktivasyon bağlantısı (ilk kez ya da yeniden). Eski özet ve talep geçersiz olur.
CREATE FUNCTION wms_probe.platform_issue_activation(p_id uuid, p_token_hash text, p_delivery text) RETURNS timestamptz
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
CREATE FUNCTION wms_probe.platform_prepare_activation_delivery(p_id uuid, p_token_hash text)
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

-- Aktivasyon ekranı önizlemesi (oturumsuz, wms_app): geçerli bağlantı için firma, e-posta, süre ve teslim yolu. Yoksa satır yok.
CREATE FUNCTION wms_probe.platform_activation_preview(p_token_hash text)
RETURNS TABLE (company text, email text, expires_at timestamptz, delivery text)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT d.company, d.email, d.activation_expires_at, d.activation_delivery
      FROM wms_platform.demo_requests d
     WHERE d.activation_token_hash = p_token_hash AND d.status = 'APPROVED' AND d.activated_at IS NULL
       AND d.activation_expires_at > pg_catalog.now();
END
$fn$;

-- Hesap açma talebi (wms_app): geçerli talep varken ikinci talep 55000; süresi dolmuş talebin kimliği korunur.
CREATE FUNCTION wms_probe.platform_activation_claim(p_token_hash text) RETURNS uuid
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id uuid;
  v_claim uuid;
  v_claim_exp timestamptz;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'platform_activation_claim: bağlantı geçersiz' USING ERRCODE = 'P0002';
  END IF;
  SELECT d.id, d.activation_claim_id, d.activation_claim_expires_at INTO v_id, v_claim, v_claim_exp
    FROM wms_platform.demo_requests d
   WHERE d.activation_token_hash = p_token_hash AND d.status = 'APPROVED' AND d.activated_at IS NULL
     AND d.activation_expires_at > pg_catalog.now()
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform_activation_claim: bağlantı geçersiz' USING ERRCODE = 'P0002';
  END IF;
  -- Operatör adresiyle müşteri hesabı açılmaz (inceleme m-4): operatör hesabı müşteri alanına üye yapılmaz (0038 işletim kuralı).
  IF EXISTS (SELECT 1 FROM wms_platform.demo_requests d JOIN wms_platform.operators o ON o.email_normalized = d.email WHERE d.id = v_id) THEN
    RAISE EXCEPTION 'platform_activation_claim: bağlantı geçersiz' USING ERRCODE = 'P0002';
  END IF;
  IF v_claim IS NOT NULL AND v_claim_exp > pg_catalog.now() THEN
    RAISE EXCEPTION 'platform_activation_claim: başka bir deneme sürüyor' USING ERRCODE = '55000';
  END IF;
  v_claim := COALESCE(v_claim, pg_catalog.gen_random_uuid());
  UPDATE wms_platform.demo_requests
     SET activation_claim_id = v_claim, activation_claim_expires_at = pg_catalog.now() + interval '10 minutes'
   WHERE id = v_id;
  RETURN v_claim;
END
$fn$;

-- Hesap açma (yalnız wms_auth): talep eşleşir ve süresi dolmadıysa e-posta, ad ve teslim yolu. Başka sütun yok.
CREATE FUNCTION wms_probe.platform_activation_for_account_creation(p_token_hash text, p_claim_id uuid)
RETURNS TABLE (email_normalized text, name text, delivered_via text)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RETURN QUERY
    SELECT d.email, d.name, d.activation_delivery
      FROM wms_platform.demo_requests d
     WHERE d.activation_token_hash = p_token_hash AND d.activation_claim_id = p_claim_id
       AND d.activation_claim_expires_at > pg_catalog.now()
       AND d.status = 'APPROVED' AND d.activated_at IS NULL AND d.activation_expires_at > pg_catalog.now();
END
$fn$;

-- Tüketme (wms_app, yeni tenant'ın transaction'ında): talebi tenant'a bağlar, denemeyi başlatır. Bitiş tarihini döndürür.
CREATE FUNCTION wms_probe.platform_activation_consume(p_token_hash text, p_claim_id uuid, p_tenant_id uuid, p_sample boolean)
RETURNS timestamptz
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_ctx text := pg_catalog.current_setting('app.current_tenant_id', true);
  v_id uuid;
  v_email text;
  v_owner_email text;
  v_trial timestamptz;
BEGIN
  IF p_tenant_id IS NULL OR p_sample IS NULL OR v_ctx IS NULL OR v_ctx = '' OR v_ctx <> p_tenant_id::text THEN
    RAISE EXCEPTION 'platform_activation_consume: tenant bağlamı eşleşmiyor' USING ERRCODE = '42501';
  END IF;
  SELECT d.id, d.email INTO v_id, v_email
    FROM wms_platform.demo_requests d
   WHERE d.activation_token_hash = p_token_hash AND d.activation_claim_id = p_claim_id
     AND d.activation_claim_expires_at > pg_catalog.now()
     AND d.status = 'APPROVED' AND d.activated_at IS NULL AND d.activation_expires_at > pg_catalog.now()
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform_activation_consume: talep geçersiz ya da süresi doldu' USING ERRCODE = '55000';
  END IF;
  -- Tenant'ı oluşturan kullanıcı talep e-postasının sahibi ve tenant'ın sahip üyesi olmalı.
  SELECT pg_catalog.lower(pg_catalog.btrim(u.email)) INTO v_owner_email
    FROM public.tenants t
    JOIN public.users u ON u.id = t.created_by_user_id
    JOIN public.tenant_memberships m ON m.tenant_id = t.id AND m.user_id = u.id AND m.is_owner AND m.status = 'ACTIVE'
   WHERE t.id = p_tenant_id AND t.status = 'ACTIVE' AND NOT t.is_demo;
  IF v_owner_email IS NULL OR v_owner_email <> v_email THEN
    RAISE EXCEPTION 'platform_activation_consume: tenant talep sahibine ait değil' USING ERRCODE = '42501';
  END IF;
  -- Tenant başına tek abonelik (PK): ikinci aktivasyon aynı tenant'a bağlanamaz (23505).
  INSERT INTO wms_platform.subscriptions (tenant_id, plan, trial_ends_at, demo_request_id)
  VALUES (p_tenant_id, 'TRIAL', pg_catalog.now() + interval '3 months', v_id)
  RETURNING trial_ends_at INTO v_trial;
  UPDATE wms_platform.demo_requests
     SET activated_at = pg_catalog.now(), activation_sample = p_sample,
         activation_claim_id = NULL, activation_claim_expires_at = NULL
   WHERE id = v_id;
  INSERT INTO public.security_events (user_id, event_type, detail)
  SELECT t.created_by_user_id, 'platform.demo_request.activated',
         pg_catalog.jsonb_build_object('demo_request_id', v_id::text, 'tenant_id', p_tenant_id::text)
    FROM public.tenants t WHERE t.id = p_tenant_id;
  RETURN v_trial;
END
$fn$;

-- Çalışma alanı adı alınmış mı (wms_app, oturumsuz): YALNIZ geçerli aktivasyon bağlantısıyla (açık bir ad yoklama ucu değildir).
CREATE FUNCTION wms_probe.platform_workspace_name_taken(p_token_hash text, p_slug text) RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' OR NOT EXISTS (
       SELECT 1 FROM wms_platform.demo_requests d
        WHERE d.activation_token_hash = p_token_hash AND d.status = 'APPROVED' AND d.activated_at IS NULL
          AND d.activation_expires_at > pg_catalog.now()) THEN
    RAISE EXCEPTION 'platform_workspace_name_taken: bağlantı geçersiz' USING ERRCODE = 'P0002';
  END IF;
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$' THEN
    RAISE EXCEPTION 'platform_workspace_name_taken: ad biçimsiz' USING ERRCODE = '22023';
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.tenants t WHERE t.slug = p_slug);
END
$fn$;

-- Yarıda kalan denemenin talebini bırakır (wms_app): kimlik korunur, süresi şimdi dolar; yeniden deneme aynı hesabı kullanır.
CREATE FUNCTION wms_probe.platform_activation_release(p_token_hash text, p_claim_id uuid) RETURNS void
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  UPDATE wms_platform.demo_requests
     SET activation_claim_expires_at = pg_catalog.now()
   WHERE activation_token_hash = p_token_hash AND activation_claim_id = p_claim_id AND activated_at IS NULL
     AND activation_claim_expires_at > pg_catalog.now();
END
$fn$;

-- Çağıranın tenant bağlamının aboneliği (wms_app; web ve worker `withSystemTenant`). Bağlam yoksa ya da kayıt yoksa satır yok.
CREATE FUNCTION wms_probe.platform_tenant_subscription() RETURNS TABLE (plan text, trial_ends_at timestamptz)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_ctx text := pg_catalog.current_setting('app.current_tenant_id', true);
BEGIN
  IF v_ctx IS NULL OR v_ctx !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT s.plan, s.trial_ends_at FROM wms_platform.subscriptions s WHERE s.tenant_id = v_ctx::uuid;
END
$fn$;

REVOKE ALL ON FUNCTION wms_probe.platform_workspace_name_taken(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wms_probe.platform_workspace_name_taken(text, text) TO wms_app;
REVOKE ALL ON FUNCTION wms_probe.platform_activation_release(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wms_probe.platform_activation_release(text, uuid) TO wms_app;
REVOKE ALL ON FUNCTION wms_probe.platform_list_demo_requests(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wms_probe.platform_list_demo_requests(integer) TO wms_app;
REVOKE ALL ON FUNCTION wms_probe.platform_tenant_subscription() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wms_probe.platform_tenant_subscription() TO wms_app;
REVOKE ALL ON FUNCTION wms_probe.platform_demo_request_email(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.platform_issue_activation(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.platform_prepare_activation_delivery(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.platform_activation_preview(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.platform_activation_claim(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.platform_activation_for_account_creation(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.platform_activation_consume(text, uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wms_probe.platform_demo_request_email(uuid) TO wms_app;
GRANT EXECUTE ON FUNCTION wms_probe.platform_issue_activation(uuid, text, text) TO wms_app;
GRANT EXECUTE ON FUNCTION wms_probe.platform_prepare_activation_delivery(uuid, text) TO wms_worker;
GRANT EXECUTE ON FUNCTION wms_probe.platform_activation_preview(text) TO wms_app;
GRANT EXECUTE ON FUNCTION wms_probe.platform_activation_claim(text) TO wms_app;
GRANT EXECUTE ON FUNCTION wms_probe.platform_activation_for_account_creation(text, uuid) TO wms_auth;
GRANT EXECUTE ON FUNCTION wms_probe.platform_activation_consume(text, uuid, uuid, boolean) TO wms_app;

RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;

-- ---------------------------------------------------------------------------------------------
-- 3. Doğrulama
-- ---------------------------------------------------------------------------------------------
DO $verify$
DECLARE
  f text;
  r text;
  want text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'wms_probe.platform_demo_request_email(uuid)',
    'wms_probe.platform_issue_activation(uuid, text, text)',
    'wms_probe.platform_prepare_activation_delivery(uuid, text)',
    'wms_probe.platform_activation_preview(text)',
    'wms_probe.platform_activation_claim(text)',
    'wms_probe.platform_activation_for_account_creation(text, uuid)',
    'wms_probe.platform_activation_consume(text, uuid, uuid, boolean)',
    'wms_probe.platform_tenant_subscription()',
    'wms_probe.platform_list_demo_requests(integer)',
    'wms_probe.platform_workspace_name_taken(text, text)',
    'wms_probe.platform_activation_release(text, uuid)'] LOOP
    IF NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_proc p
          WHERE p.oid = f::regprocedure
            AND p.proowner = pg_catalog.to_regrole('wms_identity_probe')
            AND p.prosecdef
            AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']
            AND p.proacl IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a WHERE a.grantee = 0)) THEN
      RAISE EXCEPTION '0039_trial_activation: % sahibi/SECURITY DEFINER/search_path/ACL beklenenden farklı', f;
    END IF;
    want := CASE WHEN f LIKE '%prepare_activation_delivery%' THEN 'wms_worker'
                 WHEN f LIKE '%for_account_creation%' THEN 'wms_auth'
                 ELSE 'wms_app' END;
    FOREACH r IN ARRAY ARRAY['wms_app', 'wms_auth', 'wms_worker', 'wms_ops'] LOOP
      IF pg_catalog.has_function_privilege(r, f, 'EXECUTE') <> (r = want) THEN
        RAISE EXCEPTION '0039_trial_activation: % rolünün % EXECUTE yetkisi beklenenden farklı', r, f;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['wms_app', 'wms_auth', 'wms_worker', 'wms_ops'] LOOP
    IF pg_catalog.has_schema_privilege(r, 'wms_platform', 'USAGE')
       OR pg_catalog.has_table_privilege(r, 'wms_platform.subscriptions', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') THEN
      RAISE EXCEPTION '0039_trial_activation: % wms_platform üzerinde yetki taşımamalı', r;
    END IF;
  END LOOP;
  IF pg_catalog.has_any_column_privilege('wms_identity_probe', 'public.tenants', 'UPDATE')
     OR pg_catalog.has_column_privilege('wms_identity_probe', 'wms_platform.demo_requests', 'email', 'UPDATE')
     OR pg_catalog.has_table_privilege('wms_identity_probe', 'wms_platform.subscriptions', 'UPDATE, DELETE, TRUNCATE')
     OR pg_catalog.has_schema_privilege('wms_identity_probe', 'wms_probe', 'CREATE') THEN
    RAISE EXCEPTION '0039_trial_activation: wms_identity_probe yetkisi beklenenden geniş';
  END IF;
END
$verify$;
