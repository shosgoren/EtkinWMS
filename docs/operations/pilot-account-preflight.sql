-- READ-ONLY operator preflight for EtkinWMS source 024a800bace33c2dc3df397d56fda7e449d1d9dc / schema 0027.
-- Operator MUST independently verify the target database and exact tenant slug before running.
-- Use an existing authorized operator connection with complete visibility and SELECT privileges.
-- Never change roles, session authorization, RLS, or production settings to make this script pass.
-- Run psql -X -v ON_ERROR_STOP=1 -v target_slug='<verified exact slug>' -f pilot-account-preflight.sql
-- Connection credentials must use the operator's existing secure mechanism, never command-line URLs/logs.
-- Output is tenant UUID/slug/status/demo flag, counts and booleans; no user rows, email, token or password output.
-- Failure means UNKNOWN/BLOCKED, never 'no owner/account'. Counts do not prove an owner can actually sign in.
\set ON_ERROR_STOP on
\set ECHO none
\set VERBOSITY terse
\if :{?target_slug}
\else
  \echo 'BLOCKED: verified target_slug is required.'
  \quit 3
\endif
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '2s';
DO $preflight$
DECLARE rel regclass;
BEGIN
  FOREACH rel IN ARRAY ARRAY[
    'public.tenants'::regclass,
    'public.users'::regclass,
    'public.tenant_memberships'::regclass,
    'public.membership_roles'::regclass,
    'wms_meta.schema_migrations'::regclass
  ] LOOP
    IF row_security_active(rel) THEN
      RAISE EXCEPTION 'BLOCKED: row security filters current operator visibility; absence cannot be determined';
    END IF;
    IF NOT has_table_privilege(rel, 'SELECT') THEN
      RAISE EXCEPTION 'BLOCKED: existing operator lacks required SELECT privilege';
    END IF;
  END LOOP;
END
$preflight$;
SELECT :'target_slug' ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$' AS valid_slug \gset
\if :valid_slug
\else
  \echo 'BLOCKED: invalid exact slug.'
  ROLLBACK;
  \quit 3
\endif
SELECT count(*) = 1 AS target_found FROM public.tenants WHERE slug = :'target_slug' \gset
\if :target_found
\else
  \echo 'BLOCKED: verified exact tenant not found; no account decision made.'
  ROLLBACK;
  \quit 3
\endif
SELECT max(version) AS migration_version,
       count(*) AS applied_migration_count,
       (count(*) = 27 AND min(version) = '0001' AND max(version) = '0027') AS expected_schema27
FROM wms_meta.schema_migrations;
SELECT t.id AS tenant_uuid, t.slug, t.status, t.is_demo,
       (SELECT count(*) FROM public.tenant_memberships m
        WHERE m.tenant_id=t.id AND m.status='ACTIVE' AND m.is_owner) AS active_owner_count,
       (SELECT count(*) FROM public.tenant_memberships m
        WHERE m.tenant_id=t.id AND m.status='ACTIVE' AND EXISTS (
          SELECT 1 FROM public.membership_roles r WHERE r.tenant_id=t.id
          AND r.membership_id=m.id AND r.role_key='TENANT_ADMIN')) AS active_admin_count,
       EXISTS (SELECT 1 FROM public.users u WHERE u.email='hosgorens@gmail.com') AS target_account_exists,
       EXISTS (SELECT 1 FROM public.tenant_memberships m JOIN public.users u ON u.id=m.user_id
        WHERE m.tenant_id=t.id AND u.email='hosgorens@gmail.com') AS target_membership_exists,
       EXISTS (SELECT 1 FROM public.tenant_memberships m JOIN public.users u ON u.id=m.user_id
        WHERE m.tenant_id=t.id AND m.status='ACTIVE' AND u.email='hosgorens@gmail.com') AS target_active_member,
       EXISTS (SELECT 1 FROM public.tenant_memberships m JOIN public.users u ON u.id=m.user_id
        WHERE m.tenant_id=t.id AND m.status='ACTIVE' AND m.is_owner AND u.email='hosgorens@gmail.com') AS target_active_owner,
       EXISTS (SELECT 1 FROM public.tenant_memberships m JOIN public.users u ON u.id=m.user_id
        JOIN public.membership_roles r ON r.tenant_id=m.tenant_id AND r.membership_id=m.id
        WHERE m.tenant_id=t.id AND m.status='ACTIVE' AND r.role_key='TENANT_ADMIN'
          AND u.email='hosgorens@gmail.com') AS target_active_admin
FROM public.tenants t WHERE t.slug=:'target_slug';
ROLLBACK;
