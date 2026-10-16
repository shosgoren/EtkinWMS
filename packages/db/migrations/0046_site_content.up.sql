-- 0046_site_content (T-407, ADR-027 §6, §9): satış sayfası içeriği panelden düzenlenir, önizlenir ve yayınlanır. G-08: yalnızca
-- GENİŞLETME (iki platform tablosu, beş işlev, bir değişmezlik tetikleyicisi).
--
-- BİLİNÇLİ KARARLAR (inceleme için):
-- * SÜRÜMLÜ İÇERİK: `wms_platform.site_content` her satırı bir sürümdür (ana başlık, vurgulu satır, alt metin, fiyat bölümünde
--   gösterilecek paketler). En çok BİR taslak (`published_at IS NULL`) vardır; kaydetme taslağı günceller ya da yeni sürüm numarasıyla
--   açar; yayınlama taslağı yayınlanmış olarak işaretler. Yayınlanmış satır tetikleyiciyle DEĞİŞMEZ (işlem kaydı silinemez, ADR-027 §9).
--   Satış sitesi daima en son yayınlanan sürümü okur.
-- * METİN: düz metindir; denetim karakteri ve `<` `>` reddedilir (satış sitesi ayrıca kaçışlar). Uzunluk: başlık 1–80, vurgulu satır
--   1–60, alt metin 1–400. Paket listesi en çok 12 kimlik; yalnız VAR OLAN paketler kabul edilir, sitede yalnız YAYINDAKİLER görünür
--   (paket sonradan yayından kalkarsa sitede kendiliğinden görünmez).
-- * ÖNİZLEME: süreli bağlantı (30 dakika). Sır yalnız bir kez üretilir ve panelde gösterilir; veritabanında yalnız SHA-256 özeti
--   (`site_previews.token_hash`). Önizleme taslağı (yoksa son yayını) gösterir; bağlantı sürüm satırına bağlıdır.
-- * ERİŞİM: uygulama rollerinin tablolara yetkisi YOK; yazma/okuma yalnız `wms_probe.platform_site_*` SECURITY DEFINER işlevleriyle.
--   Okuma/kaydetme/yayın/önizleme üretme operatör denetimli; `platform_site_public` herkese açık bilgi döner (yayındaki içerik ve
--   yayındaki paketler; önizleme özeti geçerliyse taslak). Kişisel veri dönmez.
-- * GÜVENLİK OLAYLARI: `platform.site.saved`, `platform.site.published`, `platform.site.preview` (sürüm numarası; metin yazılmaz).
-- Koşturucu tek transaction içinde çalıştırır.

DO $pre$
BEGIN
  IF pg_catalog.to_regprocedure('wms_probe.platform_published_plans()') IS NULL THEN
    RAISE EXCEPTION '0046_site_content: platform_published_plans yok (0041 önkoşulu)';
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------------------------
-- 1. Tablolar
-- ---------------------------------------------------------------------------------------------
CREATE TABLE wms_platform.site_content (
  version       integer     NOT NULL,
  title1        text        NOT NULL,
  title2        text        NOT NULL,
  subtitle      text        NOT NULL,
  plan_ids      uuid[]      NOT NULL DEFAULT '{}',
  saved_at      timestamptz NOT NULL DEFAULT now(),
  saved_by      uuid,
  published_at  timestamptz,
  published_by  uuid,
  CONSTRAINT site_content_pkey PRIMARY KEY (version),
  CONSTRAINT site_content_version_chk CHECK (version >= 1),
  CONSTRAINT site_content_title1_chk CHECK (pg_catalog.btrim(title1) = title1 AND pg_catalog.length(title1) BETWEEN 1 AND 80
                                            AND title1 !~ '[[:cntrl:]<>]'),
  CONSTRAINT site_content_title2_chk CHECK (pg_catalog.btrim(title2) = title2 AND pg_catalog.length(title2) BETWEEN 1 AND 60
                                            AND title2 !~ '[[:cntrl:]<>]'),
  CONSTRAINT site_content_subtitle_chk CHECK (pg_catalog.btrim(subtitle) = subtitle AND pg_catalog.length(subtitle) BETWEEN 1 AND 400
                                              AND subtitle !~ '[[:cntrl:]<>]'),
  CONSTRAINT site_content_plans_chk CHECK (pg_catalog.cardinality(plan_ids) <= 12 AND pg_catalog.array_position(plan_ids, NULL) IS NULL),
  CONSTRAINT site_content_published_chk CHECK (published_by IS NULL OR published_at IS NOT NULL)
);
CREATE UNIQUE INDEX site_content_one_draft_idx ON wms_platform.site_content ((true)) WHERE published_at IS NULL;

