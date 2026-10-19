-- 0052_team_join (T-429, Ekip.dc.html; ADR-026 §7.9): saha personelinin kendi telefonuyla ekibe katılması. G-08: yalnız GENİŞLETME.
--
-- BİLİNÇLİ KARARLAR (inceleme için):
-- * KATILMA BAĞLANTISI (QR): alan başına en çok bir geçerli bağlantı, 7 gün. Yönetici (`users.manage`, yakın doğrulama) üretir; DB'de yalnız
--   SHA-256 özeti; QR adresi belirteci URL PARÇASINDA (`#`) taşır. Yenilenince eskisi o anda geçersiz (`revoked_at`). Uygulama rolü özeti OKUMAZ.
-- * TALEP: personel cihazı (oturumsuz, wms_auth) ad + istediği kullanıcı adını gönderir; cihaz kendi rastgele TALEP belirtecini üretir, DB'ye yalnız
--   özeti gider (`field_join_request`). Sonuç 6 haneli doğrulama kodudur; yalnız o cihazın ekranında görünür, uygulama rolü okuyamaz. Kötüye kullanım
--   sınırları: bağlantı başına en çok 50 bekleyen talep, talep 24 saat geçerli, aynı kullanıcı adıyla bekleyen ya da var olan hesap reddedilir
--   (IP / bağlantı hız sınırı kimlik servisinde).
-- * ONAY yalnız yönetici ekranında: cihazdaki kodu yazar (`field_join_verify`, wms_app + tenant bağlamı; 3 yanlışta talep iptal), rolü (PICKER /
--   COUNTER) seçer; hesap mevcut saha hesabı yolu ile (T-997) aynı transaction'da açılır ve talep APPROVED + üyelik bağlanır.
-- * ETKİNLEŞTİRME: onaylanan talebi YALNIZ talep belirtecini tutan cihaz kullanır (`field_join_activate`, wms_auth): kişi kendi PIN'ini belirler,
--   kişisel cihaz açılır, talep CLAIMED olur (tek kullanım, onaydan sonra 24 saat). Belirteç 256 bit; etkinleştirme kodu hiç gösterilmez.
-- * Demo ve askıdaki alanda talep açılmaz. Hiçbir satır silinmez; durum alanıyla izlenir.
-- Koşturucu tek transaction içinde çalıştırır.

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.permission_groups') IS NULL THEN
    RAISE EXCEPTION '0052_team_join: 0051 önkoşulu yok';
  END IF;
END
$pre$;

CREATE TABLE public.team_join_links (
  tenant_id   uuid        NOT NULL,
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  token_hash  text        NOT NULL,
  created_by  uuid        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '7 days',
  revoked_at  timestamptz,
  CONSTRAINT team_join_links_pkey PRIMARY KEY (id),
  CONSTRAINT team_join_links_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT team_join_links_token_key UNIQUE (token_hash),
  CONSTRAINT team_join_links_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants (id),
  CONSTRAINT team_join_links_creator_fkey FOREIGN KEY (created_by) REFERENCES public.users (id),
  CONSTRAINT team_join_links_hash_chk CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT team_join_links_ttl_chk CHECK (expires_at > created_at AND expires_at <= created_at + interval '7 days 1 minute')
);
-- Alan başına en çok bir iptal edilmemiş bağlantı (yenileme önce eskisini iptal eder).
CREATE UNIQUE INDEX team_join_links_one_active ON public.team_join_links (tenant_id) WHERE revoked_at IS NULL;

