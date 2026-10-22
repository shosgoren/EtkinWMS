// T-1025: private marketing bridge, durable submission and owner-only status proof.
import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withUser } from '@wms/db';
import { PLATFORM_NO_USER_ID } from '@wms/shared/queue';
import type { Sealer } from '@wms/shared/seal';
import type { AccessDbClient } from '../identity/access.ts';
export const DEMO_SEAL_CONTEXT = { jobType: 'demo.status', template: 'owner-link', tenantId: 'platform' } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const demoTokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');
export interface DemoSubmission { requestId: string; name: string; company: string; email: string; sector: string; message: string; locale: 'tr' | 'en'; legacy?: unknown }
export function parseDemoSubmission(raw: unknown): DemoSubmission | null {
 if (!raw || typeof raw !== 'object') return null;
 const r = raw as Record<string, unknown>;
 const text = (k: string, max: number): string | null => typeof r[k] === 'string' && r[k].length <= max && !r[k].includes('\0') ? r[k].trim() : null;
 const requestId = text('requestId',36), name=text('name',100), company=text('company',150), email=text('email',254), sector=text('sector',100), message=text('message',2000);
 if (!requestId || !UUID.test(requestId) || !name || !company || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || sector===null || message===null) return null;
 return { requestId,name,company,email,sector,message,locale:r.locale==='en'?'en':'tr',legacy:r.legacy??null };
}
export async function submitDemo(db: AccessDbClient, input: DemoSubmission, sealer: Sealer): Promise<boolean> {
 const token = randomBytes(32).toString('base64url');
 const sealed = sealer.seal({ token, email: input.email, locale: input.locale },DEMO_SEAL_CONTEXT);
 return withUser(db,PLATFORM_NO_USER_ID,async tx => {
  const rows=await tx.execute<{ inserted:boolean }>(sql`SELECT wms_probe.demo_submit(${input.requestId}::uuid,${input.name},${input.company},${input.email},${input.sector},${input.message},${demoTokenHash(token)},${JSON.stringify(sealed)}::jsonb,${JSON.stringify(input.legacy??null)}::jsonb) AS inserted`);
  return rows[0]?.inserted===true;
 });
}
export type DemoOwnerStatus = 'invalid'|'pending'|'setup'|'ready'|'in_progress';
export async function consumeDemoStatus(db: AccessDbClient, raw: unknown): Promise<{ status: DemoOwnerStatus; activationToken?: string }> {
 if (typeof raw!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return {status:'invalid'};
 const activationToken=randomBytes(32).toString('base64url');
 const rows=await withUser(db,PLATFORM_NO_USER_ID,tx=>tx.execute<{status:DemoOwnerStatus}>(sql`SELECT wms_probe.demo_status_consume(${demoTokenHash(raw)},${demoTokenHash(activationToken)}) AS status`));
 const status=rows[0]?.status??'invalid';
 return {status,...(status==='setup'?{activationToken}:{})};
}
export async function claimDemoMail(db: AccessDbClient): Promise<readonly {id:string;sealed:unknown}[]> {
 return withUser(db,PLATFORM_NO_USER_ID,tx=>tx.execute<{id:string;sealed:unknown}>(sql`SELECT id,sealed FROM wms_probe.demo_delivery_claim()`));
}
export async function finishDemoMail(db: AccessDbClient,id:string): Promise<void> {
 await withUser(db,PLATFORM_NO_USER_ID,tx=>tx.execute(sql`SELECT wms_probe.demo_delivery_finish(${id}::uuid)`));
}

// PostgreSQL is the sole case-folding authority, shared with historical ingestion and panel rows.
export async function normalizeDemoEmails(db: AccessDbClient, raw: unknown): Promise<string[]> {
 if(!Array.isArray(raw)||raw.length>100||!raw.every(v=>typeof v==='string'&&v.length<=254&&!v.includes('\0')))throw new Error('invalid emails');
 const rows=await withUser(db,PLATFORM_NO_USER_ID,tx=>tx.execute<{email:string}>(sql`SELECT lower(btrim(value)) AS email FROM jsonb_array_elements_text(${JSON.stringify(raw)}::jsonb) WITH ORDINALITY AS input(value,n) ORDER BY n`));
 return rows.map(r=>r.email);
}
