import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateUp } from "../../../packages/db/src/migrate.ts";
import { createDbClient, type DbClient } from "../../../packages/db/src/index.ts";
import { approvePackageQuality, putawayPackage, getCurrentPackage, resolveCurrentPackageQr, preparePackageReceipt, postPackageReceipt, getPackageReceipt } from "../../../packages/domain/src/operations/index.ts";
import type { StockDocCallParams } from "../../../packages/domain/src/stock/index.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv, redactErrorChain, secretUrls } from "../harness/env.ts";
const env = readIntEnv(process.env), name = `wms_pkg_current_${randomBytes(6).toString("hex")}`;
const admin = new pg.Client({ connectionString: env.databaseUrlDirect });
let db: DbClient, adm: pg.Client, A: TenantWorld, B: TenantWorld, receiving: string, storage: string, storageTwo: string, item: string, kg: string;
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
    A = await seedWorld(adm, newRegistry(), "PKGCURRENT"); B = await seedWorld(adm, newRegistry(), "PKGCURRENTOTHER");
    // seedWorld grants PICKER; start roleless, then restore PICKER in the permission-projection case.
    await q("DELETE FROM membership_roles WHERE tenant_id=$1 AND membership_id=$2", [A.tenantId, A.memberMembershipId]);
    receiving = id(); storage = id(); storageTwo = id(); item = id();
    for (const [location, kind] of [[receiving, "RECEIVING"], [storage, "STORAGE"], [storageTwo, "STORAGE"]]) await q("INSERT INTO locations(tenant_id,id,warehouse_id,code,name,depth,kind) VALUES($1,$2::uuid,$3,$2::text,'Movement location',0,$4)", [A.tenantId, location, A.warehouseId, kind]);
    kg = id(); await q("INSERT INTO units(tenant_id,id,code,name) VALUES($1,$2,'KG','Kilogram')", [A.tenantId,kg]);
    await q("INSERT INTO items(tenant_id,id,code,name,base_unit_id,tracking_mode,quantity_scale) VALUES($1,$2::uuid,$2::text,'Granule KG',$3,'LOT',3)", [A.tenantId, item, kg]);
    await q("UPDATE tenant_settings SET receiving_qc_enabled=true WHERE tenant_id=$1", [A.tenantId]);
    const app = new URL(env.databaseUrl); app.pathname = `/${name}`; app.hostname = direct.hostname; app.port = direct.port;
    db = createDbClient({ url: app.toString(), poolMax: 6, prepare: true });
  } catch (e) { throw new Error(redactErrorChain(e, secretUrls(env))); }
}, 120000);
afterAll(async () => { await db?.close(); await adm?.end(); await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await admin.end(); });
describe("T-943 authorized current physical-package projection", () => {
  it("immutable origin metadata differs from actual QC and STORAGE state", async () => {
    const d=await receipt(1),p=d.packages[0]!;
    const first=await getCurrentPackage(params(),{packageId:p.id});
    expect(first).toMatchObject({id:p.id,qr:p.qr,baseUnitCode:"KG",currentBaseQuantity:"200.000000",originBaseQuantity:"200.000000",lotCode:"LOT-TRACE",producedOn:"2026-10-01",expiresOn:"2027-10-01",predecessorVersion:0,allowedActions:["QC_RELEASE"],blockedReason:null,currentLocation:{id:receiving}});
    await approvePackageQuality(params(),await input(p.id));
    const ready=await resolveCurrentPackageQr(params(),{qr:p.qr});expect(ready).toMatchObject({id:p.id,predecessorVersion:1,currentStockStatus:"AVAILABLE",allowedActions:["PUTAWAY"],currentLocation:{id:receiving}});
    await putawayPackage(params(),{...await input(p.id),targetLocationId:storage});
    const moved=await getCurrentPackage(params(),{packageId:p.id});expect(moved).toMatchObject({id:p.id,qr:p.qr,predecessorVersion:2,currentLocation:{id:storage},currentBaseQuantity:"200.000000",lotId:first.lotId,producedOn:first.producedOn,expiresOn:first.expiresOn});
    expect(moved.currentBalanceVersion).toBe((await state(p.id)).version);expect(await totals(p.id)).toEqual({entries:5,net:"200.000000"});
    await expect(putawayPackage(params(),{packageId:p.id,predecessorVersion:ready.predecessorVersion,currentBalanceVersion:ready.currentBalanceVersion!,targetLocationId:storageTwo})).rejects.toMatchObject({code:"VERSION_CONFLICT"});
  });
  it("foreign or unrelated QR reveals no metadata, missing roles/MFA deny",async()=>{
    const p=(await receipt(1)).packages[0]!;
    await expect(getCurrentPackage(params(id(),{tenantSlug:B.slug,principal:{userId:B.ownerUserId,mfaVerified:true}}),{packageId:p.id})).rejects.toMatchObject({code:"NOT_FOUND"});
    for(const qr of [p.id,`EWMS:PKG:2:${p.id}`,`EWMS:PALLET:1:${p.id}`,"123456"])await expect(resolveCurrentPackageQr(params(),{qr})).rejects.toMatchObject({code:"VALIDATION_FAILED"});
    await expect(getCurrentPackage(params(id(),{principal:{userId:A.memberUserId,mfaVerified:true}}),{packageId:p.id})).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(getCurrentPackage(params(id(),{principal:{userId:A.ownerUserId,mfaVerified:false}}),{packageId:p.id})).rejects.toMatchObject({code:"FORBIDDEN",detail:"MFA_REQUIRED"});
  });
  it("draft is visible with no stock/actions, reads never create dimensions,steps,audit",async()=>{
    const prepared=await preparePackageReceipt(params(),{warehouseId:A.warehouseId,receivingLocationId:receiving,itemId:item,unitId:kg,kind:"VARIL",packages:{mode:"equal",count:1,quantity:"200",lotCode:"LOT-TRACE"}});
    const d=await getPackageReceipt(params(),{documentId:prepared.documentId as string}),p=d.packages[0]!;
    const before=(await q("SELECT (SELECT count(*) FROM stock_dimensions)::int AS dimensions,(SELECT count(*) FROM package_movement_steps)::int AS steps,(SELECT count(*) FROM audit_logs)::int AS audit"))[0];
    expect(await getCurrentPackage(params(),{packageId:p.id})).toMatchObject({currentBaseQuantity:"0.000000",originBaseQuantity:"200.000000",currentLocation:null,currentStockStatus:null,currentBalanceVersion:null,allowedActions:[],blockedReason:"DRAFT"});
    expect((await q("SELECT (SELECT count(*) FROM stock_dimensions)::int AS dimensions,(SELECT count(*) FROM package_movement_steps)::int AS steps,(SELECT count(*) FROM audit_logs)::int AS audit"))[0]).toEqual(before);
  });
  it("stock-view operator receives no QC permission but may putaway after authorized release",async()=>{
    const p=(await receipt(1)).packages[0]!;
    await q("INSERT INTO membership_roles(tenant_id,membership_id,role_key) VALUES($1,$2,'PICKER')",[A.tenantId,A.memberMembershipId]);
    const viewer=params(id(),{principal:{userId:A.memberUserId,mfaVerified:true}});
    expect(await getCurrentPackage(viewer,{packageId:p.id})).toMatchObject({allowedActions:[],blockedReason:"NO_PERMISSION"});
    await approvePackageQuality(params(),await input(p.id));
    expect((await getCurrentPackage(viewer,{packageId:p.id})).allowedActions).toEqual(["PUTAWAY"]);
  });
});