CREATE TABLE public.team_join_requests (
  tenant_id       uuid        NOT NULL,
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  link_id         uuid        NOT NULL,
  request_hash    text        NOT NULL,
  name            text        NOT NULL,
  username        text        NOT NULL,
  device_hint     text,
  confirm_code    text        NOT NULL,
  confirm_failed  integer     NOT NULL DEFAULT 0,
  status          text        NOT NULL DEFAULT 'PENDING',
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  decided_by      uuid,
  decided_at      timestamptz,
  membership_id   uuid,
  claimed_at      timestamptz,
  CONSTRAINT team_join_requests_pkey PRIMARY KEY (id),
  CONSTRAINT team_join_requests_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT team_join_requests_hash_key UNIQUE (request_hash),
  CONSTRAINT team_join_requests_link_fkey FOREIGN KEY (tenant_id, link_id) REFERENCES public.team_join_links (tenant_id, id),
  CONSTRAINT team_join_requests_member_fkey FOREIGN KEY (tenant_id, membership_id) REFERENCES public.tenant_memberships (tenant_id, id),
  CONSTRAINT team_join_requests_decider_fkey FOREIGN KEY (decided_by) REFERENCES public.users (id),
  CONSTRAINT team_join_requests_hash_chk CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT team_join_requests_name_chk CHECK (pg_catalog.length(name) BETWEEN 1 AND 60 AND name !~ '[[:cntrl:]]'),
  CONSTRAINT team_join_requests_username_chk CHECK (username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
  CONSTRAINT team_join_requests_hint_chk CHECK (device_hint IS NULL OR (pg_catalog.length(device_hint) BETWEEN 1 AND 80 AND device_hint !~ '[[:cntrl:]]')),
  CONSTRAINT team_join_requests_code_chk CHECK (confirm_code ~ '^[0-9]{6}$' AND confirm_failed >= 0),
  CONSTRAINT team_join_requests_status_chk CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'CLAIMED')),
  CONSTRAINT team_join_requests_decision_chk CHECK (((status = 'PENDING') = (decided_at IS NULL) AND (decided_at IS NULL) = (decided_by IS NULL)) OR status = 'CANCELLED'),
  CONSTRAINT team_join_requests_member_chk CHECK (status NOT IN ('APPROVED', 'CLAIMED') OR membership_id IS NOT NULL),
  CONSTRAINT team_join_requests_claim_chk CHECK ((status = 'CLAIMED') = (claimed_at IS NOT NULL))
);
CREATE INDEX team_join_requests_pending_idx ON public.team_join_requests (tenant_id, status, created_at);
CREATE INDEX team_join_requests_link_idx ON public.team_join_requests (tenant_id, link_id);

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['team_join_links', 'team_join_requests'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I
         USING      (tenant_id = NULLIF(pg_catalog.current_setting(''app.current_tenant_id'', true), '''')::uuid)
         WITH CHECK (tenant_id = NULLIF(pg_catalog.current_setting(''app.current_tenant_id'', true), '''')::uuid)',
      t || '_isolation', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t);
  END LOOP;
END
$rls$;

-- Uygulama: bağlantı özeti yazılır ama OKUNMAZ; talep özeti ve doğrulama kodu okunmaz; karar sütunları güncellenir.
GRANT SELECT (tenant_id, id, created_by, created_at, expires_at, revoked_at) ON public.team_join_links TO wms_app;
GRANT INSERT (tenant_id, id, token_hash, created_by, expires_at) ON public.team_join_links TO wms_app;
GRANT UPDATE (revoked_at) ON public.team_join_links TO wms_app;
GRANT SELECT (tenant_id, id, link_id, name, username, device_hint, confirm_failed, status, created_at, expires_at, decided_by, decided_at,
              membership_id, claimed_at) ON public.team_join_requests TO wms_app;
GRANT UPDATE (status, decided_by, decided_at, membership_id) ON public.team_join_requests TO wms_app;
-- Probe işlevleri (talep, doğrulama, etkinleştirme).
GRANT SELECT ON public.team_join_links, public.team_join_requests TO wms_identity_probe;
GRANT INSERT (tenant_id, link_id, request_hash, name, username, device_hint, confirm_code) ON public.team_join_requests TO wms_identity_probe;
GRANT UPDATE (confirm_failed, status, claimed_at) ON public.team_join_requests TO wms_identity_probe;

-- ---------------------------------------------------------------------------------------------
-- İşlevler (SET ROLE kalıbı, 0045 ile aynı)
-- ---------------------------------------------------------------------------------------------
GRANT CREATE ON SCHEMA wms_probe TO wms_identity_probe;
SET ROLE wms_identity_probe;

-- Personel cihazı talebi (oturumsuz, wms_auth). Dönüş: 6 haneli kod | DENIED | USERNAME_TAKEN | FULL.
CREATE FUNCTION wms_probe.field_join_request(p_tenant uuid, p_token_hash text, p_request_hash text, p_name text, p_username text, p_hint text)
RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_prev text := pg_catalog.current_setting('app.current_tenant_id', true);
  v_link uuid;
  v_name text := NULLIF(pg_catalog.left(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', ' ', 'g')), 60), '');
  v_user text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_username, '')));
  v_hint text := NULLIF(pg_catalog.left(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_hint, ''), '[[:cntrl:]]', ' ', 'g')), 80), '');
  v_code text := pg_catalog.lpad(((pg_catalog.abs(('x' || pg_catalog.substr(pg_catalog.md5(gen_random_uuid()::text), 1, 8))::bit(32)::bigint) % 1000000))::text, 6, '0');
  v_out text;
