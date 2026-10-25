-- T-1005 — Bütün müşteri alanlarını (tenant) ve onlara ait her şeyi siler; panel operatörünü ve platform tanımlarını korur.
--
-- Çalıştırma (VPS, root; ayrıntı deploy/vps/ops/RESET.md):
--   docker exec -i --user postgres etkinwms-postgres psql -X -d etkinwms -v dry_run=1 < reset-tenants.sql   # kuru koşu
--   docker exec -i --user postgres etkinwms-postgres psql -X -d etkinwms -v dry_run=0 < reset-tenants.sql   # gerçek
--
-- Güvenlik:
--   * Tek transaction. Bir denetim düşerse RAISE EXCEPTION → ON_ERROR_STOP → hiçbir şey yazılmaz.
--   * `dry_run` verilmezse KURU KOŞU sayılır. Kuru koşu silmeleri ve doğrulamaları gerçekten yapar, sonunda ROLLBACK eder.
--   * Süper kullanıcı gerekir (postgres). Koruma/append-only tetikleyicileri yalnız silinen tablolarda, ADIYLA ve bu
--     transaction içinde kapatılır; transaction bitmeden her biri ÖNCEKİ kipine (ENABLE / ENABLE ALWAYS / ENABLE REPLICA)
--     geri döner ve bu da doğrulanır. `session_replication_role = replica` KULLANILMAZ: (1) audit_logs, stock_ledger,
--     security_events gibi tabloların tetikleyicileri ENABLE ALWAYS'tır, replica kipinde de çalışır; (2) replica kipi FK
--     denetimini de kapatır. Burada FK'ler açık kalır: eksik bir silme yetim satır bırakamaz, transaction düşer.
--   * Kalanlar: wms_platform.operators e-postasına sahip kullanıcılar (parola, MFA, oturum, güvenilir cihaz), paketler,
--     satış sayfası, operatörün panel işlem kaydı (security_events platform.*), tenant'sız genel tanımlar, şema/migration
--     defteri, roller/grant'lar, pg-boss zamanlamaları.

\set ON_ERROR_STOP on
\if :{?dry_run}
\else
\set dry_run 1
\endif
-- Yalnız 0 ya da 1: psql \if geçersiz değeri yanlış (COMMIT) sayabileceği için önce burada reddedilir.
SELECT :'dry_run' IN ('0', '1') AS reset_dry_run_ok \gset
\if :reset_dry_run_ok
\else
DO $bad$ BEGIN RAISE EXCEPTION 'RESET_ABORT: dry_run yalnız 0 ya da 1 olabilir; hiçbir şey yapılmadı'; END $bad$;
\endif
\echo 'reset-tenants: dry_run =' :dry_run

BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '10min';
SET LOCAL search_path = pg_catalog, pg_temp;

-- ---------------------------------------------------------------------------------------------------------------
-- 0. Ön denetimler + plan
-- ---------------------------------------------------------------------------------------------------------------
DO $pre$
DECLARE
  v_ops int;
  v_ops_mfa int;
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'RESET_ABORT: süper kullanıcı gerekli (docker exec --user postgres ... psql)';
  END IF;
  IF to_regclass('public.tenants') IS NULL OR to_regclass('wms_platform.operators') IS NULL THEN
    RAISE EXCEPTION 'RESET_ABORT: beklenen şema yok (yanlış veritabanı mı? -d etkinwms)';
  END IF;
  SELECT count(*), count(*) FILTER (WHERE u.email_verified AND u.two_factor_enabled
                                      AND EXISTS (SELECT 1 FROM public.two_factors f WHERE f.user_id = u.id AND f.verified))
    INTO v_ops, v_ops_mfa
    FROM public.users u
   WHERE EXISTS (SELECT 1 FROM wms_platform.operators o WHERE o.email_normalized = lower(btrim(u.email)));
  IF v_ops_mfa < 1 THEN
    RAISE EXCEPTION 'RESET_ABORT: MFA''sı kurulu operatör hesabı yok (operatör kullanıcı: %); panel girişi kaybolurdu', v_ops;
  END IF;
  RAISE NOTICE 'operatör hesabı (korunacak): %, MFA kurulu: %', v_ops, v_ops_mfa;
