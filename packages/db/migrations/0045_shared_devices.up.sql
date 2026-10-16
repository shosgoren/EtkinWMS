-- 0045_shared_devices (T-998, ADR-026 §7.5–7.7; T-997 kabul koşulu 2): ortak el terminali/tablet kaydı, cihaz iptalinde oturum kapatma,
-- ortak cihazda hızlı kullanıcı değişimi. G-08: yalnızca GENİŞLETME.
--
-- BİLİNÇLİ KARARLAR (inceleme için):
-- * KAYIT ÜÇ ADIM (koşul 2: tek kullanımlık, yönetici oturumuna bağlı, yönetici ekranında onaylı): (1) yönetici (`users.manage`, yakın
--   doğrulama) 5 dakikalık kayıt belirteci üretir; DB'de yalnız SHA-256 özeti; QR adresi belirteci URL PARÇASINDA taşır (`#`), sunucuya
--   ve günlüğe gitmez. (2) Terminal belirteci kendi rastgele cihaz belirteci özetiyle TALEP eder (`field_enroll_claim`, wms_auth): talep
--   bir kez, süre içinde. (3) Yönetici kendi ekranında talep eden cihazın adını görür ve ONAYLAR (`field_enroll_approve`, wms_app + tenant
--   bağlamı + oluşturan yöneticiyle aynı kullanıcı): ancak o zaman SHARED cihaz satırı (talepteki belirteç özetiyle) açılır. QR fotoğrafı
--   sızsa bile onaysız cihaz giriş yapamaz; onay ayrıca TERMİNAL EKRANINDAKİ 6 haneli doğrulama kodunu ister (talepte üretilir, uygulama
--   rolü okuyamaz, yönetici terminalden okuyup yazar; 3 yanlışta kayıt iptal) — QR'ı ilk okutan başka cihaz olsa yönetici kodu göremez.
-- * Toplu kilitleme koruması (T-997 koşul 1): aynı ORTAK cihazdan 60 dakikada 3 farklı hesap kilitlenirse cihaz kendiliğinden iptal edilir
--   (`LOCK_SPREE`, `device.suspended`); yönetici ekranı bunu gösterir.
-- * `field_sessions(session_id, device_id)`: saha oturumunun açıldığı cihaz. tenant_id YOK (oturum platform tablosu; RLS'siz, yalnız
--   wms_auth). Cihaz iptalinde kimlik servisi bu bağla oturumları siler (ADR-026 §7.5 "iptal o cihazdaki oturumları da kapatır").
-- * Ortak cihaz personel listesi (`field_device_staff`, wms_auth): YALNIZ geçerli SHARED cihaz belirteciyle; ad + kullanıcı adı (PIN'i
--   belirlenmiş, ACTIVE, saha rollü üyeler). Kişisel cihazda boş.
-- Koşturucu tek transaction içinde çalıştırır.

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.field_devices') IS NULL THEN
    RAISE EXCEPTION '0045_shared_devices: 0044 önkoşulu yok';
  END IF;
END
$pre$;

CREATE TABLE public.field_enrollments (
  tenant_id          uuid        NOT NULL,
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  token_hash         text        NOT NULL,
  created_by         uuid        NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
  claim_token_hash   text,
  claimed_at         timestamptz,
  device_name        text,
  approved_at        timestamptz,
  device_id          uuid,
  cancelled_at       timestamptz,
  confirm_code       text,
  confirm_failed     integer     NOT NULL DEFAULT 0,
  CONSTRAINT field_enrollments_pkey PRIMARY KEY (id),
  CONSTRAINT field_enrollments_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT field_enrollments_token_key UNIQUE (token_hash),
  CONSTRAINT field_enrollments_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants (id),
  CONSTRAINT field_enrollments_creator_fkey FOREIGN KEY (created_by) REFERENCES public.users (id),
  CONSTRAINT field_enrollments_device_fkey FOREIGN KEY (device_id) REFERENCES public.field_devices (id),
  CONSTRAINT field_enrollments_hash_chk CHECK (token_hash ~ '^[0-9a-f]{64}$' AND (claim_token_hash IS NULL OR claim_token_hash ~ '^[0-9a-f]{64}$')),
  CONSTRAINT field_enrollments_claim_chk CHECK ((claim_token_hash IS NULL) = (claimed_at IS NULL) AND (claimed_at IS NULL) = (device_name IS NULL)),
  CONSTRAINT field_enrollments_approve_chk CHECK ((approved_at IS NULL) = (device_id IS NULL) AND (approved_at IS NULL OR claimed_at IS NOT NULL)),
  CONSTRAINT field_enrollments_code_chk CHECK ((confirm_code IS NULL) = (claimed_at IS NULL) AND (confirm_code IS NULL OR confirm_code ~ '^[0-9]{6}$')
                                             AND confirm_failed >= 0),
  CONSTRAINT field_enrollments_name_chk CHECK (device_name IS NULL OR pg_catalog.length(device_name) BETWEEN 1 AND 60)
);

