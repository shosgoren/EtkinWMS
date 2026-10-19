-- 0051_permission_groups (T-421, Gruplar.dc.html; kullanıcı onayı 19 Ekim): hesap sahibinin tanımladığı ÖZEL yetki grupları.
-- G-08: yalnız GENİŞLETME (yeni iki tablo). Roller (membership_roles) aynen kalır: hazır şablon gruplar rollerin kendisidir.
--
-- BİLİNÇLİ KARARLAR (inceleme için):
-- * Özel grup, üyenin rol izinlerine EK yetki (grants) ve görünür ekran listesi (screens) verir; rol izinlerini daraltmaz. Etkin izin =
--   rol izinleri ∪ grubunun yetkileri (domain `hasPermission(roles, p, grants)`; üyelik okumasında aynı transaction'da, FOR SHARE).
-- * Verilebilecek yetkiler kapalı listedir (CHECK): okut-işle, belge oluştur, onayla (+ sayım farkı onayı), ters kayıt, Excel'den aktar.
--   Ekip yönetimi (`users.manage`) ve ayarlar (`settings.manage`) BİLEREK yok: başka hesabı yönetici yapmak / görev ayrımını kapatmak (yetki yükseltme). Grup yönetimi ve üyeyi gruba koymak yalnız hesap sahibine açıktır (domain); hesap sahibi gruba konamaz (zaten tam yetki).
-- * Hassas yetki (onay, ters kayıt, aktarım) taşıyan üyeye MFA zorunludur (domain `enforceMfa`).
-- * Üye en çok bir özel gruptadır (PK). Grup silinmez, arşivlenir; arşivdeki grubun yetkisi uygulanmaz.
-- * RLS ADR-015 §5 kalıbı; yetkiler sütun bazlı; DELETE yalnız `member_groups` (üyeyi gruptan çıkarmak) için.
-- Koşturucu tek transaction içinde çalıştırır.

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.parties') IS NULL THEN
    RAISE EXCEPTION '0051_permission_groups: 0050 önkoşulu yok';
  END IF;
END
$pre$;

CREATE TABLE public.permission_groups (
  tenant_id   uuid        NOT NULL REFERENCES public.tenants (id),
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  color       text        NOT NULL DEFAULT '#2F7D5B',
  screens     text[]      NOT NULL DEFAULT '{}',
  grants      text[]      NOT NULL DEFAULT '{}',
  archived_at timestamptz,
  created_by  uuid        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     integer     NOT NULL DEFAULT 1,
  CONSTRAINT permission_groups_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT permission_groups_created_by_fkey FOREIGN KEY (tenant_id, created_by) REFERENCES public.tenant_memberships (tenant_id, id),
  CONSTRAINT permission_groups_name_chk CHECK (char_length(name) BETWEEN 1 AND 60 AND name !~ '[[:cntrl:]]'),
  CONSTRAINT permission_groups_color_chk CHECK (color ~ '^#[0-9A-F]{6}$'),
  CONSTRAINT permission_groups_screens_chk CHECK (
    screens <@ ARRAY['receive', 'pick', 'transfer', 'prod', 'count', 'labels', 'reports', 'problem']::text[] AND cardinality(screens) <= 8),
  CONSTRAINT permission_groups_grants_chk CHECK (
    grants <@ ARRAY['stock.post', 'document.create', 'document.approve', 'count_diff.approve', 'reversal.create', 'data.import']::text[]
    AND cardinality(grants) <= 6),
  CONSTRAINT permission_groups_version_chk CHECK (version >= 1)
);
CREATE UNIQUE INDEX permission_groups_tenant_name_key ON public.permission_groups (tenant_id, lower(name)) WHERE archived_at IS NULL;

CREATE TABLE public.member_groups (
  tenant_id     uuid        NOT NULL REFERENCES public.tenants (id),
  membership_id uuid        NOT NULL,
  group_id      uuid        NOT NULL,
  assigned_by   uuid        NOT NULL,
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_groups_pkey PRIMARY KEY (tenant_id, membership_id),
  CONSTRAINT member_groups_membership_fkey FOREIGN KEY (tenant_id, membership_id) REFERENCES public.tenant_memberships (tenant_id, id),
  CONSTRAINT member_groups_group_fkey FOREIGN KEY (tenant_id, group_id) REFERENCES public.permission_groups (tenant_id, id),
  CONSTRAINT member_groups_assigned_by_fkey FOREIGN KEY (tenant_id, assigned_by) REFERENCES public.tenant_memberships (tenant_id, id)
);
CREATE INDEX member_groups_group_idx ON public.member_groups (tenant_id, group_id);

CREATE FUNCTION public.permission_groups_touch() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'permission_groups: kimlik alanları değiştirilemez' USING ERRCODE = '23514';
    END IF;
    NEW.version := OLD.version + 1;
  ELSE
    NEW.version := 1;
    NEW.created_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.permission_groups_touch() FROM PUBLIC;
CREATE TRIGGER permission_groups_touch BEFORE INSERT OR UPDATE ON public.permission_groups
  FOR EACH ROW EXECUTE FUNCTION public.permission_groups_touch();

CREATE FUNCTION public.member_groups_touch() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  NEW.assigned_at := now();
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.member_groups_touch() FROM PUBLIC;
CREATE TRIGGER member_groups_touch BEFORE INSERT OR UPDATE ON public.member_groups
  FOR EACH ROW EXECUTE FUNCTION public.member_groups_touch();

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['permission_groups', 'member_groups'] LOOP
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

GRANT SELECT ON public.permission_groups TO wms_app;
GRANT INSERT (tenant_id, id, name, color, screens, grants, created_by) ON public.permission_groups TO wms_app;
GRANT UPDATE (name, color, screens, grants, archived_at) ON public.permission_groups TO wms_app;
GRANT SELECT, DELETE ON public.member_groups TO wms_app;
GRANT INSERT (tenant_id, membership_id, group_id, assigned_by) ON public.member_groups TO wms_app;
GRANT UPDATE (group_id, assigned_by) ON public.member_groups TO wms_app;

DO $verify$
DECLARE
  r text;
BEGIN
  IF pg_catalog.has_table_privilege('wms_app', 'public.permission_groups', 'DELETE') THEN
    RAISE EXCEPTION '0051_permission_groups: wms_app grup silebiliyor';
  END IF;
  FOREACH r IN ARRAY ARRAY['wms_auth', 'wms_worker'] LOOP
    IF pg_catalog.to_regrole(r) IS NOT NULL AND (pg_catalog.has_table_privilege(r, 'public.permission_groups', 'INSERT')
       OR pg_catalog.has_table_privilege(r, 'public.member_groups', 'INSERT')) THEN
      RAISE EXCEPTION '0051_permission_groups: % rolü grup yazabiliyor', r;
    END IF;
  END LOOP;
END
$verify$;