BEGIN
  IF p_tenant IS NULL OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR v_name IS NULL OR v_user !~ '^[a-z0-9][a-z0-9._-]{2,31}$' THEN
    RETURN 'DENIED';
  END IF;
  PERFORM pg_catalog.set_config('app.current_tenant_id', p_tenant::text, true);
  SELECT l.id INTO v_link FROM public.team_join_links l
   WHERE l.tenant_id = p_tenant AND l.token_hash = p_token_hash AND l.revoked_at IS NULL AND l.expires_at > now()
     AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = p_tenant AND t.status = 'ACTIVE' AND NOT t.is_demo);
  IF v_link IS NULL THEN
    v_out := 'DENIED';
  ELSIF (SELECT count(*) FROM public.team_join_requests r
          WHERE r.tenant_id = p_tenant AND r.link_id = v_link AND r.status = 'PENDING' AND r.expires_at > now()) >= 50 THEN
    v_out := 'FULL';
  ELSIF EXISTS (SELECT 1 FROM public.field_logins f WHERE f.tenant_id = p_tenant AND f.username = v_user)
     OR EXISTS (SELECT 1 FROM public.team_join_requests r WHERE r.tenant_id = p_tenant AND r.username = v_user
                  AND ((r.status = 'PENDING' AND r.expires_at > now()) OR r.status = 'APPROVED')) THEN
    v_out := 'USERNAME_TAKEN';
  ELSE
    INSERT INTO public.team_join_requests (tenant_id, link_id, request_hash, name, username, device_hint, confirm_code)
    VALUES (p_tenant, v_link, p_request_hash, v_name, v_user, v_hint, v_code);
    v_out := v_code;
  END IF;
  PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
  RETURN v_out;
END
$fn$;