ALTER TABLE public.field_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_enrollments FORCE ROW LEVEL SECURITY;
CREATE POLICY field_enrollments_isolation ON public.field_enrollments
  USING      (tenant_id = NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid);
REVOKE ALL ON public.field_enrollments FROM PUBLIC;
-- Uygulama: belirteç özeti yazılır ama OKUNMAZ; talep özeti ne okunur ne yazılır; iptal sütunu güncellenebilir (onay işlevle).
GRANT SELECT (tenant_id, id, created_by, created_at, expires_at, claimed_at, device_name, approved_at, device_id, cancelled_at)
  ON public.field_enrollments TO wms_app;
GRANT INSERT (tenant_id, id, token_hash, created_by) ON public.field_enrollments TO wms_app;
GRANT UPDATE (cancelled_at) ON public.field_enrollments TO wms_app;
GRANT SELECT ON public.field_enrollments TO wms_identity_probe;
GRANT UPDATE (claim_token_hash, claimed_at, device_name, approved_at, device_id, confirm_code, confirm_failed, cancelled_at)
  ON public.field_enrollments TO wms_identity_probe;

-- Cihaz iptal nedeni (MANUAL: yönetici; LOCK_SPREE: aynı ortak cihazdan çok hesabın kilitlenmesi, otomatik). Yönetici ekranı okur.
ALTER TABLE public.field_devices ADD COLUMN revoke_reason text;
ALTER TABLE public.field_devices ADD CONSTRAINT field_devices_revoke_reason_chk
  CHECK (revoke_reason IS NULL OR (revoke_reason IN ('MANUAL', 'LOCK_SPREE') AND revoked_at IS NOT NULL));
GRANT SELECT (revoke_reason) ON public.field_devices TO wms_app;
GRANT UPDATE (revoked_by, revoke_reason) ON public.field_devices TO wms_identity_probe;

-- Saha oturumu ↔ cihaz (platform tablosu; yalnız kimlik rolü).
CREATE TABLE public.field_sessions (
  session_id  uuid        NOT NULL,
  device_id   uuid        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_sessions_pkey PRIMARY KEY (session_id),
  CONSTRAINT field_sessions_session_fkey FOREIGN KEY (session_id) REFERENCES public.sessions (id) ON DELETE CASCADE,
  CONSTRAINT field_sessions_device_fkey FOREIGN KEY (device_id) REFERENCES public.field_devices (id)
);
CREATE INDEX field_sessions_device_idx ON public.field_sessions (device_id);
REVOKE ALL ON public.field_sessions FROM PUBLIC;
GRANT SELECT, INSERT, DELETE ON public.field_sessions TO wms_auth;

-- Ortak cihazda kilitlenen hesaplar (toplu kilitleme koruması; platform tablosu, yalnız probe işlevi yazar/okur).
CREATE TABLE public.field_device_lockouts (
  device_id  uuid        NOT NULL,
  user_id    uuid        NOT NULL,
  locked_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_device_lockouts_device_fkey FOREIGN KEY (device_id) REFERENCES public.field_devices (id),
  CONSTRAINT field_device_lockouts_user_fkey FOREIGN KEY (user_id) REFERENCES public.users (id)
);
CREATE INDEX field_device_lockouts_device_idx ON public.field_device_lockouts (device_id, locked_at);
REVOKE ALL ON public.field_device_lockouts FROM PUBLIC;
GRANT SELECT, INSERT ON public.field_device_lockouts TO wms_identity_probe;

