import { expect, test, type Page } from "@playwright/test";
import { localClient, scrubSecretInputs } from "./support/empty-tenant.ts";
import { assertPackageMovement, cleanupPackageMovement, seedPackageMovement } from "./support/package-movement.ts";

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
    expect(await input.evaluate(e => parseFloat(e.ownerDocument.defaultView!.getComputedStyle(e).outlineWidth))).toBeGreaterThanOrEqual(3);
  }
  await page.getByRole("button", { name: "Vazgeç", exact: true }).click();
  await assertPackageMovement(f, { qc: 1, putaway: 0, locationId: f.receivingLocationId, status: "AVAILABLE", quantity: "200.000000" });
});