-- Cihazın talep durumu (wms_auth; yalnız talep belirteci sahibi). Dönüş: durum, alan adresi, kullanıcı adı, alan adı; yoksa satır yok.
CREATE FUNCTION wms_probe.field_join_status(p_tenant uuid, p_request_hash text)
RETURNS TABLE (status text, slug text, username text, tenant_name text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_prev text := pg_catalog.current_setting('app.current_tenant_id', true);
BEGIN
  IF p_tenant IS NULL OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN;
  END IF;
  PERFORM pg_catalog.set_config('app.current_tenant_id', p_tenant::text, true);
  RETURN QUERY
    SELECT CASE WHEN r.status = 'PENDING' AND r.expires_at <= now() THEN 'EXPIRED'
                WHEN r.status = 'APPROVED' AND r.decided_at <= now() - interval '24 hours' THEN 'EXPIRED'
                ELSE r.status END,
           t.slug, r.username, t.name
      FROM public.team_join_requests r
      JOIN public.tenants t ON t.id = r.tenant_id
     WHERE r.tenant_id = p_tenant AND r.request_hash = p_request_hash AND t.status = 'ACTIVE' AND NOT t.is_demo;
  PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
END
$fn$;

-- Bağlantı önizlemesi (wms_auth; oturumsuz): geçerli bağlantının alan adı. Geçersizse satır yok.
CREATE FUNCTION wms_probe.field_join_link(p_tenant uuid, p_token_hash text)
RETURNS TABLE (tenant_name text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_prev text := pg_catalog.current_setting('app.current_tenant_id', true);
BEGIN
  IF p_tenant IS NULL OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN;
  END IF;
  PERFORM pg_catalog.set_config('app.current_tenant_id', p_tenant::text, true);
  RETURN QUERY
    SELECT t.name FROM public.team_join_links l JOIN public.tenants t ON t.id = l.tenant_id
     WHERE l.tenant_id = p_tenant AND l.token_hash = p_token_hash AND l.revoked_at IS NULL AND l.expires_at > now()
       AND t.status = 'ACTIVE' AND NOT t.is_demo;
  PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
END
$fn$;

-- Yönetici doğrulaması (wms_app, tenant bağlamı zorunlu): bekleyen talepte cihazdaki kod. Yanlış kod sayılır; 3'te talep CANCELLED.
-- Dönüş: OK | WRONG | GONE.
CREATE FUNCTION wms_probe.field_join_verify(p_request uuid, p_code text)
RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_tenant uuid := NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid;
  v_r public.team_join_requests%ROWTYPE;
BEGIN
  IF v_tenant IS NULL OR p_request IS NULL THEN
    RAISE EXCEPTION 'field_join_verify: tenant bağlamı yok' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_r FROM public.team_join_requests r WHERE r.tenant_id = v_tenant AND r.id = p_request FOR UPDATE;
  IF NOT FOUND OR v_r.status <> 'PENDING' OR v_r.expires_at <= now() THEN
    RETURN 'GONE';
  END IF;
  IF p_code IS NULL OR p_code !~ '^[0-9]{6}$' OR p_code <> v_r.confirm_code THEN
    UPDATE public.team_join_requests r
       SET confirm_failed = r.confirm_failed + 1,
           status = CASE WHEN r.confirm_failed + 1 >= 3 THEN 'CANCELLED' ELSE r.status END
     WHERE r.id = v_r.id;
    RETURN 'WRONG';
  END IF;
  RETURN 'OK';
END
$fn$;

-- Etkinleştirme (wms_auth; yalnız talep belirteci sahibi cihaz): onaylanmış (24 saat içinde), kullanılmamış talep → PIN + kişisel cihaz.
-- Mantık `field_activate` (0044) ile aynı: rol yalnız saha rolü, üyelik ACTIVE; önceki kişisel cihazlar iptal.
CREATE FUNCTION wms_probe.field_join_activate(p_tenant uuid, p_request_hash text, p_pin_hash text, p_token_hash text, p_device_name text)
RETURNS TABLE (outcome text, user_id uuid, tenant_id uuid, device_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_prev text := pg_catalog.current_setting('app.current_tenant_id', true);
  v_r public.team_join_requests%ROWTYPE;
  v_l public.field_logins%ROWTYPE;
  v_dev uuid;
  v_ok boolean;
BEGIN
  IF p_tenant IS NULL OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' OR p_pin_hash IS NULL OR p_pin_hash NOT LIKE '$argon2id$%'
     OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'field_join_activate: girdi biçimsiz' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = p_tenant AND t.status = 'ACTIVE' AND NOT t.is_demo) THEN
    RETURN QUERY SELECT 'DENIED'::text, NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  PERFORM pg_catalog.set_config('app.current_tenant_id', p_tenant::text, true);
  SELECT * INTO v_r FROM public.team_join_requests r
   WHERE r.tenant_id = p_tenant AND r.request_hash = p_request_hash FOR UPDATE;
  IF NOT FOUND OR v_r.status <> 'APPROVED' OR v_r.decided_at <= now() - interval '24 hours' OR v_r.membership_id IS NULL THEN
    PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
    RETURN QUERY SELECT 'DENIED'::text, NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  SELECT * INTO v_l FROM public.field_logins l WHERE l.tenant_id = p_tenant AND l.membership_id = v_r.membership_id FOR UPDATE;
  -- Yalnız HİÇ PIN belirlenmemiş ve onaydaki etkinleştirmesi hâlâ bekleyen hesap (güvenlik incelemesi: kişi başka yoldan etkinleştirdiyse
  -- ya da yönetici kodu yeniledikten sonra kullanıldıysa eski talep çerezi PIN'i ezemez; kod yenileme talebi ayrıca iptal eder).
  SELECT FOUND AND v_l.pin_set_at IS NULL AND v_l.activation_hash IS NOT NULL AND v_l.activation_expires_at > now()
         AND NOT EXISTS (SELECT 1 FROM public.membership_roles mr WHERE mr.tenant_id = p_tenant AND mr.membership_id = v_r.membership_id
                                 AND mr.role_key NOT IN ('PICKER', 'COUNTER'))
         AND EXISTS (SELECT 1 FROM public.tenant_memberships m WHERE m.tenant_id = p_tenant AND m.id = v_r.membership_id
                       AND m.user_id = v_l.user_id AND m.status = 'ACTIVE')
    INTO v_ok;
  IF NOT coalesce(v_ok, false) THEN
    PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
    IF v_l.user_id IS NOT NULL THEN
      INSERT INTO public.security_events (user_id, event_type, detail)
      VALUES (v_l.user_id, 'field_pin.failed', pg_catalog.jsonb_build_object('tenant_id', p_tenant::text, 'reason', 'join_not_pending'));
    END IF;
    RETURN QUERY SELECT 'DENIED'::text, NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  UPDATE public.field_logins l
     SET pin_hash = p_pin_hash, pin_set_at = now(), activation_hash = NULL, activation_expires_at = NULL, activation_failed_count = 0,
         failed_count = 0, lock_count = 0, locked_until = NULL
   WHERE l.id = v_l.id;
  UPDATE public.field_devices d SET revoked_at = now()
   WHERE d.tenant_id = p_tenant AND d.kind = 'PERSONAL' AND d.user_id = v_l.user_id AND d.revoked_at IS NULL;
  INSERT INTO public.field_devices (tenant_id, token_hash, kind, user_id, name, created_by)
  VALUES (p_tenant, p_token_hash, 'PERSONAL', v_l.user_id,
          coalesce(NULLIF(pg_catalog.left(pg_catalog.btrim(coalesce(p_device_name, '')), 60), ''), 'Kişisel telefon'), v_l.user_id)
  RETURNING id INTO v_dev;
  UPDATE public.team_join_requests r SET status = 'CLAIMED', claimed_at = now() WHERE r.id = v_r.id;
  PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
  INSERT INTO public.security_events (user_id, event_type, detail)
  VALUES (v_l.user_id, 'field_pin.set', pg_catalog.jsonb_build_object('tenant_id', p_tenant::text, 'device_id', v_dev::text, 'via', 'join'));
  INSERT INTO public.security_events (user_id, event_type, detail)
  VALUES (v_l.user_id, 'device.enrolled', pg_catalog.jsonb_build_object('tenant_id', p_tenant::text, 'device_id', v_dev::text, 'kind', 'PERSONAL'));
  RETURN QUERY SELECT 'OK'::text, v_l.user_id, p_tenant, v_dev;
END
$fn$;

REVOKE ALL ON FUNCTION wms_probe.field_join_request(uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.field_join_status(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.field_join_link(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.field_join_verify(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.field_join_activate(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wms_probe.field_join_request(uuid, text, text, text, text, text) TO wms_auth;
GRANT EXECUTE ON FUNCTION wms_probe.field_join_status(uuid, text) TO wms_auth;
GRANT EXECUTE ON FUNCTION wms_probe.field_join_link(uuid, text) TO wms_auth;
GRANT EXECUTE ON FUNCTION wms_probe.field_join_verify(uuid, text) TO wms_app;
GRANT EXECUTE ON FUNCTION wms_probe.field_join_activate(uuid, text, text, text, text) TO wms_auth;

RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;

DO $verify$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['field_join_request', 'field_join_status', 'field_join_link', 'field_join_verify', 'field_join_activate'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'wms_probe' AND p.proname = f AND p.prosecdef AND p.proowner = 'wms_identity_probe'::regrole
                      AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']) THEN
      RAISE EXCEPTION '0052_team_join: % beklenen biçimde değil', f;
    END IF;
  END LOOP;
  IF pg_catalog.has_column_privilege('wms_app', 'public.team_join_links', 'token_hash', 'SELECT')
     OR pg_catalog.has_column_privilege('wms_app', 'public.team_join_requests', 'request_hash', 'SELECT')
     OR pg_catalog.has_column_privilege('wms_app', 'public.team_join_requests', 'confirm_code', 'SELECT')
     OR pg_catalog.has_table_privilege('wms_app', 'public.team_join_requests', 'INSERT')
     OR pg_catalog.has_any_column_privilege('wms_auth', 'public.team_join_requests', 'SELECT')
     OR pg_catalog.has_any_column_privilege('wms_auth', 'public.team_join_links', 'SELECT')
     OR pg_catalog.has_table_privilege('wms_app', 'public.team_join_links', 'DELETE')
     OR pg_catalog.has_table_privilege('wms_app', 'public.team_join_requests', 'DELETE') THEN
    RAISE EXCEPTION '0052_team_join: özet/kod sütunları ya da silme yanlış role açık';
  END IF;
END
$verify$;