-- ---------------------------------------------------------------------------------------------
-- İşlevler (SET ROLE kalıbı)
-- ---------------------------------------------------------------------------------------------
GRANT CREATE ON SCHEMA wms_probe TO wms_identity_probe;
SET ROLE wms_identity_probe;

-- Terminal talebi: kayıt belirteci (QR) + terminalin kendi cihaz belirteci özeti + ad. Süre içinde ve bir kez. Sonuç: 6 haneli doğrulama
-- kodu (terminal gösterir) ya da DENIED.
CREATE FUNCTION wms_probe.field_enroll_claim(p_tenant uuid, p_token_hash text, p_device_token_hash text, p_name text)
RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_prev text := pg_catalog.current_setting('app.current_tenant_id', true);
  v_id uuid;
  v_name text := NULLIF(pg_catalog.left(pg_catalog.btrim(coalesce(p_name, '')), 60), '');
  -- Doğrulama kodu güvenli kaynaktan (gen_random_uuid; inceleme n3).
  v_code text := pg_catalog.lpad(((pg_catalog.abs(('x' || pg_catalog.substr(pg_catalog.md5(gen_random_uuid()::text), 1, 8))::bit(32)::bigint) % 1000000))::text, 6, '0');
BEGIN
  IF p_tenant IS NULL OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' OR p_device_token_hash IS NULL
     OR p_device_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN 'DENIED';
  END IF;
  PERFORM pg_catalog.set_config('app.current_tenant_id', p_tenant::text, true);
  UPDATE public.field_enrollments e
     SET claim_token_hash = p_device_token_hash, claimed_at = now(), device_name = coalesce(v_name, 'Ortak cihaz'), confirm_code = v_code
   WHERE e.tenant_id = p_tenant AND e.token_hash = p_token_hash AND e.claimed_at IS NULL AND e.cancelled_at IS NULL
     AND e.expires_at > now()
     AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = p_tenant AND t.status = 'ACTIVE' AND NOT t.is_demo)
  RETURNING e.id INTO v_id;
  PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
  IF v_id IS NULL THEN
    RETURN 'DENIED';
  END IF;
  -- Terminal ekranında gösterilecek doğrulama kodu (yönetici onayda yazar).
  RETURN v_code;
END
$fn$;

-- Yönetici onayı (wms_app, tenant bağlamı zorunlu; yalnız kaydı oluşturan yönetici; talepten sonra 10 dakika içinde; terminaldeki doğrulama
-- kodu eşleşmeli). SHARED cihaz satırı talepteki belirteç özetiyle açılır; `device.enrolled` yazılır. Dönüş: cihaz kimliği; kod yanlışsa NULL.
CREATE FUNCTION wms_probe.field_enroll_approve(p_enrollment uuid, p_actor uuid, p_code text)
RETURNS uuid
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_ctx uuid := NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid;
  v_e public.field_enrollments%ROWTYPE;
  v_dev uuid;
BEGIN
  IF v_ctx IS NULL THEN
    RAISE EXCEPTION 'field_enroll_approve: tenant bağlamı yok' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_e FROM public.field_enrollments e WHERE e.tenant_id = v_ctx AND e.id = p_enrollment FOR UPDATE;
  IF NOT FOUND OR v_e.created_by <> p_actor OR v_e.claimed_at IS NULL OR v_e.approved_at IS NOT NULL OR v_e.cancelled_at IS NOT NULL
     OR v_e.claimed_at < now() - interval '10 minutes' THEN
    RAISE EXCEPTION 'field_enroll_approve: kayıt onaylanamaz' USING ERRCODE = 'P0002';
  END IF;
  IF p_code IS NULL OR p_code <> v_e.confirm_code THEN
    -- Yanlış doğrulama kodu: 3. yanlışta kayıt iptal (tahmin yok). İstisna yerine NULL: sayaç yazımı geri alınmasın.
    UPDATE public.field_enrollments e
       SET confirm_failed = e.confirm_failed + 1,
           cancelled_at = CASE WHEN e.confirm_failed + 1 >= 3 THEN now() ELSE e.cancelled_at END
     WHERE e.id = v_e.id;
    RETURN NULL;
  END IF;
  INSERT INTO public.field_devices (tenant_id, token_hash, kind, user_id, name, created_by)
  VALUES (v_ctx, v_e.claim_token_hash, 'SHARED', NULL, v_e.device_name, p_actor)
  RETURNING id INTO v_dev;
  UPDATE public.field_enrollments e SET approved_at = now(), device_id = v_dev WHERE e.id = v_e.id;
  INSERT INTO public.security_events (user_id, event_type, detail)
  VALUES (p_actor, 'device.enrolled', pg_catalog.jsonb_build_object('tenant_id', v_ctx::text, 'device_id', v_dev::text, 'kind', 'SHARED'));
  RETURN v_dev;
