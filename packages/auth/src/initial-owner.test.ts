import { describe, expect, it, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
const mocks = vi.hoisted(() => ({ prepareUser: vi.fn(), issueToken: vi.fn(), revokeToken: vi.fn(), audit: vi.fn(), execute: vi.fn(), created: true, metadata: vi.fn() }));
vi.mock('./index.ts', () => ({ initialOwnerAuthPort: () => ({ baseUrl: 'https://wms.example.invalid', ...mocks }) }));
vi.mock('@wms/db', () => ({ appendAudit: mocks.audit, withNewTenant: async (_db: unknown, _params: unknown, fn: (tx: unknown, owner: unknown) => unknown) => fn({ execute: mocks.execute }, { created: mocks.created, tenantId: 'tenant-test' }) }));
vi.mock('@wms/db/internal', () => ({ rawDb: () => ({ execute: mocks.metadata }) }));
import { checkInitialOwnerDatabase, enrollInitialOwner, validateInitialOwnerPlan, validateInitialOwnerTarget } from './initial-owner.ts';
import type { AuthService } from './index.ts';
import type { DbClient } from '@wms/db';
const plan = { userId: randomUUID(), requestId: randomUUID(), email: 'owner@example.invalid', userName: 'Owner', slug: 'example', tenantName: 'Example', operator: 'operator-test' };
const target = { appHost: 'db.invalid:5432', authHost: 'db.invalid:5432', database: 'synthetic', baseUrl: 'https://wms.example.invalid' };
const env = { WMS_ENV: 'production', MAIL_MODE: 'disabled', SIGNUP_ENABLED: 'false', AUTH_REQUIRE_EMAIL_VERIFICATION: 'false', BETTER_AUTH_URL: target.baseUrl,
  DATABASE_URL: 'postgres://wms_app@db.invalid:5432/synthetic?sslmode=verify-full', AUTH_DATABASE_URL: 'postgres://wms_auth@db.invalid:5432/synthetic?sslmode=verify-full' };
beforeEach(() => { vi.clearAllMocks(); mocks.created = true; mocks.issueToken.mockResolvedValue({ token: 'synthetic', verificationId: 'verification-test' }); });
describe('initial owner offline enrollment', () => {
  it('requires explicit disabled verification/signup/mail and exact pinned target', () => {
    expect(() => validateInitialOwnerTarget(env, target)).not.toThrow();
    for (const change of [{ AUTH_REQUIRE_EMAIL_VERIFICATION: undefined }, { SIGNUP_ENABLED: 'true' }, { MAIL_MODE: 'smtp' }, { WMS_ENV: 'local' }, { DATABASE_URL: 'postgres://wms_app@other.invalid/synthetic' }]) {
      expect(() => validateInitialOwnerTarget({ ...env, ...change }, target)).toThrow();
    }
  });
  it('rejects invalid identity, demo slug and control characters', () => {
    for (const change of [{ userId: 'bad' }, { slug: 'demo' }, { email: 'Owner@example.invalid' }, { operator: 'operator\n' }]) expect(() => validateInitialOwnerPlan({ ...plan, ...change })).toThrow();
  });
  it('records operator audit without pretending the new user performed the action', async () => {
    const phases: string[] = []; const deliver = vi.fn();
    const result = await enrollInitialOwner({ service: {} as AuthService, appDb: {} as DbClient, plan, resume: false, checkpoint: async phase => { phases.push(phase); }, deliver });
    expect(result.userId).toBe(plan.userId);
    expect(phases).toEqual(['user-ready', 'tenant-ready', 'token-started', 'complete']);
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actorUserId: null, reason: 'Offline operator initial owner enrollment' }));
    expect(deliver).toHaveBeenCalledOnce();
  });
  it('does not issue a token when durable pre-token checkpoint fails', async () => {
    await expect(enrollInitialOwner({ service: {} as AuthService, appDb: {} as DbClient, plan, resume: false, checkpoint: async () => { throw new Error('disk'); }, deliver: vi.fn() })).rejects.toThrow();
    expect(mocks.issueToken).not.toHaveBeenCalled();
  });
  it.each(['delivery', 'journal'])('revokes token on %s failure', async (phase) => {
    await expect(enrollInitialOwner({ service: {} as AuthService, appDb: {} as DbClient, plan, resume: false,
      checkpoint: async value => { if (phase === 'journal' && value === 'complete') throw new Error('disk'); },
      deliver: async () => { if (phase === 'delivery') throw new Error('disk'); },
    })).rejects.toThrow('INITIAL_OWNER_DELIVERY_FAILED');
    expect(mocks.revokeToken).toHaveBeenCalledWith('verification-test');
  });
});

it('rejects a different PostgreSQL major before accepting database metadata', async () => {
  for (const version of [170000, 190000]) {
    mocks.metadata.mockResolvedValue([{ db: 'synthetic', role: 'wms_app', privileged: false, version }]);
    await expect(checkInitialOwnerDatabase({} as DbClient, 'synthetic', 'wms_app')).rejects.toThrow('INITIAL_OWNER_DATABASE');
  }
  mocks.metadata.mockResolvedValue([{ db: 'synthetic', role: 'wms_app', privileged: false, version: 180006 }]);
  await expect(checkInitialOwnerDatabase({} as DbClient, 'synthetic', 'wms_app')).resolves.toBeUndefined();
});
