-- 0038_demo_requests geri alma (G-08). Demo talepleri platform verisidir; satış sitesinin kendi JSONL kaydı (LEAD_DIR) kaynak olarak
-- durduğu için geri almada talepler kaybolmaz (yeniden içe alınır). Karar verilmiş talep varsa geri alma reddedilir (karar kaybolmasın).
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM wms_platform.demo_requests WHERE status <> 'PENDING') THEN
    RAISE EXCEPTION '0038_demo_requests down: karara bağlanmış talep var; geri alma reddedildi';
  END IF;
END
$guard$;

DROP FUNCTION wms_probe.platform_decide_demo_request(uuid, text);
DROP FUNCTION wms_probe.platform_list_demo_requests(integer);
DROP FUNCTION wms_probe.platform_ingest_demo_request(uuid, timestamptz, text, text, text, text, text);
DROP FUNCTION wms_probe.platform_is_operator();
REVOKE INSERT (user_id, event_type, detail) ON public.security_events FROM wms_identity_probe;
DROP TABLE wms_platform.demo_requests;
DROP TABLE wms_platform.operators;
DROP SCHEMA wms_platform;
