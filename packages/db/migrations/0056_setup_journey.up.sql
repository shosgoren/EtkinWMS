-- 0056_setup_journey (T-1006): ilk kurulum yolculuğu durumu + Paraşüt'ten BİR KEZLİK açılış stoku ayarı/kilidi. G-08: yalnız GENİŞLETME.
--
-- BİLİNÇLİ KARARLAR (inceleme için):
-- * `setup_journeys` tenant başına tek satırdır (PK tenant_id). Yalnız kullanıcının SEÇİMLERİNİ tutar: atlanan adımlar, "üretim yapıyor
--   mu", kartların kaynağı (Excel / Paraşüt), Excel'de açılış stoku isteği, etiket basıldı işareti, kutlamanın kapatılması ve spotlight turunun durumu. Adımın
--   "tamam" olması BURADA TUTULMAZ: domain gerçek veriden hesaplar (ürün, raf, stok defteri, reçete, üretim, saha üyesi, görev). Tek istisna
--   etiket: yazdırma tarayıcıdadır, kaydı yoktu → `labels_printed_at` (ilk yazdırmada bir kez; tetikleyici geri almaz).
-- * Adım anahtarları CHECK ile sabittir (uygulamadaki JOURNEY_STEPS ile aynı); dizi tekrar içeremez, en çok 8 öğe.
-- * Açılış stoku (kullanıcı kararı 22 Ekim): `integrations.opening_stock_enabled` (varsayılan KAPALI) — açıkken ve daha önce hiç
--   alınmadıysa ERP'deki stok miktarları BİR KEZ açılış stoku belgesi (STOCK_IN, domain komutu) olarak işlenir. Kilit DB'dedir:
--   (1) `opening_stock_taken_at` + `opening_stock_document_id` birlikte dolar (CHECK), bir kez dolunca değiştirilemez / silinemez (tetikleyici,
--       SQLSTATE 55000); (2) dolarken ayar açık olmalı, belge bu tenant'ın STOCK_IN belgesi olmalı ve commit anında İŞLENMİŞ (POSTED) olmalı
--       (ertelenmiş kısıt tetikleyicisi); zaman sunucudan;
--   (3) tenant başına tek açılış (kısmi tekil indeks: başka sağlayıcıdan da ikinci açılış yok). Stok bundan sonra yalnız Etkin -> ERP gider
--   (0055 `integration_flows_direction_rule_chk` değişmedi).
-- * `wms_app` yalnız sütun düzeyi INSERT/UPDATE; ENABLE + FORCE RLS, tenant izolasyonu (0055 ile aynı politika metni). DELETE yok.
-- Koşturucu tek transaction içinde çalıştırır.

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.integrations') IS NULL THEN
    RAISE EXCEPTION '0056_setup_journey: 0055 önkoşulu yok';
  END IF;
END
$pre$;

CREATE TABLE public.setup_journeys (
  tenant_id            uuid        NOT NULL,
  makes_production     boolean,
  card_source          text,
  opening_stock_wanted boolean,
  skipped              text[]      NOT NULL DEFAULT '{}'::text[],
  labels_printed_at    timestamptz,
  dismissed_at         timestamptz,
  tour_state           text,
  updated_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  version              integer     NOT NULL DEFAULT 1,
  CONSTRAINT setup_journeys_pkey PRIMARY KEY (tenant_id),
  CONSTRAINT setup_journeys_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants (id),
  CONSTRAINT setup_journeys_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users (id),
  CONSTRAINT setup_journeys_skipped_chk CHECK (
    skipped <@ ARRAY['cards', 'shelves', 'stock', 'labels', 'bom', 'order', 'people', 'task']::text[]
    AND pg_catalog.cardinality(skipped) <= 8
  ),
  CONSTRAINT setup_journeys_source_chk CHECK (card_source IS NULL OR card_source IN ('EXCEL', 'PARASUT')),
  -- Spotlight tur: NULL = hiç başlamadı (yeni kiracıda ilk girişte başlar), ACTIVE = sürüyor, CLOSED = "Turu kapat" / Esc.
  CONSTRAINT setup_journeys_tour_chk CHECK (tour_state IS NULL OR tour_state IN ('ACTIVE', 'CLOSED')),
  CONSTRAINT setup_journeys_version_chk CHECK (version >= 1)
);

CREATE FUNCTION public.setup_journeys_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  k text;
  seen text[] := '{}';
BEGIN
  FOREACH k IN ARRAY NEW.skipped LOOP
    IF k = ANY (seen) THEN
      RAISE EXCEPTION 'setup_journeys: atlanan adım tekrar edemez' USING ERRCODE = '23514';
    END IF;
    seen := seen || k;
  END LOOP;
  IF TG_OP = 'UPDATE' THEN
    -- Etiket işareti bir kez yazılır; geri alınmaz (tamamlanma gerçek olaydan).
    IF OLD.labels_printed_at IS NOT NULL THEN
      NEW.labels_printed_at := OLD.labels_printed_at;
    END IF;
    NEW.created_at := OLD.created_at;
    NEW.version := OLD.version + 1;
  END IF;
  IF NEW.labels_printed_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.labels_printed_at IS NULL) THEN
    NEW.labels_printed_at := pg_catalog.now();
  END IF;
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.setup_journeys_guard() FROM PUBLIC;
CREATE TRIGGER setup_journeys_guard BEFORE INSERT OR UPDATE ON public.setup_journeys
  FOR EACH ROW EXECUTE FUNCTION public.setup_journeys_guard();

