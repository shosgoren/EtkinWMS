-- T-1066: tenant-owned confidential OAuth application; never readable from UI.
CREATE TABLE public.integration_oauth_apps (
 tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),
 version uuid NOT NULL DEFAULT gen_random_uuid(),
 credentials jsonb NOT NULL CHECK (jsonb_typeof(credentials)='object' AND credentials ?& ARRAY['v','kid','iv','tag','ct'] AND (credentials - ARRAY['v','kid','iv','tag','ct'])='{}'::jsonb AND credentials->>'v'='2'),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.integration_oauth_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_oauth_apps FORCE ROW LEVEL SECURITY;
CREATE POLICY integration_oauth_apps_isolation ON public.integration_oauth_apps
 USING (tenant_id=NULLIF(pg_catalog.current_setting('app.current_tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id=NULLIF(pg_catalog.current_setting('app.current_tenant_id',true),'')::uuid);
REVOKE ALL ON public.integration_oauth_apps FROM PUBLIC;
GRANT SELECT, INSERT ON public.integration_oauth_apps TO wms_app;
GRANT UPDATE(version,credentials,updated_at) ON public.integration_oauth_apps TO wms_app;
-- T-1066: short-lived, single-use OAuth attempts; no provider password or plaintext token.
CREATE TABLE public.integration_oauth_attempts (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id),
  membership_id uuid NOT NULL,
  state_hash text NOT NULL UNIQUE CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  nonce_hash text NOT NULL CHECK (nonce_hash ~ '^[0-9a-f]{64}$'),
  config_version uuid NOT NULL,
  client_id text NOT NULL CHECK (char_length(client_id) BETWEEN 1 AND 200),
  phase text NOT NULL DEFAULT 'PENDING' CHECK (phase IN ('PENDING','EXCHANGING','SELECT','CONNECTING','COMPLETE','FAILED')),
  token_box jsonb,
  companies jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(companies) = 'array' AND jsonb_array_length(companies) <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
  CONSTRAINT integration_oauth_tenant_id_id_key UNIQUE(tenant_id,id),
  FOREIGN KEY (tenant_id,membership_id) REFERENCES public.tenant_memberships(tenant_id,id),
  FOREIGN KEY (tenant_id,user_id) REFERENCES public.tenant_memberships(tenant_id,user_id),
  CHECK (expires_at > created_at AND expires_at <= created_at+interval '10 minutes'),
  CHECK ((phase = 'SELECT') = (token_box IS NOT NULL)),
  CHECK (token_box IS NULL OR (
    jsonb_typeof(token_box) = 'object' AND token_box ?& ARRAY['v','kid','iv','tag','ct'] AND (token_box - ARRAY['v','kid','iv','tag','ct']) = '{}'::jsonb
    AND token_box->>'v' = '2' AND jsonb_typeof(token_box->'kid')='string'
    AND jsonb_typeof(token_box->'iv')='string' AND jsonb_typeof(token_box->'tag')='string' AND jsonb_typeof(token_box->'ct')='string'
  ))
);
CREATE UNIQUE INDEX integration_oauth_active_user_idx ON public.integration_oauth_attempts(tenant_id,user_id) WHERE phase NOT IN ('COMPLETE','FAILED');
CREATE INDEX integration_oauth_user_expiry_idx ON public.integration_oauth_attempts(tenant_id,user_id,expires_at);
ALTER TABLE public.integration_oauth_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_oauth_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY integration_oauth_isolation ON public.integration_oauth_attempts
  USING (tenant_id=NULLIF(pg_catalog.current_setting('app.current_tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(pg_catalog.current_setting('app.current_tenant_id',true),'')::uuid);
REVOKE ALL ON public.integration_oauth_attempts FROM PUBLIC;
GRANT SELECT ON public.integration_oauth_attempts TO wms_app;
GRANT INSERT(tenant_id,id,user_id,membership_id,state_hash,nonce_hash,client_id,config_version) ON public.integration_oauth_attempts TO wms_app;
GRANT UPDATE(phase,token_box,companies) ON public.integration_oauth_attempts TO wms_app;