-- Yayınlanmış sürüm değişmez ve silinmez (işlem kaydı, ADR-027 §9).
CREATE FUNCTION wms_platform.site_content_published_immutable() RETURNS trigger
 LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN
  IF OLD.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'site_content: yayınlanmış sürüm değiştirilemez' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION wms_platform.site_content_published_immutable() FROM PUBLIC;
CREATE TRIGGER site_content_published_immutable BEFORE UPDATE OR DELETE ON wms_platform.site_content
  FOR EACH ROW EXECUTE FUNCTION wms_platform.site_content_published_immutable();

CREATE TABLE wms_platform.site_previews (
  token_hash  text        NOT NULL,
  version     integer     NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  CONSTRAINT site_previews_pkey PRIMARY KEY (token_hash),
  CONSTRAINT site_previews_hash_chk CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT site_previews_expiry_chk CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 minutes'),
  CONSTRAINT site_previews_version_fkey FOREIGN KEY (version) REFERENCES wms_platform.site_content (version)
);
CREATE INDEX site_previews_expires_idx ON wms_platform.site_previews (expires_at);

REVOKE ALL ON wms_platform.site_content FROM PUBLIC;
REVOKE ALL ON wms_platform.site_previews FROM PUBLIC;
GRANT SELECT, INSERT ON wms_platform.site_content TO wms_identity_probe;
GRANT UPDATE (title1, title2, subtitle, plan_ids, saved_at, saved_by, published_at, published_by) ON wms_platform.site_content TO wms_identity_probe;
GRANT SELECT, INSERT, DELETE ON wms_platform.site_previews TO wms_identity_probe;

-- ---------------------------------------------------------------------------------------------
-- 2. İşlevler (SET ROLE kalıbı)
-- ---------------------------------------------------------------------------------------------
GRANT CREATE ON SCHEMA wms_probe TO wms_identity_probe;
SET ROLE wms_identity_probe;

-- Operatör: düzenlenen sürüm (taslak varsa o, yoksa son yayın) + son yayının numarası ve zamanı. Hiç içerik yoksa satır dönmez.
CREATE FUNCTION wms_probe.platform_site_get()
RETURNS TABLE (version integer, title1 text, title2 text, subtitle text, plan_ids uuid[], draft boolean, saved_at timestamptz,
               published_version integer, published_at timestamptz)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF NOT wms_probe.platform_is_operator() THEN
    RAISE EXCEPTION 'platform_site_get: operatör değil' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT c.version, c.title1, c.title2, c.subtitle, c.plan_ids, c.published_at IS NULL, c.saved_at, p.version, p.published_at
      FROM wms_platform.site_content c
      LEFT JOIN LATERAL (SELECT x.version, x.published_at FROM wms_platform.site_content x
                          WHERE x.published_at IS NOT NULL ORDER BY x.version DESC LIMIT 1) p ON true
     ORDER BY (c.published_at IS NULL) DESC, c.version DESC
     LIMIT 1;
END
$fn$;

-- Operatör: taslağı kaydeder (yoksa yeni sürüm numarasıyla açar); taslağın sürüm numarası.
CREATE FUNCTION wms_probe.platform_site_save(p_title1 text, p_title2 text, p_subtitle text, p_plans uuid[]) RETURNS integer
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_uid uuid;
  v_ver integer;
  v_plans uuid[] := coalesce(p_plans, '{}');
