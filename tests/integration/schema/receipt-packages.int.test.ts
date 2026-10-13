import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateDown, migrateUp } from "../../../packages/db/src/migrate.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv, redactErrorChain, secretUrls } from "../harness/env.ts";

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
async function post() {
  await app.query("INSERT INTO public.stock_dimensions(tenant_id,id,item_id,location_id,handling_unit_id,stock_status) VALUES($1,$2,$3,$4,$5,'AVAILABLE')",[world.tenantId,dimension,world.itemNoneId,world.rootLocationId,hu]);
  await app.query("INSERT INTO public.stock_ledger(tenant_id,document_id,document_line_id,stock_dimension_id,quantity,reason,business_date) VALUES($1,$2,$3,$4,6,'Synthetic package acceptance','2026-10-13')",[world.tenantId,document,line,dimension]);
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
  it("empty32→31→32 keeps old tables and schema ledger",async()=> {
    expect((await migrateDown({url:direct,to:"0031",wmsEnv:"staging"})).reverted).toEqual(["0032"]);
    expect((await migration.query("SELECT to_regclass('public.receipt_packages') AS table")).rows[0]?.table).toBeNull();
    expect((await migrateUp({url:direct})).applied).toEqual(["0032"]);
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

});
