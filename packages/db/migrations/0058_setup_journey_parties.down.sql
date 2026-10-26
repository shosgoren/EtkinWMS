-- 0058 geri alma: 'parties' atlaması kaldırılır (adım artık yok), sonra eski CHECK geri konur.
UPDATE public.setup_journeys SET skipped = pg_catalog.array_remove(skipped, 'parties') WHERE 'parties' = ANY (skipped);
ALTER TABLE public.setup_journeys DROP CONSTRAINT setup_journeys_skipped_chk;
ALTER TABLE public.setup_journeys ADD CONSTRAINT setup_journeys_skipped_chk CHECK (
  skipped <@ ARRAY['cards', 'shelves', 'stock', 'labels', 'bom', 'order', 'people', 'task']::text[]
  AND pg_catalog.cardinality(skipped) <= 8
);
