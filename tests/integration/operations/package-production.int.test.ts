import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateUp } from "../../../packages/db/src/migrate.ts";
import { createDbClient, type DbClient } from "../../../packages/db/src/index.ts";
import { approvePackageQuality, createProductionRecipe, getCurrentPackage, getPackageReceipt, getPackageProductionBatch, postPackageProduction, postPackageReceipt, preparePackageProduction, preparePackageReceipt, previewPackageProduction, putawayPackage, resolveCurrentPackageQr, transferPackage, type ProducePackageInput } from "../../../packages/domain/src/operations/index.ts";
import { parseProducePackageInput } from "../../../packages/domain/src/operations/production.ts";
import { approveDocument, createStockDocument, reserve, type StockDocCallParams } from "../../../packages/domain/src/stock/index.ts";
import { mkMembership, mkUser, newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv, redactErrorChain, secretUrls } from "../harness/env.ts";

const env = readIntEnv(process.env), name = `wms_pkg_production_${randomBytes(6).toString("hex")}`;
const admin = new pg.Client({ connectionString: env.databaseUrlDirect });
let adm: pg.Client, db: DbClient, A: TenantWorld, B: TenantWorld;
let receiving: string, storage: string, shelf: string, targetWarehouse: string, target: string, targetShelf: string;
let kg: string, gr: string, inputItem: string, outputItem: string, secondOutput: string, recipeId: string;
let sourceOnly: string, targetOnly: string, both: string, readOnly: string;
const id = () => randomUUID();
const params = (key = id(), extra: Partial<StockDocCallParams> = {}): StockDocCallParams => ({ db, principal: { userId: A.ownerUserId, mfaVerified: true }, tenantSlug: A.slug, clientKey: key, retry: { sleep: async () => undefined }, ...extra });
const actor = (userId: string) => params(id(), { principal: { userId, mfaVerified: true } });
async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> { return (await adm.query<T>(text, values)).rows; }
async function version(packageId: string) {
  const v = await getCurrentPackage(params(), { packageId });
  if (v.currentBalanceVersion === null) throw new Error("test requires a positive package balance");
  return { packageId, predecessorVersion: v.predecessorVersion, currentBalanceVersion: v.currentBalanceVersion };
}
async function receipt(count = 5, originalGr = false) {
  const p = await preparePackageReceipt(params(), { warehouseId: A.warehouseId, receivingLocationId: receiving, itemId: inputItem, unitId: originalGr ? gr : kg, kind: "VARIL", packages: { mode: "equal", count, quantity: originalGr ? "200000" : "200", lotCode: `RAW-${id()}`, producedOn: "2026-10-01", expiresOn: "2027-10-01" } });
  const d = await getPackageReceipt(params(), { documentId: p.documentId as string });
  await postPackageReceipt(params(), { documentId: d.documentId, expectedVersion: 1 });
  for (const pkg of d.packages) { await approvePackageQuality(params(), await version(pkg.id)); await putawayPackage(params(), { ...await version(pkg.id), targetLocationId: storage }); }
  return d;
}
async function production(packageIds: readonly string[], amounts: readonly string[] = ["50"], outputQuantity = "10", overrides: Partial<ProducePackageInput> = {}): Promise<ProducePackageInput> {
  const inputs = await Promise.all(packageIds.map(async (packageId, i) => ({ ...await version(packageId), baseQuantity: amounts[i]! })));
  return { recipeId, recipeVersion: 1, outputQuantity, targetLocationId: storage, inputs, outputs: { kind: "KOLI", packages: { mode: "equal", count: 1, quantity: outputQuantity, lotCode: `OUTPUT-${id()}`, producedOn: "2026-10-14", expiresOn: "2028-10-14" } }, ...overrides };
}
async function prepared(v: ProducePackageInput) {
  const p = await preparePackageProduction(params(), v);
  const batch = await getPackageProductionBatch(params(), { documentId: p.documentId as string });
  return batch;
}
async function post(batch: Awaited<ReturnType<typeof prepared>>, call = params()) { return postPackageProduction(call, { documentId: batch.documentId, expectedVersion: batch.documentVersion }); }
async function snapshot() {
  const rows = async (table: string, order: string) => q(`SELECT * FROM public.${table} WHERE tenant_id=$1 ORDER BY ${order}`, [A.tenantId]);
  return { documents: await rows("documents", "id"), lines: await rows("document_lines", "id"), hu: await rows("handling_units", "id"), lots: await rows("lots", "id"), batches: await rows("production_batches", "id"), outputs: await rows("production_packages", "id"), allocations: await rows("production_inputs", "production_batch_id,handling_unit_id"), steps: await rows("package_movement_steps", "document_line_id"), links: await rows("stock_document_links", "source_document_id,target_document_id"), dimensions: await rows("stock_dimensions", "id"), balances: await rows("stock_balances", "stock_dimension_id"), ledger: await rows("stock_ledger", "id"), audits: await rows("audit_logs", "id"), sequences: await rows("number_sequences", "document_kind,period"), completed: await q("SELECT * FROM public.idempotency_records WHERE tenant_id=$1 AND status='COMPLETED' ORDER BY id", [A.tenantId]) };
}
async function quantities(packageIds: readonly string[]) { return q("SELECT sd.handling_unit_id,sum(b.quantity)::text AS quantity FROM public.stock_dimensions sd JOIN public.stock_balances b ON b.tenant_id=sd.tenant_id AND b.stock_dimension_id=sd.id WHERE sd.tenant_id=$1 AND sd.handling_unit_id=ANY($2::uuid[]) GROUP BY sd.handling_unit_id ORDER BY sd.handling_unit_id", [A.tenantId, packageIds]); }
beforeAll(async () => {
  try {
    await admin.connect(); await admin.query(`CREATE DATABASE ${name}`);
    const direct = new URL(env.databaseUrlDirect); direct.pathname = `/${name}`; await migrateUp({ url: direct.toString() });
    adm = new pg.Client({ connectionString: direct.toString() }); await adm.connect();
    A = await seedWorld(adm, newRegistry(), "PKGPRODUCTION"); B = await seedWorld(adm, newRegistry(), "PKGPRODUCTIONFOREIGN");
    receiving = id(); storage = id(); shelf = id(); targetWarehouse = id(); target = id(); targetShelf = id(); kg = id(); gr = id(); inputItem = id(); outputItem = id(); secondOutput = id();
    await q("INSERT INTO public.warehouses(tenant_id,id,code,name) VALUES($1,$2,$3,'Production target')", [A.tenantId, targetWarehouse, `W-${id()}`]);
    for (const [location, warehouse, kind] of [[receiving,A.warehouseId,"RECEIVING"],[storage,A.warehouseId,"STORAGE"],[shelf,A.warehouseId,"STORAGE"],[target,targetWarehouse,"STORAGE"],[targetShelf,targetWarehouse,"STORAGE"]]) await q("INSERT INTO public.locations(tenant_id,id,warehouse_id,code,name,depth,kind) VALUES($1,$2,$3,$4,'Production location',0,$5)", [A.tenantId, location, warehouse, `L-${id()}`, kind]);
    await q("INSERT INTO public.units(tenant_id,id,code,name) VALUES($1,$2,'KG','Kilogram'),($1,$3,'GR','Gram')", [A.tenantId, kg, gr]);
    for (const [item, code] of [[inputItem,"RAW"],[outputItem,"PRODUCT"],[secondOutput,"SECOND"]]) await q("INSERT INTO public.items(tenant_id,id,code,name,base_unit_id,tracking_mode,quantity_scale) VALUES($1,$2,$3,$4,$5,'LOT',3)", [A.tenantId,item,code,`Synthetic ${code}`,kg]);
    await q("INSERT INTO public.unit_conversions(tenant_id,item_id,unit_id,to_base_factor) VALUES($1,$2,$3,0.001)", [A.tenantId,inputItem,gr]);
    await q("UPDATE public.tenant_settings SET receiving_qc_enabled=true WHERE tenant_id=$1", [A.tenantId]);
    const app = new URL(env.databaseUrl); app.pathname = direct.pathname; app.hostname = direct.hostname; app.port = direct.port;
    db = createDbClient({ url: app.toString(), poolMax: 6, prepare: true });
    recipeId = (await createProductionRecipe(params(), { code: "PKG-RECIPE", version: 1, name: "Physical recipe", outputItemId: outputItem, outputQuantity: "10", lines: [{ itemId: inputItem, quantity: "50" }] })).recipeId;
    const member = async (label: string, warehouses: string[], role: "PICKER" | "READ_ONLY" = "PICKER") => { const user = await mkUser(adm,newRegistry(),label), m = await mkMembership(adm,A.tenantId,user,{roles:[role]}); for(const warehouse of warehouses) await q("INSERT INTO public.membership_warehouse_scopes(tenant_id,membership_id,warehouse_id) VALUES($1,$2,$3)",[A.tenantId,m,warehouse]); return user; };
    sourceOnly = await member("Production source-only", [A.warehouseId]); targetOnly = await member("Production target-only", [targetWarehouse]); both = await member("Production both", [A.warehouseId,targetWarehouse]); readOnly = await member("Production reader", [A.warehouseId,targetWarehouse], "READ_ONLY");
  } catch (e) { throw new Error(redactErrorChain(e, secretUrls(env))); }
}, 120000);
afterAll(async () => { await db?.close(); await adm?.end(); await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await admin.end(); });

