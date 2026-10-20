-- 0053_identity_read_and_join_guard (T-919; BACKLOG B-10 kısmı + B-11): veritabanında ikinci savunma.
-- G-08: genişletme + yetki daraltma; veri değişmez, silinmez.
--
-- BİLİNÇLİ KARARLAR (inceleme için):
-- * security_events (0002) RLS'siz ve wms_app tabloyu bütünüyle okuyabiliyordu (bütün müşterilerin IP / user_agent / platform olayları).
--   Uygulamadaki tek okuma (stock/jobs.ts: istekten sonra MFA/parola sıfırlandı mı) dar bir SECURITY DEFINER işleve taşınır:
--   `wms_probe.credentials_changed_since(user, since)` yalnız evet/hayır döner ve yalnız GEÇERLİ tenant'ın üyesi kullanıcı için.
--   wms_app'te yalnız `id` okuması kalır (`INSERT ... RETURNING id`, packages/db/src/audit.ts `recordSecurityEvent`); id tek başına bilgi taşımaz.
-- * team_join_requests (0052): onay kodu doğrulaması (`field_join_verify`) ile onay (wms_app UPDATE) iki ayrı transaction'dır ve
--   veritabanı onayın kodla yapıldığını bilmiyordu. Doğrulama artık talebe kim/ne zaman damgası basar (wms_app bu sütunlara yazamaz);
--   BEFORE UPDATE tetikleyicisi durum geçişlerini zorlar:
--     PENDING  → APPROVED  : yalnız aynı kullanıcı kodu son 15 dakikada doğruladıysa ve talep süresi dolmadıysa; decided_* sunucuda.
--     PENDING  → REJECTED  : decided_* sunucuda (oturum kullanıcısı).
--     PENDING  → CANCELLED : yalnız probe (3 yanlış kod); karar alanları değişmez.
--     APPROVED → CANCELLED : (PIN belirlenmeden yönetici iptali) oturum kullanıcısı zorunlu; karar alanları ve üyelik değişmez.
--     APPROVED → CLAIMED   : yalnız probe (cihaz PIN belirledi); karar alanları ve üyelik değişmez.
--   KALAN RİSK (bilinçli): kişi bağı uygulamanın kurduğu `app.current_user_id`'ye dayanır; ham SQL çalıştırabilen saldırgana karşı
--   kimlik bağı değil, asıl koruma uygulamanın okuyamadığı/yazamadığı cihaz kodudur (confirm_code, confirm_failed). Tehdit modeli:
--   uygulama hatası. `membership_id` onayda yalnız aynı-tenant FK ile sınırlıdır (etkinleştirme ayrıca saha rolü + PIN'siz hesap ister).
--   Başka her geçiş (CANCELLED/REJECTED → APPROVED dahil) ve durum değişmeden karar alanı değişikliği 42501.
--   Uygulama kodu (identity/team-join.ts) değişmeden bu sırayla çalışır: doğrula (damga) → hesap aç + onayla.
-- * Tetikleyici ENABLE ALWAYS (replica kipinde de çalışır; 0004 kalıbı).
-- Koşturucu tek transaction içinde çalıştırır.

DO $pre$
BEGIN
  IF pg_catalog.to_regprocedure('wms_probe.field_join_verify(uuid, text)') IS NULL THEN
    RAISE EXCEPTION '0053_identity_read_and_join_guard: 0052 önkoşulu yok';
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------------------------
-- (1) security_events okuması
-- ---------------------------------------------------------------------------------------------
REVOKE SELECT ON public.security_events FROM wms_app;
GRANT SELECT (id) ON public.security_events TO wms_app;

-- ---------------------------------------------------------------------------------------------
-- (2) team_join_requests: doğrulama damgası
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.team_join_requests
  ADD COLUMN code_verified_by uuid,
  ADD COLUMN code_verified_at timestamptz,
  ADD CONSTRAINT team_join_requests_verified_chk CHECK ((code_verified_by IS NULL) = (code_verified_at IS NULL));
GRANT UPDATE (code_verified_by, code_verified_at) ON public.team_join_requests TO wms_identity_probe;

CREATE FUNCTION public.team_join_requests_transition_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v_actor uuid := NULLIF(pg_catalog.current_setting('app.current_user_id', true), '')::uuid;
BEGIN
  IF NEW.status = OLD.status THEN
    IF NEW.decided_by IS DISTINCT FROM OLD.decided_by OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
       OR NEW.membership_id IS DISTINCT FROM OLD.membership_id THEN
      RAISE EXCEPTION 'team_join_requests: karar alanları durum değişmeden değiştirilemez' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'PENDING' AND NEW.status = 'APPROVED' THEN
    IF v_actor IS NULL OR OLD.code_verified_at IS NULL OR OLD.code_verified_by IS DISTINCT FROM v_actor
       OR OLD.code_verified_at <= pg_catalog.now() - interval '15 minutes' OR OLD.expires_at <= pg_catalog.now() THEN
      RAISE EXCEPTION 'team_join_requests: onay için cihaz kodu aynı kullanıcı tarafından yakın zamanda doğrulanmalı' USING ERRCODE = '42501';
    END IF;
    NEW.decided_by := v_actor;
    NEW.decided_at := pg_catalog.now();
  ELSIF OLD.status = 'PENDING' AND NEW.status = 'REJECTED' THEN
    IF v_actor IS NULL THEN
      RAISE EXCEPTION 'team_join_requests: ret için oturum kullanıcısı yok' USING ERRCODE = '42501';
    END IF;
    NEW.decided_by := v_actor;
    NEW.decided_at := pg_catalog.now();
    NEW.membership_id := OLD.membership_id;
  ELSIF (OLD.status = 'PENDING' AND NEW.status = 'CANCELLED') OR (OLD.status = 'APPROVED' AND NEW.status = 'CLAIMED') THEN
    -- Yalnız probe işlevleri: 3 yanlış kod (field_join_verify), cihazın PIN'i belirlemesi (field_join_activate).
    IF current_user <> 'wms_identity_probe' THEN
      RAISE EXCEPTION 'team_join_requests: % → % yalnız probe işleviyle', OLD.status, NEW.status USING ERRCODE = '42501';
    END IF;
    NEW.decided_by := OLD.decided_by;
    NEW.decided_at := OLD.decided_at;
    NEW.membership_id := OLD.membership_id;
  ELSIF OLD.status = 'APPROVED' AND NEW.status = 'CANCELLED' THEN
    -- Yönetici iptali (rejectJoinRequest, resetFieldCode): oturum kullanıcısı zorunlu; karar alanları ve üyelik değişmez.
    IF v_actor IS NULL THEN
      RAISE EXCEPTION 'team_join_requests: iptal için oturum kullanıcısı yok' USING ERRCODE = '42501';
    END IF;
    NEW.decided_by := OLD.decided_by;
    NEW.decided_at := OLD.decided_at;
    NEW.membership_id := OLD.membership_id;
  ELSE
    RAISE EXCEPTION 'team_join_requests: geçersiz durum geçişi % → %', OLD.status, NEW.status USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $fn$;
REVOKE ALL ON FUNCTION public.team_join_requests_transition_guard() FROM PUBLIC;
CREATE TRIGGER team_join_requests_transition_guard BEFORE UPDATE ON public.team_join_requests
  FOR EACH ROW EXECUTE FUNCTION public.team_join_requests_transition_guard();
ALTER TABLE public.team_join_requests ENABLE ALWAYS TRIGGER team_join_requests_transition_guard;

-- ---------------------------------------------------------------------------------------------
-- (3) İşlevler (SET ROLE kalıbı, 0052 ile aynı)
-- ---------------------------------------------------------------------------------------------
GRANT CREATE ON SCHEMA wms_probe TO wms_identity_probe;
SET ROLE wms_identity_probe;

-- Yönetici doğrulaması (0052 ile aynı sözleşme: OK | WRONG | GONE). Ek: OK'de doğrulayan kullanıcı ve zaman damgası; oturum
-- kullanıcısı yoksa ret (onayı yalnız damgayı basan kullanıcı yapabilir, bkz. tetikleyici).
CREATE OR REPLACE FUNCTION wms_probe.field_join_verify(p_request uuid, p_code text)
RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_tenant uuid := NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid;
  v_actor uuid := NULLIF(pg_catalog.current_setting('app.current_user_id', true), '')::uuid;
  v_r public.team_join_requests%ROWTYPE;
BEGIN
  IF v_tenant IS NULL OR v_actor IS NULL OR p_request IS NULL THEN
    RAISE EXCEPTION 'field_join_verify: tenant/kullanıcı bağlamı yok' USING ERRCODE = '42501';
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
  UPDATE public.team_join_requests r SET code_verified_by = v_actor, code_verified_at = now() WHERE r.id = v_r.id;
  RETURN 'OK';
END
$fn$;

-- İstekten sonra kullanıcının MFA faktörü/parolası değişti mi (stock/jobs.ts gönderim MFA kefaleti). Yalnız evet/hayır; yalnız
-- geçerli tenant'ın (app.current_tenant_id) üyesi olan kullanıcı için; bağlam yoksa ya da üye değilse `true` (fail-closed: kefalet
-- tanınmaz).
CREATE FUNCTION wms_probe.credentials_changed_since(p_user uuid, p_since timestamptz)
RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_tenant uuid := NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid;
BEGIN
  IF v_tenant IS NULL OR p_user IS NULL OR p_since IS NULL THEN
    RETURN true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_memberships m WHERE m.tenant_id = v_tenant AND m.user_id = p_user AND m.status = 'ACTIVE') THEN
    RETURN true;
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.security_events e
                  WHERE e.user_id = p_user AND e.occurred_at > p_since
                    AND e.event_type IN ('two_factor_disabled', 'two_factor_enabled', 'password_reset', 'password_changed'));
