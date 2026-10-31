-- 0070_group_card_grants (T-1142, kullanıcı kararı 31 Ekim: "tüm kullanıcı yetkileri toggle ile pratik ayarlanmalı"):
-- Kart bölümü × işlem anahtarları (T-1141: items|parties|warehouses|locations × create|edit|archive) özel yetki grubuna verilebilir.
--
-- * Yalnız `permission_groups_grants_chk` kapalı listesi ve üst sınırı genişler (6 → 18); domain `GRANTABLE` ile birebir aynı liste
--   (packages/domain/src/identity/permissions.ts). `settings.manage`, `users.manage`, `audit.view`, `takeout.request`, `stock.view`
--   hâlâ verilemez. Tablo, RLS, yetki (GRANT) ve tetikleyiciler değişmez; mevcut satırlar yeni listenin alt kümesidir (veri değişmez).
-- * Kısıt `NOT VALID` olmadan eklenir: mevcut satırlar eski listenin alt kümesi olduğundan doğrulama tek geçişte başarılı olur.
ALTER TABLE public.permission_groups
  DROP CONSTRAINT permission_groups_grants_chk,
  ADD CONSTRAINT permission_groups_grants_chk CHECK (
    grants <@ ARRAY[
      'stock.post', 'document.create', 'document.approve', 'count_diff.approve', 'reversal.create', 'data.import',
      'items.create', 'items.edit', 'items.archive',
      'parties.create', 'parties.edit', 'parties.archive',
      'warehouses.create', 'warehouses.edit', 'warehouses.archive',
      'locations.create', 'locations.edit', 'locations.archive'
    ]::text[]
    AND cardinality(grants) <= 18);
