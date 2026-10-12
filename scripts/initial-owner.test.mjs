import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, chmod, symlink, link, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkPrivateDirectory, readPrivateFile, writeExclusivePrivateFile, parseInitialOwnerArgs } from './initial-owner.mjs';

describe('initial owner private operator files', () => {
  it('defaults to dry run and rejects unknown flags/password arguments', () => {
    expect(parseInitialOwnerArgs(['--directory', '/root/enrollment'])).toEqual({ directory: '/root/enrollment', apply: false, resume: false });
    expect(() => parseInitialOwnerArgs(['--directory', '/root/enrollment', '--password', 'synthetic'])).toThrow();
    expect(() => parseInitialOwnerArgs(['--directory', '/root/enrollment', '--resume'])).toThrow();
  });
  it('uses exclusive 0600 files and rejects overwrite, symlinks and permissive directories', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'initial-owner-unit-'));
    const owner = process.getuid?.() ?? -1;
    try {
      await chmod(directory, 0o700);
      await checkPrivateDirectory(directory, owner, (await stat("/")).uid);
      const filename = path.join(directory, 'link');
      await writeExclusivePrivateFile(filename, 'synthetic-private-content');
      expect((await stat(filename)).mode & 0o777).toBe(0o600);
      expect(await readPrivateFile(filename, owner)).toBe('synthetic-private-content');
      await expect(writeExclusivePrivateFile(filename, 'replacement')).rejects.toThrow();
      expect(await readFile(filename, 'utf8')).toBe('synthetic-private-content');
      const alias = path.join(directory, 'alias');
      await symlink(filename, alias);
      await expect(readPrivateFile(alias, owner)).rejects.toThrow();
      await expect(writeExclusivePrivateFile(alias, 'replacement')).rejects.toThrow();
      const hardlink = path.join(directory, 'hardlink'); await link(filename, hardlink);
      await expect(readPrivateFile(filename, owner)).rejects.toThrow('PRIVATE_FILE_REQUIRED');
      await rm(hardlink);
      const race = path.join(directory, 'exclusive-race');
      const results = await Promise.allSettled([writeExclusivePrivateFile(race, 'one'), writeExclusivePrivateFile(race, 'two')]);
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
      const loose = path.join(directory, 'loose'); await mkdir(loose, { mode: 0o755 }); await chmod(loose, 0o755);
      await expect(checkPrivateDirectory(loose, owner, (await stat("/")).uid)).rejects.toThrow('PRIVATE_DIRECTORY_REQUIRED');
      await chmod(filename, 0o644);
      await expect(readPrivateFile(filename, owner)).rejects.toThrow('PRIVATE_FILE_REQUIRED');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
