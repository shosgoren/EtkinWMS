-- 0050_parties (T-428): cari kartlar (müşteri / tedarikçi). Kullanıcı isteği 2026-10-19: cari kartlar Excel'den aktarılabilsin; bugün siparişte
-- müşteri yalnız serbest metin (`sales_orders.customer_ref`, değişmez). G-08: yalnız GENİŞLETME (yeni tablo; mevcut tablolara dokunulmaz).
--
-- BİLİNÇLİ KARARLAR (inceleme için):
-- * Kod alan içinde benzersizdir; karşılaştırma büyük/küçük harf ve baş/son boşluktan bağımsızdır (`code_key`, Türkçe büyük harf uygulamada üretilir,
--   veritabanı ayrıca biçimini denetler). Fiziksel silme yok: arşivleme (`archived_at`). DELETE yetkisi verilmez.
-- * Vergi no 10/11 hane denetimi uyarıdır (uygulama), veritabanında yalnız karakter/uzunluk sınırı vardır (yabancı cari).
-- * `updated_at` ve `version` sunucuda (tetikleyici); uygulama rolü yazamaz. Bakiye/muhasebe alanı yok (WMS'in işi değil).
-- * RLS ADR-015 §5 kalıbı (FORCE + tenant politikası); yetkiler sütun bazlı.
-- Koşturucu tek transaction içinde çalıştırır.

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tenant_settings' AND column_name = 'separation_of_duties') THEN
    RAISE EXCEPTION '0050_parties: 0049 önkoşulu yok';
  END IF;
END
$pre$;

CREATE TABLE public.parties (
  tenant_id   uuid        NOT NULL REFERENCES public.tenants (id),
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  code        text        NOT NULL,
  code_key    text        NOT NULL,
  name        text        NOT NULL,
  kind        text        NOT NULL DEFAULT 'CUSTOMER',
  tax_no      text,
  tax_office  text,
  phone       text,
  email       text,
  city        text,
  address     text,
  archived_at timestamptz,
  created_by  uuid        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     integer     NOT NULL DEFAULT 1,
  CONSTRAINT parties_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT parties_tenant_code_key UNIQUE (tenant_id, code_key),
  CONSTRAINT parties_created_by_fkey FOREIGN KEY (tenant_id, created_by) REFERENCES public.tenant_memberships (tenant_id, id),
  CONSTRAINT parties_code_chk CHECK (char_length(code) BETWEEN 1 AND 64 AND code !~ '[[:cntrl:]]'),
  CONSTRAINT parties_code_key_chk CHECK (code_key = upper(btrim(code_key)) AND char_length(code_key) BETWEEN 1 AND 64),
  CONSTRAINT parties_name_chk CHECK (char_length(name) BETWEEN 1 AND 200 AND name !~ '[[:cntrl:]]'),
  CONSTRAINT parties_kind_chk CHECK (kind IN ('CUSTOMER', 'SUPPLIER', 'BOTH')),
  CONSTRAINT parties_tax_no_chk CHECK (tax_no IS NULL OR (char_length(tax_no) BETWEEN 1 AND 20 AND tax_no ~ '^[0-9A-Za-z -]+$')),
  CONSTRAINT parties_tax_office_chk CHECK (tax_office IS NULL OR char_length(tax_office) BETWEEN 1 AND 100),
  CONSTRAINT parties_phone_chk CHECK (phone IS NULL OR (char_length(phone) BETWEEN 1 AND 40 AND phone ~ '^[0-9+() ./-]+$')),
  CONSTRAINT parties_email_chk CHECK (email IS NULL OR (char_length(email) BETWEEN 3 AND 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$')),
  CONSTRAINT parties_city_chk CHECK (city IS NULL OR char_length(city) BETWEEN 1 AND 100),
  CONSTRAINT parties_address_chk CHECK (address IS NULL OR char_length(address) BETWEEN 1 AND 500),
  CONSTRAINT parties_version_chk CHECK (version >= 1)
);
CREATE INDEX parties_tenant_name_idx ON public.parties (tenant_id, name);

-- Zaman damgası ve sürüm sunucuda; kimlik/kiracı/oluşturan değişmez.
CREATE FUNCTION public.parties_touch() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'parties: kimlik alanları değiştirilemez' USING ERRCODE = '23514';
    END IF;
    NEW.version := OLD.version + 1;
  ELSE
    NEW.version := 1;
    NEW.created_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.parties_touch() FROM PUBLIC;
CREATE TRIGGER parties_touch BEFORE INSERT OR UPDATE ON public.parties
  FOR EACH ROW EXECUTE FUNCTION public.parties_touch();

ALTER TABLE public.parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parties FORCE ROW LEVEL SECURITY;
CREATE POLICY parties_isolation ON public.parties
  USING      (tenant_id = NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid);
REVOKE ALL ON TABLE public.parties FROM PUBLIC;

GRANT SELECT ON public.parties TO wms_app;
GRANT INSERT (tenant_id, id, code, code_key, name, kind, tax_no, tax_office, phone, email, city, address, created_by) ON public.parties TO wms_app;
GRANT UPDATE (code, code_key, name, kind, tax_no, tax_office, phone, email, city, address, archived_at) ON public.parties TO wms_app;

DO $verify$
DECLARE
  r text;
BEGIN
  IF NOT pg_catalog.has_table_privilege('wms_app', 'public.parties', 'SELECT') THEN
    RAISE EXCEPTION '0050_parties: wms_app okuyamıyor';
  END IF;
  IF pg_catalog.has_table_privilege('wms_app', 'public.parties', 'DELETE') THEN
    RAISE EXCEPTION '0050_parties: wms_app silebiliyor';
  END IF;
  FOREACH r IN ARRAY ARRAY['wms_auth', 'wms_worker'] LOOP
    IF pg_catalog.to_regrole(r) IS NOT NULL AND pg_catalog.has_table_privilege(r, 'public.parties', 'INSERT') THEN
      RAISE EXCEPTION '0050_parties: % rolü cari yazabiliyor', r;
    END IF;
  END LOOP;
END
$verify$;
