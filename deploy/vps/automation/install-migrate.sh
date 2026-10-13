#!/bin/bash
# T-916 one-time VPS setup (root). Run from this directory of an extracted exact-main source tree.
# 1) Installs the updated release receiver (schema change -> backup -> signed migrator -> approve).
# 2) Gives the migration owner role (owner of wms_meta.schema_migrations) a fresh random password and stores
#    the DSN only in root-only /opt/etkinwms/automation/migrate.env. Nothing secret is printed.
# 3) Returns objects that the 13 Oct manual cutover created as `postgres` to the migration owner, so later
#    migrations run by that role can ALTER them.
# Idempotent: an existing migrate.env is verified and kept.
set -euo pipefail
umask 077
test "$(id -u)" = 0
cd "$(dirname "$0")"
A=/opt/etkinwms/automation
test -f "$A/state.json"
test -f "$A/approved-schema.sha256"
python3 -I -m py_compile release.py
python3 -m unittest -q test_release >/dev/null 2>&1 || { echo "HATA: receiver testleri gecmedi"; exit 1; }

Q() { docker exec --user postgres etkinwms-postgres psql -X -qAt -v ON_ERROR_STOP=1 -d etkinwms "$@" </dev/null; }
OWNER=$(Q -c "SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'wms_meta.schema_migrations'::regclass")
[[ "$OWNER" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || { echo "HATA: migration sahibi rol okunamadi"; exit 1; }
case "$OWNER" in wms_app|wms_auth|wms_worker|wms_ops|wms_identity_probe) echo "HATA: sahip uygulama rolu ($OWNER)"; exit 1;; esac
echo "migration rolu: $OWNER"

if [ "$OWNER" != postgres ]; then
  # Only objects in application schemas that postgres owns (created by the manual cutover).
  docker exec -i --user postgres etkinwms-postgres psql -X -q -v ON_ERROR_STOP=1 -v owner="$OWNER" -d etkinwms <<'SQL'
SELECT format('ALTER %s %s OWNER TO %I',
              CASE c.relkind WHEN 'r' THEN 'TABLE' WHEN 'p' THEN 'TABLE' WHEN 'v' THEN 'VIEW'
                             WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'SEQUENCE' END,
              c.oid::regclass, :'owner')
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'wms_meta') AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
  AND pg_get_userbyid(c.relowner) = 'postgres'
  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('a', 'i') AND c.relkind = 'S')
UNION ALL
SELECT format('ALTER FUNCTION %s OWNER TO %I', p.oid::regprocedure, :'owner')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'wms_meta') AND pg_get_userbyid(p.proowner) = 'postgres'
\gexec
SQL
  LEFT=$(Q -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','wms_meta') AND pg_get_userbyid(c.relowner)='postgres'")
  echo "postgres sahipli kalan nesne: $LEFT"
fi

ENVF=$A/migrate.env
if [ ! -s "$ENVF" ] && [ "$OWNER" = postgres ]; then
  # Superuser owner: reuse the existing admin password instead of rotating it.
  python3 -I - "$ENVF.new" <<'PY'
import sys, urllib.parse
env = dict(l.strip().split('=', 1) for l in open('/opt/etkinwms/database/admin.env') if '=' in l and not l.startswith('#'))
pw = env['POSTGRES_PASSWORD'].strip().strip('"').strip("'")
open(sys.argv[1], 'w').write('DATABASE_URL_DIRECT=postgresql://postgres:%s@etkinwms-postgres:5432/etkinwms?sslmode=verify-full\n' % urllib.parse.quote(pw, safe=''))
PY
  chmod 600 "$ENVF.new"; mv "$ENVF.new" "$ENVF"
elif [ ! -s "$ENVF" ]; then
  PW=$(python3 -I -c 'import secrets; print(secrets.token_hex(32))')
  # Password only via stdin (not argv/env of a long-lived process); statement logging off for this session.
  printf "SET log_statement = 'none'; SET log_min_error_statement = panic; ALTER ROLE \"%s\" LOGIN PASSWORD '%s';\n" "$OWNER" "$PW" \
    | docker exec -i --user postgres etkinwms-postgres psql -X -q -v ON_ERROR_STOP=1 -d etkinwms >/dev/null
  printf 'DATABASE_URL_DIRECT=postgresql://%s:%s@etkinwms-postgres:5432/etkinwms?sslmode=verify-full\n' "$OWNER" "$PW" > "$ENVF.new"
  chmod 600 "$ENVF.new"; mv "$ENVF.new" "$ENVF"
  unset PW
fi

# Verify the stored credential over the real TLS path with libpq (values come from an env file, not argv).
PGF=$(mktemp); trap 'rm -f "$PGF"' EXIT
python3 -I - "$ENVF" "$PGF" <<'PY'
import sys, urllib.parse
url = open(sys.argv[1]).read().strip().split('=', 1)[1]
u = urllib.parse.urlsplit(url)
open(sys.argv[2], 'w').write('PGHOST=%s\nPGPORT=%s\nPGDATABASE=%s\nPGUSER=%s\nPGPASSWORD=%s\nPGSSLMODE=verify-full\nPGSSLROOTCERT=/run/ca.crt\n'
                             % (u.hostname, u.port, u.path.lstrip('/'), urllib.parse.unquote(u.username), urllib.parse.unquote(u.password)))
PY
PGIMG=$(docker inspect --format '{{.Config.Image}}' etkinwms-postgres)
WHO=$(docker run --rm --network etkinwms-motive_default --env-file "$PGF" -v /opt/etkinwms/database/tls/ca.crt:/run/ca.crt:ro \
  "$PGIMG" psql -X -qAt -c "SELECT current_user" </dev/null)
[ "$WHO" = "$OWNER" ] || { echo "HATA: migration rolu ile TLS girisi dogrulanamadi"; exit 1; }
echo "migration rolu TLS girisi: OK"

install -d -m 700 -o root -g root /opt/etkinwms/backups
cp /usr/local/sbin/etkinwms-release "/usr/local/sbin/etkinwms-release.bak-$(date +%s)"
install -m 755 -o root -g root release.py /usr/local/sbin/etkinwms-release
/usr/local/sbin/etkinwms-release check
echo "TAMAM"
