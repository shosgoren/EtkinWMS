#!/bin/bash
# T-916 one-time VPS setup (root). Run from this directory of an extracted exact-main source tree.
# 1) Migration role: the owner of wms_meta.schema_migrations if it is clean; if it is postgres or privileged
#    (attributes or predefined server-access roles, directly or via membership) a new `wms_migrator` replaces it,
#    inherits its EXECUTE grants on probe routines, and the old owner loses its probe/ops memberships.
# 2) In one transaction, application objects owned by postgres (13 Oct manual cutover) or by the old owner move to
#    the migration role; nothing owned by postgres may remain in application schemas.
# 3) Fresh random password, sent only as a client-side SCRAM verifier; DSN only in root600 migrate.env.
# 4) TLS login verified before migrate.env is installed; receiver installed under the release lock.
#    Nothing secret is printed. Idempotent.
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
APP_SCHEMAS="n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg\_%'"
OWNER=$(Q -c "SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'wms_meta.schema_migrations'::regclass")
[[ "$OWNER" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || { echo "HATA: migration sahibi rol okunamadi"; exit 1; }
case "$OWNER" in wms_app|wms_auth|wms_worker|wms_ops|wms_identity_probe) echo "HATA: sahip uygulama rolu ($OWNER)"; exit 1;; esac
# PRIVILEGED_MEMBER is the single privilege rule (attributes or predefined server-access roles, incl. the role itself).
PRIVILEGED="(r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolname IN ('pg_execute_server_program','pg_read_server_files','pg_write_server_files','pg_read_all_data','pg_write_all_data','pg_signal_backend','pg_checkpoint'))"
PRIV=$(Q -c "SELECT EXISTS (SELECT 1 FROM pg_roles r WHERE pg_has_role('$OWNER', r.oid, 'MEMBER') AND $PRIVILEGED)")
# A clean owner stays the migration role; any privileged owner (or postgres) is replaced by a new wms_migrator.
if [ "$PRIV" = t ] || [ "$OWNER" = postgres ]; then TARGET=wms_migrator; else TARGET=$OWNER; fi
echo "mevcut migration sahibi: $OWNER -> hedef migration rolu: $TARGET"

docker exec -i --user postgres etkinwms-postgres psql -X -q -v ON_ERROR_STOP=1 -v target="$TARGET" -v owner="$OWNER" -d etkinwms >/dev/null <<SQL
BEGIN;
SELECT format('CREATE ROLE %I NOLOGIN', :'target') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'target')
\gexec
SELECT format('ALTER ROLE %I NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION INHERIT', :'target')
\gexec
SELECT format('GRANT CREATE, CONNECT, TEMPORARY ON DATABASE %I TO %I', current_database(), :'target')
\gexec
-- Probe-owned functions are replaced via SET ROLE (operator membership: SET only, no INHERIT/ADMIN).
SELECT format('GRANT wms_identity_probe TO %I WITH INHERIT FALSE, SET TRUE, ADMIN FALSE', :'target')
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wms_identity_probe') AND :'target' <> 'postgres'
  AND NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.roleid = 'wms_identity_probe'::regrole
                  AND m.member = (SELECT oid FROM pg_roles WHERE rolname = :'target'))
\gexec
-- Sources: postgres (manual cutover) and, when the target is new, the previous (privileged) owner.
CREATE TEMP TABLE src AS SELECT oid FROM pg_roles WHERE rolname IN ('postgres', :'owner') AND rolname <> :'target';
CREATE TEMP TABLE ext AS SELECT objid FROM pg_depend WHERE deptype = 'e';
SELECT format('ALTER SCHEMA %I OWNER TO %I', n.nspname, :'target')
FROM pg_namespace n WHERE $APP_SCHEMAS AND n.nspname <> 'public' AND n.nspowner IN (SELECT oid FROM src)
  AND n.oid NOT IN (SELECT objid FROM ext)
UNION ALL
SELECT format('ALTER %s %s OWNER TO %I',
              CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'S' THEN 'SEQUENCE'
                             WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END, c.oid::regclass, :'target')
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE $APP_SCHEMAS AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f') AND c.relowner IN (SELECT oid FROM src)
  AND c.oid NOT IN (SELECT objid FROM ext)
  AND NOT (c.relkind = 'S' AND EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('a', 'i')))
UNION ALL
SELECT format('ALTER ROUTINE %s OWNER TO %I', p.oid::regprocedure, :'target')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE $APP_SCHEMAS AND p.prokind IN ('f', 'p') AND p.proowner IN (SELECT oid FROM src) AND p.oid NOT IN (SELECT objid FROM ext)
UNION ALL
SELECT format('ALTER TYPE %s OWNER TO %I', t.oid::regtype, :'target')
FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE $APP_SCHEMAS AND t.typtype IN ('e', 'd', 'r', 'c') AND t.typowner IN (SELECT oid FROM src)
  AND t.oid NOT IN (SELECT objid FROM ext)
  AND (t.typrelid = 0 OR (SELECT relkind FROM pg_class WHERE oid = t.typrelid) = 'c')
