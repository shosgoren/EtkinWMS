import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateDown, migrateUp, MIGRATIONS_DIR } from "../../../packages/db/src/migrate.ts";
import { createDbClient, type DbClient } from "../../../packages/db/src/index.ts";
import { preparePackageReceipt, postPackageReceipt, getPackageReceipt, getReceiptPackage, resolvePackageQr, receiveGoods } from "../../../packages/domain/src/operations/index.ts";
import { postDocument, approveDocument, type StockDocCallParams } from "../../../packages/domain/src/stock/index.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv, redactErrorChain, secretUrls } from "../harness/env.ts";
const env=readIntEnv(process.env),name=`wms_pkg_commands_${randomBytes(6).toString("hex")}`;
const admin=new pg.Client({connectionString:env.databaseUrlDirect});
let db:DbClient,adm:pg.Client,A:TenantWorld,B:TenantWorld,location:string;
const id=()=>randomUUID();
const params=(key:string=id(),extra:Partial<StockDocCallParams>={}):StockDocCallParams=>({db,principal:{userId:A.ownerUserId,mfaVerified:true},tenantSlug:A.slug,clientKey:key,retry:{sleep:async()=>undefined},...extra});
const input=(over:Record<string,unknown>={})=>({warehouseId:A.warehouseId,receivingLocationId:location,itemId:A.itemNoneId,unitId:A.unitId,kind:"VARIL" as const,packages:{mode:"equal",count:5,quantity:"200"},...over});
async function q<T extends pg.QueryResultRow=pg.QueryResultRow>(text:string,values:unknown[]=[]):Promise<T[]> {return (await adm.query<T>(text,values)).rows;}
async function count(table:string):Promise<number> {return Number((await q(`SELECT count(*)::int AS n FROM public.${table} WHERE tenant_id=$1`,[A.tenantId]))[0]?.n);}
async function prepare(over:Record<string,unknown>={}) {const r=await preparePackageReceipt(params(),input(over));return getPackageReceipt(params(),{documentId:r.documentId as string});}
beforeAll(async()=> {
  try {
    await admin.connect();await admin.query(`CREATE DATABASE ${name}`);
    const direct=new URL(env.databaseUrlDirect);direct.pathname=`/${name}`;
    await migrateUp({url:direct.toString()});
    adm=new pg.Client({connectionString:direct.toString()});await adm.connect();
    A=await seedWorld(adm,newRegistry(),"PKGCMD");B=await seedWorld(adm,newRegistry(),"PKGCMDOTHER");
    location=id();await q("INSERT INTO public.locations(tenant_id,id,warehouse_id,code,name,depth,kind) VALUES($1,$2,$3,$4,'Package receiving',0,'RECEIVING')",[A.tenantId,location,A.warehouseId,location]);
    const appUrl=new URL(env.databaseUrl);appUrl.pathname=`/${name}`;appUrl.hostname=direct.hostname;appUrl.port=direct.port;
    db=createDbClient({url:appUrl.toString(),poolMax:5,prepare:true});
    expect((await q("SELECT rolbypassrls,rolsuper FROM pg_roles WHERE rolname='wms_app'"))[0]).toEqual({rolbypassrls:false,rolsuper:false});
  } catch(e) {throw new Error(redactErrorChain(e,secretUrls(env)));}
},120000);
afterAll(async()=> {await db?.close();await adm?.end();await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);await admin.end();});
describe("T-933 persisted package prepare/post, scratch DB runtime roles",()=> {
  it("5×200: five permanent HU/lines, draft no dimension/ledger; atomic post1000 and counters",async()=> {
    const d=await prepare();expect(d.documentStatus).toBe("DRAFT");expect(d.documentVersion).toBe(1);expect(d.packages).toHaveLength(5);expect(d.packages.every(p=>p.stockStatus==="QUARANTINE")).toBe(true);
    for(const k of ["id","receiptLineId","documentLineId"] as const)expect(new Set(d.packages.map(p=>p[k])).size).toBe(5);
    expect((await q("SELECT count(*)::int AS n FROM public.stock_dimensions WHERE handling_unit_id=ANY($1::uuid[])",[d.packages.map(p=>p.id)]))[0]?.n).toBe(0);
    expect((await q("SELECT count(*)::int AS n FROM public.stock_ledger WHERE document_id=$1",[d.documentId]))[0]?.n).toBe(0);
    const post=await postPackageReceipt(params(),{documentId:d.documentId,expectedVersion:1});expect(post.status).toBe("POSTED");expect(post.documentNumber).toMatch(/^GRS-/);
    const final=await getPackageReceipt(params(),{documentId:d.documentId});expect(final.receiptStatus).toBe("CLOSED");expect(final.documentVersion).toBe(3);expect(final.packages.map(p=>p.id)).toEqual(d.packages.map(p=>p.id));
    const ledger=await q("SELECT count(*)::int AS n,sum(quantity)::text AS total FROM public.stock_ledger WHERE document_id=$1",[d.documentId]);expect(ledger[0]).toEqual({n:5,total:"1000.000000"});
    const balances=await q("SELECT count(*)::int AS n,sum(b.quantity)::text AS total FROM public.stock_balances b JOIN public.stock_dimensions s ON s.tenant_id=b.tenant_id AND s.id=b.stock_dimension_id WHERE s.handling_unit_id=ANY($1::uuid[])",[d.packages.map(p=>p.id)]);expect(balances[0]).toEqual({n:5,total:"1000.000000"});
    expect((await q("SELECT count(*)::int AS n FROM public.inbound_receipt_lines WHERE receipt_id=$1 AND received_quantity=expected_quantity AND damaged_quantity=0",[d.receiptId]))[0]?.n).toBe(5);
  });
  it("canonical prepare replay/concurrent keys preserve identities, changed payload mismatch",async()=> {
    const key=id(),p=params(key),v=input();const [a,b]=await Promise.all([preparePackageReceipt(p,v),preparePackageReceipt(p,v)]);expect(a.documentId).toBe(b.documentId);expect([a.replayed,b.replayed].sort()).toEqual([false,true]);
    const replay=await preparePackageReceipt(p,input({requestId:"new",packages:{mode:"explicit",packages:Array.from({length:5},()=>({quantity:"200.000000"}))}}));expect(replay).toMatchObject({documentId:a.documentId,replayed:true});
    await expect(preparePackageReceipt(p,input({packages:{mode:"equal",count:5,quantity:"201"}}))).rejects.toMatchObject({code:"IDEMPOTENCY_MISMATCH"});
    const d=await getPackageReceipt(params(),{documentId:a.documentId as string});expect(d.packages).toHaveLength(5);
  });
  it("concurrent post same key, replay single audit; new key cannot stock twice",async()=> {
    const d=await prepare(),p=params(),v={documentId:d.documentId,expectedVersion:1};const [a,b]=await Promise.all([postPackageReceipt(p,v),postPackageReceipt(p,v)]);expect(a.documentNumber).toBe(b.documentNumber);expect([a.replayed,b.replayed].sort()).toEqual([false,true]);
    await expect(postPackageReceipt(params(),v)).rejects.toMatchObject({code:"VERSION_CONFLICT"});
    const fresh=await getPackageReceipt(params(),{documentId:d.documentId});await expect(postPackageReceipt(params(),{documentId:d.documentId,expectedVersion:fresh.documentVersion})).rejects.toMatchObject({code:"VALIDATION_FAILED",detail:"DOCUMENT_STATE"});
    expect((await q("SELECT count(*)::int AS n FROM public.audit_logs WHERE tenant_id=$1 AND entity_id=$2 AND action='stock_document.posted'",[A.tenantId,d.documentId]))[0]?.n).toBe(1);
    expect((await q("SELECT count(*)::int AS n FROM public.audit_logs WHERE tenant_id=$1 AND entity_id=$2 AND action='inbound_receipt.received'",[A.tenantId,d.receiptId]))[0]?.n).toBe(1);
  });
  it("QC source: enabled quarantines and disabled makes available",async()=> {
    await q("UPDATE public.tenant_settings SET receiving_qc_enabled=true WHERE tenant_id=$1",[A.tenantId]);const d=await prepare();expect(d.packages.every(p=>p.stockStatus==="QUARANTINE")).toBe(true);await postPackageReceipt(params(),{documentId:d.documentId,expectedVersion:1});
    await q("UPDATE public.tenant_settings SET receiving_qc_enabled=false WHERE tenant_id=$1",[A.tenantId]);const a=await prepare();expect(a.packages.every(p=>p.stockStatus==="AVAILABLE")).toBe(true);
  });
  it("NONE metadata retained, no synthetic lot; QR resolves through authorized query",async()=> {
    const d=await prepare({packages:{mode:"equal",count:1,quantity:"5",lotCode:"Physical lot",producedOn:"2026-10-01",expiresOn:"2027-10-01"}});const p=d.packages[0]!;
    expect(p).toMatchObject({lotId:null,lotCode:"Physical lot",producedOn:"2026-10-01",expiresOn:"2027-10-01"});
    expect((await resolvePackageQr(params(),{qr:p.qr})).package.id).toBe(p.id);
    await expect(getReceiptPackage(params(id(),{tenantSlug:B.slug,principal:{userId:B.ownerUserId,mfaVerified:true}}),{packageId:p.id})).rejects.toMatchObject({code:"NOT_FOUND"});
    await expect(resolvePackageQr(params(),{qr:`EWMS:PKG:2:${p.id}`})).rejects.toMatchObject({code:"VALIDATION_FAILED"});
  });
  it("LOT inherits complete existing dates; conflicts rejected without mutation",async()=> {
    const item=id(),lot=id();await q("INSERT INTO public.items(tenant_id,id,code,name,base_unit_id,tracking_mode,quantity_scale) VALUES($1,$2::uuid,$2::text,'LOT package',$3,'LOT',3)",[A.tenantId,item,A.unitId]);await q("INSERT INTO public.lots(tenant_id,id,item_id,lot_code,production_date,expiry_date) VALUES($1,$2,$3,'KNOWN','2026-10-01','2027-10-01')",[A.tenantId,lot,item]);
    const d=await prepare({itemId:item,packages:{mode:"explicit",packages:[{quantity:"1.25",lotCode:"KNOWN"},{quantity:"2",lotCode:"KNOWN",producedOn:"2026-10-01"}]}});expect(d.packages.every(p=>p.lotId===lot&&p.producedOn==="2026-10-01"&&p.expiresOn==="2027-10-01")).toBe(true);await postPackageReceipt(params(),{documentId:d.documentId,expectedVersion:1});
    const before=await count("receipt_packages");await expect(preparePackageReceipt(params(),input({itemId:item,packages:{mode:"equal",count:1,quantity:"1",lotCode:"KNOWN",expiresOn:"2028-10-01"}}))).rejects.toMatchObject({code:"VALIDATION_FAILED"});expect(await count("receipt_packages")).toBe(before);
  });
  it("new LOT created atomically; final conflict rolls back first lot and HU",async()=> {
    const item=id();await q("INSERT INTO public.items(tenant_id,id,code,name,base_unit_id,tracking_mode) VALUES($1,$2::uuid,$2::text,'New lots',$3,'LOT')",[A.tenantId,item,A.unitId]);
    const d=await prepare({itemId:item,packages:{mode:"equal",count:1,quantity:"1",lotCode:"NEW",producedOn:"2026-10-01"}});expect(d.packages[0]?.lotId).toBeTypeOf("string");
    const before=await count("handling_units");await expect(preparePackageReceipt(params(),input({itemId:item,packages:{mode:"explicit",packages:[{quantity:"1",lotCode:"AAA-FIRST"},{quantity:"1",lotCode:"NEW",producedOn:"2026-10-02"}]}}))).rejects.toMatchObject({code:"VALIDATION_FAILED"});expect(await count("handling_units")).toBe(before);expect((await q("SELECT count(*)::int AS n FROM public.lots WHERE item_id=$1 AND lot_code='AAA-FIRST'",[item]))[0]?.n).toBe(0);
  });
  it("invalid final scale, SERIAL, missing LOT, foreign item/unit/warehouse and wrong location reject",async()=> {
    const before=await count("receipt_packages");
    for(const over of [{packages:{mode:"explicit",packages:[{quantity:"1"},{quantity:"1.1"}]}},{itemId:A.itemId},{itemId:A.itemTwoId},{itemId:B.itemNoneId},{unitId:B.unitId},{warehouseId:B.warehouseId},{receivingLocationId:A.rootLocationId}])await expect(preparePackageReceipt(params(),input(over))).rejects.toBeDefined();
    expect(await count("receipt_packages")).toBe(before);
  });
  it("missing MFA and permission reject before any persisted package",async()=> {
    const before=await count("receipt_packages");await expect(preparePackageReceipt(params(id(),{principal:{userId:A.ownerUserId,mfaVerified:false}}),input())).rejects.toMatchObject({code:"FORBIDDEN",detail:"MFA_REQUIRED"});
    await expect(preparePackageReceipt(params(id(),{principal:{userId:A.memberUserId,mfaVerified:true}}),input())).rejects.toMatchObject({code:"FORBIDDEN"});expect(await count("receipt_packages")).toBe(before);
  });
  it("archived item post rolls back approval, preserving persisted identities",async()=> {
    const item=id();await q("INSERT INTO public.items(tenant_id,id,code,name,base_unit_id,tracking_mode) VALUES($1,$2::uuid,$2::text,'Archive later',$3,'NONE')",[A.tenantId,item,A.unitId]);const d=await prepare({itemId:item});await q("UPDATE public.items SET status='ARCHIVED',archived_at=now() WHERE id=$1",[item]);
    await expect(postPackageReceipt(params(),{documentId:d.documentId,expectedVersion:1})).rejects.toMatchObject({code:"VALIDATION_FAILED"});const after=await getPackageReceipt(params(),{documentId:d.documentId});expect(after.documentStatus).toBe("DRAFT");expect(after.documentVersion).toBe(1);expect(after.packages.map(p=>p.id)).toEqual(d.packages.map(p=>p.id));expect((await q("SELECT count(*)::int AS n FROM public.stock_ledger WHERE document_id=$1",[d.documentId]))[0]?.n).toBe(0);
  });
  it("generic approve/post and legacy receive cannot bypass mapped package counters",async()=> {
    const d=await prepare();await approveDocument(params(),{documentId:d.documentId,expectedVersion:1});await expect(postDocument(params(),{documentId:d.documentId,expectedVersion:2})).rejects.toBeDefined();
    await expect(receiveGoods(params(),{receiptId:d.receiptId,lines:[{lineId:d.packages[0]!.receiptLineId,received:"200",locationId:location}]})).rejects.toBeDefined();expect((await getPackageReceipt(params(),{documentId:d.documentId})).receiptStatus).toBe("DRAFT");
  });
  it("server conversion multiplies exactly and missing conversion/LOT/serial reject",async()=> {
    const item=id(),lotItem=id(),serialItem=id();
    for(const [itemId,mode] of [[item,"NONE"],[lotItem,"LOT"],[serialItem,"SERIAL"]])await q("INSERT INTO public.items(tenant_id,id,code,name,base_unit_id,tracking_mode,quantity_scale) VALUES($1,$2::uuid,$2::text,'Context item',$3,$4,3)",[A.tenantId,itemId,A.unitId,mode]);
    await q("INSERT INTO public.unit_conversions(tenant_id,item_id,unit_id,to_base_factor) VALUES($1,$2,$3,2.5)",[A.tenantId,item,A.boxUnitId]);
    const d=await prepare({itemId:item,unitId:A.boxUnitId,packages:{mode:"equal",count:2,quantity:"4"}});expect(d.packages.every(p=>p.conversionFactor==="2.500000"&&p.baseQuantity==="10.000000")).toBe(true);await postPackageReceipt(params(),{documentId:d.documentId,expectedVersion:1});
    for(const over of [{unitId:A.boxUnitId},{itemId:lotItem},{itemId:serialItem}])await expect(preparePackageReceipt(params(),input(over))).rejects.toMatchObject({code:"VALIDATION_FAILED"});
  });
  it("count lock post failure keeps draft identities and creates no dimensions/completed result",async()=> {
    const d=await prepare(),session=id(),key=id();await q("INSERT INTO public.count_sessions(tenant_id,id,warehouse_id,started_by) VALUES($1,$2,$3,$4)",[A.tenantId,session,A.warehouseId,A.ownerMembershipId]);
    await q("UPDATE public.location_count_locks SET status='COUNTING',count_session_id=$3,locked_at=now(),locked_by=$4 WHERE tenant_id=$1 AND location_id=$2",[A.tenantId,location,session,A.ownerMembershipId]);
    try {
      await expect(postPackageReceipt(params(key),{documentId:d.documentId,expectedVersion:1})).rejects.toMatchObject({code:"LOCATION_LOCKED"});
      expect((await getPackageReceipt(params(),{documentId:d.documentId})).packages.map(p=>p.id)).toEqual(d.packages.map(p=>p.id));
      expect((await q("SELECT status FROM public.documents WHERE id=$1",[d.documentId]))[0]?.status).toBe("DRAFT");
      expect((await q("SELECT count(*)::int AS n FROM public.stock_dimensions WHERE handling_unit_id=ANY($1::uuid[])",[d.packages.map(p=>p.id)]))[0]?.n).toBe(0);
      expect((await q("SELECT count(*)::int AS n FROM public.idempotency_records WHERE tenant_id=$1 AND client_key=$2 AND status='COMPLETED'",[A.tenantId,key]))[0]?.n).toBe(0);
    } finally {await q("UPDATE public.location_count_locks SET status='IDLE',count_session_id=NULL,locked_at=NULL,locked_by=NULL WHERE tenant_id=$1 AND location_id=$2",[A.tenantId,location]);}
  });
  it("warehouse scope denies prepare/post and hides package/QR; foreign document hides",async()=> {
    const warehouse=id(),receiving=id();await q("INSERT INTO public.warehouses(tenant_id,id,code,name) VALUES($1,$2,$3,'Outside scope')",[A.tenantId,warehouse,warehouse]);await q("INSERT INTO public.locations(tenant_id,id,warehouse_id,code,name,depth,kind) VALUES($1,$2::uuid,$3,$2::text,'Outside receiving',0,'RECEIVING')",[A.tenantId,receiving,warehouse]);
    const d=await prepare({warehouseId:warehouse,receivingLocationId:receiving});
    await q("INSERT INTO public.membership_roles(tenant_id,membership_id,role_key) VALUES($1,$2,'WAREHOUSE_MANAGER')",[A.tenantId,A.memberMembershipId]);await q("INSERT INTO public.membership_warehouse_scopes(tenant_id,membership_id,warehouse_id) VALUES($1,$2,$3)",[A.tenantId,A.memberMembershipId,A.warehouseId]);
    const prior=process.env.WAREHOUSE_SCOPE_ENABLED;process.env.WAREHOUSE_SCOPE_ENABLED="true";
    const p=params(id(),{principal:{userId:A.memberUserId,mfaVerified:true}});
    try {
      await expect(preparePackageReceipt(p,input({warehouseId:warehouse,receivingLocationId:receiving}))).rejects.toMatchObject({code:"FORBIDDEN",detail:"WAREHOUSE_OUT_OF_SCOPE"});
      await expect(postPackageReceipt(p,{documentId:d.documentId,expectedVersion:1})).rejects.toMatchObject({code:"FORBIDDEN",detail:"WAREHOUSE_OUT_OF_SCOPE"});
      await expect(getPackageReceipt(p,{documentId:d.documentId})).rejects.toMatchObject({code:"NOT_FOUND"});await expect(resolvePackageQr(p,{qr:d.packages[0]!.qr})).rejects.toMatchObject({code:"NOT_FOUND"});
      await expect(postPackageReceipt(params(id(),{tenantSlug:B.slug,principal:{userId:B.ownerUserId,mfaVerified:true}}),{documentId:d.documentId,expectedVersion:1})).rejects.toMatchObject({code:"NOT_FOUND"});
    } finally {if(prior===undefined)delete process.env.WAREHOUSE_SCOPE_ENABLED;else process.env.WAREHOUSE_SCOPE_ENABLED=prior;}
  });

  it("archived warehouse rejects prepare/post and post auth rejection preserves draft",async()=> {
    const warehouse=id(),receiving=id();await q("INSERT INTO public.warehouses(tenant_id,id,code,name) VALUES($1,$2,$3,'Archived warehouse')",[A.tenantId,warehouse,warehouse]);await q("INSERT INTO public.locations(tenant_id,id,warehouse_id,code,name,depth,kind) VALUES($1,$2::uuid,$3,$2::text,'Receiving',0,'RECEIVING')",[A.tenantId,receiving,warehouse]);
    const d=await prepare({warehouseId:warehouse,receivingLocationId:receiving});
    await expect(postPackageReceipt(params(id(),{principal:{userId:A.ownerUserId,mfaVerified:false}}),{documentId:d.documentId,expectedVersion:1})).rejects.toMatchObject({code:"FORBIDDEN",detail:"MFA_REQUIRED"});
    await q("UPDATE public.warehouses SET status='ARCHIVED',archived_at=now() WHERE id=$1",[warehouse]);
    await expect(preparePackageReceipt(params(),input({warehouseId:warehouse,receivingLocationId:receiving}))).rejects.toMatchObject({code:"VALIDATION_FAILED"});
    await expect(postPackageReceipt(params(),{documentId:d.documentId,expectedVersion:1})).rejects.toMatchObject({code:"VALIDATION_FAILED"});expect((await getPackageReceipt(params(),{documentId:d.documentId})).documentVersion).toBe(1);
    expect((await q("SELECT count(*)::int AS n FROM public.stock_ledger WHERE document_id=$1",[d.documentId]))[0]?.n).toBe(0);
  });

  it("T939 data survives 32→36→32→36 with exact function rollback and unchanged privileges",async()=> {
    const d=await prepare();await postPackageReceipt(params(),{documentId:d.documentId,expectedVersion:1});
    const direct=new URL(env.databaseUrlDirect);direct.pathname=`/${name}`;
    const signature="public.receipt_package_assert(uuid,uuid)";
    const functionState=async()=> (await q("SELECT prosrc,proowner::regrole::text AS owner,proacl::text AS acl,prosecdef,proconfig FROM pg_proc WHERE oid=$1::regprocedure",[signature]))[0]!;
    const rls=async()=>q("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid IN ('public.receipt_packages'::regclass,'public.stock_ledger'::regclass,'public.stock_balances'::regclass) ORDER BY relname");
    const snapshot=async()=>({receipt:await getPackageReceipt(params(),{documentId:d.documentId}),
      ledger:await q("SELECT * FROM public.stock_ledger WHERE document_id=$1 ORDER BY id",[d.documentId]),
      balances:await q("SELECT b.* FROM public.stock_balances b JOIN public.stock_dimensions s ON s.tenant_id=b.tenant_id AND s.id=b.stock_dimension_id WHERE s.handling_unit_id=ANY($1::uuid[]) ORDER BY b.stock_dimension_id",[d.packages.map(p=>p.id)])});
    const before=await snapshot(),current=await functionState(),security=await rls();
    const oldSource=readFileSync(`${MIGRATIONS_DIR}/0032_receipt_packages.up.sql`,"utf8");
    const oldBody=oldSource.slice(oldSource.indexOf("CREATE FUNCTION public.receipt_package_assert(" )).split("AS $fn$")[1]!.split("$fn$;")[0]!;
    for(const target of ["0032","0039","0032","0039"] as const) {
      if(target==="0032")expect((await migrateDown({url:direct.toString(),to:target,wmsEnv:"staging"})).reverted).toEqual(["0039", "0038","0037","0036","0035","0034","0033"]);
      else expect((await migrateUp({url:direct.toString()})).applied).toEqual(["0033","0034","0035","0036","0037","0038","0039"]);
      expect((await q("SELECT version FROM wms_meta.schema_migrations ORDER BY version DESC LIMIT 1"))[0]?.version).toBe(target);
      expect(await functionState()).toEqual({...current,prosrc:target==="0032"?oldBody:current.prosrc});
      expect(await rls()).toEqual(security);expect(await snapshot()).toEqual(before);
    }
  });

  for(const size of [5,200])it(`T934 default command batch ${size} preserves identities, totals and replay`,async()=> {
    const key=id(),start=performance.now();
    const drafted=await preparePackageReceipt(params(key),input({packages:{mode:"equal",count:size,quantity:"200"}}));
    const prepareMs=performance.now()-start,documentId=drafted.documentId as string;
    console.info(`[T934 batch ${size}] prepared=${prepareMs.toFixed(1)}ms`);
    const d=await getPackageReceipt(params(),{documentId});expect(d.packages).toHaveLength(size);
    for(const k of ["id","receiptLineId","documentLineId"] as const)expect(new Set(d.packages.map(p=>p[k])).size).toBe(size);
    expect(d.documentStatus).toBe("DRAFT");expect(d.receiptStatus).toBe("DRAFT");
    expect((await q("SELECT count(*)::int AS n FROM public.stock_dimensions WHERE handling_unit_id=ANY($1::uuid[])",[d.packages.map(p=>p.id)]))[0]?.n).toBe(0);
    expect((await preparePackageReceipt(params(key),input({packages:{mode:"explicit",packages:Array.from({length:size},()=>({quantity:"200.000000"}))}})))).toMatchObject({documentId,replayed:true});
    const postKey=id(),postStart=performance.now(),posted=await postPackageReceipt(params(postKey),{documentId,expectedVersion:1}),postMs=performance.now()-postStart;
    expect(posted.status).toBe("POSTED");expect((await postPackageReceipt(params(postKey),{documentId,expectedVersion:1}))).toMatchObject({documentId,replayed:true,documentNumber:posted.documentNumber});
    const final=await getPackageReceipt(params(),{documentId});expect(final.packages.map(p=>p.id)).toEqual(d.packages.map(p=>p.id));expect(final.documentStatus).toBe("POSTED");expect(final.receiptStatus).toBe("CLOSED");
    expect((await q("SELECT count(*)::int AS n,sum(quantity)::text AS total FROM public.stock_ledger WHERE document_id=$1",[documentId]))[0]).toEqual({n:size,total:`${size*200}.000000`});
    expect((await q("SELECT count(*)::int AS n,sum(b.quantity)::text AS total FROM public.stock_dimensions s JOIN public.stock_balances b ON b.tenant_id=s.tenant_id AND b.stock_dimension_id=s.id WHERE s.handling_unit_id=ANY($1::uuid[])",[d.packages.map(p=>p.id)]))[0]).toEqual({n:size,total:`${size*200}.000000`});
    expect((await q("SELECT count(*)::int AS n FROM public.inbound_receipt_lines WHERE receipt_id=$1 AND received_quantity=expected_quantity AND damaged_quantity=0",[d.receiptId]))[0]?.n).toBe(size);
    console.info(`[T934 batch ${size}] prepare=${prepareMs.toFixed(1)}ms post=${postMs.toFixed(1)}ms`);
  });

});
