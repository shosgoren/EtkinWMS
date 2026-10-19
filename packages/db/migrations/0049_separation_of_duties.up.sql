-- 0049_separation_of_duties (T-416, A-03): görev ayrılığı firma ayarı. G-08: yalnızca GENİŞLETME (bir sütun, bir sütun yetkisi).
--
-- BİLİNÇLİ KARARLAR (inceleme için):
-- * Varsayılan KAPALI (A-03): mevcut firmaların iş akışı değişmez; yönetici ayarlardan açar.
-- * Açıkken (domain kuralı; komutlar kilit altında denetler): belgeyi oluşturan onaylayamaz; sayım satırı sayan fark onaylayamaz; belgeyi
--   oluşturan ya da işleyen ters kayıt yapamaz. Saha akışlarının kendi oluşturduğu belgeyi aynı komutta onaylaması (toplama, mal kabul,
--   paket kabulü) bu kurala girmez: o onay kullanıcı kararı değil, akışın parçasıdır.
-- * Yazan: yalnız `wms_app`, yalnız bu sütun; komut `settings.manage` + yeniden giriş ister ve `tenant.settings_changed` kaydı yazar.
-- Koşturucu tek transaction içinde çalıştırır.

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tenant_memberships' AND column_name = 'last_used_at') THEN
    RAISE EXCEPTION '0049_separation_of_duties: 0048 önkoşulu yok';
  END IF;
END
$pre$;

ALTER TABLE public.tenant_settings ADD COLUMN separation_of_duties boolean NOT NULL DEFAULT false;
GRANT UPDATE (separation_of_duties) ON public.tenant_settings TO wms_app;

DO $verify$
DECLARE
  r text;
BEGIN
  IF NOT pg_catalog.has_column_privilege('wms_app', 'public.tenant_settings', 'separation_of_duties', 'UPDATE') THEN
    RAISE EXCEPTION '0049_separation_of_duties: wms_app ayarı yazamıyor';
  END IF;
  FOREACH r IN ARRAY ARRAY['wms_auth', 'wms_worker'] LOOP
    IF pg_catalog.to_regrole(r) IS NOT NULL
       AND pg_catalog.has_column_privilege(r, 'public.tenant_settings', 'separation_of_duties', 'UPDATE') THEN
      RAISE EXCEPTION '0049_separation_of_duties: % rolü ayarı yazabiliyor', r;
    END IF;
  END LOOP;
END
$verify$;
