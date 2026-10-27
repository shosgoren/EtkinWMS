DO $guard$
DECLARE used boolean;
BEGIN
  ALTER TABLE public.integration_oauth_attempts NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE public.integration_oauth_apps NO FORCE ROW LEVEL SECURITY;
  SELECT EXISTS(SELECT 1 FROM public.integration_oauth_attempts) OR EXISTS(SELECT 1 FROM public.integration_oauth_apps) INTO used;
  ALTER TABLE public.integration_oauth_attempts FORCE ROW LEVEL SECURITY;
  ALTER TABLE public.integration_oauth_apps FORCE ROW LEVEL SECURITY;
  IF used THEN RAISE EXCEPTION '0061 down: OAuth attempt history is in use'; END IF;
END
$guard$;
DROP TABLE public.integration_oauth_attempts;

DROP TABLE public.integration_oauth_apps;
