import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { localClient, scrubSecretInputs } from "./support/empty-tenant.ts";
import { assertStock, cleanupPackages, db, documentId, fillPackage, identities, posted, seedPackage, type PackageFixture } from "./support/package-receiving.ts";
import { expectOdakHalkasi } from "./support/odak.ts";
export interface PackageMovementFixture {
  tenantId: string; slug: string; itemId: string; warehouseId: string;
  receivingLocationId: string; storageId: string; storageCode: string;
  packageId: string; qr: string; allPackageIds: string[]; documentId: string;
  lotCode: string; producedOn: string; expiresOn: string; originalPackage: PackageFixture;
}
const { seedPackageMovement, cleanupPackageMovement } = (() => {
const fixtures: PackageMovementFixture[] = [];

async function seedPackageMovement(page: Page, mobile = false): Promise<PackageMovementFixture> {
  const originalPackage = await seedPackage(page, mobile, true, "transfer");
  const storageId = randomUUID(), storageCode = `PM-${storageId.slice(0, 8)}`.toUpperCase();
  await db("INSERT INTO public.locations(tenant_id,id,warehouse_id,code,name,depth,kind) VALUES($1,$2,$3,$4,'Movement storage',0,'STORAGE')", [originalPackage.tenantId, storageId, originalPackage.warehouseId, storageCode]);
  const dates = { lotCode: `LOT-${randomUUID().slice(0, 8)}`, producedOn: "2026-10-01", expiresOn: "2027-10-01" };
  await fillPackage(page, originalPackage, originalPackage.kg, "5", "200");
  await page.getByRole("textbox", { name: "Her paket Lot kodu", exact: true }).fill(dates.lotCode);
  await page.getByLabel("Her paket Üretim tarihi", { exact: true }).fill(dates.producedOn);
  await page.getByLabel("Her paket Son kullanma tarihi", { exact: true }).fill(dates.expiresOn);
  await expect(page.getByTestId("package-total")).toHaveText("5 paket / 1.000 KG");
  await page.getByRole("button", { name: "Kontrol", exact: true }).click();
  await page.getByRole("button", { name: "Kabul et", exact: true }).click();
  await posted(page);
  const document = await documentId(page), allPackageIds = await identities(originalPackage, document);
  expect(allPackageIds).toHaveLength(5); expect(new Set(allPackageIds).size).toBe(5);
  await assertStock(originalPackage, document, 5, "1000.000000");
  const packageId = allPackageIds[0]; if (!packageId) throw new Error("e2e: posted package missing");
  const f: PackageMovementFixture = { tenantId: originalPackage.tenantId, slug: originalPackage.slug, itemId: originalPackage.itemId, warehouseId: originalPackage.warehouseId, receivingLocationId: originalPackage.locationId, storageId, storageCode, packageId, qr: `EWMS:PKG:1:${packageId}`, allPackageIds, documentId: document, ...dates, originalPackage };
  fixtures.push(f);
  await assertPackageMovement(f, { qc: 0, putaway: 0, locationId: f.receivingLocationId, status: "QUARANTINE", quantity: "200.000000" });
  return f;
}

async function cleanupPackageMovement(): Promise<void> {
  for (const f of fixtures.splice(0)) await db("UPDATE public.locations SET status='ARCHIVED',archived_at=now() WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.storageId]);
  await cleanupPackages();
}

interface PackageMovementExpected { qc: 0 | 1; putaway: 0 | 1; locationId: string; status: "QUARANTINE" | "AVAILABLE"; quantity: "200.000000" }
async function assertPackageMovement(f: PackageMovementFixture, expected: PackageMovementExpected): Promise<void> {
  await assertStock(f.originalPackage, f.documentId, 5, "1000.000000");
  expect(await identities(f.originalPackage, f.documentId)).toEqual(f.allPackageIds);
  const origins = await db<{ id: string; lot_code: string; produced_on: string; expires_on: string; kind: string; quantity: string }>("SELECT rp.id,rp.lot_code,rp.produced_on::text,rp.expires_on::text,h.kind,l.base_quantity::text AS quantity FROM public.receipt_packages rp JOIN public.handling_units h ON h.tenant_id=rp.tenant_id AND h.id=rp.id JOIN public.document_lines l ON l.tenant_id=rp.tenant_id AND l.id=rp.document_line_id WHERE rp.tenant_id=$1 AND rp.document_id=$2 ORDER BY rp.package_no", [f.tenantId, f.documentId]);
  expect(origins).toEqual(f.allPackageIds.map(id => ({ id, lot_code: f.lotCode, produced_on: f.producedOn, expires_on: f.expiresOn, kind: "VARIL", quantity: "200.000000" })));
  const current = await db<{ location_id: string; stock_status: string; quantity: string }>("SELECT sd.location_id,sd.stock_status,b.quantity::text FROM public.stock_dimensions sd JOIN public.stock_balances b ON b.tenant_id=sd.tenant_id AND b.stock_dimension_id=sd.id WHERE sd.tenant_id=$1 AND sd.handling_unit_id=$2 AND b.quantity>0", [f.tenantId, f.packageId]);
  expect(current).toEqual([{ location_id: expected.locationId, stock_status: expected.status, quantity: expected.quantity }]);
  const others = await db<{ handling_unit_id: string; location_id: string; stock_status: string; quantity: string }>("SELECT sd.handling_unit_id,sd.location_id,sd.stock_status,b.quantity::text FROM public.stock_dimensions sd JOIN public.stock_balances b ON b.tenant_id=sd.tenant_id AND b.stock_dimension_id=sd.id JOIN public.receipt_packages rp ON rp.tenant_id=sd.tenant_id AND rp.id=sd.handling_unit_id WHERE rp.tenant_id=$1 AND rp.document_id=$2 AND rp.id<>$3 AND b.quantity>0 ORDER BY rp.package_no", [f.tenantId, f.documentId, f.packageId]);
  expect(others).toEqual(f.allPackageIds.slice(1).map(handling_unit_id => ({ handling_unit_id, location_id: f.receivingLocationId, stock_status: "QUARANTINE", quantity: "200.000000" })));
  const operations = [...(expected.qc ? ["QC_RELEASE"] : []), ...(expected.putaway ? ["PUTAWAY"] : [])];
  const steps = await db<{ operation: string; sequence_no: number; base_quantity: string; handling_unit_id: string; status: string; kind: string; ledger_entries: number; net: string }>("SELECT ms.operation,ms.sequence_no,ms.base_quantity::text,ms.handling_unit_id,d.status,d.kind,(SELECT count(*)::int FROM public.stock_ledger sl WHERE sl.tenant_id=ms.tenant_id AND sl.document_id=ms.document_id AND sl.document_line_id=ms.document_line_id) AS ledger_entries,(SELECT sum(sl.quantity)::text FROM public.stock_ledger sl WHERE sl.tenant_id=ms.tenant_id AND sl.document_id=ms.document_id AND sl.document_line_id=ms.document_line_id) AS net FROM public.package_movement_steps ms JOIN public.documents d ON d.tenant_id=ms.tenant_id AND d.id=ms.document_id WHERE ms.tenant_id=$1 AND ms.handling_unit_id=$2 ORDER BY ms.sequence_no", [f.tenantId, f.packageId]);
  expect(steps).toEqual(operations.map((operation, i) => ({ operation, sequence_no: i + 1, base_quantity: "200.000000", handling_unit_id: f.packageId, status: "POSTED", kind: "STOCK_MOVE", ledger_entries: 2, net: "0.000000" })));
  expect(await db("SELECT ms.document_line_id FROM public.package_movement_steps ms JOIN public.receipt_packages rp ON rp.tenant_id=ms.tenant_id AND rp.id=ms.handling_unit_id WHERE rp.tenant_id=$1 AND rp.document_id=$2 AND rp.id<>$3", [f.tenantId, f.documentId, f.packageId])).toEqual([]);
}

  return { seedPackageMovement, cleanupPackageMovement };
})();

test.use({ ...localClient("198.51.100.149"), trace: "off" });
type Fixture = PackageMovementFixture & { targetWarehouseId: string; targetWarehouseCode: string; targetWarehouseName: string; targetId: string; targetCode: string; targetShelfId: string; targetShelfCode: string };
const fixtures: Fixture[] = [];
test.afterEach(async ({ page }) => {
  try { await scrubSecretInputs(page); } finally {
    for (const f of fixtures.splice(0)) {
      await db("UPDATE public.locations SET status='ARCHIVED',archived_at=now() WHERE tenant_id=$1 AND id IN ($2,$3)", [f.tenantId, f.targetId, f.targetShelfId]);
      await db("UPDATE public.warehouses SET status='ARCHIVED',archived_at=now() WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.targetWarehouseId]);
    }
    await cleanupPackageMovement();
  }
});
async function scan(page: Page, code: string) {
  await page.getByRole("button", { name: "Elle gir", exact: true }).click();
  await page.getByRole("textbox", { name: "Barkod", exact: true }).fill(code);
  await page.getByRole("button", { name: "Onayla", exact: true }).click();
}
async function seed(page: Page, mobile: boolean): Promise<Fixture> {
  const a = await seedPackageMovement(page, mobile), targetWarehouseId = randomUUID(), targetId = randomUUID(), targetShelfId = randomUUID();
  const f = { ...a, targetWarehouseId, targetId, targetShelfId, targetWarehouseCode: `B-${targetWarehouseId.slice(0, 8)}`.toUpperCase(), targetWarehouseName: `Transfer B ${targetWarehouseId.slice(0, 8)}`, targetCode: `B-IN-${targetId.slice(0, 8)}`.toUpperCase(), targetShelfCode: `B-SHELF-${targetShelfId.slice(0, 8)}`.toUpperCase() };
  fixtures.push(f);
  await db("INSERT INTO public.warehouses(tenant_id,id,code,name) VALUES($1,$2,$3,$4)", [f.tenantId, f.targetWarehouseId, f.targetWarehouseCode, f.targetWarehouseName]);
  for (const [id, code] of [[f.targetId, f.targetCode], [f.targetShelfId, f.targetShelfCode]]) await db("INSERT INTO public.locations(tenant_id,id,warehouse_id,code,name,depth,kind) VALUES($1,$2,$3,$4,'Transfer shelf',0,'STORAGE')", [f.tenantId, id, f.targetWarehouseId, code]);
  await page.goto(`/t/${f.slug}/field/packages`); await scan(page, f.qr);
  await page.getByRole("button", { name: "Kaliteyi onayla", exact: true }).click();
  await page.getByRole("button", { name: "Yer seç", exact: true }).click();
  await expect(page.getByRole("button", { name: "Yer okut", exact: true })).toBeEnabled(); await scan(page, f.storageCode);
  await page.getByRole("button", { name: "Buraya yerleştir", exact: true }).click();
  await expect(page.getByTestId("package-current-location")).toHaveText(f.storageCode);
  return f;
}
async function transferReview(page: Page, code: string, name: string, location: string) {
  await page.getByRole("button", { name: "Depoya taşı", exact: true }).click();
  await page.getByRole("button", { name: `${code} · ${name}`, exact: true }).click();
  await expect(page.getByRole("button", { name: "Yer okut", exact: true })).toBeEnabled(); await scan(page, location);
  await expect(page.getByTestId("package-destination")).toContainText(location);
  await page.getByRole("button", { name: "Kontrol et", exact: true }).click();
  await expect(page.getByTestId("package-transfer-confirm")).toContainText("200 KG");
  await expect(page.getByTestId("package-transfer-confirm")).toContainText(name);
}
async function stock(f: Fixture, location: string, transfers: number, putaways: number) {
  const current = await db("SELECT sd.location_id,sd.stock_status,b.quantity::text FROM public.stock_dimensions sd JOIN public.stock_balances b ON b.tenant_id=sd.tenant_id AND b.stock_dimension_id=sd.id WHERE sd.tenant_id=$1 AND sd.handling_unit_id=$2 AND b.quantity>0", [f.tenantId, f.packageId]);
  expect(current).toEqual([{ location_id: location, stock_status: "AVAILABLE", quantity: "200.000000" }]);
  const origins = await db("SELECT rp.id,rp.document_line_id,rp.lot_code,rp.produced_on::text,rp.expires_on::text,r.warehouse_id,l.base_quantity::text AS quantity FROM public.receipt_packages rp JOIN public.inbound_receipts r ON r.tenant_id=rp.tenant_id AND r.id=rp.receipt_id JOIN public.document_lines l ON l.tenant_id=rp.tenant_id AND l.id=rp.document_line_id WHERE rp.tenant_id=$1 AND rp.document_id=$2 ORDER BY rp.package_no", [f.tenantId, f.documentId]);
  expect(origins.map(r => r.id)).toEqual(f.allPackageIds);
  for (const row of origins) expect(row).toMatchObject({ lot_code: f.lotCode, produced_on: f.producedOn, expires_on: f.expiresOn, warehouse_id: f.warehouseId, quantity: "200.000000" });
  const others = await db("SELECT sd.handling_unit_id,b.quantity::text,sd.stock_status,sd.location_id FROM public.stock_dimensions sd JOIN public.stock_balances b ON b.tenant_id=sd.tenant_id AND b.stock_dimension_id=sd.id JOIN public.receipt_packages rp ON rp.tenant_id=sd.tenant_id AND rp.id=sd.handling_unit_id WHERE rp.tenant_id=$1 AND rp.document_id=$2 AND rp.id<>$3 AND b.quantity>0 ORDER BY rp.package_no", [f.tenantId, f.documentId, f.packageId]);
  expect(others).toEqual(f.allPackageIds.slice(1).map(handling_unit_id => ({ handling_unit_id, quantity: "200.000000", stock_status: "QUARANTINE", location_id: f.receivingLocationId })));
  const steps = await db<{ operation: string; sequence_no: number; document_line_id: string; previous_document_line_id: string }>("SELECT operation,sequence_no,document_line_id,previous_document_line_id FROM public.package_movement_steps WHERE tenant_id=$1 AND handling_unit_id=$2 ORDER BY sequence_no", [f.tenantId, f.packageId]);
  expect(steps).toHaveLength(1 + transfers + putaways);
  expect(steps.filter(s => s.operation === "WAREHOUSE_TRANSFER")).toHaveLength(transfers); expect(steps.filter(s => s.operation === "PUTAWAY")).toHaveLength(putaways);
  for (const [i, step] of steps.entries()) { expect(step.sequence_no).toBe(i + 1); expect(step.previous_document_line_id).toBe(i ? steps[i - 1]!.document_line_id : origins[0]!.document_line_id); }
  const pairs = await db("SELECT od.kind AS out_kind,od.status AS out_status,ind.kind AS in_kind,ind.status AS in_status,od.number AS out_number,ind.number AS in_number,(SELECT count(*)::int FROM public.stock_document_links l WHERE l.tenant_id=ms.tenant_id AND l.source_document_id=od.id AND l.target_document_id=ind.id AND l.kind='TRANSFER') AS links,(SELECT count(*)::int FROM public.stock_ledger sl WHERE sl.tenant_id=ms.tenant_id AND sl.document_id IN(od.id,ind.id)) AS entries,(SELECT sum(sl.quantity)::text FROM public.stock_ledger sl WHERE sl.tenant_id=ms.tenant_id AND sl.document_id IN(od.id,ind.id)) AS net FROM public.package_movement_steps ms JOIN public.documents od ON od.tenant_id=ms.tenant_id AND od.id=ms.source_document_id JOIN public.documents ind ON ind.tenant_id=ms.tenant_id AND ind.id=ms.document_id WHERE ms.tenant_id=$1 AND ms.handling_unit_id=$2 AND ms.operation='WAREHOUSE_TRANSFER' ORDER BY ms.sequence_no", [f.tenantId, f.packageId]);
  expect(pairs).toHaveLength(transfers);
  for (const pair of pairs) { expect(pair).toMatchObject({ out_kind: "STOCK_OUT", out_status: "POSTED", in_kind: "STOCK_IN", in_status: "POSTED", links: 1, entries: 2, net: "0.000000" }); expect(pair.out_number).toBeTruthy(); expect(pair.in_number).toBeTruthy(); }
}

test("same QR A→B→A: transfer lost reply replays once; posted read failure never transfers twice", async ({ page }, info) => {
  const f = await seed(page, info.project.name.includes("mobile"));
  await transferReview(page, f.targetWarehouseCode, f.targetWarehouseName, f.targetCode);
  const bodies: string[] = []; let lost = false;
  await page.route("**/field/packages**", async route => {
    const req = route.request(), body = req.postData() ?? "";
    if (req.method() === "POST" && body.includes('"clientKey"') && body.includes(f.targetId)) {
      bodies.push(body); if (!lost) { lost = true; await route.fetch(); await route.abort("failed"); return; }
    } await route.continue();
  });
  await page.getByRole("button", { name: "Taşımayı onayla", exact: true }).dblclick();
  await expect(page.getByRole("button", { name: "Aynı işlemi dene", exact: true })).toBeEnabled(); expect(lost).toBe(true);
  await stock(f, f.targetId, 1, 1);
  await page.getByRole("button", { name: "Aynı işlemi dene", exact: true }).click();
  await expect(page.getByTestId("package-current-warehouse")).toHaveText(f.targetWarehouseName);
  expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0]); await page.unroute("**/field/packages**");
  // The same package can now be put away inside its actual current B warehouse.
  await page.getByRole("button", { name: "Yer seç", exact: true }).click(); await scan(page, f.targetShelfCode);
  await page.getByRole("button", { name: "Buraya yerleştir", exact: true }).click(); await expect(page.getByTestId("package-current-location")).toHaveText(f.targetShelfCode);
  await transferReview(page, f.warehouseId, "Package QA", f.storageCode);
  let written = false, readLost = false, writes = 0;
  await page.route("**/field/packages**", async route => {
    const req = route.request(), body = req.postData() ?? "";
    if (req.method() === "POST" && body.includes('"clientKey"')) { written = true; writes++; }
    else if (written && !readLost && req.method() === "POST" && body.includes('"packageId"') && !body.includes('"code"')) { readLost = true; await route.abort("failed"); return; }
    await route.continue();
  });
  await page.getByRole("button", { name: "Taşımayı onayla", exact: true }).click();
  await expect(page.getByTestId("package-saved")).toHaveText("Kaydedildi"); await expect(page.getByRole("button", { name: "Güncel durumu al", exact: true })).toBeEnabled(); expect(readLost).toBe(true);
  await stock(f, f.storageId, 2, 2);
  await page.getByRole("button", { name: "Güncel durumu al", exact: true }).click(); await expect(page.getByTestId("package-current-location")).toHaveText(f.storageCode); expect(writes).toBe(1);
  await page.getByText("Tekil QR", { exact: true }).click(); await expect(page.getByTestId("package-qr")).toHaveText(f.qr);
  await page.reload(); await expect(page.getByTestId("package-current-warehouse")).toHaveCount(1); await expect(page.getByTestId("package-current-warehouse")).toHaveText("Package QA"); await stock(f, f.storageId, 2, 2);
});

