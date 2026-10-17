-- 0048_last_workspace geri alma (G-08): up'ın eklediğini kaldırır. Kaybolan veri yalnız "son kullanılan alan" sıralamasıdır (yeniden oluşur).
REVOKE UPDATE (last_used_at) ON public.tenant_memberships FROM wms_app;
ALTER TABLE public.tenant_memberships DROP COLUMN last_used_at;

DO $verify$
BEGIN
  IF NOT pg_catalog.has_column_privilege('wms_app', 'public.tenant_memberships', 'status', 'UPDATE') THEN
    RAISE EXCEPTION '0048_last_workspace down: 0003 üyelik yazma yetkisi kayboldu';
  END IF;
END
$verify$;
