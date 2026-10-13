import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('release', Path(__file__).with_name('release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
SHA = 'a' * 40


def release_health(values):
    it = iter(values)
    return lambda: next(it)


def make_archive(path, tag=None, user='node', revision=SHA, extra=None, schema='b'*64, images=None, migrate_revision=None):
    if images is None:
        images = [(tag or 'etkinwms:' + SHA, revision), ('etkinwms-migrate:' + SHA, migrate_revision or revision)]
    entries = {'manifest.json': [{'RepoTags': [name], 'Config': 'config%d.json' % i, 'Layers': []} for i, (name, _) in enumerate(images)]}
    for i, (_, rev) in enumerate(images):
        entries['config%d.json' % i] = {'config': {'User': user, 'Labels': {'org.opencontainers.image.revision': rev, 'org.etkinwms.schema.sha256': schema}}}
    with tarfile.open(path, 'w:gz') as archive:
        for name, value in entries.items():
            data = json.dumps(value).encode()
            info = tarfile.TarInfo(name)
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
        if extra:
            archive.addfile(extra)


def migration_setup(directory, approved='b'*64):
    base = Path(directory)
    automation = base / 'automation'
    automation.mkdir()
    (base / 'releases').mkdir()
    previous_release = base / 'releases' / 'previous'
    previous_release.mkdir()
    (base / 'current').symlink_to(previous_release)
    previous = {'tag': 'previous', 'sha': 'f'*40, 'compose': str(previous_release / 'compose.yml'),
                'release': str(previous_release), 'schema': approved}
    (automation / 'state.json').write_text(json.dumps(previous))
    (automation / 'approved-schema.sha256').write_text(approved + '\n')
    (automation / 'migrate.env').write_text('DATABASE_URL_DIRECT=x\n')
    return base, automation, previous_release, previous


class ReleaseBoundaryTests(unittest.TestCase):
    def test_commands_reject_shell_and_other_hosts(self):
        for command in ['', 'bash', 'check; id', 'scp -t /etc', 'deploy ' + SHA, 'deploy ' + 'a'*39 + ' ' + 'b'*64 + ' ' + 'c'*64]:
            with self.subTest(command=command), self.assertRaises(ValueError):
                release.command_parts(command)
        self.assertEqual(release.command_parts('check'), ['check'])
        self.assertEqual(release.command_parts('deploy ' + SHA + ' ' + 'b'*64 + ' ' + 'c'*64)[1], SHA)

    def test_image_scope_and_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'image.tar.gz'
            make_archive(path)
            release.validate_archive(path, SHA, 'b'*64)
            for override in [{'tag': 'other-app:latest'}, {'user': 'root'}, {'revision': 'b'*40}]:
                make_archive(path, **override)
                with self.subTest(override=override), self.assertRaises(ValueError):
                    release.validate_archive(path, SHA, 'b'*64)

    def test_archive_must_carry_app_and_migrator_for_the_same_revision(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'image.tar.gz'
            for images in [[('etkinwms:' + SHA, SHA)],
                           [('etkinwms:' + SHA, SHA), ('etkinwms-migrate:' + SHA, SHA), ('other:' + SHA, SHA)],
                           [('etkinwms:' + SHA, SHA), ('etkinwms-migrate:latest', SHA)],
                           [('etkinwms:' + SHA, SHA), ('etkinwms:' + SHA, SHA)]]:
                make_archive(path, images=images)
                with self.subTest(images=images), self.assertRaisesRegex(ValueError, 'IMAGE_TAG_REJECTED'):
                    release.validate_archive(path, SHA, 'b'*64)
            make_archive(path, migrate_revision='c'*40)
            with self.assertRaisesRegex(ValueError, 'IMAGE_IDENTITY_REJECTED'):
                release.validate_archive(path, SHA, 'b'*64)

    def test_no_links_or_traversal(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'image.tar.gz'
            for name, kind in [('../etc/passwd', tarfile.REGTYPE), ('link', tarfile.SYMTYPE), ('/etc/passwd', tarfile.REGTYPE)]:
                member = tarfile.TarInfo(name)
                member.type = kind
                member.linkname = '/etc/passwd'
                make_archive(path, extra=member)
                with self.subTest(name=name), self.assertRaises(ValueError):
                    release.validate_archive(path, SHA, 'b'*64)

    def test_schema_claim_must_match_attested_archive_before_docker_load(self):
        with tempfile.TemporaryDirectory() as directory:
            automation = Path(directory)
            path = automation / 'image.tar.gz'
            for schema in [None, 'c'*64]:
                make_archive(path, schema=schema)
                with self.subTest(schema=schema), self.assertRaisesRegex(ValueError, 'SIGNED_SCHEMA_MISMATCH'):
                    release.validate_archive(path, SHA, 'b'*64)
            (automation / 'approved-schema.sha256').write_text('b'*64)
            (automation / 'state.json').write_text(json.dumps({'schema':'b'*64,'tag':'previous'}))
            def uploaded(stream, package):
                make_archive(package, schema='c'*64)
                return 'd'*64
            with patch.object(release,'AUTOMATION',automation), patch.object(release,'assert_ci'), \
                 patch.object(release,'assert_descendant'), patch.object(release,'receive',side_effect=uploaded), \
                 patch.object(release.signal,'alarm'), patch.object(release,'run') as run:
                with self.assertRaisesRegex(ValueError,'SIGNED_SCHEMA_MISMATCH'):
                    release.deploy(SHA,'d'*64,'b'*64)
                run.assert_not_called()

    def test_current_main_and_all_checks_required(self):
        good = [{'id': i, 'name': name, 'app': {'slug': 'github-actions'}, 'status': 'completed', 'conclusion': 'success'}
                for i, name in enumerate(release.CHECKS)]
        with patch.object(release, 'api', side_effect=[{'object': {'sha': SHA}}, {'check_runs': good}]):
            release.assert_ci(SHA)
        for checks in [good[:-1], good + [{**good[0], 'id': 1000, 'conclusion': 'failure'}],
                       [{**r, 'app': {'slug': 'other-app'}} for r in good]]:
            with patch.object(release, 'api', side_effect=[{'object': {'sha': SHA}}, {'check_runs': checks}]), self.assertRaises(ValueError):
                release.assert_ci(SHA)
        with patch.object(release, 'api', return_value={'object': {'sha': 'b'*40}}), self.assertRaises(ValueError):
            release.assert_ci(SHA)

    def test_upload_cap(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(release, 'MAX_UPLOAD', 8), self.assertRaises(ValueError):
            release.receive(io.BytesIO(b'0123456789'), Path(directory) / 'image')

    def test_old_or_divergent_code_cannot_replace_production(self):
        for status in ['behind', 'diverged']:
            with patch.object(release, 'api', return_value={'status': status}), self.assertRaisesRegex(ValueError, 'PRODUCTION_DOWNGRADE_REJECTED'):
                release.assert_descendant(SHA, 'b'*40)
        for status in ['ahead', 'identical']:
            with patch.object(release, 'api', return_value={'status': status}):
                release.assert_descendant(SHA, 'b'*40)

    def test_schema_change_never_reaches_upload_or_docker(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'approved-schema.sha256').write_text('b'*64)
            (root / 'state.json').write_text(json.dumps({'schema': 'c'*64}))
            with patch.object(release, 'AUTOMATION', root), patch.object(release, 'assert_ci'), patch.object(release, 'run') as run:
                # No migration credential installed: a schema change still needs the operator.
                with self.assertRaisesRegex(ValueError, 'SCHEMA_OPERATOR_APPROVAL_REQUIRED'):
                    release.deploy(SHA, 'd'*64, 'e'*64)
                with self.assertRaisesRegex(ValueError, 'ROLLBACK_SCHEMA_INCOMPATIBLE'):
                    release.deploy(SHA, 'd'*64, 'b'*64)
                (root / 'migrate.env').write_text('DATABASE_URL_DIRECT=x\n')
                with self.assertRaisesRegex(ValueError, 'ROLLBACK_SCHEMA_INCOMPATIBLE'):
                    release.deploy(SHA, 'd'*64, 'e'*64)
                run.assert_not_called()

    def _deploy_patches(self, base, automation, **extra):
        patches = [patch.object(release, 'BASE', base), patch.object(release, 'AUTOMATION', automation),
                   patch.object(release, 'assert_ci'), patch.object(release, 'assert_descendant'),
                   patch.object(release, 'validate_archive'), patch.object(release, 'verify_provenance'),
                   patch.object(release, 'receive', return_value='d'*64), patch.object(release.signal, 'alarm'),
                   patch.object(release.time, 'sleep')]
        patches += [patch.object(release, name, value) for name, value in extra.items()]
        return patches

    def test_schema_change_backs_up_migrates_then_approves_and_rolls_out(self):
        with tempfile.TemporaryDirectory() as directory:
            base, automation, previous_release, previous = migration_setup(directory)
            calls = []
            def backup(sha):
                calls.append('backup')
            def migrate(sha):
                self.assertEqual((automation / 'approved-schema.sha256').read_text().strip(), 'b'*64)
                calls.append('migrate')
            def run(args, **kwargs):
                calls.append(' '.join(a for a in args if a in ('stop', 'up', 'config', 'load')))
            ctx = self._deploy_patches(base, automation, backup_database=backup, migrate_database=migrate, run=run,
                                       ledger_version=lambda: '0031',
                                       healthy=lambda: True)
            for c in ctx: c.start()
            try:
                release.deploy(SHA, 'd'*64, 'e'*64)
            finally:
                for c in reversed(ctx): c.stop()
            self.assertEqual(calls, ['load', 'config', 'backup', 'stop', 'migrate', 'up'])
            self.assertEqual((automation / 'approved-schema.sha256').read_text().strip(), 'e'*64)
            self.assertEqual(len(list(automation.glob('approved-schema.sha256.bak-*'))), 1)
            state = json.loads((automation / 'state.json').read_text())
            self.assertEqual((state['sha'], state['schema']), (SHA, 'e'*64))
            self.assertEqual((base / 'current').resolve(), (base / 'releases' / ('auto-' + SHA)).resolve())

    def test_failed_migration_restarts_previous_and_keeps_schema_unapproved(self):
        with tempfile.TemporaryDirectory() as directory:
            base, automation, previous_release, previous = migration_setup(directory)
            ctx = self._deploy_patches(base, automation, backup_database=lambda sha: None,
                                       migrate_database=lambda sha: (_ for _ in ()).throw(
                                           release.subprocess.CalledProcessError(1, 'migrate')),
                                       ledger_version=lambda: '0031', healthy=lambda: True)
            for c in ctx: c.start()
            try:
                with patch.object(release, 'run') as run, \
                     self.assertRaisesRegex(ValueError, 'MIGRATION_FAILED_PREVIOUS_RESTARTED'):
                    release.deploy(SHA, 'd'*64, 'e'*64)
            finally:
                for c in reversed(ctx): c.stop()
            self.assertEqual(run.call_args.kwargs['env']['WMS_RELEASE'], 'previous')
            self.assertIn('up', run.call_args.args[0])
            self.assertEqual((automation / 'approved-schema.sha256').read_text().strip(), 'b'*64)
            self.assertEqual(json.loads((automation / 'state.json').read_text()), previous)
            self.assertEqual((base / 'current').resolve(), previous_release.resolve())

    def test_partially_applied_migration_keeps_service_stopped(self):
        with tempfile.TemporaryDirectory() as directory:
            base, automation, previous_release, previous = migration_setup(directory)
            versions = iter(['0031', '0032'])
            ctx = self._deploy_patches(base, automation, backup_database=lambda sha: None,
                                       migrate_database=lambda sha: (_ for _ in ()).throw(
                                           release.subprocess.CalledProcessError(1, 'migrate')),
                                       ledger_version=lambda: next(versions), healthy=lambda: True)
            for c in ctx: c.start()
            try:
                with patch.object(release, 'run') as run, \
                     self.assertRaisesRegex(ValueError, 'MIGRATION_PARTIAL_SERVICE_STOPPED'):
                    release.deploy(SHA, 'd'*64, 'e'*64)
            finally:
                for c in reversed(ctx): c.stop()
            self.assertIn('stop', run.call_args.args[0])
            self.assertFalse(any('up' in c.args[0] for c in run.call_args_list))
            self.assertEqual((automation / 'approved-schema.sha256').read_text().strip(), 'b'*64)
            self.assertEqual(json.loads((automation / 'state.json').read_text()), previous)

    def test_failed_rollout_after_migration_keeps_previous_image_on_new_schema(self):
        with tempfile.TemporaryDirectory() as directory:
            base, automation, previous_release, previous = migration_setup(directory)
            ctx = self._deploy_patches(base, automation, backup_database=lambda sha: None,
                                       migrate_database=lambda sha: None, run=lambda *a, **k: None,
                                       ledger_version=lambda: '0031',
                                       healthy=release_health([False]*18 + [True]))
            for c in ctx: c.start()
            try:
                with self.assertRaisesRegex(ValueError, 'RELEASE_FAILED_PREVIOUS_RESTORED'):
                    release.deploy(SHA, 'd'*64, 'e'*64)
            finally:
                for c in reversed(ctx): c.stop()
            self.assertEqual((automation / 'approved-schema.sha256').read_text().strip(), 'e'*64)
            self.assertEqual(json.loads((automation / 'state.json').read_text()), dict(previous, schema='e'*64))
            self.assertEqual((base / 'current').resolve(), previous_release.resolve())

    def test_backup_is_private_valid_and_pruned(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            def dump(args, **kwargs):
                self.assertEqual(args[:5], ['docker', 'exec', '--user', 'postgres', 'etkinwms-postgres'])
                kwargs['stdout'].write(payload)
            with patch.object(release, 'BASE', base), patch.object(release, 'KEEP_BACKUPS', 2), \
                 patch.object(release, 'run', side_effect=dump):
                payload = b'PGDMP rest'
                paths = []
                for i in range(3):
                    with patch.object(release.time, 'time', return_value=1000 + i):
                        paths.append(release.backup_database(SHA))
                    os.utime(paths[-1], (1000 + i, 1000 + i))
                self.assertEqual(sorted((base / 'backups').glob('pre-*.dump')), sorted(paths[1:]))
                self.assertEqual(paths[-1].stat().st_mode & 0o777, 0o600)
                self.assertEqual((base / 'backups').stat().st_mode & 0o777, 0o700)
                payload = b'not a dump'
                with patch.object(release.time, 'time', return_value=2000), \
                     self.assertRaisesRegex(ValueError, 'BACKUP_INVALID'):
                    release.backup_database(SHA)

    def test_migrator_gets_credential_only_from_env_file(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(release, 'AUTOMATION', Path(directory)), \
             patch.object(release, 'run') as run:
            release.migrate_database(SHA)
            args = run.call_args.args[0]
            self.assertEqual(args[args.index('--env-file') + 1], str(Path(directory) / 'migrate.env'))
            self.assertIn('etkinwms-migrate:' + SHA, args)
            self.assertFalse(any('postgresql://' in a or 'PASSWORD' in a for a in args))
            self.assertEqual(run.call_args.kwargs['stdout'], release.subprocess.DEVNULL)

    def test_failed_health_restores_previous_without_promoting_new_release(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            automation = base / 'automation'
            automation.mkdir()
            (base / 'releases').mkdir()
            previous_release = base / 'releases' / 'previous'
            previous_release.mkdir()
            (base / 'current').symlink_to(previous_release)
            previous = {'tag': 'previous', 'compose': str(previous_release / 'compose.yml'),
                        'release': str(previous_release), 'schema': 'b'*64}
            (automation / 'state.json').write_text(json.dumps(previous))
            (automation / 'approved-schema.sha256').write_text('b'*64)
            with patch.object(release, 'BASE', base), patch.object(release, 'AUTOMATION', automation), \
                 patch.object(release, 'assert_ci'), patch.object(release, 'assert_descendant'), patch.object(release, 'validate_archive'), \
                 patch.object(release, 'verify_provenance'), \
                 patch.object(release, 'receive', return_value='d'*64), patch.object(release.signal, 'alarm'), \
                 patch.object(release.time, 'sleep'), patch.object(release, 'run') as run, \
                 patch.object(release, 'healthy', side_effect=[False]*18+[True]):
                with self.assertRaisesRegex(ValueError, 'RELEASE_FAILED_PREVIOUS_RESTORED'):
                    release.deploy(SHA, 'd'*64, 'b'*64)
                self.assertEqual((base/'current').resolve(), previous_release.resolve())
                self.assertEqual(json.loads((automation/'state.json').read_text()), previous)
                self.assertIn(str(previous_release/'compose.yml'), run.call_args.args[0])
                self.assertEqual(run.call_args.kwargs['env']['WMS_RELEASE'], 'previous')
                self.assertFalse(any('down' in c.args[0] or 'prune' in c.args[0] for c in run.call_args_list))

    def test_duplicate_release_never_loads_or_overwrites_active_tag(self):
        with tempfile.TemporaryDirectory() as directory:
            automation=Path(directory)
            (automation/'state.json').write_text(json.dumps({'tag':SHA,'sha':SHA,'schema':'b'*64}))
            (automation/'approved-schema.sha256').write_text('b'*64)
            with patch.object(release,'AUTOMATION',automation), patch.object(release,'assert_ci'), \
                 patch.object(release,'assert_descendant'), patch.object(release,'healthy',return_value=True), \
                 patch.object(release,'receive') as receive, patch.object(release,'run') as run:
                release.deploy(SHA,'d'*64,'b'*64)
                receive.assert_not_called()
                run.assert_not_called()

    def test_state_write_failure_restores_current_and_previous_state(self):
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory); automation=base/'automation'; automation.mkdir(); (base/'releases').mkdir()
            previous_release=base/'releases'/'previous'; previous_release.mkdir(); (base/'current').symlink_to(previous_release)
            previous={'tag':'previous','compose':str(previous_release/'compose.yml'),'release':str(previous_release),'schema':'b'*64}
            (automation/'state.json').write_text(json.dumps(previous)); (automation/'approved-schema.sha256').write_text('b'*64)
            with patch.object(release,'BASE',base), patch.object(release,'AUTOMATION',automation), \
                 patch.object(release,'assert_ci'), patch.object(release,'assert_descendant'), patch.object(release,'validate_archive'), \
                 patch.object(release,'verify_provenance'), patch.object(release,'receive',return_value='d'*64), \
                 patch.object(release.signal,'alarm'), patch.object(release,'run'), patch.object(release,'healthy',return_value=True), \
                 patch.object(release,'write_state',side_effect=[OSError('disk full'),None]) as write:
                with self.assertRaisesRegex(ValueError,'RELEASE_FAILED_PREVIOUS_RESTORED'):
                    release.deploy(SHA,'d'*64,'b'*64)
                self.assertEqual((base/'current').resolve(),previous_release.resolve())
                self.assertEqual(write.call_args.args[0],previous)

    def test_provenance_rejects_missing_or_invalid_attestations(self):
        with tempfile.TemporaryDirectory() as directory:
            artifact=Path(directory)/'image.tar.gz'
            with patch.object(release,'api',return_value={'attestations':[]}), self.assertRaisesRegex(ValueError,'BUILD_ATTESTATION_MISSING'):
                release.verify_provenance(artifact,SHA,'d'*64)
            with patch.object(release,'api',return_value={'attestations':[{'bundle':{}}]}), \
                 patch.object(release.subprocess,'run',return_value=release.subprocess.CompletedProcess([],1)) as verifier:
                with self.assertRaisesRegex(ValueError,'BUILD_ATTESTATION_REJECTED'):
                    release.verify_provenance(artifact,SHA,'d'*64)
                args=verifier.call_args.args[0]
                self.assertEqual(args[args.index('--source-ref')+1],'refs/heads/main')
                self.assertEqual(args[args.index('--source-digest')+1],SHA)
                self.assertEqual(args[args.index('--signer-digest')+1],SHA)
                self.assertEqual(args[args.index('--signer-workflow')+1],'shosgoren/EtkinWMS/.github/workflows/deploy-vps.yml')
                self.assertIn('--deny-self-hosted-runners',args)
                self.assertNotIn('GH_TOKEN',verifier.call_args.kwargs['env'])


if __name__ == '__main__':
    unittest.main()