describe("T964 real physical package production", () => {
  it("readonly preview and APPROVED preparation create stable identities without stock, link or consume", async () => {
    const d = await receipt(), p = d.packages[0]!, v = await production([p.id]), before = await snapshot();
    const preview = await previewPackageProduction(params(), v);
    expect(preview).toMatchObject({ recipeId, recipeVersion: 1, outputQuantity: "10.000000", outputUnitId: kg, outputUnitCode: "KG", components: [{ itemId: inputItem, requiredBaseQuantity: "50.000000", allocatedBaseQuantity: "50.000000" }], inputs: [{ packageId: p.id, originBaseQuantity: "200.000000", remainingBaseQuantity: "200.000000", consumeBaseQuantity: "50.000000" }] });
    expect(await snapshot()).toEqual(before);
    const batch = await prepared(v), after = await snapshot();
    expect(batch).toMatchObject({ documentStatus: "APPROVED", documentNumber: null, outputQuantity: "10.000000", recipeId });
    expect(batch.packages).toHaveLength(1); expect(batch.packages[0]!.id).not.toBe(p.id); expect(batch.packages[0]!.qr).toBe(`EWMS:PKG:1:${batch.packages[0]!.id}`);
    for (const key of ["ledger","balances","dimensions","steps","links","sequences"] as const) expect(after[key]).toEqual(before[key]);
    expect((await getCurrentPackage(params(), { packageId: batch.packages[0]!.id }))).toMatchObject({ originKind: "PRODUCTION", currentBaseQuantity: "0.000000", blockedReason: "DRAFT", canTransfer: false, allowedActions: [] });
    await expect(putawayPackage(params(), { packageId: batch.packages[0]!.id, predecessorVersion: 0, currentBalanceVersion: "0", targetLocationId: shelf })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect((await getPackageProductionBatch(params(), { documentId: batch.documentId })).packages).toEqual(batch.packages);
  });
  it("consume50 leaves same physical QR150, fresh output and exact one genealogy allocation", async () => {
    const d = await receipt(), p = d.packages[0]!, batch = await prepared(await production([p.id]));
    const result = await post(batch); expect(result).toMatchObject({ documentId: batch.documentId, status: "POSTED", replayed: false });
    const current = await resolveCurrentPackageQr(params(), { qr: p.qr });
    expect(current).toMatchObject({ id: p.id, qr: p.qr, originBaseQuantity: "200.000000", remainingBaseQuantity: "150.000000", currentBaseQuantity: "150.000000", lotCode: p.lotCode, producedOn: p.producedOn, expiresOn: p.expiresOn, canTransfer: true });
    expect(await quantities(d.packages.slice(1).map(x=>x.id))).toEqual(d.packages.slice(1).map(x=>({handling_unit_id:x.id,quantity:"200.000000"})).sort((a,b)=>a.handling_unit_id.localeCompare(b.handling_unit_id)));
    const posted = await getPackageProductionBatch(params(), { documentId: batch.documentId }); expect(posted.packages).toEqual(batch.packages); expect(posted.documentStatus).toBe("POSTED"); expect(posted.documentNumber).toMatch(/^GRS-/);
    expect(await q("SELECT handling_unit_id,base_quantity::text FROM public.production_inputs WHERE production_batch_id=$1",[batch.batchId])).toEqual([{handling_unit_id:p.id,base_quantity:"50.000000"}]);
    const links = await q("SELECT source_document_id FROM public.stock_document_links WHERE target_document_id=$1 AND kind='PRODUCTION'",[batch.documentId]); expect(links).toHaveLength(1);
    expect(await q("SELECT kind,status FROM public.documents WHERE id=ANY($1::uuid[]) ORDER BY kind",[[links[0]!.source_document_id,batch.documentId]])).toEqual([{kind:"STOCK_IN",status:"POSTED"},{kind:"STOCK_OUT",status:"POSTED"}]);
    expect(await q("SELECT quantity::text FROM public.stock_ledger WHERE document_id=ANY($1::uuid[]) ORDER BY stock_ledger.quantity",[[links[0]!.source_document_id,batch.documentId]])).toEqual([{quantity:"-50.000000"},{quantity:"10.000000"}]);
  });
  it("two inputs20+30 use one OUT and multioutput genealogy totals50 only once", async () => {
    const d = await receipt(2), v = await production(d.packages.map(x=>x.id), ["20","30"], "10", { outputs: { kind: "KOLI", packages: { mode: "equal", count: 2, quantity: "5", lotCode: `MULTI-${id()}`, producedOn: "2026-10-14", expiresOn: "2028-10-14" } } }), batch = await prepared(v);
    await post(batch); expect(batch.packages).toHaveLength(2); expect(new Set(batch.packages.map(x=>x.id)).size).toBe(2);
    expect((await q("SELECT count(*)::int AS n,sum(base_quantity)::text AS quantity FROM public.production_inputs WHERE production_batch_id=$1",[batch.batchId]))[0]).toEqual({n:2,quantity:"50.000000"});
    const source = (await q("SELECT source_document_id FROM public.stock_document_links WHERE target_document_id=$1",[batch.documentId]))[0]!.source_document_id;
    expect((await q("SELECT count(*)::int AS n FROM public.documents WHERE id=$1 AND kind='STOCK_OUT'",[source]))[0]?.n).toBe(1);
    expect((await q("SELECT count(*)::int AS n,sum(quantity)::text AS quantity FROM public.stock_ledger WHERE document_id=$1",[source]))[0]).toEqual({n:2,quantity:"-50.000000"});
    expect(await quantities(d.packages.map(x=>x.id))).toEqual(d.packages.map((x,i)=>({handling_unit_id:x.id,quantity:i?"170.000000":"180.000000"})).sort((a,b)=>a.handling_unit_id.localeCompare(b.handling_unit_id)));
    for(const p of batch.packages) expect(await getCurrentPackage(params(),{packageId:p.id})).toMatchObject({originKind:"PRODUCTION",currentBaseQuantity:"5.000000",currentStockStatus:"AVAILABLE"});
  });
  it("output AVAILABLE rejects QC and supports putaway, B transfer and second production as input", async () => {
    const raw = (await receipt(1)).packages[0]!, batch = await prepared(await production([raw.id])); await post(batch);
    const output = batch.packages[0]!, view = await getCurrentPackage(params(), { packageId: output.id }); expect(view).toMatchObject({ originKind: "PRODUCTION", currentStockStatus: "AVAILABLE", currentBaseQuantity: "10.000000", lotCode: output.lotCode });
    const qcBefore=await snapshot();expect(view.allowedActions).toEqual(["PUTAWAY"]);
    await expect(approvePackageQuality(params(), await version(output.id))).rejects.toMatchObject({code:"VERSION_CONFLICT"});expect(await snapshot()).toEqual(qcBefore);
    await putawayPackage(params(), {...await version(output.id),targetLocationId:shelf}); await transferPackage(params(),{...await version(output.id),targetLocationId:target});
    expect((await getCurrentPackage(params(),{packageId:output.id})).warehouseId).toBe(targetWarehouse);
    const nextRecipe = (await createProductionRecipe(params(),{code:`SECOND-${id()}`,version:1,name:"Second production",outputItemId:secondOutput,outputQuantity:"10",lines:[{itemId:outputItem,quantity:"10"}]})).recipeId;
    const second = await prepared(await production([output.id],["5"],"5",{recipeId:nextRecipe,targetLocationId:targetShelf})); await post(second);
    expect(await getCurrentPackage(params(),{packageId:output.id})).toMatchObject({qr:output.qr,originBaseQuantity:"10.000000",currentBaseQuantity:"5.000000",warehouseId:targetWarehouse});
    expect(second.packages[0]!.id).not.toBe(output.id); expect((await getCurrentPackage(params(),{packageId:second.packages[0]!.id})).currentBaseQuantity).toBe("5.000000");
  });
  it("full consumption keeps zero QR readable and all movement disabled", async () => {
    const p = (await receipt(1)).packages[0]!, batch = await prepared(await production([p.id],["200"],"40")); await post(batch);
    const v = await getCurrentPackage(params(),{packageId:p.id}); expect(v).toMatchObject({id:p.id,qr:p.qr,originBaseQuantity:"200.000000",remainingBaseQuantity:"0.000000",currentBaseQuantity:"0.000000",canTransfer:false,allowedActions:[]});
    await expect(transferPackage(params(),{packageId:p.id,predecessorVersion:v.predecessorVersion,currentBalanceVersion:"0",targetLocationId:target})).rejects.toMatchObject({code:"VALIDATION_FAILED"});
  });
  it("sealed GR factor consumes50000 GR for50 KG then transfers remaining150000 GR exactly", async () => {
    const p = (await receipt(1,true)).packages[0]!, batch = await prepared(await production([p.id])); await post(batch);
    expect((await q("SELECT quantity::text,conversion_factor::text,base_quantity::text FROM public.document_lines WHERE handling_unit_id=$1 AND source_location_id IS NOT NULL AND base_quantity=50",[p.id]))[0]).toEqual({quantity:"50000.000000",conversion_factor:"0.001000",base_quantity:"50.000000"});
    await q("UPDATE public.unit_conversions SET to_base_factor=0.002 WHERE tenant_id=$1 AND item_id=$2 AND unit_id=$3",[A.tenantId,inputItem,gr]);
    try {const moved=await transferPackage(params(),{...await version(p.id),targetLocationId:target}); expect((await q("SELECT quantity::text,conversion_factor::text,base_quantity::text FROM public.document_lines WHERE document_id=$1",[moved.documentId]))[0]).toEqual({quantity:"150000.000000",conversion_factor:"0.001000",base_quantity:"150.000000"});} finally {await q("UPDATE public.unit_conversions SET to_base_factor=0.001 WHERE tenant_id=$1 AND item_id=$2 AND unit_id=$3",[A.tenantId,inputItem,gr]);}
  });
  it("prepare/post same keys concurrent and lost reply reuse batch/output IDs; changed payload rejects", async () => {
    const p=(await receipt(1)).packages[0]!,v=await production([p.id]),call=params(),[a,b]=await Promise.all([preparePackageProduction(call,v),preparePackageProduction(call,v)]); expect(a.documentId).toBe(b.documentId);expect([a.replayed,b.replayed].sort()).toEqual([false,true]);
    const batch=await getPackageProductionBatch(params(),{documentId:a.documentId as string}),before=await snapshot();expect(await preparePackageProduction(call,v)).toMatchObject({documentId:a.documentId,replayed:true});expect(await snapshot()).toEqual(before);
    await expect(preparePackageProduction(call,{...v,targetLocationId:shelf})).rejects.toMatchObject({code:"IDEMPOTENCY_MISMATCH"});
    const postCall=params(),[x,y]=await Promise.all([post(batch,postCall),post(batch,postCall)]);expect(x.documentId).toBe(y.documentId);expect([x.replayed,y.replayed].sort()).toEqual([false,true]);
    const after=await snapshot();expect(await post(batch,postCall)).toMatchObject({documentId:batch.documentId,replayed:true});expect(await snapshot()).toEqual(after);expect((await getPackageProductionBatch(params(),{documentId:batch.documentId})).packages).toEqual(batch.packages);
    await expect(postPackageProduction(postCall,{documentId:batch.documentId,expectedVersion:batch.documentVersion+1})).rejects.toMatchObject({code:"IDEMPOTENCY_MISMATCH"});
  });
  it("lost prepare reply recovers the original IDs after valid input putaway and transfer, while current auth and new-key stale checks remain", async () => {
    const p=(await receipt(1)).packages[0]!,v=await production([p.id]),call=actor(both),prior=process.env.WAREHOUSE_SCOPE_ENABLED;process.env.WAREHOUSE_SCOPE_ENABLED="true";
    try {
      const made=await preparePackageProduction(call,v),original=await getPackageProductionBatch(params(),{documentId:made.documentId as string});
      await putawayPackage(params(),{...await version(p.id),targetLocationId:shelf});
      const afterPutaway=await snapshot();expect(await preparePackageProduction(call,v)).toMatchObject({documentId:made.documentId,status:"APPROVED",replayed:true});expect(await snapshot()).toEqual(afterPutaway);
      await transferPackage(params(),{...await version(p.id),targetLocationId:target});
      const afterTransfer=await snapshot();expect(await preparePackageProduction(call,v)).toMatchObject({documentId:made.documentId,status:"APPROVED",replayed:true});expect(await snapshot()).toEqual(afterTransfer);
      expect((await getPackageProductionBatch(params(),{documentId:made.documentId as string})).packages).toEqual(original.packages);
      await expect(preparePackageProduction(actor(both),v)).rejects.toMatchObject({code:"VERSION_CONFLICT"});
      await expect(preparePackageProduction(call,{...v,targetLocationId:shelf})).rejects.toMatchObject({code:"IDEMPOTENCY_MISMATCH"});
      const adminCall=params(),adminValue=await production([p.id]);await preparePackageProduction(adminCall,adminValue);
      await expect(preparePackageProduction({...adminCall,principal:{userId:A.ownerUserId,mfaVerified:false}},adminValue)).rejects.toMatchObject({code:"FORBIDDEN",detail:"MFA_REQUIRED"});
      const beforeAuthDenials=await snapshot();
      // Current warehouse revocation still denies an otherwise completed prepare replay.
      const membership=(await q("SELECT id FROM public.tenant_memberships WHERE tenant_id=$1 AND user_id=$2",[A.tenantId,both]))[0]!.id;
      await q("DELETE FROM public.membership_warehouse_scopes WHERE tenant_id=$1 AND membership_id=$2 AND warehouse_id=$3",[A.tenantId,membership,targetWarehouse]);
      try {await expect(preparePackageProduction(call,v)).rejects.toMatchObject({code:"FORBIDDEN",detail:"WAREHOUSE_OUT_OF_SCOPE"});}
      finally {await q("INSERT INTO public.membership_warehouse_scopes(tenant_id,membership_id,warehouse_id) VALUES($1,$2,$3)",[A.tenantId,membership,targetWarehouse]);}
      expect(await snapshot()).toEqual(beforeAuthDenials);
    } finally {if(prior===undefined)delete process.env.WAREHOUSE_SCOPE_ENABLED;else process.env.WAREHOUSE_SCOPE_ENABLED=prior;}
  });
  it("current warehouse ACL, readonly role, foreign tenant and MFA boundaries use actual memberships", async () => {
    const p=(await receipt(1)).packages[0]!,v=await production([p.id],["50"],"10",{targetLocationId:target}),prior=process.env.WAREHOUSE_SCOPE_ENABLED;process.env.WAREHOUSE_SCOPE_ENABLED="true";
    try { for(const user of [sourceOnly,targetOnly]) {await expect(previewPackageProduction(actor(user),v)).rejects.toMatchObject({code:"NOT_FOUND"});await expect(preparePackageProduction(actor(user),v)).rejects.toMatchObject({code:"FORBIDDEN",detail:"WAREHOUSE_OUT_OF_SCOPE"});}
      await expect(preparePackageProduction(actor(readOnly),v)).rejects.toMatchObject({code:"FORBIDDEN"});
      await expect(preparePackageProduction(params(id(),{principal:{userId:A.ownerUserId,mfaVerified:false}}),v)).rejects.toMatchObject({code:"FORBIDDEN",detail:"MFA_REQUIRED"});
      await expect(previewPackageProduction(params(id(),{tenantSlug:B.slug,principal:{userId:B.ownerUserId,mfaVerified:true}}),v)).rejects.toMatchObject({code:"NOT_FOUND"});
      const made=await preparePackageProduction(actor(both),v),batch=await getPackageProductionBatch(actor(targetOnly),{documentId:made.documentId as string});await expect(getPackageProductionBatch(actor(sourceOnly),{documentId:batch.documentId})).rejects.toMatchObject({code:"NOT_FOUND"});
      const unverified=params(id(),{principal:{userId:A.ownerUserId,mfaVerified:false}}),foreign=params(id(),{tenantSlug:B.slug,principal:{userId:B.ownerUserId,mfaVerified:true}}),beforeDenied=await snapshot();
      await expect(getPackageProductionBatch(unverified,{documentId:batch.documentId})).rejects.toMatchObject({code:"FORBIDDEN",detail:"MFA_REQUIRED"});
      await expect(post(batch,unverified)).rejects.toMatchObject({code:"FORBIDDEN",detail:"MFA_REQUIRED"});
      await expect(getPackageProductionBatch(foreign,{documentId:batch.documentId})).rejects.toMatchObject({code:"NOT_FOUND"});
      await expect(post(batch,foreign)).rejects.toMatchObject({code:"NOT_FOUND"});
      await expect(post(batch,actor(readOnly))).rejects.toMatchObject({code:"FORBIDDEN"});expect(await snapshot()).toEqual(beforeDenied);
      await expect(post(batch,actor(sourceOnly))).rejects.toMatchObject({code:"FORBIDDEN",detail:"WAREHOUSE_OUT_OF_SCOPE"});await post(batch,actor(both));
      await expect(getCurrentPackage(actor(sourceOnly),{packageId:batch.packages[0]!.id})).rejects.toMatchObject({code:"NOT_FOUND"});expect((await getCurrentPackage(actor(targetOnly),{packageId:batch.packages[0]!.id})).warehouseId).toBe(targetWarehouse);
    } finally {if(prior===undefined)delete process.env.WAREHOUSE_SCOPE_ENABLED;else process.env.WAREHOUSE_SCOPE_ENABLED=prior;}
  });
  it("recipe version/scaling, overdraw and stale input/IN version reject without new effects", async () => {
    const p=(await receipt(1)).packages[0]!,v=await production([p.id]),before=await snapshot();
    await expect(previewPackageProduction(params(),{...v,recipeVersion:2})).rejects.toMatchObject({code:"VERSION_CONFLICT"});
    await expect(previewPackageProduction(params(),await production([p.id],["250"],"50"))).rejects.toMatchObject({code:"VALIDATION_FAILED"});
    await expect(previewPackageProduction(params(),{...v,inputs:[{...v.inputs[0]!,baseQuantity:"49"}]})).rejects.toMatchObject({code:"VALIDATION_FAILED"});expect(await snapshot()).toEqual(before);
    const batch=await prepared(v);await expect(postPackageProduction(params(),{documentId:batch.documentId,expectedVersion:batch.documentVersion+1})).rejects.toMatchObject({code:"VERSION_CONFLICT"});
    await putawayPackage(params(),{...await version(p.id),targetLocationId:shelf});const changed=await snapshot();await expect(post(batch)).rejects.toMatchObject({code:"VERSION_CONFLICT"});expect(await snapshot()).toEqual(changed);
    const scaleRecipe=(await createProductionRecipe(params(),{code:`SCALE-${id()}`,version:1,name:"Exact scale",outputItemId:outputItem,outputQuantity:"3",lines:[{itemId:inputItem,quantity:"1"}]})).recipeId;
    await expect(previewPackageProduction(params(),await production([p.id],["0.333333"],"1",{recipeId:scaleRecipe}))).rejects.toMatchObject({code:"VALIDATION_FAILED",detail:"QUANTITY_SCALE"});
  });
  it("NEW prepare rejects actual mixed source warehouses without output identities or stock effects", async () => {
    const d=await receipt(2),first=d.packages[0]!,second=d.packages[1]!;
    await transferPackage(params(),{...await version(second.id),targetLocationId:target});
    const v=await production([first.id,second.id],["20","30"]),before=await snapshot();
    expect((await getCurrentPackage(params(),{packageId:first.id})).warehouseId).toBe(A.warehouseId);
    expect((await getCurrentPackage(params(),{packageId:second.id})).warehouseId).toBe(targetWarehouse);
    await expect(previewPackageProduction(params(),v)).rejects.toMatchObject({code:"VALIDATION_FAILED"});
    await expect(preparePackageProduction(params(),v)).rejects.toMatchObject({code:"VALIDATION_FAILED"});
    expect(await snapshot()).toEqual(before);
  });
  it("NEW prepare rejects conflicting dates of an existing real output LOT without new effects", async () => {
    const p=(await receipt(1)).packages[0]!,v=await production([p.id]),original=await prepared(v);
    const metadata=original.packages[0]!,before=await snapshot();
    expect(metadata.lotId).not.toBeNull();expect(metadata.producedOn).toBe("2026-10-14");
    const changed={...v,outputs:{kind:"KOLI" as const,packages:{mode:"equal" as const,count:1,quantity:"10",lotCode:metadata.lotCode!,producedOn:"2026-10-15",expiresOn:metadata.expiresOn!}}};
    await expect(previewPackageProduction(params(),changed)).rejects.toMatchObject({code:"VALIDATION_FAILED"});
    await expect(preparePackageProduction(params(),changed)).rejects.toMatchObject({code:"VALIDATION_FAILED"});
    expect(await snapshot()).toEqual(before);
    expect((await getPackageProductionBatch(params(),{documentId:original.documentId})).packages).toEqual(original.packages);
  });
  it("two public consume commands both wait on the original balance before either winner posts",async()=>{
    const p=(await receipt(1)).packages[0]!,v=await production([p.id]),a=await prepared(v),b=await prepared(v);
    const dimension=(await q<{id:string}>("SELECT sd.id FROM public.stock_dimensions sd JOIN public.stock_balances sb ON sb.tenant_id=sd.tenant_id AND sb.stock_dimension_id=sd.id WHERE sd.tenant_id=$1 AND sd.handling_unit_id=$2 AND sb.quantity>0",[A.tenantId,p.id]))[0]!.id;
    const direct=new URL(env.databaseUrlDirect);direct.pathname=`/${name}`;
    const barrier=new pg.Client({connectionString:direct.toString()});await barrier.connect();
    let pending:Promise<PromiseSettledResult<Awaited<ReturnType<typeof post>>>[]>|undefined;
    try {
      await barrier.query("BEGIN");
      await barrier.query("SELECT quantity FROM public.stock_balances WHERE tenant_id=$1 AND stock_dimension_id=$2 FOR UPDATE",[A.tenantId,dimension]);
      pending=Promise.allSettled([post(a),post(b)]);
      const deadline=performance.now()+2000;let waiters:{pid:number;backend_xmin:string;backend_xid:string}[]=[];
      while(performance.now()<deadline){
        waiters=await q("SELECT pid,backend_xmin::text,backend_xid::text FROM pg_stat_activity WHERE datname=$1 AND usename='wms_app' AND wait_event_type='Lock' AND query LIKE '%FROM public.stock_balances%' AND query LIKE '%FOR UPDATE%'",[name]);
        if(waiters.length===2)break;
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(waiters).toHaveLength(2);expect(new Set(waiters.map(w=>w.pid)).size).toBe(2);
      for(const waiter of waiters){expect(waiter.backend_xmin).not.toBeNull();expect(waiter.backend_xid).not.toBeNull();}
      expect((await q("SELECT count(*)::int AS n FROM public.package_movement_steps WHERE handling_unit_id=$1 AND operation='CONSUME'",[p.id]))[0]?.n).toBe(0);
      expect((await getCurrentPackage(params(),{packageId:p.id})).currentBaseQuantity).toBe("200.000000");
      await barrier.query("ROLLBACK");const results=await pending;
      expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);
      expect((results.find(r=>r.status==="rejected") as PromiseRejectedResult).reason).toMatchObject({code:"VERSION_CONFLICT"});
      expect((await getCurrentPackage(params(),{packageId:p.id})).currentBaseQuantity).toBe("150.000000");
      expect((await q("SELECT count(*)::int AS n FROM public.package_movement_steps WHERE handling_unit_id=$1 AND operation='CONSUME'",[p.id]))[0]?.n).toBe(1);
      const views=await Promise.all([getPackageProductionBatch(params(),{documentId:a.documentId}),getPackageProductionBatch(params(),{documentId:b.documentId})]);
      expect(views.map(x=>x.documentStatus).sort()).toEqual(["APPROVED","POSTED"]);
    } finally {await barrier.query("ROLLBACK");await pending;await barrier.end();}
  });
  it("real reserved input and COUNTING target block post while prepared IDs stay APPROVED", async () => {
    const p=(await receipt(1)).packages[0]!,batch=await prepared(await production([p.id]));
    const draft=await createStockDocument(params(),{kind:"STOCK_OUT",warehouseId:A.warehouseId,businessDate:"2026-10-14",lines:[{itemId:inputItem,unitId:kg,quantity:"10",conversionFactor:"1",baseQuantity:"10",sourceLocationId:storage,lotId:p.lotId,stockStatus:"AVAILABLE"}]});
    const line=(await q<{id:string}>("SELECT id FROM public.document_lines WHERE document_id=$1",[draft.documentId]))[0]!.id;await approveDocument(params(),{documentId:draft.documentId as string,expectedVersion:1});await reserve(params(),{documentLineId:line,allocations:[{dimension:{locationId:storage,lotId:p.lotId,handlingUnitId:p.id,stockStatus:"AVAILABLE"},quantity:"10"}]});
    const before=await snapshot();await expect(previewPackageProduction(params(),await production([p.id]))).rejects.toMatchObject({code:"VALIDATION_FAILED"});await expect(post(batch)).rejects.toMatchObject({code:"VERSION_CONFLICT"});expect(await snapshot()).toEqual(before);expect((await getPackageProductionBatch(params(),{documentId:batch.documentId})).packages).toEqual(batch.packages);
    const other=(await receipt(1)).packages[0]!,pending=await prepared(await production([other.id])),session=id();await q("INSERT INTO public.count_sessions(tenant_id,id,warehouse_id,started_by) VALUES($1,$2,$3,$4)",[A.tenantId,session,A.warehouseId,A.ownerMembershipId]);await q("UPDATE public.location_count_locks SET status='COUNTING',count_session_id=$3,locked_at=now(),locked_by=$4 WHERE tenant_id=$1 AND location_id=$2",[A.tenantId,storage,session,A.ownerMembershipId]);
    try {const saved=await snapshot();await expect(post(pending)).rejects.toMatchObject({code:"LOCATION_LOCKED"});expect(await snapshot()).toEqual(saved);} finally {await q("UPDATE public.location_count_locks SET status='IDLE',count_session_id=NULL,locked_at=NULL,locked_by=NULL WHERE tenant_id=$1 AND location_id=$2",[A.tenantId,storage]);}
  });
  for(const order of ["PRODUCTION_FIRST","TRANSFER_FIRST"] as const)it(`domain production/transfer race one winner: ${order}`,async()=>{
    const p=(await receipt(1)).packages[0]!,batch=await prepared(await production([p.id])),move=await version(p.id),consume=()=>post(batch),transfer=()=>transferPackage(params(),{...move,targetLocationId:target}),results=await Promise.allSettled(order==="PRODUCTION_FIRST"?[consume(),transfer()]:[transfer(),consume()]);expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);
    const view=await getCurrentPackage(params(),{packageId:p.id});expect(["150.000000","200.000000"]).toContain(view.currentBaseQuantity);expect((await q("SELECT count(*)::int AS n FROM public.package_movement_steps WHERE handling_unit_id=$1 AND sequence_no=3",[p.id]))[0]?.n).toBe(1);
  });
  it("domain consume/consume race posts only one prepared batch",async()=>{
    const p=(await receipt(1)).packages[0]!,v=await production([p.id]),a=await prepared(v),b=await prepared(v),results=await Promise.allSettled([post(a),post(b)]);expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);expect((await getCurrentPackage(params(),{packageId:p.id})).currentBaseQuantity).toBe("150.000000");
    const views=await Promise.all([getPackageProductionBatch(params(),{documentId:a.documentId}),getPackageProductionBatch(params(),{documentId:b.documentId})]);expect(views.map(x=>x.documentStatus).sort()).toEqual(["APPROVED","POSTED"]);
  });
  it("prepare metadata fault rolls back new HU/LOT/IN/batch/output/allocation identities",async()=>{
    const p=(await receipt(1)).packages[0]!,v=await production([p.id]),before=await snapshot();await injectFault("production_packages",`NEW.tenant_id='${A.tenantId}'::uuid`,()=>preparePackageProduction(params(),v));expect(await snapshot()).toEqual(before);const batch=await prepared(v);expect(batch.packages).toHaveLength(1);
  });
  for(const stage of ["SOURCE_PREPARE","CONSUME","FIRST_LEDGER","SECOND_LEDGER","AUDIT"] as const)it(`post ${stage} marker fault preserves existing IN/IDs and rolls back fresh source/effects`,async()=>{
    const p=(await receipt(1)).packages[0]!,batch=await prepared(await production([p.id])),before=await snapshot();
    const table=stage==="SOURCE_PREPARE"?"documents":stage==="CONSUME"?"package_movement_steps":stage==="AUDIT"?"audit_logs":"stock_ledger";
    const condition=stage==="SOURCE_PREPARE"?`NEW.tenant_id='${A.tenantId}'::uuid AND NEW.kind='STOCK_OUT' AND NEW.reason='PACKAGE_PRODUCTION'`:stage==="CONSUME"?`NEW.production_batch_id='${batch.batchId}'::uuid`:stage==="SECOND_LEDGER"?`NEW.document_id='${batch.documentId}'::uuid`:stage==="FIRST_LEDGER"?`EXISTS(SELECT 1 FROM public.stock_document_links l WHERE l.source_document_id=NEW.document_id AND l.target_document_id='${batch.documentId}'::uuid AND l.kind='PRODUCTION')`:`EXISTS(SELECT 1 FROM public.stock_document_links l WHERE l.source_document_id::text=NEW.entity_id AND l.target_document_id='${batch.documentId}'::uuid AND l.kind='PRODUCTION')`;
    await injectFault(table,condition,()=>post(batch));expect(await snapshot()).toEqual(before);expect((await getPackageProductionBatch(params(),{documentId:batch.documentId}))).toEqual(batch);expect((await getCurrentPackage(params(),{packageId:p.id})).currentBaseQuantity).toBe("200.000000");await post(batch);expect((await getCurrentPackage(params(),{packageId:p.id})).currentBaseQuantity).toBe("150.000000");
  });
});
async function injectFault(table:string,condition:string,call:()=>Promise<unknown>) {
  await q(`CREATE FUNCTION t964_fault() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF ${condition} THEN RAISE EXCEPTION 'T964_SYNTHETIC_FAULT' USING ERRCODE='P0001'; END IF; RETURN NEW; END$$`);await q(`CREATE TRIGGER t964_fault BEFORE INSERT ON public.${table} FOR EACH ROW EXECUTE FUNCTION t964_fault()`);
  try {let caught:unknown;try {await call();}catch(e){caught=e;}expect(caught).toBeDefined();let current:unknown=caught,marker=false;for(let depth=0;depth<6&&current instanceof Error;depth++){if(redactErrorChain(current,secretUrls(env)).includes("T964_SYNTHETIC_FAULT"))marker=true;current=(current as Error&{cause?:unknown}).cause;}expect(marker).toBe(true);}finally{await q(`DROP TRIGGER t964_fault ON public.${table}`);await q("DROP FUNCTION t964_fault()");}
}