test("transfer targets, scanning and confirmation remain touch accessible on four device layouts", async ({ page }, info) => {
  const f = await seed(page, info.project.name.includes("mobile"));
  await page.getByRole("button", { name: "Depoya taşı", exact: true }).click(); await page.getByRole("button", { name: `${f.targetWarehouseCode} · ${f.targetWarehouseName}`, exact: true }).click();
  await page.getByRole("button", { name: "Elle gir", exact: true }).click();
  for (const viewport of [{ width: 1280, height: 800 }, { width: 1024, height: 740 }, { width: 390, height: 740 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport); const input = page.getByRole("textbox", { name: "Barkod", exact: true }); await input.scrollIntoViewIfNeeded(); await input.focus(); await expect(input).toBeFocused(); await expect(input).toBeInViewport();
    expect(await input.evaluate(e => e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48); await expectOdakHalkasi(input, "odak");
  }
  await page.getByRole("textbox", { name: "Barkod", exact: true }).fill(f.storageCode); await page.getByRole("button", { name: "Onayla", exact: true }).click(); await expect(page.getByTestId("error-reason")).toBeVisible(); await expect(page.getByTestId("package-destination")).toHaveCount(0);
  await scan(page, f.targetCode); await page.getByRole("button", { name: "Kontrol et", exact: true }).click();
  for (const viewport of [{ width: 1280, height: 800 }, { width: 1024, height: 740 }, { width: 390, height: 740 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport); const primary = page.getByRole("button", { name: "Taşımayı onayla", exact: true }); await expect(primary).toBeInViewport(); expect(await primary.evaluate(e => e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(56);
    for (const id of ["screen-home", "screen-back"]) { const nav = page.getByTestId(id).filter({ visible: true }); await expect(nav).toBeInViewport(); expect(await nav.evaluate(e => e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(56); }
    expect(await page.evaluate(() => { const d = (globalThis as unknown as { document: { documentElement: { scrollWidth: number; clientWidth: number } } }).document; return d.documentElement.scrollWidth - d.documentElement.clientWidth; })).toBeLessThanOrEqual(0);
  }
  await expect(page.getByTestId("package-transfer-confirm")).toContainText(f.targetCode); await stock(f, f.storageId, 0, 1);
  await page.getByRole("button", { name: "Taşımayı onayla", exact: true }).click(); await expect(page.getByTestId("package-current-location")).toHaveText(f.targetCode); await stock(f, f.targetId, 1, 1);
});
