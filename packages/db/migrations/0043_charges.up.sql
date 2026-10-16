-- 0043_charges (T-406, ADR-027 §8): şirket kurulana kadar elle izlenen aylık tahakkuk ve tahsilat. G-08: yalnızca GENİŞLETME (bir platform
-- tablosu, abonelik numarası, dört işlev; müşteri listesi işlevi GECİKMEDE durumu için yeniden tanımlanır).
--
-- BİLİNÇLİ KARARLAR (inceleme için):
-- * Tahakkuk platform tarafındadır (`wms_platform.charges`); uygulama rollerinin yetkisi YOK; erişim yalnız operatör denetimli
--   `wms_probe.platform_*` SECURITY DEFINER işlevleriyle (0038–0042 kalıbı). Tenant tablolarına yazma yok.
-- * DÖNEM: İstanbul takvim ayı (dönemin ilk günü). Tahakkuk operatörün "Dönem tahakkuku" işlemiyle açılır (idempotent: tenant+dönem
--   tekil). Kimlere: demo değil, askıda değil, paketi atanmış, denemesi bitmiş (ya da ACTIVE abonelik) ve paket fiyatı > 0. Tutar
--   müşterinin bağlı olduğu paket SÜRÜMÜNÜN aylık fiyatıdır (KDV hariç). Vade: dönemin 7. günü; tahakkuk geç açıldıysa
--   açılıştan 7 gün sonra.
-- * DURUM türetilir: ödendiyse ÖDENDİ; vade geçtiyse GECİKTİ; değilse BEKLİYOR. Elle ödendi kaydı (ADR-027 §8): tarih (dönem başından en
--   çok 60 gün önce, en geç bugün), yöntem (HAVALE/KART/NAKIT), isteğe bağlı not (≤200, denetim karakteri yok), kaydeden operatör ve
--   zaman; kayıt sonradan değiştirilemez (geri alma yok; yanlış kayıt işlem kaydında görünür).
-- * Abonelik numarası (`ABN-0001`): aboneliğe sıra numarası (mevcut satırlar açılış sırasıyla numaralanır).
-- * Fatura numarası e-Arşiv entegratörü bağlanınca dolar (bu migration'da yazan yok).
-- * GÜVENLİK OLAYLARI: `platform.charges.accrued` (dönem + adet), `platform.charge.paid` (tenant + tahakkuk + yöntem). Kişisel veri yok
--   (not alanı olaya yazılmaz).
-- Koşturucu tek transaction içinde çalıştırır.

DO $pre$
BEGIN
  IF pg_catalog.to_regprocedure('wms_probe.platform_list_customers()') IS NULL THEN
    RAISE EXCEPTION '0043_charges: platform_list_customers yok (0042 önkoşulu)';
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------------------------
-- 1. Tablo ve abonelik numarası
-- ---------------------------------------------------------------------------------------------
CREATE SEQUENCE wms_platform.subscription_no_seq;
ALTER TABLE wms_platform.subscriptions ADD COLUMN number integer;
UPDATE wms_platform.subscriptions s SET number = o.n
  FROM (SELECT tenant_id, row_number() OVER (ORDER BY started_at, tenant_id) AS n FROM wms_platform.subscriptions) o
 WHERE o.tenant_id = s.tenant_id;
SELECT pg_catalog.setval('wms_platform.subscription_no_seq', coalesce((SELECT max(number) FROM wms_platform.subscriptions), 0) + 1, false);
ALTER TABLE wms_platform.subscriptions ALTER COLUMN number SET DEFAULT pg_catalog.nextval('wms_platform.subscription_no_seq');
ALTER TABLE wms_platform.subscriptions ALTER COLUMN number SET NOT NULL;
ALTER TABLE wms_platform.subscriptions ADD CONSTRAINT subscriptions_number_key UNIQUE (number);
ALTER SEQUENCE wms_platform.subscription_no_seq OWNED BY wms_platform.subscriptions.number;
GRANT USAGE ON SEQUENCE wms_platform.subscription_no_seq TO wms_identity_probe;

CREATE TABLE wms_platform.charges (
  id            uuid          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id     uuid          NOT NULL,
  period        date          NOT NULL,
  plan_id       uuid          NOT NULL,
  plan_version  integer       NOT NULL,
  amount        numeric(12,2) NOT NULL,
  due_on        date          NOT NULL,
  paid_on       date,
  paid_method   text,
  paid_note     text,
  paid_by       uuid,
  paid_recorded_at timestamptz,
  invoice_no    text,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  created_by    uuid,
  CONSTRAINT charges_pkey PRIMARY KEY (id),
  CONSTRAINT charges_tenant_period_key UNIQUE (tenant_id, period),
  CONSTRAINT charges_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants (id),
  CONSTRAINT charges_plan_version_fkey FOREIGN KEY (plan_id, plan_version) REFERENCES wms_platform.plan_versions (plan_id, version),
  CONSTRAINT charges_period_chk CHECK (period = pg_catalog.date_trunc('month', period)::date),
  CONSTRAINT charges_amount_chk CHECK (amount > 0 AND amount <= 1000000),
  CONSTRAINT charges_due_chk CHECK (due_on >= period),
  CONSTRAINT charges_paid_chk CHECK ((paid_on IS NULL) = (paid_method IS NULL) AND (paid_on IS NULL) = (paid_recorded_at IS NULL)
                                     AND (paid_on IS NOT NULL OR paid_note IS NULL)),
  CONSTRAINT charges_method_chk CHECK (paid_method IN ('HAVALE', 'KART', 'NAKIT')),
  CONSTRAINT charges_note_chk CHECK (paid_note IS NULL OR pg_catalog.length(paid_note) BETWEEN 1 AND 200)
);
CREATE INDEX charges_unpaid_idx ON wms_platform.charges (due_on) WHERE paid_on IS NULL;
REVOKE ALL ON wms_platform.charges FROM PUBLIC;
GRANT SELECT, INSERT ON wms_platform.charges TO wms_identity_probe;
GRANT UPDATE (paid_on, paid_method, paid_note, paid_by, paid_recorded_at) ON wms_platform.charges TO wms_identity_probe;

-- ---------------------------------------------------------------------------------------------
-- 2. İşlevler (SET ROLE kalıbı)
-- ---------------------------------------------------------------------------------------------
GRANT CREATE ON SCHEMA wms_probe TO wms_identity_probe;
SET ROLE wms_identity_probe;

-- Operatör: tahakkuklar (en yeni dönem önce). Durum türetilir; kişisel veri yok (not alanı dönmez).
CREATE FUNCTION wms_probe.platform_list_charges()
RETURNS TABLE (id uuid, tenant_id uuid, company text, ref text, period date, plan_name text, amount numeric, due_on date,
               status text, paid_on date, paid_method text, invoice_no text)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_today date := (now() AT TIME ZONE 'Europe/Istanbul')::date;
BEGIN
  IF NOT wms_probe.platform_is_operator() THEN
    RAISE EXCEPTION 'platform_list_charges: operatör değil' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT c.id, c.tenant_id, t.name, 'ABN-' || pg_catalog.lpad(s.number::text, 4, '0'), c.period, p.name, c.amount, c.due_on,
           CASE WHEN c.paid_on IS NOT NULL THEN 'PAID' WHEN v_today > c.due_on THEN 'OVERDUE' ELSE 'PENDING' END,
           c.paid_on, c.paid_method, c.invoice_no
      FROM wms_platform.charges c
      JOIN public.tenants t ON t.id = c.tenant_id
      JOIN wms_platform.plans p ON p.id = c.plan_id
      LEFT JOIN wms_platform.subscriptions s ON s.tenant_id = c.tenant_id
     ORDER BY c.period DESC, t.name, c.id;
END
$fn$;

-- Operatör: bu ayın (İstanbul) tahakkuklarını açar; açılan adet. Var olanlar atlanır.
CREATE FUNCTION wms_probe.platform_accrue_charges() RETURNS integer
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_uid uuid;
  v_period date := pg_catalog.date_trunc('month', (now() AT TIME ZONE 'Europe/Istanbul')::date)::date;
  v_n integer;
BEGIN
  IF NOT wms_probe.platform_is_operator() THEN
    RAISE EXCEPTION 'platform_accrue_charges: operatör değil' USING ERRCODE = '42501';
  END IF;
  v_uid := NULLIF(pg_catalog.current_setting('app.current_user_id', true), '')::uuid;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('platform.charges.accrue', 0));
  INSERT INTO wms_platform.charges (tenant_id, period, plan_id, plan_version, amount, due_on, created_by)
  SELECT s.tenant_id, v_period, s.plan_id, s.plan_version, v.price_monthly,
         GREATEST(v_period + 6, (now() AT TIME ZONE 'Europe/Istanbul')::date + 7), v_uid
    FROM wms_platform.subscriptions s
    JOIN public.tenants t ON t.id = s.tenant_id
    JOIN wms_platform.plan_versions v ON v.plan_id = s.plan_id AND v.version = s.plan_version
   WHERE NOT t.is_demo AND t.status = 'ACTIVE' AND v.price_monthly > 0
     AND (s.plan = 'ACTIVE' OR (s.plan = 'TRIAL' AND s.trial_ends_at <= now()))
  ON CONFLICT ON CONSTRAINT charges_tenant_period_key DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO public.security_events (user_id, event_type, detail)
  VALUES (v_uid, 'platform.charges.accrued', pg_catalog.jsonb_build_object('period', v_period, 'count', v_n));
  RETURN v_n;
