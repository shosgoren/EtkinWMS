// katman: db
// T-1148/T-1149: isolated synthetic database; no shared schema rollback or production data.
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { beforeAll, afterAll, expect, it } from "vitest";
import { migrateDown, migrateUp } from "../../../packages/db/src/migrate.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";
import { LABEL_TABLES, seedLabels } from "./fixtures.ts";

const env=readIntEnv(process.env);
let admin: pg.Client, app: pg.Client, scratchAdmin: pg.Client, database: string;
let A: TenantWorld, B: TenantWorld, a: Awaited<ReturnType<typeof seedLabels>>, b: typeof a;
const urlFor=(source:string,name:string)=>{const u=new URL(source);u.pathname=`/${name}`;return u;};
beforeAll(async()=>{
  database=`wms_labels_${randomBytes(6).toString("hex")}`;
  scratchAdmin=new pg.Client({connectionString:env.databaseUrlDirect});await scratchAdmin.connect();await scratchAdmin.query(`CREATE DATABASE ${database}`);
  const url=urlFor(env.databaseUrlDirect,database).href;await migrateUp({url});admin=new pg.Client({connectionString:url});await admin.connect();
  const appUrl=urlFor(env.databaseUrl,database), direct=new URL(env.databaseUrlDirect);appUrl.hostname=direct.hostname;appUrl.port=direct.port;
  app=new pg.Client({connectionString:appUrl.href});await app.connect();
  A=await seedWorld(admin,newRegistry(),"LABELA");B=await seedWorld(admin,newRegistry(),"LABELB");a=await seedLabels(admin,A);b=await seedLabels(admin,B);
},120000);
afterAll(async()=>{await app?.end();await admin?.end();if(scratchAdmin){try{await scratchAdmin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);}finally{await scratchAdmin.end();}}});
async function query(text:string,values:unknown[]=[],tenant:string|null=A.tenantId){
  await app.query("BEGIN");try{if(tenant!==null)await app.query("SELECT set_config('app.current_tenant_id',$1,true)",[tenant]);return await app.query(text,values);}finally{await app.query("ROLLBACK");}
}
it("@AC-04 labels: every new table is FORCE RLS; absent/foreign context reads no rows",async()=>{
 for(const table of LABEL_TABLES){
  const flags=(await admin.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass",[`public.${table}`])).rows[0];
  expect(flags).toEqual({relrowsecurity:true,relforcerowsecurity:true});
  expect((await query(`SELECT tenant_id FROM public.${table}`)).rows).toEqual([{tenant_id:A.tenantId}]);
  expect((await query(`SELECT 1 FROM public.${table} WHERE tenant_id=$1`,[B.tenantId])).rowCount).toBe(0);
  expect((await query(`SELECT 1 FROM public.${table}`,[],null)).rowCount).toBe(0);
 }
});
it("@AC-04 labels: cross-tenant inserts/updates and composite references are rejected",async()=>{
 await expect(query("INSERT INTO public.label_templates (tenant_id,id,name,context,draft,created_by) VALUES($1,$2,'Foreign','PRODUCT','{}',$3)",[B.tenantId,randomUUID(),B.ownerMembershipId])).rejects.toMatchObject({code:"42501"});
 await expect(query("INSERT INTO public.label_defaults (tenant_id,context,template_id,version_id) VALUES($1,'RECEIPT',$2,$3)",[A.tenantId,b.template,b.version])).rejects.toMatchObject({code:"23503"});
 expect((await query("UPDATE public.label_templates SET name='Foreign' WHERE tenant_id=$1",[B.tenantId])).rowCount).toBe(0);
 await expect(query("UPDATE public.label_templates SET published_version_id=$1 WHERE id=$2",[b.version,a.template])).rejects.toMatchObject({code:"23503"});
 await expect(query("UPDATE public.label_preferences SET printer_id=$1 WHERE id=$2",[b.printer,a.preference])).rejects.toMatchObject({code:"23503"});
 await expect(query("UPDATE public.label_defaults SET version_id=$1 WHERE context='PRODUCT'",[b.version])).rejects.toMatchObject({code:"23503"});
});
it("published versions, assets and print jobs cannot mutate; identities/timestamps and DELETE/TRUNCATE are not granted",async()=>{
 for(const [table,column] of [["label_template_versions","design"],["label_assets","png"],["label_print_jobs","snapshot"]])await expect(query(`UPDATE public.${table} SET ${column}=${column}`)).rejects.toMatchObject({code:"42501"});
 for(const table of LABEL_TABLES){
  await expect(query(`DELETE FROM public.${table}`)).rejects.toMatchObject({code:"42501"});
  await expect(query(`TRUNCATE public.${table}`)).rejects.toMatchObject({code:"42501"});
  const grants=(await admin.query("SELECT has_table_privilege('wms_auth',$1,'SELECT') AS auth,has_table_privilege('wms_worker',$1,'SELECT') AS worker",[`public.${table}`])).rows[0];
  expect(grants).toEqual({auth:false,worker:false});
 }
 for(const column of ["tenant_id","id","context","created_by","created_at"])await expect(query(`UPDATE public.label_templates SET ${column}=${column}`)).rejects.toMatchObject({code:"42501"});
});
it("context mismatch, duplicate nullable preferences and unsafe printer destinations fail closed",async()=>{
 await expect(query("INSERT INTO public.label_defaults (tenant_id,context,template_id,version_id) VALUES($1,'RECEIPT',$2,$3)",[A.tenantId,a.template,a.version])).rejects.toMatchObject({code:"23503"});
 await expect(query("INSERT INTO public.label_preferences (tenant_id,template_id,printer_id) VALUES($1,$2,$3)",[A.tenantId,a.template,a.printer])).rejects.toMatchObject({code:"23505"});
 await expect(query("INSERT INTO public.label_printers (tenant_id,name,mode,created_by) VALUES($1,'No raw network','BRIDGE',$2)",[A.tenantId,A.ownerMembershipId])).rejects.toMatchObject({code:"23514"});
 await expect(query("INSERT INTO public.label_preferences (tenant_id,membership_id) VALUES($1,$2)",[A.tenantId,A.ownerMembershipId])).rejects.toMatchObject({code:"23514"});
 await expect(query("INSERT INTO public.label_assets (tenant_id,png,sha256,width,height,created_by) VALUES($1,$2,$3,1025,1,$4)",[A.tenantId,Buffer.alloc(67),"b".repeat(64),A.ownerMembershipId])).rejects.toMatchObject({code:"23514"});
});
it("empty schema down/up is repeatable; populated label downgrade refuses and preserves data",async()=>{
 const name=`wms_label_down_${randomBytes(6).toString("hex")}`,url=urlFor(env.databaseUrlDirect,name).href;
 await scratchAdmin.query(`CREATE DATABASE ${name}`);const c=new pg.Client({connectionString:url});
 try{
  await c.connect();await migrateUp({url});
  expect((await migrateDown({url,to:"0071",wmsEnv:"staging"})).reverted).toEqual(["0072"]);
  expect((await migrateUp({url})).applied).toEqual(["0072"]);
  const w=await seedWorld(c,newRegistry(),"LDOWN");await seedLabels(c,w);
  await expect(migrateDown({url,to:"0071",wmsEnv:"staging"})).rejects.toThrow(/0072_label_editor down/);
  expect((await c.query("SELECT count(*)::int AS n FROM public.label_template_versions")).rows[0]?.n).toBe(1);
  expect((await migrateUp({url})).applied).toEqual([]);
  expect((await migrateDown({url,to:"0071",wmsEnv:"ci"})).reverted).toEqual(["0072"]);
  expect((await migrateUp({url})).applied).toEqual(["0072"]);
 }finally{await c.end();await scratchAdmin.query(`DROP DATABASE ${name} WITH (FORCE)`);}
},120000);

it("published-version back-reference is immediate by default and explicitly deferrable for safe maintenance ordering",async()=>{
 const flags=(await admin.query("SELECT condeferrable,condeferred FROM pg_constraint WHERE conname='label_templates_published_fk' AND conrelid='public.label_templates'::regclass")).rows[0];
 expect(flags).toEqual({condeferrable:true,condeferred:false});
 await admin.query("BEGIN");
 try{
  await admin.query("SET CONSTRAINTS ALL DEFERRED");
  for(const table of ["label_print_jobs","label_defaults","label_preferences","label_template_versions","label_templates"]){await admin.query(`DELETE FROM public.${table} WHERE tenant_id=$1`,[A.tenantId]);expect((await admin.query(`SELECT 1 FROM public.${table} WHERE tenant_id=$1`,[A.tenantId])).rowCount).toBe(0);}
  await admin.query("SET CONSTRAINTS ALL IMMEDIATE");
  expect((await admin.query("SELECT 1 FROM public.label_templates WHERE tenant_id=$1",[B.tenantId])).rowCount).toBe(1);
 }finally{await admin.query("ROLLBACK");}
 expect((await admin.query("SELECT 1 FROM public.label_template_versions WHERE tenant_id=$1",[A.tenantId])).rowCount).toBe(1);
});
