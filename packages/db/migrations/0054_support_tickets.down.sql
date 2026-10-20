-- 0054_support_tickets geri alma (G-08). Destek talepleri ve yazışması silinir; dolu veride `allow_destructive_down` olmadan REDDEDİLİR
-- (müşteri yazışması kaybolmasın). `security_events` `platform.support.*` kayıtları append-only kalır. Uygulama önce geri alınmalıdır.
DO $guard$
DECLARE
  t text;
  has_rows boolean;
  allow boolean := coalesce(pg_catalog.current_setting('wms_meta.allow_destructive_down', true), '') = 'on';
BEGIN
  FOREACH t IN ARRAY ARRAY['support_ticket_messages', 'support_tickets'] LOOP
    IF pg_catalog.to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', t);
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)', t) INTO has_rows;
      IF has_rows AND NOT allow THEN
        RAISE EXCEPTION '0054_support_tickets down: public.% tablosunda satır var; veri kaybettiren geri alma bu ortamda kapalı', t;
      END IF;
    END IF;
  END LOOP;
END
$guard$;
GRANT CREATE ON SCHEMA wms_probe TO wms_identity_probe;
SET ROLE wms_identity_probe;
DROP FUNCTION wms_probe.platform_support_set_status(uuid, text);
DROP FUNCTION wms_probe.platform_support_reply(uuid, text);
DROP FUNCTION wms_probe.platform_support_messages(uuid);
DROP FUNCTION wms_probe.platform_support_get(uuid);
DROP FUNCTION wms_probe.platform_support_open_count();
DROP FUNCTION wms_probe.platform_support_list(text, uuid, integer);
RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;
DROP TABLE public.support_ticket_messages;
DROP TABLE public.support_tickets;
DROP FUNCTION public.support_ticket_messages_guard();
DROP FUNCTION public.support_tickets_guard();