const pure={recipeId:id(),recipeVersion:1,outputQuantity:"10",targetLocationId:id(),inputs:[{packageId:id(),predecessorVersion:0,currentBalanceVersion:"9223372036854775807",baseQuantity:"50"}],outputs:{kind:"KOLI",packages:{mode:"equal",count:2,quantity:"5"}}};
describe("T964 strict pure production payload before DB",()=>{
  it("canonical expansion preserves bigint versions and exact package/allocation totals",()=>{expect(parseProducePackageInput(pure)).toMatchObject({outputQuantity:"10.000000",inputs:[{currentBalanceVersion:"9223372036854775807",baseQuantity:"50.000000"}],outputs:{packages:[{quantity:"5"},{quantity:"5"}]}});});
  for(const key of ["tenantId","sourceWarehouseId","outputItemId","factor","stockStatus","batchId","documentId","clientKey"])it(`rejects injected ${key}`,()=>{expect(()=>parseProducePackageInput({...pure,[key]:id()})).toThrow();});
  it("rejects duplicate HU allocation, client output identity, malformed versions and quantity mismatch",()=>{
    expect(()=>parseProducePackageInput({...pure,inputs:[pure.inputs[0],pure.inputs[0]]})).toThrow();expect(()=>parseProducePackageInput({...pure,inputs:[{...pure.inputs[0],currentBalanceVersion:"9223372036854775808"}]})).toThrow();expect(()=>parseProducePackageInput({...pure,outputs:{...pure.outputs,id:id()}})).toThrow();expect(()=>parseProducePackageInput({...pure,outputQuantity:"11"})).toThrow();expect(()=>parseProducePackageInput({...pure,inputs:[{...pure.inputs[0],itemId:id()}]})).toThrow();
  });
});