END
$fn$;

-- Ortak cihaz personel listesi (hızlı kullanıcı değişimi): yalnız geçerli SHARED cihazla; ad + kullanıcı adı + saha rolü.
CREATE FUNCTION wms_probe.field_device_staff(p_tenant uuid, p_token_hash text)
RETURNS TABLE (name text, username text, role_key text)
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
  IF EXISTS (SELECT 1 FROM public.field_devices d JOIN public.tenants t ON t.id = d.tenant_id
              WHERE d.tenant_id = p_tenant AND d.token_hash = p_token_hash AND d.kind = 'SHARED' AND d.revoked_at IS NULL
                AND d.expires_at > now() AND d.last_used_at > now() - interval '60 days' AND t.status = 'ACTIVE' AND NOT t.is_demo) THEN
    RETURN QUERY
      SELECT u.name, l.username,
             (SELECT r.role_key FROM public.membership_roles r WHERE r.tenant_id = l.tenant_id AND r.membership_id = l.membership_id
               ORDER BY r.role_key LIMIT 1)
        FROM public.field_logins l
        JOIN public.tenant_memberships m ON m.tenant_id = l.tenant_id AND m.id = l.membership_id AND m.user_id = l.user_id AND m.status = 'ACTIVE'
        JOIN public.users u ON u.id = l.user_id
       WHERE l.tenant_id = p_tenant AND l.pin_hash IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.membership_roles r WHERE r.tenant_id = l.tenant_id AND r.membership_id = l.membership_id
                           AND r.role_key NOT IN ('PICKER', 'COUNTER'))
       ORDER BY u.name, l.username
       LIMIT 200;
  END IF;
  PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
END
$fn$;

-- Cihaz iptali (wms_app, tenant bağlamı zorunlu; `users.manage` uygulamada): iptal + `device.revoked`. Oturumları kimlik servisi kapatır.
CREATE FUNCTION wms_probe.field_device_revoke(p_device uuid, p_actor uuid)
RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_ctx uuid := NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid;
  v_kind text;
BEGIN
  IF v_ctx IS NULL THEN
    RAISE EXCEPTION 'field_device_revoke: tenant bağlamı yok' USING ERRCODE = '42501';
  END IF;
  UPDATE public.field_devices d SET revoked_at = now(), revoked_by = p_actor, revoke_reason = 'MANUAL'
   WHERE d.tenant_id = v_ctx AND d.id = p_device AND d.revoked_at IS NULL
  RETURNING d.kind INTO v_kind;
  IF v_kind IS NULL THEN
    -- Zaten iptal edilmiş cihaz: oturum kapatma yeniden denenebilsin (ALREADY); yoksa MISSING.
    IF EXISTS (SELECT 1 FROM public.field_devices d WHERE d.tenant_id = v_ctx AND d.id = p_device) THEN
      RETURN 'ALREADY';
    END IF;
    RETURN 'MISSING';
  END IF;
  INSERT INTO public.security_events (user_id, event_type, detail)
  VALUES (p_actor, 'device.revoked', pg_catalog.jsonb_build_object('tenant_id', v_ctx::text, 'device_id', p_device::text, 'kind', v_kind));
  RETURN 'REVOKED';
END
$fn$;

