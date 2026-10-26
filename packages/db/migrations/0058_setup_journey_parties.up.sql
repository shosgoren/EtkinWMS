-- 0058_setup_journey_parties (T-1054, kullanıcı 26 Ekim): kurulum yolculuğuna "Cariler" adımı (depo ve raflardan sonra). G-08: yalnız GENİŞLETME —
-- atlanabilir adım listesine 'parties' eklenir, üst sınır 9 olur. Mevcut satırlar yeni kümenin alt kümesidir (doğrulama kesilmez).
ALTER TABLE public.setup_journeys DROP CONSTRAINT setup_journeys_skipped_chk;
ALTER TABLE public.setup_journeys ADD CONSTRAINT setup_journeys_skipped_chk CHECK (
  skipped <@ ARRAY['cards', 'shelves', 'parties', 'stock', 'labels', 'bom', 'order', 'people', 'task']::text[]
  AND pg_catalog.cardinality(skipped) <= 9
);
