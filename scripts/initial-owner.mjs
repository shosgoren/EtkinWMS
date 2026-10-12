#!/usr/bin/env node
// Offline root operator command. Never prints errors containing driver input or a reset link.
import { constants } from 'node:fs';
import { open, lstat, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createAuth, readAuthEnv } from '../packages/auth/src/index.ts';
import { validateInitialOwnerPlan, validateInitialOwnerTarget, checkInitialOwnerDatabase, checkInitialOwnerProof, validateInitialOwnerProofUrl, createInitialOwnerClients, enrollInitialOwner } from '../packages/auth/src/initial-owner.ts';

/** @type {import("../packages/auth/src/initial-owner.ts").InitialOwnerMigration[]} */
export const SOURCE_LEDGER = [];

/** @param {string} directory @param {number} [owner] @param {number} [ancestorOwner] */
export async function checkPrivateDirectory(directory, owner = 0, ancestorOwner = 0) {
  const resolved = path.resolve(directory);
  if (resolved !== directory || await realpath(directory) !== directory) throw new Error('PRIVATE_DIRECTORY_REQUIRED');
  let current = directory;
  while (true) {
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.uid !== ancestorOwner && stat.uid !== owner) ||
        (current === directory ? (stat.mode & 0o777) !== 0o700 : (stat.mode & 0o022) !== 0 && (stat.mode & 0o1000) === 0)) throw new Error('PRIVATE_DIRECTORY_REQUIRED');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
/** @param {string} filename @param {number} [owner] */
export async function readPrivateFile(filename, owner = 0) {
  const fd = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await fd.stat();
    if (!stat.isFile() || stat.uid !== owner || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1 || stat.size > 16384) throw new Error('PRIVATE_FILE_REQUIRED');
    return await fd.readFile('utf8');
  } finally { await fd.close(); }
}
/** @param {string} filename @param {string} content */
export async function writeExclusivePrivateFile(filename, content) {
  const fd = await open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await fd.writeFile(content); await fd.sync(); } finally { await fd.close(); }
  const parent = await open(path.dirname(filename), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await parent.sync(); } finally { await parent.close(); }
}
/** @param {string[]} args */
export function parseInitialOwnerArgs(args) {
  let directory = ''; let apply = false; let resume = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--directory' && !directory) directory = args[++i] ?? '';
    else if (arg === '--apply' && !apply) apply = true;
    else if (arg === '--resume' && !resume) resume = true;
    else throw new Error('INVALID_ARGUMENTS');
  }
  if (!directory || (resume && !apply)) throw new Error('INVALID_ARGUMENTS');
  return { directory, apply, resume };
}
/** @param {string[]} args @param {NodeJS.ProcessEnv} env */
export async function runInitialOwner(args, env) {
  if (process.getuid?.() !== 0) throw new Error('ROOT_OPERATOR_REQUIRED');
  const opts = parseInitialOwnerArgs(args);
  await checkPrivateDirectory(opts.directory);
  const planText = await readPrivateFile(path.join(opts.directory, 'plan.json'));
  /** @type {{plan: import('../packages/auth/src/initial-owner.ts').InitialOwnerPlan, target: import('../packages/auth/src/initial-owner.ts').InitialOwnerTarget}} */
  const document = JSON.parse(planText);
  validateInitialOwnerPlan(document.plan);
  validateInitialOwnerTarget(env, document.target);
  const fingerprint = createHash('sha256').update(planText).digest('hex');
  const authEnv = readAuthEnv(env);
  const proofUrl = validateInitialOwnerProofUrl(env.INITIAL_OWNER_PROOF_DATABASE_URL, document.target);
  const { proofDb, appDb, authDb } = createInitialOwnerClients({ ...authEnv, proofUrl });
  let lockOwned = false;
  /** @type {import('node:fs/promises').FileHandle | undefined} */
  let journal;
  const lockPath = path.join(opts.directory, 'operation.lock');
  try {
    await checkInitialOwnerDatabase(appDb, document.target.database, 'wms_app');
    await checkInitialOwnerDatabase(authDb, document.target.database, 'wms_auth');
    if (!opts.apply) {
      await checkInitialOwnerProof(proofDb, document.target, SOURCE_LEDGER, document.plan, false);
      return 'PRECHECK_OK_NO_WRITES';
    }
    await writeExclusivePrivateFile(lockPath, `${process.pid}\n`);
    lockOwned = true;
    const journalPath = path.join(opts.directory, 'journal.jsonl');
    try { await lstat(path.join(opts.directory, 'enrollment-link.txt')); throw new Error('LINK_ALREADY_EXISTS'); }
    catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error; }
    if (opts.resume) {
      const lines = (await readPrivateFile(journalPath)).trimEnd().split('\n').map(line => JSON.parse(line));
      if (lines[0]?.fingerprint !== fingerprint || lines.some(line => ['token-started', 'complete'].includes(line.phase))) throw new Error('RESUME_REJECTED');
      if (lines.some(line => !['planned', 'user-ready', 'tenant-ready'].includes(line.phase))) throw new Error('RESUME_REJECTED');
      journal = await open(journalPath, constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW);
    } else {
      await writeExclusivePrivateFile(journalPath, JSON.stringify({ phase: 'planned', fingerprint, plan: document.plan, target: document.target }) + '\n');
      journal = await open(journalPath, constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW);
    }
    await checkInitialOwnerProof(proofDb, document.target, SOURCE_LEDGER, document.plan, opts.resume);
    const log = journal;
    const service = createAuth({ client: authDb, env: authEnv });
    await enrollInitialOwner({ service, appDb, plan: document.plan, resume: opts.resume,
      checkpoint: async phase => { await log.writeFile(JSON.stringify({ phase }) + '\n'); await log.sync(); },
      deliver: link => writeExclusivePrivateFile(path.join(opts.directory, 'enrollment-link.txt'), link + '\n'),
    });
    return 'ENROLLMENT_LINK_WRITTEN_PRIVATE';
  } finally {
    try {
      await journal?.close();
      if (lockOwned) await unlink(lockPath);
    } finally { await Promise.all([appDb.close(), authDb.close(), proofDb.close()]); }
  }
}
const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  try { console.log(await runInitialOwner(process.argv.slice(2), process.env)); }
  catch { console.error('INITIAL_OWNER_FAILED: inspect the private journal; no automatic retry.'); process.exitCode = 1; }
}
