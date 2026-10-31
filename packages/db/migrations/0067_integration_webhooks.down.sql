-- 0067_integration_webhooks geri alma (T-1138): kayıtlı webhook varsa (Paraşüt tarafında yaşayan kayıt) sessizce silinmez; önce bağlantı
-- kesilir ya da wms_meta.allow_destructive_down=on. Veri yoksa temiz geri alma.
DO $guard$
DECLARE used boolean;
BEGIN
  ALTER TABLE public.integration_webhooks NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE public.integrations NO FORCE ROW LEVEL SECURITY;
  SELECT EXISTS (SELECT 1 FROM public.integration_webhooks WHERE status = 'ACTIVE')
      OR EXISTS (SELECT 1 FROM public.integrations WHERE webhook_status <> 'OFF') INTO used;
  ALTER TABLE public.integration_webhooks FORCE ROW LEVEL SECURITY;
  ALTER TABLE public.integrations FORCE ROW LEVEL SECURITY;
  IF used AND COALESCE(current_setting('wms_meta.allow_destructive_down', true), 'off') <> 'on' THEN
    RAISE EXCEPTION '0067 down: active Paraşüt webhooks exist; disconnect first';
  END IF;
END
$guard$;
SET ROLE wms_identity_probe;
DROP FUNCTION wms_probe.integration_webhook_lookup(text, text);
RESET ROLE;
REVOKE SELECT (tenant_id, id, provider, status, account_ref, webhook_status) ON public.integrations FROM wms_identity_probe;
DROP POLICY integrations_probe_select ON public.integrations;
DROP TABLE public.integration_webhooks;
DROP FUNCTION public.integration_webhooks_on_update();
REVOKE UPDATE (webhook_status, webhook_checked_at, webhook_last_event_at, webhook_last_error_code) ON public.integrations FROM wms_app;
ALTER TABLE public.integrations
  DROP CONSTRAINT integrations_webhook_status_chk,
  DROP CONSTRAINT integrations_webhook_error_chk,
  DROP COLUMN webhook_status,
  DROP COLUMN webhook_checked_at,
  DROP COLUMN webhook_last_event_at,
  DROP COLUMN webhook_last_error_code;
