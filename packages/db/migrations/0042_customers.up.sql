-- 0042_customers (T-403, ADR-027 §2–3): panelde müşteriler — yalnız sayılar ve işletim durumu; askıya al / devam ettir / deneme
-- uzat / paket değiştir. G-08: yalnızca GENİŞLETME (probe'a dar sütun yetkileri + okuma politikaları, abonelik türüne 'ACTIVE', beş işlev).
--
-- BİLİNÇLİ KARARLAR (inceleme için):
-- * VERİ SINIRI (I-01, ADR-027 §2): panel müşteri içeriğini GÖRMEZ. İşlevler yalnız sayı, tarih ve durum döner (ürün adı, depo adı,
--   kişi, stok miktarı yok). Sayım için probe'a YALNIZ sayım sütunlarında SELECT verilir (warehouses/items: tenant_id, status,
--   is_sample; stock_ledger: tenant_id, occurred_at; sessions: user_id, created_at; security_events: olay türü/detay/zaman). Faz 2 tenant
--   tablolarına probe politikası EKLENMEZ (AC-04: yalnız TO'suz izolasyon politikası): işlevler her tenant için bağlamı transaction-yerel
--   kurup mevcut izolasyon politikasıyla sayar ve önceki bağlamı geri yükler. Probe NOLOGIN'dir; bu yetkiler yalnız aşağıdaki
--   operatör denetimli SECURITY DEFINER işlevlerinde kullanılır. Uygulama rollerine tenant tablolarında yeni yetki YOK (AC-04).
-- * DURUM: tenants.status ACTIVE ↔ SUSPENDED probe ile değişir: yalnız UPDATE (status) sütun yetkisi; probe'a YAZMA POLİTİKASI YOK
--   (AC-04). İşlev, yalnız o satır için tenant bağlamını transaction-yerel kurar (mevcut izolasyon politikası), günceller ve önceki
--   bağlamı geri yükler; yalnız ACTIVE ↔ SUSPENDED (demo ve CLOSING hariç). Askıdaki tenant'ta mevcut `TENANT_SUSPENDED` davranışı geçerlidir; veri silinmez.
--   Askıya alma gerekçe ister (1–300 karakter); devam ettirmede gerekçe isteğe bağlı (tasarım: tek düğme).
-- * DENEME UZATMA: yalnız abonelik türü TRIAL ve tenant ACTIVE iken, 30 gün; en çok 365 gün ileri.
-- * PAKET DEĞİŞTİRME: müşteriye paketin GÜNCEL sürümü atanır (yükseltme/düşürme hemen; dönem/ödeme T-405/T-406 ile gelir). Mevcut
--   veri silinmez; sınırı aşan kullanımda yalnız yeni ekleme reddedilir (0041 tetikleyicisi). Aboneliği olmayan (aktivasyon öncesi
--   açılmış) tenant'a 'ACTIVE' türünde abonelik satırı açılır; bunun için `subscriptions_plan_chk` 'ACTIVE' değerini de kabul eder
--   (deneme bitiş tarihi olmayan, operatörce yönetilen abonelik).
-- * GÜVENLİK OLAYLARI (operatör ve tenant kimliği, kişisel veri yok): `platform.tenant.suspended` (+ gerekçe), `platform.tenant.resumed`,
--   `platform.trial.extended` (+ yeni bitiş), `platform.plan.changed` (+ paket/sürüm). Müşteri geçmişi bunlardan okunur.
-- * Demo tenant'lar (is_demo) listelenmez ve işlemlere kapalıdır.
-- Koşturucu tek transaction içinde çalıştırır.

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('wms_platform.plans') IS NULL THEN
    RAISE EXCEPTION '0042_customers: wms_platform.plans yok (0041 önkoşulu)';
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------------------------
-- 1. Abonelik türü ve probe yetkileri
-- ---------------------------------------------------------------------------------------------
ALTER TABLE wms_platform.subscriptions DROP CONSTRAINT subscriptions_plan_chk;
ALTER TABLE wms_platform.subscriptions ADD CONSTRAINT subscriptions_plan_chk CHECK (plan IN ('TRIAL', 'ACTIVE'));
ALTER TABLE wms_platform.subscriptions ADD CONSTRAINT subscriptions_active_plan_chk CHECK (plan <> 'ACTIVE' OR plan_id IS NOT NULL);
GRANT UPDATE (trial_ends_at) ON wms_platform.subscriptions TO wms_identity_probe;

GRANT SELECT (tenant_id, status, is_sample) ON public.warehouses TO wms_identity_probe;
GRANT SELECT (tenant_id, status, is_sample) ON public.items TO wms_identity_probe;
GRANT SELECT (tenant_id, occurred_at) ON public.stock_ledger TO wms_identity_probe;
GRANT SELECT (user_id, created_at) ON public.sessions TO wms_identity_probe;
GRANT SELECT (occurred_at, user_id, event_type, detail) ON public.security_events TO wms_identity_probe;
GRANT UPDATE (status) ON public.tenants TO wms_identity_probe;
GRANT EXECUTE ON FUNCTION public.plan_member_class(uuid, uuid, text) TO wms_identity_probe;
GRANT EXECUTE ON FUNCTION public.plan_member_count(uuid, text, uuid) TO wms_identity_probe;

-- Müşteri geçmişi araması (inceleme MINOR-3): yalnız platform olayları, tenant + zaman.
CREATE INDEX security_events_platform_tenant_idx ON public.security_events ((detail ->> 'tenant_id'), occurred_at)
  WHERE event_type LIKE 'platform.%';


-- ---------------------------------------------------------------------------------------------
-- 2. İşlevler (SET ROLE kalıbı, 0038–0041 ile aynı)
-- ---------------------------------------------------------------------------------------------
GRANT CREATE ON SCHEMA wms_probe TO wms_identity_probe;
SET ROLE wms_identity_probe;

-- Operatör: müşteriler (demo hariç), paket ve sayılarıyla. İçerik sütunu yok. Depo/ürün sayımı için probe'a politika VERİLMEZ (AC-04:
-- faz 2 tenant tablolarında yalnız TO'suz izolasyon politikası): her tenant için bağlam transaction-yerel kurulur, sayılır, sonra önceki
-- bağlam geri yüklenir.
CREATE FUNCTION wms_probe.platform_list_customers()
RETURNS TABLE (id uuid, name text, slug text, status text, created_at timestamptz, subscription text, trial_ends_at timestamptz,
               plan_id uuid, plan_name text, price_monthly numeric, max_admins integer, max_field integer, max_warehouses integer,
               max_items integer, admins integer, field integer, warehouses integer, items integer, last_login timestamptz)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  r record;
  v_prev text;
BEGIN
  IF NOT wms_probe.platform_is_operator() THEN
    RAISE EXCEPTION 'platform_list_customers: operatör değil' USING ERRCODE = '42501';
  END IF;
  v_prev := pg_catalog.current_setting('app.current_tenant_id', true);
  FOR r IN
    SELECT t.id AS tid, t.name AS tname, t.slug AS tslug, t.status AS tstatus, t.created_at AS tcreated, s.plan AS splan,
           s.trial_ends_at AS strial, p.id AS pid, p.name AS pname, v.price_monthly AS vprice, v.max_admins AS vadm,
           v.max_field AS vfield, v.max_warehouses AS vwh, v.max_items AS vitems
      FROM public.tenants t
      LEFT JOIN wms_platform.subscriptions s ON s.tenant_id = t.id
      LEFT JOIN wms_platform.plans p ON p.id = s.plan_id
      LEFT JOIN wms_platform.plan_versions v ON v.plan_id = s.plan_id AND v.version = s.plan_version
     WHERE NOT t.is_demo
     ORDER BY t.created_at DESC, t.id
  LOOP
    PERFORM pg_catalog.set_config('app.current_tenant_id', r.tid::text, true);
    id := r.tid; name := r.tname; slug := r.tslug; status := r.tstatus; created_at := r.tcreated; subscription := r.splan;
    trial_ends_at := r.strial; plan_id := r.pid; plan_name := r.pname; price_monthly := r.vprice; max_admins := r.vadm;
    max_field := r.vfield; max_warehouses := r.vwh; max_items := r.vitems;
    admins := public.plan_member_count(r.tid, 'admins', NULL)::integer;
    field := public.plan_member_count(r.tid, 'field', NULL)::integer;
    SELECT count(*)::integer INTO warehouses FROM public.warehouses w WHERE w.tenant_id = r.tid AND w.status = 'ACTIVE' AND NOT w.is_sample;
    SELECT count(*)::integer INTO items FROM public.items i WHERE i.tenant_id = r.tid AND i.status = 'ACTIVE' AND NOT i.is_sample;
    SELECT max(se.created_at) INTO last_login FROM public.sessions se
     WHERE se.user_id IN (SELECT m.user_id FROM public.tenant_memberships m WHERE m.tenant_id = r.tid AND m.status = 'ACTIVE');
    RETURN NEXT;
  END LOOP;
  PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
END
$fn$;

-- Operatör: müşterinin bu ayki (İstanbul) stok hareketi sayısı ve panel/aktivasyon geçmişi (en yeni 20). Kişisel veri yok.
CREATE FUNCTION wms_probe.platform_customer_activity(p_tenant uuid)
RETURNS TABLE (moves_month integer, at timestamptz, kind text, info jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_moves integer;
  v_prev text;
  v_from timestamptz := pg_catalog.date_trunc('month', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul';
BEGIN
  IF NOT wms_probe.platform_is_operator() THEN
    RAISE EXCEPTION 'platform_customer_activity: operatör değil' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = p_tenant AND NOT t.is_demo) THEN
    RAISE EXCEPTION 'platform_customer_activity: müşteri yok' USING ERRCODE = 'P0002';
  END IF;
  -- Sayım izolasyon politikasından geçer (probe'a defter politikası yok, AC-04): bağlam yalnız sayım için kurulur ve geri yüklenir.
  v_prev := pg_catalog.current_setting('app.current_tenant_id', true);
  PERFORM pg_catalog.set_config('app.current_tenant_id', p_tenant::text, true);
  SELECT count(*)::integer INTO v_moves FROM public.stock_ledger l WHERE l.tenant_id = p_tenant AND l.occurred_at >= v_from;
  PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
  RETURN QUERY
    SELECT v_moves, h.at, h.kind, h.info FROM (
      SELECT e.occurred_at AS at, e.event_type AS kind, (e.detail - 'tenant_id') AS info
        FROM public.security_events e
       WHERE e.event_type IN ('platform.tenant.suspended', 'platform.tenant.resumed', 'platform.trial.extended',
                              'platform.plan.changed', 'platform.plan.assigned')
         AND e.detail ->> 'tenant_id' = p_tenant::text
      UNION ALL
      SELECT s.started_at, 'trial.started', pg_catalog.jsonb_build_object('subscription', s.plan)
        FROM wms_platform.subscriptions s WHERE s.tenant_id = p_tenant AND s.demo_request_id IS NOT NULL
      UNION ALL
      SELECT d.decided_at, 'demo.approved', '{}'::jsonb
        FROM wms_platform.subscriptions s JOIN wms_platform.demo_requests d ON d.id = s.demo_request_id
       WHERE s.tenant_id = p_tenant AND d.decided_at IS NOT NULL
      ORDER BY 1 DESC LIMIT 20
    ) h
    UNION ALL
    SELECT v_moves, NULL::timestamptz, NULL::text, NULL::jsonb
    ORDER BY 2 DESC NULLS LAST;
END
$fn$;

-- Operatör: askıya al (gerekçe zorunlu) ya da devam ettir. Durum zaten istenen değerdeyse hiçbir şey yazılmaz (false döner).
CREATE FUNCTION wms_probe.platform_set_customer_status(p_tenant uuid, p_suspend boolean, p_reason text) RETURNS boolean
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_uid uuid;
  v_reason text := NULLIF(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_status text;
  v_prev text;
BEGIN
  IF NOT wms_probe.platform_is_operator() THEN
    RAISE EXCEPTION 'platform_set_customer_status: operatör değil' USING ERRCODE = '42501';
  END IF;
  v_uid := NULLIF(pg_catalog.current_setting('app.current_user_id', true), '')::uuid;
  IF p_suspend IS NULL OR (p_suspend AND v_reason IS NULL) OR pg_catalog.length(coalesce(v_reason, '')) > 300
     OR coalesce(v_reason, '') ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'platform_set_customer_status: gerekçe biçimsiz' USING ERRCODE = '22023';
  END IF;
  -- Probe'a tenant tablosunda YAZMA POLİTİKASI verilmez (AC-04: probe politikaları yalnız SELECT). Kilit ve güncelleme mevcut izolasyon
  -- politikasından geçer: bağlam yalnız bu satır için transaction-yerel kurulur ve işlev bitmeden önceki değerine döndürülür.
  v_prev := pg_catalog.current_setting('app.current_tenant_id', true);
  PERFORM pg_catalog.set_config('app.current_tenant_id', p_tenant::text, true);
  SELECT t.status INTO v_status FROM public.tenants t WHERE t.id = p_tenant AND NOT t.is_demo FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform_set_customer_status: müşteri yok' USING ERRCODE = 'P0002';
  END IF;
  IF v_status NOT IN ('ACTIVE', 'SUSPENDED') THEN
    RAISE EXCEPTION 'platform_set_customer_status: durum değiştirilemez' USING ERRCODE = '55000';
  END IF;
  IF (v_status = 'SUSPENDED') <> p_suspend THEN
    UPDATE public.tenants t SET status = CASE WHEN p_suspend THEN 'SUSPENDED' ELSE 'ACTIVE' END WHERE t.id = p_tenant;
  END IF;
  PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
  IF (v_status = 'SUSPENDED') = p_suspend THEN
    RETURN false;
  END IF;
  INSERT INTO public.security_events (user_id, event_type, detail)
  VALUES (v_uid, CASE WHEN p_suspend THEN 'platform.tenant.suspended' ELSE 'platform.tenant.resumed' END,
          pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('tenant_id', p_tenant::text, 'reason', v_reason)));
  RETURN true;
END
$fn$;

-- Operatör: denemeyi 30 gün uzatır (yalnız deneme aboneliği ve etkin tenant). Yeni bitişi döner.
CREATE FUNCTION wms_probe.platform_extend_trial(p_tenant uuid) RETURNS timestamptz
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_uid uuid;
  v_end timestamptz;
BEGIN
  IF NOT wms_probe.platform_is_operator() THEN
    RAISE EXCEPTION 'platform_extend_trial: operatör değil' USING ERRCODE = '42501';
  END IF;
  v_uid := NULLIF(pg_catalog.current_setting('app.current_user_id', true), '')::uuid;
  SELECT GREATEST(s.trial_ends_at, now()) + interval '30 days' INTO v_end
    FROM wms_platform.subscriptions s JOIN public.tenants t ON t.id = s.tenant_id
   WHERE s.tenant_id = p_tenant AND s.plan = 'TRIAL' AND t.status = 'ACTIVE' AND NOT t.is_demo
     FOR UPDATE OF s;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform_extend_trial: deneme aboneliği yok' USING ERRCODE = '55000';
  END IF;
  IF v_end > now() + interval '365 days' THEN
    RAISE EXCEPTION 'platform_extend_trial: deneme bir yıldan uzun olamaz' USING ERRCODE = '55000';
  END IF;
  UPDATE wms_platform.subscriptions s SET trial_ends_at = v_end WHERE s.tenant_id = p_tenant;
  INSERT INTO public.security_events (user_id, event_type, detail)
  VALUES (v_uid, 'platform.trial.extended', pg_catalog.jsonb_build_object('tenant_id', p_tenant::text, 'trial_ends_at', v_end));
  RETURN v_end;
END
$fn$;

-- Operatör: müşterinin paketini değiştirir (paketin güncel sürümü). Aboneliği yoksa 'ACTIVE' abonelik açılır. Değişmediyse false.
CREATE FUNCTION wms_probe.platform_change_customer_plan(p_tenant uuid, p_plan uuid) RETURNS boolean
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_uid uuid;
  v_ver integer;
  v_old uuid;
  v_oldver integer;
BEGIN
  IF NOT wms_probe.platform_is_operator() THEN
    RAISE EXCEPTION 'platform_change_customer_plan: operatör değil' USING ERRCODE = '42501';
  END IF;
  v_uid := NULLIF(pg_catalog.current_setting('app.current_user_id', true), '')::uuid;
  -- Tenant başına transaction kilidi: aboneliği olmayan tenant'a eşzamanlı iki ilk atama PK çakışmasına düşmez (inceleme MINOR-2).
  -- (Satır kilidi kullanılmaz: probe'un tenant tablosunda güncelleme politikası yoktur.)
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('platform.customer:' || p_tenant::text, 0));
  PERFORM 1 FROM public.tenants t WHERE t.id = p_tenant AND NOT t.is_demo AND t.status IN ('ACTIVE', 'SUSPENDED');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform_change_customer_plan: müşteri yok' USING ERRCODE = 'P0002';
  END IF;
  SELECT p.current_version INTO v_ver FROM wms_platform.plans p WHERE p.id = p_plan FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform_change_customer_plan: paket yok' USING ERRCODE = 'P0002';
  END IF;
  SELECT s.plan_id, s.plan_version INTO v_old, v_oldver FROM wms_platform.subscriptions s WHERE s.tenant_id = p_tenant FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO wms_platform.subscriptions (tenant_id, plan, trial_ends_at, plan_id, plan_version)
    VALUES (p_tenant, 'ACTIVE', NULL, p_plan, v_ver);
  ELSIF v_old IS NOT DISTINCT FROM p_plan AND v_oldver IS NOT DISTINCT FROM v_ver THEN
    RETURN false;
  ELSE
    UPDATE wms_platform.subscriptions s SET plan_id = p_plan, plan_version = v_ver WHERE s.tenant_id = p_tenant;
  END IF;
  INSERT INTO public.security_events (user_id, event_type, detail)
  VALUES (v_uid, 'platform.plan.changed',
          pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('tenant_id', p_tenant::text, 'plan_id', p_plan::text, 'version', v_ver,
                                                                     'from_plan_id', v_old::text)));
  RETURN true;
END
$fn$;

REVOKE ALL ON FUNCTION wms_probe.platform_list_customers() FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.platform_customer_activity(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.platform_set_customer_status(uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.platform_extend_trial(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.platform_change_customer_plan(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wms_probe.platform_list_customers() TO wms_app;
GRANT EXECUTE ON FUNCTION wms_probe.platform_customer_activity(uuid) TO wms_app;
GRANT EXECUTE ON FUNCTION wms_probe.platform_set_customer_status(uuid, boolean, text) TO wms_app;
GRANT EXECUTE ON FUNCTION wms_probe.platform_extend_trial(uuid) TO wms_app;
GRANT EXECUTE ON FUNCTION wms_probe.platform_change_customer_plan(uuid, uuid) TO wms_app;

RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;

-- ---------------------------------------------------------------------------------------------
-- 3. Doğrulama
-- ---------------------------------------------------------------------------------------------
DO $verify$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['platform_list_customers', 'platform_customer_activity', 'platform_set_customer_status',
                           'platform_extend_trial', 'platform_change_customer_plan'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'wms_probe' AND p.proname = f AND p.prosecdef
                      AND p.proowner = 'wms_identity_probe'::regrole
                      AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']) THEN
      RAISE EXCEPTION '0042_customers: % beklenen biçimde değil', f;
    END IF;
    IF pg_catalog.has_function_privilege('public', (SELECT p.oid FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                                                     WHERE n.nspname = 'wms_probe' AND p.proname = f), 'EXECUTE') THEN
      RAISE EXCEPTION '0042_customers: % PUBLIC çalıştırabiliyor', f;
    END IF;
  END LOOP;
  IF pg_catalog.has_table_privilege('wms_app', 'public.stock_ledger', 'DELETE') THEN
    RAISE EXCEPTION '0042_customers: beklenmeyen yetki';
  END IF;
  -- Probe'un okuyabildiği sütunlar TAM OLARAK sayım sütunları (inceleme MINOR-6: belirteç, IP, ad vb. yok).
  FOR f IN
    SELECT c.relname || '.' || a.attname
      FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
     WHERE c.oid IN ('public.warehouses'::regclass, 'public.items'::regclass, 'public.stock_ledger'::regclass,
                     'public.sessions'::regclass, 'public.security_events'::regclass)
       AND a.attnum > 0 AND NOT a.attisdropped
       AND pg_catalog.has_column_privilege('wms_identity_probe', c.oid, a.attnum, 'SELECT')
       AND c.relname || '.' || a.attname NOT IN ('warehouses.tenant_id', 'warehouses.status', 'warehouses.is_sample',
             'items.tenant_id', 'items.status', 'items.is_sample', 'stock_ledger.tenant_id', 'stock_ledger.occurred_at',
             'sessions.user_id', 'sessions.created_at', 'security_events.occurred_at', 'security_events.user_id',
             'security_events.event_type', 'security_events.detail')
  LOOP
    RAISE EXCEPTION '0042_customers: probe beklenmeyen sütunu okuyabiliyor: %', f;
  END LOOP;
END
$verify$;
