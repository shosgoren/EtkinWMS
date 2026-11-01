-- 0071_demo_reopen (T-1144, kullanıcı kararı 1 Kasım 2026: "reddedilen talebi geri açma imkanı da önemli"): operatör reddedilmiş demo
-- talebini yeniden BEKLEMEDE'ye alır; talep sonra onaylanabilir. G-08: yalnızca GENİŞLETME (bir işlev; tablo, kısıt, yetki değişmez).
--
-- BİLİNÇLİ KARARLAR (inceleme için):
-- * Yalnız REJECTED → PENDING. Onaylanmış talep (APPROVED) reddedilir (55000): bağlantısı verilmiş ya da etkinleşmiş talep geri alınmaz.
-- * İDEMPOTENT: talep zaten PENDING ise değişiklik ve olay yazılmadan 'PENDING' döner (çift dokunuş / yeniden deneme ikinci kayıt üretmez).
-- * AYNI E-POSTAYA İKİNCİ DENEME YOK (T-1144 security-reviewer MINOR-1): 0057 öncesinden kalan yinelenen talepler silinmedi (aynı
--   e-postanın birden çok satırı olabilir). Aynı normalize e-postanın (`lower(btrim(email))`, 0057 ile aynı) BAŞKA bir satırı reddedilmiş
--   değilse (PENDING, APPROVED ya da etkinleşmiş) geri açma reddedilir: SQLSTATE 'WD001' → domain VERSION_CONFLICT /
--   EMAIL_ALREADY_APPROVED. Böylece geri açılan kopya onaylanıp ikinci deneme alanı açılamaz. Eşzamanlı iki kopyanın birlikte açılması
--   0057 `demo_submit` ile aynı e-posta danışma kilidiyle (`hashtextextended(e-posta, 5726)`) sıraya girer.
-- * Karar sütunları temizlenir (`decided_at`, `decided_by` NULL): 0038 `demo_requests_decision_chk` (PENDING ⇔ karar alanları boş) bunu
--   zaten ister. Reddedilmiş talepte aktivasyon sütunları yoktur (0039 `demo_requests_activation_chk` belirteci yalnız APPROVED'da izin
--   verir), temizlenecek başka alan yoktur.
-- * Operatör veritabanında zorlanır (`platform_is_operator`, 42501); karar ile aynı transaction'da `security_events` satırı
--   `platform.demo_request.reopened` (kişisel veri yok: yalnız talep kimliği; 0038 kararı ile aynı biçim). İşlev sahibi
--   wms_identity_probe (platform.* olaylarını yalnız o yazar, 0038 tetikleyicisi); probe'un 0038'de verilen sütun yetkileri yeterlidir.
-- * EXECUTE yalnız wms_app (panel). Koşturucu tek transaction içinde çalıştırır.

DO $pre$
BEGIN
  IF pg_catalog.to_regprocedure('wms_probe.platform_decide_demo_request(uuid, text)') IS NULL THEN
    RAISE EXCEPTION '0071_demo_reopen: platform_decide_demo_request yok (0038 önkoşulu)';
  END IF;
END
$pre$;

GRANT CREATE ON SCHEMA wms_probe TO wms_identity_probe;
SET ROLE wms_identity_probe;

CREATE FUNCTION wms_probe.platform_reopen_demo_request(p_id uuid) RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_uid uuid;
  v_status text;
  v_email text;
BEGIN
  IF NOT wms_probe.platform_is_operator() THEN
    RAISE EXCEPTION 'platform_reopen_demo_request: operatör değil' USING ERRCODE = '42501';
  END IF;
  v_uid := pg_catalog.current_setting('app.current_user_id', true)::uuid;
  SELECT pg_catalog.lower(pg_catalog.btrim(d.email)) INTO v_email FROM wms_platform.demo_requests d WHERE d.id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform_reopen_demo_request: talep yok' USING ERRCODE = 'P0002';
  END IF;
  -- Aynı e-postanın kopyaları sıraya girer (0057 demo_submit ile aynı anahtar), sonra satır kilidi.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_email, 5726));
  SELECT d.status INTO v_status FROM wms_platform.demo_requests d WHERE d.id = p_id FOR UPDATE;
  IF v_status = 'PENDING' THEN
    RETURN 'PENDING';
  END IF;
  IF v_status <> 'REJECTED' THEN
    RAISE EXCEPTION 'platform_reopen_demo_request: yalnız reddedilmiş talep geri açılır (%)', v_status USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
       SELECT 1 FROM wms_platform.demo_requests o
        WHERE pg_catalog.lower(pg_catalog.btrim(o.email)) = v_email AND o.id <> p_id
          AND (o.status <> 'REJECTED' OR o.activated_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'platform_reopen_demo_request: bu e-posta için açık ya da onaylı talep var' USING ERRCODE = 'WD001';
  END IF;
  UPDATE wms_platform.demo_requests SET status = 'PENDING', decided_at = NULL, decided_by = NULL WHERE id = p_id;
  INSERT INTO public.security_events (user_id, event_type, detail)
  VALUES (v_uid, 'platform.demo_request.reopened', pg_catalog.jsonb_build_object('demo_request_id', p_id::text));
  RETURN 'PENDING';
END
$fn$;

REVOKE ALL ON FUNCTION wms_probe.platform_reopen_demo_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wms_probe.platform_reopen_demo_request(uuid) TO wms_app;

RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;

DO $verify$
DECLARE
  f text := 'wms_probe.platform_reopen_demo_request(uuid)';
  r text;
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid = f::regprocedure
          AND p.proowner = pg_catalog.to_regrole('wms_identity_probe')
          AND p.prosecdef
          AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']
          AND p.proacl IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a WHERE a.grantee = 0)) THEN
    RAISE EXCEPTION '0071_demo_reopen: % sahibi/SECURITY DEFINER/search_path/ACL beklenenden farklı', f;
  END IF;
  FOREACH r IN ARRAY ARRAY['wms_app', 'wms_auth', 'wms_worker', 'wms_ops'] LOOP
    IF pg_catalog.has_function_privilege(r, f, 'EXECUTE') <> (r = 'wms_app') THEN
      RAISE EXCEPTION '0071_demo_reopen: % rolünün % EXECUTE yetkisi beklenenden farklı', r, f;
    END IF;
  END LOOP;
  IF pg_catalog.has_schema_privilege('wms_identity_probe', 'wms_probe', 'CREATE') THEN
    RAISE EXCEPTION '0071_demo_reopen: wms_identity_probe wms_probe üzerinde CREATE taşımamalı';
  END IF;
END
$verify$;
