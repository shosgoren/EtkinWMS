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
  it("empty36→31→36 keeps old tables and schema ledger",async()=> {
    expect((await migrateDown({url:direct,to:"0031",wmsEnv:"staging"})).reverted).toEqual(["0072", "0071", "0070", "0069", "0068", "0067", "0066", "0065", "0064", "0063", "0062", "0061", "0060", "0059", "0058", "0057", "0056", "0055", "0054", "0053", "0052", "0051", "0050", "0049", "0048", "0047", "0046", "0045", "0044", "0043", "0042", "0041", "0040", "0039", "0038","0037","0036","0035","0034","0033","0032"]);
    expect((await migration.query("SELECT to_regclass('public.receipt_packages') AS table")).rows[0]?.table).toBeNull();
    expect((await migrateUp({url:direct})).applied).toEqual(["0032","0033","0034","0035","0036","0037","0038","0039","0040","0041","0042","0043","0044","0045","0046","0047","0048","0049","0050","0051","0052","0053","0054", "0055", "0056", "0057","0058", "0059", "0060", "0061", "0062", "0063", "0064", "0065", "0066", "0067", "0068", "0069", "0070", "0071", "0072"]);
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
    expect((await migrateUp({url:direct})).applied).toEqual(["0033","0034","0035","0036","0037","0038","0039","0040","0041","0042","0043","0044","0045","0046","0047","0048","0049","0050","0051","0052","0053","0054", "0055", "0056", "0057","0058", "0059", "0060", "0061", "0062", "0063", "0064", "0065", "0066", "0067", "0068", "0069", "0070", "0071", "0072"]);
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
 // T-1129: seedWorld ürünü zaten kullanılmış (boyut + belge satırı); KG temel birimi yalnız bu ayrı scratch DB kurulumunda, bekçi tek ifade için
 // kapatılarak verilir (0065 bekçisinin kendisi item-fixed-fields.int.test.ts'te sınanır).
 await migration.query("BEGIN");await migration.query("ALTER TABLE public.items DISABLE TRIGGER items_guard_unused_fixed");
 await migration.query("UPDATE public.items SET base_unit_id=$3 WHERE tenant_id=$1 AND id=$2",[world.tenantId,world.itemNoneId,kg]);
 await migration.query("ALTER TABLE public.items ENABLE ALWAYS TRIGGER items_guard_unused_fixed");await migration.query("COMMIT");
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


describe("T960 production fixtures (separate scratch)",()=>{
const env=readIntEnv(process.env), name=`wms_production_${randomBytes(6).toString("hex")}`;
const admin=new pg.Client({connectionString:env.databaseUrlDirect});
let migration:pg.Client, app:pg.Client, world:TenantWorld, other:TenantWorld, direct:string, appUrl:string;
let kg:string;let outputItem:string;let secondOutputItem:string;let recipe:string;let secondRecipe:string;let targetWarehouse:string;let targetLocation:string;let targetShelf:string;
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
 await app.query("SET CONSTRAINTS ALL DEFERRED");
 const packageItem=(await app.query("SELECT item_id FROM public.package_origin($1,$2)",[world.tenantId,p.hu])).rows[0]!.item_id;
 const t=world.tenantId, q=o.quantity??200, op=o.operation??(previous?"PUTAWAY":"QC_RELEASE");
 const source=previous?.target??world.rootLocationId, sourceStatus=previous?.status??"QUARANTINE";
 const s={document:randomUUID(),line:randomUUID(),dimension:randomUUID(),sequence:o.seq??(previous?.sequence??0)+1,target:o.target??(op==="QC_RELEASE"?source:world.childLocationId),status:o.status??"AVAILABLE"};
 await c.query("INSERT INTO public.documents(tenant_id,id,kind,type_version_id,warehouse_id,business_date,created_by) SELECT $1,$2,'STOCK_MOVE',id,$3,'2026-10-14',$4 FROM public.document_type_versions WHERE tenant_id IS NULL AND key='STOCK_MOVE' AND version=1",[t,s.document,world.warehouseId,world.ownerUserId]);
 await c.query("INSERT INTO public.document_lines(tenant_id,id,document_id,line_no,item_id,unit_id,quantity,conversion_factor,base_quantity,source_location_id,target_location_id,handling_unit_id,stock_status,target_stock_status) VALUES($1,$2,$3,1,$4,$5,$6,1,$6,$7,$8,$9,$10,$11)",[t,s.line,s.document,o.wrongItem?world.itemTwoId:packageItem,kg,q,source,s.target,p.hu,sourceStatus,s.status]);
 if(o.register!==false) await c.query("INSERT INTO public.package_movement_steps(tenant_id,handling_unit_id,document_id,document_line_id,operation,sequence_no,previous_document_line_id,source_location_id,target_location_id,source_stock_status,target_stock_status,base_quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",[t,p.hu,s.document,s.line,op,s.sequence,o.prev??previous?.line??p.line,source,s.target,sourceStatus,s.status,q]);
 if(o.effects===false)return s;
 await c.query("INSERT INTO public.stock_dimensions(tenant_id,id,item_id,location_id,handling_unit_id,stock_status) VALUES($1,$2,$3,$4,$5,$6)",[t,s.dimension,packageItem,s.target,p.hu,s.status]);
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
 // T-1129: seedWorld ürünü zaten kullanılmış (boyut + belge satırı); KG temel birimi yalnız bu ayrı scratch DB kurulumunda, bekçi tek ifade için
 // kapatılarak verilir (0065 bekçisinin kendisi item-fixed-fields.int.test.ts'te sınanır).
 await migration.query("BEGIN");await migration.query("ALTER TABLE public.items DISABLE TRIGGER items_guard_unused_fixed");
 await migration.query("UPDATE public.items SET base_unit_id=$3 WHERE tenant_id=$1 AND id=$2",[world.tenantId,world.itemNoneId,kg]);
 await migration.query("ALTER TABLE public.items ENABLE ALWAYS TRIGGER items_guard_unused_fixed");await migration.query("COMMIT");
 outputItem=randomUUID();secondOutputItem=randomUUID();recipe=randomUUID();secondRecipe=randomUUID();targetWarehouse=randomUUID();targetLocation=randomUUID();targetShelf=randomUUID();
 await migration.query("INSERT INTO public.items(tenant_id,id,code,name,base_unit_id,tracking_mode) VALUES($1,$2,'OUTPUT-C','Output',$4,'NONE'),($1,$3,'OUTPUT-C2','Output2',$4,'NONE')",[world.tenantId,outputItem,secondOutputItem,kg]);
 await migration.query("BEGIN");
 try {
  await migration.query("INSERT INTO public.production_recipes(tenant_id,id,code,version,name,output_item_id,output_quantity,created_by) VALUES($1,$2,'C-RECIPE',1,'Recipe',$3,40,$4),($1,$5,'C-RECIPE2',1,'Recipe2',$6,20,$4)",[world.tenantId,recipe,outputItem,world.ownerUserId,secondRecipe,secondOutputItem]);
  await migration.query("INSERT INTO public.production_recipe_lines(tenant_id,recipe_id,line_no,item_id,quantity) VALUES($1,$2,1,$3,50),($1,$4,1,$5,10)",[world.tenantId,recipe,world.itemNoneId,secondRecipe,outputItem]);
  await migration.query("COMMIT");
 }catch(e){await migration.query("ROLLBACK");throw e;}
 await migration.query("INSERT INTO public.warehouses(tenant_id,id,code,name) VALUES($1,$2,'TARGET-C','Target')",[world.tenantId,targetWarehouse]);
 await migration.query("INSERT INTO public.locations(tenant_id,id,warehouse_id,code,name,depth,kind) VALUES($1,$2,$3,'C-TARGET','Target',0,'STORAGE'),($1,$4,$3,'C-SHELF','Shelf',0,'STORAGE')",[world.tenantId,targetLocation,targetWarehouse,targetShelf]);
 const u=new URL(urlFor(env.databaseUrl)),endpoint=new URL(direct);u.hostname=endpoint.hostname;u.port=endpoint.port;appUrl=u.toString();app=new pg.Client({connectionString:appUrl});await app.connect();
 expect((await app.query("SELECT current_user AS role")).rows[0]?.role).toBe("wms_app");
}catch(e){throw new Error(redactErrorChain(e,secretUrls(env)));}},120000);
afterAll(async()=>{await app?.end();await migration?.end();await admin.query(`DROP DATABASE IF EXISTS ${name} WITH(FORCE)`);await admin.end();});

interface TransferStep extends Step {sourceDocument:string;sourceLine:string;warehouse:string}
interface TransferOptions {quantity?:number;seq?:number;prev?:string;target?:string;sourceStatus?:string;targetStatus?:string;warehouse?:string;owner?:string;register?:boolean;link?:boolean;linkKind?:string;outOnly?:boolean;wrongSourceLine?:string;wrongSourceDocument?:string}
async function transfer(p:Package,previous:Step|null=null,o:TransferOptions={},c:pg.Client=app):Promise<TransferStep>{
 await c.query("SET CONSTRAINTS ALL DEFERRED");
 const packageItem=(await c.query("SELECT item_id FROM public.package_origin($1,$2)",[world.tenantId,p.hu])).rows[0]!.item_id;
 const t=world.tenantId,q=o.quantity??200,source=previous?.target??world.rootLocationId;
 const srcWarehouse=(await c.query("SELECT warehouse_id FROM public.locations WHERE tenant_id=$1 AND id=$2",[t,source])).rows[0]!.warehouse_id as string;
 const target=o.target??targetLocation,targetWh=(await c.query("SELECT warehouse_id FROM public.locations WHERE tenant_id=$1 AND id=$2",[t,target])).rows[0]!.warehouse_id as string;
 const s:TransferStep={document:randomUUID(),line:randomUUID(),dimension:randomUUID(),sourceDocument:randomUUID(),sourceLine:randomUUID(),sequence:o.seq??(previous?.sequence??0)+1,target,status:o.targetStatus??"AVAILABLE",warehouse:targetWh};
 for(const [doc,line,kind,wh,src,dst,status] of [[s.sourceDocument,s.sourceLine,"STOCK_OUT",srcWarehouse,source,null,o.sourceStatus??"AVAILABLE"],[s.document,s.line,"STOCK_IN",o.warehouse??targetWh,null,target,s.status]]){
  await c.query("INSERT INTO public.documents(tenant_id,id,kind,type_version_id,warehouse_id,business_date,created_by) SELECT $1,$2,$3,id,$4,'2026-10-14',$5 FROM public.document_type_versions WHERE tenant_id IS NULL AND key=$3 AND version=1",[t,doc,kind,wh,world.ownerUserId]);
  await c.query("INSERT INTO public.document_lines(tenant_id,id,document_id,line_no,item_id,unit_id,quantity,conversion_factor,base_quantity,source_location_id,target_location_id,handling_unit_id,stock_status,inventory_owner_id) VALUES($1,$2,$3,1,$4,$5,$6,1,$6,$7,$8,$9,$10,$11)",[t,line,doc,packageItem,kg,q,src,dst,p.hu,status,o.owner??null]);
 }
 if(o.register!==false) await c.query("INSERT INTO public.package_movement_steps(tenant_id,handling_unit_id,document_id,document_line_id,source_document_id,source_document_line_id,operation,sequence_no,previous_document_line_id,source_location_id,target_location_id,source_stock_status,target_stock_status,base_quantity) VALUES($1,$2,$3,$4,$5,$6,'WAREHOUSE_TRANSFER',$7,$8,$9,$10,$11,$12,$13)",[t,p.hu,s.document,s.line,o.wrongSourceDocument??s.sourceDocument,o.wrongSourceLine??s.sourceLine,s.sequence,o.prev??previous?.line??p.line,source,target,o.sourceStatus??"AVAILABLE",s.status,q]);
 if(o.link!==false)await c.query("INSERT INTO public.stock_document_links(tenant_id,source_document_id,target_document_id,kind) VALUES($1,$2,$3,$4)",[t,s.sourceDocument,s.document,o.linkKind??"TRANSFER"]);
 const existing=(await c.query("SELECT sd.id FROM public.stock_dimensions sd WHERE sd.tenant_id=$1 AND sd.handling_unit_id=$2 AND sd.location_id=$3 AND sd.stock_status=$4",[t,p.hu,target,s.status])).rows[0] as {id:string}|undefined;
 if(existing)s.dimension=existing.id;else await c.query("INSERT INTO public.stock_dimensions(tenant_id,id,item_id,location_id,handling_unit_id,stock_status) VALUES($1,$2,$3,$4,$5,$6)",[t,s.dimension,packageItem,target,p.hu,s.status]);
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


interface ProductionOutput {hu:string;line:string;dimension:string;quantity:number}
interface Production {outputs:ProductionOutput[];batch:string;document:string;line:string;hu:string;dimension:string;input:Package;inputDimension:string;previousLine:string;sequence:number;sourceLocation:string;amount:number;quantity:number;recipe:string;item:string}
async function prepareProduction(input:Package,previous:Step|null=null,amount=50,quantity=40,recipeId=recipe,item=outputItem,c:pg.Client=app,splitOutput=false):Promise<Production>{
 await c.query("SET CONSTRAINTS ALL DEFERRED");
 const t=world.tenantId,s={batch:randomUUID(),document:randomUUID(),line:randomUUID(),hu:randomUUID(),dimension:randomUUID(),input,inputDimension:previous?.dimension??input.dimension,previousLine:previous?.line??input.line,sequence:(previous?.sequence??0)+1,sourceLocation:previous?.target??world.rootLocationId,amount,quantity,recipe:recipeId,item,outputs:[] as ProductionOutput[]};
 s.outputs.push({hu:s.hu,line:s.line,dimension:s.dimension,quantity});
 await c.query("INSERT INTO public.handling_units(tenant_id,id,kind,code,package_production_id) VALUES($1,$2,'VARIL',$3,$4)",[t,s.hu,s.hu,s.batch]);
 await c.query("INSERT INTO public.documents(tenant_id,id,kind,type_version_id,warehouse_id,business_date,created_by) SELECT $1,$2,'STOCK_IN',id,$3,'2026-10-14',$4 FROM public.document_type_versions WHERE tenant_id IS NULL AND key='STOCK_IN' AND version=1",[t,s.document,world.warehouseId,world.ownerUserId]);
 await c.query("INSERT INTO public.document_lines(tenant_id,id,document_id,line_no,item_id,unit_id,quantity,conversion_factor,base_quantity,target_location_id,handling_unit_id,stock_status) VALUES($1,$2,$3,1,$4,$5,$6,1,$6,$7,$8,'AVAILABLE')",[t,s.line,s.document,item,kg,quantity,world.rootLocationId,s.hu]);
 if(splitOutput){
  const second={hu:randomUUID(),line:randomUUID(),dimension:randomUUID(),quantity:quantity/2};s.outputs[0]!.quantity=quantity/2;s.outputs.push(second);
  await c.query("INSERT INTO public.handling_units(tenant_id,id,kind,code,package_production_id) VALUES($1,$2,'VARIL',$3,$4)",[t,second.hu,second.hu,s.batch]);
  await c.query("UPDATE public.document_lines SET quantity=$3,base_quantity=$3 WHERE tenant_id=$1 AND id=$2",[t,s.line,quantity/2]);
  await c.query("INSERT INTO public.document_lines(tenant_id,id,document_id,line_no,item_id,unit_id,quantity,conversion_factor,base_quantity,target_location_id,handling_unit_id,stock_status) VALUES($1,$2,$3,2,$4,$5,$6,1,$6,$7,$8,'AVAILABLE')",[t,second.line,s.document,item,kg,quantity/2,world.rootLocationId,second.hu]);
 }
 await c.query("UPDATE public.documents SET status='APPROVED' WHERE tenant_id=$1 AND id=$2",[t,s.document]);
 await c.query("INSERT INTO public.production_batches(tenant_id,id,recipe_id,output_document_id,target_location_id,output_quantity) VALUES($1,$2,$3,$4,$5,$6)",[t,s.batch,recipeId,s.document,world.rootLocationId,quantity]);
 const version=(await c.query<{version:string}>("SELECT version::text FROM public.stock_balances WHERE tenant_id=$1 AND stock_dimension_id=$2",[t,s.inputDimension])).rows[0]!.version;
 await c.query("INSERT INTO public.production_inputs(tenant_id,production_batch_id,handling_unit_id,previous_document_line_id,sequence_no,current_balance_version,base_quantity) VALUES($1,$2,$3,$4,$5,$6,$7)",[t,s.batch,input.hu,s.previousLine,s.sequence,version,amount]);
 for(const [index,o] of s.outputs.entries())await c.query("INSERT INTO public.production_packages(tenant_id,id,production_batch_id,document_id,document_line_id,package_no,lot_code,produced_on,expires_on) VALUES($1,$2,$3,$4,$5,$6,'PRODUCTION-LOT','2026-10-14','2027-10-14')",[t,o.hu,s.batch,s.document,o.line,index+1]);
 return s;
}
async function postProduction(s:Production,c:pg.Client=app,half=false){
 await c.query("SET CONSTRAINTS ALL DEFERRED");
 const t=world.tenantId,doc=randomUUID(),line=randomUUID();const o=(await c.query("SELECT * FROM public.package_origin($1,$2)",[t,s.input.hu])).rows[0]!;
 const wh=(await c.query("SELECT warehouse_id FROM public.locations WHERE tenant_id=$1 AND id=$2",[t,s.sourceLocation])).rows[0]!.warehouse_id;
 await c.query("INSERT INTO public.documents(tenant_id,id,kind,type_version_id,warehouse_id,business_date,created_by) SELECT $1,$2,'STOCK_OUT',id,$3,'2026-10-14',$4 FROM public.document_type_versions WHERE tenant_id IS NULL AND key='STOCK_OUT' AND version=1",[t,doc,wh,world.ownerUserId]);
 await c.query("INSERT INTO public.document_lines(tenant_id,id,document_id,line_no,item_id,unit_id,quantity,conversion_factor,base_quantity,source_location_id,handling_unit_id,stock_status) VALUES($1,$2,$3,1,$4,$5,$6,1,$6,$7,$8,'AVAILABLE')",[t,line,doc,o.item_id,kg,s.amount,s.sourceLocation,s.input.hu]);
 await c.query("UPDATE public.documents SET status='APPROVED' WHERE tenant_id=$1 AND id=$2",[t,doc]);
 await c.query("INSERT INTO public.package_movement_steps(tenant_id,handling_unit_id,document_id,document_line_id,operation,sequence_no,previous_document_line_id,source_location_id,target_location_id,source_stock_status,target_stock_status,base_quantity,production_batch_id) VALUES($1,$2,$3,$4,'CONSUME',$5,$6,$7,$7,'AVAILABLE','AVAILABLE',$8,$9)",[t,s.input.hu,doc,line,s.sequence,s.previousLine,s.sourceLocation,s.amount,s.batch]);
 await c.query("INSERT INTO public.stock_document_links(tenant_id,source_document_id,target_document_id,kind,recipe_id) VALUES($1,$2,$3,'PRODUCTION',$4)",[t,doc,s.document,s.recipe]);
 await c.query("INSERT INTO public.stock_ledger(tenant_id,document_id,document_line_id,stock_dimension_id,quantity,reason,business_date) VALUES($1,$2,$3,$4,$5,'Production consume fixture','2026-10-14')",[t,doc,line,s.inputDimension,-s.amount]);
 await c.query("UPDATE public.stock_balances SET quantity=quantity-$3,version=version+1 WHERE tenant_id=$1 AND stock_dimension_id=$2",[t,s.inputDimension,s.amount]);
 await c.query("UPDATE public.documents SET status='POSTED',number=$3 WHERE tenant_id=$1 AND id=$2",[t,doc,doc]);
 if(half)return {doc,line};
 for(const o of s.outputs){
  await c.query("INSERT INTO public.stock_dimensions(tenant_id,id,item_id,location_id,handling_unit_id,stock_status) VALUES($1,$2,$3,$4,$5,'AVAILABLE')",[t,o.dimension,s.item,world.rootLocationId,o.hu]);
  await c.query("INSERT INTO public.stock_balances(tenant_id,stock_dimension_id,quantity) VALUES($1,$2,$3)",[t,o.dimension,o.quantity]);
  await c.query("INSERT INTO public.stock_ledger(tenant_id,document_id,document_line_id,stock_dimension_id,quantity,reason,business_date) VALUES($1,$2,$3,$4,$5,'Production output fixture','2026-10-14')",[t,s.document,o.line,o.dimension,o.quantity]);
 }
 await c.query("UPDATE public.documents SET status='POSTED',number=$3 WHERE tenant_id=$1 AND id=$2",[t,s.document,s.document]);
 return {doc,line};
}
const outputPackage=(s:Production):Package=>({receipt:s.batch,receiptLine:s.line,document:s.document,line:s.line,hu:s.hu,dimension:s.dimension});


describe("T960 pending production and partial stock genealogy",()=>{
 it("empty36 down restores independently applied original35 funcs/ACL/RLS/schema",async()=>{
  await migrateDown({url:direct,to:'0035',wmsEnv:'staging'});
  const sql=await readFile(new URL('../../../packages/db/migrations/0035_package_transfers.up.sql',import.meta.url),'utf8');
  const names=['package_movement_assert','receipt_package_assert','package_movement_check_trigger','package_transfer_link_guard'];
  for(const name of names){const f=sql.match(new RegExp('CREATE(?: OR REPLACE)? FUNCTION public\\.'+name+'\\(.*?\\$fn\\$;','s'));expect(f).not.toBeNull();await migration.query(f![0].replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'));}
  const state=()=>migration.query('SELECT proname,prosrc,proowner::regrole::text,proacl::text,proconfig,prosecdef FROM pg_proc WHERE proname=ANY($1::text[]) ORDER BY proname',[names]);
  const original=(await state()).rows;await migrateUp({url:direct});await migrateDown({url:direct,to:'0035',wmsEnv:'staging'});expect((await state()).rows).toEqual(original);
  expect((await migration.query("SELECT to_regclass('public.production_batches') AS batches,to_regclass('public.production_inputs') AS inputs,to_regclass('public.production_packages') AS packages")).rows[0]).toEqual({batches:null,inputs:null,packages:null});await migrateUp({url:direct});
 });
 it("persisted APPROVED outputorigin has uniqueQR and zero stock/CONSUME/link",async()=>{
  await begin();const input=await origin(app,'AVAILABLE');const s=await prepareProduction(input);await app.query('COMMIT');await begin();
  try{
   expect(s.hu).not.toBe(input.hu);expect((await app.query('SELECT id,origin_kind,document_status,base_quantity::text FROM public.package_origin($1,$2)',[world.tenantId,s.hu])).rows[0]).toEqual({id:s.hu,origin_kind:'PRODUCTION',document_status:'APPROVED',base_quantity:'40.000000'});
   expect((await app.query('SELECT count(*)::int AS n FROM public.stock_dimensions WHERE handling_unit_id=$1',[s.hu])).rows[0]?.n).toBe(0);
   expect((await app.query('SELECT count(*)::int AS n FROM public.package_movement_steps WHERE production_batch_id=$1',[s.batch])).rows[0]?.n).toBe(0);
   await expect(app.query('SELECT public.package_movement_assert($1,$2)',[world.tenantId,s.hu])).rejects.toMatchObject({code:'23514',message:'PACKAGE_MOVEMENT_ORIGIN'});
  }finally{await app.query('ROLLBACK');}
 });
 it("partial input50 leaves150, fresh output40 moves/transfers and is reused in nextbatch",async()=>tx(async()=>{
  const input=await origin(app,'AVAILABLE');const s=await prepareProduction(input);const consumed=await postProduction(s);await flush();
  expect((await app.query('SELECT quantity::text FROM public.stock_balances WHERE stock_dimension_id=$1',[input.dimension])).rows[0]?.quantity).toBe('150.000000');
  expect((await app.query('SELECT base_quantity::text FROM public.production_inputs WHERE production_batch_id=$1',[s.batch])).rows).toEqual([{base_quantity:'50.000000'}]);
  const out=outputPackage(s);const initial={document:s.document,line:s.line,dimension:s.dimension,sequence:0,target:world.rootLocationId,status:'AVAILABLE'};
  const moved=await movement(out,initial,{operation:'PUTAWAY',quantity:40,target:world.childLocationId});
  const shipped=await transfer(out,moved,{quantity:40,target:targetLocation});await flush();
  const next=await prepareProduction(out,shipped,10,20,secondRecipe,secondOutputItem);await postProduction(next);await flush();
  expect((await app.query('SELECT quantity::text FROM public.stock_balances WHERE stock_dimension_id=$1',[shipped.dimension])).rows[0]?.quantity).toBe('30.000000');
  expect((await app.query('SELECT id,document_line_id,lot_code,expires_on::text FROM public.production_packages WHERE id=$1',[s.hu])).rows[0]).toEqual({id:s.hu,document_line_id:s.line,lot_code:'PRODUCTION-LOT',expires_on:'2027-10-14'});
  expect((await app.query('SELECT document_line_id,operation FROM public.package_movement_steps WHERE handling_unit_id=$1',[input.hu])).rows).toEqual([{document_line_id:consumed.line,operation:'CONSUME'}]);
 }));
 it("full consume200 leaves zero positive dimensions without reusing oldQR",async()=>tx(async()=>{
  const input=await origin(app,'AVAILABLE');const s=await prepareProduction(input,null,200,160);await postProduction(s);await flush();
  expect((await app.query('SELECT quantity::text FROM public.stock_balances WHERE stock_dimension_id=$1',[input.dimension])).rows[0]?.quantity).toBe('0.000000');
  expect((await app.query('SELECT count(*)::int AS n FROM public.stock_balances b JOIN public.stock_dimensions sd ON sd.tenant_id=b.tenant_id AND sd.id=b.stock_dimension_id WHERE sd.handling_unit_id=$1 AND b.quantity>0',[input.hu])).rows[0]?.n).toBe(0);
 }));
 it("recipe scaling mismatch rejects pendingbatch without stockeffects",async()=>tx(async()=>{
  const input=await origin(app,'AVAILABLE');await expect((async()=>{await prepareProduction(input,null,49,40);await flush();})()).rejects.toMatchObject({code:'23514',message:'PACKAGE_PRODUCTION_COMPONENTS'});
 }));
 it("half sourceOUT alone is rejected and wholeTX canrollback",async()=>tx(async()=>{
  const input=await origin(app,'AVAILABLE');const s=await prepareProduction(input);await postProduction(s,app,true);await expect(flush()).rejects.toMatchObject({code:'23514',message:'PACKAGE_PRODUCTION_PENDING_STOCK'});
 }));
 for(const flow of ['ORIGIN','QC_RELEASE','PUTAWAY'] as const)for(const endpoint of ['SOURCE','TARGET'] as const)it(`registered ${flow} forbids unrelated link at ${endpoint}`,async()=>tx(async()=>{
  const p=await origin();let doc=p.document;
  if(flow!=='ORIGIN'){const qc=await movement(p);doc=flow==='QC_RELEASE'?qc.document:(await movement(p,qc)).document;}
  await flush();await app.query('SET CONSTRAINTS ALL DEFERRED');const extra=randomUUID();
  await app.query("INSERT INTO public.documents(tenant_id,id,kind,type_version_id,warehouse_id,business_date,created_by) SELECT $1,$2,'STOCK_IN',id,$3,'2026-10-14',$4 FROM public.document_type_versions WHERE tenant_id IS NULL AND key='STOCK_IN' AND version=1",[world.tenantId,extra,world.warehouseId,world.ownerUserId]);
  await app.query("INSERT INTO public.stock_document_links(tenant_id,source_document_id,target_document_id,kind) VALUES($1,$2,$3,'TRANSFER')",[world.tenantId,endpoint==='SOURCE'?doc:extra,endpoint==='SOURCE'?extra:doc]);
  await expect(flush()).rejects.toMatchObject({code:'23514',message:flow==='ORIGIN'?'PACKAGE_ORIGIN_LINK':'PACKAGE_MOVEMENT_LINK'});
 }));
 it('pending production output forbids outgoing link without stock',async()=>tx(async()=>{
  const p=await origin(app,'AVAILABLE'),batch=await prepareProduction(p);await flush();await app.query('SET CONSTRAINTS ALL DEFERRED');const extra=randomUUID();
  await app.query("INSERT INTO public.documents(tenant_id,id,kind,type_version_id,warehouse_id,business_date,created_by) SELECT $1,$2,'STOCK_IN',id,$3,'2026-10-14',$4 FROM public.document_type_versions WHERE tenant_id IS NULL AND key='STOCK_IN' AND version=1",[world.tenantId,extra,world.warehouseId,world.ownerUserId]);
  await app.query("INSERT INTO public.stock_document_links(tenant_id,source_document_id,target_document_id,kind) VALUES($1,$2,$3,'TRANSFER')",[world.tenantId,batch.document,extra]);
  await expect(flush()).rejects.toMatchObject({code:'23514',message:'PACKAGE_PRODUCTION_PENDING_STOCK'});
 }));
 for(const flow of ['TRANSFER','PRODUCTION'] as const)for(const direction of ['IN_AS_SOURCE','OUT_AS_TARGET'] as const)it(`registered ${flow} rejects inverse endpoint ${direction}`,async()=>tx(async()=>{
  const p=await origin(app,'AVAILABLE');let into:string,out:string;
  if(flow==='TRANSFER'){const step=await transfer(p);into=step.document;out=step.sourceDocument;}
  else {const batch=await prepareProduction(p);const posted=await postProduction(batch);into=batch.document;out=posted.doc;}
  await flush();await app.query('SET CONSTRAINTS ALL DEFERRED');
  const extra=randomUUID(),kind=direction==='IN_AS_SOURCE'?'STOCK_IN':'STOCK_OUT';
  await app.query("INSERT INTO public.documents(tenant_id,id,kind,type_version_id,warehouse_id,business_date,created_by) SELECT $1,$2,$3,id,$4,'2026-10-14',$5 FROM public.document_type_versions WHERE tenant_id IS NULL AND key=$3 AND version=1",[world.tenantId,extra,kind,world.warehouseId,world.ownerUserId]);
  await app.query("INSERT INTO public.stock_document_links(tenant_id,source_document_id,target_document_id,kind) VALUES($1,$2,$3,'TRANSFER')",[world.tenantId,direction==='IN_AS_SOURCE'?into:extra,direction==='IN_AS_SOURCE'?extra:out]);
  await expect(flush()).rejects.toMatchObject({code:'23514',message:flow==='TRANSFER'?'PACKAGE_TRANSFER_LINK':'PACKAGE_PRODUCTION_LINK'});
 }));
 for(const kind of ['TRANSFER','PRODUCTION'] as const)it(`inherited transfer rejects extra incoming ${kind} link`,async()=>tx(async()=>{
  const p=await origin(app,'AVAILABLE');const step=await transfer(p);await flush();await app.query('SET CONSTRAINTS ALL DEFERRED');
  const extra=randomUUID();
  await app.query("INSERT INTO public.documents(tenant_id,id,kind,type_version_id,warehouse_id,business_date,created_by) SELECT $1,$2,'STOCK_OUT',id,$3,'2026-10-14',$4 FROM public.document_type_versions WHERE tenant_id IS NULL AND key='STOCK_OUT' AND version=1",[world.tenantId,extra,world.warehouseId,world.ownerUserId]);
  await app.query("INSERT INTO public.stock_document_links(tenant_id,source_document_id,target_document_id,kind,recipe_id) VALUES($1,$2,$3,$4,$5)",[world.tenantId,extra,step.document,kind,kind==='PRODUCTION'?secondRecipe:null]);
  await expect(flush()).rejects.toMatchObject({code:'23514',message:'PACKAGE_TRANSFER_LINK'});
 }));
 for(const kind of ['TRANSFER','PRODUCTION'] as const)it(`posted batch rejects extra ${kind} target link even with another recipe`,async()=>tx(async()=>{
  const input=await origin(app,'AVAILABLE');const s=await prepareProduction(input);const posted=await postProduction(s);await flush();
  await app.query("SET CONSTRAINTS ALL DEFERRED");
  const extra=randomUUID();
  await app.query("INSERT INTO public.documents(tenant_id,id,kind,type_version_id,warehouse_id,business_date,created_by) SELECT $1,$2,'STOCK_OUT',id,$3,'2026-10-14',$4 FROM public.document_type_versions WHERE tenant_id IS NULL AND key='STOCK_OUT' AND version=1",[world.tenantId,extra,world.warehouseId,world.ownerUserId]);
  await app.query("INSERT INTO public.stock_document_links(tenant_id,source_document_id,target_document_id,kind,recipe_id) VALUES($1,$2,$3,$4,$5)",[world.tenantId,extra,s.document,kind,kind==='PRODUCTION'?secondRecipe:null]);
  expect(posted.doc).not.toBe(extra);
  await expect(flush()).rejects.toMatchObject({code:'23514',message:'PACKAGE_PRODUCTION_LINK'});
 }));
 it("ordinary RLS hides all three production tables and origin across tenant",async()=>tx(async()=>{
  const input=await origin(app,'AVAILABLE');const s=await prepareProduction(input);await flush();await app.query("SELECT set_config('app.current_tenant_id',$1,true)",[other.tenantId]);
  for(const table of ['production_batches','production_inputs','production_packages'])expect((await app.query(`SELECT * FROM public.${table}`)).rowCount).toBe(0);
  expect((await app.query('SELECT * FROM public.package_origin($1,$2)',[world.tenantId,s.hu])).rowCount).toBe(0);
 }));
 it("runtime newtables FORCE RLS and no UPDATE DELETE TRUNCATE, functions invoker",async()=>{
  expect((await migration.query("SELECT count(*)::int AS n FROM pg_class WHERE oid IN ('public.production_batches'::regclass,'public.production_inputs'::regclass,'public.production_packages'::regclass) AND relrowsecurity AND relforcerowsecurity AND NOT has_table_privilege('wms_app',oid,'UPDATE') AND NOT has_table_privilege('wms_app',oid,'DELETE') AND NOT has_table_privilege('wms_app',oid,'TRUNCATE')")).rows[0]?.n).toBe(3);
  expect((await migration.query("SELECT bool_and(NOT prosecdef AND proconfig=ARRAY['search_path=pg_catalog, pg_temp']) AS safe FROM pg_proc WHERE proname IN ('package_origin','package_production_assert')")).rows[0]?.safe).toBe(true);
 });
 for(const [label,sql] of [
  ['batch','UPDATE public.production_batches SET output_quantity=41 WHERE tenant_id=$1 AND id=$2'],
  ['allocation','UPDATE public.production_inputs SET base_quantity=49 WHERE tenant_id=$1 AND production_batch_id=$2'],
  ['metadata',"UPDATE public.production_packages SET expires_on='2028-10-14' WHERE tenant_id=$1 AND production_batch_id=$2"],
  ['truncate','TRUNCATE public.production_inputs']
 ] as const)it(`privileged owner cannot edit ${label}`,async()=>{
  await begin(migration);try{const input=await origin(migration,'AVAILABLE');const s=await prepareProduction(input,null,50,40,recipe,outputItem,migration);await flush(migration);
   expect((await migration.query("SELECT has_table_privilege(current_user,'public.production_inputs','UPDATE') AS upd")).rows[0]?.upd).toBe(true);
   await expect(migration.query(sql,sql.includes('$1')?[world.tenantId,s.batch]:[])).rejects.toMatchObject({code:'23514',message:'PACKAGE_PRODUCTION_IMMUTABLE'});
  }finally{await migration.query('ROLLBACK');}
 });
 it("legacyNULL HU cannot be adopted into production origin by owner marker UPDATE",async()=>{
  await begin(migration);try{await expect(migration.query('UPDATE public.handling_units SET package_production_id=$3 WHERE tenant_id=$1 AND id=$2',[world.tenantId,world.handlingUnitId,randomUUID()])).rejects.toMatchObject({code:'23514',message:'PACKAGE_HU_BINDING_IMMUTABLE'});}finally{await migration.query('ROLLBACK');}
 });

 it("two distinct outputQRs share one input50 allocation rather than multiplying genealogy",async()=>tx(async()=>{
  const input=await origin(app,'AVAILABLE');const s=await prepareProduction(input,null,50,40,recipe,outputItem,app,true);await postProduction(s);await flush();
  expect(s.outputs).toHaveLength(2);expect(new Set(s.outputs.map(o=>o.hu)).size).toBe(2);expect(s.outputs.some(o=>o.hu===input.hu)).toBe(false);
  expect((await app.query('SELECT base_quantity::text FROM public.production_inputs WHERE production_batch_id=$1',[s.batch])).rows).toEqual([{base_quantity:'50.000000'}]);
  expect((await app.query('SELECT sum(base_quantity)::text AS total FROM public.production_inputs WHERE production_batch_id=$1',[s.batch])).rows[0]?.total).toBe('50.000000');
  expect((await app.query('SELECT count(*)::int AS n FROM public.production_packages WHERE production_batch_id=$1',[s.batch])).rows[0]?.n).toBe(2);
  expect((await app.query('SELECT quantity::text FROM public.stock_balances WHERE stock_dimension_id=$1',[input.dimension])).rows[0]?.quantity).toBe('150.000000');
 }));
 for(const winner of ['consume','transfer'] as const)it(`realRR ${winner} wins shared predecessor against the other operation`,async()=>{
  await begin();const input=await origin(app,'AVAILABLE');const s=await prepareProduction(input);await app.query('COMMIT');const otherConnection=new pg.Client({connectionString:appUrl});await otherConnection.connect();
  try{
   await begin(app,world.tenantId,true);await begin(otherConnection,world.tenantId,true);
   for(const connection of [app,otherConnection]){
    expect((await connection.query('SHOW transaction_isolation')).rows[0]?.transaction_isolation).toBe('repeatable read');
    expect((await connection.query('SELECT id FROM public.receipt_packages WHERE id=$1',[input.hu])).rowCount).toBe(1);
   }
   const winnerConnection=winner==='consume'?app:otherConnection,loserConnection=winner==='consume'?otherConnection:app;
   const final=winner==='consume'?await postProduction(s,winnerConnection):await transfer(input,null,{target:targetLocation},winnerConnection);
   const pid=(await loserConnection.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
   const loser=(winner==='consume'?transfer(input,null,{target:targetLocation},loserConnection):postProduction(s,loserConnection)).then(()=>null,(e:unknown)=>e);
   let locked=false;const deadline=performance.now()+2000;
   while(performance.now()<deadline){
    const wait=(await migration.query<{wait_event_type:string;query:string}>('SELECT wait_event_type,query FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0];
    if(wait?.wait_event_type==='Lock' && wait.query.includes('INSERT INTO public.package_movement_steps')){locked=true;break;}
    await new Promise(resolve=>setTimeout(resolve,10));
   }
   expect(locked).toBe(true);await winnerConnection.query('COMMIT');expect(await loser).toMatchObject({code:'23505'});await loserConnection.query('ROLLBACK');
   expect((await migration.query('SELECT operation FROM public.package_movement_steps WHERE tenant_id=$1 AND handling_unit_id=$2',[world.tenantId,input.hu])).rows).toEqual([{operation:winner==='consume'?'CONSUME':'WAREHOUSE_TRANSFER'}]);
   expect((await migration.query('SELECT sum(b.quantity)::text AS total FROM public.stock_balances b JOIN public.stock_dimensions sd ON sd.tenant_id=b.tenant_id AND sd.id=b.stock_dimension_id WHERE sd.tenant_id=$1 AND sd.handling_unit_id=$2',[world.tenantId,input.hu])).rows[0]?.total).toBe(winner==='consume'?'150.000000':'200.000000');
   if(winner==='consume')expect((await migration.query('SELECT quantity::text FROM public.stock_balances WHERE tenant_id=$1 AND stock_dimension_id=$2',[world.tenantId,s.dimension])).rows[0]?.quantity).toBe('40.000000');
   else expect((await migration.query('SELECT id FROM public.stock_dimensions WHERE tenant_id=$1 AND handling_unit_id=$2',[world.tenantId,s.hu])).rowCount).toBe(0);
   expect(final).toBeDefined();
  }finally{if(winner==='consume'){await app.query('ROLLBACK');await otherConnection.query('ROLLBACK');}else{await otherConnection.query('ROLLBACK');await app.query('ROLLBACK');}await otherConnection.end();}
 });
 for(const winner of ['first','second'] as const)it(`two controlled nativeRR consume snapshots share one predecessor: ${winner} wins`,async()=>{
  await begin();const input=await origin(app,'AVAILABLE'),first=await prepareProduction(input),second=await prepareProduction(input);await app.query('COMMIT');
  const otherConnection=new pg.Client({connectionString:appUrl});await otherConnection.connect();
  try{
   await begin(app,world.tenantId,true);await begin(otherConnection,world.tenantId,true);
   for(const connection of [app,otherConnection]){
    expect((await connection.query('SHOW transaction_isolation')).rows[0]?.transaction_isolation).toBe('repeatable read');
    expect((await connection.query('SELECT id FROM public.receipt_packages WHERE id=$1',[input.hu])).rows).toEqual([{id:input.hu}]);
    expect((await connection.query('SELECT quantity::text FROM public.stock_balances WHERE tenant_id=$1 AND stock_dimension_id=$2',[world.tenantId,input.dimension])).rows).toEqual([{quantity:'200.000000'}]);
   }
   const winnerConnection=winner==='first'?app:otherConnection,loserConnection=winner==='first'?otherConnection:app;
   const winning=winner==='first'?first:second,losing=winner==='first'?second:first;
   await postProduction(winning,winnerConnection);
   const pid=(await loserConnection.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
   const loser=postProduction(losing,loserConnection).then(()=>null,(e:unknown)=>e);
   let locked=false;const deadline=performance.now()+2000;
   while(performance.now()<deadline){
    const wait=(await migration.query<{wait_event_type:string;query:string}>('SELECT wait_event_type,query FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0];
    if(wait?.wait_event_type==='Lock' && wait.query.includes('INSERT INTO public.package_movement_steps')){locked=true;break;}
    await new Promise(resolve=>setTimeout(resolve,10));
   }
   expect(locked).toBe(true);
   expect((await migration.query('SELECT count(*)::int AS n FROM public.package_movement_steps WHERE tenant_id=$1 AND handling_unit_id=$2',[world.tenantId,input.hu])).rows[0]?.n).toBe(0);
   await winnerConnection.query('SET CONSTRAINTS ALL IMMEDIATE');await winnerConnection.query('COMMIT');
   expect(await loser).toMatchObject({code:'23505'});await loserConnection.query('ROLLBACK');
   expect((await migration.query('SELECT production_batch_id,previous_document_line_id,sequence_no,base_quantity::text FROM public.package_movement_steps WHERE tenant_id=$1 AND handling_unit_id=$2',[world.tenantId,input.hu])).rows).toEqual([{production_batch_id:winning.batch,previous_document_line_id:input.line,sequence_no:1,base_quantity:'50.000000'}]);
   expect((await migration.query('SELECT quantity::text FROM public.stock_balances WHERE tenant_id=$1 AND stock_dimension_id=$2',[world.tenantId,input.dimension])).rows).toEqual([{quantity:'150.000000'}]);
   expect((await migration.query('SELECT quantity::text FROM public.stock_balances WHERE tenant_id=$1 AND stock_dimension_id=$2',[world.tenantId,winning.dimension])).rows).toEqual([{quantity:'40.000000'}]);
   expect((await migration.query('SELECT id FROM public.stock_dimensions WHERE tenant_id=$1 AND handling_unit_id=$2',[world.tenantId,losing.hu])).rowCount).toBe(0);
   expect((await migration.query('SELECT id,status FROM public.documents WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY status',[world.tenantId,[winning.document,losing.document]])).rows).toEqual([{id:losing.document,status:'APPROVED'},{id:winning.document,status:'POSTED'}]);
  }finally{await app.query('ROLLBACK');await otherConnection.query('ROLLBACK');await otherConnection.end();}
 });
 it("orphan marked productionHU cannot commit without its real metadata pair",async()=>tx(async()=>{
  const hu=randomUUID();await app.query("INSERT INTO public.handling_units(tenant_id,id,kind,code,package_production_id) VALUES($1,$2,'VARIL',$3,$4)",[world.tenantId,hu,hu,randomUUID()]);
  await expect(flush()).rejects.toMatchObject({code:'23503'});
 }));
 it("foreign plannedHU cannot be attached to same-tenant batch",async()=>tx(async()=>{
  const input=await origin(app,'AVAILABLE');const s=await prepareProduction(input);
  await expect(app.query('INSERT INTO public.production_inputs(tenant_id,production_batch_id,handling_unit_id,previous_document_line_id,sequence_no,current_balance_version,base_quantity) VALUES($1,$2,$3,$4,1,0,1)',[world.tenantId,s.batch,other.handlingUnitId,other.documentLineId])).rejects.toMatchObject({code:'23503'});
 }));
 it("privileged direct-write cyclic batch ancestry is rejected with actual cycle reason",async()=>{
  await begin(migration);
  try{
   const t=world.tenantId;
   const nodes=[0,1].map(()=>({item:randomUUID(),recipe:randomUUID(),batch:randomUUID(),hu:randomUUID(),into:randomUUID(),intoLine:randomUUID(),out:randomUUID(),outLine:randomUUID(),dim:randomUUID()}));
   for(const n of nodes)await migration.query("INSERT INTO public.items(tenant_id,id,code,name,base_unit_id,tracking_mode) VALUES($1,$2,$3,'Cycle item',$4,'NONE')",[t,n.item,n.item,kg]);
   for(const n of nodes)await migration.query("INSERT INTO public.production_recipes(tenant_id,id,code,version,name,output_item_id,output_quantity,created_by) VALUES($1,$2,$3,1,'Cycle recipe',$4,1,$5)",[t,n.recipe,n.recipe,n.item,world.ownerUserId]);
   for(const [i,n] of nodes.entries())await migration.query('INSERT INTO public.production_recipe_lines(tenant_id,recipe_id,line_no,item_id,quantity) VALUES($1,$2,1,$3,1)',[t,n.recipe,nodes[1-i]!.item]);
   for(const n of nodes){
    await migration.query("INSERT INTO public.handling_units(tenant_id,id,kind,code,package_production_id) VALUES($1,$2,'VARIL',$3,$4)",[t,n.hu,n.hu,n.batch]);
    await migration.query("INSERT INTO public.documents(tenant_id,id,kind,type_version_id,warehouse_id,business_date,created_by) SELECT $1,$2,'STOCK_IN',id,$3,'2026-10-14',$4 FROM public.document_type_versions WHERE tenant_id IS NULL AND key='STOCK_IN' AND version=1",[t,n.into,world.warehouseId,world.ownerUserId]);
    await migration.query("INSERT INTO public.document_lines(tenant_id,id,document_id,line_no,item_id,unit_id,quantity,conversion_factor,base_quantity,target_location_id,handling_unit_id,stock_status) VALUES($1,$2,$3,1,$4,$5,1,1,1,$6,$7,'AVAILABLE')",[t,n.intoLine,n.into,n.item,kg,world.rootLocationId,n.hu]);
    await migration.query('INSERT INTO public.production_batches(tenant_id,id,recipe_id,output_document_id,target_location_id,output_quantity) VALUES($1,$2,$3,$4,$5,1)',[t,n.batch,n.recipe,n.into,world.rootLocationId]);
    await migration.query('INSERT INTO public.production_packages(tenant_id,id,production_batch_id,document_id,document_line_id,package_no) VALUES($1,$2,$3,$4,$5,1)',[t,n.hu,n.batch,n.into,n.intoLine]);
    await migration.query("INSERT INTO public.stock_dimensions(tenant_id,id,item_id,location_id,handling_unit_id,stock_status) VALUES($1,$2,$3,$4,$5,'AVAILABLE')",[t,n.dim,n.item,world.rootLocationId,n.hu]);
    await migration.query('INSERT INTO public.stock_balances(tenant_id,stock_dimension_id,quantity) VALUES($1,$2,1)',[t,n.dim]);
    await migration.query("INSERT INTO public.stock_ledger(tenant_id,document_id,document_line_id,stock_dimension_id,quantity,reason,business_date) VALUES($1,$2,$3,$4,1,'Cycle positive leg','2026-10-14')",[t,n.into,n.intoLine,n.dim]);
    await migration.query("UPDATE public.documents SET status='POSTED',number=$3 WHERE tenant_id=$1 AND id=$2",[t,n.into,n.into]);
   }
   for(const [i,n] of nodes.entries()){
    const input=nodes[1-i]!;
    await migration.query('INSERT INTO public.production_inputs(tenant_id,production_batch_id,handling_unit_id,previous_document_line_id,sequence_no,current_balance_version,base_quantity) VALUES($1,$2,$3,$4,1,0,1)',[t,n.batch,input.hu,input.intoLine]);
    await migration.query("INSERT INTO public.documents(tenant_id,id,kind,type_version_id,warehouse_id,business_date,created_by) SELECT $1,$2,'STOCK_OUT',id,$3,'2026-10-14',$4 FROM public.document_type_versions WHERE tenant_id IS NULL AND key='STOCK_OUT' AND version=1",[t,n.out,world.warehouseId,world.ownerUserId]);
    await migration.query("INSERT INTO public.document_lines(tenant_id,id,document_id,line_no,item_id,unit_id,quantity,conversion_factor,base_quantity,source_location_id,handling_unit_id,stock_status) VALUES($1,$2,$3,1,$4,$5,1,1,1,$6,$7,'AVAILABLE')",[t,n.outLine,n.out,input.item,kg,world.rootLocationId,input.hu]);
    await migration.query("INSERT INTO public.package_movement_steps(tenant_id,handling_unit_id,document_id,document_line_id,operation,sequence_no,previous_document_line_id,source_location_id,target_location_id,source_stock_status,target_stock_status,base_quantity,production_batch_id) VALUES($1,$2,$3,$4,'CONSUME',1,$5,$6,$6,'AVAILABLE','AVAILABLE',1,$7)",[t,input.hu,n.out,n.outLine,input.intoLine,world.rootLocationId,n.batch]);
    await migration.query("INSERT INTO public.stock_document_links(tenant_id,source_document_id,target_document_id,kind,recipe_id) VALUES($1,$2,$3,'PRODUCTION',$4)",[t,n.out,n.into,n.recipe]);
    await migration.query("INSERT INTO public.stock_ledger(tenant_id,document_id,document_line_id,stock_dimension_id,quantity,reason,business_date) VALUES($1,$2,$3,$4,-1,'Cycle negative leg','2026-10-14')",[t,n.out,n.outLine,input.dim]);
    await migration.query('UPDATE public.stock_balances SET quantity=0,version=version+1 WHERE tenant_id=$1 AND stock_dimension_id=$2',[t,input.dim]);
    await migration.query("UPDATE public.documents SET status='POSTED',number=$3 WHERE tenant_id=$1 AND id=$2",[t,n.out,n.out]);
   }
   expect((await migration.query("SELECT has_table_privilege(current_user,'public.production_inputs','INSERT') AS ins,current_user='wms_app' AS runtime")).rows[0]).toEqual({ins:true,runtime:false});
   await expect(flush(migration)).rejects.toMatchObject({code:'23514',message:'PACKAGE_PRODUCTION_CYCLE'});
  }finally{await migration.query('ROLLBACK');}
 });

 it("two HU allocations20+30 share one real OUT document and consume each exactly once",async()=>tx(async()=>{
  const first=await origin(app,'AVAILABLE'),second=await origin(app,'AVAILABLE');const s=await prepareProduction(first,null,20,40);
  const t=world.tenantId;await app.query('INSERT INTO public.production_inputs(tenant_id,production_batch_id,handling_unit_id,previous_document_line_id,sequence_no,current_balance_version,base_quantity) VALUES($1,$2,$3,$4,1,0,30)',[t,s.batch,second.hu,second.line]);
  const doc=randomUUID();await app.query("INSERT INTO public.documents(tenant_id,id,kind,type_version_id,warehouse_id,business_date,created_by) SELECT $1,$2,'STOCK_OUT',id,$3,'2026-10-14',$4 FROM public.document_type_versions WHERE tenant_id IS NULL AND key='STOCK_OUT' AND version=1",[t,doc,world.warehouseId,world.ownerUserId]);
  for(const [index,input,amount] of [[1,first,20],[2,second,30]] as const){
   const line=randomUUID();await app.query("INSERT INTO public.document_lines(tenant_id,id,document_id,line_no,item_id,unit_id,quantity,conversion_factor,base_quantity,source_location_id,handling_unit_id,stock_status) VALUES($1,$2,$3,$4,$5,$6,$7,1,$7,$8,$9,'AVAILABLE')",[t,line,doc,index,world.itemNoneId,kg,amount,world.rootLocationId,input.hu]);
   await app.query("INSERT INTO public.package_movement_steps(tenant_id,handling_unit_id,document_id,document_line_id,operation,sequence_no,previous_document_line_id,source_location_id,target_location_id,source_stock_status,target_stock_status,base_quantity,production_batch_id) VALUES($1,$2,$3,$4,'CONSUME',1,$5,$6,$6,'AVAILABLE','AVAILABLE',$7,$8)",[t,input.hu,doc,line,input.line,world.rootLocationId,amount,s.batch]);
   await app.query("INSERT INTO public.stock_ledger(tenant_id,document_id,document_line_id,stock_dimension_id,quantity,reason,business_date) VALUES($1,$2,$3,$4,$5,'Multi-input consume','2026-10-14')",[t,doc,line,input.dimension,-amount]);
   await app.query('UPDATE public.stock_balances SET quantity=quantity-$3,version=version+1 WHERE tenant_id=$1 AND stock_dimension_id=$2',[t,input.dimension,amount]);
  }
  await app.query("INSERT INTO public.stock_document_links(tenant_id,source_document_id,target_document_id,kind,recipe_id) VALUES($1,$2,$3,'PRODUCTION',$4)",[t,doc,s.document,recipe]);
  await app.query("INSERT INTO public.stock_dimensions(tenant_id,id,item_id,location_id,handling_unit_id,stock_status) VALUES($1,$2,$3,$4,$5,'AVAILABLE')",[t,s.dimension,outputItem,world.rootLocationId,s.hu]);
  await app.query('INSERT INTO public.stock_balances(tenant_id,stock_dimension_id,quantity) VALUES($1,$2,40)',[t,s.dimension]);
  await app.query("INSERT INTO public.stock_ledger(tenant_id,document_id,document_line_id,stock_dimension_id,quantity,reason,business_date) VALUES($1,$2,$3,$4,40,'Multi-input output','2026-10-14')",[t,s.document,s.line,s.dimension]);
  for(const id of [doc,s.document])await app.query("UPDATE public.documents SET status='POSTED',number=$3 WHERE tenant_id=$1 AND id=$2",[t,id,id]);
  await flush();
  expect((await app.query('SELECT count(DISTINCT document_id)::int AS docs,count(*)::int AS lines,sum(base_quantity)::text AS total FROM public.package_movement_steps WHERE production_batch_id=$1',[s.batch])).rows[0]).toEqual({docs:1,lines:2,total:'50.000000'});
  expect((await app.query('SELECT quantity::text FROM public.stock_balances WHERE stock_dimension_id=$1',[first.dimension])).rows[0]?.quantity).toBe('180.000000');
  expect((await app.query('SELECT quantity::text FROM public.stock_balances WHERE stock_dimension_id=$1',[second.dimension])).rows[0]?.quantity).toBe('170.000000');
 }));

 it("nonempty36 down refuses preserving pending genealogy and migrationledger",async()=>{
  await expect(migrateDown({url:direct,to:'0035',wmsEnv:'staging'})).rejects.toThrow(/package production data exists/);expect((await migration.query('SELECT max(version) AS version FROM wms_meta.schema_migrations')).rows[0]?.version).toBe('0036');
 });
});

});
