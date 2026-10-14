import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateDown, migrateUp } from "../../../packages/db/src/migrate.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv, redactErrorChain, secretUrls } from "../harness/env.ts";

const env=readIntEnv(process.env), name=`wms_movements_${randomBytes(6).toString("hex")}`;
const admin=new pg.Client({connectionString:env.databaseUrlDirect});
let migration:pg.Client, app:pg.Client, world:TenantWorld, other:TenantWorld, direct:string, appUrl:string;
let kg:string;
const urlFor=(raw:string)=>{const u=new URL(raw);u.pathname=`/${name}`;return u.toString();};
interface Package {receipt:string;receiptLine:string;document:string;line:string;hu:string;dimension:string}
interface Step {document:string;line:string;dimension:string;sequence:number;target:string;status:string}
async function begin(c:pg.Client=app,tenant=world.tenantId,rr=false){await c.query(rr?"BEGIN ISOLATION LEVEL REPEATABLE READ":"BEGIN");await c.query("SELECT set_config('app.current_tenant_id',$1,true)",[tenant]);}
async function flush(c:pg.Client=app){await c.query("SET CONSTRAINTS ALL IMMEDIATE");}
async function tx(run:()=>Promise<void>){await begin();try{await run();}finally{await app.query("ROLLBACK");}}
async function origin(c:pg.Client=app,status="QUARANTINE"):Promise<Package>{
 const p={receipt:randomUUID(),receiptLine:randomUUID(),document:randomUUID(),line:randomUUID(),hu:randomUUID(),dimension:randomUUID()};const t=world.tenantId;
 await c.query("INSERT INTO public.handling_units(tenant_id,id,kind,code,package_receipt_id) VALUES($1,$2,'VARIL',$4,$3)",[t,p.hu,p.receipt,p.hu]);
 await c.query("INSERT INTO public.inbound_receipts(tenant_id,id,warehouse_id,number,created_by,package_document_id) VALUES($1,$2,$3,$6,$4,$5)",[t,p.receipt,world.warehouseId,world.ownerUserId,p.document,p.receipt]);
 await c.query("INSERT INTO public.documents(tenant_id,id,kind,type_version_id,warehouse_id,business_date,created_by,source_kind,source_id) SELECT $1,$2,'STOCK_IN',id,$3,'2026-10-14',$4,'INBOUND_RECEIPT',$5 FROM public.document_type_versions WHERE tenant_id IS NULL AND key='STOCK_IN' AND version=1",[t,p.document,world.warehouseId,world.ownerUserId,p.receipt]);
 await c.query("INSERT INTO public.inbound_receipt_lines(tenant_id,id,receipt_id,line_no,item_id,unit_id,conversion_factor,expected_quantity) VALUES($1,$2,$3,1,$4,$5,1,200)",[t,p.receiptLine,p.receipt,world.itemNoneId,kg]);
 await c.query("INSERT INTO public.document_lines(tenant_id,id,document_id,line_no,item_id,unit_id,quantity,conversion_factor,base_quantity,target_location_id,handling_unit_id,source_line_id,stock_status) VALUES($1,$2,$3,1,$4,$5,200,1,200,$6,$7,$8,$9)",[t,p.line,p.document,world.itemNoneId,kg,world.rootLocationId,p.hu,p.receiptLine,status]);
 await c.query("INSERT INTO public.receipt_packages(tenant_id,id,receipt_id,receipt_line_id,document_id,document_line_id,package_no,lot_code,produced_on,expires_on) VALUES($1,$2,$3,$4,$5,$6,1,'GRANUL','2026-10-01','2027-10-01')",[t,p.hu,p.receipt,p.receiptLine,p.document,p.line]);
 await c.query("INSERT INTO public.stock_dimensions(tenant_id,id,item_id,location_id,handling_unit_id,stock_status) VALUES($1,$2,$3,$4,$5,$6)",[t,p.dimension,world.itemNoneId,world.rootLocationId,p.hu,status]);
 await c.query("INSERT INTO public.stock_ledger(tenant_id,document_id,document_line_id,stock_dimension_id,quantity,reason,business_date) VALUES($1,$2,$3,$4,200,'Package fixture','2026-10-14')",[t,p.document,p.line,p.dimension]);
 await c.query("INSERT INTO public.stock_balances(tenant_id,stock_dimension_id,quantity) VALUES($1,$2,200)",[t,p.dimension]);
 await c.query("UPDATE public.inbound_receipt_lines SET received_quantity=200 WHERE tenant_id=$1 AND id=$2",[t,p.receiptLine]);
 await c.query("UPDATE public.inbound_receipts SET status='CLOSED' WHERE tenant_id=$1 AND id=$2",[t,p.receipt]);
 await c.query("UPDATE public.documents SET status='POSTED',number=$3 WHERE tenant_id=$1 AND id=$2",[t,p.document,p.document]);
 return p;
}
interface Options {operation?:string;quantity?:number;seq?:number;prev?:string;status?:string;target?:string;wrongItem?:boolean;register?:boolean;effects?:boolean;balance?:boolean}
async function movement(p:Package,previous:Step|null=null,o:Options={},c:pg.Client=app):Promise<Step>{
 const t=world.tenantId, q=o.quantity??200, op=o.operation??(previous?"PUTAWAY":"QC_RELEASE");
 const source=previous?.target??world.rootLocationId, sourceStatus=previous?.status??"QUARANTINE";
 const s={document:randomUUID(),line:randomUUID(),dimension:randomUUID(),sequence:o.seq??(previous?.sequence??0)+1,target:o.target??(op==="QC_RELEASE"?source:world.childLocationId),status:o.status??"AVAILABLE"};
 await c.query("INSERT INTO public.documents(tenant_id,id,kind,type_version_id,warehouse_id,business_date,created_by) SELECT $1,$2,'STOCK_MOVE',id,$3,'2026-10-14',$4 FROM public.document_type_versions WHERE tenant_id IS NULL AND key='STOCK_MOVE' AND version=1",[t,s.document,world.warehouseId,world.ownerUserId]);
 await c.query("INSERT INTO public.document_lines(tenant_id,id,document_id,line_no,item_id,unit_id,quantity,conversion_factor,base_quantity,source_location_id,target_location_id,handling_unit_id,stock_status,target_stock_status) VALUES($1,$2,$3,1,$4,$5,$6,1,$6,$7,$8,$9,$10,$11)",[t,s.line,s.document,o.wrongItem?world.itemTwoId:world.itemNoneId,kg,q,source,s.target,p.hu,sourceStatus,s.status]);
 if(o.register!==false) await c.query("INSERT INTO public.package_movement_steps(tenant_id,handling_unit_id,document_id,document_line_id,operation,sequence_no,previous_document_line_id,source_location_id,target_location_id,source_stock_status,target_stock_status,base_quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",[t,p.hu,s.document,s.line,op,s.sequence,o.prev??previous?.line??p.line,source,s.target,sourceStatus,s.status,q]);
 if(o.effects===false)return s;
 await c.query("INSERT INTO public.stock_dimensions(tenant_id,id,item_id,location_id,handling_unit_id,stock_status) VALUES($1,$2,$3,$4,$5,$6)",[t,s.dimension,world.itemNoneId,s.target,p.hu,s.status]);
 await c.query("INSERT INTO public.stock_balances(tenant_id,stock_dimension_id,quantity) VALUES($1,$2,0)",[t,s.dimension]);
 for(const [dimension,quantity] of [[previous?.dimension??p.dimension,-q],[s.dimension,q]]) await c.query("INSERT INTO public.stock_ledger(tenant_id,document_id,document_line_id,stock_dimension_id,quantity,reason,business_date) VALUES($1,$2,$3,$4,$5,'Package movement fixture','2026-10-14')",[t,s.document,s.line,dimension,quantity]);
 if(o.balance!==false){await c.query("UPDATE public.stock_balances SET quantity=quantity-$3,version=version+1 WHERE tenant_id=$1 AND stock_dimension_id=$2",[t,previous?.dimension??p.dimension,q]);await c.query("UPDATE public.stock_balances SET quantity=$3,version=version+1 WHERE tenant_id=$1 AND stock_dimension_id=$2",[t,s.dimension,q]);}
 await c.query("UPDATE public.documents SET status='POSTED',number=$3 WHERE tenant_id=$1 AND id=$2",[t,s.document,s.document]);
 return s;
}
beforeAll(async()=>{try{
 await admin.connect();await admin.query(`CREATE DATABASE ${name}`);direct=urlFor(env.databaseUrlDirect);migration=new pg.Client({connectionString:direct});await migration.connect();await migrateUp({url:direct});
 world=await seedWorld(migration,newRegistry(),"MOVEMENT");other=await seedWorld(migration,newRegistry(),"MOVEMENTOTHER");
 kg=randomUUID();await migration.query("INSERT INTO public.units(tenant_id,id,code,name) VALUES($1,$2,'KG-PROOF','Kilogram')",[world.tenantId,kg]);
 await migration.query("UPDATE public.items SET base_unit_id=$3 WHERE tenant_id=$1 AND id=$2",[world.tenantId,world.itemNoneId,kg]);
 const u=new URL(urlFor(env.databaseUrl)),endpoint=new URL(direct);u.hostname=endpoint.hostname;u.port=endpoint.port;appUrl=u.toString();app=new pg.Client({connectionString:appUrl});await app.connect();
 expect((await app.query("SELECT current_user AS role")).rows[0]?.role).toBe("wms_app");
}catch(e){throw new Error(redactErrorChain(e,secretUrls(env)));}},120000);
afterAll(async()=>{await app?.end();await migration?.end();await admin.query(`DROP DATABASE IF EXISTS ${name} WITH(FORCE)`);await admin.end();});
describe("T-941 whole-HU same-warehouse movement SQL",()=>{
 it("empty34 down restores exact33 function/ACL/RLS then up",async()=>{
  await migrateDown({url:direct,to:"0033",wmsEnv:"staging"});
  // Reapply the unchanged, committed original0033 source as an independent oracle.
  await migration.query(await readFile(new URL("../../../packages/db/migrations/0033_receipt_package_assert_plan.up.sql",import.meta.url),"utf8"));
  const before=await migration.query("SELECT pg_get_functiondef(p.oid) AS body,proacl::text AS acl,proconfig FROM pg_proc p WHERE p.oid='public.receipt_package_assert(uuid,uuid)'::regprocedure");
  await migrateUp({url:direct});await migrateDown({url:direct,to:"0033",wmsEnv:"staging"});
  expect((await migration.query("SELECT pg_get_functiondef(p.oid) AS body,proacl::text AS acl,proconfig FROM pg_proc p WHERE p.oid='public.receipt_package_assert(uuid,uuid)'::regprocedure")).rows).toEqual(before.rows);
  expect((await migration.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public.receipt_packages'::regclass")).rows[0]).toEqual({relrowsecurity:true,relforcerowsecurity:true});
  await migrateUp({url:direct});
 });
 it("real200KG QC then putaway retains HU/origin/metadata and one positive dimension",async()=>tx(async()=>{
  const p=await origin();const qc=await movement(p);const put=await movement(p,qc);await flush();
  expect((await app.query("SELECT sequence_no,operation,base_quantity::text FROM public.package_movement_steps WHERE handling_unit_id=$1 ORDER BY sequence_no",[p.hu])).rows).toEqual([{sequence_no:1,operation:"QC_RELEASE",base_quantity:"200.000000"},{sequence_no:2,operation:"PUTAWAY",base_quantity:"200.000000"}]);
  expect((await app.query("SELECT sd.location_id,sd.stock_status,b.quantity::text FROM public.stock_dimensions sd JOIN public.stock_balances b ON b.tenant_id=sd.tenant_id AND b.stock_dimension_id=sd.id WHERE sd.handling_unit_id=$1 AND b.quantity>0",[p.hu])).rows).toEqual([{location_id:put.target,stock_status:"AVAILABLE",quantity:"200.000000"}]);
  expect((await app.query("SELECT id,document_line_id,lot_code,produced_on::text,expires_on::text FROM public.receipt_packages WHERE id=$1",[p.hu])).rows[0]).toEqual({id:p.hu,document_line_id:p.line,lot_code:"GRANUL",produced_on:"2026-10-01",expires_on:"2027-10-01"});
 }));
 for(const [label,opts] of [
  ["partial quantity",{quantity:100}],["wrong sequence",{seq:2}],["wrong predecessor",{prev:randomUUID()}],
  ["wrong status",{status:"DAMAGED"}],["wrong item",{wrongItem:true}],["unregistered genericMOVE",{register:false}],
  ["no paired ledger",{effects:false}],["balance not moved",{balance:false}],
  ["putaway from quarantine",{operation:"PUTAWAY"}],
 ] as const)it(`rejects ${label}`,async()=>tx(async()=>{
  const p=await origin();await expect((async()=>{await movement(p,null,opts);await flush();})()).rejects.toMatchObject({code:expect.stringMatching(/23514|23503/)});
 }));
 it("runtime grants reject step mutation",async()=>tx(async()=>{
  const p=await origin();const s=await movement(p);await flush();
  await expect(app.query("UPDATE public.package_movement_steps SET previous_document_line_id=$1 WHERE document_line_id=$1",[s.line])).rejects.toMatchObject({code:"42501"});
 }));
 async function ownerTx(run:()=>Promise<void>){
  await begin(migration);
  try{
   const role=await migration.query("SELECT current_user AS role,pg_get_userbyid(c.relowner)=current_user AS owns FROM pg_class c WHERE c.oid='public.package_movement_steps'::regclass");
   expect(role.rows[0]?.role).not.toBe("wms_app");expect(role.rows[0]?.owns).toBe(true);
   expect((await migration.query("SELECT has_table_privilege(current_user,'public.stock_dimensions','UPDATE') AS upd")).rows[0]?.upd).toBe(true);
   await run();
  }finally{await migration.query("ROLLBACK");}
 }
 for(const [label,sql] of [
  ["step cycle","UPDATE public.package_movement_steps SET previous_document_line_id=document_line_id WHERE handling_unit_id=$1"],
  ["step deletion","DELETE FROM public.package_movement_steps WHERE handling_unit_id=$1"],
  ["step quantity","UPDATE public.package_movement_steps SET base_quantity=100 WHERE handling_unit_id=$1"],
  ["registered document deletion","DELETE FROM public.documents WHERE id=$2"],
  ["registered document reversal","UPDATE public.documents SET reversal_of_document_id=$3 WHERE id=$2"],
  ["registered document cancellation","UPDATE public.documents SET status='CANCELLED' WHERE id=$2"],
  ["registered document business date","UPDATE public.documents SET business_date='2026-10-15' WHERE id=$2"],
  ["registered line quantity","UPDATE public.document_lines SET quantity=100,base_quantity=100 WHERE document_id=$2"],
  ["registered line owner","UPDATE public.document_lines SET inventory_owner_id=$4 WHERE document_id=$2"],
  ["registered line lot","UPDATE public.document_lines SET lot_id=$5 WHERE document_id=$2"],
  ["registered line reversal","UPDATE public.document_lines SET reversed_quantity=1,reversal_status='PARTIAL' WHERE document_id=$2"],
  ["origin metadata","UPDATE public.receipt_packages SET lot_code='ALTERED' WHERE id=$1"],
  ["origin expiry","UPDATE public.receipt_packages SET expires_on='2028-10-01' WHERE id=$1"],
 ] as const)it(`privileged table owner rejects ${label}`,async()=>ownerTx(async()=>{
  const p=await origin(migration);const s=await movement(p,null,{},migration);await flush(migration);
  // Explicit typed binds prevent UUID/text fixture ambiguity; unused values remain typed.
  await expect(migration.query(`WITH binds AS (SELECT $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid) ${sql}`,[p.hu,s.document,p.document,world.ownerId,world.lotId])).rejects.toMatchObject({code:"23514"});
 }));
 it("privileged owner rejects truncate through trigger rather than grant",async()=>ownerTx(async()=>{
  const p=await origin(migration);await movement(p,null,{},migration);await flush(migration);
  await expect(migration.query("TRUNCATE public.package_movement_steps")).rejects.toMatchObject({code:"23514"});
 }));
 for(const [label,opts] of [
  ["self predecessor cycle",(line:string)=>({prev:line})],
  ["other package predecessor",(line:string)=>({prev:line})],
 ] as const)it(`privileged owner rejects ${label} insertion`,async()=>ownerTx(async()=>{
  const p=await origin(migration);const foreign=await origin(migration);await flush(migration);
  // Self-cycle is inserted with a real line, not a missing-FK UUID.
  if(label==="self predecessor cycle"){
   const s=await movement(p,null,{register:false,effects:false},migration);
   await expect((async()=>{await migration.query("INSERT INTO public.package_movement_steps(tenant_id,handling_unit_id,document_id,document_line_id,operation,sequence_no,previous_document_line_id,source_location_id,target_location_id,source_stock_status,target_stock_status,base_quantity) VALUES($1,$2,$3,$4,'QC_RELEASE',1,$4,$5,$5,'QUARANTINE','AVAILABLE',200)",[world.tenantId,p.hu,s.document,s.line,world.rootLocationId]);await flush(migration);})()).rejects.toMatchObject({code:"23514"});
  }else await expect((async()=>{await movement(p,null,opts(foreign.line),migration);await flush(migration);})()).rejects.toMatchObject({code:"23514"});
 }));
 it("privileged owner rejects orphan registered document line",async()=>ownerTx(async()=>{
  const p=await origin(migration);await flush(migration);
  await expect(migration.query("INSERT INTO public.package_movement_steps(tenant_id,handling_unit_id,document_id,document_line_id,operation,sequence_no,previous_document_line_id,source_location_id,target_location_id,source_stock_status,target_stock_status,base_quantity) VALUES($1,$2,$3,$4,'QC_RELEASE',1,$5,$6,$6,'QUARANTINE','AVAILABLE',200)",[world.tenantId,p.hu,p.document,randomUUID(),p.line,world.rootLocationId])).rejects.toMatchObject({code:"23503"});
 }));
 it("privileged owner rejects foreign tenant step FK",async()=>ownerTx(async()=>{
  const p=await origin(migration);await flush(migration);
  await expect(migration.query("INSERT INTO public.package_movement_steps(tenant_id,handling_unit_id,document_id,document_line_id,operation,sequence_no,previous_document_line_id,source_location_id,target_location_id,source_stock_status,target_stock_status,base_quantity) VALUES($1,$2,$3,$4,'QC_RELEASE',1,$4,$5,$5,'QUARANTINE','AVAILABLE',200)",[other.tenantId,p.hu,p.document,p.line,world.rootLocationId])).rejects.toMatchObject({code:"23503"});
 }));
 it("privileged assertion rejects missing or foreign tenant context",async()=>ownerTx(async()=>{
  const p=await origin(migration);await movement(p,null,{},migration);await flush(migration);
  for(const tenant of ["",other.tenantId]){
   await migration.query("SAVEPOINT qa_context");await migration.query("SELECT set_config('app.current_tenant_id',$1,true)",[tenant]);
   await expect(migration.query("SELECT public.package_movement_assert($1,$2)",[world.tenantId,p.hu])).rejects.toMatchObject({code:"23514"});
   await migration.query("ROLLBACK TO SAVEPOINT qa_context");
  }
 }));
 for(const [label,set] of [["current owner","inventory_owner_id=$2"],["current lot","lot_id=$3"],["current status","stock_status='DAMAGED'"]] as const)
 it(`privileged owner cannot tamper ${label} dimension after a sealed step`,async()=>ownerTx(async()=>{
  const p=await origin(migration);const s=await movement(p,null,{},migration);await flush(migration);
  await expect((async()=>{await migration.query(`WITH binds AS (SELECT $1::uuid,$2::uuid,$3::uuid) UPDATE public.stock_dimensions SET ${set} WHERE id=$1`,[s.dimension,world.ownerId,world.lotId]);await flush(migration);})()).rejects.toMatchObject({code:"42501",message:expect.stringMatching(/stock_dimensions.*değişmezdir/)});
 }));
 it("registered step line reversal counter cannot be edited",async()=>tx(async()=>{
  const p=await origin();const s=await movement(p);await flush();
  await expect(app.query("UPDATE public.document_lines SET reversed_quantity=1,reversal_status='PARTIAL' WHERE id=$1",[s.line])).rejects.toMatchObject({code:"23514"});
 }));
 it("RLS prevents foreign read and no context read; runtime write grants are append-only",async()=>tx(async()=>{
  const p=await origin();await movement(p);await flush();await app.query("SELECT set_config('app.current_tenant_id',$1,true)",[other.tenantId]);
  expect((await app.query("SELECT * FROM public.package_movement_steps WHERE handling_unit_id=$1",[p.hu])).rowCount).toBe(0);
  await app.query("SELECT set_config('app.current_tenant_id','',true)");expect((await app.query("SELECT * FROM public.package_movement_steps")).rowCount).toBe(0);
  expect((await migration.query("SELECT relrowsecurity,relforcerowsecurity,has_table_privilege('wms_app','public.package_movement_steps','UPDATE') AS upd,has_table_privilege('wms_app','public.package_movement_steps','DELETE') AS del,has_table_privilege('wms_app','public.package_movement_steps','TRUNCATE') AS trunc FROM pg_class WHERE oid='public.package_movement_steps'::regclass")).rows[0]).toEqual({relrowsecurity:true,relforcerowsecurity:true,upd:false,del:false,trunc:false});
 }));
 it("nonnegative balance CHECK prevents +201/-1 compensation",async()=>ownerTx(async()=>{
  const p=await origin(migration);const s=await movement(p,null,{},migration);await flush(migration);
  const check=await migration.query("SELECT pg_get_constraintdef(oid) AS body FROM pg_constraint WHERE conrelid='public.stock_balances'::regclass AND conname='stock_balances_quantity_chk'");
  expect(check.rows[0]?.body).toMatch(/quantity >=/);
  await migration.query("SET CONSTRAINTS ALL DEFERRED");
  await migration.query("UPDATE public.stock_balances SET quantity=201 WHERE tenant_id=$1 AND stock_dimension_id=$2",[world.tenantId,s.dimension]);
  await expect(migration.query("UPDATE public.stock_balances SET quantity=-1 WHERE tenant_id=$1 AND stock_dimension_id=$2",[world.tenantId,p.dimension])).rejects.toMatchObject({code:"23514",constraint:"stock_balances_quantity_chk"});
 }));
 it("runtime context denies foreign or missing-context registered inserts",async()=>tx(async()=>{
  const p=await origin();const s=await movement(p,null,{register:false,effects:false});
  for(const tenant of ["",other.tenantId]){
   await app.query("SAVEPOINT qa_insert_context");await app.query("SELECT set_config('app.current_tenant_id',$1,true)",[tenant]);
   await expect(app.query("INSERT INTO public.package_movement_steps(tenant_id,handling_unit_id,document_id,document_line_id,operation,sequence_no,previous_document_line_id,source_location_id,target_location_id,source_stock_status,target_stock_status,base_quantity) VALUES($1,$2,$3,$4,'QC_RELEASE',1,$5,$6,$6,'QUARANTINE','AVAILABLE',200)",[world.tenantId,p.hu,s.document,s.line,p.line,world.rootLocationId])).rejects.toMatchObject({code:"42501",message:expect.stringMatching(/row-level security/)});
   await app.query("ROLLBACK TO SAVEPOINT qa_insert_context");
  }
 }));
 it("two realRR snapshots reject the inverse winner fork",async()=>{
  await begin();const p=await origin();await app.query("COMMIT");const winner=new pg.Client({connectionString:appUrl});await winner.connect();
  try{
   await begin(app,world.tenantId,true);await begin(winner,world.tenantId,true);
   for(const c of [app,winner])expect((await c.query("SELECT count(*)::int AS n FROM public.package_movement_steps WHERE handling_unit_id=$1",[p.hu])).rows[0]?.n).toBe(0);
   const s=await movement(p,null,{},winner);
   const loser=movement(p,null,{},app).then(()=>null,(e:unknown)=>e);
   await winner.query("COMMIT");expect(await loser).toMatchObject({code:"23505"});await app.query("ROLLBACK");
   expect((await migration.query("SELECT document_line_id FROM public.package_movement_steps WHERE tenant_id=$1 AND handling_unit_id=$2",[world.tenantId,p.hu])).rows).toEqual([{document_line_id:s.line}]);
   expect((await migration.query("SELECT sum(quantity)::text AS total FROM public.stock_balances b JOIN public.stock_dimensions sd ON sd.tenant_id=b.tenant_id AND sd.id=b.stock_dimension_id WHERE sd.tenant_id=$1 AND sd.handling_unit_id=$2",[world.tenantId,p.hu])).rows[0]?.total).toBe("200.000000");
  }finally{await app.query("ROLLBACK");await winner.query("ROLLBACK");await winner.end();}
 });
 it("whole transaction rollback leaves origin but no movement documents/effects",async()=>{
  await begin();const p=await origin();await app.query("COMMIT");await begin();const s=await movement(p);await app.query("ROLLBACK");
  expect((await migration.query("SELECT count(*)::int AS n FROM public.package_movement_steps WHERE handling_unit_id=$1",[p.hu])).rows[0]?.n).toBe(0);
  expect((await migration.query("SELECT id FROM public.documents WHERE id=$1",[s.document])).rowCount).toBe(0);
  expect((await migration.query("SELECT quantity::text FROM public.stock_balances WHERE tenant_id=$1 AND stock_dimension_id=$2",[world.tenantId,p.dimension])).rows[0]?.quantity).toBe("200.000000");
 });
 it("two realRR snapshots cannot fork oneHU even without manualHU lock",async()=>{
  await begin();const p=await origin();await app.query("COMMIT");const racer=new pg.Client({connectionString:appUrl});await racer.connect();
  try{
   await begin(app,world.tenantId,true);await begin(racer,world.tenantId,true);
   for(const c of [app,racer])expect((await c.query("SELECT id FROM public.receipt_packages WHERE id=$1",[p.hu])).rowCount).toBe(1);
   await movement(p,null,{},app);
   // T2 waits on the unique predecessor/sequence insertion; T1 is independently committed.
   const loser=movement(p,null,{},racer).then(()=>null,(e:unknown)=>e);
   await app.query("COMMIT");const error=await loser;expect(error).toMatchObject({code:"23505"});await racer.query("ROLLBACK");
   expect((await migration.query("SELECT count(*)::int AS n FROM public.package_movement_steps WHERE tenant_id=$1 AND handling_unit_id=$2",[world.tenantId,p.hu])).rows[0]?.n).toBe(1);
   await expect(migrateDown({url:direct,to:"0033",wmsEnv:"staging"})).rejects.toThrow(/package movement data exists/);
   expect((await migration.query("SELECT max(version) AS version FROM wms_meta.schema_migrations")).rows[0]?.version).toBe("0034");
  }finally{await app.query("ROLLBACK");await racer.query("ROLLBACK");await racer.end();}
 });
});
