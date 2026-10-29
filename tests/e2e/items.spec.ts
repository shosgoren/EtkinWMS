import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
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
  await db("UPDATE public.items SET source_product_info=$3::jsonb WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.itemId, JSON.stringify({ PARASUT: { categoryName: "Granül test", gtip: "400510000000", unit: "KG" } })]);
  for (const width of [390, 1180, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/t/${f.slug}/items?q=${f.itemId}`);
    await page.locator('[data-chip="filters"]').click();
    await expect(page.getByTestId("item-filters")).toBeVisible();
    await page.getByRole("textbox", { name: "Kategori adı", exact: true }).fill("Granül test");
    await page.locator('[data-tab="tracking"]').click();
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
    await page.goto(`/t/${f.slug}/items/${f.itemId}?sekme=erp`);
    await expect(page.getByText("Granül test", { exact: true })).toBeVisible();
    await expect(page.getByText("400510000000", { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`source-${width}.png`) });
  }
});

// T-1129 (B-188): hiç kullanılmamış üründe düzenleme formunda temel birim / hassasiyet / takip modu seçilir ve kaydedilir; kullanılmış
// (birim dönüşümü olan) üründe "Değişmeyen bilgiler" kilitli kutusu nedeniyle görünür, seçim alanı yoktur.
async function pickFixed(page: Page, label: string, id: string): Promise<void> {
  const radio = page.getByRole("radiogroup", { name: label, exact: true }).locator(`[data-option="${id}"]`);
  const trigger = page.getByRole("button", { name: new RegExp(`^${label}: `) });
  await expect(radio.or(trigger)).toBeVisible();
  if (await radio.isVisible()) {
    await radio.click();
    await expect(radio).toHaveAttribute("aria-checked", "true");
    return;
  }
  await trigger.click();
  await page.getByRole("listbox", { name: label, exact: true }).locator(`[data-option="${id}"]`).click();
  await expect(trigger).toHaveAttribute("data-value", id);
}

test("T-1129: kullanılmamış üründe temel birim, hassasiyet ve takip modu değişir; kullanılmışta kilitli", async ({ page }, info) => {
  test.setTimeout(120_000);
  const f = await seedPackage(page, info.project.name.includes("mobile"));
  const fresh = randomUUID();
  await db("INSERT INTO public.items(tenant_id,id,code,name,base_unit_id,tracking_mode,quantity_scale) VALUES($1,$2,$3,'Sabit alan T1129',$4,'NONE',0)", [f.tenantId, fresh, `T1129-${fresh.slice(0, 8)}`, f.kg]);
  try {
    await page.goto(`/t/${f.slug}/items/${fresh}?edit=1`);
    await expect(page.getByTestId("item-edit-form")).toBeVisible();
    const box = page.getByTestId("item-fixed-edit");
    await expect(box).toBeVisible();
    await expect(box.getByText("Stok bu birimle sayılır; ilk işlemden sonra değiştirilemez.", { exact: true })).toBeVisible();
    await pickFixed(page, "Temel birim", f.gr);
    await pickFixed(page, "Miktar hassasiyeti", "2");
    await pickFixed(page, "Takip modu", "LOT");
    await page.screenshot({ path: info.outputPath("fixed-edit.png") });
    await page.getByTestId("item-edit-form-save").click();
    await expect(page.getByTestId("item-edit-form")).toBeHidden();
    await expect.poll(async () => (await db<{ unit: string; scale: number; mode: string }>("SELECT base_unit_id AS unit, quantity_scale AS scale, tracking_mode AS mode FROM public.items WHERE id=$1", [fresh]))[0]).toEqual({ unit: f.gr, scale: 2, mode: "LOT" });
    // Hâlâ kullanılmadı: form yeniden açılınca alanlar seçilebilir.
    await page.goto(`/t/${f.slug}/items/${fresh}?edit=1`);
    await expect(page.getByTestId("item-fixed-edit")).toBeVisible();
    // Kullanılmış ürün (seedPackage birim dönüşümü ekler): kilitli kutu + neden; seçim alanı yok.
    await page.goto(`/t/${f.slug}/items/${f.itemId}?edit=1`);
    const locked = page.getByTestId("item-fixed-locked");
    await expect(locked).toBeVisible();
    await expect(locked.getByTestId("kalip-locked").getByText(/Bu ürünle işlem yapıldı \(birim dönüşümü ya da birimli barkod var\)/)).toBeVisible();
    await expect(page.getByTestId("item-fixed-edit")).toHaveCount(0);
    expect(await page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")).toBe(false);
    await page.screenshot({ path: info.outputPath("fixed-locked.png") });
  } finally {
    await db("UPDATE public.items SET status='ARCHIVED',archived_at=now() WHERE tenant_id=$1 AND id=$2", [f.tenantId, fresh]);
  }
});
