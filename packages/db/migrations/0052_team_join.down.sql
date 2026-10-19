-- 0052_team_join geri alma (G-08). Katılma bağlantıları ve talepleri silinir; onayla açılmış saha hesapları (0044 field_logins, üyelikler) kalır.
-- Kimlik akışı verisi; defter verisi değil. Uygulama önce geri alınmalıdır (yeni uçlar bu tabloları sorgular).
DO $guard$
DECLARE
  t text;
  has_rows boolean;
  allow boolean := coalesce(pg_catalog.current_setting('wms_meta.allow_destructive_down', true), '') = 'on';
BEGIN
  FOREACH t IN ARRAY ARRAY['team_join_requests', 'team_join_links'] LOOP
    IF pg_catalog.to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', t);
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)', t) INTO has_rows;
      IF has_rows AND NOT allow THEN
        RAISE EXCEPTION '0052_team_join down: public.% tablosunda satır var; veri kaybettiren geri alma bu ortamda kapalı', t;
      END IF;
    END IF;
  END LOOP;
END
$guard$;
GRANT CREATE ON SCHEMA wms_probe TO wms_identity_probe;
SET ROLE wms_identity_probe;
DROP FUNCTION wms_probe.field_join_activate(uuid, text, text, text, text);
DROP FUNCTION wms_probe.field_join_verify(uuid, text);
DROP FUNCTION wms_probe.field_join_link(uuid, text);
DROP FUNCTION wms_probe.field_join_status(uuid, text);
DROP FUNCTION wms_probe.field_join_request(uuid, text, text, text, text, text);
RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;
DROP TABLE public.team_join_requests;
DROP TABLE public.team_join_links;
