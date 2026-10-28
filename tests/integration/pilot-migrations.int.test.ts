import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { expect, it } from "vitest";
import { createDbClient } from "../../packages/db/src/index.ts";
import { migrateUp, migrateDown, MIGRATIONS_DIR } from "../../packages/db/src/migrate.ts";
import { createProductionRecipe, transferBetweenWarehouses } from "../../packages/domain/src/operations/index.ts";
import { listStockOverview } from "../../packages/domain/src/stock/index.ts";
import { createWarehouse, createLocation } from "../../packages/domain/src/warehouse/index.ts";
import { newRegistry, seedWorld } from "./fixtures/tenants.ts";
import { readIntEnv } from "./harness/env.ts";

const env = readIntEnv(process.env);
function database(url: string, name: string) { const u = new URL(url); u.pathname = `/${name}`; return u.toString(); }
function applicationDatabase(name: string) {
  // The local pooler maps its configured database only; keep application credentials on the direct scratch endpoint.
  const u = new URL(database(env.databaseUrl, name)), direct = new URL(env.databaseUrlDirect);
  u.hostname = direct.hostname; u.port = direct.port; return u.toString();
}
async function scratch(run: (url: string, adm: pg.Client, name: string) => Promise<void>) {
  const name = `wms_pilot_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: env.databaseUrlDirect }); await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const url = database(env.databaseUrlDirect, name), adm = new pg.Client({ connectionString: url });
  try { await adm.connect(); await migrateUp({ url }); await run(url, adm, name); }
  finally { await adm.end(); await admin.query(`DROP DATABASE ${name} WITH (FORCE)`); await admin.end(); }
}
async function versions(adm: pg.Client) { return (await adm.query<{version: string}>("SELECT version FROM wms_meta.schema_migrations ORDER BY version DESC LIMIT 3")).rows.map(r => r.version); }

it("pilot migrations go 37 → 27 → 37 on an empty scratch database", async () => {
  await scratch(async (url, adm) => {
    expect(await versions(adm)).toEqual(["0064", "0063", "0062"]);
    expect((await migrateDown({url, to:"0027", wmsEnv:"staging"})).reverted).toEqual(["0064", "0063", "0062", "0061", "0060", "0059", "0058", "0057", "0056", "0055", "0054", "0053", "0052", "0051", "0050", "0049", "0048", "0047", "0046", "0045", "0044", "0043", "0042", "0041", "0040", "0039", "0038", "0037", "0036", "0035", "0034", "0033", "0032", "0031", "0030", "0029", "0028"]);
    expect((await adm.query("SELECT to_regclass('public.stock_document_links') AS links, to_regclass('public.production_recipes') AS recipes")).rows[0]).toEqual({links:null, recipes:null});
    expect((await migrateUp({url})).applied).toEqual(["0028", "0029", "0030", "0031", "0032", "0033", "0034", "0035", "0036", "0037", "0038","0039","0040","0041","0042","0043","0044","0045","0046","0047","0048","0049","0050","0051","0052","0053","0054", "0055", "0056", "0057","0058", "0059", "0060", "0061", "0062", "0063", "0064"]);
    expect((await migrateUp({url})).applied).toEqual([]);
    expect((await adm.query("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='production_recipe_lines_insert_guard'")).rows[0]?.n).toBe(1);
  });
}, 120000);

it("linked transfer history blocks downgrade without changing stock or losing links", async () => {
  await scratch(async (url, adm, name) => {
    const world = await seedWorld(adm, newRegistry(), "PILOTROLLBACK");
    const app = createDbClient({url:applicationDatabase(name),poolMax:2,prepare:false});
    const params = {db:app, principal:{userId:world.ownerUserId,mfaVerified:true}, tenantSlug:world.slug};
    try {
      const warehouseId = (await createWarehouse(params,{code:"DST",name:"Target"})).warehouseId;
      const target = (await createLocation(params,{warehouseId,code:"R1",name:"Shelf",kind:"STORAGE"})).locationId;
      await transferBetweenWarehouses({...params,clientKey:randomUUID()},{sourceLocationId:world.rootLocationId,targetLocationId:target,itemId:world.itemNoneId,quantity:"1",reason:"Synthetic rollback test"});
      const before = await listStockOverview(params);
      await expect(migrateDown({url,to:"0027",wmsEnv:"staging"})).rejects.toThrow(/linked stock history exists/);
      expect(await listStockOverview(params)).toEqual(before);
      expect((await adm.query("SELECT count(*)::int AS n FROM public.stock_document_links")).rows[0]?.n).toBe(1);
      expect((await versions(adm))[0]).toBe("0028");
      expect((await migrateUp({url})).applied).toEqual(["0029","0030","0031","0032","0033","0034","0035","0036","0037","0038","0039","0040","0041","0042","0043","0044","0045","0046","0047","0048","0049","0050","0051","0052","0053","0054", "0055", "0056", "0057","0058", "0059", "0060", "0061", "0062", "0063", "0064"]);
      expect(await listStockOverview(params)).toEqual(before);
    } finally { await app.close(); }
  });
}, 120000);

it("saved recipes block removal of the seal and recipe schema, preserving definitions", async () => {
  await scratch(async (url, adm, name) => {
    const world = await seedWorld(adm,newRegistry(),"PILOTRECIPE");
    const output = randomUUID();
    await adm.query("INSERT INTO public.items(tenant_id,id,code,name,base_unit_id,tracking_mode,quantity_scale) VALUES($1,$2,'OUTPUT','Output',$3,'NONE',0)",[world.tenantId,output,world.unitId]);
    const app = createDbClient({url:applicationDatabase(name),poolMax:2,prepare:false});
    try {
      await createProductionRecipe({db:app,principal:{userId:world.ownerUserId,mfaVerified:true},tenantSlug:world.slug,clientKey:randomUUID()},{code:"SAFE",version:1,name:"Saved",outputItemId:output,outputQuantity:"1",lines:[{itemId:world.itemNoneId,quantity:"1"}]});
      await expect(migrateDown({url,to:"0029",wmsEnv:"staging"})).rejects.toThrow(/removing the seal would weaken/);
      expect(await versions(adm)).toEqual(["0030","0029","0028"]);
      // Exercise the next down guard in its own rolled-back transaction; never remove the seal to reach it.
      await adm.query("BEGIN");
      try { await expect(adm.query(readFileSync(`${MIGRATIONS_DIR}/0029_production_recipes.down.sql`,"utf8"))).rejects.toThrow(/recipes exist/); }
      finally { await adm.query("ROLLBACK"); }
      expect((await adm.query("SELECT count(*)::int AS n FROM public.production_recipes")).rows[0]?.n).toBe(1);
      expect((await adm.query("SELECT count(*)::int AS n FROM public.production_recipe_lines")).rows[0]?.n).toBe(1);
      // 0031 (kart türü/birimler) mühürden bağımsızdır: geri alınır, 0030 mührü kalır; ileri alma 0031–0037 sürümlerini uygular.
      expect((await migrateUp({url})).applied).toEqual(["0031","0032","0033","0034","0035","0036","0037","0038","0039","0040","0041","0042","0043","0044","0045","0046","0047","0048","0049","0050","0051","0052","0053","0054", "0055", "0056", "0057","0058", "0059", "0060", "0061", "0062", "0063", "0064"]);
    } finally { await app.close(); }
  });
}, 120000);


it("0064 refuses rollback when retired source identity history exists",async()=>{
 await scratch(async(url,adm)=>{
  const w=await seedWorld(adm,newRegistry(),'RECREATE-DOWN');
  await adm.query("INSERT INTO external_refs(tenant_id,system,entity_type,entity_id,external_id) VALUES($1,'PARASUT','ITEM',$2,'710')",[w.tenantId,w.itemNoneId]);
  await adm.query("UPDATE items SET source_state='DELETED',source_disposition='REMOVED',source_managed_archive=true,status='ARCHIVED',archived_at=clock_timestamp() WHERE id=$1",[w.itemNoneId]);
  await adm.query("UPDATE external_refs SET external_id='711' WHERE tenant_id=$1 AND entity_id=$2 AND system='PARASUT'",[w.tenantId,w.itemNoneId]);
  await expect(migrateDown({url,to:'0063',wmsEnv:'staging'})).rejects.toThrow(/identity history exists/);
  expect((await adm.query("SELECT external_id,retired_external_ids FROM external_refs WHERE entity_id=$1 AND system='PARASUT'",[w.itemNoneId])).rows[0]).toEqual({external_id:'711',retired_external_ids:['710']});
 });
},120000);

it('0064 non-super/non-BYPASS owner can create and run the narrow tenant command under FORCE RLS',async()=>{
 const role='recreate_owner_'+randomBytes(6).toString('hex'),control=new pg.Client({connectionString:env.databaseUrlDirect});await control.connect();
 await control.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
 try{
  await scratch(async(url,adm,name)=>{
   const a=await seedWorld(adm,newRegistry(),'RECREATE-NONSUPER-A'),b=await seedWorld(adm,newRegistry(),'RECREATE-NONSUPER-B');
   await migrateDown({url,to:'0063',wmsEnv:'staging'});
   const id=randomUUID();
   await adm.query("INSERT INTO external_refs(tenant_id,id,system,entity_type,entity_id,external_id) VALUES($1,$2,'PARASUT','ITEM',$3,'721')",[a.tenantId,id,a.itemNoneId]);
   await adm.query("UPDATE items SET source_state='DELETED',source_disposition='REMOVED',source_managed_archive=true,status='ARCHIVED',archived_at=clock_timestamp() WHERE id=$1",[a.itemNoneId]);
   await adm.query(`GRANT USAGE,CREATE ON SCHEMA public TO ${role}`);
   await adm.query(`GRANT SELECT ON public.items TO ${role}`);await adm.query(`GRANT UPDATE(id) ON public.items TO ${role}`);
   await adm.query(`ALTER TABLE public.external_refs OWNER TO ${role}`);
   await adm.query('BEGIN');await adm.query(`SET LOCAL ROLE ${role}`);
   await adm.query(readFileSync(`${MIGRATIONS_DIR}/0064_product_recreate.up.sql`,'utf8'));await adm.query('COMMIT');
   const owner=(await adm.query(`SELECT r.rolsuper,r.rolbypassrls,c.relforcerowsecurity FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner JOIN pg_class c ON c.oid='external_refs'::regclass WHERE p.oid='replace_deleted_product_identity(uuid,integer,text)'::regprocedure`)).rows[0];
   expect(owner).toEqual({rolsuper:false,rolbypassrls:false,relforcerowsecurity:true});
   const client=new pg.Client({connectionString:applicationDatabase(name)});await client.connect();
   try{
    await expect(client.query('SELECT replace_deleted_product_identity($1,1,$2)',[id,'722'])).rejects.toMatchObject({code:'42501'});
    await client.query('BEGIN');await client.query("SELECT set_config('app.current_tenant_id',$1,true)",[b.tenantId]);
    expect((await client.query('SELECT replace_deleted_product_identity($1,1,$2) ok',[id,'722'])).rows[0]).toEqual({ok:false});await client.query('COMMIT');
    await client.query('BEGIN');await client.query("SELECT set_config('app.current_tenant_id',$1,true)",[a.tenantId]);
    expect((await client.query('SELECT replace_deleted_product_identity($1,1,$2) ok',[id,'722'])).rows[0]).toEqual({ok:true});await client.query('COMMIT');
    expect((await adm.query('SELECT external_id,retired_external_ids FROM external_refs WHERE id=$1',[id])).rows[0]).toEqual({external_id:'722',retired_external_ids:['721']});
   }finally{await client.end();}
  });
 }finally{await control.query(`DROP ROLE ${role}`);await control.end();}
},120000);
