// T-1025: persistent deduplication through the existing worker-only ingestion function.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { readIntEnv, readWorkerDatabaseUrl } from './harness/env.ts';
const env = readIntEnv(process.env);
const prefix = `t1025-${randomUUID()}`;
let admin: pg.Client;
let worker: pg.Pool;
const ingest = async (id: string, email: string, name = 'Synthetic') => (await worker.query<{ ok: boolean }>(
  "SELECT wms_probe.platform_ingest_demo_request($1, now(), $2, 'Synthetic', $3, '', '') AS ok", [id, name, email],
)).rows[0]?.ok;
beforeAll(async () => {
  admin = new pg.Client({ connectionString: env.databaseUrlDirect });
  await admin.connect();
  worker = new pg.Pool({ connectionString: readWorkerDatabaseUrl(process.env), max: 8 });
});
afterAll(async () => { await worker.end(); await admin.end(); });
it('parallel normalized addresses create exactly one record and one reservation', async () => {
  const email = `${prefix}-parallel@example.test`;
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => ingest(randomUUID(), i % 2 ? ` ${email.toUpperCase()} ` : email)));
  expect(results.filter(Boolean)).toHaveLength(1);
  expect((await admin.query('SELECT count(*)::int AS n FROM wms_platform.demo_requests WHERE email=$1', [email])).rows[0].n).toBe(1);
});
it('same request survives reconnection; changed content with same key is rejected', async () => {
  const id = randomUUID(), email = `${prefix}-retry@example.test`;
  expect(await ingest(id, email)).toBe(true);
  await worker.end();
  worker = new pg.Pool({ connectionString: readWorkerDatabaseUrl(process.env), max: 8 });
  expect(await ingest(id, email)).toBe(false);
  await expect(ingest(id, email, 'Changed')).rejects.toMatchObject({ code: '22023' });
});
it('duplicate-email request key also binds its original payload', async () => {
  const email = `${prefix}-key@example.test`, id = randomUUID();
  expect(await ingest(randomUUID(), email)).toBe(true);
  expect(await ingest(id, email)).toBe(false);
  await expect(ingest(id, `${prefix}-different@example.test`)).rejects.toMatchObject({ code: '22023' });
});
it('status does not affect reservations, including approved and activated requests', async () => {
  const user = (await admin.query("INSERT INTO public.users(name,email,email_verified) VALUES ('Synthetic',$1,true) RETURNING id", [`${prefix}-operator@example.test`])).rows[0].id;
  for (const status of ['PENDING', 'REJECTED', 'APPROVED', 'ACTIVATED']) {
    const id = randomUUID(), email = `${prefix}-${status.toLowerCase()}@example.test`;
    expect(await ingest(id, email)).toBe(true);
    if (status !== 'PENDING') await admin.query('UPDATE wms_platform.demo_requests SET status=$2, decided_at=now(), decided_by=$3 WHERE id=$1', [id, status === 'ACTIVATED' ? 'APPROVED' : status, user]);
    if (status === 'ACTIVATED') await admin.query("UPDATE wms_platform.demo_requests SET activation_token_hash=repeat('a',64), activation_delivery='EMAIL', activation_expires_at=now(), activated_at=now(), activation_sample=false WHERE id=$1", [id]);
    expect(await ingest(randomUUID(), ` ${email.toUpperCase()} `)).toBe(false);
  }
});
it('application and auth roles cannot read reservation keys or invoke ingestion', async () => {
  for (const role of ['wms_app', 'wms_auth']) {
    expect((await admin.query("SELECT has_table_privilege($1,'wms_platform.demo_email_reservations','SELECT') AS can_read, has_function_privilege($1,'wms_probe.platform_ingest_demo_request(uuid,timestamptz,text,text,text,text,text)','EXECUTE') AS can_call", [role])).rows[0]).toEqual({ can_read: false, can_call: false });
  }
});
