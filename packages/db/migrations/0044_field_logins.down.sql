-- 0044_field_logins geri alma (G-08, ADR-015 §9). Saha giriş bilgilerini (PIN özeti, bekleyen kod, cihaz kaydı) SİLER; hesaplar,
-- üyelikler ve stok/iş kayıtları kalır. Yeniden kurulumda personel yeni etkinleştirme koduyla tekrar kaydolur (kimlik bilgisi; defter
-- verisi değil — bu yüzden veri bekçisi yok).
GRANT CREATE ON SCHEMA wms_probe TO wms_identity_probe;
SET ROLE wms_identity_probe;
DROP FUNCTION wms_probe.field_admin_reset(uuid, text, uuid);
DROP FUNCTION wms_probe.field_activate(text, text, text, text, text, text);
DROP FUNCTION wms_probe.field_signin_finish(uuid, uuid, uuid, boolean, text);
DROP FUNCTION wms_probe.field_signin_begin(text, text, text);
DROP FUNCTION wms_probe.field_device_status(uuid, text);
RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;

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
  IF pg_catalog.lower(NEW.event_type) ~ '^platform[_.]' AND current_user::text <> 'wms_identity_probe' THEN
    RAISE EXCEPTION 'security_events: platform olayı (%) yalnızca platform işlevleriyle yazılabilir', NEW.event_type
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TABLE public.field_devices;
DROP TABLE public.field_logins;
