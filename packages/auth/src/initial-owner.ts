// T-909 offline orchestration; no HTTP endpoint, no signup policy changes.
import { sql } from 'drizzle-orm';
import { appendAudit, withNewTenant, createDbClient, type DbClient } from '@wms/db';
import { rawDb } from '@wms/db/internal';
import { initialOwnerAuthPort, type AuthService } from './index.ts';

export interface InitialOwnerPlan {
  userId: string; requestId: string; email: string; userName: string;
  slug: string; tenantName: string; operator: string;
}
export interface InitialOwnerTarget { appHost: string; authHost: string; database: string; baseUrl: string; proofHost?: string; proofRole?: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateInitialOwnerPlan(plan: InitialOwnerPlan): void {
  if (!UUID.test(plan.userId) || !UUID.test(plan.requestId) || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(plan.slug) || plan.slug === 'demo' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(plan.email) || plan.email !== plan.email.toLowerCase() || plan.email.length > 254 ||
      [plan.userName, plan.tenantName, plan.operator].some(v => typeof v !== 'string' || !v.trim() || v.length > 150 || /[\x00-\x1f\x7f]/.test(v))) throw new Error('INITIAL_OWNER_INPUT');
}
export function validateInitialOwnerTarget(env: Readonly<Record<string, string | undefined>>, target: InitialOwnerTarget): void {
  if (env.AUTH_REQUIRE_EMAIL_VERIFICATION !== 'false' || env.SIGNUP_ENABLED !== 'false' || env.MAIL_MODE !== 'disabled' || !['production', 'staging'].includes(env.WMS_ENV ?? '')) throw new Error('INITIAL_OWNER_ENV');
  try {
    const base = new URL(env.BETTER_AUTH_URL ?? '');
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/' || base.origin !== target.baseUrl) throw new Error();
    for (const [key, role, host] of [['DATABASE_URL', 'wms_app', target.appHost], ['AUTH_DATABASE_URL', 'wms_auth', target.authHost]] as const) {
      const url = new URL(env[key] ?? '');
      if (!url.port || url.hash || [...url.searchParams.keys()].some(key => key !== 'sslmode') || url.searchParams.getAll('sslmode').length !== 1 || url.searchParams.get('sslmode') !== 'verify-full') throw new Error();
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.host !== host || decodeURIComponent(url.pathname.slice(1)) !== target.database || decodeURIComponent(url.username) !== role) throw new Error();
    }
  } catch { throw new Error('INITIAL_OWNER_TARGET'); }
}
/** Read-only metadata, not tenant-wide reads and not a claim that the DB is empty. */
export async function checkInitialOwnerDatabase(client: DbClient, database: string, role: 'wms_app' | 'wms_auth'): Promise<void> {
  const rows = await rawDb(client).execute<{ db: string; role: string; privileged: boolean; version: number }>(sql`SELECT current_database() AS db, current_user AS role, current_setting('server_version_num')::int AS version, (rolsuper OR rolbypassrls) AS privileged FROM pg_roles WHERE rolname = current_user`);
  if (rows.length !== 1 || rows[0]?.db !== database || rows[0].role !== role || rows[0].privileged !== false || rows[0].version < 180000 || rows[0].version >= 190000) throw new Error('INITIAL_OWNER_DATABASE');
}
/** Auth user and tenant are separate transactions. Checkpoints never contain reset secrets. */
export async function enrollInitialOwner(input: {
  service: AuthService; appDb: DbClient; plan: InitialOwnerPlan; resume: boolean;
  checkpoint(phase: 'user-ready' | 'tenant-ready' | 'token-started' | 'complete'): Promise<void>;
  deliver(link: string): Promise<void>;
}): Promise<{ userId: string; tenantId: string }> {
  const { plan } = input;
  validateInitialOwnerPlan(plan);
  const auth = initialOwnerAuthPort(input.service);
  if (new URL(auth.baseUrl).protocol !== 'https:') throw new Error('INITIAL_OWNER_HTTPS');
  await auth.prepareUser({ userId: plan.userId, email: plan.email, name: plan.userName, resume: input.resume });
  await input.checkpoint('user-ready');
  const tenantId = await withNewTenant(input.appDb, { userId: plan.userId, slug: plan.slug, name: plan.tenantName, creationRequestId: plan.requestId }, async (tx, owner) => {
    if (!owner.created && !input.resume) throw new Error('INITIAL_OWNER_EXISTS');
    if (owner.created) {
      await tx.execute(sql`INSERT INTO public.tenant_settings (tenant_id, locale, time_zone, sector_template_key, sector_template_version, terminology, onboarding_status, onboarding_steps)
        VALUES (${owner.tenantId}::uuid, 'tr', 'Europe/Istanbul', 'GENERIC', 1, '{"unit.carton":"Koli","location.zone":"Bölge","location.rack":"Raf","location.bin":"Lokasyon"}'::jsonb, 'IN_PROGRESS', '[{"key":"settings.applied","status":"PENDING"},{"key":"terminology.applied","status":"PENDING"}]'::jsonb)`);
      await appendAudit(tx, { action: 'tenant.created', actorUserId: null, entityType: 'tenant', entityId: owner.tenantId, requestId: plan.requestId,
        reason: 'Offline operator initial owner enrollment', changeSummary: { operator: plan.operator, source: 'operator-cli', enrollmentUser: plan.userId, slug: plan.slug } });
    }
    return owner.tenantId;
  });
  await input.checkpoint('tenant-ready');
  // Resume cannot pass this point again: a crash may leave a valid, undelivered token until expiry.
  await input.checkpoint('token-started');
  const issued = await auth.issueToken(plan.userId);
  try {
    await input.deliver(`${new URL(auth.baseUrl).origin}/reset-password?token=${issued.token}`);
    await input.checkpoint('complete');
  } catch {
    await auth.revokeToken(issued.verificationId);
    throw new Error('INITIAL_OWNER_DELIVERY_FAILED');
  }
  return { userId: plan.userId, tenantId };
}

