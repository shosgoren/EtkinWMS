-- 0041_plans (T-404, ADR-027 §4–6): panelde tanımlanan sürümlü paketler, müşterinin paketi ve paket sınırlarının veritabanında
-- uygulanması. G-08: yalnızca GENİŞLETME (iki platform tablosu, aboneliğe paket sütunları, beş işlev, üç sınır tetikleyicisi).
--
-- BİLİNÇLİ KARARLAR (inceleme için):
-- * PAKET PLATFORM TARAFINDA: `wms_platform.plans` (ad, sıra, yayın, önerilen) + `wms_platform.plan_versions` (fiyat, sınırlar, özellikler;
--   DEĞİŞMEZ satırlar). Fiyat/sınır/özellik değişikliği yeni sürüm açar; müşteri aboneliği bağlı olduğu sürümde kalır (ADR-027 §4: mevcut
--   müşterilere bir sonraki dönemden — dönem geçişi T-405/T-406). Uygulama rollerinin bu tablolara yetkisi YOK; yazma/okuma yalnız
--   `wms_probe.platform_*` SECURITY DEFINER işlevleriyle (operatör denetimli; yayındaki paket listesi herkese açık bilgi).
-- * SINIR 0 = SINIRSIZ. Paketi olmayan tenant (mevcut müşteriler, demo, paket atanmamış deneme) SINIRSIZDIR: kural yeni veri eklemeyi
--   yalnız paket bağlıysa sınırlar; mevcut veri hiçbir durumda silinmez (düşürme sonrası aşım korunur, yalnız yeni ekleme reddedilir).
-- * SINIR VERİTABANINDA: depo/ürün eklenirken ya da arşivden geri alınırken, üyeye rol eklenirken ya da üyelik yeniden etkinleşirken
--   BEFORE tetikleyicisi (SECURITY INVOKER) tenant'ın sınırını
--   `platform_tenant_plan_limit(tenant, tür)` ile okur, aynı tenant+tür için transaction kilidiyle sayar, aşımda 23514 `PLAN_LIMIT`.
--   İşlev yalnız çağıranın transaction-yerel tenant bağlamındaki tenant için değer döner (başka tenant → NULL = sınır yok; RLS zaten
--   bağlam dışı tenant'a yazmayı reddeder). Örnek veri (T-996 `is_sample`) ve arşivli kayıtlar sayılmaz.
-- * MÜŞTERİNİN PAKETİ: `subscriptions.plan_id/plan_version` (ikisi birlikte). Aktivasyonda önerilen yayındaki paket atanır
--   (`platform_assign_default_plan`, yalnız paketi boş deneme kaydına, yalnız kendi tenant'ına). Operatörün paket değiştirmesi T-403.
-- * GÜVENLİK OLAYLARI: `platform.plan.saved` (paket kimliği + sürüm + yayın), `platform.plan.assigned` (tenant + paket + sürüm). Kişisel veri yok. Yazan probe (0038 tetikleyici kuralı).
-- Koşturucu tek transaction içinde çalıştırır.

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('wms_platform.subscriptions') IS NULL THEN
    RAISE EXCEPTION '0041_plans: wms_platform.subscriptions yok (0039 önkoşulu)';
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------------------------
-- 1. Tablolar
-- ---------------------------------------------------------------------------------------------
CREATE TABLE wms_platform.plans (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  name            text        NOT NULL,
  sort_order      integer     NOT NULL DEFAULT 0,
  published       boolean     NOT NULL DEFAULT false,
  recommended     boolean     NOT NULL DEFAULT false,
  current_version integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plans_pkey PRIMARY KEY (id),
  CONSTRAINT plans_name_chk CHECK (pg_catalog.btrim(name) = name AND pg_catalog.length(name) BETWEEN 1 AND 60),
  CONSTRAINT plans_version_chk CHECK (current_version >= 1),
  CONSTRAINT plans_recommended_chk CHECK (NOT recommended OR published)
);
CREATE UNIQUE INDEX plans_one_recommended_idx ON wms_platform.plans ((true)) WHERE recommended;

CREATE TABLE wms_platform.plan_versions (
  plan_id         uuid          NOT NULL,
  version         integer       NOT NULL,
  price_monthly   numeric(12,2) NOT NULL,
  max_admins      integer       NOT NULL,
  max_field       integer       NOT NULL,
  max_warehouses  integer       NOT NULL,
  max_items       integer       NOT NULL,
  feat_qr         boolean       NOT NULL,
  feat_ship       boolean       NOT NULL,
  feat_prod       boolean       NOT NULL,
  feat_api        boolean       NOT NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  created_by      uuid,
  CONSTRAINT plan_versions_pkey PRIMARY KEY (plan_id, version),
  CONSTRAINT plan_versions_plan_fkey FOREIGN KEY (plan_id) REFERENCES wms_platform.plans (id),
  CONSTRAINT plan_versions_price_chk CHECK (price_monthly >= 0 AND price_monthly <= 1000000),
  CONSTRAINT plan_versions_limits_chk CHECK (max_admins BETWEEN 0 AND 100000 AND max_field BETWEEN 0 AND 100000
                                             AND max_warehouses BETWEEN 0 AND 100000 AND max_items BETWEEN 0 AND 10000000)
);

ALTER TABLE wms_platform.subscriptions
  ADD COLUMN plan_id      uuid,
  ADD COLUMN plan_version integer,
  ADD CONSTRAINT subscriptions_plan_version_fkey FOREIGN KEY (plan_id, plan_version) REFERENCES wms_platform.plan_versions (plan_id, version),
  ADD CONSTRAINT subscriptions_plan_pair_chk CHECK ((plan_id IS NULL) = (plan_version IS NULL));

REVOKE ALL ON wms_platform.plans, wms_platform.plan_versions FROM PUBLIC;
GRANT SELECT, INSERT ON wms_platform.plans TO wms_identity_probe;
GRANT UPDATE (name, sort_order, published, recommended, current_version, updated_at) ON wms_platform.plans TO wms_identity_probe;
GRANT SELECT, INSERT ON wms_platform.plan_versions TO wms_identity_probe;
GRANT UPDATE (plan_id, plan_version) ON wms_platform.subscriptions TO wms_identity_probe;

-- ---------------------------------------------------------------------------------------------
-- 2. İşlevler (SET ROLE kalıbı, 0038/0039 ile aynı)
-- ---------------------------------------------------------------------------------------------
GRANT CREATE ON SCHEMA wms_probe TO wms_identity_probe;
SET ROLE wms_identity_probe;

-- Operatör: bütün paketler, güncel sürümleriyle ve paketteki müşteri sayısıyla.
CREATE FUNCTION wms_probe.platform_list_plans()
RETURNS TABLE (id uuid, name text, sort_order integer, published boolean, recommended boolean, version integer,
               price_monthly numeric, max_admins integer, max_field integer, max_warehouses integer, max_items integer,
               feat_qr boolean, feat_ship boolean, feat_prod boolean, feat_api boolean, customers integer)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF NOT wms_probe.platform_is_operator() THEN
    RAISE EXCEPTION 'platform_list_plans: operatör değil' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT p.id, p.name, p.sort_order, p.published, p.recommended, v.version, v.price_monthly, v.max_admins, v.max_field,
           v.max_warehouses, v.max_items, v.feat_qr, v.feat_ship, v.feat_prod, v.feat_api,
           (SELECT count(*)::integer FROM wms_platform.subscriptions s WHERE s.plan_id = p.id)
      FROM wms_platform.plans p
      JOIN wms_platform.plan_versions v ON v.plan_id = p.id AND v.version = p.current_version
     ORDER BY p.sort_order, p.created_at, p.id;
END
$fn$;

-- Operatör: paketi oluşturur ya da günceller. Fiyat/sınır/özellik değişmişse yeni sürüm açılır (eski sürüm değişmez); ad, yayın ve
-- "önerilen" sürüm açmaz. Önerilen işareti tek pakette olur (öncekinden kalkar); önerilen paket yayında olmalıdır.
CREATE FUNCTION wms_probe.platform_save_plan(
  p_id uuid, p_name text, p_price numeric, p_max_admins integer, p_max_field integer, p_max_warehouses integer, p_max_items integer,
  p_feat_qr boolean, p_feat_ship boolean, p_feat_prod boolean, p_feat_api boolean, p_published boolean, p_recommended boolean
) RETURNS TABLE (id uuid, version integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_uid uuid;
  v_id uuid;
  v_cur wms_platform.plan_versions%ROWTYPE;
  v_ver integer;
  v_changed boolean;
BEGIN
  IF NOT wms_probe.platform_is_operator() THEN
    RAISE EXCEPTION 'platform_save_plan: operatör değil' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL OR p_price IS NULL OR p_max_admins IS NULL OR p_max_field IS NULL OR p_max_warehouses IS NULL OR p_max_items IS NULL
     OR p_feat_qr IS NULL OR p_feat_ship IS NULL OR p_feat_prod IS NULL OR p_feat_api IS NULL OR p_published IS NULL OR p_recommended IS NULL THEN
    RAISE EXCEPTION 'platform_save_plan: eksik alan' USING ERRCODE = '22023';
  END IF;
  IF p_recommended AND NOT p_published THEN
    RAISE EXCEPTION 'platform_save_plan: önerilen paket yayında olmalı' USING ERRCODE = '22023';
  END IF;
  -- Kayıt biçiminde karşılaştır (numeric(12,2)): fazladan ondalık her kayıtta yeni sürüm açmaz.
  p_price := pg_catalog.round(p_price, 2);
  v_uid := pg_catalog.current_setting('app.current_user_id', true)::uuid;
  -- Önerilen tekilliği ve sıra: paket tablosu üzerinde tek yazıcı.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('wms_platform.plans', 0));
  IF p_recommended THEN
    UPDATE wms_platform.plans SET recommended = false, updated_at = pg_catalog.now()
     WHERE recommended AND (p_id IS NULL OR wms_platform.plans.id <> p_id);
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO wms_platform.plans (name, sort_order, published, recommended)
    VALUES (p_name, COALESCE((SELECT max(x.sort_order) + 1 FROM wms_platform.plans x), 0), p_published, p_recommended)
    RETURNING wms_platform.plans.id INTO v_id;
    v_ver := 1;
    INSERT INTO wms_platform.plan_versions (plan_id, version, price_monthly, max_admins, max_field, max_warehouses, max_items,
                                            feat_qr, feat_ship, feat_prod, feat_api, created_by)
    VALUES (v_id, 1, p_price, p_max_admins, p_max_field, p_max_warehouses, p_max_items, p_feat_qr, p_feat_ship, p_feat_prod, p_feat_api, v_uid);
  ELSE
    SELECT v.* INTO v_cur
      FROM wms_platform.plans p JOIN wms_platform.plan_versions v ON v.plan_id = p.id AND v.version = p.current_version
     WHERE p.id = p_id
       FOR UPDATE OF p;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'platform_save_plan: paket yok' USING ERRCODE = 'P0002';
    END IF;
    v_id := p_id;
    v_changed := v_cur.price_monthly <> p_price OR v_cur.max_admins <> p_max_admins OR v_cur.max_field <> p_max_field
              OR v_cur.max_warehouses <> p_max_warehouses OR v_cur.max_items <> p_max_items OR v_cur.feat_qr <> p_feat_qr
              OR v_cur.feat_ship <> p_feat_ship OR v_cur.feat_prod <> p_feat_prod OR v_cur.feat_api <> p_feat_api;
    v_ver := v_cur.version + CASE WHEN v_changed THEN 1 ELSE 0 END;
    IF v_changed THEN
      INSERT INTO wms_platform.plan_versions (plan_id, version, price_monthly, max_admins, max_field, max_warehouses, max_items,
                                              feat_qr, feat_ship, feat_prod, feat_api, created_by)
      VALUES (v_id, v_ver, p_price, p_max_admins, p_max_field, p_max_warehouses, p_max_items, p_feat_qr, p_feat_ship, p_feat_prod, p_feat_api, v_uid);
    END IF;
    UPDATE wms_platform.plans
       SET name = p_name, published = p_published, recommended = p_recommended, current_version = v_ver, updated_at = pg_catalog.now()
     WHERE wms_platform.plans.id = v_id;
  END IF;
  INSERT INTO public.security_events (user_id, event_type, detail)
  VALUES (v_uid, 'platform.plan.saved',
          pg_catalog.jsonb_build_object('plan_id', v_id::text, 'version', v_ver, 'published', p_published));
  RETURN QUERY SELECT v_id, v_ver;
END
$fn$;

-- Herkese açık bilgi: yayındaki paketler (satış sayfası). Kimlik ya da müşteri bilgisi yok.
CREATE FUNCTION wms_probe.platform_published_plans()
RETURNS TABLE (name text, recommended boolean, price_monthly numeric, max_admins integer, max_field integer, max_warehouses integer,
               max_items integer, feat_qr boolean, feat_ship boolean, feat_prod boolean, feat_api boolean)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT p.name, p.recommended, v.price_monthly, v.max_admins, v.max_field, v.max_warehouses, v.max_items,
         v.feat_qr, v.feat_ship, v.feat_prod, v.feat_api
    FROM wms_platform.plans p
    JOIN wms_platform.plan_versions v ON v.plan_id = p.id AND v.version = p.current_version
   WHERE p.published
   ORDER BY p.sort_order, p.created_at, p.id;
$fn$;

-- Çağıranın tenant bağlamındaki tenant'ın paket sınırı (0 = sınırsız). Paket yoksa ya da tenant bağlam dışıysa NULL (sınır yok).
CREATE FUNCTION wms_probe.platform_tenant_plan_limit(p_tenant uuid, p_kind text) RETURNS integer
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_ctx uuid := NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid;
  v wms_platform.plan_versions%ROWTYPE;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('admins', 'field', 'warehouses', 'items') THEN
    RAISE EXCEPTION 'platform_tenant_plan_limit: tür biçimsiz' USING ERRCODE = '22023';
  END IF;
  IF p_tenant IS NULL OR v_ctx IS NULL OR p_tenant <> v_ctx THEN
    RETURN NULL;
  END IF;
  SELECT pv.* INTO v
    FROM wms_platform.subscriptions s
    JOIN wms_platform.plan_versions pv ON pv.plan_id = s.plan_id AND pv.version = s.plan_version
   WHERE s.tenant_id = p_tenant;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN CASE p_kind WHEN 'admins' THEN v.max_admins WHEN 'field' THEN v.max_field
                     WHEN 'warehouses' THEN v.max_warehouses ELSE v.max_items END;
END
$fn$;

-- Aktivasyon: kendi tenant'ının paketi boş deneme kaydına önerilen yayındaki paketi atar. Önerilen paket yoksa hiçbir şey yapmaz.
CREATE FUNCTION wms_probe.platform_assign_default_plan() RETURNS uuid
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_ctx uuid := NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid;
  v_plan uuid;
  v_ver integer;
BEGIN
  IF v_ctx IS NULL THEN
    RAISE EXCEPTION 'platform_assign_default_plan: tenant bağlamı yok' USING ERRCODE = '42501';
  END IF;
  SELECT p.id, p.current_version INTO v_plan, v_ver FROM wms_platform.plans p WHERE p.recommended AND p.published;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  UPDATE wms_platform.subscriptions s SET plan_id = v_plan, plan_version = v_ver
   WHERE s.tenant_id = v_ctx AND s.plan_id IS NULL AND s.plan = 'TRIAL';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.security_events (user_id, event_type, detail)
  VALUES (NULLIF(pg_catalog.current_setting('app.current_user_id', true), '')::uuid, 'platform.plan.assigned',
          pg_catalog.jsonb_build_object('tenant_id', v_ctx::text, 'plan_id', v_plan::text, 'version', v_ver));
  RETURN v_plan;
END
$fn$;

REVOKE ALL ON FUNCTION wms_probe.platform_list_plans() FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.platform_save_plan(uuid, text, numeric, integer, integer, integer, integer, boolean, boolean, boolean, boolean, boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.platform_published_plans() FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.platform_tenant_plan_limit(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.platform_assign_default_plan() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wms_probe.platform_list_plans() TO wms_app;
GRANT EXECUTE ON FUNCTION wms_probe.platform_save_plan(uuid, text, numeric, integer, integer, integer, integer, boolean, boolean, boolean, boolean, boolean, boolean) TO wms_app;
GRANT EXECUTE ON FUNCTION wms_probe.platform_published_plans() TO wms_app;
GRANT EXECUTE ON FUNCTION wms_probe.platform_tenant_plan_limit(uuid, text) TO wms_app;
GRANT EXECUTE ON FUNCTION wms_probe.platform_assign_default_plan() TO wms_app;

RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;

-- ---------------------------------------------------------------------------------------------
-- 3. Sınır tetikleyicileri (SECURITY INVOKER; tenant tablolarına yalnız okuma — sayım)
-- ---------------------------------------------------------------------------------------------
-- Sınır yalnız işletim (wms_ops), migration rolü ve süper kullanıcı için atlanır; diğer her rol sınırlanır (bilinmeyen yazıcı
-- güvenli tarafta kalır). Depo/ürün: ekleme ve ARŞİVLİ → ETKİN geri alma. Üyelik sınıfı rollerden: TENANT_ADMIN, WAREHOUSE_MANAGER
-- ya da READ_ONLY rolü olan etkin üye "yönetici kullanıcı", yalnız PICKER/COUNTER rolü olan "saha personeli" (ADR-027 §4).
CREATE FUNCTION public.plan_limit_exempt() RETURNS boolean
 LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT current_user IN ('wms_ops', 'wms_migrator')
      OR COALESCE((SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = current_user), false);
$fn$;
REVOKE ALL ON FUNCTION public.plan_limit_exempt() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.plan_limit_exempt() TO wms_app;

-- Üyenin sınıfı: rolleri arasında yönetici rolü varsa 'admins', yalnız saha rolü varsa 'field', rolü yoksa NULL. `p_extra` eklenmekte
-- olan rol (BEFORE INSERT'te henüz tabloda değil).
CREATE FUNCTION public.plan_member_class(p_tenant uuid, p_membership uuid, p_extra text) RETURNS text
 LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT CASE
           WHEN p_extra IN ('TENANT_ADMIN', 'WAREHOUSE_MANAGER', 'READ_ONLY')
             OR EXISTS (SELECT 1 FROM public.membership_roles r WHERE r.tenant_id = p_tenant AND r.membership_id = p_membership
                          AND r.role_key IN ('TENANT_ADMIN', 'WAREHOUSE_MANAGER', 'READ_ONLY')) THEN 'admins'
           WHEN p_extra IS NOT NULL
             OR EXISTS (SELECT 1 FROM public.membership_roles r WHERE r.tenant_id = p_tenant AND r.membership_id = p_membership) THEN 'field'
         END;
$fn$;
REVOKE ALL ON FUNCTION public.plan_member_class(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.plan_member_class(uuid, uuid, text) TO wms_app;

-- Sınıftaki etkin üye sayısı (`p_except` hariç).
CREATE FUNCTION public.plan_member_count(p_tenant uuid, p_class text, p_except uuid) RETURNS bigint
 LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT count(*) FROM public.tenant_memberships m
   WHERE m.tenant_id = p_tenant AND m.status = 'ACTIVE' AND m.id IS DISTINCT FROM p_except
     AND public.plan_member_class(m.tenant_id, m.id, NULL) = p_class;
$fn$;
REVOKE ALL ON FUNCTION public.plan_member_count(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.plan_member_count(uuid, text, uuid) TO wms_app;

CREATE FUNCTION public.plan_limit_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v_kind text;
  v_limit integer;
  v_n bigint;
  v_member uuid;
BEGIN
  IF public.plan_limit_exempt() THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME IN ('warehouses', 'items') THEN
    IF NEW.is_sample OR NEW.status <> 'ACTIVE' OR (TG_OP = 'UPDATE' AND OLD.status = 'ACTIVE') THEN
      RETURN NEW;
    END IF;
    v_kind := TG_TABLE_NAME;
  ELSIF TG_TABLE_NAME = 'tenant_memberships' THEN
    -- Yeni üyelik rolsüzdür (sınıf rol eklenirken denetlenir); burada yalnız ETKİN olmayan → ETKİN geri dönüş.
    IF TG_OP <> 'UPDATE' OR NEW.status <> 'ACTIVE' OR OLD.status = 'ACTIVE' THEN
      RETURN NEW;
    END IF;
    v_member := NEW.id;
    v_kind := public.plan_member_class(NEW.tenant_id, NEW.id, NULL);
  ELSE -- membership_roles
    IF NOT EXISTS (SELECT 1 FROM public.tenant_memberships m WHERE m.tenant_id = NEW.tenant_id AND m.id = NEW.membership_id AND m.status = 'ACTIVE') THEN
      RETURN NEW;
    END IF;
    v_member := NEW.membership_id;
    v_kind := public.plan_member_class(NEW.tenant_id, NEW.membership_id, NEW.role_key);
    -- Sınıf değişmiyorsa (aynı sınıfta ek rol) sayım değişmez.
    IF v_kind IS NOT DISTINCT FROM public.plan_member_class(NEW.tenant_id, NEW.membership_id, NULL) THEN
      RETURN NEW;
    END IF;
  END IF;
  IF v_kind IS NULL THEN
    RETURN NEW;
  END IF;
  v_limit := wms_probe.platform_tenant_plan_limit(NEW.tenant_id, v_kind);
  IF v_limit IS NULL OR v_limit = 0 THEN
    RETURN NEW;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(NEW.tenant_id::text || ':plan-limit:' || v_kind, 0));
  IF v_kind = 'warehouses' THEN
    SELECT count(*) INTO v_n FROM public.warehouses w WHERE w.tenant_id = NEW.tenant_id AND w.status = 'ACTIVE' AND NOT w.is_sample;
  ELSIF v_kind = 'items' THEN
    SELECT count(*) INTO v_n FROM public.items i WHERE i.tenant_id = NEW.tenant_id AND i.status = 'ACTIVE' AND NOT i.is_sample;
  ELSE
    v_n := public.plan_member_count(NEW.tenant_id, v_kind, v_member);
  END IF;
  IF v_n >= v_limit THEN
    RAISE EXCEPTION 'PLAN_LIMIT' USING ERRCODE = '23514', DETAIL = v_kind;
  END IF;
  RETURN NEW;
END; $fn$;
REVOKE ALL ON FUNCTION public.plan_limit_guard() FROM PUBLIC;

CREATE TRIGGER warehouses_plan_limit BEFORE INSERT OR UPDATE OF status ON public.warehouses
 FOR EACH ROW EXECUTE FUNCTION public.plan_limit_guard();
ALTER TABLE public.warehouses ENABLE ALWAYS TRIGGER warehouses_plan_limit;
CREATE TRIGGER items_plan_limit BEFORE INSERT OR UPDATE OF status ON public.items
 FOR EACH ROW EXECUTE FUNCTION public.plan_limit_guard();
ALTER TABLE public.items ENABLE ALWAYS TRIGGER items_plan_limit;
CREATE TRIGGER tenant_memberships_plan_limit BEFORE UPDATE OF status ON public.tenant_memberships
 FOR EACH ROW EXECUTE FUNCTION public.plan_limit_guard();
ALTER TABLE public.tenant_memberships ENABLE ALWAYS TRIGGER tenant_memberships_plan_limit;
CREATE TRIGGER membership_roles_plan_limit BEFORE INSERT ON public.membership_roles
 FOR EACH ROW EXECUTE FUNCTION public.plan_limit_guard();
ALTER TABLE public.membership_roles ENABLE ALWAYS TRIGGER membership_roles_plan_limit;

-- ---------------------------------------------------------------------------------------------
-- 4. Doğrulama
-- ---------------------------------------------------------------------------------------------
DO $verify$
DECLARE
  f text;
  r text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'wms_probe.platform_list_plans()',
    'wms_probe.platform_save_plan(uuid, text, numeric, integer, integer, integer, integer, boolean, boolean, boolean, boolean, boolean, boolean)',
    'wms_probe.platform_published_plans()',
    'wms_probe.platform_tenant_plan_limit(uuid, text)',
    'wms_probe.platform_assign_default_plan()'] LOOP
    IF NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_proc p
          WHERE p.oid = f::regprocedure
            AND p.proowner = pg_catalog.to_regrole('wms_identity_probe')
            AND p.prosecdef
            AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']
            AND p.proacl IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a WHERE a.grantee = 0)) THEN
      RAISE EXCEPTION '0041_plans: % sahibi/SECURITY DEFINER/search_path/ACL beklenenden farklı', f;
    END IF;
    FOREACH r IN ARRAY ARRAY['wms_app', 'wms_auth', 'wms_worker', 'wms_ops'] LOOP
      IF pg_catalog.has_function_privilege(r, f, 'EXECUTE') <> (r = 'wms_app') THEN
        RAISE EXCEPTION '0041_plans: % rolünün % EXECUTE yetkisi beklenenden farklı', r, f;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['wms_app', 'wms_auth', 'wms_worker', 'wms_ops'] LOOP
    IF pg_catalog.has_table_privilege(r, 'wms_platform.plans', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       OR pg_catalog.has_table_privilege(r, 'wms_platform.plan_versions', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') THEN
      RAISE EXCEPTION '0041_plans: % paket tablolarında yetki taşımamalı', r;
    END IF;
  END LOOP;
  IF pg_catalog.has_any_column_privilege('wms_identity_probe', 'wms_platform.plan_versions', 'UPDATE')
     OR pg_catalog.has_table_privilege('wms_identity_probe', 'wms_platform.plan_versions', 'DELETE, TRUNCATE')
     OR pg_catalog.has_table_privilege('wms_identity_probe', 'wms_platform.plans', 'DELETE, TRUNCATE')
     OR pg_catalog.has_schema_privilege('wms_identity_probe', 'wms_probe', 'CREATE') THEN
    RAISE EXCEPTION '0041_plans: wms_identity_probe yetkisi beklenenden geniş';
  END IF;
END
$verify$;
