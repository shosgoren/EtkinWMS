import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { seedPackage, cleanupPackages, db } from "./support/package-receiving.ts";
import { scrubSecretInputs } from "./support/empty-tenant.ts";

test.use({ trace: "off" });
test.afterEach(async ({ page }) => { try { await scrubSecretInputs(page); } finally { await cleanupPackages(); } });

test("T-1064: ürün süzgeci, QR baskı ve üç cihaz genişliği", async ({ page }, info) => {
  test.setTimeout(120_000);
  const requireWeb = createRequire(new URL("../../apps/web/package.json", import.meta.url));
  const reader = requireWeb("zxing-wasm/reader") as { prepareZXingModule: (options: unknown) => unknown; readBarcodes: (image: Uint8Array, options: unknown) => Promise<{ text: string }[]> };
  reader.prepareZXingModule({ overrides: { wasmBinary: readFileSync(requireWeb.resolve("zxing-wasm/reader/zxing_reader.wasm")) } });
  const f = await seedPackage(page, info.project.name.includes("mobile"));
  await db("INSERT INTO public.item_barcodes(tenant_id,item_id,barcode) VALUES($1,$2,$3)", [f.tenantId, f.itemId, `EWMS-ITEM-${f.itemId}`]);
  for (const width of [390, 1180, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/t/${f.slug}/items?q=${f.itemId}`);
    await page.locator('[data-chip="filters"]').click();
    await expect(page.getByTestId("item-filters")).toBeVisible();
    await page.locator('[data-chip="tracking"]').click();
    await page.getByRole("radio", { name: "Takip yok", exact: true }).click();
    await page.screenshot({ path: info.outputPath(`filters-${width}.png`) });
    await page.getByRole("button", { name: "UYGULA", exact: true }).click();
    await expect(page).toHaveURL(/tracking=NONE/);
    await page.locator('[data-chip="qr-labels"]').click();
    await expect(page.getByTestId("label-sheet").locator("svg").first()).toBeVisible();
    await expect(page).toHaveURL(/tracking=NONE/);
    await expect(page.getByTestId("labels-print")).toBeVisible();
    await page.screenshot({ path: info.outputPath(`qr-${width}.png`) });
    const qr = page.getByTestId("product-label-qr").first();
    const decoded = await reader.readBarcodes(new Uint8Array(await qr.screenshot()), { formats: ["QRCode"] });
    expect(decoded.map((r) => r.text)).toEqual([`EWMS-ITEM-${f.itemId}`]);
    await page.emulateMedia({ media: "print" });
    expect(await page.evaluate("getComputedStyle(document.querySelector('.label-sheet')).display")).toBe("flex");
    expect(await page.evaluate("getComputedStyle(document.querySelector('.label-sheet')).overflowY")).toBe("visible");
    await page.emulateMedia({ media: "screen" });
    const overflow = await page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth");
    expect(overflow).toBe(false);
  }
});