END
$pre$;

-- Korunacak operatör kullanıcıları ve önceki durumları (sonda karşılaştırılır).
CREATE TEMP TABLE reset_operator_users ON COMMIT DROP AS
SELECT u.id, u.email,
       (SELECT count(*) FROM public.accounts a WHERE a.user_id = u.id) AS accounts,
       (SELECT count(*) FROM public.two_factors f WHERE f.user_id = u.id) AS two_factors,
       (SELECT count(*) FROM public.sessions s WHERE s.user_id = u.id) AS sessions,
       (SELECT count(*) FROM public.verifications v WHERE v.value = u.id::text) AS verifications,
       (SELECT count(*) FROM public.security_events e WHERE e.user_id = u.id) AS security_events
  FROM public.users u
 WHERE EXISTS (SELECT 1 FROM wms_platform.operators o WHERE o.email_normalized = lower(btrim(u.email)));

CREATE TEMP TABLE reset_deleted_users ON COMMIT DROP AS
SELECT u.id FROM public.users u WHERE u.id NOT IN (SELECT id FROM reset_operator_users);

-- Kiracı kolonlu tablolar: `tenant_id` ya da `*_tenant_id` (uuid) kolonu olan bütün düz tablolar (bölüm çocukları hariç).
-- Yeni bir kiracı tablosu migration'la eklendiğinde kendiliğinden kapsama girer.
CREATE TEMP TABLE reset_tenant_tables ON COMMIT DROP AS
SELECT c.oid AS rel, n.nspname AS sch, c.relname AS tbl, a.attname AS col
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
 WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
   AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND n.nspname NOT LIKE 'pg_temp%'
   AND (a.attname = 'tenant_id' OR a.attname LIKE '%\_tenant\_id')
   AND a.atttypid = 'uuid'::regtype;

DO $plan$
DECLARE
  r record;
  v_n bigint;
BEGIN
  RAISE NOTICE 'silinecek kiracı (tenant): %', (SELECT count(*) FROM public.tenants);
  RAISE NOTICE 'silinecek müşteri kullanıcısı: % (operatör dışı bütün kullanıcılar)', (SELECT count(*) FROM reset_deleted_users);
  RAISE NOTICE 'silinecek demo talebi: %', (SELECT count(*) FROM wms_platform.demo_requests);
  RAISE NOTICE 'silinecek demo e-posta rezervasyonu: % · talep anahtarı: % · durum e-postası: %',
    (SELECT count(*) FROM wms_platform.demo_email_reservations), (SELECT count(*) FROM wms_platform.demo_request_keys),
    (SELECT count(*) FROM wms_platform.demo_status_deliveries);
  FOR r IN SELECT * FROM reset_tenant_tables ORDER BY sch, tbl, col LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I IS NOT NULL', r.sch, r.tbl, r.col) INTO v_n;
    IF v_n > 0 THEN
      RAISE NOTICE '  % satır  %.%', lpad(v_n::text, 8), r.sch, r.tbl;
    END IF;
  END LOOP;
END
$plan$;

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Koruma tetikleyicilerini yalnız silinen tablolarda, adıyla kapat (önceki kip saklanır)
-- ---------------------------------------------------------------------------------------------------------------
CREATE TEMP TABLE reset_triggers ON COMMIT DROP AS
SELECT t.tgrelid AS rel, t.tgname AS name, t.tgenabled AS mode
  FROM pg_trigger t
 WHERE NOT t.tgisinternal AND t.tgenabled <> 'D'
   AND t.tgrelid IN (
     SELECT rel FROM reset_tenant_tables
     UNION SELECT unnest(ARRAY['public.tenants', 'public.users', 'public.accounts', 'public.sessions', 'public.two_factors',
                               'public.verifications', 'public.security_events', 'public.field_sessions',
                               'public.field_device_lockouts', 'public.auth_rate_limits', 'public.request_rate_limits',
                               'wms_platform.demo_requests']::regclass[])::oid);

