import { expect, test } from "@playwright/test";
import { completeFirstUseGuide } from "./support/first-use-guide.ts";
import { enterDemoReal, enterDemoShared } from "./support/demo-session.ts";

const title = "Birlikte, adım adım.";
// T-1134: kapalı rehber penceresi `inert`; açılınca odak pencerenin içine geçer (showModal öncesi inert kalkar).
const odakPencerede = "document.activeElement?.closest('dialog.guide-dialog[open]') != null && !document.querySelector('dialog.guide-dialog').inert";

for (const [mode, enter] of [["gerçek", enterDemoReal], ["paylaşılan", enterDemoShared]] as const) {
  test(`rehberden sonra ${mode} demo giriş yardımcısı ana ekrana ulaşır`, async ({ page }) => {
    await page.goto("/");
    await enter(page, "Yönetici");
    await expect(page).toHaveURL(/\/t\/demo$/);
    await expect(page.getByRole("dialog", { name: title })).not.toBeVisible();
  });
}

test("giriş ekranı sade: üst bar ve ilk rehber çıkmaz, form hemen kullanılır", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Giriş yap" })).toBeVisible();
  await expect(page.locator(".app-header")).toBeHidden();
  await expect(page.getByRole("button", { name: "Nasıl kullanırım?" })).toBeHidden();
  await page.getByLabel("E-posta").fill("guide@example.invalid");
  await expect(page.getByLabel("E-posta")).toHaveValue("guide@example.invalid");
  await expect(page.getByRole("dialog", { name: title })).not.toBeVisible();
});

test("ilk rehber tamamlanır; tercih yenilemede korunur ve rehber yeniden açılır", async ({ page }) => {
  await page.goto("/");
  const guide = page.getByRole("dialog", { name: title });
  await expect(guide).toBeVisible();
  await expect(guide.getByRole("heading", { name: "Yapacağınız işi seçin" })).toBeVisible();
  await expect.poll(() => page.evaluate<boolean>(odakPencerede), "kendiliğinden açılan rehberde odak pencerede").toBe(true);
  const bounds = await guide.boundingBox();
  const viewport = page.viewportSize();
  if (bounds === null || viewport === null) throw new Error("rehber/ekran ölçüsü alınamadı");
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
  await completeFirstUseGuide(page);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(guide).not.toBeVisible();
  await page.getByRole("button", { name: "Nasıl kullanırım?" }).click();
  await expect(guide.getByText("Adım 1 / 3", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate<boolean>(odakPencerede), "düğmeyle açılan rehberde odak pencerede").toBe(true);
  await page.keyboard.press("Escape");
  await expect(guide).not.toBeVisible();
  await expect(page.locator("dialog.guide-dialog")).toHaveAttribute("inert", "");
  await expect(page.getByRole("button", { name: "Nasıl kullanırım?" })).toBeFocused();
});

test("kapat düğmesi rehberi kapatır ve tekrar açıldığında ilk adım gösterilir", async ({ page }) => {
  await page.goto("/");
  const guide = page.getByRole("dialog", { name: title });
  await expect(guide).toBeVisible();
  await guide.getByRole("button", { name: "Sonraki adım" }).click();
  await guide.getByRole("button", { name: "Şimdilik kapat", exact: true }).last().click();
  await expect(guide).not.toBeVisible();
  await page.getByRole("button", { name: "Nasıl kullanırım?" }).click();
  await expect(guide.getByText("Adım 1 / 3", { exact: true })).toBeVisible();
  await guide.getByRole("button", { name: "Şimdilik kapat", exact: true }).first().click();
  await expect(guide).not.toBeVisible();
});
