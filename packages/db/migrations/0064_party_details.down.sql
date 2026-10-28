-- 0064_party_details geri alma (G-08): Kısa ad / İlçe dolu ya da teslimat kargo seçilmiş cari varsa veri kaybettirmez
-- (bayrak: wms_meta.allow_destructive_down). Bekçi sayımı RLS'ten bağımsız olmalı: sayımdan önce NO FORCE, sonra yeniden FORCE.
DO $guard$
DECLARE
  used boolean;
BEGIN
  ALTER TABLE public.parties NO FORCE ROW LEVEL SECURITY;
  SELECT EXISTS (SELECT 1 FROM public.parties WHERE short_name IS NOT NULL OR district IS NOT NULL OR delivery_mode <> 'OWN') INTO used;
  ALTER TABLE public.parties FORCE ROW LEVEL SECURITY;
  IF used AND COALESCE(pg_catalog.current_setting('wms_meta.allow_destructive_down', true), 'off') <> 'on' THEN
    RAISE EXCEPTION '0064_party_details down: cari kısa ad / ilçe / teslimat bilgisi kullanılıyor; veri kaybettiren geri alma bu ortamda kapalı';
  END IF;
END
$guard$;

ALTER TABLE public.parties DROP CONSTRAINT parties_short_name_chk, DROP CONSTRAINT parties_district_chk, DROP CONSTRAINT parties_delivery_mode_chk;
ALTER TABLE public.parties DROP COLUMN short_name, DROP COLUMN district, DROP COLUMN delivery_mode;

DO $verify$
BEGIN
  IF NOT pg_catalog.has_column_privilege('wms_app', 'public.parties', 'city', 'UPDATE') THEN
    RAISE EXCEPTION '0064_party_details down: önceki cari yetkisi kayboldu';
  END IF;
END
$verify$;
