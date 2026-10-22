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

it('owner links are queued once, rate limited, single-use, expiring and cannot approve a request', async () => {
  const email=`${prefix}-owner@example.test`, id=randomUUID(), hash='b'.repeat(64), nextHash='c'.repeat(64);
  const submit=async(requestId:string,tokenHash:string)=>{
    const c=new pg.Client({connectionString:env.databaseUrl});await c.connect();
    try{return (await c.query<{inserted:boolean}>("SELECT wms_probe.demo_submit($1,'Synthetic','Synthetic',$2,'','',$3,'{}'::jsonb,NULL) AS inserted",[requestId,email,tokenHash])).rows[0]?.inserted;}finally{await c.end();}
  };
  expect(await submit(id,hash)).toBe(true);
  expect(await submit(id,hash)).toBe(false);
  expect(await submit(randomUUID(),nextHash)).toBe(false);
  expect((await admin.query('SELECT count(*)::int AS n FROM wms_platform.demo_status_deliveries WHERE email=$1',[email])).rows[0].n).toBe(1);
  const c=new pg.Client({connectionString:env.databaseUrl});await c.connect();
  try{
    const consume=async(h:string)=>(await c.query<{status:string}>('SELECT wms_probe.demo_status_consume($1,$2) AS status',[h,'d'.repeat(64)])).rows[0]?.status;
    // Provider may deliver before finish is committed; token possession is the proof.
    expect(await consume(hash)).toBe('pending');
    expect(await consume(hash)).toBe('invalid');
    expect((await admin.query('SELECT status FROM wms_platform.demo_requests WHERE id=$1',[id])).rows[0].status).toBe('PENDING');
    expect(await consume(nextHash)).toBe('invalid');
    await admin.query("UPDATE wms_platform.demo_status_deliveries SET consumed_at=NULL,expires_at=now()-interval '1 second' WHERE id=$1",[id]);
    expect(await consume(hash)).toBe('invalid');
  }finally{await c.end();}
});

it('verified setup survives stale delivery; approved, ready and legacy Unicode statuses stay private until proof',async()=>{
  const user=(await admin.query("INSERT INTO public.users(name,email,email_verified) VALUES ('Synthetic',$1,true) RETURNING id",[`${prefix}-owner-admin@example.test`])).rows[0].id;
  for(const state of ['APPROVED','READY','IN_PROGRESS']){
    const id=randomUUID(),email=`${prefix}-${state.toLowerCase()}-link@example.test`,hash=randomUUID().replaceAll('-','').repeat(2),activationHash=randomUUID().replaceAll('-','').repeat(2);
    await ingest(id,email);
    await admin.query("UPDATE wms_platform.demo_requests SET status='APPROVED',decided_at=now(),decided_by=$2,activation_token_hash=$3,activation_delivery='EMAIL',activation_expires_at=now()+interval '1 hour' WHERE id=$1",[id,user,randomUUID().replaceAll('-','').repeat(2)]);
    if(state==='READY')await admin.query('UPDATE wms_platform.demo_requests SET activated_at=now(),activation_sample=false WHERE id=$1',[id]);
    if(state==='IN_PROGRESS')await admin.query("UPDATE wms_platform.demo_requests SET activation_claim_id=$2,activation_claim_expires_at=now()+interval '5 minutes' WHERE id=$1",[id,randomUUID()]);
    await admin.query("INSERT INTO wms_platform.demo_status_deliveries(id,email,token_hash,sealed) VALUES($1,$2,$3,'{}')",[randomUUID(),email,hash]);
    const c=new pg.Client({connectionString:env.databaseUrl});await c.connect();
    try{
      const result=(await c.query('SELECT wms_probe.demo_status_consume($1,$2) AS status',[hash,activationHash])).rows[0].status;
      expect(result).toBe(state==='APPROVED'?'setup':state==='READY'?'ready':'in_progress');
      if(state==='APPROVED'){
        expect((await worker.query('SELECT * FROM wms_probe.platform_prepare_activation_delivery($1,$2)',[id,'e'.repeat(64)])).rows).toHaveLength(0);
        expect((await admin.query('SELECT activation_token_hash FROM wms_platform.demo_requests WHERE id=$1',[id])).rows[0].activation_token_hash).toBe(activationHash);
      }
    }finally{await c.end();}
  }
});
it('PostgreSQL normalization is authoritative for Unicode historical ingestion and new submission',async()=>{
 const email=`İ-${prefix}@EXAMPLE.TEST`,id=randomUUID();
 expect(await ingest(id,email)).toBe(true);
 const normalized=(await admin.query('SELECT lower(btrim($1::text)) AS email',[email])).rows[0].email;
 const c=new pg.Client({connectionString:env.databaseUrl});await c.connect();
 try{
  expect((await c.query("SELECT wms_probe.demo_submit($1,'Synthetic','Synthetic',$2,'','',$3,'{}',NULL) AS inserted",[randomUUID(),normalized,randomUUID().replaceAll('-','').repeat(2)])).rows[0].inserted).toBe(false);
  expect((await admin.query('SELECT count(*)::int AS n FROM wms_platform.demo_requests WHERE email=$1',[normalized])).rows[0].n).toBe(1);
 }finally{await c.end();}
});
