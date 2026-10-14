import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateUp } from "../../../packages/db/src/migrate.ts";
import { createDbClient, type DbClient } from "../../../packages/db/src/index.ts";
import { approvePackageQuality, putawayPackage, getCurrentPackage, resolveCurrentPackageQr, transferPackage, preparePackageReceipt, postPackageReceipt, getPackageReceipt } from "../../../packages/domain/src/operations/index.ts";
import { parsePackageTransferInput } from "../../../packages/domain/src/operations/package-transfer.ts";
import { createStockDocument, approveDocument, reserve, type StockDocCallParams } from "../../../packages/domain/src/stock/index.ts";
import { newRegistry, seedWorld, mkUser, mkMembership, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv, redactErrorChain, secretUrls } from "../harness/env.ts";
const env = readIntEnv(process.env), name = `wms_pkg_transfer_${randomBytes(6).toString("hex")}`;
const admin = new pg.Client({ connectionString: env.databaseUrlDirect });
let db: DbClient, adm: pg.Client, A: TenantWorld, B: TenantWorld, receiving: string, storage: string, storageTwo: string, item: string, kg: string;
let targetWarehouse: string, targetStorage: string, targetStorageTwo: string, thirdWarehouse: string, thirdStorage: string, targetOnlyUser: string, bothUser: string;
const id = () => randomUUID();
const params = (key = id(), extra: Partial<StockDocCallParams> = {}): StockDocCallParams => ({ db, principal: { userId: A.ownerUserId, mfaVerified: true }, tenantSlug: A.slug, clientKey: key, retry: { sleep: async () => undefined }, ...extra });
async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> { return (await adm.query<T>(text, values)).rows; }
async function state(packageId: string) {
  const rows = await q<{ version: string; sequence: number; location_id: string; stock_status: string; quantity: string }>(`SELECT b.version::text,coalesce((SELECT max(sequence_no) FROM package_movement_steps WHERE tenant_id=s.tenant_id AND handling_unit_id=s.handling_unit_id),0)::int AS sequence,s.location_id,s.stock_status,b.quantity::text FROM stock_dimensions s JOIN stock_balances b ON b.tenant_id=s.tenant_id AND b.stock_dimension_id=s.id WHERE s.handling_unit_id=$1 AND b.quantity>0`, [packageId]);
  expect(rows).toHaveLength(1); return rows[0]!;
}
async function input(packageId: string) { const s = await state(packageId); return { packageId, predecessorVersion: s.sequence, currentBalanceVersion: s.version }; }
async function receipt(count = 5, extra: Record<string, unknown> = {}) {
  const prepared = await preparePackageReceipt(params(), { warehouseId: A.warehouseId, receivingLocationId: receiving, itemId: item, unitId: kg, kind: "VARIL", packages: { mode: "equal", count, quantity: "200", lotCode: "LOT-TRACE", producedOn: "2026-10-01", expiresOn: "2027-10-01" }, ...extra });
  const d = await getPackageReceipt(params(), { documentId: prepared.documentId as string });
  await postPackageReceipt(params(), { documentId: d.documentId, expectedVersion: 1 }); return d;
}
async function totals(packageId: string) {
  return (await q(`SELECT count(*)::int AS entries,sum(sl.quantity)::text AS net FROM stock_ledger sl JOIN stock_dimensions s ON s.tenant_id=sl.tenant_id AND s.id=sl.stock_dimension_id WHERE s.handling_unit_id=$1`, [packageId]))[0];
}
beforeAll(async () => {
  try {
    await admin.connect(); await admin.query(`CREATE DATABASE ${name}`);
    const direct = new URL(env.databaseUrlDirect); direct.pathname = `/${name}`; await migrateUp({ url: direct.toString() });
    adm = new pg.Client({ connectionString: direct.toString() }); await adm.connect();
    A = await seedWorld(adm, newRegistry(), "PKGTRANSFER"); B = await seedWorld(adm, newRegistry(), "PKGTRANSFEROTHER");
    receiving = id(); storage = id(); storageTwo = id(); item = id();
    for (const [location, kind] of [[receiving, "RECEIVING"], [storage, "STORAGE"], [storageTwo, "STORAGE"]]) await q("INSERT INTO locations(tenant_id,id,warehouse_id,code,name,depth,kind) VALUES($1,$2::uuid,$3,$2::text,'Movement location',0,$4)", [A.tenantId, location, A.warehouseId, kind]);
    targetWarehouse = id(); targetStorage = id(); targetStorageTwo = id(); thirdWarehouse = id(); thirdStorage = id();
    for (const w of [targetWarehouse, thirdWarehouse]) await q("INSERT INTO warehouses(tenant_id,id,code,name) VALUES($1,$2::uuid,$2::text,'Target warehouse')", [A.tenantId,w]);
    for (const [l,w] of [[targetStorage,targetWarehouse],[targetStorageTwo,targetWarehouse],[thirdStorage,thirdWarehouse]]) await q("INSERT INTO locations(tenant_id,id,warehouse_id,code,name,depth,kind) VALUES($1,$2::uuid,$3,$2::text,'Target storage',0,'STORAGE')", [A.tenantId,l,w]);
    await q("INSERT INTO membership_warehouse_scopes(tenant_id,membership_id,warehouse_id) VALUES($1,$2,$3)", [A.tenantId,A.memberMembershipId,A.warehouseId]);
    targetOnlyUser = await mkUser(adm,newRegistry(),"Target only"); const targetMember = await mkMembership(adm,A.tenantId,targetOnlyUser,{roles:["PICKER"]});
    await q("INSERT INTO membership_warehouse_scopes(tenant_id,membership_id,warehouse_id) VALUES($1,$2,$3)", [A.tenantId,targetMember,targetWarehouse]);
    bothUser = await mkUser(adm,newRegistry(),"Both warehouses"); const bothMember = await mkMembership(adm,A.tenantId,bothUser,{roles:["PICKER"]});
    for (const w of [A.warehouseId,targetWarehouse,thirdWarehouse]) await q("INSERT INTO membership_warehouse_scopes(tenant_id,membership_id,warehouse_id) VALUES($1,$2,$3)", [A.tenantId,bothMember,w]);
    kg = id(); await q("INSERT INTO units(tenant_id,id,code,name) VALUES($1,$2,'KG','Kilogram')", [A.tenantId,kg]);
    await q("INSERT INTO items(tenant_id,id,code,name,base_unit_id,tracking_mode,quantity_scale) VALUES($1,$2::uuid,$2::text,'Granule KG',$3,'LOT',3)", [A.tenantId, item, kg]);
    await q("UPDATE tenant_settings SET receiving_qc_enabled=true WHERE tenant_id=$1", [A.tenantId]);
    const app = new URL(env.databaseUrl); app.pathname = `/${name}`; app.hostname = direct.hostname; app.port = direct.port;
    db = createDbClient({ url: app.toString(), poolMax: 6, prepare: true });
  } catch (e) { throw new Error(redactErrorChain(e, secretUrls(env))); }
}, 120000);
afterAll(async () => { await db?.close(); await adm?.end(); await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await admin.end(); });

