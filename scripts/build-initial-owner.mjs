#!/usr/bin/env node
// Reproducible source bundle using the existing worker esbuild dependency; no install/network.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { cpSync, mkdirSync, readdirSync, realpathSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationDir = path.join(root, 'packages/db/migrations');
const ledger = readdirSync(migrationDir).filter(name => /^\d{4}_.+\.up\.sql$/.test(name)).sort().map(filename => {
  const match = /^(\d{4})_(.+)\.up\.sql$/.exec(filename);
  if (!match) throw new Error('INVALID_MIGRATION');
  return { version: match[1], name: match[2], checksum_sha256: createHash('sha256').update(readFileSync(path.join(migrationDir, filename))).update(Uint8Array.of(0)).update(readFileSync(path.join(migrationDir, filename.replace('.up.sql', '.down.sql')))).digest('hex') };
});
if (ledger.length !== 27 || ledger.some((m, i) => m.version !== String(i + 1).padStart(4, '0'))) throw new Error('INITIAL_OWNER_REQUIRES_SCHEMA27_SOURCE');
const output = path.join(root, '.artifacts/initial-owner');
mkdirSync(output, { recursive: true });
const source = readFileSync(path.join(root, 'scripts/initial-owner.mjs'), 'utf8').replace('export const SOURCE_LEDGER = [];', 'export const SOURCE_LEDGER = ' + JSON.stringify(ledger) + ';').replaceAll("from '../packages/", "from '" + root + "/packages/");
writeFileSync(path.join(output, 'source.mjs'), source);
const result = spawnSync(path.join(root, 'apps/worker/node_modules/.bin/esbuild'), [
  '.artifacts/initial-owner/source.mjs', '--bundle', '--platform=node', '--format=esm', '--target=node24',
  '--external:@node-rs/argon2', '--outfile=.artifacts/initial-owner/initial-owner.mjs', '--log-level=warning',
  "--banner:js=import { createRequire as __operatorRequire } from 'node:module'; const require = __operatorRequire(import.meta.url);",
], { cwd: root, stdio: 'inherit' });
process.exitCode = result.status ?? 1;
rmSync(path.join(output, 'source.mjs'));

if (result.status === 0) {
  const nativeRoot = path.dirname(realpathSync(path.join(root, 'apps/worker/node_modules/@node-rs/argon2')));
  const out = path.join(root, '.artifacts/initial-owner/node_modules/@node-rs');
  mkdirSync(out, { recursive: true });
  for (const name of readdirSync(nativeRoot)) {
    if (name === 'argon2' || name.startsWith('argon2-')) cpSync(path.join(nativeRoot, name), path.join(out, name), { recursive: true, dereference: true });
  }
}
