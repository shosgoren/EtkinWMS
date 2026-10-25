import { expect, test, type Page } from "@playwright/test";
import { localClient, scrubSecretInputs } from "./support/empty-tenant.ts";

import { randomUUID } from "node:crypto";
import { assertStock, cleanupPackages, db, documentId, fillPackage, identities, posted, seedPackage, type PackageFixture } from "./support/package-receiving.ts";
import { expectOdakHalkasi } from "./support/odak.ts";

export interface PackageMovementFixture {
  tenantId: string; slug: string; itemId: string; warehouseId: string;
  receivingLocationId: string; storageId: string; storageCode: string;
  packageId: string; qr: string; allPackageIds: string[]; documentId: string;
  lotCode: string; producedOn: string; expiresOn: string; originalPackage: PackageFixture;
}
const fixtures: PackageMovementFixture[] = [];

export async function seedPackageMovement(page: Page, mobile = false): Promise<PackageMovementFixture> {
  const originalPackage = await seedPackage(page, mobile, true, "movement");
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

export async function cleanupPackageMovement(): Promise<void> {
  for (const f of fixtures.splice(0)) await db("UPDATE public.locations SET status='ARCHIVED',archived_at=now() WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.storageId]);
  await cleanupPackages();
}

export interface PackageMovementExpected { qc: 0 | 1; putaway: 0 | 1; locationId: string; status: "QUARANTINE" | "AVAILABLE"; quantity: "200.000000" }
export async function assertPackageMovement(f: PackageMovementFixture, expected: PackageMovementExpected): Promise<void> {
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

test.use({ ...localClient("198.51.100.147"), trace: "off" });
test.afterEach(async ({ page }) => {
  try { await scrubSecretInputs(page); } finally { await cleanupPackageMovement(); }
});

async function manualScan(page: Page, code: string) {
  await page.getByRole("button", { name: "Elle gir", exact: true }).click();
  await page.getByRole("textbox", { name: "Barkod", exact: true }).fill(code);
  await page.getByRole("button", { name: "Onayla", exact: true }).click();
}

test("same physical QR: lost QC reply replays once; putaway read failure preserves posted operation", async ({ page }, info) => {
  const f = await seedPackageMovement(page, info.project.name.includes("mobile"));
  await page.goto(`/t/${f.slug}/field/packages`);
  await expect(page.getByRole("button", { name: "Paket okut", exact: true })).toBeEnabled();
  await manualScan(page, f.qr);
  await expect(page.getByTestId("package-current-quantity")).toHaveText("200 KG");
  const bodies: string[] = [];
  let lost = false;
  await page.route("**/field/packages**", async route => {
    const req = route.request(), body = req.postData() ?? "";
    if (req.method() === "POST" && body.includes('"clientKey"') && !body.includes('"targetLocationId"')) {
      bodies.push(body);
      if (!lost) { lost = true; await route.fetch(); await route.abort("failed"); return; }
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Kaliteyi onayla", exact: true }).dblclick();
  await expect(page.getByRole("button", { name: "Aynı işlemi dene", exact: true })).toBeEnabled();
  expect(lost).toBe(true);
  await assertPackageMovement(f, { qc: 1, putaway: 0, locationId: f.receivingLocationId, status: "AVAILABLE", quantity: "200.000000" });
  await page.getByRole("button", { name: "Aynı işlemi dene", exact: true }).click();
  await expect(page.getByRole("button", { name: "Yer seç", exact: true })).toBeEnabled();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  await page.unroute("**/field/packages**");
  await page.getByRole("button", { name: "Yer seç", exact: true }).click();
  await expect(page.getByRole("button", { name: "Yer okut", exact: true })).toBeEnabled();
  await manualScan(page, f.storageCode);
  await expect(page.getByTestId("package-destination")).toContainText(f.storageCode);
  let write = false, readLost = false;
  await page.route("**/field/packages**", async route => {
    const req = route.request(), body = req.postData() ?? "";
    if (req.method() === "POST" && body.includes('"targetLocationId"')) write = true;
    else if (write && !readLost && req.method() === "POST" && body.includes('"packageId"') && !body.includes('"clientKey"') && !body.includes('"code"')) {
      readLost = true; await route.abort("failed"); return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Buraya yerleştir", exact: true }).click();
  await expect(page.getByTestId("package-saved")).toHaveText("Kaydedildi");
  await expect(page.getByRole("button", { name: "Güncel durumu al", exact: true })).toBeEnabled();
  expect(readLost).toBe(true);
  await assertPackageMovement(f, { qc: 1, putaway: 1, locationId: f.storageId, status: "AVAILABLE", quantity: "200.000000" });
  await page.getByRole("button", { name: "Güncel durumu al", exact: true }).click();
  await expect(page.getByTestId("package-current-location")).toHaveText(f.storageCode);
  await page.getByText("Tekil QR", { exact: true }).click();
  await expect(page.getByTestId("package-qr")).toHaveText(f.qr);
  await page.reload();
  await expect(page.getByTestId("package-current-location")).toHaveCount(1);
  await expect(page.getByTestId("package-current-location")).toHaveText(f.storageCode);
  await assertPackageMovement(f, { qc: 1, putaway: 1, locationId: f.storageId, status: "AVAILABLE", quantity: "200.000000" });
});

test("wrong product barcode cannot select a package; touch targets and home/back remain usable across devices", async ({ page }, info) => {
  const f = await seedPackageMovement(page, info.project.name.includes("mobile"));
  await page.goto(`/t/${f.slug}/field/packages`);
  await expect(page.getByRole("button", { name: "Paket okut", exact: true })).toBeEnabled();
  await manualScan(page, f.itemId);
  await expect(page.getByTestId("error-reason")).toBeVisible();
  await expect(page.getByTestId("package-current")).toHaveCount(0);
  await manualScan(page, f.qr);
  await expect(page.getByTestId("package-current")).toContainText("Kalite bekliyor");
  for (const size of [{ width: 1280, height: 800 }, { width: 1024, height: 740 }, { width: 390, height: 740 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    const primary = page.getByRole("button", { name: "Kaliteyi onayla", exact: true });
    await expect(primary).toBeInViewport();
    expect(await primary.evaluate(e => e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(56);
    for (const id of ["screen-home", "screen-back"]) {
      const link = page.getByTestId(id).filter({ visible: true });
      await expect(link).toBeVisible(); await expect(link).toBeInViewport();
      expect(await link.evaluate(e => e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(56);
    }
    expect(await page.evaluate(() => {
      const d = (globalThis as unknown as { document: { documentElement: { scrollWidth: number; clientWidth: number } } }).document;
      return d.documentElement.scrollWidth - d.documentElement.clientWidth;
    })).toBeLessThanOrEqual(0);
  }
  await expect(page.getByTestId("screen-home").filter({ visible: true })).toHaveAttribute("href", `/t/${f.slug}`);
  await page.getByRole("button", { name: "Başka paket", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/t/${f.slug}/field/packages$`));
  await manualScan(page, f.qr);
  await expect(page.getByTestId("package-current")).toBeVisible();
  await assertPackageMovement(f, { qc: 0, putaway: 0, locationId: f.receivingLocationId, status: "QUARANTINE", quantity: "200.000000" });
  await page.getByRole("button", { name: "Kaliteyi onayla", exact: true }).click();
  await page.getByRole("button", { name: "Yer seç", exact: true }).click();
  await expect(page.getByRole("button", { name: "Yer okut", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Elle gir", exact: true }).click();
  for (const size of [{ width: 1280, height: 800 }, { width: 1024, height: 740 }, { width: 390, height: 740 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    const input = page.getByRole("textbox", { name: "Barkod", exact: true });
    await input.scrollIntoViewIfNeeded(); await input.focus();
    await expect(input).toBeFocused(); await expect(input).toBeInViewport();
    expect(await input.evaluate(e => e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);
    await expectOdakHalkasi(input, "odak");
  }
  await page.getByRole("button", { name: "Vazgeç", exact: true }).click();
  await assertPackageMovement(f, { qc: 1, putaway: 0, locationId: f.receivingLocationId, status: "AVAILABLE", quantity: "200.000000" });
});
