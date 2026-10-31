-- 0070_group_card_grants geri alma (T-1142, G-08): 0051 kısıtı birebir geri gelir. Kart anahtarı taşıyan grup varsa geri alma bu
-- anahtarları gruptan siler (üye yetki kaybeder) — veri kaybettiren adım dolu veride `allow_destructive_down` olmadan REDDEDİLİR.
-- İzinli ortamda anahtarlar silinir; audit satırları append-only'dir (değişmez).
DO $guard$
DECLARE
  allow boolean := coalesce(pg_catalog.current_setting('wms_meta.allow_destructive_down', true), '') = 'on';
  n_groups integer;
BEGIN
  -- Tablo sahibi FORCE RLS altında: sayım ve düzeltme bütün tenant'larda olsun diye NO FORCE (sonda FORCE geri).
  ALTER TABLE public.permission_groups NO FORCE ROW LEVEL SECURITY;
  SELECT count(*) INTO n_groups FROM public.permission_groups
   WHERE NOT (grants <@ ARRAY['stock.post', 'document.create', 'document.approve', 'count_diff.approve', 'reversal.create', 'data.import']::text[]);
  IF n_groups > 0 AND NOT allow THEN
    RAISE EXCEPTION '0070_group_card_grants down: kart yetkisi taşıyan % grup var; veri kaybettiren geri alma bu ortamda kapalı', n_groups;
  END IF;
  UPDATE public.permission_groups
     SET grants = ARRAY(SELECT g FROM unnest(grants) AS g
                         WHERE g = ANY (ARRAY['stock.post', 'document.create', 'document.approve', 'count_diff.approve', 'reversal.create', 'data.import']::text[]))
   WHERE NOT (grants <@ ARRAY['stock.post', 'document.create', 'document.approve', 'count_diff.approve', 'reversal.create', 'data.import']::text[]);
  ALTER TABLE public.permission_groups FORCE ROW LEVEL SECURITY;
END
$guard$;

ALTER TABLE public.permission_groups
  DROP CONSTRAINT permission_groups_grants_chk,
  ADD CONSTRAINT permission_groups_grants_chk CHECK (
    grants <@ ARRAY['stock.post', 'document.create', 'document.approve', 'count_diff.approve', 'reversal.create', 'data.import']::text[]
    AND cardinality(grants) <= 6);