\gexec
-- Replaced (non-postgres) owner: its EXECUTE grants on probe-owned routines move to the target, and its
-- probe/ops memberships are revoked so only the migration role holds them (0003/0009 invariant).
SELECT format('GRANT EXECUTE ON ROUTINE %s TO %I', p.oid::regprocedure, :'target')
FROM pg_proc p, aclexplode(p.proacl) a
WHERE :'owner' NOT IN (:'target', 'postgres') AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = :'owner')
  AND a.privilege_type = 'EXECUTE' AND p.proowner <> (SELECT oid FROM pg_roles WHERE rolname = :'target')
\gexec
SELECT format('REVOKE %I FROM %I', r.rolname, :'owner')
FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
WHERE :'owner' NOT IN (:'target', 'postgres') AND r.rolname IN ('wms_identity_probe', 'wms_ops')
  AND m.member = (SELECT oid FROM pg_roles WHERE rolname = :'owner')
\gexec
DO \$\$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE $APP_SCHEMAS AND pg_get_userbyid(c.relowner) = 'postgres' AND c.oid NOT IN (SELECT objid FROM ext))
     OR pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'wms_meta.schema_migrations'::regclass)) <> '$TARGET'
  THEN RAISE EXCEPTION 'ownership transfer incomplete'; END IF;
END \$\$;
COMMIT;
SQL
LEFT=$(Q -c "SELECT EXISTS (SELECT 1 FROM pg_roles r WHERE pg_has_role('$TARGET', r.oid, 'MEMBER') AND $PRIVILEGED)")
[ "$LEFT" = f ] || { echo "HATA: $TARGET bir yetkili role uye"; exit 1; }
echo "sahiplik devri ve rol yetkileri: OK"

ENVF=$A/migrate.env
if [ ! -s "$ENVF" ] || ! grep -q "^DATABASE_URL_DIRECT=postgresql://$TARGET:" "$ENVF"; then
  SESSIONS=$(Q -c "SELECT count(*) FROM pg_stat_activity WHERE usename = '$TARGET'")
  [ "$SESSIONS" = 0 ] || echo "UYARI: $TARGET ile $SESSIONS acik oturum var; eski parola kullanan arac varsa yeniden yapilandirilmali"
  # Random password; the server only ever sees a SCRAM-SHA-256 verifier (no plaintext in logs/pg_stat_statements).
  python3 -I - "$ENVF.new" "$TARGET" <<'PY' | docker exec -i --user postgres etkinwms-postgres psql -X -q -v ON_ERROR_STOP=1 -d etkinwms >/dev/null
import base64, hashlib, hmac, os, secrets, sys
path, role = sys.argv[1], sys.argv[2]
pw = secrets.token_hex(32)
salt, it = os.urandom(16), 4096
salted = hashlib.pbkdf2_hmac('sha256', pw.encode(), salt, it)
client = hmac.new(salted, b'Client Key', 'sha256').digest()
server = hmac.new(salted, b'Server Key', 'sha256').digest()
b64 = lambda b: base64.b64encode(b).decode()
verifier = 'SCRAM-SHA-256$%d:%s$%s:%s' % (it, b64(salt), b64(hashlib.sha256(client).digest()), b64(server))
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
os.write(fd, ('DATABASE_URL_DIRECT=postgresql://%s:%s@etkinwms-postgres:5432/etkinwms?sslmode=verify-full\n' % (role, pw)).encode())
os.close(fd)
print('ALTER ROLE "%s" LOGIN PASSWORD \'%s\';' % (role, verifier))
PY
  chmod 600 "$ENVF.new"; CAND=$ENVF.new
else
  CAND=$ENVF
fi

# Verify the stored credential over the real TLS path with libpq (values come from an env file, not argv).
PGF=$(mktemp); trap 'rm -f "$PGF"' EXIT
python3 -I - "$CAND" "$PGF" <<'PY'
import sys, urllib.parse
url = open(sys.argv[1]).read().strip().split('=', 1)[1]
u = urllib.parse.urlsplit(url)
open(sys.argv[2], 'w').write('PGHOST=%s\nPGPORT=%s\nPGDATABASE=%s\nPGUSER=%s\nPGPASSWORD=%s\nPGSSLMODE=verify-full\nPGSSLROOTCERT=/run/ca.crt\n'
                             % (u.hostname, u.port, u.path.lstrip('/'), urllib.parse.unquote(u.username), urllib.parse.unquote(u.password)))
PY
PGIMG=$(docker inspect --format '{{.Config.Image}}' etkinwms-postgres)
WHO=$(docker run --rm --network etkinwms-motive_default --env-file "$PGF" -v /opt/etkinwms/database/tls/ca.crt:/run/ca.crt:ro \
  "$PGIMG" psql -X -qAt -c "SELECT current_user" </dev/null)
[ "$WHO" = "$TARGET" ] || { echo "HATA: migration rolu ile TLS girisi dogrulanamadi"; exit 1; }
echo "migration rolu TLS girisi: OK"
[ "$CAND" = "$ENVF" ] || mv "$CAND" "$ENVF"

install -d -m 700 -o root -g root /opt/etkinwms/backups
(
  flock -w 600 9 || { echo "HATA: yayin kilidi alinamadi"; exit 1; }
  cp /usr/local/sbin/etkinwms-release "/usr/local/sbin/etkinwms-release.bak-$(date +%s)"
  install -m 755 -o root -g root release.py /usr/local/sbin/etkinwms-release
) 9>>"$A/release.lock"
/usr/local/sbin/etkinwms-release check
echo "TAMAM"