DO $off$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM reset_triggers ORDER BY rel::regclass::text, name LOOP
    EXECUTE format('ALTER TABLE %s DISABLE TRIGGER %I', r.rel::regclass, r.name);
  END LOOP;
  RAISE NOTICE 'geçici kapatılan tetikleyici: %', (SELECT count(*) FROM reset_triggers);
END
$off$;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Silme (FK'ler açık; sıra FK grafiğinden hesaplanır)
-- ---------------------------------------------------------------------------------------------------------------
-- 2a. Kiracı kolonu olmayan ama saha cihazına bağlı satırlar.
DELETE FROM public.field_sessions;
DELETE FROM public.field_device_lockouts;

-- 2b. Kiracı tabloları: önce çocuklar. Ertelenebilir FK'ler (döngülü paket bağları) sıralamaya girmez, sonda denetlenir.
DO $tenant$
DECLARE
  v_left oid[];
  v_ready oid[];
  v_rel oid;
  r record;
  v_n bigint;
BEGIN
  SELECT array_agg(DISTINCT rel) INTO v_left FROM reset_tenant_tables;
  v_left := v_left || 'public.tenants'::regclass::oid;
  WHILE cardinality(v_left) > 0 LOOP
    SELECT array_agg(t) INTO v_ready
      FROM unnest(v_left) AS t
     WHERE NOT EXISTS (SELECT 1 FROM pg_constraint k
                        WHERE k.contype = 'f' AND NOT k.condeferrable
                          AND k.confrelid = t AND k.conrelid <> t AND k.conrelid = ANY (v_left));
    IF v_ready IS NULL THEN
      RAISE EXCEPTION 'RESET_ABORT: kiracı tablolarında çözülemeyen FK döngüsü: %',
        (SELECT string_agg(x::regclass::text, ', ') FROM unnest(v_left) x);
    END IF;
    FOREACH v_rel IN ARRAY v_ready LOOP
      IF v_rel = 'public.tenants'::regclass THEN
        DELETE FROM public.tenants;
        GET DIAGNOSTICS v_n = ROW_COUNT;
      ELSE
        -- Bir tabloda birden çok kiracı kolonu olabilir: herhangi biri doluysa satır kiracıya aittir.
        EXECUTE format('DELETE FROM %s WHERE %s', v_rel::regclass,
                       (SELECT string_agg(format('%I IS NOT NULL', col), ' OR ') FROM reset_tenant_tables WHERE rel = v_rel));
        GET DIAGNOSTICS v_n = ROW_COUNT;
      END IF;
      IF v_n > 0 THEN
        RAISE NOTICE '  silindi % satır  %', lpad(v_n::text, 8), v_rel::regclass;
      END IF;
    END LOOP;
    SELECT coalesce(array_agg(t), '{}') INTO v_left FROM unnest(v_left) AS t WHERE t <> ALL (v_ready);
  END LOOP;
END
$tenant$;

-- 2c. Panel tarafındaki müşteri kaydı: demo talepleri (abonelik/tahakkuk kiracı kolonuyla 2b'de silindi) ve 0057 (T-1025)
--     tekilleştirme kayıtları. Rezervasyon kalırsa aynı e-postadan gelen yeni talep sessizce düşer (T-1032).
DELETE FROM wms_platform.demo_requests;
DELETE FROM wms_platform.demo_status_deliveries;
DELETE FROM wms_platform.demo_request_keys;
DELETE FROM wms_platform.demo_email_reservations;

-- 2d. Müşteri kullanıcıları: güvenlik olayları (önceden silinmiş kullanıcılarınkiler dahil; operatörün ve kullanıcısız
--     platform olayları kalır), güvenilir cihaz/sıfırlama kayıtları, sonra kullanıcı
--     (accounts, sessions, two_factors, admin_reset_grants ON DELETE CASCADE ile gider).
DELETE FROM public.security_events WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM reset_operator_users);
DELETE FROM public.verifications v WHERE NOT EXISTS (SELECT 1 FROM reset_operator_users o WHERE v.value = o.id::text);
DELETE FROM public.users WHERE id IN (SELECT id FROM reset_deleted_users);

-- 2e. Geçici sayaçlar ve kuyruk işleri (web/worker durdurulmuş olmalı; zamanlamalar pgboss.schedule'da kalır).
DELETE FROM public.auth_rate_limits;
DELETE FROM public.request_rate_limits;
DO $queue$
DECLARE v_n bigint;
BEGIN
  IF to_regclass('pgboss.job') IS NOT NULL THEN
    IF to_regclass('pgboss.job_dependency') IS NOT NULL THEN
      DELETE FROM pgboss.job_dependency;
    END IF;
    DELETE FROM pgboss.job;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE NOTICE '  silindi % satır  pgboss.job (kuyruk işleri)', lpad(v_n::text, 8);
  END IF;
END
$queue$;

-- Ertelenmiş FK'ler şimdi denetlensin: hata COMMIT'te değil burada çıkar; ayrıca bekleyen tetikleyici olayı varken
-- ALTER TABLE ... ENABLE TRIGGER yapılamaz.
SET CONSTRAINTS ALL IMMEDIATE;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Tetikleyicileri önceki kiplerine döndür
-- ---------------------------------------------------------------------------------------------------------------
DO $on$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM reset_triggers ORDER BY rel::regclass::text, name LOOP
    EXECUTE format('ALTER TABLE %s ENABLE %s TRIGGER %I', r.rel::regclass,
                   CASE r.mode WHEN 'A' THEN 'ALWAYS' WHEN 'R' THEN 'REPLICA' ELSE '' END, r.name);
  END LOOP;
END
$on$;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Doğrulama — biri bile düşerse RAISE EXCEPTION → ROLLBACK
-- ---------------------------------------------------------------------------------------------------------------
DO $verify$
DECLARE
  r record;
  v_n bigint;
  v_bad text := '';
BEGIN
  IF (SELECT count(*) FROM public.tenants) <> 0 THEN
    RAISE EXCEPTION 'RESET_VERIFY: tenants boş değil';
  END IF;

  -- Yetim satır yok: information_schema'daki bütün kiracı kolonları taranır (tenant'sız genel satırlar NULL'dur).
  FOR r IN
    SELECT col.table_schema, col.table_name, col.column_name
      FROM information_schema.columns col
      JOIN information_schema.tables tab USING (table_schema, table_name)
     WHERE tab.table_type = 'BASE TABLE'
       AND col.table_schema NOT IN ('pg_catalog', 'information_schema') AND col.table_schema NOT LIKE 'pg_temp%'
       AND (col.column_name = 'tenant_id' OR col.column_name LIKE '%\_tenant\_id')
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I IS NOT NULL', r.table_schema, r.table_name, r.column_name) INTO v_n;
    IF v_n > 0 THEN
      v_bad := v_bad || format(' %s.%s.%s=%s', r.table_schema, r.table_name, r.column_name, v_n);
    END IF;
  END LOOP;
  IF v_bad <> '' THEN
    RAISE EXCEPTION 'RESET_VERIFY: kiracı kolonu dolu satır kaldı:%', v_bad;
  END IF;

  -- Kullanıcı tarafı: yalnız operatörler kaldı, bağlı satırların hepsi var olan kullanıcıya ait.
  IF EXISTS (SELECT 1 FROM public.users u WHERE u.id NOT IN (SELECT id FROM reset_operator_users)) THEN
    RAISE EXCEPTION 'RESET_VERIFY: operatör dışı kullanıcı kaldı';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sessions s WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = s.user_id))
     OR EXISTS (SELECT 1 FROM public.accounts a WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = a.user_id))
     OR EXISTS (SELECT 1 FROM public.two_factors f WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = f.user_id))
     OR EXISTS (SELECT 1 FROM public.security_events e WHERE e.user_id IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = e.user_id))
     OR EXISTS (SELECT 1 FROM public.field_sessions) OR EXISTS (SELECT 1 FROM public.field_device_lockouts)
     OR EXISTS (SELECT 1 FROM wms_platform.demo_requests) OR EXISTS (SELECT 1 FROM wms_platform.demo_email_reservations)
     OR EXISTS (SELECT 1 FROM wms_platform.demo_request_keys) OR EXISTS (SELECT 1 FROM wms_platform.demo_status_deliveries) THEN
    RAISE EXCEPTION 'RESET_VERIFY: kullanıcıya/cihaza/talebe bağlı yetim satır kaldı';
  END IF;

  -- Operatör hesabı, parolası, MFA'sı, oturumları, güvenilir cihazları ve panel işlem kaydı aynen duruyor.
  FOR r IN SELECT * FROM reset_operator_users LOOP
    IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = r.id)
       OR (SELECT count(*) FROM public.accounts a WHERE a.user_id = r.id) <> r.accounts
       OR (SELECT count(*) FROM public.two_factors f WHERE f.user_id = r.id) <> r.two_factors
       OR (SELECT count(*) FROM public.sessions s WHERE s.user_id = r.id) <> r.sessions
       OR (SELECT count(*) FROM public.verifications v WHERE v.value = r.id::text) <> r.verifications
       OR (SELECT count(*) FROM public.security_events e WHERE e.user_id = r.id) <> r.security_events THEN
      RAISE EXCEPTION 'RESET_VERIFY: operatör hesabı değişti (%)', r.id;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.users u
                  WHERE u.id IN (SELECT id FROM reset_operator_users) AND u.email_verified AND u.two_factor_enabled
                    AND EXISTS (SELECT 1 FROM public.two_factors f WHERE f.user_id = u.id AND f.verified)
                    AND EXISTS (SELECT 1 FROM public.accounts a WHERE a.user_id = u.id AND a.provider_id = 'credential'
                                   AND a.password IS NOT NULL)) THEN
    RAISE EXCEPTION 'RESET_VERIFY: parola + MFA ile girebilecek operatör kalmadı';
  END IF;

  -- Tetikleyiciler önceki kiplerinde.
  IF EXISTS (SELECT 1 FROM reset_triggers r2 JOIN pg_trigger t ON t.tgrelid = r2.rel AND t.tgname = r2.name
              WHERE t.tgenabled <> r2.mode)
     OR (SELECT count(*) FROM reset_triggers r2 JOIN pg_trigger t ON t.tgrelid = r2.rel AND t.tgname = r2.name)
        <> (SELECT count(*) FROM reset_triggers) THEN
    RAISE EXCEPTION 'RESET_VERIFY: tetikleyici kipi geri dönmedi';
  END IF;

  RAISE NOTICE 'doğrulama TAMAM: tenant 0, yetim satır 0, operatör % hesap korundu, % tetikleyici geri açıldı, kalan: paket %, operatör %',
    (SELECT count(*) FROM reset_operator_users), (SELECT count(*) FROM reset_triggers),
    (SELECT count(*) FROM wms_platform.plans), (SELECT count(*) FROM wms_platform.operators);
END
$verify$;

\if :dry_run
ROLLBACK;
\echo 'reset-tenants: KURU KOŞU — hiçbir şey değişmedi (ROLLBACK).'
\else
COMMIT;
\echo 'reset-tenants: TAMAMLANDI (COMMIT).'
\endif
