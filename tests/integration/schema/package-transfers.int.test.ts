import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateDown, migrateUp } from "../../../packages/db/src/migrate.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv, redactErrorChain, secretUrls } from "../harness/env.ts";

const env=readIntEnv(process.env), name=`wms_transfers_${randomBytes(6).toString("hex")}`;
const admin=new pg.Client({connectionString:env.databaseUrlDirect});
let migration:pg.Client, app:pg.Client, world:TenantWorld, other:TenantWorld, direct:string, appUrl:string;
let kg:string; let targetWarehouse:string; let targetLocation:string; let targetShelf:string;
const urlFor=(raw:string)=>{const u=new URL(raw);u.pathname=`/${name}`;return u.toString();};
interface Package {receipt:string;receiptLine:string;document:string;line:string;hu:string;dimension:string}
interface Step {document:string;line:string;dimension:string;sequence:number;target:string;status:string}
async function begin(c:pg.Client=app,tenant=world.tenantId,rr=false){await c.query(rr?"BEGIN ISOLATION LEVEL REPEATABLE READ":"BEGIN");await c.query("SELECT set_config('app.current_tenant_id',$1,true)",[tenant]);}
async function flush(c:pg.Client=app){await c.query("SET CONSTRAINTS ALL IMMEDIATE");}
async function tx(run:()=>Promise<void>){await begin();try{await run();}finally{await app.query("ROLLBACK");}}
async function origin(c:pg.Client=app,status="AVAILABLE"):Promise<Package>{
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
interface TransferStep extends Step {sourceDocument:string;sourceLine:string;warehouse:string}
interface Options {quantity?:number;seq?:number;prev?:string;target?:string;sourceStatus?:string;targetStatus?:string;warehouse?:string;owner?:string;register?:boolean;link?:boolean;linkKind?:string;outOnly?:boolean;wrongSourceLine?:string;wrongSourceDocument?:string}
async function transfer(p:Package,previous:Step|null=null,o:Options={},c:pg.Client=app):Promise<TransferStep>{
 const t=world.tenantId,q=o.quantity??200,source=previous?.target??world.rootLocationId;
 const srcWarehouse=(await c.query("SELECT warehouse_id FROM public.locations WHERE tenant_id=$1 AND id=$2",[t,source])).rows[0]!.warehouse_id as string;
 const target=o.target??targetLocation,targetWh=(await c.query("SELECT warehouse_id FROM public.locations WHERE tenant_id=$1 AND id=$2",[t,target])).rows[0]!.warehouse_id as string;
 const s:TransferStep={document:randomUUID(),line:randomUUID(),dimension:randomUUID(),sourceDocument:randomUUID(),sourceLine:randomUUID(),sequence:o.seq??(previous?.sequence??0)+1,target,status:o.targetStatus??"AVAILABLE",warehouse:targetWh};
 for(const [doc,line,kind,wh,src,dst,status] of [[s.sourceDocument,s.sourceLine,"STOCK_OUT",srcWarehouse,source,null,o.sourceStatus??"AVAILABLE"],[s.document,s.line,"STOCK_IN",o.warehouse??targetWh,null,target,s.status]]){
  await c.query("INSERT INTO public.documents(tenant_id,id,kind,type_version_id,warehouse_id,business_date,created_by) SELECT $1,$2,$3,id,$4,'2026-10-14',$5 FROM public.document_type_versions WHERE tenant_id IS NULL AND key=$3 AND version=1",[t,doc,kind,wh,world.ownerUserId]);
  await c.query("INSERT INTO public.document_lines(tenant_id,id,document_id,line_no,item_id,unit_id,quantity,conversion_factor,base_quantity,source_location_id,target_location_id,handling_unit_id,stock_status,inventory_owner_id) VALUES($1,$2,$3,1,$4,$5,$6,1,$6,$7,$8,$9,$10,$11)",[t,line,doc,world.itemNoneId,kg,q,src,dst,p.hu,status,o.owner??null]);
 }
 if(o.register!==false) await c.query("INSERT INTO public.package_movement_steps(tenant_id,handling_unit_id,document_id,document_line_id,source_document_id,source_document_line_id,operation,sequence_no,previous_document_line_id,source_location_id,target_location_id,source_stock_status,target_stock_status,base_quantity) VALUES($1,$2,$3,$4,$5,$6,'WAREHOUSE_TRANSFER',$7,$8,$9,$10,$11,$12,$13)",[t,p.hu,s.document,s.line,o.wrongSourceDocument??s.sourceDocument,o.wrongSourceLine??s.sourceLine,s.sequence,o.prev??previous?.line??p.line,source,target,o.sourceStatus??"AVAILABLE",s.status,q]);
 if(o.link!==false)await c.query("INSERT INTO public.stock_document_links(tenant_id,source_document_id,target_document_id,kind) VALUES($1,$2,$3,$4)",[t,s.sourceDocument,s.document,o.linkKind??"TRANSFER"]);
 const existing=(await c.query("SELECT sd.id FROM public.stock_dimensions sd WHERE sd.tenant_id=$1 AND sd.handling_unit_id=$2 AND sd.location_id=$3 AND sd.stock_status=$4",[t,p.hu,target,s.status])).rows[0] as {id:string}|undefined;
 if(existing)s.dimension=existing.id;else await c.query("INSERT INTO public.stock_dimensions(tenant_id,id,item_id,location_id,handling_unit_id,stock_status) VALUES($1,$2,$3,$4,$5,$6)",[t,s.dimension,world.itemNoneId,target,p.hu,s.status]);
 await c.query("INSERT INTO public.stock_balances(tenant_id,stock_dimension_id,quantity) VALUES($1,$2,0) ON CONFLICT(tenant_id,stock_dimension_id) DO NOTHING",[t,s.dimension]);
 await c.query("INSERT INTO public.stock_ledger(tenant_id,document_id,document_line_id,stock_dimension_id,quantity,reason,business_date) VALUES($1,$2,$3,$4,$5,'Transfer fixture out','2026-10-14')",[t,s.sourceDocument,s.sourceLine,previous?.dimension??p.dimension,-q]);
 await c.query("UPDATE public.stock_balances SET quantity=quantity-$3,version=version+1 WHERE tenant_id=$1 AND stock_dimension_id=$2",[t,previous?.dimension??p.dimension,q]);
 await c.query("UPDATE public.documents SET status='POSTED',number=$3 WHERE tenant_id=$1 AND id=$2",[t,s.sourceDocument,s.sourceDocument]);
 if(o.outOnly)return s;
 await c.query("INSERT INTO public.stock_ledger(tenant_id,document_id,document_line_id,stock_dimension_id,quantity,reason,business_date) VALUES($1,$2,$3,$4,$5,'Transfer fixture in','2026-10-14')",[t,s.document,s.line,s.dimension,q]);
 await c.query("UPDATE public.stock_balances SET quantity=quantity+$3,version=version+1 WHERE tenant_id=$1 AND stock_dimension_id=$2",[t,s.dimension,q]);
 await c.query("UPDATE public.documents SET status='POSTED',number=$3 WHERE tenant_id=$1 AND id=$2",[t,s.document,s.document]);
 return s;
}
async function putaway(p:Package,previous:Step,c:pg.Client=app,target=targetShelf):Promise<Step>{
 const t=world.tenantId,s={document:randomUUID(),line:randomUUID(),dimension:randomUUID(),sequence:previous.sequence+1,target,status:"AVAILABLE"};
 const wh=(await c.query("SELECT warehouse_id FROM public.locations WHERE tenant_id=$1 AND id=$2",[t,previous.target])).rows[0]!.warehouse_id;
 await c.query("INSERT INTO public.documents(tenant_id,id,kind,type_version_id,warehouse_id,business_date,created_by) SELECT $1,$2,'STOCK_MOVE',id,$3,'2026-10-14',$4 FROM public.document_type_versions WHERE tenant_id IS NULL AND key='STOCK_MOVE' AND version=1",[t,s.document,wh,world.ownerUserId]);
 await c.query("INSERT INTO public.document_lines(tenant_id,id,document_id,line_no,item_id,unit_id,quantity,conversion_factor,base_quantity,source_location_id,target_location_id,handling_unit_id,stock_status) VALUES($1,$2,$3,1,$4,$5,200,1,200,$6,$7,$8,'AVAILABLE')",[t,s.line,s.document,world.itemNoneId,kg,previous.target,target,p.hu]);
 await c.query("INSERT INTO public.package_movement_steps(tenant_id,handling_unit_id,document_id,document_line_id,operation,sequence_no,previous_document_line_id,source_location_id,target_location_id,source_stock_status,target_stock_status,base_quantity) VALUES($1,$2,$3,$4,'PUTAWAY',$5,$6,$7,$8,'AVAILABLE','AVAILABLE',200)",[t,p.hu,s.document,s.line,s.sequence,previous.line,previous.target,target]);
 await c.query("INSERT INTO public.stock_dimensions(tenant_id,id,item_id,location_id,handling_unit_id,stock_status) VALUES($1,$2,$3,$4,$5,'AVAILABLE')",[t,s.dimension,world.itemNoneId,target,p.hu]);
 await c.query("INSERT INTO public.stock_balances(tenant_id,stock_dimension_id,quantity) VALUES($1,$2,0)",[t,s.dimension]);
 for(const [dim,q] of [[previous.dimension,-200],[s.dimension,200]])await c.query("INSERT INTO public.stock_ledger(tenant_id,document_id,document_line_id,stock_dimension_id,quantity,reason,business_date) VALUES($1,$2,$3,$4,$5,'Putaway fixture','2026-10-14')",[t,s.document,s.line,dim,q]);
 await c.query("UPDATE public.stock_balances SET quantity=0,version=version+1 WHERE tenant_id=$1 AND stock_dimension_id=$2",[t,previous.dimension]);await c.query("UPDATE public.stock_balances SET quantity=200,version=version+1 WHERE tenant_id=$1 AND stock_dimension_id=$2",[t,s.dimension]);
 await c.query("UPDATE public.documents SET status='POSTED',number=$3 WHERE tenant_id=$1 AND id=$2",[t,s.document,s.document]);return s;
}
beforeAll(async()=>{try{
 await admin.connect();await admin.query(`CREATE DATABASE ${name}`);direct=urlFor(env.databaseUrlDirect);migration=new pg.Client({connectionString:direct});await migration.connect();await migrateUp({url:direct});
 world=await seedWorld(migration,newRegistry(),"TRANSFER");other=await seedWorld(migration,newRegistry(),"TRANSFEROTHER");
 kg=randomUUID();await migration.query("INSERT INTO public.units(tenant_id,id,code,name) VALUES($1,$2,'KG-PROOF','Kilogram')",[world.tenantId,kg]);
 // T-1129: seedWorld ürünü zaten kullanılmış (boyut + belge satırı); KG temel birimi yalnız bu ayrı scratch DB kurulumunda, bekçi tek ifade için
 // kapatılarak verilir (0065 bekçisinin kendisi item-fixed-fields.int.test.ts'te sınanır).
 await migration.query("BEGIN");await migration.query("ALTER TABLE public.items DISABLE TRIGGER items_guard_unused_fixed");
 await migration.query("UPDATE public.items SET base_unit_id=$3 WHERE tenant_id=$1 AND id=$2",[world.tenantId,world.itemNoneId,kg]);
 await migration.query("ALTER TABLE public.items ENABLE ALWAYS TRIGGER items_guard_unused_fixed");await migration.query("COMMIT");
 targetWarehouse=randomUUID();targetLocation=randomUUID();targetShelf=randomUUID();
 await migration.query("INSERT INTO public.warehouses(tenant_id,id,code,name) VALUES($1,$2,'TARGET','Target')",[world.tenantId,targetWarehouse]);
 await migration.query("INSERT INTO public.locations(tenant_id,id,warehouse_id,code,name,depth,kind) VALUES($1,$2,$3,'TARGET-ROOT','Target',0,'STORAGE'),($1,$4,$3,'TARGET-SHELF','Shelf',0,'STORAGE')",[world.tenantId,targetLocation,targetWarehouse,targetShelf]);
 const u=new URL(urlFor(env.databaseUrl)),endpoint=new URL(direct);u.hostname=endpoint.hostname;u.port=endpoint.port;appUrl=u.toString();app=new pg.Client({connectionString:appUrl});await app.connect();
 expect((await app.query("SELECT current_user AS role")).rows[0]?.role).toBe("wms_app");
}catch(e){throw new Error(redactErrorChain(e,secretUrls(env)));}},120000);
afterAll(async()=>{await app?.end();await migration?.end();await admin.query(`DROP DATABASE IF EXISTS ${name} WITH(FORCE)`);await admin.end();});
describe("T946 registered package crosswarehouse transfer",()=>{
 it("empty35→34 restores original34 functions/schema/grants/RLS then35",async()=>{
  await migrateDown({url:direct,to:"0034",wmsEnv:"staging"});
  const source=await readFile(new URL("../../../packages/db/migrations/0034_package_movement_steps.up.sql",import.meta.url),"utf8");
  const names=["package_movement_assert","package_movement_guard","package_movement_check_trigger","receipt_package_assert"];
  for(const n of names){const match=source.match(new RegExp("CREATE(?: OR REPLACE)? FUNCTION public\\."+n+"\\(.*?\\$fn\\$;","s"));expect(match).not.toBeNull();await migration.query(match![0].replace("CREATE FUNCTION","CREATE OR REPLACE FUNCTION"));}
  const state=()=>migration.query("SELECT proname,prosrc,proacl::text,proowner::regrole::text,proconfig,prosecdef FROM pg_proc WHERE proname=ANY($1::text[]) ORDER BY proname",[names]);
  const before=(await state()).rows;await migrateUp({url:direct});await migrateDown({url:direct,to:"0034",wmsEnv:"staging"});expect((await state()).rows).toEqual(before);
  expect((await migration.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='package_movement_steps' AND column_name IN ('source_document_id','source_document_line_id')")).rowCount).toBe(0);
  expect((await migration.query("SELECT relrowsecurity,relforcerowsecurity,has_table_privilege('wms_app','public.package_movement_steps','UPDATE') AS upd FROM pg_class WHERE oid='public.package_movement_steps'::regclass")).rows[0]).toEqual({relrowsecurity:true,relforcerowsecurity:true,upd:false});await migrateUp({url:direct});
 });
 it("200KG A→B putaway→A keeps originalwarehouse/QR/lot metadata and one current balance",async()=>tx(async()=>{
  const p=await origin();const b=await transfer(p);const shelf=await putaway(p,b);const back=await transfer(p,shelf,{target:world.rootLocationId});await flush();
  expect((await app.query("SELECT sequence_no,operation,source_document_id IS NOT NULL AS paired FROM public.package_movement_steps WHERE handling_unit_id=$1 ORDER BY sequence_no",[p.hu])).rows).toEqual([{sequence_no:1,operation:"WAREHOUSE_TRANSFER",paired:true},{sequence_no:2,operation:"PUTAWAY",paired:false},{sequence_no:3,operation:"WAREHOUSE_TRANSFER",paired:true}]);
  expect((await app.query("SELECT sd.location_id,b.quantity::text FROM public.stock_dimensions sd JOIN public.stock_balances b ON b.tenant_id=sd.tenant_id AND b.stock_dimension_id=sd.id WHERE sd.handling_unit_id=$1 AND b.quantity>0",[p.hu])).rows).toEqual([{location_id:back.target,quantity:"200.000000"}]);
  expect((await app.query("SELECT r.warehouse_id,rp.id,rp.document_line_id,rp.lot_code FROM public.receipt_packages rp JOIN public.inbound_receipts r ON r.tenant_id=rp.tenant_id AND r.id=rp.receipt_id WHERE rp.id=$1",[p.hu])).rows[0]).toEqual({warehouse_id:world.warehouseId,id:p.hu,document_line_id:p.line,lot_code:"GRANUL"});
 }));
 for(const [label,make] of [
  ["wrong fullquantity",()=>({quantity:100})],["samewarehouse",()=>({target:world.childLocationId})],
  ["header warehouse mismatch",()=>({warehouse:world.warehouseId})],["sourcequarantine",()=>({sourceStatus:"QUARANTINE"})],
  ["targetdamaged",()=>({targetStatus:"DAMAGED"})],["wrongowner",()=>({owner:world.ownerId})],
  ["wrongsequence",()=>({seq:2})],["wrong real predecessor",()=>({prev:world.documentLineId})],
  ["missinglink",()=>({link:false})],["productionlink",()=>({linkKind:"PRODUCTION"})],
  ["unregistered OUT/IN",()=>({register:false})],["OUT withoutfinalIN",()=>({outOnly:true})],
  ["source line belongingdifferentdocument",()=>({wrongSourceLine:world.documentLineNoneId})],
  ["orphan source document",()=>({wrongSourceDocument:randomUUID()})],
  ["foreign source document",()=>({wrongSourceDocument:other.documentId})],
  ["orphan source line",()=>({wrongSourceLine:randomUUID()})],
  ["foreign source line",()=>({wrongSourceLine:other.documentLineNoneId})]
 ] as const)it(`rejects ${label}`,async()=>tx(async()=>{
  const p=await origin();await expect((async()=>{await transfer(p,null,make());await flush();})()).rejects.toMatchObject({code:expect.stringMatching(/23514|23503/)});
 }));
 for(const kind of ['TRANSFER','PRODUCTION'] as const)it(`registered transfer rejects extra incoming ${kind} link`,async()=>tx(async()=>{
  const p=await origin();const step=await transfer(p);await flush();await app.query('SET CONSTRAINTS ALL DEFERRED');
  const extra=randomUUID(),recipeId=randomUUID();
  await app.query("INSERT INTO public.documents(tenant_id,id,kind,type_version_id,warehouse_id,business_date,created_by) SELECT $1,$2,'STOCK_OUT',id,$3,'2026-10-14',$4 FROM public.document_type_versions WHERE tenant_id IS NULL AND key='STOCK_OUT' AND version=1",[world.tenantId,extra,world.warehouseId,world.ownerUserId]);
  if(kind==='PRODUCTION'){
   await app.query("INSERT INTO public.production_recipes(tenant_id,id,code,version,name,output_item_id,output_quantity,created_by) VALUES($1,$2,$3,1,'Extra link recipe',$4,1,$5)",[world.tenantId,recipeId,recipeId,world.itemTwoId,world.ownerUserId]);
   await app.query("INSERT INTO public.production_recipe_lines(tenant_id,recipe_id,line_no,item_id,quantity) VALUES($1,$2,1,$3,1)",[world.tenantId,recipeId,world.itemNoneId]);
  }
  await app.query("INSERT INTO public.stock_document_links(tenant_id,source_document_id,target_document_id,kind,recipe_id) VALUES($1,$2,$3,$4,$5)",[world.tenantId,extra,step.document,kind,kind==='PRODUCTION'?recipeId:null]);
  await expect(flush()).rejects.toMatchObject({code:'23514',message:'PACKAGE_TRANSFER_LINK'});
 }));
 for(const direction of ['IN_AS_SOURCE','OUT_AS_TARGET'] as const)it(`registered transfer rejects inverse endpoint ${direction}`,async()=>tx(async()=>{
  const p=await origin();const step=await transfer(p);await flush();await app.query('SET CONSTRAINTS ALL DEFERRED');
  const extra=randomUUID(),kind=direction==='IN_AS_SOURCE'?'STOCK_IN':'STOCK_OUT';
  await app.query("INSERT INTO public.documents(tenant_id,id,kind,type_version_id,warehouse_id,business_date,created_by) SELECT $1,$2,$3,id,$4,'2026-10-14',$5 FROM public.document_type_versions WHERE tenant_id IS NULL AND key=$3 AND version=1",[world.tenantId,extra,kind,world.warehouseId,world.ownerUserId]);
  await app.query("INSERT INTO public.stock_document_links(tenant_id,source_document_id,target_document_id,kind) VALUES($1,$2,$3,'TRANSFER')",[world.tenantId,direction==='IN_AS_SOURCE'?step.document:extra,direction==='IN_AS_SOURCE'?extra:step.sourceDocument]);
  await expect(flush()).rejects.toMatchObject({code:'23514',message:'PACKAGE_TRANSFER_LINK'});
 }));
 for(const flow of ['ORIGIN','PUTAWAY'] as const)for(const endpoint of ['SOURCE','TARGET'] as const)it(`registered ${flow} forbids unrelated link at ${endpoint}`,async()=>tx(async()=>{
  const p=await origin();const doc=flow==='ORIGIN'?p.document:(await putaway(p,await transfer(p))).document;
  await flush();await app.query('SET CONSTRAINTS ALL DEFERRED');const extra=randomUUID();
  await app.query("INSERT INTO public.documents(tenant_id,id,kind,type_version_id,warehouse_id,business_date,created_by) SELECT $1,$2,'STOCK_IN',id,$3,'2026-10-14',$4 FROM public.document_type_versions WHERE tenant_id IS NULL AND key='STOCK_IN' AND version=1",[world.tenantId,extra,world.warehouseId,world.ownerUserId]);
  await app.query("INSERT INTO public.stock_document_links(tenant_id,source_document_id,target_document_id,kind) VALUES($1,$2,$3,'TRANSFER')",[world.tenantId,endpoint==='SOURCE'?doc:extra,endpoint==='SOURCE'?extra:doc]);
  await expect(flush()).rejects.toMatchObject({code:'23514',message:flow==='ORIGIN'?'PACKAGE_ORIGIN_LINK':'PACKAGE_MOVEMENT_LINK'});
 }));
 it('legacy unrelated documents retain multiple incoming operation links',async()=>tx(async()=>{
  const target=randomUUID();for(const doc of [target,randomUUID(),randomUUID()]){
   await app.query("INSERT INTO public.documents(tenant_id,id,kind,type_version_id,warehouse_id,business_date,created_by) SELECT $1,$2,'STOCK_IN',id,$3,'2026-10-14',$4 FROM public.document_type_versions WHERE tenant_id IS NULL AND key='STOCK_IN' AND version=1",[world.tenantId,doc,world.warehouseId,world.ownerUserId]);
   if(doc!==target)await app.query("INSERT INTO public.stock_document_links(tenant_id,source_document_id,target_document_id,kind) VALUES($1,$2,$3,'TRANSFER')",[world.tenantId,doc,target]);
  }await flush();expect((await app.query('SELECT count(*)::int AS n FROM public.stock_document_links WHERE target_document_id=$1',[target])).rows[0]?.n).toBe(2);
 }));
 it("RLS hides transferstep and runtime cannot edit/delete/newcolumnscreatedat",async()=>tx(async()=>{
  const p=await origin();await transfer(p);await flush();await app.query("SELECT set_config('app.current_tenant_id',$1,true)",[other.tenantId]);expect((await app.query("SELECT * FROM public.package_movement_steps WHERE handling_unit_id=$1",[p.hu])).rowCount).toBe(0);
  expect((await migration.query("SELECT has_column_privilege('wms_app','public.package_movement_steps','source_document_id','INSERT') AS ins,has_column_privilege('wms_app','public.package_movement_steps','created_at','INSERT') AS created,has_table_privilege('wms_app','public.package_movement_steps','DELETE') AS del")).rows[0]).toEqual({ins:true,created:false,del:false});
 }));
 for(const [label,statement] of [
  ["OUT line reversal","UPDATE public.document_lines SET reversed_quantity=1,reversal_status='PARTIAL' WHERE tenant_id=$1 AND id=$2"],
  ["link delete","DELETE FROM public.stock_document_links WHERE tenant_id=$1 AND source_document_id=$2"],
  ["link change","UPDATE public.stock_document_links SET kind='PRODUCTION' WHERE tenant_id=$1 AND source_document_id=$2"],
  ["link truncate","TRUNCATE public.stock_document_links"],
 ] as const)it(`privileged owner rejects ${label}`,async()=>{
  await begin(migration);try{const p=await origin(migration);const s=await transfer(p,null,{},migration);await flush(migration);
   expect((await migration.query("SELECT current_user='wms_app' AS app,has_table_privilege(current_user,'public.stock_document_links','UPDATE') AS upd")).rows[0]).toEqual({app:false,upd:true});
   await expect(migration.query(statement,statement.includes('$1')?[world.tenantId,label.includes('line')?s.sourceLine:s.sourceDocument]:[])).rejects.toMatchObject({code:"23514"});
  }finally{await migration.query("ROLLBACK");}
 });
 it("runtime foreign-context INSERT is RLS-denied before parent references",async()=>tx(async()=>{
  const p=await origin();const s=await transfer(p);await flush();await app.query("SELECT set_config('app.current_tenant_id',$1,true)",[other.tenantId]);
  await expect(app.query("INSERT INTO public.package_movement_steps(tenant_id,handling_unit_id,document_id,document_line_id,source_document_id,source_document_line_id,operation,sequence_no,previous_document_line_id,source_location_id,target_location_id,source_stock_status,target_stock_status,base_quantity) VALUES($1,$2,$3,$4,$5,$6,'WAREHOUSE_TRANSFER',2,$7,$8,$9,'AVAILABLE','AVAILABLE',200)",[world.tenantId,p.hu,s.document,s.line,s.sourceDocument,s.sourceLine,p.line,world.rootLocationId,targetLocation])).rejects.toMatchObject({code:"42501",message:expect.stringContaining("row-level security")});
 }));
 it("privileged owner cannot change source document/line binding",async()=>{
  await begin(migration);try{const p=await origin(migration);const s=await transfer(p,null,{},migration);await flush(migration);
   expect((await migration.query("SELECT has_table_privilege(current_user,'public.package_movement_steps','UPDATE') AS upd")).rows[0]?.upd).toBe(true);
   await expect(migration.query("UPDATE public.package_movement_steps SET source_document_id=$3,source_document_line_id=$4 WHERE tenant_id=$1 AND document_line_id=$2",[world.tenantId,s.line,world.documentId,world.documentLineId])).rejects.toMatchObject({code:"23514",message:"PACKAGE_MOVEMENT_IMMUTABLE"});
  }finally{await migration.query("ROLLBACK");}
 });
 it("fault after OUT rolls back bothdocs/step/link/ledger/balances",async()=>{
  await begin();const p=await origin();await app.query("COMMIT");await begin();const s=await transfer(p,null,{outOnly:true});await app.query("ROLLBACK");
  expect((await migration.query("SELECT id FROM public.documents WHERE id=ANY($1::uuid[])",[[s.document,s.sourceDocument]])).rowCount).toBe(0);
  expect((await migration.query("SELECT quantity::text FROM public.stock_balances WHERE tenant_id=$1 AND stock_dimension_id=$2",[world.tenantId,p.dimension])).rows[0]?.quantity).toBe("200.000000");
 });
 for(const race of ["transfer","putaway"] as const)it(`realtwoRR transfer/${race} share onepredecessor winner`,async()=>{
  await begin();const p=await origin();await app.query("COMMIT");const racer=new pg.Client({connectionString:appUrl});await racer.connect();
  try{await begin(app,world.tenantId,true);await begin(racer,world.tenantId,true);
   for(const c of [app,racer])expect((await c.query("SELECT id FROM public.receipt_packages WHERE id=$1",[p.hu])).rowCount).toBe(1);
   const s=await transfer(p,null,{},app);
   const initial={document:p.document,line:p.line,dimension:p.dimension,sequence:0,target:world.rootLocationId,status:"AVAILABLE"};
   const loser=(race==='transfer'?transfer(p,null,{target:targetShelf},racer):putaway(p,initial,racer,world.childLocationId)).then(()=>null,(e:unknown)=>e);
   await app.query("COMMIT");expect(await loser).toMatchObject({code:"23505"});await racer.query("ROLLBACK");
   expect((await migration.query("SELECT count(*)::int AS n FROM public.package_movement_steps WHERE tenant_id=$1 AND handling_unit_id=$2",[world.tenantId,p.hu])).rows[0]?.n).toBe(1);
   expect((await migration.query("SELECT quantity::text FROM public.stock_balances WHERE tenant_id=$1 AND stock_dimension_id=$2",[world.tenantId,s.dimension])).rows[0]?.quantity).toBe("200.000000");
   await expect(migrateDown({url:direct,to:'0034',wmsEnv:'staging'})).rejects.toThrow(/package transfer data exists/);
   expect((await migration.query("SELECT max(version) AS version FROM wms_meta.schema_migrations")).rows[0]?.version).toBe("0035");
  }finally{await app.query("ROLLBACK");await racer.query("ROLLBACK");await racer.end();}
 });

 async function predecessorWait(pid:number){
  const deadline=performance.now()+2000;
  while(performance.now()<deadline){
   const row=(await migration.query<{wait_event_type:string|null;query:string}>("SELECT wait_event_type,query FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0];
   if(row?.wait_event_type==="Lock" && row.query.includes("INSERT INTO public.package_movement_steps"))return row;
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  throw new Error("RR loser did not reach the shared predecessor constraint before winner commit");
 }
 for(const winner of ["putaway","transfer-target"] as const)it(`inverse realRR ${winner} on oppositeconnection wins before transferloser`,async()=>{
  await begin();const p=await origin();await app.query("COMMIT");const opposite=new pg.Client({connectionString:appUrl});await opposite.connect();
  try{
   await begin(app,world.tenantId,true);await begin(opposite,world.tenantId,true);
   for(const c of [app,opposite]){
    expect((await c.query("SHOW transaction_isolation")).rows[0]?.transaction_isolation).toBe("repeatable read");
    expect((await c.query("SELECT id FROM public.receipt_packages WHERE id=$1",[p.hu])).rowCount).toBe(1);
   }
   const initial={document:p.document,line:p.line,dimension:p.dimension,sequence:0,target:world.rootLocationId,status:"AVAILABLE"};
   const committed=winner==='putaway'?await putaway(p,initial,opposite,world.childLocationId):await transfer(p,null,{target:targetShelf},opposite);
   const loserPid=(await app.query<{pid:number}>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
   const losing=transfer(p,null,{target:targetLocation},app).then(()=>null,(e:unknown)=>e);
   // Prove both RR transactions overlap at the same predecessor uniqueness check, before commit.
   const blocked=await predecessorWait(loserPid);expect(blocked.wait_event_type).toBe("Lock");expect(blocked.query).toContain("INSERT INTO public.package_movement_steps");
   await opposite.query("COMMIT");expect(await losing).toMatchObject({code:"23505"});await app.query("ROLLBACK");
   expect((await migration.query("SELECT sequence_no,operation,document_id,previous_document_line_id FROM public.package_movement_steps WHERE tenant_id=$1 AND handling_unit_id=$2",[world.tenantId,p.hu])).rows).toEqual([{sequence_no:1,operation:winner==='putaway'?"PUTAWAY":"WAREHOUSE_TRANSFER",document_id:committed.document,previous_document_line_id:p.line}]);
   expect((await migration.query("SELECT sd.location_id,b.quantity::text FROM public.stock_dimensions sd JOIN public.stock_balances b ON b.tenant_id=sd.tenant_id AND b.stock_dimension_id=sd.id WHERE sd.tenant_id=$1 AND sd.handling_unit_id=$2 AND b.quantity>0",[world.tenantId,p.hu])).rows).toEqual([{location_id:committed.target,quantity:"200.000000"}]);
   expect((await migration.query("SELECT quantity::text FROM public.stock_balances WHERE tenant_id=$1 AND stock_dimension_id=$2",[world.tenantId,p.dimension])).rows[0]?.quantity).toBe("0.000000");
   expect((await migration.query("SELECT sum(sl.quantity)::text AS total FROM public.stock_ledger sl JOIN public.stock_dimensions sd ON sd.tenant_id=sl.tenant_id AND sd.id=sl.stock_dimension_id WHERE sd.tenant_id=$1 AND sd.handling_unit_id=$2",[world.tenantId,p.hu])).rows[0]?.total).toBe("200.000000");
  }finally{await opposite.query("ROLLBACK");await app.query("ROLLBACK");await opposite.end();}
 });
});
