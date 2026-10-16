-- 0044_field_logins (T-997, ADR-026 §7; kabul 16 Ekim 2026): e-postasız saha personeli — çalışma alanı + kullanıcı adı + 6 hane PIN,
-- yalnız KAYITLI CİHAZDA. G-08: yalnızca GENİŞLETME (iki tenant tablosu, beş probe işlevi, güvenlik olayı yazar kuralı).
--
-- BİLİNÇLİ KARARLAR (inceleme için):
-- * KİMLİK: saha hesabının `users` satırı Better Auth'a erişilemeyen iç e-posta taşır (`<uuid>@field.invalid`, RFC 2606); e-posta/parola,
--   sıfırlama ve 2FA uçları bu alanı reddeder (packages/auth). Bir saha hesabı TEK tenant'a bağlıdır (`field_logins.user_id` tekil).
-- * `field_logins` (tenant tablosu, RLS + FORCE, TO'suz izolasyon politikası): kullanıcı adı (alan içinde tekil), PIN özeti (Argon2id;
--   ÖZET uygulamada üretilir), etkinleştirme kodu ÖZETİ (SHA-256; 24 saat; tek kullanım), hata sayacı ve kilit. Uygulama rolü (yönetici
--   ekranı) PIN/kod özetini OKUYAMAZ ve YAZAMAZ; kod yenileme ve kilit açma yalnız `wms_probe.field_admin_*` işlevleriyle (tenant bağlamı
--   zorunlu, çağıranın `users.manage` yetkisi uygulamada denetlenir).
-- * `field_devices` (tenant tablosu): cihaz belirtecinin SHA-256 özeti, tür (PERSONAL: tek personele bağlı; SHARED: T-998), son kullanım,
--   bitiş (180 gün), boşta iptal (60 gün kullanılmazsa geçersiz), iptal. Belirteç her başarılı girişte yenilenir (rotasyon).
-- * CİHAZ ÇEREZİ `<tenant kimliği>.<rastgele belirteç>`: tenant doğrudan bulunur; DB'de yalnız belirtecin özeti.
-- * GİRİŞ YOLU (wms_auth): `field_signin_begin` (alan + kullanıcı adı + cihaz özeti → PIN özeti ya da ret nedeni; cihaz, tenant, üyelik,
--   YALNIZ saha rolü, kilit burada) → uygulama Argon2 doğrular → `field_signin_finish` (başarı: sayaç sıfır, belirteç rotasyonu; hata:
--   sayaç, 5'te 15 dk kilit, 3. kilitte yönetici açana dek). Etkinleştirme `field_activate` (kod tek kullanım + PIN + kişisel cihaz kaydı).
--   Cihaz durumu `field_device_status` (giriş ekranı bandı; yalnız tenant/cihaz adı). Bütün işlevler tenant bağlamını yalnız ilgili satır
--   için transaction-yerel kurar ve geri yükler (0042 kalıbı; probe'a faz 2 tablo politikası yok, AC-04).
-- * Hesap keşfi yok: bilinmeyen alan/kullanıcı/kayıtsız cihaz aynı genel ret (`DENIED`) — yalnız kilit ayrı bildirilir (personel yöneticiye
--   gider). Ayrıntılı neden yalnız güvenlik olayında.
-- * GÜVENLİK OLAYLARI `field_login.*`, `field_pin.*`, `device.*`: yalnız probe işlevleri yazar (tetikleyici kuralı genişletildi).
--   Olay detayı: tenant, kullanıcı, cihaz kimliği, neden; PIN/kod/belirteç asla.
-- Koşturucu tek transaction içinde çalıştırır.

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('wms_platform.charges') IS NULL THEN
    RAISE EXCEPTION '0044_field_logins: 0043 önkoşulu yok';
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------------------------
-- 1. Tablolar
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.field_logins (
  tenant_id              uuid        NOT NULL,
  id                     uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id                uuid        NOT NULL,
  membership_id          uuid        NOT NULL,
  username               text        NOT NULL,
  pin_hash               text,
  pin_set_at             timestamptz,
  activation_hash        text,
  activation_expires_at  timestamptz,
  failed_count           integer     NOT NULL DEFAULT 0,
  lock_count             integer     NOT NULL DEFAULT 0,
  locked_until           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid,
  CONSTRAINT field_logins_pkey PRIMARY KEY (id),
  CONSTRAINT field_logins_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT field_logins_tenant_username_key UNIQUE (tenant_id, username),
  CONSTRAINT field_logins_user_key UNIQUE (user_id),
  CONSTRAINT field_logins_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants (id),
  CONSTRAINT field_logins_user_fkey FOREIGN KEY (user_id) REFERENCES public.users (id),
  CONSTRAINT field_logins_membership_fkey FOREIGN KEY (tenant_id, membership_id) REFERENCES public.tenant_memberships (tenant_id, id),
  CONSTRAINT field_logins_username_chk CHECK (username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
  CONSTRAINT field_logins_pin_chk CHECK ((pin_hash IS NULL) = (pin_set_at IS NULL) AND (pin_hash IS NULL OR pin_hash LIKE '$argon2id$%')),
  CONSTRAINT field_logins_activation_chk CHECK ((activation_hash IS NULL) = (activation_expires_at IS NULL)
                                                AND (activation_hash IS NULL OR activation_hash ~ '^[0-9a-f]{64}$')),
  CONSTRAINT field_logins_counts_chk CHECK (failed_count >= 0 AND lock_count >= 0)
);
CREATE INDEX field_logins_activation_idx ON public.field_logins (activation_hash) WHERE activation_hash IS NOT NULL;

CREATE TABLE public.field_devices (
  tenant_id     uuid        NOT NULL,
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  token_hash    text        NOT NULL,
  kind          text        NOT NULL,
  user_id       uuid,
  name          text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  last_used_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '180 days',
  revoked_at    timestamptz,
  revoked_by    uuid,
  CONSTRAINT field_devices_pkey PRIMARY KEY (id),
  CONSTRAINT field_devices_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT field_devices_token_key UNIQUE (token_hash),
  CONSTRAINT field_devices_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants (id),
  CONSTRAINT field_devices_user_fkey FOREIGN KEY (user_id) REFERENCES public.users (id),
  CONSTRAINT field_devices_kind_chk CHECK (kind IN ('PERSONAL', 'SHARED') AND ((kind = 'PERSONAL') = (user_id IS NOT NULL))),
  CONSTRAINT field_devices_token_chk CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT field_devices_name_chk CHECK (pg_catalog.length(name) BETWEEN 1 AND 60)
);

ALTER TABLE public.field_logins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_logins FORCE ROW LEVEL SECURITY;
ALTER TABLE public.field_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_devices FORCE ROW LEVEL SECURITY;
CREATE POLICY field_logins_isolation ON public.field_logins
  USING      (tenant_id = NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY field_devices_isolation ON public.field_devices
  USING      (tenant_id = NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid);

REVOKE ALL ON public.field_logins, public.field_devices FROM PUBLIC;
-- Uygulama (yönetici ekranı): okuma yalnız özet dışı sütunlar; ekleme (hesap açılışında kod özetiyle); kilit açma işlevle.
GRANT SELECT (tenant_id, id, user_id, membership_id, username, pin_set_at, activation_expires_at, failed_count, lock_count, locked_until,
              created_at, created_by) ON public.field_logins TO wms_app;
GRANT INSERT (tenant_id, id, user_id, membership_id, username, activation_hash, activation_expires_at, created_by) ON public.field_logins TO wms_app;
GRANT SELECT (tenant_id, id, kind, user_id, name, created_at, created_by, last_used_at, expires_at, revoked_at, revoked_by)
  ON public.field_devices TO wms_app;
GRANT UPDATE (revoked_at, revoked_by) ON public.field_devices TO wms_app;
-- Probe (giriş/etkinleştirme işlevleri): bağlam yalnız ilgili satır için kurulur.
GRANT SELECT ON public.field_logins, public.field_devices TO wms_identity_probe;
GRANT UPDATE (pin_hash, pin_set_at, activation_hash, activation_expires_at, failed_count, lock_count, locked_until)
  ON public.field_logins TO wms_identity_probe;
GRANT INSERT (tenant_id, token_hash, kind, user_id, name, created_by) ON public.field_devices TO wms_identity_probe;
GRANT UPDATE (token_hash, last_used_at, revoked_at) ON public.field_devices TO wms_identity_probe;

-- ---------------------------------------------------------------------------------------------
-- 2. Güvenlik olayı yazar kuralı: saha giriş/PIN/cihaz olaylarını yalnız probe işlevleri yazar (0038 gövdesi + yeni önekler)
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
  IF pg_catalog.lower(NEW.event_type) ~ '^(platform[_.]|field_login[_.]|field_pin[_.]|device[_.])' AND current_user::text <> 'wms_identity_probe' THEN
    RAISE EXCEPTION 'security_events: platform/saha olayı (%) yalnızca tanımlı işlevlerle yazılabilir', NEW.event_type
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$fn$;

-- ---------------------------------------------------------------------------------------------
-- 3. İşlevler (SET ROLE kalıbı)
-- ---------------------------------------------------------------------------------------------
GRANT CREATE ON SCHEMA wms_probe TO wms_identity_probe;
SET ROLE wms_identity_probe;

-- Cihaz durumu (giriş ekranı bandı): çerez `<tenant>.<belirteç>`; kayıtlı ve geçerliyse tenant adı/adresi, cihaz adı ve türü.
-- Bilinmeyen/iptal/süresi dolmuş/boşta kalmış → boş.
CREATE FUNCTION wms_probe.field_device_status(p_tenant uuid, p_token_hash text)
RETURNS TABLE (slug text, tenant_name text, device_name text, kind text)
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
    SELECT t.slug, t.name, d.name, d.kind
      FROM public.field_devices d JOIN public.tenants t ON t.id = d.tenant_id
     WHERE d.tenant_id = p_tenant AND d.token_hash = p_token_hash AND d.revoked_at IS NULL AND d.expires_at > now()
       AND d.last_used_at > now() - interval '60 days' AND t.status = 'ACTIVE' AND NOT t.is_demo;
  PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
END
$fn$;

-- Giriş başlangıcı: alan + kullanıcı adı + cihaz özeti. Sonuç: OK (PIN özeti ve kimlikler), DENIED (genel), LOCKED.
CREATE FUNCTION wms_probe.field_signin_begin(p_slug text, p_username text, p_token_hash text)
RETURNS TABLE (outcome text, login_id uuid, tenant_id uuid, user_id uuid, device_id uuid, pin_hash text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_prev text := pg_catalog.current_setting('app.current_tenant_id', true);
  v_tenant uuid;
  v_l public.field_logins%ROWTYPE;
  v_d public.field_devices%ROWTYPE;
  v_reason text;
  v_admin boolean;
BEGIN
  SELECT t.id INTO v_tenant FROM public.tenants t
   WHERE t.slug = pg_catalog.lower(pg_catalog.btrim(coalesce(p_slug, ''))) AND t.status = 'ACTIVE' AND NOT t.is_demo;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'DENIED'::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  PERFORM pg_catalog.set_config('app.current_tenant_id', v_tenant::text, true);
  SELECT * INTO v_l FROM public.field_logins l
   WHERE l.tenant_id = v_tenant AND l.username = pg_catalog.lower(pg_catalog.btrim(coalesce(p_username, ''))) FOR UPDATE;
  IF NOT FOUND THEN
    v_reason := 'unknown_user';
  ELSE
    SELECT * INTO v_d FROM public.field_devices d
     WHERE d.tenant_id = v_tenant AND d.token_hash = coalesce(p_token_hash, '') AND d.revoked_at IS NULL AND d.expires_at > now()
       AND d.last_used_at > now() - interval '60 days';
    -- Yönetim rolü bu yoldan ASLA (rol her girişte yeniden okunur; ADR-026 §7.6, koşul 5).
    SELECT EXISTS (SELECT 1 FROM public.membership_roles r WHERE r.tenant_id = v_tenant AND r.membership_id = v_l.membership_id
                     AND r.role_key NOT IN ('PICKER', 'COUNTER'))
           OR NOT EXISTS (SELECT 1 FROM public.membership_roles r WHERE r.tenant_id = v_tenant AND r.membership_id = v_l.membership_id)
           OR NOT EXISTS (SELECT 1 FROM public.tenant_memberships m WHERE m.tenant_id = v_tenant AND m.id = v_l.membership_id AND m.status = 'ACTIVE')
      INTO v_admin;
    IF v_d.id IS NULL THEN
      v_reason := 'device';
    ELSIF v_d.kind = 'PERSONAL' AND v_d.user_id <> v_l.user_id THEN
      v_reason := 'device_user';
    ELSIF v_admin THEN
      v_reason := 'role';
    ELSIF v_l.pin_hash IS NULL THEN
      v_reason := 'no_pin';
    ELSIF v_l.locked_until IS NOT NULL AND v_l.locked_until > now() THEN
      PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
      INSERT INTO public.security_events (user_id, event_type, detail)
      VALUES (v_l.user_id, 'field_login.failed', pg_catalog.jsonb_build_object('tenant_id', v_tenant::text, 'reason', 'locked',
              'device_id', v_d.id::text));
      RETURN QUERY SELECT 'LOCKED'::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text;
      RETURN;
    END IF;
  END IF;
  PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
  IF v_reason IS NOT NULL THEN
    INSERT INTO public.security_events (user_id, event_type, detail)
    VALUES (v_l.user_id, 'field_login.failed', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('tenant_id', v_tenant::text,
            'reason', v_reason, 'device_id', v_d.id::text)));
    RETURN QUERY SELECT 'DENIED'::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'OK'::text, v_l.id, v_tenant, v_l.user_id, v_d.id, v_l.pin_hash;
END
$fn$;

-- Giriş sonucu: başarıda sayaç sıfırlanır ve cihaz belirteci yenilenir (yeni özet); hatada sayaç artar, 5'te 15 dk kilit, 3. kilitte
-- yönetici açana dek. Sonuç: OK / DENIED / LOCKED.
CREATE FUNCTION wms_probe.field_signin_finish(p_tenant uuid, p_login uuid, p_device uuid, p_ok boolean, p_new_token_hash text)
RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_prev text := pg_catalog.current_setting('app.current_tenant_id', true);
  v_l public.field_logins%ROWTYPE;
  v_out text;
BEGIN
  IF p_ok AND (p_new_token_hash IS NULL OR p_new_token_hash !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'field_signin_finish: belirteç biçimsiz' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(p_tenant::text, ''), true);
  SELECT * INTO v_l FROM public.field_logins l WHERE l.tenant_id = p_tenant AND l.id = p_login FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
    RAISE EXCEPTION 'field_signin_finish: giriş yok' USING ERRCODE = 'P0002';
  END IF;
  IF p_ok THEN
    UPDATE public.field_logins l SET failed_count = 0, lock_count = 0, locked_until = NULL WHERE l.id = p_login;
    UPDATE public.field_devices d SET token_hash = p_new_token_hash, last_used_at = now()
     WHERE d.tenant_id = v_l.tenant_id AND d.id = p_device AND d.revoked_at IS NULL;
    IF NOT FOUND THEN
      v_out := 'DENIED';
    ELSE
      v_out := 'OK';
    END IF;
  ELSE
    UPDATE public.field_logins l SET failed_count = l.failed_count + 1 WHERE l.id = p_login RETURNING * INTO v_l;
    IF v_l.failed_count >= 5 THEN
      UPDATE public.field_logins l
         SET failed_count = 0, lock_count = l.lock_count + 1,
             locked_until = CASE WHEN l.lock_count + 1 >= 3 THEN 'infinity'::timestamptz ELSE now() + interval '15 minutes' END
       WHERE l.id = p_login RETURNING * INTO v_l;
      v_out := 'LOCKED';
    ELSE
      v_out := 'DENIED';
    END IF;
  END IF;
  PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
  INSERT INTO public.security_events (user_id, event_type, detail)
  VALUES (v_l.user_id, CASE v_out WHEN 'OK' THEN 'field_login.succeeded' WHEN 'LOCKED' THEN 'field_login.locked' ELSE 'field_login.failed' END,
          pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('tenant_id', v_l.tenant_id::text, 'device_id', p_device::text,
            'reason', CASE WHEN v_out = 'OK' THEN NULL WHEN p_ok THEN 'device_revoked' ELSE 'pin' END,
            'lock_count', CASE WHEN v_out = 'LOCKED' THEN v_l.lock_count END)));
  RETURN v_out;
END
$fn$;

-- Etkinleştirme: alan + kullanıcı adı + kod özeti + yeni PIN özeti + yeni kişisel cihaz belirteci özeti. Kod tek kullanım; doğruysa PIN
-- yazılır, kişisel cihaz kaydolur, kilit sıfırlanır. Yanlış kod giriş hata sayacını artırır (kod tahmini de kilitlenir).
-- Sonuç: (OK, kullanıcı, tenant, cihaz) / DENIED / LOCKED.
CREATE FUNCTION wms_probe.field_activate(p_slug text, p_username text, p_code_hash text, p_pin_hash text, p_token_hash text,
                                         p_device_name text)
RETURNS TABLE (outcome text, user_id uuid, tenant_id uuid, device_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_prev text := pg_catalog.current_setting('app.current_tenant_id', true);
  v_tenant uuid;
  v_l public.field_logins%ROWTYPE;
  v_dev uuid;
  v_role_ok boolean;
BEGIN
  IF p_pin_hash IS NULL OR p_pin_hash NOT LIKE '$argon2id$%' OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$'
     OR p_code_hash IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'field_activate: girdi biçimsiz' USING ERRCODE = '22023';
  END IF;
  SELECT t.id INTO v_tenant FROM public.tenants t
   WHERE t.slug = pg_catalog.lower(pg_catalog.btrim(coalesce(p_slug, ''))) AND t.status = 'ACTIVE' AND NOT t.is_demo;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'DENIED'::text, NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  PERFORM pg_catalog.set_config('app.current_tenant_id', v_tenant::text, true);
  SELECT * INTO v_l FROM public.field_logins l
   WHERE l.tenant_id = v_tenant AND l.username = pg_catalog.lower(pg_catalog.btrim(coalesce(p_username, ''))) FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
    RETURN QUERY SELECT 'DENIED'::text, NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  IF v_l.locked_until IS NOT NULL AND v_l.locked_until > now() THEN
    PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
    RETURN QUERY SELECT 'LOCKED'::text, NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  SELECT NOT EXISTS (SELECT 1 FROM public.membership_roles r WHERE r.tenant_id = v_tenant AND r.membership_id = v_l.membership_id
                       AND r.role_key NOT IN ('PICKER', 'COUNTER'))
         AND EXISTS (SELECT 1 FROM public.tenant_memberships m WHERE m.tenant_id = v_tenant AND m.id = v_l.membership_id AND m.status = 'ACTIVE')
    INTO v_role_ok;
  IF v_l.activation_hash IS NULL OR v_l.activation_expires_at <= now() OR v_l.activation_hash <> p_code_hash OR NOT v_role_ok THEN
    UPDATE public.field_logins l SET failed_count = l.failed_count + 1 WHERE l.id = v_l.id RETURNING * INTO v_l;
    IF v_l.failed_count >= 5 THEN
      UPDATE public.field_logins l SET failed_count = 0, lock_count = l.lock_count + 1,
             locked_until = CASE WHEN l.lock_count + 1 >= 3 THEN 'infinity'::timestamptz ELSE now() + interval '15 minutes' END
       WHERE l.id = v_l.id;
    END IF;
    PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
    INSERT INTO public.security_events (user_id, event_type, detail)
    VALUES (v_l.user_id, 'field_pin.failed', pg_catalog.jsonb_build_object('tenant_id', v_tenant::text,
            'reason', CASE WHEN NOT v_role_ok THEN 'role' ELSE 'code' END));
    RETURN QUERY SELECT 'DENIED'::text, NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  UPDATE public.field_logins l
     SET pin_hash = p_pin_hash, pin_set_at = now(), activation_hash = NULL, activation_expires_at = NULL,
         failed_count = 0, lock_count = 0, locked_until = NULL
   WHERE l.id = v_l.id;
  -- Kişinin önceki kişisel cihazları iptal (yeni kod = eski PIN ve cihazlar geçersiz; ADR-026 §7.8).
  UPDATE public.field_devices d SET revoked_at = now()
   WHERE d.tenant_id = v_tenant AND d.kind = 'PERSONAL' AND d.user_id = v_l.user_id AND d.revoked_at IS NULL;
  INSERT INTO public.field_devices (tenant_id, token_hash, kind, user_id, name, created_by)
  VALUES (v_tenant, p_token_hash, 'PERSONAL', v_l.user_id,
          coalesce(NULLIF(pg_catalog.left(pg_catalog.btrim(coalesce(p_device_name, '')), 60), ''), 'Kişisel telefon'), v_l.user_id)
  RETURNING id INTO v_dev;
  PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
  INSERT INTO public.security_events (user_id, event_type, detail)
  VALUES (v_l.user_id, 'field_pin.set', pg_catalog.jsonb_build_object('tenant_id', v_tenant::text, 'device_id', v_dev::text));
  INSERT INTO public.security_events (user_id, event_type, detail)
  VALUES (v_l.user_id, 'device.enrolled', pg_catalog.jsonb_build_object('tenant_id', v_tenant::text, 'device_id', v_dev::text, 'kind', 'PERSONAL'));
  RETURN QUERY SELECT 'OK'::text, v_l.user_id, v_tenant, v_dev;
END
$fn$;

-- Yönetici (uygulama, tenant bağlamı zorunlu; `users.manage` uygulamada): yeni etkinleştirme kodu özeti yazar (eski PIN ve kişisel
-- cihazlar geçersiz, kilit açılır) ya da yalnız kilidi açar. Oturum kapatma uygulamada (Better Auth oturumları).
CREATE FUNCTION wms_probe.field_admin_reset(p_login uuid, p_code_hash text, p_actor uuid)
RETURNS uuid
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_ctx uuid := NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid;
  v_l public.field_logins%ROWTYPE;
BEGIN
  IF v_ctx IS NULL THEN
    RAISE EXCEPTION 'field_admin_reset: tenant bağlamı yok' USING ERRCODE = '42501';
  END IF;
  IF p_code_hash IS NOT NULL AND p_code_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'field_admin_reset: kod biçimsiz' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_l FROM public.field_logins l WHERE l.tenant_id = v_ctx AND l.id = p_login FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'field_admin_reset: saha hesabı yok' USING ERRCODE = 'P0002';
  END IF;
  IF p_code_hash IS NULL THEN
    UPDATE public.field_logins l SET failed_count = 0, lock_count = 0, locked_until = NULL WHERE l.id = v_l.id;
  ELSE
    UPDATE public.field_logins l
       SET pin_hash = NULL, pin_set_at = NULL, activation_hash = p_code_hash, activation_expires_at = now() + interval '24 hours',
           failed_count = 0, lock_count = 0, locked_until = NULL
     WHERE l.id = v_l.id;
    UPDATE public.field_devices d SET revoked_at = now()
     WHERE d.tenant_id = v_ctx AND d.kind = 'PERSONAL' AND d.user_id = v_l.user_id AND d.revoked_at IS NULL;
  END IF;
  INSERT INTO public.security_events (user_id, event_type, detail)
  VALUES (p_actor, CASE WHEN p_code_hash IS NULL THEN 'field_login.unlocked' ELSE 'field_pin.reset' END,
          pg_catalog.jsonb_build_object('tenant_id', v_ctx::text, 'field_user_id', v_l.user_id::text));
  RETURN v_l.user_id;
END
$fn$;

REVOKE ALL ON FUNCTION wms_probe.field_device_status(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.field_signin_begin(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.field_signin_finish(uuid, uuid, uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.field_activate(text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.field_admin_reset(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wms_probe.field_device_status(uuid, text) TO wms_auth;
GRANT EXECUTE ON FUNCTION wms_probe.field_signin_begin(text, text, text) TO wms_auth;
GRANT EXECUTE ON FUNCTION wms_probe.field_signin_finish(uuid, uuid, uuid, boolean, text) TO wms_auth;
GRANT EXECUTE ON FUNCTION wms_probe.field_activate(text, text, text, text, text, text) TO wms_auth;
GRANT EXECUTE ON FUNCTION wms_probe.field_admin_reset(uuid, text, uuid) TO wms_app;

RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;

DO $verify$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['field_device_status', 'field_signin_begin', 'field_signin_finish', 'field_activate', 'field_admin_reset'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'wms_probe' AND p.proname = f AND p.prosecdef AND p.proowner = 'wms_identity_probe'::regrole
                      AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']) THEN
      RAISE EXCEPTION '0044_field_logins: % beklenen biçimde değil', f;
    END IF;
  END LOOP;
  IF pg_catalog.has_column_privilege('wms_app', 'public.field_logins', 'pin_hash', 'SELECT')
     OR pg_catalog.has_column_privilege('wms_app', 'public.field_logins', 'activation_hash', 'SELECT')
     OR pg_catalog.has_column_privilege('wms_app', 'public.field_devices', 'token_hash', 'SELECT')
     OR pg_catalog.has_any_column_privilege('wms_auth', 'public.field_logins', 'SELECT') THEN
    RAISE EXCEPTION '0044_field_logins: özet sütunları uygulama/kimlik rolüne açık';
  END IF;
END
$verify$;
