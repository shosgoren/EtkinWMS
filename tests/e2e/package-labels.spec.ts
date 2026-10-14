import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { emptyTenant, localClient, packageActor, scrubSecretInputs } from "./support/empty-tenant.ts";
import { assertStock, cleanupPackages, db, documentId, fillPackage, identities, posted, seedPackage } from "./support/package-receiving.ts";

test.use({ ...localClient("198.51.100.142"), trace: "off" });
test.afterEach(async ({ page }) => {
  try { await scrubSecretInputs(page); } finally { await cleanupPackages(); }
});

test("POSTED labels decode five real QRs, escaped metadata, print and reopen preserve IDs; foreign and permission reject", async ({ page }, info) => {
  const f = await seedPackage(page, info.project.name.includes("mobile"));
  await fillPackage(page, f);
  await page.getByRole("button", { name: "Lot / tarih (isteğe bağlı)", exact: true }).click();
  await page.getByRole("textbox", { name: "Her paket Lot kodu", exact: true }).fill("<svg onload=alert(1)>");
  await page.getByLabel("Her paket Üretim tarihi", { exact: true }).fill("2026-10-01");
  await page.getByLabel("Her paket Son kullanma tarihi", { exact: true }).fill("2027-10-01");
  await page.getByRole("button", { name: "Kontrol", exact: true }).click();
  await page.getByRole("button", { name: "Kabul et", exact: true }).click(); await posted(page);
  const id = await documentId(page), ids = await identities(f, id);
  await page.getByRole("link", { name: "Etiketleri aç", exact: true }).click();
  const articles = page.getByTestId("package-label-sheet").locator("article");
  await expect(articles).toHaveCount(5);
  // Actual rendered QR pixels pass through the existing ZXing decoder. No mocked QR or camera.
  const requireWeb = createRequire(new URL("../../apps/web/package.json", import.meta.url));
  const reader = requireWeb("zxing-wasm/reader") as { prepareZXingModule: (options: unknown) => unknown; readBarcodes: (image: Uint8Array, options: unknown) => Promise<{ text: string }[]> };
  reader.prepareZXingModule({ overrides: { wasmBinary: readFileSync(requireWeb.resolve("zxing-wasm/reader/zxing_reader.wasm")) } });
  const paths: string[] = [];
  for (let i = 0; i < 5; i++) {
    const article = articles.nth(i), qr = article.getByRole("img", { name: `Paket QR ${i + 1}`, exact: true });
    await expect(article).toContainText(ids[i]!);
    await expect(article).toContainText("200.000000 KG");
    await expect(article).toContainText("<svg onload=alert(1)>");
    await expect(article).toContainText("2026-10-01"); await expect(article).toContainText("2027-10-01");
    await expect(article.locator("img,svg[onload],[onerror]")).toHaveCount(0);
    expect((await reader.readBarcodes(await qr.screenshot(), { formats: ["QRCode"] })).map(r => r.text)).toEqual([`EWMS:PKG:1:${ids[i]}`]);
    paths.push(await qr.locator("path").getAttribute("d") ?? "");
  }
  expect(new Set(paths).size).toBe(5);
  await page.evaluate(() => { const w = globalThis as unknown as { __packagePrints: number; print: () => void }; Object.assign(w, { __packagePrints: 0 }); w.print = () => { w.__packagePrints++; }; });
  await page.getByRole("button", { name: "Yazdır / PDF", exact: true }).click();
  expect(await page.evaluate(() => (globalThis as unknown as { __packagePrints: number }).__packagePrints)).toBe(1);
  await page.reload(); await expect(articles).toHaveCount(5);
  for (let i = 0; i < 5; i++) expect(await articles.nth(i).locator("svg path").getAttribute("d")).toBe(paths[i]);
  expect(await identities(f, id)).toEqual(ids); await assertStock(f, id, 5, "1000.000000");
  await page.getByLabel("Genişlik (mm)").fill("0");
  await expect(page.getByRole("button", { name: "Yazdır / PDF", exact: true })).toBeDisabled();
  await expect(page.getByRole("alert").filter({ hasText: "Ölçü geçersiz" })).toContainText("Ölçü geçersiz");
  const foreign = emptyTenant("pilot").slug;
  await page.goto(`/t/${foreign}/receipts/packages/labels?document=${id}`);
  await expect(page.getByTestId("package-label-sheet")).toHaveCount(0);
  // Remove only this synthetic fixture account's stock.view role; restore even on assertion failure.
  const roles = await db<{ membership_id: string; role_key: string }>("SELECT r.membership_id,r.role_key FROM public.membership_roles r JOIN public.tenant_memberships m ON m.tenant_id=r.tenant_id AND m.id=r.membership_id WHERE r.tenant_id=$1 AND m.user_id=(SELECT id FROM public.users WHERE email=$2)", [f.tenantId, emptyTenant(packageActor("receiving", info.project.name.includes("mobile")).fixture).email]);
  expect(roles.length).toBeGreaterThan(0);
  try {
    await db("DELETE FROM public.membership_roles WHERE tenant_id=$1 AND membership_id=$2", [f.tenantId, roles[0]!.membership_id]);
    await page.goto(`/t/${f.slug}/receipts/packages/labels?document=${id}`);
    await expect(page.getByTestId("package-label-sheet")).toHaveCount(0);
  } finally {
    for (const role of roles) await db("INSERT INTO public.membership_roles(tenant_id,membership_id,role_key) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [f.tenantId, role.membership_id, role.role_key]);
  }
});
