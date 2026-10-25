import { expect, test } from "@playwright/test";
import { localClient, scrubSecretInputs } from "./support/empty-tenant.ts";
import { assertStock, cleanupPackages, db, documentId, fillPackage, identities, posted, seedPackage } from "./support/package-receiving.ts";
import { expectOdakHalkasi } from "./support/odak.ts";

test.use({ ...localClient("198.51.100.141"), trace: "off" });
test.afterEach(async ({ page }) => {
  try { await scrubSecretInputs(page); } finally { await cleanupPackages(); }
});

test("real KG 5 VARIL × 200: lost prepare reply and double tap preserve five origins", async ({ page }, info) => {
  const f = await seedPackage(page, info.project.name.includes("mobile"));
  await fillPackage(page, f);
  await expect(page.getByTestId("package-total")).toHaveText("5 paket / 1.000 KG");
  await page.getByRole("button", { name: "Kontrol", exact: true }).click();
  let lost = false;
  const prepareBodies: string[] = [];
  await page.route("**/receipts/packages", async route => {
    const request = route.request(), body = request.postData() ?? "";
    if (request.method() === "POST" && body.includes('"packages"') && body.includes('"clientKey"')) {
      prepareBodies.push(body);
      if (!lost) { lost = true; await route.fetch(); await route.abort("failed"); return; }
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Kabul et", exact: true }).dblclick();
  await expect(page.getByRole("button", { name: "Kabulü tekrar dene", exact: true })).toBeEnabled();
  expect(lost).toBe(true);
  const before = await db<{ id: string }>("SELECT p.id FROM public.receipt_packages p JOIN public.document_lines l ON l.tenant_id=p.tenant_id AND l.id=p.document_line_id WHERE p.tenant_id=$1 AND l.item_id=$2 ORDER BY p.package_no", [f.tenantId, f.itemId]);
  expect(before).toHaveLength(5);
  await page.getByRole("button", { name: "Kabulü tekrar dene", exact: true }).click();
  await posted(page);
  expect(prepareBodies).toHaveLength(2);
  expect(prepareBodies[1]).toBe(prepareBodies[0]);
  const id = await documentId(page);
  expect(await identities(f, id)).toEqual(before.map(p => p.id));
  await assertStock(f, id, 5, "1000.000000");
  await expect(page.getByTestId("package-flow")).toContainText("⚠ Karantina");
  await page.reload(); await posted(page); await assertStock(f, id, 5, "1000.000000");
});

test("GR → KG, different LOT quantities/dates, post fault then URL resume keeps IDs", async ({ page }, info) => {
  const f = await seedPackage(page, info.project.name.includes("mobile"), true);
  await fillPackage(page, f, f.gr, "2", "1000");
  await page.getByRole("button", { name: "Miktarlar farklı", exact: true }).click();
  for (const [n, q] of [[1, "1000"], [2, "2500"]] as const) {
    await page.getByRole("textbox", { name: `${n} Paket miktarı`, exact: true }).fill(q);
    await page.getByRole("textbox", { name: `${n} Lot kodu`, exact: true }).fill(`LOT-${n}`);
    await page.getByLabel(`${n} Üretim tarihi`, { exact: true }).fill("2026-10-01");
    await page.getByLabel(`${n} Son kullanma tarihi`, { exact: true }).fill("2027-10-01");
  }
  await expect(page.getByTestId("package-total")).toHaveText("2 paket / 3,5 KG");
  // Same real page inspected at desktop, tablet, phone and phone landscape sizes.
  for (const viewport of [{ width: 1280, height: 800 }, { width: 1024, height: 740 }, { width: 390, height: 740 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    const last = page.getByLabel("2 Son kullanma tarihi", { exact: true });
    await last.scrollIntoViewIfNeeded(); await last.focus(); await expect(last).toBeFocused(); await expect(last).toBeInViewport();
    expect(await last.evaluate(e => e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);
    await expectOdakHalkasi(last, "odak");
    const primary = page.getByRole("button", { name: "Kontrol", exact: true });
    expect(await primary.evaluate(e => e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(56);
    for (const target of [last, primary]) {
      expect(await target.evaluate(e => {
        const canvas = e.ownerDocument.createElement("canvas"), ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("e2e: contrast canvas unavailable");
        const luminance = (color: string) => {
          ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
          const pixels = ctx.getImageData(0, 0, 1, 1).data;
          const rgb = [pixels[0]!, pixels[1]!, pixels[2]!].map(v => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
          return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
        };
        const style = e.ownerDocument.defaultView!.getComputedStyle(e), a = luminance(style.color), b = luminance(style.backgroundColor);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      })).toBeGreaterThanOrEqual(4.5);
    }
    expect(await page.evaluate(() => { const d = (globalThis as unknown as { document: { documentElement: { scrollWidth: number; clientWidth: number } } }).document; return d.documentElement.scrollWidth - d.documentElement.clientWidth; })).toBeLessThanOrEqual(0);
    await expect(page.getByTestId("screen-home").filter({ visible: true })).toHaveAttribute("href", `/t/${f.slug}`);
    await expect(page.getByTestId("screen-back").filter({ visible: true })).toBeVisible();
    if (viewport.width === 390 || viewport.height === 390) {
      for (const nav of ["screen-home", "screen-back"]) expect(await page.getByTestId(nav).filter({ visible: true }).evaluate(e => e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(56);
    }
  }
  await page.getByRole("button", { name: "Kontrol", exact: true }).click();
  let faulted = false;
  await page.route("**/receipts/packages**", async route => {
    const body = route.request().postData() ?? "";
    if (!faulted && route.request().method() === "POST" && body.includes('"expectedVersion"')) {
      faulted = true;
      await db("UPDATE public.items SET status='ARCHIVED',archived_at=now() WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.itemId]);
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Kabul et", exact: true }).click();
  await expect(page.getByRole("button", { name: "Kabulü tekrar dene", exact: true })).toBeEnabled();
  expect(faulted).toBe(true);
  const id = await documentId(page), before = await identities(f, id);
  expect(before).toHaveLength(2);
  expect(await db("SELECT id FROM public.stock_ledger WHERE document_id=$1", [id])).toEqual([]);
  await page.goto(`/t/${f.slug}/receipts/packages/labels?document=${id}`);
  await expect(page.getByTestId("package-label-sheet")).toHaveCount(0);
  await db("UPDATE public.items SET status='ACTIVE',archived_at=NULL WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.itemId]);
  await page.goto(`/t/${f.slug}/receipts/packages?document=${id}`);
  await page.getByRole("button", { name: "Kabulü tekrar dene", exact: true }).click();
  await posted(page); expect(await identities(f, id)).toEqual(before);
  await assertStock(f, id, 2, "3.500000");
});