END
$fn$;

-- Operatör: tahakkuku ödendi olarak işaretler (geri alınmaz). Zaten ödenmişse false.
CREATE FUNCTION wms_probe.platform_mark_charge_paid(p_charge uuid, p_paid_on date, p_method text, p_note text) RETURNS boolean
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_uid uuid;
  v_note text := NULLIF(pg_catalog.btrim(coalesce(p_note, '')), '');
  v_c wms_platform.charges%ROWTYPE;
BEGIN
  IF NOT wms_probe.platform_is_operator() THEN
    RAISE EXCEPTION 'platform_mark_charge_paid: operatör değil' USING ERRCODE = '42501';
  END IF;
  v_uid := NULLIF(pg_catalog.current_setting('app.current_user_id', true), '')::uuid;
  IF p_method IS NULL OR p_method NOT IN ('HAVALE', 'KART', 'NAKIT') OR p_paid_on IS NULL
     OR pg_catalog.length(coalesce(v_note, '')) > 200 OR coalesce(v_note, '') ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'platform_mark_charge_paid: girdi biçimsiz' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_c FROM wms_platform.charges c WHERE c.id = p_charge FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform_mark_charge_paid: tahakkuk yok' USING ERRCODE = 'P0002';
  END IF;
  IF v_c.paid_on IS NOT NULL THEN
    RETURN false;
  END IF;
  IF p_paid_on > (now() AT TIME ZONE 'Europe/Istanbul')::date OR p_paid_on < v_c.period - 60 THEN
    RAISE EXCEPTION 'platform_mark_charge_paid: tarih aralık dışında' USING ERRCODE = '22023';
  END IF;
  UPDATE wms_platform.charges c SET paid_on = p_paid_on, paid_method = p_method, paid_note = v_note, paid_by = v_uid,
                                    paid_recorded_at = now()
   WHERE c.id = p_charge;
  INSERT INTO public.security_events (user_id, event_type, detail)
  VALUES (v_uid, 'platform.charge.paid', pg_catalog.jsonb_build_object('tenant_id', v_c.tenant_id::text, 'charge_id', p_charge::text,
                                                                       'period', v_c.period, 'method', p_method, 'paid_on', p_paid_on));
  RETURN true;
