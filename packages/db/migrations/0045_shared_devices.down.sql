-- 0045_shared_devices geri alma (G-08). Bekleyen/onaylanmış kayıt satırları ve oturum-cihaz bağları silinir; açılmış ORTAK cihaz satırları
-- (field_devices, 0044) kalır ve 0044 kurallarıyla geçerliliğini sürdürür. Kimlik bilgisi; defter verisi değil.
GRANT CREATE ON SCHEMA wms_probe TO wms_identity_probe;
SET ROLE wms_identity_probe;
DROP FUNCTION wms_probe.field_device_revoke(uuid, uuid);
DROP FUNCTION wms_probe.field_device_staff(uuid, text);
DROP FUNCTION wms_probe.field_enroll_approve(uuid, uuid);
DROP FUNCTION wms_probe.field_enroll_claim(uuid, text, text, text);
RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;
DROP TABLE public.field_sessions;
DROP TABLE public.field_enrollments;
