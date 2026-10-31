-- 0069_integration_card_states geri alma (T-1140, G-08): işaret ya da cari/depo yaşam döngüsü satırı varsa veri kaybettirmez (eşitleme
-- tabanı ve "sistem arşivledi" bilgisi kaybolursa geri yüklemede kart yanlışlıkla geri açılmaz / çakışma yanlış karar verir). Bayrak:
-- wms_meta.allow_destructive_down. Bekçi sayımı RLS'ten bağımsız olmalı: sayımdan önce NO FORCE, sonra yeniden FORCE.
DO $guard$
DECLARE
  used boolean;
BEGIN
  ALTER TABLE public.integration_card_states NO FORCE ROW LEVEL SECURITY;
  SELECT EXISTS (SELECT 1 FROM public.integration_card_states) INTO used;
  ALTER TABLE public.integration_card_states FORCE ROW LEVEL SECURITY;
  IF used AND COALESCE(pg_catalog.current_setting('wms_meta.allow_destructive_down', true), 'off') <> 'on' THEN
    RAISE EXCEPTION '0069_integration_card_states down: eşitleme işareti / kaynak yaşam döngüsü verisi var; veri kaybettiren geri alma bu ortamda kapalı';
  END IF;
END
$guard$;

DROP TABLE public.integration_card_states;
DROP FUNCTION public.integration_card_states_on_update();