BEGIN
  IF NOT wms_probe.platform_is_operator() THEN
    RAISE EXCEPTION 'platform_site_save: operatör değil' USING ERRCODE = '42501';
  END IF;
  v_uid := NULLIF(pg_catalog.current_setting('app.current_user_id', true), '')::uuid;
  IF p_title1 IS NULL OR p_title2 IS NULL OR p_subtitle IS NULL
     OR pg_catalog.cardinality(v_plans) > 12 OR pg_catalog.array_position(v_plans, NULL) IS NOT NULL
     OR (SELECT count(DISTINCT u) FROM pg_catalog.unnest(v_plans) u) <> pg_catalog.cardinality(v_plans)
     OR EXISTS (SELECT 1 FROM pg_catalog.unnest(v_plans) u WHERE NOT EXISTS (SELECT 1 FROM wms_platform.plans p WHERE p.id = u)) THEN
    RAISE EXCEPTION 'platform_site_save: girdi biçimsiz' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('platform.site_content', 0));
  UPDATE wms_platform.site_content c
     SET title1 = p_title1, title2 = p_title2, subtitle = p_subtitle, plan_ids = v_plans, saved_at = now(), saved_by = v_uid
   WHERE c.published_at IS NULL
  RETURNING c.version INTO v_ver;
  IF v_ver IS NULL THEN
    SELECT coalesce(max(c.version), 0) + 1 INTO v_ver FROM wms_platform.site_content c;
    INSERT INTO wms_platform.site_content (version, title1, title2, subtitle, plan_ids, saved_by)
    VALUES (v_ver, p_title1, p_title2, p_subtitle, v_plans, v_uid);
  END IF;
  INSERT INTO public.security_events (user_id, event_type, detail)
  VALUES (v_uid, 'platform.site.saved', pg_catalog.jsonb_build_object('version', v_ver));
  RETURN v_ver;
END
$fn$;

-- Operatör: taslağı yayınlar; yayınlanan sürüm. Taslak yoksa (zaten yayında) son yayının numarası; hiç içerik yoksa P0002.
CREATE FUNCTION wms_probe.platform_site_publish() RETURNS integer
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_uid uuid;
  v_ver integer;
BEGIN
  IF NOT wms_probe.platform_is_operator() THEN
    RAISE EXCEPTION 'platform_site_publish: operatör değil' USING ERRCODE = '42501';
  END IF;
  v_uid := NULLIF(pg_catalog.current_setting('app.current_user_id', true), '')::uuid;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('platform.site_content', 0));
  UPDATE wms_platform.site_content c SET published_at = now(), published_by = v_uid
   WHERE c.published_at IS NULL
  RETURNING c.version INTO v_ver;
  IF v_ver IS NULL THEN
    SELECT max(c.version) INTO v_ver FROM wms_platform.site_content c WHERE c.published_at IS NOT NULL;
    IF v_ver IS NULL THEN
      RAISE EXCEPTION 'platform_site_publish: yayınlanacak içerik yok' USING ERRCODE = 'P0002';
    END IF;
    RETURN v_ver;
  END IF;
  INSERT INTO public.security_events (user_id, event_type, detail)
  VALUES (v_uid, 'platform.site.published', pg_catalog.jsonb_build_object('version', v_ver));
  RETURN v_ver;
END
$fn$;

-- Operatör: 30 dakikalık önizleme bağlantısının özetini kaydeder (taslak; yoksa son yayın). Süresi geçmiş önizlemeler silinir.
CREATE FUNCTION wms_probe.platform_site_preview(p_token_hash text) RETURNS timestamptz
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_uid uuid;
  v_ver integer;
  v_exp timestamptz := now() + interval '30 minutes';
BEGIN
  IF NOT wms_probe.platform_is_operator() THEN
    RAISE EXCEPTION 'platform_site_preview: operatör değil' USING ERRCODE = '42501';
  END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'platform_site_preview: girdi biçimsiz' USING ERRCODE = '22023';
  END IF;
  v_uid := NULLIF(pg_catalog.current_setting('app.current_user_id', true), '')::uuid;
  SELECT c.version INTO v_ver FROM wms_platform.site_content c ORDER BY (c.published_at IS NULL) DESC, c.version DESC LIMIT 1;
  IF v_ver IS NULL THEN
    RAISE EXCEPTION 'platform_site_preview: içerik yok' USING ERRCODE = 'P0002';
  END IF;
  DELETE FROM wms_platform.site_previews s WHERE s.expires_at <= now();
  INSERT INTO wms_platform.site_previews (token_hash, version, expires_at, created_by) VALUES (p_token_hash, v_ver, v_exp, v_uid);
  INSERT INTO public.security_events (user_id, event_type, detail)
  VALUES (v_uid, 'platform.site.preview', pg_catalog.jsonb_build_object('version', v_ver));
  RETURN v_exp;
END
$fn$;

-- Herkese açık bilgi (satış sitesi): son yayınlanan içerik ve fiyat bölümündeki YAYINDAKİ paketler. Geçerli önizleme özeti verilirse
-- önizlenen sürüm. İçerik yoksa satır dönmez. Kimlik, müşteri ya da kaydeden bilgisi dönmez.
CREATE FUNCTION wms_probe.platform_site_public(p_preview_hash text)
RETURNS TABLE (version integer, preview boolean, title1 text, title2 text, subtitle text, plans jsonb)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  c wms_platform.site_content%ROWTYPE;
  v_preview boolean := false;