-- Toplu kilitleme koruması (T-997 koşul 1; wms_auth giriş ucu her KİLİT yanıtında çağırır): kilitli hesabı bu ORTAK cihazla eşleyip
-- `field_device_lockouts`'a yazar; 60 dakikada 3 farklı hesap → cihaz kendiliğinden iptal (`LOCK_SPREE`) + `device.suspended`.
-- Dönüş: bu çağrıda durdurulan cihazın kimliği (oturumlarını çağıran kimlik servisi kapatır) ya da NULL.
CREATE FUNCTION wms_probe.field_lock_spree_check(p_tenant uuid, p_token_hash text, p_username text)
RETURNS uuid
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_prev text := pg_catalog.current_setting('app.current_tenant_id', true);
  v_device uuid;
  v_user uuid;
  v_n integer;
  v_done boolean := false;
BEGIN
  IF p_tenant IS NULL OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN NULL;
  END IF;
  PERFORM pg_catalog.set_config('app.current_tenant_id', p_tenant::text, true);
  SELECT d.id INTO v_device FROM public.field_devices d
   WHERE d.tenant_id = p_tenant AND d.token_hash = p_token_hash AND d.kind = 'SHARED' AND d.revoked_at IS NULL;
  SELECT l.user_id INTO v_user FROM public.field_logins l
   WHERE l.tenant_id = p_tenant AND l.username = pg_catalog.lower(pg_catalog.btrim(coalesce(p_username, '')))
     AND l.locked_until IS NOT NULL AND l.locked_until > now();
  IF v_device IS NOT NULL AND v_user IS NOT NULL THEN
    INSERT INTO public.field_device_lockouts (device_id, user_id) VALUES (v_device, v_user);
    SELECT pg_catalog.count(DISTINCT o.user_id) INTO v_n FROM public.field_device_lockouts o
     WHERE o.device_id = v_device AND o.locked_at > now() - interval '60 minutes';
    IF v_n >= 3 THEN
      UPDATE public.field_devices d SET revoked_at = now(), revoke_reason = 'LOCK_SPREE'
       WHERE d.tenant_id = p_tenant AND d.id = v_device AND d.revoked_at IS NULL;
      v_done := FOUND;
    END IF;
  END IF;
  PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
  IF v_done THEN
    INSERT INTO public.security_events (user_id, event_type, detail)
    VALUES (NULL, 'device.suspended', pg_catalog.jsonb_build_object('tenant_id', p_tenant::text, 'device_id', v_device::text,
            'reason', 'lock_spree', 'locked_accounts', v_n));
  END IF;
  IF v_done THEN
    RETURN v_device;
  END IF;
  RETURN NULL;
END
$fn$;

REVOKE ALL ON FUNCTION wms_probe.field_lock_spree_check(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wms_probe.field_lock_spree_check(uuid, text, text) TO wms_auth;
REVOKE ALL ON FUNCTION wms_probe.field_device_revoke(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wms_probe.field_device_revoke(uuid, uuid) TO wms_app;
REVOKE ALL ON FUNCTION wms_probe.field_enroll_claim(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.field_enroll_approve(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.field_device_staff(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wms_probe.field_enroll_claim(uuid, text, text, text) TO wms_auth;
GRANT EXECUTE ON FUNCTION wms_probe.field_enroll_approve(uuid, uuid, text) TO wms_app;
GRANT EXECUTE ON FUNCTION wms_probe.field_device_staff(uuid, text) TO wms_auth;

RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;

DO $verify$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['field_enroll_claim', 'field_enroll_approve', 'field_device_staff', 'field_device_revoke', 'field_lock_spree_check'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'wms_probe' AND p.proname = f AND p.prosecdef AND p.proowner = 'wms_identity_probe'::regrole
                      AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']) THEN
      RAISE EXCEPTION '0045_shared_devices: % beklenen biçimde değil', f;
    END IF;
  END LOOP;
  IF pg_catalog.has_column_privilege('wms_app', 'public.field_enrollments', 'token_hash', 'SELECT')
     OR pg_catalog.has_column_privilege('wms_app', 'public.field_enrollments', 'claim_token_hash', 'SELECT')
     OR pg_catalog.has_column_privilege('wms_app', 'public.field_enrollments', 'confirm_code', 'SELECT')
     OR pg_catalog.has_any_column_privilege('wms_auth', 'public.field_enrollments', 'SELECT')
     OR pg_catalog.has_any_column_privilege('wms_app', 'public.field_sessions', 'SELECT') THEN
    RAISE EXCEPTION '0045_shared_devices: özet/oturum sütunları yanlış role açık';
  END IF;
END
$verify$;
