#!/usr/bin/python3
"""Root-owned, fixed-scope release receiver. No shell, migrations, or source extraction."""
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

BASE = Path('/opt/etkinwms')
AUTOMATION = BASE / 'automation'
REPO = 'shosgoren/EtkinWMS'
CHECKS = {'verify', 'infra', 'secrets', 'deps', 'int', 'e2e', 'check-all', 'test-ac', 'check-pilot'}
HEX40 = re.compile(r'[0-9a-f]{40}\Z')
HEX64 = re.compile(r'[0-9a-f]{64}\Z')
MAX_UPLOAD = 512 * 1024 * 1024
BASELINE_SHA = '024a800bace33c2dc3df397d56fda7e449d1d9dc'


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
        if len(entries) != 1 or entries[0].get('RepoTags') != ['etkinwms:' + sha]:
            raise ValueError('IMAGE_TAG_REJECTED')
        config = archive.getmember(entries[0]['Config'])
        if config.size > 1024 * 1024:
            raise ValueError('BAD_IMAGE_CONFIG')
        data = json.load(archive.extractfile(config))['config']
        if data.get('User') != 'node' or data.get('Labels', {}).get('org.opencontainers.image.revision') != sha:
            raise ValueError('IMAGE_IDENTITY_REJECTED')
        if data.get('Labels', {}).get('org.etkinwms.schema.sha256') != schema_hash:
            raise ValueError('SIGNED_SCHEMA_MISMATCH')


def run(args, **kwargs):
    return subprocess.run(args, check=True, timeout=kwargs.pop('timeout', 300), **kwargs)


def compose(state):
    env = os.environ.copy()
    env['WMS_RELEASE'] = state['tag']
    return ['docker', 'compose', '-p', 'etkinwms-motive', '-f', state['compose']], env


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


def set_current(release):
    link = BASE / 'current.next'
    if link.is_symlink():
        link.unlink()
    link.symlink_to(release)
    link.replace(BASE / 'current')


def deploy(sha, archive_hash, schema_hash):
    approved = (AUTOMATION / 'approved-schema.sha256').read_text().strip()
    if not HEX64.fullmatch(approved) or schema_hash != approved:
        raise ValueError('SCHEMA_OPERATOR_APPROVAL_REQUIRED')
    assert_ci(sha)
    previous = json.loads((AUTOMATION / 'state.json').read_text())
    if previous.get('schema') != schema_hash:
        raise ValueError('ROLLBACK_SCHEMA_INCOMPATIBLE')
    assert_descendant(sha, previous.get('sha', BASELINE_SHA))
    if previous.get('sha') == sha or previous['tag'] == sha:
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
    current = {'tag': sha, 'sha': sha, 'compose': str(AUTOMATION / 'compose.yml'), 'release': str(release), 'schema': schema_hash}
    args, env = compose(current)
    run(args + ['config', '--quiet'], env=env)
    try:
        run(args + ['up', '-d', '--no-build', '--wait', '--wait-timeout', '180'], env=env)
        for _ in range(18):
            if healthy():
                break
            time.sleep(5)
        else:
            raise ValueError('DEEP_HEALTH_FAILED')
        # The approved schema remains identical, so previous deployment is schema-compatible.
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
    print(json.dumps({'deployed': sha, 'health': 'ok'}))


def main():
    parts = command_parts(' '.join(sys.argv[1:]))
    if os.geteuid() != 0:
        raise ValueError('ROOT_HELPER_ONLY')
    with (AUTOMATION / 'release.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if parts == ['check']:
            print(json.dumps({'scope': REPO, 'health': 'ok' if healthy() else 'failed',
                              'schema': (AUTOMATION / 'approved-schema.sha256').read_text().strip(),
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
