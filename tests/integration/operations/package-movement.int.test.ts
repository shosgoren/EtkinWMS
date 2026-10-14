import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateUp } from "../../../packages/db/src/migrate.ts";
import { createDbClient, type DbClient } from "../../../packages/db/src/index.ts";
import { approvePackageQuality, putawayPackage, preparePackageReceipt, postPackageReceipt, getPackageReceipt } from "../../../packages/domain/src/operations/index.ts";
import { parsePackageMovementInput } from "../../../packages/domain/src/operations/package-movement.ts";
import type { StockDocCallParams } from "../../../packages/domain/src/stock/index.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv, redactErrorChain, secretUrls } from "../harness/env.ts";
const env = readIntEnv(process.env), name = `wms_pkg_movement_${randomBytes(6).toString("hex")}`;
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
    A = await seedWorld(adm, newRegistry(), "PKGMOVE"); B = await seedWorld(adm, newRegistry(), "PKGMOVEOTHER");
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
describe("T-942 whole physical-package movement, real runtime roles", () => {
  it("5 KG barrels: one QR QC then putaway, other800 untouched, lot/dates/origin stable", async () => {
    const d = await receipt(), p = d.packages[0]!;
    const first = await approvePackageQuality(params(), await input(p.id)); expect(first.status).toBe("POSTED"); expect(first.documentNumber).toMatch(/^TSM-/);
    expect(await state(p.id)).toMatchObject({ sequence: 1, location_id: receiving, stock_status: "AVAILABLE", quantity: "200.000000" });
    const second = await putawayPackage(params(), { ...await input(p.id), targetLocationId: storage }); expect(second.status).toBe("POSTED");
    expect(await state(p.id)).toMatchObject({ sequence: 2, location_id: storage, stock_status: "AVAILABLE", quantity: "200.000000" });
    expect(await totals(p.id)).toEqual({ entries: 5, net: "200.000000" });
    for (const other of d.packages.slice(1)) { expect(await totals(other.id)).toEqual({ entries: 1, net: "200.000000" }); expect(await state(other.id)).toMatchObject({ sequence: 0, stock_status: "QUARANTINE" }); }
    const current = await getPackageReceipt(params(), { documentId: d.documentId }); expect(current.packages).toEqual(d.packages);
    const steps = await q("SELECT sequence_no,previous_document_line_id,document_line_id FROM package_movement_steps WHERE handling_unit_id=$1 ORDER BY sequence_no", [p.id]);
    expect(steps[0]?.previous_document_line_id).toBe(p.documentLineId); expect(steps[1]?.previous_document_line_id).toBe(steps[0]?.document_line_id);
  });
  it("same key concurrent QC and later replay do not duplicate docs, steps or audit", async () => {
    const p = (await receipt(1)).packages[0]!, value = await input(p.id), call = params();
    const [a, b] = await Promise.all([approvePackageQuality(call, value), approvePackageQuality(call, value)]);
    expect(a.documentId).toBe(b.documentId); expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(await approvePackageQuality(call, value)).toMatchObject({ documentId: a.documentId, replayed: true });
    expect((await q("SELECT count(*)::int AS n FROM package_movement_steps WHERE handling_unit_id=$1", [p.id]))[0]?.n).toBe(1);
    expect((await q("SELECT count(*)::int AS n FROM audit_logs WHERE entity_id=$1 AND action='stock_document.posted'", [a.documentId]))[0]?.n).toBe(1);
    await expect(approvePackageQuality(call, { ...value, currentBalanceVersion: "99" })).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
  });
  it("two different keys racing QC have exactly one winner", async () => {
    const p = (await receipt(1)).packages[0]!, value = await input(p.id);
    const result = await Promise.allSettled([approvePackageQuality(params(), value), approvePackageQuality(params(), value)]);
    expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1); expect(result.filter(r => r.status === "rejected")).toHaveLength(1);
    expect(await totals(p.id)).toEqual({ entries: 3, net: "200.000000" }); expect((await state(p.id)).sequence).toBe(1);
  });
  it("two-target putaway race keeps one chain and one positive dimension", async () => {
    const p = (await receipt(1)).packages[0]!; await approvePackageQuality(params(), await input(p.id)); const value = await input(p.id);
    const result = await Promise.allSettled([putawayPackage(params(), { ...value, targetLocationId: storage }), putawayPackage(params(), { ...value, targetLocationId: storageTwo })]);
    expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1); expect(result.filter(r => r.status === "rejected")).toHaveLength(1);
    expect((await state(p.id)).sequence).toBe(2); expect(await totals(p.id)).toEqual({ entries: 5, net: "200.000000" });
  });
  it("QC versus premature putaway cannot bypass quarantine", async () => {
    const p = (await receipt(1)).packages[0]!, value = await input(p.id);
    const [qc, put] = await Promise.allSettled([approvePackageQuality(params(), value), putawayPackage(params(), { ...value, targetLocationId: storage })]);
    expect(qc.status).toBe("fulfilled"); expect(put.status).toBe("rejected"); expect(await state(p.id)).toMatchObject({ sequence: 1, location_id: receiving });
  });
  it("stale version, draft, foreign, missing MFA and missing role fail safely", async () => {
    const p = (await receipt(1)).packages[0]!, value = await input(p.id);
    await expect(approvePackageQuality(params(), { ...value, currentBalanceVersion: "0" })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(approvePackageQuality(params(), { ...value, predecessorVersion: 1 })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(approvePackageQuality(params(id(), { tenantSlug: B.slug, principal: { userId: B.ownerUserId, mfaVerified: true } }), value)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(approvePackageQuality(params(id(), { principal: { userId: A.ownerUserId, mfaVerified: false } }), value)).rejects.toMatchObject({ code: "FORBIDDEN", detail: "MFA_REQUIRED" });
    await expect(approvePackageQuality(params(id(), { principal: { userId: A.memberUserId, mfaVerified: true } }), value)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await totals(p.id)).toEqual({ entries: 1, net: "200.000000" });
  });
  it("invalid destination and count lock retain origin and create no step", async () => {
    const p = (await receipt(1)).packages[0]!; await approvePackageQuality(params(), await input(p.id)); const value = await input(p.id);
    for (const targetLocationId of [receiving, B.rootLocationId]) await expect(putawayPackage(params(), { ...value, targetLocationId })).rejects.toBeDefined();
    const session = id(); await q("INSERT INTO count_sessions(tenant_id,id,warehouse_id,started_by) VALUES($1,$2,$3,$4)", [A.tenantId, session, A.warehouseId, A.ownerMembershipId]);
    await q("UPDATE location_count_locks SET status='COUNTING',count_session_id=$3,locked_at=now(),locked_by=$4 WHERE tenant_id=$1 AND location_id=$2", [A.tenantId, storage, session, A.ownerMembershipId]);
    try { await expect(putawayPackage(params(), { ...value, targetLocationId: storage })).rejects.toMatchObject({ code: "LOCATION_LOCKED" }); }
    finally { await q("UPDATE location_count_locks SET status='IDLE',count_session_id=NULL,locked_at=NULL,locked_by=NULL WHERE tenant_id=$1 AND location_id=$2", [A.tenantId, storage]); }
    expect((await state(p.id)).sequence).toBe(1); expect(await totals(p.id)).toEqual({ entries: 3, net: "200.000000" });
  });
  it("late ledger fault rolls back already registered step/document/stock changes", async () => {
    const p = (await receipt(1)).packages[0]!, value = await input(p.id), key = id();
    await q(`CREATE FUNCTION public.t942_fail_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM stock_dimensions WHERE id=NEW.stock_dimension_id AND handling_unit_id='${p.id}'::uuid) THEN RAISE EXCEPTION 't942 injected ledger fault' USING ERRCODE='23514'; END IF; RETURN NEW; END $$`);
    await q("CREATE TRIGGER t942_fail_ledger BEFORE INSERT ON stock_ledger FOR EACH ROW EXECUTE FUNCTION t942_fail_ledger()");
    try { await expect(approvePackageQuality(params(key), value)).rejects.toBeDefined(); }
    finally { await q("DROP TRIGGER t942_fail_ledger ON stock_ledger"); await q("DROP FUNCTION t942_fail_ledger()"); }
    expect(await totals(p.id)).toEqual({ entries: 1, net: "200.000000" }); expect((await state(p.id)).sequence).toBe(0);
    expect((await q("SELECT count(*)::int AS n FROM idempotency_records WHERE client_key=$1 AND status='COMPLETED'", [key]))[0]?.n).toBe(0);
    expect((await q("SELECT count(*)::int AS n FROM package_movement_steps WHERE handling_unit_id=$1", [p.id]))[0]?.n).toBe(0);
  });
  it("step and later balance faults atomically roll back documents, ledger and audit", async () => {
    for (const table of ["package_movement_steps", "stock_balances"] as const) {
      const p = (await receipt(1)).packages[0]!, value = await input(p.id);
      const before = (await q("SELECT (SELECT count(*) FROM documents WHERE tenant_id=$1)::int AS docs,(SELECT count(*) FROM audit_logs WHERE tenant_id=$1)::int AS audits", [A.tenantId]))[0];
      const condition = table === "package_movement_steps" ? `NEW.handling_unit_id='${p.id}'::uuid` : `EXISTS(SELECT 1 FROM stock_dimensions WHERE id=NEW.stock_dimension_id AND handling_unit_id='${p.id}'::uuid)`;
      await q(`CREATE FUNCTION t942_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 't942 injected ${table} fault' USING ERRCODE='23514'; END IF; RETURN NEW; END $$`);
      await q(`CREATE TRIGGER t942_fault BEFORE ${table === "package_movement_steps" ? "INSERT" : "UPDATE"} ON ${table} FOR EACH ROW EXECUTE FUNCTION t942_fault()`);
      try { await expect(approvePackageQuality(params(), value)).rejects.toBeDefined(); }
      finally { await q(`DROP TRIGGER t942_fault ON ${table}`); await q("DROP FUNCTION t942_fault()"); }
      expect(await totals(p.id)).toEqual({ entries: 1, net: "200.000000" }); expect((await state(p.id)).sequence).toBe(0);
      expect((await q("SELECT (SELECT count(*) FROM documents WHERE tenant_id=$1)::int AS docs,(SELECT count(*) FROM audit_logs WHERE tenant_id=$1)::int AS audits", [A.tenantId]))[0]).toEqual(before);
    }
  });
  it("putaway same-key lost-reply replay preserves one effect pair and unchanged conversion snapshot", async () => {
    const conversion = id(); await q("INSERT INTO unit_conversions(tenant_id,item_id,unit_id,to_base_factor) VALUES($1,$2,$3,0.001)", [A.tenantId, item, A.boxUnitId]);
    // The physical container input unit can differ from the KG stock unit; the sealed snapshot is retained.
    const d = await receipt(1, { unitId: A.boxUnitId, packages: { mode: "equal", count: 1, quantity: "200000", lotCode: "LOT-TRACE" } }), p = d.packages[0]!;
    await approvePackageQuality(params(), await input(p.id)); const value = { ...await input(p.id), targetLocationId: storage }, call = params(conversion);
    const a = await putawayPackage(call, value), b = await putawayPackage(call, value);
    expect(a.replayed).toBe(false); expect(b).toMatchObject({ documentId: a.documentId, replayed: true });
    expect(await totals(p.id)).toEqual({ entries: 5, net: "200.000000" });
    expect((await q("SELECT unit_id,quantity::text,conversion_factor::text,base_quantity::text FROM document_lines WHERE document_id=$1", [a.documentId]))[0]).toEqual({ unit_id: A.boxUnitId, quantity: "200000.000000", conversion_factor: "0.001000", base_quantity: "200.000000" });
  });
});

// T-942: exact parser assertions consolidated without reducing coverage.
{
const valid = { packageId: randomUUID(), predecessorVersion: 0, currentBalanceVersion: "2" };
const params = {} as StockDocCallParams;
describe("T-942 strict physical-package commands", () => {
  it("preserves bigint balance versions and canonical package identity", () => {
    expect(parsePackageMovementInput({ ...valid, packageId: valid.packageId.toUpperCase(), currentBalanceVersion: "9223372036854775807" }, "QC_RELEASE")).toEqual({ ...valid, currentBalanceVersion: "9223372036854775807", targetLocationId: null });
  });
  for (const key of ["tenantId", "quantity", "baseQuantity", "factor", "lotId", "sourceLocationId", "stockStatus", "warehouseId", "handlingUnitId", "targetLocationId"])
    it(`QC rejects server-authority injection: ${key}`, async () => {
      await expect(approvePackageQuality(params, { ...valid, [key]: randomUUID() } as never)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    });
  it("putaway requires a destination and rejects quantity injection before DB", async () => {
    await expect(putawayPackage(params, valid as never)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(putawayPackage(params, { ...valid, targetLocationId: randomUUID(), quantity: "1" } as never)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
  it("rejects malformed, lossy or overflowing versions", () => {
    for (const v of ["01", "-1", "1.0", "1e2", "9223372036854775808", 2, null]) expect(() => parsePackageMovementInput({ ...valid, currentBalanceVersion: v }, "QC_RELEASE")).toThrow();
    for (const v of [-1, 1.5, "1", 2147483647, NaN]) expect(() => parsePackageMovementInput({ ...valid, predecessorVersion: v }, "QC_RELEASE")).toThrow();
  });
});
}
