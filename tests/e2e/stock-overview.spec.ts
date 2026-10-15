import { expect, test } from "@playwright/test";
import { enterDemoReal } from "./support/demo-session.ts";
import { openAppMenu } from "./support/app-menu.ts";

test("stok: ana menü, gerçek veriler, arama, yardım ve mobil taşma", async ({ page }) => {
  await page.goto("/");
  await enterDemoReal(page, "Yönetici");
  await page.getByRole("button", { name: "Nasıl kullanırım?" }).click();
  await expect(page.getByRole("dialog", { name: "Birlikte, adım adım." })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Birlikte, adım adım." })).not.toBeVisible();
  // T-988 (I-18): Görevlerim tasarımında sayfa bağlantısı yoktur; Stok uygulama menüsündedir.
  await expect(page).toHaveURL(/\/t\/demo$/);
  await openAppMenu(page);
  await page.getByRole("dialog", { name: "Menü" }).locator('a[href="/t/demo/stock"]').click();
  await expect(page.getByRole("heading", { name: "Stok durumu", exact: true })).toBeVisible();
  const rows = page.getByRole("list", { name: "Stok durumu" }).getByRole("listitem");
  expect(await rows.count()).toBeGreaterThan(0);
  await expect(rows.first().getByText("Kullanılabilir", { exact: true })).toBeVisible();
  await expect(rows.first()).toContainText("Depo:");
  await page.getByText("Miktarlar ne anlama geliyor?", { exact: true }).click();
  await expect(page.getByText(/Kabul alanı, hasarlı/)).toBeVisible();
  const layout = await page.evaluate("({scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth})") as { scroll: number; width: number };
  expect(layout.scroll).toBeLessThanOrEqual(layout.width);
  const button = await page.getByRole("button", { name: "Ara", exact: true }).boundingBox();
  expect(button?.height).toBeGreaterThanOrEqual(48);
  await page.getByLabel("Ürün veya depo ara").fill("missing-item-903");
  await page.getByRole("button", { name: "Ara", exact: true }).click();
  await expect(page.getByText("Gösterilecek stok bulunamadı.")).toBeVisible();
  await page.getByRole("link", { name: "Temizle" }).click();
  await expect(rows.first()).toBeVisible();
});

test("stok: oturumsuz erişim giriş ister", async ({ page }) => {
  await page.goto("/t/demo/stock");
  await expect(page).toHaveURL(/\/login\?next=/);
});
