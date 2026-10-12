import { expect, test } from "@playwright/test";
import { completeFirstUseGuide } from "./support/first-use-guide.ts";
import { enterDemoReal, enterDemoShared } from "./support/demo-session.ts";

const title = "Birlikte, adım adım.";

for (const [mode, enter] of [["gerçek", enterDemoReal], ["paylaşılan", enterDemoShared]] as const) {
  test(`rehberden sonra ${mode} demo giriş yardımcısı ana ekrana ulaşır`, async ({ page }) => {
    await page.goto("/");
    await enter(page, "Yönetici");
    await expect(page).toHaveURL(/\/t\/demo$/);
    await expect(page.getByRole("dialog", { name: title })).not.toBeVisible();
  });
}

test("ilk rehber tamamlanır; giriş kullanılabilir, tercih yenilemede korunur ve rehber yeniden açılır", async ({ page }) => {
  await page.goto("/login");
  const guide = page.getByRole("dialog", { name: title });
  await expect(guide).toBeVisible();
  await expect(guide.getByRole("heading", { name: "Yapacağınız işi seçin" })).toBeVisible();
  const bounds = await guide.boundingBox();
  const viewport = page.viewportSize();
  if (bounds === null || viewport === null) throw new Error("rehber/ekran ölçüsü alınamadı");
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
  await completeFirstUseGuide(page);
  await page.getByLabel("E-posta").fill("guide@example.invalid");
  await expect(page.getByLabel("E-posta")).toHaveValue("guide@example.invalid");
  await page.reload();
  await page.getByLabel("E-posta").click();
  await expect(guide).not.toBeVisible();
  await page.getByRole("button", { name: "Nasıl kullanırım?" }).click();
  await expect(guide.getByText("Adım 1 / 3", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(guide).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Nasıl kullanırım?" })).toBeFocused();
});

test("kapat düğmesi formu açar ve tekrar açıldığında ilk adım gösterilir", async ({ page }) => {
  await page.goto("/login");
  const guide = page.getByRole("dialog", { name: title });
  await expect(guide).toBeVisible();
  await guide.getByRole("button", { name: "Sonraki adım" }).click();
  await guide.getByRole("button", { name: "Şimdilik kapat", exact: true }).last().click();
  await expect(guide).not.toBeVisible();
  await page.getByLabel("E-posta").click();
  await expect(page.getByLabel("E-posta")).toBeFocused();
  await page.getByRole("button", { name: "Nasıl kullanırım?" }).click();
  await expect(guide.getByText("Adım 1 / 3", { exact: true })).toBeVisible();
  await guide.getByRole("button", { name: "Şimdilik kapat", exact: true }).first().click();
  await expect(guide).not.toBeVisible();
});
