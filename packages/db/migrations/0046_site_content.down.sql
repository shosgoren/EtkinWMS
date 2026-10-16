-- 0046_site_content geri alma (G-08, ADR-015 §9): up'ın yarattığını ters sırayla kaldırır.
-- VERİ KAYBETTİRİR: yayınlanmış içerik varsa yalnızca wms_meta.allow_destructive_down = 'on' (WMS_ENV local|ci) iken çalışır.
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM wms_platform.site_content WHERE published_at IS NOT NULL)
     AND coalesce(pg_catalog.current_setting('wms_meta.allow_destructive_down', true), '') <> 'on' THEN
    RAISE EXCEPTION '0046_site_content down: yayınlanmış satış sayfası içeriği var; veri kaybettiren geri alma bu ortamda kapalı';
  END IF;
END
$guard$;

GRANT CREATE ON SCHEMA wms_probe TO wms_identity_probe;
SET ROLE wms_identity_probe;
DROP FUNCTION wms_probe.platform_site_public(text);
DROP FUNCTION wms_probe.platform_site_preview(text);
DROP FUNCTION wms_probe.platform_site_publish();
DROP FUNCTION wms_probe.platform_site_save(text, text, text, uuid[]);
DROP FUNCTION wms_probe.platform_site_get();
RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;

DROP TABLE wms_platform.site_previews;
DROP TABLE wms_platform.site_content;
DROP FUNCTION wms_platform.site_content_published_immutable();
