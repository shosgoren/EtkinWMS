// T-1149/T-1156: 0073 is additive; rollback never silently removes active label grants in a real environment.
import { randomBytes } from "node:crypto";
import pg from "pg";
import { expect,it } from "vitest";
import { migrateUp,migrateDown } from "../../../packages/db/src/migrate.ts";
import { GRANTABLE } from "../../../packages/domain/src/identity/permissions.ts";
import { newRegistry,seedWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";
const env=readIntEnv(process.env);
it("0073 grants match catalogue23; empty down/up works; populated grant rollback refuses without explicit destructive test mode",async()=>{
 const name=`wms_label_grants_${randomBytes(6).toString("hex")}`,base=new pg.Client({connectionString:env.databaseUrlDirect});await base.connect();await base.query(`CREATE DATABASE ${name}`);
 const u=new URL(env.databaseUrlDirect);u.pathname=`/${name}`;const url=u.href,c=new pg.Client({connectionString:url});
 try{
  await c.connect();await migrateUp({url});
  expect((await migrateDown({url,to:"0072",wmsEnv:"staging"})).reverted).toEqual(["0073"]);
  expect((await migrateUp({url})).applied).toEqual(["0073"]);
  const w=await seedWorld(c,newRegistry(),"LABELGRANTS");expect(GRANTABLE).toHaveLength(23);
  await c.query("INSERT INTO public.permission_groups(tenant_id,name,grants,created_by) VALUES($1,'All label grants',$2,$3)",[w.tenantId,[...GRANTABLE],w.ownerMembershipId]);
  await expect(c.query("INSERT INTO public.permission_groups(tenant_id,name,grants,created_by) VALUES($1,'Over limit',$2,$3)",[w.tenantId,Array.from({length:24},()=>"labels.view"),w.ownerMembershipId])).rejects.toMatchObject({code:"23514"});
  await expect(migrateDown({url,to:"0072",wmsEnv:"staging"})).rejects.toThrow(/0073_label_permissions down/);
  expect((await c.query("SELECT version FROM wms_meta.schema_migrations ORDER BY version DESC LIMIT 1")).rows[0]?.version).toBe("0073");
  expect((await c.query("SELECT grants FROM public.permission_groups WHERE tenant_id=$1",[w.tenantId])).rows[0]?.grants).toEqual([...GRANTABLE]);
  expect((await migrateDown({url,to:"0072",wmsEnv:"ci"})).reverted).toEqual(["0073"]);
  expect((await c.query("SELECT grants FROM public.permission_groups WHERE tenant_id=$1",[w.tenantId])).rows[0]?.grants).toEqual(GRANTABLE.filter(g=>!g.startsWith("labels.")));
  await expect(c.query("INSERT INTO public.permission_groups(tenant_id,name,grants,created_by) VALUES($1,'Closed again',ARRAY['labels.design'],$2)",[w.tenantId,w.ownerMembershipId])).rejects.toMatchObject({code:"23514"});
  expect((await c.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public.permission_groups'::regclass")).rows[0]).toEqual({relrowsecurity:true,relforcerowsecurity:true});
  expect((await migrateUp({url})).applied).toEqual(["0073"]);
 }finally{await c.end();try{await base.query(`DROP DATABASE ${name} WITH (FORCE)`);}finally{await base.end();}}
},120000);
