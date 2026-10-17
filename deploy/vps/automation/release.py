#!/usr/bin/python3
"""Root-owned, fixed-scope release receiver. No shell or source extraction.

Schema changes (T-916): only when the signed archive's schema label differs from the approved one AND the
operator installed the migration credential (migrate.env). Then: pg_dump backup -> stop web/worker ->
signed migrator image runs `migrate.ts up` as the migration owner role -> schema approved -> normal rollout.
Job queues (T-411): whenever migrate.env exists, every release runs an additive queue sync (missing queues only) from the
same signed migrator image: before rollout while the previous release serves, or right after a migration.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.parse
import urllib.request

BASE = Path('/opt/etkinwms')
AUTOMATION = BASE / 'automation'
REPO = 'shosgoren/EtkinWMS'
CHECKS = {'verify', 'infra', 'secrets', 'deps', 'int', 'e2e', 'check-all', 'test-ac', 'check-pilot'}
HEX40 = re.compile(r'[0-9a-f]{40}\Z')
HEX64 = re.compile(r'[0-9a-f]{64}\Z')
MAX_UPLOAD = 512 * 1024 * 1024
BASELINE_SHA = '024a800bace33c2dc3df397d56fda7e449d1d9dc'
IMAGES = ('etkinwms', 'etkinwms-migrate')
KEEP_BACKUPS = 10
DB_CONTAINER = 'etkinwms-postgres'
# T-410: Compose proje adı ve uygulama ağı state.json'dan okunur (yeniden adlandırma betiği `project`/`network` yazar). Kayıt yoksa eski
# adlar (geçiş öncesi kurulum). Yalnız bu iki çift kabul edilir: state dosyası üzerinden keyfi proje/ağ adı verilemez.
PROJECTS = {'etkinwms-motive': 'etkinwms-motive_default', 'etkinwms': 'etkinwms_default'}
LEGACY_PROJECT = 'etkinwms-motive'
DB_CA = '/opt/etkinwms/database/tls/ca.crt'


def command_parts(text):
    parts = text.split()
    if parts == ['check']:
        return parts
    if len(parts) == 4 and parts[0] == 'deploy' and HEX40.fullmatch(parts[1]) and all(HEX64.fullmatch(p) for p in parts[2:]):
        return parts
    raise ValueError('COMMAND_REJECTED')


def api(path):
    req = urllib.request.Request('https://api.github.com/repos/' + REPO + path,
                                 headers={'Accept': 'application/vnd.github+json', 'User-Agent': 'EtkinWMS-deploy'})
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.load(response)


def assert_ci(sha):
    if api('/git/ref/heads/main')['object']['sha'] != sha:
        raise ValueError('NOT_CURRENT_MAIN')
    rows = api('/commits/' + sha + '/check-runs?per_page=100')['check_runs']
    for name in CHECKS:
        runs = [r for r in rows if r['name'] == name and r.get('app', {}).get('slug') == 'github-actions']
        latest = max(runs, key=lambda r: r['id'], default=None)
        if latest is None or latest['status'] != 'completed' or latest['conclusion'] != 'success':
            raise ValueError('CI_NOT_GREEN:' + name)


def assert_descendant(sha, previous_sha):
    if not HEX40.fullmatch(previous_sha):
        raise ValueError('INVALID_PREVIOUS_REVISION')
    if api('/compare/' + previous_sha + '...' + sha)['status'] not in ['ahead', 'identical']:
        raise ValueError('PRODUCTION_DOWNGRADE_REJECTED')


def validate_archive(path, sha, schema_hash):
    with tarfile.open(path, 'r:gz') as archive:
        count, total = 0, 0
        for member in archive:
            count += 1
            total += member.size
            if count > 10000 or total > 4 * 1024**3:
                raise ValueError('ARCHIVE_TOO_LARGE')
            p = PurePosixPath(member.name)
            if p.is_absolute() or '..' in p.parts or not (member.isfile() or member.isdir()):
                raise ValueError('UNSAFE_ARCHIVE')
        manifest = archive.getmember('manifest.json')
        if manifest.size > 10000:
            raise ValueError('BAD_MANIFEST')
        entries = json.load(archive.extractfile(manifest))
        tags = sorted(tag for entry in entries for tag in (entry.get('RepoTags') or []))
        if len(entries) != len(IMAGES) or tags != sorted(name + ':' + sha for name in IMAGES) \
                or any(len(entry.get('RepoTags') or []) != 1 for entry in entries):
            raise ValueError('IMAGE_TAG_REJECTED')
        for entry in entries:
            config = archive.getmember(entry['Config'])
            if config.size > 1024 * 1024:
                raise ValueError('BAD_IMAGE_CONFIG')
            data = json.load(archive.extractfile(config))['config']
            if data.get('User') != 'node' or data.get('Labels', {}).get('org.opencontainers.image.revision') != sha:
                raise ValueError('IMAGE_IDENTITY_REJECTED')
            if data.get('Labels', {}).get('org.etkinwms.schema.sha256') != schema_hash:
                raise ValueError('SIGNED_SCHEMA_MISMATCH')


def run(args, **kwargs):
    # stdin is the SSH upload stream; child processes never read it.
    kwargs.setdefault('stdin', subprocess.DEVNULL)
    return subprocess.run(args, check=True, timeout=kwargs.pop('timeout', 300), **kwargs)


def project(state):
    name = state.get('project', LEGACY_PROJECT)
    if name not in PROJECTS:
        raise ValueError('PROJECT_REJECTED')
    return name


def db_network():
    return PROJECTS[project(json.loads((AUTOMATION / 'state.json').read_text()))]


def compose(state):
    env = os.environ.copy()
    env['WMS_RELEASE'] = state['tag']
    return ['docker', 'compose', '-p', project(state), '-f', state['compose']], env


def healthy():
    try:
        with urllib.request.urlopen('https://wms.etkinyazilim.com/api/health', timeout=10) as response:
            result = json.load(response)
        return all(result.get(k) == 'ok' for k in ['status', 'db', 'queue', 'worker'])
    except Exception:
        return False


def write_state(state):
    temporary = AUTOMATION / 'state.json.new'
    temporary.write_text(json.dumps(state))
    temporary.chmod(0o600)
    temporary.replace(AUTOMATION / 'state.json')


def receive(stream, path):
    digest = hashlib.sha256()
    size = 0
    with path.open('wb') as target:
        while block := stream.read(1024 * 1024):
            size += len(block)
            if size > MAX_UPLOAD:
                raise ValueError('UPLOAD_TOO_LARGE')
            target.write(block)
            digest.update(block)
    return digest.hexdigest()


def verify_provenance(path, sha, archive_hash):
    records = api('/attestations/sha256:' + archive_hash)['attestations']
    if not records:
        raise ValueError('BUILD_ATTESTATION_MISSING')
    bundle = path.with_name('provenance.jsonl')
    bundle.write_text('\n'.join(json.dumps(row['bundle']) for row in records))
    env = {'PATH': '/usr/bin:/bin', 'GH_CONFIG_DIR': str(AUTOMATION / 'gh-config')}
    result = subprocess.run(['/usr/local/lib/etkinwms-gh/gh', 'attestation', 'verify', str(path),
                             '--bundle', str(bundle), '--repo', REPO,
                             '--signer-workflow', REPO + '/.github/workflows/deploy-vps.yml',
                             '--source-ref', 'refs/heads/main', '--source-digest', sha,
                             '--signer-digest', sha, '--deny-self-hosted-runners'],
                            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=90)
    if result.returncode != 0:
        raise ValueError('BUILD_ATTESTATION_REJECTED')


def migrate_env():
    return AUTOMATION / 'migrate.env'


MIGRATOR_NAME = 'etkinwms-migrate-run'
MIN_FREE_BYTES = 1024**3
SAFE_ROLE = re.compile(r'[a-z_][a-z0-9_]{0,62}\Z')


def psql(query, timeout=60):
    # Peer-authenticated operator session inside the DB container; fixed queries only.
    result = run(['docker', 'exec', '--user', 'postgres', DB_CONTAINER, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                  '-d', 'etkinwms', '-c', query], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=timeout)
    return result.stdout.decode().strip()


def assert_migration_role():
    """The env-file role must own the ledger and be NOSUPERUSER/NOBYPASSRLS/NOCREATEROLE/NOCREATEDB, incl. via membership."""
    url = migrate_env().read_text().strip().split('=', 1)[1]
    user = urllib.parse.unquote(urllib.parse.urlsplit(url).username or '')
    if not SAFE_ROLE.fullmatch(user):
        raise ValueError('MIGRATION_ROLE_REJECTED')
    row = psql("SELECT pg_get_userbyid(c.relowner) = '" + user + "' AND NOT EXISTS ("
               " SELECT 1 FROM pg_roles r WHERE pg_has_role('" + user + "', r.oid, 'MEMBER')"
               " AND (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication"
               " OR r.rolname IN ('pg_execute_server_program', 'pg_read_server_files', 'pg_write_server_files',"
               " 'pg_read_all_data', 'pg_write_all_data', 'pg_signal_backend', 'pg_checkpoint')))"
               " FROM pg_class c WHERE c.oid = 'wms_meta.schema_migrations'::regclass")
    if row != 't':
        raise ValueError('MIGRATION_ROLE_REJECTED')


def backup_database(sha):
    backups = BASE / 'backups'
    backups.mkdir(mode=0o700, exist_ok=True)
    backups.chmod(0o700)
    if shutil.disk_usage(backups).free < MIN_FREE_BYTES:
        raise ValueError('BACKUP_DISK_LOW')
    path = backups / ('pre-' + sha + '-' + str(int(time.time())) + '.dump')
    try:
        with open(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as target:
            run(['docker', 'exec', '--user', 'postgres', DB_CONTAINER, 'pg_dump', '-Fc', '-d', 'etkinwms'],
                stdout=target, stderr=subprocess.DEVNULL, timeout=600)
        with path.open('rb') as dump:
            if dump.read(5) != b'PGDMP':
                raise ValueError('BACKUP_INVALID')
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    dumps = sorted(backups.glob('pre-*.dump'), key=lambda p: p.stat().st_mtime)
    for old in dumps[:-KEEP_BACKUPS]:
        old.unlink()
    return path


def remove_migrator():
    subprocess.run(['docker', 'rm', '-f', MIGRATOR_NAME], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL, timeout=60)


def migrator_drained():
    """After a failure: kill the container, then wait until no migration session remains in the DB."""
    remove_migrator()
    for _ in range(30):
        if psql("SELECT count(*) FROM pg_stat_activity WHERE application_name = 'wms-migrate'") == '0':
            return True
        time.sleep(2)
    return False


def migrator_run(sha, command, timeout):
    # Credential stays in the root-only env file; never in argv or logs. Output is suppressed (may echo data).
    remove_migrator()
    run(['docker', 'run', '--rm', '--name', MIGRATOR_NAME, '--network', db_network(), '--env-file', str(migrate_env()),
         '-e', 'NODE_EXTRA_CA_CERTS=/run/etkinwms-db-ca.crt', '-e', 'WMS_ENV=production', '-e', 'DEMO_MODE=0',
         '-v', DB_CA + ':/run/etkinwms-db-ca.crt:ro', '--read-only', '--tmpfs', '/tmp',
         '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '512m',
         'etkinwms-migrate:' + sha] + command,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=timeout)


def migrate_database(sha):
    migrator_run(sha, ['node', 'src/migrate.ts', 'up'], 600)


def install_queues(sha):
    # T-411: additive queue sync for this release: creates missing job-type queues only (no pg-boss schema upgrade, no
    # grant/RLS change; refuses without writing if the queue schema would need an upgrade). Same credential and limits
    # as the migrator. A killed client must not leave the container holding locks.
    try:
        migrator_run(sha, ['node', '/queue-installer/sync.mjs'], 120)
    finally:
        remove_migrator()


def ledger_version():
    return psql("SELECT coalesce(max(version), '') FROM wms_meta.schema_migrations")


def approve_schema(schema_hash):
    approved = AUTOMATION / 'approved-schema.sha256'
    backup = AUTOMATION / ('approved-schema.sha256.bak-' + str(int(time.time())))
    backup.write_text(approved.read_text())
    backup.chmod(0o600)
    temporary = AUTOMATION / 'approved-schema.sha256.new'
    temporary.write_text(schema_hash + '\n')
    temporary.chmod(0o600)
    temporary.replace(approved)


def set_current(release):
    link = BASE / 'current.next'
    if link.is_symlink():
        link.unlink()
    link.symlink_to(release)
    link.replace(BASE / 'current')


def deploy(sha, archive_hash, schema_hash):
    approved = (AUTOMATION / 'approved-schema.sha256').read_text().strip()
    if not HEX64.fullmatch(approved):
        raise ValueError('SCHEMA_OPERATOR_APPROVAL_REQUIRED')
    migrate = schema_hash != approved
    if migrate and not migrate_env().is_file():
        raise ValueError('SCHEMA_OPERATOR_APPROVAL_REQUIRED')
    assert_ci(sha)
    previous = json.loads((AUTOMATION / 'state.json').read_text())
    if previous.get('schema') != approved:
        raise ValueError('ROLLBACK_SCHEMA_INCOMPATIBLE')
    assert_descendant(sha, previous.get('sha', BASELINE_SHA))
    if not migrate and (previous.get('sha') == sha or previous['tag'] == sha):
        if not healthy():
            raise ValueError('EXISTING_RELEASE_UNHEALTHY')
        print(json.dumps({'already_deployed': sha, 'health': 'ok'}))
        return
    with tempfile.TemporaryDirectory(prefix='release-', dir=AUTOMATION) as directory:
        package = Path(directory) / 'image.tar.gz'
        signal.alarm(600)  # An incomplete/slow stream must not hold the release lock indefinitely.
        if receive(sys.stdin.buffer, package) != archive_hash:
            raise ValueError('UPLOAD_HASH_MISMATCH')
        signal.alarm(0)
        validate_archive(package, sha, schema_hash)
        verify_provenance(package, sha, archive_hash)
        assert_ci(sha)  # main/CI may have changed during upload
        run(['docker', 'load', '-i', str(package)], stdout=subprocess.DEVNULL)
    release = BASE / 'releases' / ('auto-' + sha)
    release.mkdir(mode=0o755, exist_ok=True)
    (release / 'release.json').write_text(json.dumps({'sha': sha, 'schema': schema_hash}))
    current = {'tag': sha, 'sha': sha, 'compose': str(AUTOMATION / 'compose.yml'), 'release': str(release), 'schema': schema_hash,
               'project': project(previous)}
    args, env = compose(current)
    run(args + ['config', '--quiet'], env=env)
    # Queue sync is additive (missing queues only). Without a migration it runs while the previous release still serves,
    # so a failure stops the release before anything is stopped. With a migration it runs right after the migration
    # (a release's queues may depend on its own migrations); a failure then restarts the previous image like a failed rollout.
    queues = 'skipped'
    if not migrate and migrate_env().is_file():
        assert_migration_role()
        try:
            install_queues(sha)
        except Exception:
            raise ValueError('QUEUE_INSTALL_FAILED_PREVIOUS_RUNNING') from None
        queues = 'installed'
    if migrate:
        old_args, old_env = compose(previous)
        assert_migration_role()
        before = ledger_version()
        try:
            # Writers stop first so the dump is the exact recovery point.
            run(old_args + ['stop', 'web', 'worker'], env=old_env, stdout=subprocess.DEVNULL)
            backup_database(sha)
        except Exception:
            run(old_args + ['up', '-d', '--no-build', '--wait', '--wait-timeout', '180'], env=old_env)
            raise ValueError('BACKUP_FAILED_PREVIOUS_RESTARTED') from None
        try:
            migrate_database(sha)
        except Exception:
            # Each migration commits separately. Only an untouched ledger (after the migrator is gone) is known to
            # fit the previous image; otherwise stay stopped for an operator restore/forward fix.
            try:
                untouched = migrator_drained() and ledger_version() == before
            except Exception:
                untouched = False
            if not untouched:
                raise ValueError('MIGRATION_PARTIAL_SERVICE_STOPPED') from None
            run(old_args + ['up', '-d', '--no-build', '--wait', '--wait-timeout', '180'], env=old_env)
            raise ValueError('MIGRATION_FAILED_PREVIOUS_RESTARTED') from None
        try:
            # The DB is now at the new schema; the previous image remains the rollback target on it.
            previous = dict(previous, schema=schema_hash)
            write_state(previous)
            approve_schema(schema_hash)
        except Exception:
            raise ValueError('POST_MIGRATION_STATE_WRITE_FAILED_SERVICE_STOPPED') from None
        try:
            # After the approved migration (a release's queues may depend on it); the previous image stays the rollback target.
            install_queues(sha)
            queues = 'installed'
        except Exception:
            run(old_args + ['up', '-d', '--no-build', '--wait', '--wait-timeout', '180'], env=old_env)
            if not healthy():
                raise ValueError('QUEUE_INSTALL_FAILED_AFTER_MIGRATION_ROLLBACK_HEALTH_FAILED') from None
            raise ValueError('QUEUE_INSTALL_FAILED_AFTER_MIGRATION_PREVIOUS_RESTARTED') from None
    try:
        run(args + ['up', '-d', '--no-build', '--wait', '--wait-timeout', '180'], env=env)
        for _ in range(18):
            if healthy():
                break
            time.sleep(5)
        else:
            raise ValueError('DEEP_HEALTH_FAILED')
        # Without migration the schema is unchanged. After a migration the previous image is a best-effort
        # rollback on the new schema; the pre-migration dump in /opt/etkinwms/backups is the recovery point.
        set_current(release)
        write_state(current)
    except Exception:
        old_args, old_env = compose(previous)
        run(old_args + ['up', '-d', '--no-build', '--wait', '--wait-timeout', '180'], env=old_env)
        if not healthy():
            raise ValueError('ROLLBACK_HEALTH_FAILED') from None
        set_current(previous['release'])
        write_state(previous)
        raise ValueError('RELEASE_FAILED_PREVIOUS_RESTORED') from None
    print(json.dumps({'deployed': sha, 'health': 'ok', 'queues': queues}))


def main():
    parts = command_parts(' '.join(sys.argv[1:]))
    if os.geteuid() != 0:
        raise ValueError('ROOT_HELPER_ONLY')
    with (AUTOMATION / 'release.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if parts == ['check']:
            print(json.dumps({'scope': REPO, 'health': 'ok' if healthy() else 'failed',
                              'schema': (AUTOMATION / 'approved-schema.sha256').read_text().strip(),
                              'auto_migrate': migrate_env().is_file(),
                              'release': json.loads((AUTOMATION / 'state.json').read_text())['tag']}))
            if not healthy():
                raise ValueError('HEALTH_FAILED')
        else:
            deploy(*parts[1:])


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # No exception bodies, SQL, environment or credential output.
        safe = str(error) if isinstance(error, ValueError) else type(error).__name__
        print('ETKINWMS_RELEASE_REJECTED: ' + safe, file=sys.stderr)
        sys.exit(1)
