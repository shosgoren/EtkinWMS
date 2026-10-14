import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateDown, migrateUp } from "../../../packages/db/src/migrate.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv, redactErrorChain, secretUrls } from "../harness/env.ts";

describe("T932 origin fixtures (separate scratch)",()=>{
const env = readIntEnv(process.env);
const name = `wms_packages_${randomBytes(6).toString("hex")}`;
const admin = new pg.Client({ connectionString: env.databaseUrlDirect });
let migration: pg.Client;
let app: pg.Client;
let world: TenantWorld;
let other: TenantWorld;
let direct: string;
let appUrl: string;
let legacyReceipt: string;
const receipt = randomUUID(), receiptLine = randomUUID(), document = randomUUID(), line = randomUUID(), hu = randomUUID(), dimension = randomUUID();
const dbUrl = (url: string) => { const u = new URL(url); u.pathname = `/${name}`; return u; };
async function transaction(run: () => Promise<void>) {
  await app.query("BEGIN");
  try { await app.query("SELECT set_config('app.current_tenant_id',$1,true)",[world.tenantId]); await run(); }
  finally { await app.query("ROLLBACK"); }
}
async function flush() { await app.query("SET CONSTRAINTS ALL IMMEDIATE"); }
interface FixtureIds { receipt: string; receiptLine: string; document: string; line: string; hu: string }
async function fixture(opts: { receiptId?: string; itemId?: string; handlingUnitId?: string; sourceLineId?: string; packageNo?: number; packageTenant?: string; receiptItemId?: string; lotId?: string; ids?: FixtureIds; noDates?: boolean; existingHu?: boolean; markerReceiptId?: string } = {}) {
  const t=world.tenantId;
  const ids=opts.ids ?? {receipt,receiptLine,document,line,hu};
  if (!opts.existingHu) await app.query("INSERT INTO public.handling_units(tenant_id,id,kind,code,package_receipt_id) VALUES($1,$2,'VARIL',$3,$4)",[t,ids.hu,ids.hu,opts.markerReceiptId ?? ids.receipt]);
  await app.query("INSERT INTO public.inbound_receipts(tenant_id,id,warehouse_id,number,created_by,package_document_id) VALUES($1,$2,$3,$4,$5,$6)",[t,ids.receipt,world.warehouseId,ids.receipt,world.ownerUserId,ids.document]);
  await app.query("INSERT INTO public.documents(tenant_id,id,kind,type_version_id,warehouse_id,business_date,created_by,source_kind,source_id) SELECT $1,$2,'STOCK_IN',id,$3,'2026-10-13',$4,'INBOUND_RECEIPT',$5 FROM public.document_type_versions WHERE tenant_id IS NULL AND key='STOCK_IN' AND version=1",[t,ids.document,world.warehouseId,world.ownerUserId,ids.receipt]);
  await app.query("INSERT INTO public.inbound_receipt_lines(tenant_id,id,receipt_id,line_no,item_id,unit_id,conversion_factor,expected_quantity) VALUES($1,$2,$3,1,$4,$5,2,3)",[t,ids.receiptLine,ids.receipt,opts.receiptItemId ?? world.itemNoneId,world.unitId]);
  await app.query("INSERT INTO public.document_lines(tenant_id,id,document_id,line_no,item_id,unit_id,quantity,conversion_factor,base_quantity,target_location_id,handling_unit_id,source_line_id,lot_id) VALUES($1,$2,$3,1,$4,$5,3,2,6,$6,$7,$8,$9)",[t,ids.line,ids.document,opts.itemId ?? world.itemNoneId,world.unitId,world.rootLocationId,opts.handlingUnitId ?? ids.hu,opts.sourceLineId ?? ids.receiptLine,opts.lotId ?? null]);
  await app.query("INSERT INTO public.receipt_packages(tenant_id,id,receipt_id,receipt_line_id,document_id,document_line_id,package_no,lot_code,produced_on,expires_on,catalog_lot_id) VALUES($1,$2,$3,$4,$5,$6,$7,'PHYSICAL-LOT',$9,$10,$8)",[opts.packageTenant ?? t,ids.hu,opts.receiptId ?? ids.receipt,ids.receiptLine,ids.document,ids.line,opts.packageNo ?? 1, opts.lotId ?? null,opts.noDates ? null : "2026-10-01",opts.noDates ? null : "2027-10-01"]);
}
async function post(quantities:readonly number[]=[6]) {
  await app.query("INSERT INTO public.stock_dimensions(tenant_id,id,item_id,location_id,handling_unit_id,stock_status) VALUES($1,$2,$3,$4,$5,'AVAILABLE')",[world.tenantId,dimension,world.itemNoneId,world.rootLocationId,hu]);
  for(const quantity of quantities) await app.query("INSERT INTO public.stock_ledger(tenant_id,document_id,document_line_id,stock_dimension_id,quantity,reason,business_date) VALUES($1,$2,$3,$4,$5,'Synthetic package acceptance','2026-10-13')",[world.tenantId,document,line,dimension,quantity]);
  await app.query("INSERT INTO public.stock_balances(tenant_id,stock_dimension_id,quantity) VALUES($1,$2,6)",[world.tenantId,dimension]);
  await app.query("UPDATE public.inbound_receipt_lines SET received_quantity=3 WHERE tenant_id=$1 AND id=$2",[world.tenantId,receiptLine]);
  await app.query("UPDATE public.inbound_receipts SET status='CLOSED' WHERE tenant_id=$1 AND id=$2",[world.tenantId,receipt]);
  await app.query("UPDATE public.documents SET status='POSTED',number='PACKAGE-TEST-1' WHERE tenant_id=$1 AND id=$2",[world.tenantId,document]);
}
beforeAll(async () => {
  try {
    await admin.connect(); await admin.query(`CREATE DATABASE ${name}`);
    direct=dbUrl(env.databaseUrlDirect).toString();
    migration=new pg.Client({connectionString:direct}); await migration.connect();
    await migrateUp({url:direct});
    world=await seedWorld(migration,newRegistry(),"PACKAGES");
    other=await seedWorld(migration,newRegistry(),"PACKAGESOTHER");
    legacyReceipt=(await migration.query<{id: string}>("SELECT id FROM public.inbound_receipts WHERE tenant_id=$1 LIMIT 1",[world.tenantId])).rows[0]!.id;
    const u=dbUrl(env.databaseUrl), endpoint=new URL(direct); u.hostname=endpoint.hostname; u.port=endpoint.port;
    appUrl=u.toString();
    app=new pg.Client({connectionString:appUrl}); await app.connect();
    expect((await app.query("SELECT current_user AS role")).rows[0]?.role).toBe("wms_app");
  } catch(e) { throw new Error(redactErrorChain(e,secretUrls(env))); }
},120000);
afterAll(async () => {
  await app?.end(); await migration?.end();
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await admin.end();
});
describe("T-932 immutable package origins (isolated scratch, runtime role)",()=> {
  it("empty35→31→35 keeps old tables and schema ledger",async()=> {
    expect((await migrateDown({url:direct,to:"0031",wmsEnv:"staging"})).reverted).toEqual(["0035","0034","0033","0032"]);
    expect((await migration.query("SELECT to_regclass('public.receipt_packages') AS table")).rows[0]?.table).toBeNull();
    expect((await migrateUp({url:direct})).applied).toEqual(["0032","0033","0034","0035"]);
  });
  for (const [label, options] of [
    ["same tenant wrong receipt", () => ({receiptId: legacyReceipt})],
    ["same tenant wrong item", () => ({itemId: world.itemId})],
    ["same tenant wrong HU", () => ({handlingUnitId: world.handlingUnitId})],
    ["wrong source line", () => ({sourceLineId: randomUUID()})],
    ["package number0", () => ({packageNo: 0})],
    ["package number201", () => ({packageNo: 201})],
    ["cross tenant package", () => ({packageTenant: other.tenantId})],
  ] as const) it(`rejects ${label}`, async()=>transaction(async()=> {
    await expect((async()=> {await fixture(options()); await flush();})()).rejects.toMatchObject({code: expect.stringMatching(/23514|23503|42501/)});
  }));
  it("source-before-parent is rejected immediately before a future package binding",async()=>transaction(async()=> {
    await expect(app.query("INSERT INTO public.documents(tenant_id,id,kind,type_version_id,warehouse_id,business_date,created_by,source_kind,source_id) SELECT $1,$2,'STOCK_IN',id,$3,'2026-10-13',$4,'INBOUND_RECEIPT',$5 FROM public.document_type_versions WHERE tenant_id IS NULL AND key='STOCK_IN' AND version=1",[world.tenantId,randomUUID(),world.warehouseId,world.ownerUserId,receipt])).rejects.toMatchObject({code:"23514",message:"PACKAGE_SOURCE_RECEIPT_REQUIRED"});
  }));
  it("LOT snapshot commits and catalog expiry mutation is rejected", async()=>transaction(async()=> {
    const item=randomUUID(),lot=randomUUID();
    await app.query("INSERT INTO public.items(tenant_id,id,code,name,base_unit_id,tracking_mode) VALUES($1,$2,$3,'Lot item',$4,'LOT')",[world.tenantId,item,item,world.unitId]);
    await app.query("INSERT INTO public.lots(tenant_id,id,item_id,lot_code,production_date,expiry_date) VALUES($1,$2,$3,'PHYSICAL-LOT','2026-10-01','2027-10-01')",[world.tenantId,lot,item]);
    await fixture({itemId:item,receiptItemId:item,lotId:lot}); await flush();
    await expect(app.query("UPDATE public.lots SET expiry_date='2028-10-01' WHERE id=$1",[lot])).rejects.toMatchObject({code:"23514"});
  }));

  it("nullable catalog dates are a nonnull FK key, preserving NULL element equality",async()=>transaction(async()=> {
    expect((await app.query("SELECT ARRAY[NULL::date,NULL::date] = ARRAY[NULL::date,NULL::date] AS equal, ARRAY[NULL::date,NULL::date] = ARRAY[NULL::date,'2027-10-01'::date] AS different")).rows[0]).toEqual({equal:true,different:false});
    const item=randomUUID(),lot=randomUUID();
    await app.query("INSERT INTO public.items(tenant_id,id,code,name,base_unit_id,tracking_mode) VALUES($1,$2,$3,'Nullable dates',$4,'LOT')",[world.tenantId,item,item,world.unitId]);
    await app.query("INSERT INTO public.lots(tenant_id,id,item_id,lot_code) VALUES($1,$2,$3,'PHYSICAL-LOT')",[world.tenantId,lot,item]);
    await fixture({itemId:item,receiptItemId:item,lotId:lot,noDates:true}); await flush();
    expect((await app.query("SELECT package_dates::text AS dates FROM public.receipt_packages WHERE id=$1",[hu])).rows[0]?.dates).toBe("{NULL,NULL}");
    await expect(app.query("UPDATE public.lots SET expiry_date='2028-10-01' WHERE id=$1",[lot])).rejects.toMatchObject({code:"23514"});
  }));
  it("nullable package dates cannot bypass a concrete catalog snapshot FK",async()=>transaction(async()=> {
    const item=randomUUID(),lot=randomUUID();
    await app.query("INSERT INTO public.items(tenant_id,id,code,name,base_unit_id,tracking_mode) VALUES($1,$2,$3,'Concrete dates',$4,'LOT')",[world.tenantId,item,item,world.unitId]);
    await app.query("INSERT INTO public.lots(tenant_id,id,item_id,lot_code,production_date,expiry_date) VALUES($1,$2,$3,'PHYSICAL-LOT','2026-10-01','2027-10-01')",[world.tenantId,lot,item]);
    await expect(fixture({itemId:item,receiptItemId:item,lotId:lot,noDates:true})).rejects.toMatchObject({code:"23503"});
  }));
  it("valid NONE physical metadata snapshot commits with no on-hand",async()=> {
    await app.query("BEGIN");
    try {
      await app.query("SELECT set_config('app.current_tenant_id',$1,true)",[world.tenantId]); await fixture(); await app.query("COMMIT");
      await app.query("BEGIN"); await app.query("SELECT set_config('app.current_tenant_id',$1,true)",[world.tenantId]);
      expect((await app.query("SELECT lot_code,produced_on::text FROM public.receipt_packages WHERE id=$1",[hu])).rows[0]).toEqual({lot_code:"PHYSICAL-LOT",produced_on:"2026-10-01"});
      expect((await app.query("SELECT count(*)::int AS n FROM public.stock_dimensions WHERE handling_unit_id=$1",[hu])).rows[0]?.n).toBe(0);
    } finally { await app.query("ROLLBACK"); }
  });
  // Persisted draft identity is used by every mutation/post probe below.
  for(const [label,sql] of [
    ["draft quantity edit","UPDATE public.document_lines SET quantity=4 WHERE id=$1"],
    ["draft delete","DELETE FROM public.document_lines WHERE id=$1"],
    ["header warehouse edit","UPDATE public.documents SET warehouse_id=NULL WHERE id=$1"],
    ["receipt expected edit","UPDATE public.inbound_receipt_lines SET expected_quantity=4 WHERE id=$1"],
    ["legacy receive counter bypass","UPDATE public.inbound_receipt_lines SET received_quantity=1 WHERE id=$1"],
    ["damaged counter bypass","UPDATE public.inbound_receipt_lines SET damaged_quantity=1,received_quantity=1 WHERE id=$1"],
    ["generic post bypass","UPDATE public.documents SET status='POSTED',number='PACKAGE-TEST-1' WHERE id=$1"],
    ["binding update grant","UPDATE public.inbound_receipts SET package_document_id=NULL WHERE id=$1"],
    ["metadata update grant","UPDATE public.receipt_packages SET lot_code='EDIT' WHERE id=$1"],
    ["metadata delete grant","DELETE FROM public.receipt_packages WHERE id=$1"],
  ] as const) it(`rejects ${label}`,async()=>transaction(async()=> {
    const id=sql.includes("public.document_lines")?line:sql.includes("public.documents")?document:sql.includes("public.inbound_receipt_lines")?receiptLine:sql.includes("public.inbound_receipts")?receipt:hu;
    await expect((async()=> {await app.query(sql,[id]); await flush();})()).rejects.toMatchObject({code: expect.stringMatching(/23514|42501|23502/)});
  }));
  it("metadata triggers also reject privileged raw UPDATE and TRUNCATE",async()=> {
    await migration.query("BEGIN");
    try {
      await migration.query("SELECT set_config('app.current_tenant_id',$1,true)",[world.tenantId]);
      await expect(migration.query("UPDATE public.receipt_packages SET lot_code='RAW' WHERE id=$1",[hu])).rejects.toMatchObject({code:"23514"});
    } finally { await migration.query("ROLLBACK"); }
    await migration.query("BEGIN");
    try { await expect(migration.query("TRUNCATE public.receipt_packages")).rejects.toMatchObject({code:"0A000"}); }
    finally { await migration.query("ROLLBACK"); }
    expect((await migration.query("SELECT rp.id,h.package_receipt_id FROM public.receipt_packages rp JOIN public.handling_units h ON h.tenant_id=rp.tenant_id AND h.id=rp.id WHERE rp.id=$1",[hu])).rows).toEqual([{id:hu,package_receipt_id:receipt}]);
    await migration.query("BEGIN");
    // Reciprocal FK rejects ordinary TRUNCATE before triggers; CASCADE still reaches the immutable-table guard.
    try { await expect(migration.query("TRUNCATE public.receipt_packages CASCADE")).rejects.toMatchObject({code:"23514",message:"PACKAGE_IMMUTABLE"}); }
    finally { await migration.query("ROLLBACK"); }
    expect((await migration.query("SELECT rp.id,h.package_receipt_id FROM public.receipt_packages rp JOIN public.handling_units h ON h.tenant_id=rp.tenant_id AND h.id=rp.id WHERE rp.id=$1",[hu])).rows).toEqual([{id:hu,package_receipt_id:receipt}]);
  });
  it("runtime has no UPDATE DELETE TRUNCATE on package metadata and FORCE RLS",async()=> {
    const r=await migration.query("SELECT relrowsecurity,relforcerowsecurity,has_table_privilege('wms_app','public.receipt_packages','UPDATE') AS upd,has_table_privilege('wms_app','public.receipt_packages','DELETE') AS del,has_table_privilege('wms_app','public.receipt_packages','TRUNCATE') AS trunc FROM pg_class WHERE oid='public.receipt_packages'::regclass");
    expect(r.rows[0]).toEqual({relrowsecurity:true,relforcerowsecurity:true,upd:false,del:false,trunc:false});
  });
  it("cross-tenant cannot see stored identity",async()=>transaction(async()=> {
    await app.query("SELECT set_config('app.current_tenant_id',$1,true)",[other.tenantId]);
    expect((await app.query("SELECT id FROM public.receipt_packages WHERE id=$1",[hu])).rowCount).toBe(0);
  }));
  it("deferred queued check rejects context switch",async()=>transaction(async()=> {
    await app.query("UPDATE public.inbound_receipt_lines SET received_quantity=0 WHERE id=$1",[receiptLine]);
    await app.query("SELECT set_config('app.current_tenant_id',$1,true)",[other.tenantId]);
    await expect(flush()).rejects.toMatchObject({code:"23514"});
  }));
  it("atomic counters, CLOSED header and origin ledger post together",async()=>transaction(async()=> {
    await post(); await flush();
    expect((await app.query("SELECT quantity::text FROM public.stock_balances WHERE stock_dimension_id=$1",[dimension])).rows[0]?.quantity).toBe("6.000000");
  }));
  it("allows posted reversal bookkeeping within origin amount",async()=>transaction(async()=> {
    await post(); await app.query("UPDATE public.document_lines SET reversed_quantity=1,reversal_status='PARTIAL' WHERE id=$1",[line]); await flush();
    expect((await app.query("SELECT reversed_quantity::text FROM public.document_lines WHERE id=$1",[line])).rows[0]?.reversed_quantity).toBe("1.000000");
  }));
  it("rejects excessive reversal bookkeeping",async()=>transaction(async()=> {
    await post(); await expect((async()=> {await app.query("UPDATE public.document_lines SET reversed_quantity=7,reversal_status='FULL' WHERE id=$1",[line]); await flush();})()).rejects.toMatchObject({code:"23514"});
  }));
  it("rejects non-origin negative ledger on mapped HU",async()=>transaction(async()=> {
    await post();
    await app.query("INSERT INTO public.stock_ledger(tenant_id,document_id,document_line_id,stock_dimension_id,quantity,reason,business_date) VALUES($1,$2,$3,$4,-1,'Unsupported movement','2026-10-13')",[world.tenantId,document,line,dimension]);
    await app.query("UPDATE public.stock_balances SET quantity=5 WHERE stock_dimension_id=$1",[dimension]);
    await expect(flush()).rejects.toMatchObject({code:"23514"});
  }));
  for(const kind of ["STOCK_IN","STOCK_MOVE","STOCK_OUT","COUNT_ADJUSTMENT","REVERSAL"] as const) it(`rejects generic ${kind} ledger for a mapped HU`,async()=>transaction(async()=> {
    await post();
    const genericDocument=randomUUID(),genericLine=randomUUID();
    await app.query("INSERT INTO public.documents(tenant_id,id,kind,type_version_id,warehouse_id,business_date,created_by,reversal_of_document_id) SELECT $1,$2,$3,id,$4,'2026-10-13',$5,$6 FROM public.document_type_versions WHERE tenant_id IS NULL AND key=$3 AND version=1",[world.tenantId,genericDocument,kind,world.warehouseId,world.ownerUserId,kind==="REVERSAL"?document:null]);
    await app.query("INSERT INTO public.document_lines(tenant_id,id,document_id,line_no,item_id,unit_id,quantity,conversion_factor,base_quantity,source_location_id,handling_unit_id) VALUES($1,$2,$3,1,$4,$5,1,1,1,$6,$7)",[world.tenantId,genericLine,genericDocument,world.itemNoneId,world.unitId,world.rootLocationId,hu]);
    await app.query("INSERT INTO public.stock_ledger(tenant_id,document_id,document_line_id,stock_dimension_id,quantity,reason,business_date) VALUES($1,$2,$3,$4,1,'Unsupported generic origin','2026-10-13')",[world.tenantId,genericDocument,genericLine,dimension]);
    await app.query("UPDATE public.stock_balances SET quantity=7 WHERE stock_dimension_id=$1",[dimension]);
    await expect(flush()).rejects.toMatchObject({code:"23514",message:"PACKAGE_LEDGER_ORIGIN_ONLY"});
  }));
  it("rejects extra unmapped legacy receipt row",async()=>transaction(async()=> {
    await app.query("INSERT INTO public.inbound_receipt_lines(tenant_id,id,receipt_id,line_no,item_id,unit_id,conversion_factor,expected_quantity) VALUES($1,$2,$3,2,$4,$5,1,1)",[world.tenantId,randomUUID(),receipt,world.itemNoneId,world.unitId]);
    await expect(flush()).rejects.toMatchObject({code:"23514",message:"PACKAGE_LINE_COVERAGE"});
  }));
  it("pending origin cannot create on-hand even with reconciled ledger",async()=>transaction(async()=> {
    await app.query("INSERT INTO public.stock_dimensions(tenant_id,id,item_id,location_id,handling_unit_id,stock_status) VALUES($1,$2,$3,$4,$5,'AVAILABLE')",[world.tenantId,dimension,world.itemNoneId,world.rootLocationId,hu]);
    await app.query("INSERT INTO public.stock_ledger(tenant_id,document_id,document_line_id,stock_dimension_id,quantity,reason,business_date) VALUES($1,$2,$3,$4,6,'Premature acceptance','2026-10-13')",[world.tenantId,document,line,dimension]);
    await app.query("INSERT INTO public.stock_balances(tenant_id,stock_dimension_id,quantity) VALUES($1,$2,6)",[world.tenantId,dimension]);
    await expect(flush()).rejects.toMatchObject({code:"23514",message:"PACKAGE_LEDGER_QUANTITY"});
  }));
  it("generic source-bound document cannot bypass the sealed receipt origin",async()=>transaction(async()=> {
    await expect(app.query("INSERT INTO public.documents(tenant_id,id,kind,type_version_id,warehouse_id,business_date,created_by,source_kind,source_id) SELECT $1,$2,'STOCK_IN',id,$3,'2026-10-13',$4,'INBOUND_RECEIPT',$5 FROM public.document_type_versions WHERE tenant_id IS NULL AND key='STOCK_IN' AND version=1",[world.tenantId,randomUUID(),world.warehouseId,world.ownerUserId,receipt])).rejects.toMatchObject({code:"23514",message:"PACKAGE_SOURCE_DOCUMENT_BYPASS"});
  }));
  it("legacy NULL binding cannot be upgraded even by the migration owner",async()=> {
    await migration.query("BEGIN");
    try {
      await migration.query("SELECT set_config('app.current_tenant_id',$1,true)",[world.tenantId]);
      await expect(migration.query("UPDATE public.inbound_receipts SET package_document_id=$1 WHERE tenant_id=$2 AND id=$3",[document,world.tenantId,legacyReceipt])).rejects.toMatchObject({code:"23514",message:"PACKAGE_BINDING_IMMUTABLE"});
    } finally { await migration.query("ROLLBACK"); }
    expect((await migration.query("SELECT package_document_id FROM public.inbound_receipts WHERE id=$1",[legacyReceipt])).rows[0]?.package_document_id).toBeNull();
  });
  it("real legacy receipt keeps multiple partial IN documents and QC MOVE source documents",async()=>transaction(async()=> {
    for(const kind of ["STOCK_IN","STOCK_IN","STOCK_MOVE"]) await app.query("INSERT INTO public.documents(tenant_id,id,kind,type_version_id,warehouse_id,business_date,created_by,source_kind,source_id) SELECT $1,$2,$3,id,$4,'2026-10-13',$5,'INBOUND_RECEIPT',$6 FROM public.document_type_versions WHERE tenant_id IS NULL AND key=$3 AND version=1",[world.tenantId,randomUUID(),kind,world.warehouseId,world.ownerUserId,legacyReceipt]);
    await flush();
    expect((await app.query("SELECT kind,count(*)::int AS n FROM public.documents WHERE tenant_id=$1 AND source_kind='INBOUND_RECEIPT' AND source_id=$2 GROUP BY kind ORDER BY kind",[world.tenantId,legacyReceipt])).rows).toEqual([{kind:"STOCK_IN",n:2},{kind:"STOCK_MOVE",n:1}]);
  }));
  for(const order of ["parent uncommitted","parent committed after source snapshot"] as const) it(`RR source race rejects ${order} without posting outside origin`,async()=> {
    const racer=new pg.Client({connectionString:appUrl}); await racer.connect();
    const ids={receipt:randomUUID(),receiptLine:randomUUID(),document:randomUUID(),line:randomUUID(),hu:randomUUID()};
    try {
      for(const c of [app,racer]) {
        await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
        await c.query("SELECT set_config('app.current_tenant_id',$1,true)",[world.tenantId]);
        expect((await c.query("SELECT id FROM public.inbound_receipts WHERE id=$1",[ids.receipt])).rowCount).toBe(0);
      }
      await fixture({ids}); await flush();
      if(order==="parent committed after source snapshot") await app.query("COMMIT");
      // T2 has no visible parent in either schedule, including after T1 commits under RR.
      expect((await racer.query("SELECT id FROM public.inbound_receipts WHERE id=$1",[ids.receipt])).rowCount).toBe(0);
      await expect(racer.query("INSERT INTO public.documents(tenant_id,id,kind,type_version_id,warehouse_id,business_date,created_by,source_kind,source_id) SELECT $1,$2,'STOCK_IN',id,$3,'2026-10-13',$4,'INBOUND_RECEIPT',$5 FROM public.document_type_versions WHERE tenant_id IS NULL AND key='STOCK_IN' AND version=1",[world.tenantId,randomUUID(),world.warehouseId,world.ownerUserId,ids.receipt])).rejects.toMatchObject({code:"23514",message:"PACKAGE_SOURCE_RECEIPT_REQUIRED"});
      await racer.query("ROLLBACK");
      if(order==="parent uncommitted") await app.query("COMMIT");
      expect((await migration.query("SELECT id FROM public.documents WHERE tenant_id=$1 AND source_kind='INBOUND_RECEIPT' AND source_id=$2",[world.tenantId,ids.receipt])).rows).toEqual([{id:ids.document}]);
      expect((await migration.query("SELECT count(*)::int AS n FROM public.stock_ledger WHERE tenant_id=$1 AND document_id=$2",[world.tenantId,ids.document])).rows[0]?.n).toBe(0);
    } finally { await app.query("ROLLBACK"); await racer.query("ROLLBACK"); await racer.end(); }
  });
  it("data blocks down without deleting bound identity",async()=> {
    await expect(migrateDown({url:direct,to:"0031",wmsEnv:"staging"})).rejects.toThrow(/receipt package data exists/);
    expect((await migration.query("SELECT count(*)::int AS n FROM public.receipt_packages")).rows[0]?.n).toBe(3);
    expect((await migration.query("SELECT version FROM wms_meta.schema_migrations ORDER BY version DESC LIMIT 1")).rows[0]?.version).toBe("0032");
    expect((await migrateUp({url:direct})).applied).toEqual(["0033","0034","0035"]);
  });
  for(const order of ["package first","lot update first"] as const) it(`RR concurrent ${order} cannot commit contradictory dates`,async()=> {
    const racer=new pg.Client({connectionString:appUrl}); await racer.connect();
    const item=randomUUID(),lot=randomUUID(), ids={receipt:randomUUID(),receiptLine:randomUUID(),document:randomUUID(),line:randomUUID(),hu:randomUUID()};
    await migration.query("INSERT INTO public.items(tenant_id,id,code,name,base_unit_id,tracking_mode) VALUES($1,$2,$3,'RR snapshot',$4,'LOT')",[world.tenantId,item,item,world.unitId]);
    await migration.query("INSERT INTO public.lots(tenant_id,id,item_id,lot_code,production_date,expiry_date) VALUES($1,$2,$3,'PHYSICAL-LOT','2026-10-01','2027-10-01')",[world.tenantId,lot,item]);
    try {
      await app.query("BEGIN ISOLATION LEVEL REPEATABLE READ"); await racer.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      for(const c of [app,racer]) { await c.query("SELECT set_config('app.current_tenant_id',$1,true)",[world.tenantId]); await c.query("SELECT id FROM public.lots WHERE id=$1",[lot]); }
      const waitBlocked=async(pid:number)=> {
        for(let i=0;i<100;i++) {
          if((await migration.query("SELECT cardinality(pg_blocking_pids($1))>0 AS blocked",[pid])).rows[0]?.blocked) return;
          await new Promise(resolve=>setTimeout(resolve,10));
        }
        throw new Error("Expected intrinsic composite FK lock wait was not observed");
      };
      if(order==="package first") {
        await fixture({itemId:item,receiptItemId:item,lotId:lot,ids}); await flush();
        const pid=(await racer.query("SELECT pg_backend_pid() AS pid")).rows[0]?.pid as number;
        const outcome=racer.query("UPDATE public.lots SET expiry_date='2028-10-01' WHERE id=$1",[lot]).then(()=>({code:"UNEXPECTED_SUCCESS"}), (e: unknown)=>({code:(e as {code:string}).code}));
        await waitBlocked(pid); await app.query("COMMIT");
        expect((await outcome).code).toMatch(/^(23503|40001)$/);
      } else {
        await racer.query("UPDATE public.lots SET expiry_date='2028-10-01' WHERE id=$1",[lot]);
        const pid=(await app.query("SELECT pg_backend_pid() AS pid")).rows[0]?.pid as number;
        const outcome=fixture({itemId:item,receiptItemId:item,lotId:lot,ids}).then(()=>({code:"UNEXPECTED_SUCCESS"}), (e: unknown)=>({code:(e as {code:string}).code}));
        await waitBlocked(pid); await racer.query("COMMIT");
        expect((await outcome).code).toMatch(/^(23503|40001)$/);
      }
      await app.query("ROLLBACK"); await racer.query("ROLLBACK");
      expect((await migration.query("SELECT count(*)::int AS n FROM public.receipt_packages rp JOIN public.lots lot ON lot.tenant_id=rp.tenant_id AND lot.id=rp.catalog_lot_id WHERE rp.id=$1 AND rp.package_dates IS DISTINCT FROM lot.package_dates",[ids.hu])).rows[0]?.n).toBe(0);
    } finally { await app.query("ROLLBACK"); await racer.query("ROLLBACK"); await racer.end(); }
  });

  it("T934 constructor pair FKs, immutable marker trigger and narrow column grants match DDL",async()=> {
    const fks=await migration.query("SELECT conname,condeferrable,condeferred,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname IN ('receipt_packages_hu_binding_fkey','handling_units_package_pair_fkey') ORDER BY conname");
    expect(fks.rows).toHaveLength(2);
    expect(fks.rows[0]).toMatchObject({conname:"handling_units_package_pair_fkey",condeferrable:true,condeferred:true});
    expect(fks.rows[0]?.definition).toContain("FOREIGN KEY (tenant_id, id, package_receipt_id) REFERENCES receipt_packages(tenant_id, id, receipt_id)");
    expect(fks.rows[1]).toMatchObject({conname:"receipt_packages_hu_binding_fkey",condeferrable:false,condeferred:false});
    expect(fks.rows[1]?.definition).toContain("FOREIGN KEY (tenant_id, id, receipt_id) REFERENCES handling_units(tenant_id, id, package_receipt_id)");
    const trigger=await migration.query("SELECT t.tgenabled,t.tgtype,p.prosecdef,p.proconfig FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='public.handling_units'::regclass AND t.tgname='handling_units_package_marker_guard'");
    expect(trigger.rows).toEqual([{tgenabled:"A",tgtype:19,prosecdef:false,proconfig:["search_path=pg_catalog, pg_temp"]}]);
    const grants=await migration.query("SELECT has_column_privilege('wms_app','public.handling_units','package_receipt_id','INSERT') AS ins,has_column_privilege('wms_app','public.handling_units','package_receipt_id','UPDATE') AS upd");
    expect(grants.rows[0]).toEqual({ins:true,upd:false});
  });
  it("T934 marked HU cannot complete without matching metadata",async()=>transaction(async()=> {
    const marked=randomUUID();await app.query("INSERT INTO public.handling_units(tenant_id,id,kind,code,package_receipt_id) VALUES($1,$2,'KOLI',$3,$4)",[world.tenantId,marked,marked,randomUUID()]);
    await expect(flush()).rejects.toMatchObject({code:"23503",constraint:"handling_units_package_pair_fkey"});
  }));
  it("T934 wrong receipt marker rejects package relation",async()=>transaction(async()=> {
    const ids={receipt:randomUUID(),receiptLine:randomUUID(),document:randomUUID(),line:randomUUID(),hu:randomUUID()};
    await expect(fixture({ids,markerReceiptId:legacyReceipt})).rejects.toMatchObject({code:"23503",constraint:"receipt_packages_hu_binding_fkey"});
  }));
  it("T934 runtime foreign constructor marker keeps tenant RLS rejection",async()=>transaction(async()=> {
    await expect(app.query("INSERT INTO public.handling_units(tenant_id,id,kind,code,package_receipt_id) VALUES($1,$2,'KOLI',$3,$4)",[other.tenantId,randomUUID(),randomUUID(),receipt])).rejects.toMatchObject({code:"42501"});
  }));
  for(const [label,target,marker] of [
    ["legacy marker upgrade",(world:TenantWorld)=>world.handlingUnitId,()=>receipt],
    ["bound marker removal",()=>hu,()=>null],
    ["bound marker replacement",()=>hu,()=>legacyReceipt],
  ] as const) it(`T934 ${label} is immutable even for owner`,async()=> {
    await migration.query("BEGIN");
    try {
      await migration.query("SELECT set_config('app.current_tenant_id',$1,true)",[world.tenantId]);
      await expect(migration.query("UPDATE public.handling_units SET package_receipt_id=$1 WHERE tenant_id=$2 AND id=$3",[marker(),world.tenantId,target(world)])).rejects.toMatchObject({code:"23514",message:"PACKAGE_HU_BINDING_IMMUTABLE"});
    } finally {await migration.query("ROLLBACK");}
  });
  for(const order of ["existing legacy snapshot","legacy committed after snapshot"] as const) it(`T934 old HU mapping rejects ${order}`,async()=> {
    const racer=new pg.Client({connectionString:appUrl});await racer.connect();
    const oldHu=randomUUID(),ids={receipt:randomUUID(),receiptLine:randomUUID(),document:randomUUID(),line:randomUUID(),hu:oldHu};
    try {
      if(order==="existing legacy snapshot")await migration.query("INSERT INTO public.handling_units(tenant_id,id,kind,code) VALUES($1,$2,'KOLI',$3)",[world.tenantId,oldHu,oldHu]);
      await racer.query("BEGIN ISOLATION LEVEL REPEATABLE READ");await racer.query("SELECT set_config('app.current_tenant_id',$1,true)",[world.tenantId]);await racer.query("SELECT id FROM public.handling_units WHERE id=$1",[oldHu]);
      if(order==="legacy committed after snapshot")await migration.query("INSERT INTO public.handling_units(tenant_id,id,kind,code) VALUES($1,$2,'KOLI',$3)",[world.tenantId,oldHu,oldHu]);
      // A package requires its immutable constructor key even when the identity itself is valid.
      await expect(racer.query("INSERT INTO public.receipt_packages(tenant_id,id,receipt_id,receipt_line_id,document_id,document_line_id,package_no) VALUES($1,$2,$3,$4,$5,$6,1)",[world.tenantId,oldHu,ids.receipt,ids.receiptLine,ids.document,ids.line])).rejects.toMatchObject({code:"23503",constraint:"receipt_packages_hu_binding_fkey"});
      await racer.query("ROLLBACK");
      expect((await migration.query("SELECT package_receipt_id FROM public.handling_units WHERE id=$1",[oldHu])).rows[0]?.package_receipt_id).toBeNull();
      expect((await migration.query("SELECT count(*)::int AS n FROM public.receipt_packages WHERE id=$1",[oldHu])).rows[0]?.n).toBe(0);
    } finally {await racer.query("ROLLBACK");await racer.end();}
  });

 for(const schedule of ["creating transaction uncommitted","pair committed after RR snapshot"] as const) it(`T934 ordinary new-HU FK visibility ${schedule}`,async()=> {
   const racer=new pg.Client({connectionString:appUrl});await racer.connect();
   const ids={receipt:randomUUID(),receiptLine:randomUUID(),document:randomUUID(),line:randomUUID(),hu:randomUUID()},dim=randomUUID();
   try {
     for(const c of [app,racer]) {await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ");await c.query("SELECT set_config('app.current_tenant_id',$1,true)",[world.tenantId]);expect((await c.query("SELECT id FROM handling_units WHERE tenant_id=$1 AND id=$2",[world.tenantId,ids.hu])).rowCount).toBe(0);}
     await fixture({ids});await flush();
     if(schedule==="pair committed after RR snapshot")await app.query("COMMIT");
     expect((await racer.query("SELECT id FROM handling_units WHERE tenant_id=$1 AND id=$2",[world.tenantId,ids.hu])).rowCount).toBe(0);
     await expect(racer.query("INSERT INTO stock_dimensions(tenant_id,id,item_id,location_id,handling_unit_id,stock_status) VALUES($1,$2,$3,$4,$5,'AVAILABLE')",[world.tenantId,dim,world.itemNoneId,world.rootLocationId,ids.hu])).rejects.toMatchObject({code:expect.stringMatching(/^(23503|40001)$/)});
     await racer.query("ROLLBACK");if(schedule==="creating transaction uncommitted")await app.query("COMMIT");
     expect((await migration.query("SELECT package_receipt_id FROM handling_units WHERE tenant_id=$1 AND id=$2",[world.tenantId,ids.hu])).rows).toEqual([{package_receipt_id:ids.receipt}]);
     expect((await migration.query("SELECT id FROM stock_dimensions WHERE id=$1",[dim])).rows).toHaveLength(0);
   } finally {await app.query("ROLLBACK");await racer.query("ROLLBACK");await racer.end();}
 });

  it("T934 aggregate split ledger entries do not multiply one balance; extra zero dimension is inert",async()=>transaction(async()=> {
    await post([2,4]);const extra=randomUUID();
    await app.query("INSERT INTO public.stock_dimensions(tenant_id,id,item_id,location_id,handling_unit_id,stock_status) VALUES($1,$2,$3,$4,$5,'AVAILABLE')",[world.tenantId,extra,world.itemNoneId,world.childLocationId,hu]);
    await app.query("INSERT INTO public.stock_balances(tenant_id,stock_dimension_id,quantity) VALUES($1,$2,0)",[world.tenantId,extra]);
    await flush();
    expect((await app.query("SELECT sum(quantity)::text AS total,count(*)::int AS n FROM public.stock_ledger WHERE tenant_id=$1 AND document_id=$2",[world.tenantId,document])).rows[0]).toEqual({total:"6.000000",n:2});
    expect((await app.query("SELECT sum(b.quantity)::text AS total FROM public.stock_balances b JOIN public.stock_dimensions d ON d.tenant_id=b.tenant_id AND d.id=b.stock_dimension_id WHERE d.tenant_id=$1 AND d.handling_unit_id=$2",[world.tenantId,hu])).rows[0]?.total).toBe("6.000000");
  }));
  for(const wrongHu of [null,"other"] as const)it(`T934 origin ledger with ${wrongHu===null?"NULL":"wrong"} HU keeps dimension category`,async()=>transaction(async()=> {
    await post();const extra=randomUUID();
    await app.query("INSERT INTO public.stock_dimensions(tenant_id,id,item_id,location_id,handling_unit_id,stock_status) VALUES($1,$2,$3,$4,$5,'QUARANTINE')",[world.tenantId,extra,world.itemNoneId,world.rootLocationId,wrongHu===null?null:world.handlingUnitId]);
    await app.query("INSERT INTO public.stock_ledger(tenant_id,document_id,document_line_id,stock_dimension_id,quantity,reason,business_date) VALUES($1,$2,$3,$4,1,'Wrong package dimension','2026-10-13')",[world.tenantId,document,line,extra]);
    await expect(app.query("SELECT public.receipt_package_assert($1,$2)",[world.tenantId,receipt])).rejects.toMatchObject({code:"23514",message:"PACKAGE_LEDGER_DIMENSION"});
  }));
  it("T934 posted missing ledger remains zero total and fails quantity category",async()=>transaction(async()=> {
    await app.query("UPDATE public.inbound_receipt_lines SET received_quantity=3 WHERE id=$1",[receiptLine]);await app.query("UPDATE public.inbound_receipts SET status='CLOSED' WHERE id=$1",[receipt]);await app.query("UPDATE public.documents SET status='POSTED',number='MISSING-LEDGER' WHERE id=$1",[document]);
    await expect(app.query("SELECT public.receipt_package_assert($1,$2)",[world.tenantId,receipt])).rejects.toMatchObject({code:"23514",message:"PACKAGE_LEDGER_QUANTITY"});
  }));

});

});

describe("T941 movement fixtures (separate scratch)",()=>{
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

});
