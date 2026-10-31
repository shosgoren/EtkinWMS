-- 0069_integration_card_states (T-1140, kullanıcı kararı 31 Ekim 2026): bağlı kart başına (ürün / cari / depo) iki yönlü eşitleme işareti
-- ve cari / depo için kaynak yaşam döngüsü durumu. G-08: yalnız GENİŞLETME — yeni tablo; mevcut tablolara ve satırlara dokunulmaz.
--
-- BİLİNÇLİ KARARLAR (inceleme için):
-- * Eşitleme işareti (`local_hash`, `remote_hash`, `local_sig`, `synced_at`, `remote_updated_at`, `last_pulled_at`, `last_pushed_at`): son
--   başarılı eşitlemede iki tarafın kanonik alan özeti (sha256 onaltılık) ve yerel sütun imzası (md5 onaltılık; yalnız aday seçimi için,
--   güvenlik özelliği taşımaz). "Son eşitlemeden beri değişti mi" bu özetlerle bulunur; çakışmada yeni değişen taraf kazanır (domain
--   `card-sync.ts`). Dış kimlik bu tabloda tutulmaz (eşleme `external_refs`'tedir).
-- * Cari / depo yaşam döngüsü sütunları ürünün 0062 sütunlarının aynısıdır (`items.source_*`), ama ayrı tabloda: `parties_touch`
--   tetikleyicisi her UPDATE'te `version`ı artırır; tarama başına `source_checked_at` yazmak ekrandaki iyimser sürüm denetimini her 30 sn
--   bozardı. Ürün (ITEM) satırında yaşam döngüsü sütunları kullanılmaz (CHECK: varsayılanda kalır). `REMOVED` yok: cari/depo Paraşüt'te
--   silinse de arşive alınır, fiziksel silme yoktur.
-- * Kart satırıyla FK yok (çok biçimli; `external_refs` ile aynı). Satır yalnız bağlı kart için yazılır; kiracı FK'si ve RLS vardır.
-- * `wms_app` yalnız SELECT + sütun düzeyi INSERT/UPDATE; DELETE yok. ENABLE + FORCE RLS (0055 metni). `wms_auth` / `wms_worker` yazamaz.
-- Koşturucu tek transaction içinde çalıştırır.

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.integration_webhooks') IS NULL THEN
    RAISE EXCEPTION '0069_integration_card_states: 0067 önkoşulu yok';
  END IF;
END
$pre$;

CREATE TABLE public.integration_card_states (
  tenant_id              uuid        NOT NULL,
  system                 text        NOT NULL,
  entity_type            text        NOT NULL,
  entity_id              uuid        NOT NULL,
  local_hash             text,
  remote_hash            text,
  local_sig              text,
  synced_at              timestamptz,
  remote_updated_at      timestamptz,
  last_pulled_at         timestamptz,
  last_pushed_at         timestamptz,
  source_state           text        NOT NULL DEFAULT 'ACTIVE',
  source_disposition     text        NOT NULL DEFAULT 'NONE',
  source_managed_archive boolean     NOT NULL DEFAULT false,
  source_changed_at      timestamptz,
  source_checked_at      timestamptz,
  source_missing_since   timestamptz,
  source_missing_context text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_card_states_pkey PRIMARY KEY (tenant_id, system, entity_type, entity_id),
  CONSTRAINT integration_card_states_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants (id),
  CONSTRAINT integration_card_states_system_chk CHECK (system ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  CONSTRAINT integration_card_states_entity_type_chk CHECK (entity_type IN ('ITEM', 'PARTY', 'WAREHOUSE')),
  CONSTRAINT integration_card_states_hash_chk CHECK (
    (local_hash IS NULL OR local_hash ~ '^[0-9a-f]{64}$')
    AND (remote_hash IS NULL OR remote_hash ~ '^[0-9a-f]{64}$')
    AND (local_sig IS NULL OR local_sig ~ '^[0-9a-f]{32}$')
    AND ((local_hash IS NULL) = (synced_at IS NULL))),
  CONSTRAINT integration_card_states_lifecycle_chk CHECK (
    (source_missing_context IS NULL OR source_missing_context ~ '^[0-9a-f]{64}$')
    AND ((source_missing_since IS NULL) = (source_missing_context IS NULL))
    AND source_state IN ('ACTIVE', 'ARCHIVED', 'DELETED')
    AND source_disposition IN ('NONE', 'PENDING', 'ARCHIVED')
    AND (source_state <> 'ACTIVE' OR (source_disposition = 'NONE' AND NOT source_managed_archive))
    AND (source_disposition <> 'PENDING' OR source_changed_at IS NOT NULL)
    AND (NOT source_managed_archive OR (source_disposition = 'ARCHIVED' AND source_state <> 'ACTIVE'))
    -- Ürün yaşam döngüsü items sütunlarındadır (0062): ITEM satırında bu sütunlar varsayılanda kalır.
    AND (entity_type <> 'ITEM' OR (source_state = 'ACTIVE' AND source_missing_since IS NULL AND source_checked_at IS NULL)))
);
CREATE INDEX integration_card_states_check_idx ON public.integration_card_states (tenant_id, system, entity_type, source_checked_at);

CREATE FUNCTION public.integration_card_states_on_update() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.system IS DISTINCT FROM OLD.system OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
     OR NEW.entity_id IS DISTINCT FROM OLD.entity_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'integration_card_states: kimlik alanları değiştirilemez' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.integration_card_states_on_update() FROM PUBLIC;
CREATE TRIGGER integration_card_states_on_update BEFORE UPDATE ON public.integration_card_states
  FOR EACH ROW EXECUTE FUNCTION public.integration_card_states_on_update();

ALTER TABLE public.integration_card_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_card_states FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.integration_card_states FROM PUBLIC;
CREATE POLICY integration_card_states_isolation ON public.integration_card_states
  USING      (tenant_id = NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT ON public.integration_card_states TO wms_app;
GRANT INSERT (tenant_id, system, entity_type, entity_id, local_hash, remote_hash, local_sig, synced_at, remote_updated_at, last_pulled_at, last_pushed_at,
              source_state, source_disposition, source_managed_archive, source_changed_at, source_checked_at, source_missing_since, source_missing_context)
  ON public.integration_card_states TO wms_app;
GRANT UPDATE (local_hash, remote_hash, local_sig, synced_at, remote_updated_at, last_pulled_at, last_pushed_at,
              source_state, source_disposition, source_managed_archive, source_changed_at, source_checked_at, source_missing_since, source_missing_context)
  ON public.integration_card_states TO wms_app;

DO $verify$
DECLARE
  r text;
BEGIN
  IF NOT pg_catalog.has_table_privilege('wms_app', 'public.integration_card_states', 'SELECT') THEN
    RAISE EXCEPTION '0069_integration_card_states: wms_app okuyamıyor';
  END IF;
  IF pg_catalog.has_table_privilege('wms_app', 'public.integration_card_states', 'DELETE') THEN
    RAISE EXCEPTION '0069_integration_card_states: wms_app silebiliyor';
  END IF;
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.integration_card_states'::regclass) THEN
    RAISE EXCEPTION '0069_integration_card_states: RLS zorlanmıyor';
  END IF;
  FOREACH r IN ARRAY ARRAY['wms_auth', 'wms_worker'] LOOP
    IF pg_catalog.to_regrole(r) IS NOT NULL
       AND (pg_catalog.has_table_privilege(r, 'public.integration_card_states', 'INSERT') OR pg_catalog.has_table_privilege(r, 'public.integration_card_states', 'UPDATE')
            OR pg_catalog.has_table_privilege(r, 'public.integration_card_states', 'DELETE')) THEN
      RAISE EXCEPTION '0069_integration_card_states: % rolü yazabiliyor', r;
    END IF;
  END LOOP;
END
$verify$;