BEGIN
  IF p_preview_hash IS NOT NULL AND p_preview_hash ~ '^[0-9a-f]{64}$' THEN
    SELECT x.* INTO c FROM wms_platform.site_previews s JOIN wms_platform.site_content x ON x.version = s.version
     WHERE s.token_hash = p_preview_hash AND s.expires_at > now();
    v_preview := FOUND;
  END IF;
  IF NOT v_preview THEN
    SELECT x.* INTO c FROM wms_platform.site_content x WHERE x.published_at IS NOT NULL ORDER BY x.version DESC LIMIT 1;
    IF NOT FOUND THEN
      RETURN;
    END IF;
  END IF;
  version := c.version; preview := v_preview; title1 := c.title1; title2 := c.title2; subtitle := c.subtitle;
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'name', p.name, 'recommended', p.recommended, 'price', v.price_monthly, 'admins', v.max_admins, 'field', v.max_field,
           'warehouses', v.max_warehouses, 'items', v.max_items, 'qr', v.feat_qr, 'ship', v.feat_ship, 'prod', v.feat_prod,
           'api', v.feat_api) ORDER BY p.sort_order, p.created_at, p.id), '[]'::jsonb)
    INTO plans
    FROM wms_platform.plans p
    JOIN wms_platform.plan_versions v ON v.plan_id = p.id AND v.version = p.current_version
   WHERE p.published AND p.id = ANY (c.plan_ids);
  RETURN NEXT;
END
$fn$;

REVOKE ALL ON FUNCTION wms_probe.platform_site_get() FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.platform_site_save(text, text, text, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.platform_site_publish() FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.platform_site_preview(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.platform_site_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wms_probe.platform_site_get() TO wms_app;
GRANT EXECUTE ON FUNCTION wms_probe.platform_site_save(text, text, text, uuid[]) TO wms_app;
GRANT EXECUTE ON FUNCTION wms_probe.platform_site_publish() TO wms_app;
GRANT EXECUTE ON FUNCTION wms_probe.platform_site_preview(text) TO wms_app;
GRANT EXECUTE ON FUNCTION wms_probe.platform_site_public(text) TO wms_app;

RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;

-- ---------------------------------------------------------------------------------------------
-- 3. Doğrulama
-- ---------------------------------------------------------------------------------------------
DO $verify$
DECLARE
  f text;
  r text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'wms_probe.platform_site_get()',
    'wms_probe.platform_site_save(text, text, text, uuid[])',
    'wms_probe.platform_site_publish()',
    'wms_probe.platform_site_preview(text)',
    'wms_probe.platform_site_public(text)'] LOOP
    IF NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_proc p
          WHERE p.oid = f::regprocedure
            AND p.proowner = pg_catalog.to_regrole('wms_identity_probe')
            AND p.prosecdef
            AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']
            AND p.proacl IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a WHERE a.grantee = 0)) THEN
      RAISE EXCEPTION '0046_site_content: % sahibi/SECURITY DEFINER/search_path/ACL beklenenden farklı', f;
    END IF;
    FOREACH r IN ARRAY ARRAY['wms_app', 'wms_auth', 'wms_worker', 'wms_ops'] LOOP
      IF pg_catalog.has_function_privilege(r, f, 'EXECUTE') <> (r = 'wms_app') THEN
        RAISE EXCEPTION '0046_site_content: % rolünün % EXECUTE yetkisi beklenenden farklı', r, f;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['wms_app', 'wms_auth', 'wms_worker', 'wms_ops'] LOOP
    IF pg_catalog.has_table_privilege(r, 'wms_platform.site_content', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       OR pg_catalog.has_table_privilege(r, 'wms_platform.site_previews', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') THEN
      RAISE EXCEPTION '0046_site_content: % içerik tablolarında yetki taşımamalı', r;
    END IF;
  END LOOP;
  IF pg_catalog.has_table_privilege('wms_identity_probe', 'wms_platform.site_content', 'DELETE, TRUNCATE')
     OR pg_catalog.has_column_privilege('wms_identity_probe', 'wms_platform.site_content', 'version', 'UPDATE')
     OR pg_catalog.has_schema_privilege('wms_identity_probe', 'wms_probe', 'CREATE') THEN
    RAISE EXCEPTION '0046_site_content: wms_identity_probe yetkisi beklenenden geniş';
  END IF;
END
$verify$;
