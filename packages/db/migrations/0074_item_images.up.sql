-- 0074_item_images (T-1160, kullanıcı isteği 1 Kasım 2026 "görsel eklenemiyor; min/max girilemiyor; dönüşüm kaldırılamıyor"):
-- (1) ürün görselleri tablosu, (2) kullanılmamış birim dönüşümünün silinebilmesi. G-08: GENİŞLETME — yeni tablo + 0040 silme bekçisi
-- işlevinin yeni sürümü (CREATE OR REPLACE; 0040 dosyası değişmez). Min/maks stok için şema değişikliği YOK (0017 `item_stock_policies`
-- sütun düzeyi INSERT/UPDATE zaten var).
--
-- BİLİNÇLİ KARARLAR (inceleme için):
-- * DEPOLAMA: canlıda nesne deposu (S3/MinIO) yapılandırılmamıştır (deploy/vps compose'unda depo servisi ve STORAGE_* yok; A-52).
--   Yeni sır istememek için görsel VERİTABANINDA tutulur: sunucuda yeniden kodlanmış (EXIF/konum silinmiş) WebP, uzun kenar ≤ 1280 px,
--   satır başına ≤ 1 MiB + liste küçük resmi ≤ 16 KiB; ürün başına en çok 5 etkin görsel. Bedeli: veritabanı ve yedek boyutu büyür
--   (5 × ~0,3 MiB × ürün). Nesne deposu açılınca taşınabilir (BACKLOG).
-- * İÇERİK: yalnız `image/webp` saklanır (giriş JPEG/PNG/WebP, sunucuda yeniden kodlanır); bayt imzası DB'de de denetlenir (RIFF….WEBP).
--   SVG ve diğer türler giremez.
-- * SİLME YOK: `wms_app` DELETE alamaz. "Sil" yumuşak silmedir (`removed_at`; Geri al aynı satırı geri açar). Silinmiş satırın baytları
--   10 dakika sonra boşaltılır (`data`/`thumb` NULL; satır meta veriyle iz olarak kalır, geri açılamaz). Boşaltmayı worker zamanlayıcısı
--   (15 dakikada bir, etkin her tenant, `withSystemTenant` + aynı RLS) ve aynı tenant'ın sonraki görsel komutu yapar; bekçi tetikleyicisi
--   süreyi, tek yönlü geçişi ve silinme anının uydurulamamasını (işlem anı; sonradan değişmez) zorlar.
-- * KAPAK: ürün başına en çok bir etkin kapak (kısmi UNIQUE); aynı baytlar (sha256) aynı üründe iki kez etkin olamaz (idempotent yükleme).
-- * Sayı sınırı (5) domain'de ürün satırı kilidiyle; tetikleyici yedek denetimdir (ENABLE ALWAYS).
-- * RLS ENABLE + FORCE, tek tenant politikası; `wms_app` SELECT + sütun düzeyi INSERT/UPDATE; `wms_auth` / `wms_worker` yetkisiz.
-- * DÖNÜŞÜM SİLME: 0040 bekçisi wms_app için örnek olmayan dönüşüm silmesini SESSİZCE atlıyordu (her zaman). Yeni sürüm: örnek ürünün
--   dönüşümü yine silinir; örnek olmayan dönüşüm YALNIZ hiçbir belge satırı, mal kabul satırı ya da birimli barkod o ürün + birimi
--   kullanmıyorsa silinir, kullanılıyorsa yine sessizce atlanır (domain etkilenen satır sayısını denetler → IN_USE). İşlenmiş belge
--   satırı katsayının kopyasını taşır (I-09); geçmiş değişmez. Yarış: domain ürün satırını FOR UPDATE kilitler (belge satırı ekleyen açık
--   işlemlerin ürün FK KEY SHARE kilidiyle çakışır; onlar bitince sayılır — 0065 deseni).
-- Koşturucu tek transaction içinde çalıştırır.

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.integration_card_states') IS NULL OR pg_catalog.to_regprocedure('public.unit_conversions_sample_delete_guard()') IS NULL THEN
    RAISE EXCEPTION '0074_item_images: 0069 / 0040 önkoşulu yok';
  END IF;
END
$pre$;

CREATE TABLE public.item_images (
  tenant_id     uuid        NOT NULL,
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  item_id       uuid        NOT NULL,
  content_type  text        NOT NULL DEFAULT 'image/webp',
  data          bytea,
  thumb         bytea,
  width         integer     NOT NULL,
  height        integer     NOT NULL,
  sha256        text        NOT NULL,
  is_main       boolean     NOT NULL DEFAULT false,
  removed_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT item_images_pkey PRIMARY KEY (id),
  CONSTRAINT item_images_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT item_images_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants (id),
  CONSTRAINT item_images_item_fkey FOREIGN KEY (tenant_id, item_id) REFERENCES public.items (tenant_id, id),
  CONSTRAINT item_images_content_type_chk CHECK (content_type = 'image/webp'),
  CONSTRAINT item_images_size_chk CHECK (width BETWEEN 1 AND 4096 AND height BETWEEN 1 AND 4096),
  CONSTRAINT item_images_sha_chk CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  -- Baytlar birlikte var ya da birlikte boşaltılmış; boşaltılmış satır silinmiş olmalı; kapak etkin olmalı.
  CONSTRAINT item_images_bytes_chk CHECK ((data IS NULL) = (thumb IS NULL) AND (data IS NOT NULL OR removed_at IS NOT NULL)),
  CONSTRAINT item_images_main_chk CHECK (NOT is_main OR removed_at IS NULL),
  CONSTRAINT item_images_data_chk CHECK (
    data IS NULL OR (octet_length(data) BETWEEN 12 AND 1048576
                     AND substring(data FROM 1 FOR 4) = '\x52494646'::bytea AND substring(data FROM 9 FOR 4) = '\x57454250'::bytea)),
  CONSTRAINT item_images_thumb_chk CHECK (
    thumb IS NULL OR (octet_length(thumb) BETWEEN 12 AND 16384
                      AND substring(thumb FROM 1 FOR 4) = '\x52494646'::bytea AND substring(thumb FROM 9 FOR 4) = '\x57454250'::bytea))
);
CREATE INDEX item_images_tenant_item_idx ON public.item_images (tenant_id, item_id, created_at);
CREATE UNIQUE INDEX item_images_one_main_key ON public.item_images (tenant_id, item_id) WHERE is_main;
CREATE UNIQUE INDEX item_images_active_sha_key ON public.item_images (tenant_id, item_id, sha256) WHERE removed_at IS NULL;
CREATE INDEX item_images_purge_idx ON public.item_images (tenant_id, removed_at) WHERE removed_at IS NOT NULL AND data IS NOT NULL;

-- Bekçi: kimlik/içerik alanları değişmez; baytlar yalnız silinmiş + 10 dakikası dolmuş satırda ve yalnız NULL'a; boşaltılmış satır geri
-- açılamaz; etkin görsel sayısı ≤ 5.
CREATE FUNCTION public.item_images_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  active integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.item_id IS DISTINCT FROM OLD.item_id
       OR NEW.content_type IS DISTINCT FROM OLD.content_type OR NEW.width IS DISTINCT FROM OLD.width OR NEW.height IS DISTINCT FROM OLD.height
       OR NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'ITEM_IMAGE_IMMUTABLE: görselin kimlik ve içerik alanları değiştirilemez' USING ERRCODE = '23514';
    END IF;
    -- Silinme anı uydurulamaz: NULL → dolu geçişte işlem anı (now()); bir silinme anı başka bir ana çevrilemez (geri açma = NULL).
    IF OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL AND NEW.removed_at <> pg_catalog.now() THEN
      RAISE EXCEPTION 'ITEM_IMAGE_IMMUTABLE: silinme anı işlem anı olmalı' USING ERRCODE = '23514';
    END IF;
    IF OLD.removed_at IS NOT NULL AND NEW.removed_at IS NOT NULL AND NEW.removed_at <> OLD.removed_at THEN
      RAISE EXCEPTION 'ITEM_IMAGE_IMMUTABLE: silinme anı değiştirilemez' USING ERRCODE = '23514';
    END IF;
    IF NEW.data IS DISTINCT FROM OLD.data OR NEW.thumb IS DISTINCT FROM OLD.thumb THEN
      IF NEW.data IS NOT NULL OR NEW.thumb IS NOT NULL OR OLD.removed_at IS NULL OR NEW.removed_at IS NULL
         OR OLD.removed_at > pg_catalog.now() - interval '10 minutes' THEN
        RAISE EXCEPTION 'ITEM_IMAGE_IMMUTABLE: görsel baytları yalnız silindikten 10 dakika sonra boşaltılır' USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSIF NEW.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'ITEM_IMAGE_IMMUTABLE: görsel silinmiş olarak eklenemez' USING ERRCODE = '23514';
  END IF;
  IF NEW.removed_at IS NULL AND (TG_OP = 'INSERT' OR OLD.removed_at IS NOT NULL) THEN
    SELECT count(*) INTO active FROM public.item_images x
     WHERE x.tenant_id = NEW.tenant_id AND x.item_id = NEW.item_id AND x.removed_at IS NULL AND x.id <> NEW.id;
    IF active >= 5 THEN
      RAISE EXCEPTION 'ITEM_IMAGE_LIMIT: ürün başına en çok 5 görsel' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.item_images_guard() FROM PUBLIC;
CREATE TRIGGER item_images_guard BEFORE INSERT OR UPDATE ON public.item_images
  FOR EACH ROW EXECUTE FUNCTION public.item_images_guard();
ALTER TABLE public.item_images ENABLE ALWAYS TRIGGER item_images_guard;

ALTER TABLE public.item_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_images FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.item_images FROM PUBLIC;
CREATE POLICY item_images_isolation ON public.item_images
  USING      (tenant_id = NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT ON public.item_images TO wms_app;
GRANT INSERT (tenant_id, id, item_id, data, thumb, width, height, sha256, is_main) ON public.item_images TO wms_app;
GRANT UPDATE (is_main, removed_at, data, thumb) ON public.item_images TO wms_app;

-- Dönüşüm silme bekçisi (0040 işlevinin yeni sürümü; imza ve tetikleyici aynı).
CREATE OR REPLACE FUNCTION public.unit_conversions_sample_delete_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN
  IF current_user <> 'wms_app'
     OR EXISTS (SELECT 1 FROM public.items i WHERE i.tenant_id = OLD.tenant_id AND i.id = OLD.item_id AND i.is_sample) THEN
    RETURN OLD;
  END IF;
  IF EXISTS (SELECT 1 FROM public.document_lines x WHERE x.tenant_id = OLD.tenant_id AND x.item_id = OLD.item_id AND x.unit_id = OLD.unit_id)
     OR EXISTS (SELECT 1 FROM public.inbound_receipt_lines x WHERE x.tenant_id = OLD.tenant_id AND x.item_id = OLD.item_id AND x.unit_id = OLD.unit_id)
     OR EXISTS (SELECT 1 FROM public.item_barcodes x WHERE x.tenant_id = OLD.tenant_id AND x.item_id = OLD.item_id AND x.unit_id = OLD.unit_id) THEN
    RETURN NULL;
  END IF;
  RETURN OLD;
END; $fn$;
REVOKE ALL ON FUNCTION public.unit_conversions_sample_delete_guard() FROM PUBLIC;

DO $verify$
DECLARE
  r text;
BEGIN
  IF NOT pg_catalog.has_table_privilege('wms_app', 'public.item_images', 'SELECT') THEN
    RAISE EXCEPTION '0074_item_images: wms_app okuyamıyor';
  END IF;
  IF pg_catalog.has_table_privilege('wms_app', 'public.item_images', 'DELETE') OR pg_catalog.has_table_privilege('wms_app', 'public.item_images', 'TRUNCATE') THEN
    RAISE EXCEPTION '0074_item_images: wms_app silebiliyor';
  END IF;
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.item_images'::regclass) THEN
    RAISE EXCEPTION '0074_item_images: RLS zorlanmıyor';
  END IF;
  IF (SELECT tgenabled FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.unit_conversions'::regclass AND tgname = 'unit_conversions_sample_delete_guard') <> 'A' THEN
    RAISE EXCEPTION '0074_item_images: dönüşüm silme bekçisi her zaman etkin değil';
  END IF;
  FOREACH r IN ARRAY ARRAY['wms_auth', 'wms_worker'] LOOP
    IF pg_catalog.to_regrole(r) IS NOT NULL
       AND (pg_catalog.has_table_privilege(r, 'public.item_images', 'SELECT') OR pg_catalog.has_table_privilege(r, 'public.item_images', 'INSERT')
            OR pg_catalog.has_table_privilege(r, 'public.item_images', 'UPDATE') OR pg_catalog.has_table_privilege(r, 'public.item_images', 'DELETE')) THEN
      RAISE EXCEPTION '0074_item_images: % rolü erişebiliyor', r;
    END IF;
  END LOOP;
END
$verify$;