async function ready(count=1) { const d=await receipt(count); const p=d.packages[0]!; await approvePackageQuality(params(),await input(p.id)); await putawayPackage(params(),{...await input(p.id),targetLocationId:storage}); return d; }
async function snapshot() {return (await q("SELECT (SELECT count(*) FROM documents WHERE tenant_id=$1)::int AS docs,(SELECT count(*) FROM document_lines WHERE tenant_id=$1)::int AS lines,(SELECT count(*) FROM stock_ledger WHERE tenant_id=$1)::int AS ledger,(SELECT count(*) FROM stock_dimensions WHERE tenant_id=$1)::int AS dimensions,(SELECT count(*) FROM package_movement_steps WHERE tenant_id=$1)::int AS steps,(SELECT count(*) FROM stock_document_links WHERE tenant_id=$1)::int AS links,(SELECT count(*) FROM audit_logs WHERE tenant_id=$1)::int AS audits,(SELECT count(*) FROM idempotency_records WHERE tenant_id=$1 AND status='COMPLETED')::int AS completed",[A.tenantId]))[0];}
const actor=(userId:string)=>params(id(),{principal:{userId,mfaVerified:true}});
describe("T-950 physical package transfer command and current warehouse",()=>{
  it("KG5VARIL200: QC/putaway/transfer/target putaway/return retain QR and immutable origin",async()=>{
    const d=await ready(5),p=d.packages[0]!; const oldView=await getCurrentPackage(params(),{packageId:p.id});expect(oldView.canTransfer).toBe(true);
    const moved=await transferPackage(params(),{...await input(p.id),targetLocationId:targetStorage}); expect(moved.status).toBe("POSTED");expect(moved.documentNumber).toMatch(/^GRS-/);
    expect(await state(p.id)).toMatchObject({location_id:targetStorage,quantity:"200.000000",sequence:3});
    const v=await resolveCurrentPackageQr(params(),{qr:p.qr});expect(v).toMatchObject({warehouseId:targetWarehouse,currentLocation:{id:targetStorage},id:p.id,qr:p.qr,currentBaseQuantity:"200.000000",lotId:p.lotId,lotCode:p.lotCode,producedOn:p.producedOn,expiresOn:p.expiresOn,canTransfer:true,allowedActions:["PUTAWAY"]});
    const step=(await q("SELECT * FROM package_movement_steps WHERE handling_unit_id=$1 AND operation='WAREHOUSE_TRANSFER'",[p.id]))[0]!;
    expect(step.document_id).toBe(moved.documentId);expect(step.sequence_no).toBe(3);
    const documents=await q("SELECT id,kind,status,warehouse_id,number FROM documents WHERE id=ANY($1::uuid[]) ORDER BY kind",[[step.source_document_id,step.document_id]]);
    expect(documents).toHaveLength(2);expect(documents.every(x=>x.status==='POSTED'&&typeof x.number==='string')).toBe(true);
    expect(documents.find(x=>x.kind==='STOCK_OUT')?.warehouse_id).toBe(A.warehouseId);expect(documents.find(x=>x.kind==='STOCK_IN')?.warehouse_id).toBe(targetWarehouse);
    expect((await q("SELECT count(*)::int AS n FROM stock_document_links WHERE source_document_id=$1 AND target_document_id=$2 AND kind='TRANSFER'",[step.source_document_id,step.document_id]))[0]?.n).toBe(1);
    expect((await q("SELECT count(*)::int AS n,sum(quantity)::text AS net FROM stock_ledger WHERE document_id=ANY($1::uuid[])",[[step.source_document_id,step.document_id]]))[0]).toEqual({n:2,net:"0.000000"});
    expect((await q("SELECT count(*)::int AS n FROM audit_logs WHERE entity_id=ANY($1::text[]) AND action='stock_document.posted'",[[step.source_document_id,step.document_id]]))[0]?.n).toBe(2);
    expect((await q("SELECT b.quantity::text FROM stock_balances b JOIN stock_dimensions s ON s.tenant_id=b.tenant_id AND s.id=b.stock_dimension_id WHERE s.handling_unit_id=$1 AND s.location_id=$2 AND s.stock_status='AVAILABLE'",[p.id,storage]))[0]?.quantity).toBe("0.000000");
    for(const other of d.packages.slice(1))expect(await totals(other.id)).toEqual({entries:1,net:"200.000000"});
    await putawayPackage(params(),{...await input(p.id),targetLocationId:targetStorageTwo});expect((await getCurrentPackage(params(),{packageId:p.id})).warehouseId).toBe(targetWarehouse);
    await transferPackage(params(),{...await input(p.id),targetLocationId:storageTwo});expect((await getCurrentPackage(params(),{packageId:p.id})).warehouseId).toBe(A.warehouseId);
    const origin=await getPackageReceipt(params(),{documentId:d.documentId});expect(origin.warehouseId).toBe(A.warehouseId);expect(origin.packages).toEqual(d.packages);expect(await totals(p.id)).toEqual({entries:11,net:"200.000000"});
  });
  it("same-key concurrent transfer and lost-reply retry create one document pair, step and two audits",async()=>{
    const p=(await ready()).packages[0]!,v={...await input(p.id),targetLocationId:targetStorage},call=params();
    const [a,b]=await Promise.all([transferPackage(call,v),transferPackage(call,v)]);expect(a.documentId).toBe(b.documentId);expect([a.replayed,b.replayed].sort()).toEqual([false,true]);
    const before=await snapshot();expect(await transferPackage(call,v)).toMatchObject({documentId:a.documentId,replayed:true});expect(await snapshot()).toEqual(before);
    expect((await q("SELECT count(*)::int AS n FROM package_movement_steps WHERE handling_unit_id=$1 AND operation='WAREHOUSE_TRANSFER'",[p.id]))[0]?.n).toBe(1);
    await expect(transferPackage(call,{...v,targetLocationId:thirdStorage})).rejects.toMatchObject({code:"IDEMPOTENCY_MISMATCH"});
  });
  it("source-only/target-only scope cannot transfer; current warehouse alone authorizes metadata after transfer",async()=>{
    const p=(await ready()).packages[0]!,v={...await input(p.id),targetLocationId:targetStorage},prior=process.env.WAREHOUSE_SCOPE_ENABLED;process.env.WAREHOUSE_SCOPE_ENABLED="true";
    try {
      await expect(transferPackage(actor(A.memberUserId),v)).rejects.toMatchObject({code:"FORBIDDEN",detail:"WAREHOUSE_OUT_OF_SCOPE"});
      await expect(transferPackage(actor(targetOnlyUser),v)).rejects.toMatchObject({code:"FORBIDDEN",detail:"WAREHOUSE_OUT_OF_SCOPE"});
      await transferPackage(actor(bothUser),v);
      await expect(getCurrentPackage(actor(A.memberUserId),{packageId:p.id})).rejects.toMatchObject({code:"NOT_FOUND"});
      expect(await getCurrentPackage(actor(targetOnlyUser),{packageId:p.id})).toMatchObject({warehouseId:targetWarehouse,canTransfer:true});
      await putawayPackage(actor(targetOnlyUser),{...await input(p.id),targetLocationId:targetStorageTwo});
    } finally {if(prior===undefined)delete process.env.WAREHOUSE_SCOPE_ENABLED;else process.env.WAREHOUSE_SCOPE_ENABLED=prior;}
  });
  it("stale versions, foreign tenant, no MFA, quarantine and invalid destination fail safely",async()=>{
    const p=(await ready()).packages[0]!,v={...await input(p.id),targetLocationId:targetStorage},before=await snapshot();
    await expect(transferPackage(params(),{...v,predecessorVersion:v.predecessorVersion-1})).rejects.toMatchObject({code:"VERSION_CONFLICT"});
    await expect(transferPackage(params(),{...v,currentBalanceVersion:"0"})).rejects.toMatchObject({code:"VERSION_CONFLICT"});
    await expect(transferPackage(params(id(),{principal:{userId:A.ownerUserId,mfaVerified:false}}),v)).rejects.toMatchObject({code:"FORBIDDEN",detail:"MFA_REQUIRED"});
    await expect(transferPackage(params(id(),{tenantSlug:B.slug,principal:{userId:B.ownerUserId,mfaVerified:true}}),v)).rejects.toMatchObject({code:"NOT_FOUND"});
    for(const targetLocationId of [storage,B.rootLocationId,receiving])await expect(transferPackage(params(),{...v,targetLocationId})).rejects.toBeDefined();
    expect(await snapshot()).toEqual(before);
    const quarantined=(await receipt(1)).packages[0]!;await expect(transferPackage(params(),{...await input(quarantined.id),targetLocationId:targetStorage})).rejects.toMatchObject({code:"VERSION_CONFLICT"});
  });
  it("COUNTING target blocks both documents and preserves whole source package",async()=>{
    const p=(await ready()).packages[0]!,v={...await input(p.id),targetLocationId:targetStorage},session=id(),before=await snapshot();
    await q("INSERT INTO count_sessions(tenant_id,id,warehouse_id,started_by) VALUES($1,$2,$3,$4)",[A.tenantId,session,targetWarehouse,A.ownerMembershipId]);
    await q("UPDATE location_count_locks SET status='COUNTING',count_session_id=$3,locked_at=now(),locked_by=$4 WHERE tenant_id=$1 AND location_id=$2",[A.tenantId,targetStorage,session,A.ownerMembershipId]);
    try{await expect(transferPackage(params(),v)).rejects.toMatchObject({code:"LOCATION_LOCKED"});expect(await snapshot()).toEqual(before);}finally{await q("UPDATE location_count_locks SET status='IDLE',count_session_id=NULL,locked_at=NULL,locked_by=NULL WHERE tenant_id=$1 AND location_id=$2",[A.tenantId,targetStorage]);}
    expect(await state(p.id)).toMatchObject({location_id:storage,quantity:"200.000000"});
  });
  it("real reservation prevents whole-HU transfer and clears canTransfer",async()=>{
    const d=await ready(),p=d.packages[0]!,draft=await createStockDocument(params(),{kind:"STOCK_OUT",warehouseId:A.warehouseId,businessDate:"2026-10-14",lines:[{itemId:item,unitId:kg,quantity:"10",conversionFactor:"1",baseQuantity:"10",sourceLocationId:storage,lotId:p.lotId,stockStatus:"AVAILABLE"}]});
    const line=(await q("SELECT id FROM document_lines WHERE document_id=$1",[draft.documentId]))[0]!.id as string;
    await approveDocument(params(),{documentId:draft.documentId as string,expectedVersion:1});
    await reserve(params(),{documentLineId:line,allocations:[{dimension:{locationId:storage,lotId:p.lotId,handlingUnitId:p.id,stockStatus:"AVAILABLE"},quantity:"10"}]});
    expect((await getCurrentPackage(params(),{packageId:p.id})).canTransfer).toBe(false);
    const before=await snapshot();await expect(transferPackage(params(),{...await input(p.id),targetLocationId:targetStorage})).rejects.toMatchObject({code:"VALIDATION_FAILED"});expect(await snapshot()).toEqual(before);
    expect(await state(p.id)).toMatchObject({location_id:storage,quantity:"200.000000"});
  });
  it("expired snapshot remains informational under existing policy; transfer never rewrites its dates",async()=>{
    const d=await receipt(1,{packages:{mode:"equal",count:1,quantity:"200",lotCode:"EXPIRED",producedOn:"2020-01-01",expiresOn:"2020-02-01"}}),p=d.packages[0]!;
    await approvePackageQuality(params(),await input(p.id));expect((await getCurrentPackage(params(),{packageId:p.id})).canTransfer).toBe(true);
    await transferPackage(params(),{...await input(p.id),targetLocationId:targetStorage});expect(await getCurrentPackage(params(),{packageId:p.id})).toMatchObject({expiresOn:"2020-02-01",producedOn:"2020-01-01",warehouseId:targetWarehouse});
  });
  for(const order of ["TRANSFER_FIRST","PUTAWAY_FIRST"] as const)it(`RR transfer/putaway shared predecessor rejects fork: ${order}`,async()=>{
    const p=(await ready()).packages[0]!,v=await input(p.id),transfer=()=>transferPackage(params(),{...v,targetLocationId:targetStorage}),putaway=()=>putawayPackage(params(),{...v,targetLocationId:storageTwo});
    const results=await Promise.allSettled(order==='TRANSFER_FIRST'?[transfer(),putaway()]:[putaway(),transfer()]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
    expect((await state(p.id)).sequence).toBe(3);expect(await totals(p.id)).toEqual({entries:7,net:"200.000000"});
  });
  it("different warehouse targets racing transfer share exactly one terminal step",async()=>{
    const p=(await ready()).packages[0]!,v=await input(p.id),results=await Promise.allSettled([transferPackage(params(),{...v,targetLocationId:targetStorage}),transferPackage(params(),{...v,targetLocationId:thirdStorage})]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);expect((await state(p.id)).sequence).toBe(3);expect(await totals(p.id)).toEqual({entries:7,net:"200.000000"});
  });
  for(const stage of ["PREPARE","STEP","FIRST_LEDGER","SECOND_LEDGER","AUDIT"] as const)it(`injected ${stage} fault rolls back docs/lines/step/link/ledger/balances/audit/idempotent success`,async()=>{
    const p=(await ready()).packages[0]!,v={...await input(p.id),targetLocationId:targetStorage},before=await snapshot();
    const table=stage==='PREPARE'?'documents':stage==='STEP'?'package_movement_steps':stage==='AUDIT'?'audit_logs':'stock_ledger';
    const condition=stage==='PREPARE'?`NEW.tenant_id='${A.tenantId}'::uuid AND NEW.reason='PACKAGE_TRANSFER'`:stage==='STEP'?`NEW.handling_unit_id='${p.id}'::uuid AND NEW.operation='WAREHOUSE_TRANSFER'`:stage==='AUDIT'?`EXISTS(SELECT 1 FROM package_movement_steps WHERE handling_unit_id='${p.id}'::uuid AND source_document_id::text=NEW.entity_id AND operation='WAREHOUSE_TRANSFER')`:`EXISTS(SELECT 1 FROM stock_dimensions s JOIN documents d ON d.tenant_id=s.tenant_id AND d.id=NEW.document_id WHERE s.id=NEW.stock_dimension_id AND s.handling_unit_id='${p.id}'::uuid AND d.kind='${stage==='FIRST_LEDGER'?'STOCK_OUT':'STOCK_IN'}')`;
    await q(`CREATE FUNCTION t950_fault() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF ${condition} THEN RAISE EXCEPTION 'T950 synthetic fault' USING ERRCODE='P0001'; END IF; RETURN NEW; END$$`);
    await q(`CREATE TRIGGER t950_fault BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION t950_fault()`);
    try{let caught:unknown;try{await transferPackage(params(),v);}catch(e){caught=e;}expect(caught).toBeDefined();let cur:unknown=caught,marker=false;for(let depth=0;depth<5&&cur instanceof Error;depth++){if(redactErrorChain(cur,secretUrls(env)).includes("T950 synthetic fault"))marker=true;cur=(cur as Error&{cause?:unknown}).cause;}expect(marker).toBe(true);}finally{await q(`DROP TRIGGER t950_fault ON ${table}`);await q("DROP FUNCTION t950_fault()");}
    expect(await snapshot()).toEqual(before);expect(await state(p.id)).toMatchObject({location_id:storage,sequence:2,quantity:"200.000000"});expect(await totals(p.id)).toEqual({entries:5,net:"200.000000"});
    expect((await transferPackage(params(),v)).status).toBe("POSTED");
  });
});
{
const valid={packageId:id(),targetLocationId:id(),predecessorVersion:0,currentBalanceVersion:"9223372036854775807"};
describe("T947 strict transfer parser before any DB access",()=>{
 it("bigint string and immutable IDs remain exact",()=>{expect(parsePackageTransferInput(valid)).toEqual(valid);});
 for(const key of ["tenantId","quantity","factor","itemId","lotId","sourceLocationId","sourceWarehouseId","clientKey","documentId","sourceKind"])it(`rejects client ${key}`,()=>{expect(()=>parsePackageTransferInput({...valid,[key]:id()})).toThrow();});
 it("rejects malformed and overflowing versions and destination",()=>{for(const currentBalanceVersion of ["01","1.1",1,"9223372036854775808"])expect(()=>parsePackageTransferInput({...valid,currentBalanceVersion})).toThrow();for(const predecessorVersion of [-1,1.1,"1",2147483647])expect(()=>parsePackageTransferInput({...valid,predecessorVersion})).toThrow();expect(()=>parsePackageTransferInput({...valid,targetLocationId:""})).toThrow();});
});
}