END
$fn$;

-- Müşteri listesi: GECİKMEDE durumu için `overdue` sütunu eklenir (0042 tanımı + vadesi geçmiş ödenmemiş tahakkuk var mı).
DROP FUNCTION wms_probe.platform_list_customers();
CREATE FUNCTION wms_probe.platform_list_customers()
RETURNS TABLE (id uuid, name text, slug text, status text, created_at timestamptz, subscription text, trial_ends_at timestamptz,
               plan_id uuid, plan_name text, price_monthly numeric, max_admins integer, max_field integer, max_warehouses integer,
               max_items integer, admins integer, field integer, warehouses integer, items integer, last_login timestamptz,
               overdue boolean)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  r record;
  v_prev text;
  v_today date := (now() AT TIME ZONE 'Europe/Istanbul')::date;
BEGIN
  IF NOT wms_probe.platform_is_operator() THEN
    RAISE EXCEPTION 'platform_list_customers: operatör değil' USING ERRCODE = '42501';
  END IF;
  v_prev := pg_catalog.current_setting('app.current_tenant_id', true);
  FOR r IN
    SELECT t.id AS tid, t.name AS tname, t.slug AS tslug, t.status AS tstatus, t.created_at AS tcreated, s.plan AS splan,
           s.trial_ends_at AS strial, p.id AS pid, p.name AS pname, v.price_monthly AS vprice, v.max_admins AS vadm,
           v.max_field AS vfield, v.max_warehouses AS vwh, v.max_items AS vitems
      FROM public.tenants t
      LEFT JOIN wms_platform.subscriptions s ON s.tenant_id = t.id
      LEFT JOIN wms_platform.plans p ON p.id = s.plan_id
      LEFT JOIN wms_platform.plan_versions v ON v.plan_id = s.plan_id AND v.version = s.plan_version
     WHERE NOT t.is_demo
     ORDER BY t.created_at DESC, t.id
  LOOP
    PERFORM pg_catalog.set_config('app.current_tenant_id', r.tid::text, true);
    id := r.tid; name := r.tname; slug := r.tslug; status := r.tstatus; created_at := r.tcreated; subscription := r.splan;
    trial_ends_at := r.strial; plan_id := r.pid; plan_name := r.pname; price_monthly := r.vprice; max_admins := r.vadm;
    max_field := r.vfield; max_warehouses := r.vwh; max_items := r.vitems;
    admins := public.plan_member_count(r.tid, 'admins', NULL)::integer;
    field := public.plan_member_count(r.tid, 'field', NULL)::integer;
    SELECT count(*)::integer INTO warehouses FROM public.warehouses w WHERE w.tenant_id = r.tid AND w.status = 'ACTIVE' AND NOT w.is_sample;
    SELECT count(*)::integer INTO items FROM public.items i WHERE i.tenant_id = r.tid AND i.status = 'ACTIVE' AND NOT i.is_sample;
    SELECT max(se.created_at) INTO last_login FROM public.sessions se
     WHERE se.user_id IN (SELECT m.user_id FROM public.tenant_memberships m WHERE m.tenant_id = r.tid AND m.status = 'ACTIVE');
    overdue := EXISTS (SELECT 1 FROM wms_platform.charges c WHERE c.tenant_id = r.tid AND c.paid_on IS NULL AND c.due_on < v_today);
    RETURN NEXT;
  END LOOP;
  PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
END
$fn$;

REVOKE ALL ON FUNCTION wms_probe.platform_list_charges() FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.platform_accrue_charges() FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.platform_mark_charge_paid(uuid, date, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.platform_list_customers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wms_probe.platform_list_charges() TO wms_app;
GRANT EXECUTE ON FUNCTION wms_probe.platform_accrue_charges() TO wms_app;
GRANT EXECUTE ON FUNCTION wms_probe.platform_mark_charge_paid(uuid, date, text, text) TO wms_app;
GRANT EXECUTE ON FUNCTION wms_probe.platform_list_customers() TO wms_app;

RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;

DO $verify$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['platform_list_charges', 'platform_accrue_charges', 'platform_mark_charge_paid',
                           'platform_list_customers'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'wms_probe' AND p.proname = f AND p.prosecdef AND p.proowner = 'wms_identity_probe'::regrole
                      AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']) THEN
      RAISE EXCEPTION '0043_charges: % beklenen biçimde değil', f;
    END IF;
  END LOOP;
  IF pg_catalog.has_table_privilege('wms_app', 'wms_platform.charges', 'SELECT') THEN
    RAISE EXCEPTION '0043_charges: uygulama rolü tahakkuk tablosunu okuyabiliyor';
  END IF;
END
$verify$;
