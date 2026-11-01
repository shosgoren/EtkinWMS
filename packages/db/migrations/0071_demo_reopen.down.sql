-- 0071_demo_reopen geri alma (T-1144, G-08): yalnız işlev kaldırılır. Veri kaybettirmez: geri açılmış talepler tutarlı PENDING satırıdır
-- (0038 kısıtları), `platform.demo_request.reopened` olayları silinemez kayıt olarak kalır.
GRANT CREATE ON SCHEMA wms_probe TO wms_identity_probe;
SET ROLE wms_identity_probe;
DROP FUNCTION wms_probe.platform_reopen_demo_request(uuid);
RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;
