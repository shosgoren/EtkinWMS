-- 0048_last_workspace (T-999, ADR-026 §6): son kullanılan çalışma alanı. G-08: yalnızca GENİŞLETME (bir sütun, bir sütun yetkisi).
--
-- BİLİNÇLİ KARARLAR (inceleme için):
-- * KAYIT SUNUCUDA, ÜYELİK SATIRINDA: `tenant_memberships.last_used_at`. Kullanıcının en yeni zamanlı AKTİF üyeliği "son alan"dır; tarayıcı
--   çerezi/yerel depo kullanılmaz (paylaşılan cihazda başka kullanıcıya alan adı sızmaz, çıkışta temizlik gerekmez).
-- * YAZAN: yalnız `wms_app`, yalnız bu sütun (`GRANT UPDATE (last_used_at)`); tenant kabuğu üyelik + izin doğrulandıktan sonra AYNI
--   transaction içinde, tenant bağlamında (RLS `tenant_memberships_isolation`) ve `user_id = çağıran` koşuluyla günceller. Başka kiracının
--   satırı RLS ile görünmez; aynı kiracıdaki başka üyenin satırına yazmak uygulama kodunda yoktur ve yalnız bu sıralama bilgisini etkiler.
-- * OKUYAN: `getMembershipSummary` (`withUser`, `tenant_memberships_select_own`: yalnız kendi satırları). Sütun hiçbir yerde kimlik/yetki
--   kararına girmez; yalnız girişten sonraki yönlendirme ve seçicideki "SON" işareti.
-- * KİŞİSEL VERİ (KVKK): kullanıcının alan kullanım zamanıdır. Tenant bağlamındaki sorgular okuyabilir (tablo SELECT yetkisi); üye listesi,
--   denetim/dışa aktarım ve panel ekranlarına KONMAZ. Yalnız çağıranın kendi özetinde kullanılır.
-- * Rol/sistem gerekçesi tetikleyicisi (0003) bu UPDATE'te de çalışır; `app.system_reason` boş olduğundan geçer.
-- Koşturucu tek transaction içinde çalıştırır.

DO $pre$
BEGIN
  IF pg_catalog.to_regprocedure('wms_probe.platform_list_events(integer)') IS NULL THEN
    RAISE EXCEPTION '0048_last_workspace: platform_list_events yok (0047 önkoşulu)';
  END IF;
  -- `workspaces` ayrılmış ad oldu (seçici sayfası); bu adla alan varsa kısa adresi sessizce kaybolmasın (inceleme n3).
  IF EXISTS (SELECT 1 FROM public.tenants WHERE lower(slug) = 'workspaces') THEN
    RAISE EXCEPTION '0048_last_workspace: "workspaces" adlı çalışma alanı var; önce yeniden adlandırılmalı';
  END IF;
END
$pre$;

ALTER TABLE public.tenant_memberships ADD COLUMN last_used_at timestamptz;
GRANT UPDATE (last_used_at) ON public.tenant_memberships TO wms_app;

DO $verify$
DECLARE
  r text;
BEGIN
  IF NOT pg_catalog.has_column_privilege('wms_app', 'public.tenant_memberships', 'last_used_at', 'UPDATE') THEN
    RAISE EXCEPTION '0048_last_workspace: wms_app last_used_at yazamıyor';
  END IF;
  FOREACH r IN ARRAY ARRAY['wms_auth', 'wms_worker', 'wms_ops'] LOOP
    IF pg_catalog.to_regrole(r) IS NOT NULL
       AND pg_catalog.has_column_privilege(r, 'public.tenant_memberships', 'last_used_at', 'UPDATE') THEN
      RAISE EXCEPTION '0048_last_workspace: % rolü last_used_at yazabiliyor', r;
    END IF;
  END LOOP;
  -- Mevcut sütun yetkileri değişmedi (yalnız ek).
  IF pg_catalog.has_column_privilege('wms_app', 'public.tenant_memberships', 'user_id', 'UPDATE')
     OR pg_catalog.has_column_privilege('wms_app', 'public.tenant_memberships', 'tenant_id', 'UPDATE') THEN
    RAISE EXCEPTION '0048_last_workspace: wms_app üyelik kimlik sütunlarını yazabiliyor';
  END IF;
END
$verify$;