ALTER TABLE public.setup_journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setup_journeys FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.setup_journeys FROM PUBLIC;
CREATE POLICY setup_journeys_isolation ON public.setup_journeys
  USING      (tenant_id = NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT ON public.setup_journeys TO wms_app;
GRANT INSERT (tenant_id, makes_production, card_source, opening_stock_wanted, skipped, labels_printed_at, dismissed_at, tour_state, updated_by)
  ON public.setup_journeys TO wms_app;
GRANT UPDATE (makes_production, card_source, opening_stock_wanted, skipped, labels_printed_at, dismissed_at, tour_state, updated_by)
  ON public.setup_journeys TO wms_app;

-- --- Paraşüt (ERP) açılış stoku: ayar + bir kezlik kilit ----------------------------------------------------------------------------
ALTER TABLE public.integrations
  ADD COLUMN opening_stock_enabled     boolean NOT NULL DEFAULT false,
  ADD COLUMN opening_stock_taken_at    timestamptz,
  ADD COLUMN opening_stock_document_id uuid,
  ADD CONSTRAINT integrations_opening_stock_chk CHECK ((opening_stock_taken_at IS NULL) = (opening_stock_document_id IS NULL)),
  ADD CONSTRAINT integrations_opening_document_fkey FOREIGN KEY (tenant_id, opening_stock_document_id) REFERENCES public.documents (tenant_id, id);

-- Tenant başına tek açılış stoku (sağlayıcıdan bağımsız).
CREATE UNIQUE INDEX integrations_opening_stock_once ON public.integrations (tenant_id) WHERE opening_stock_taken_at IS NOT NULL;

CREATE FUNCTION public.integrations_opening_stock_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF OLD.opening_stock_taken_at IS NOT NULL THEN
    IF NEW.opening_stock_taken_at IS DISTINCT FROM OLD.opening_stock_taken_at OR NEW.opening_stock_document_id IS DISTINCT FROM OLD.opening_stock_document_id THEN
      RAISE EXCEPTION 'integrations: açılış stoku bir kez alınır; kayıt değiştirilemez' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.opening_stock_taken_at IS NOT NULL THEN
    IF NOT OLD.opening_stock_enabled OR NOT NEW.opening_stock_enabled THEN
      RAISE EXCEPTION 'integrations: açılış stoku ayarı kapalıyken alınamaz' USING ERRCODE = '55000';
    END IF;
    -- Belge bu tenant'ın STOCK_IN belgesi olmalı; İŞLENMİŞ (POSTED) olması commit anında ertelenmiş kısıt tetikleyicisiyle denetlenir
    -- (stok komutu durumu aynı transaction'da, kilit yazımından sonra POSTED yapar).
    IF NOT EXISTS (
      SELECT 1 FROM public.documents d
       WHERE d.tenant_id = NEW.tenant_id AND d.id = NEW.opening_stock_document_id AND d.kind = 'STOCK_IN' AND d.status IN ('APPROVED', 'POSTED')
    ) THEN
      RAISE EXCEPTION 'integrations: açılış stoku belgesi bu tenant''ın STOCK_IN belgesi olmalı' USING ERRCODE = '55000';
    END IF;
    NEW.opening_stock_taken_at := pg_catalog.now();
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.integrations_opening_stock_guard() FROM PUBLIC;
CREATE TRIGGER integrations_opening_stock_guard BEFORE UPDATE ON public.integrations
  FOR EACH ROW EXECUTE FUNCTION public.integrations_opening_stock_guard();

CREATE FUNCTION public.integrations_opening_stock_posted() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF NEW.opening_stock_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.documents d
     WHERE d.tenant_id = NEW.tenant_id AND d.id = NEW.opening_stock_document_id AND d.kind = 'STOCK_IN' AND d.status = 'POSTED'
  ) THEN
    RAISE EXCEPTION 'integrations: açılış stoku belgesi işlenmiş (POSTED) olmalı' USING ERRCODE = '55000';
  END IF;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION public.integrations_opening_stock_posted() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER integrations_opening_stock_posted AFTER UPDATE OF opening_stock_document_id ON public.integrations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.integrations_opening_stock_posted();

-- INSERT yolunda açılış alanları yazılamaz (yalnız varsayılan): INSERT yetkisi verilmez. UPDATE yalnız bu üç sütunda eklenir.
GRANT UPDATE (opening_stock_enabled, opening_stock_taken_at, opening_stock_document_id) ON public.integrations TO wms_app;