export interface InitialOwnerMigration { version: string; name: string; checksum_sha256: string }
/** Existing operator connection: fixed read-only queries only. No grants, RLS switches or mutation. */
export async function checkInitialOwnerProof(client: DbClient, target: InitialOwnerTarget, expected: readonly InitialOwnerMigration[], plan: InitialOwnerPlan, resume: boolean): Promise<void> {
  // Kaynak defteri 0001'den ardışık olmalı (sayı sabit değil); hedef DB defteri aşağıda sürüm/ad/checksum ile birebir eşleşir.
  if (!target.proofHost || !target.proofRole || expected.length === 0 || expected.some((m, i) => m.version !== String(i + 1).padStart(4, '0') || !/^[0-9a-f]{64}$/.test(m.checksum_sha256))) throw new Error('INITIAL_OWNER_SCHEMA_PROOF_REQUIRED');
  await rawDb(client).transaction(async tx => {
    const meta = await tx.execute<{ db: string; role: string; version: number }>(sql`SELECT current_database() AS db, current_user AS role, current_setting('server_version_num')::int AS version`);
    if (meta[0]?.db !== target.database || meta[0].role !== target.proofRole || meta[0].version < 180000 || meta[0].version >= 190000) throw new Error('INITIAL_OWNER_PROOF_TARGET');
    const ledger = await tx.execute<{ version: string; name: string; checksum_sha256: string }>(sql`SELECT version, name, checksum_sha256 FROM wms_meta.schema_migrations ORDER BY version`);
    if (ledger.length !== expected.length || ledger.some((m, i) => m.version !== expected[i]?.version || m.name !== expected[i]?.name || m.checksum_sha256 !== expected[i]?.checksum_sha256)) throw new Error('INITIAL_OWNER_SCHEMA_MISMATCH');
    // Table visibility privilege is required; an RLS-filtered "empty" result is not a preflight proof.
    const privilege = await tx.execute<{ bypass: boolean }>(sql`SELECT (rolsuper OR rolbypassrls) AS bypass FROM pg_roles WHERE rolname = current_user`);
    if (privilege[0]?.bypass !== true) throw new Error('INITIAL_OWNER_PROOF_VISIBILITY');
    const users = await tx.execute<{ id: string; email: string }>(sql`SELECT id, email FROM public.users WHERE email = ${plan.email} OR id = ${plan.userId}::uuid`);
    if (users.length && (!resume || users.length !== 1 || users[0]?.id !== plan.userId || users[0].email !== plan.email)) throw new Error('INITIAL_OWNER_EXISTS');
    const memberships = await tx.execute<{ valid: boolean }>(sql`SELECT (m.is_owner AND m.status = 'ACTIVE' AND t.slug = ${plan.slug} AND t.created_by_user_id = ${plan.userId}::uuid AND t.creation_request_id = ${plan.requestId}::uuid) AS valid FROM public.tenant_memberships m JOIN public.tenants t ON t.id = m.tenant_id WHERE m.user_id = ${plan.userId}::uuid`);
    if (memberships.length > 1 || memberships.some(m => !m.valid)) throw new Error('INITIAL_OWNER_EXISTS');
    const tenants = await tx.execute<{ created_by_user_id: string; creation_request_id: string; name: string }>(sql`SELECT created_by_user_id, creation_request_id, name FROM public.tenants WHERE slug = ${plan.slug}`);
    if (tenants.length && (!resume || tenants.length !== 1 || tenants[0]?.created_by_user_id !== plan.userId || tenants[0].creation_request_id !== plan.requestId || tenants[0].name !== plan.tenantName)) throw new Error('INITIAL_OWNER_EXISTS');
  }, { accessMode: 'read only' });
}
export function validateInitialOwnerProofUrl(urlText: string | undefined, target: InitialOwnerTarget): string {
  try {
    const url = new URL(urlText ?? '');
    if (!target.proofHost || !target.proofRole || !url.port || !['postgres:', 'postgresql:'].includes(url.protocol) || url.host !== target.proofHost || decodeURIComponent(url.username) !== target.proofRole || decodeURIComponent(url.pathname.slice(1)) !== target.database || url.hash || [...url.searchParams.keys()].some(k => k !== 'sslmode') || url.searchParams.getAll('sslmode').length !== 1 || url.searchParams.get('sslmode') !== 'verify-full') throw new Error();
    return url.toString();
  } catch { throw new Error('INITIAL_OWNER_PROOF_TARGET'); }
}

export function createInitialOwnerClients(urls: { databaseUrl: string; authDatabaseUrl: string; proofUrl: string }) {
  return {
    appDb: createDbClient({ url: urls.databaseUrl, poolMax: 1, prepare: false }),
    authDb: createDbClient({ url: urls.authDatabaseUrl, poolMax: 1, prepare: false }),
    proofDb: createDbClient({ url: urls.proofUrl, poolMax: 1, prepare: false }),
  };
}