END
$fn$;

REVOKE ALL ON FUNCTION wms_probe.credentials_changed_since(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wms_probe.credentials_changed_since(uuid, timestamptz) TO wms_app;

RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;

DO $verify$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['field_join_verify', 'credentials_changed_since'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'wms_probe' AND p.proname = f AND p.prosecdef AND p.proowner = 'wms_identity_probe'::regrole
                      AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']) THEN
      RAISE EXCEPTION '0053: % beklenen biçimde değil', f;
    END IF;
  END LOOP;
  IF pg_catalog.has_function_privilege('public', 'wms_probe.credentials_changed_since(uuid, timestamptz)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('wms_auth', 'wms_probe.credentials_changed_since(uuid, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION '0053: credentials_changed_since yalnız wms_app';
  END IF;
  IF pg_catalog.has_column_privilege('wms_app', 'public.security_events', 'user_id', 'SELECT')
     OR pg_catalog.has_column_privilege('wms_app', 'public.security_events', 'ip', 'SELECT')
     OR pg_catalog.has_column_privilege('wms_app', 'public.security_events', 'detail', 'SELECT')
     OR NOT pg_catalog.has_column_privilege('wms_app', 'public.security_events', 'id', 'SELECT') THEN
    RAISE EXCEPTION '0053: security_events okuması wms_app için yalnız id olmalı';
  END IF;
  IF pg_catalog.has_column_privilege('wms_app', 'public.team_join_requests', 'code_verified_by', 'UPDATE')
     OR pg_catalog.has_column_privilege('wms_app', 'public.team_join_requests', 'code_verified_at', 'UPDATE') THEN
    RAISE EXCEPTION '0053: doğrulama damgası wms_app tarafından yazılabilir olmamalı';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                  WHERE t.tgrelid = 'public.team_join_requests'::regclass AND t.tgname = 'team_join_requests_transition_guard'
                    AND t.tgenabled = 'A') THEN
    RAISE EXCEPTION '0053: team_join_requests_transition_guard ENABLE ALWAYS değil';
  END IF;
END
$verify$;
