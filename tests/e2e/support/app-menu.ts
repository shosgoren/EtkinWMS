// T-988 (I-18): Akış ana ekranında (Görevlerim tasarımı) uygulama menüsü sarı ⚠ düğmesinin açılır kutusundadır
// (`home-actions` → `app-bar-menu`); diğer ekranlarda menü düğmesi üst çubuktadır. Testler menüyü bu yardımcıyla açar.
import type { Page } from "@playwright/test";

/** Menü düğmesi bu ekranda erişilebilir mi (ana ekran ⚠ düğmesi ya da üst çubuk menü düğmesi görünür). */
export async function appMenuReachable(page: Page): Promise<boolean> {
  return (await page.getByTestId("home-actions").isVisible()) || (await page.getByTestId("app-bar-menu").isVisible());
}

/** Uygulama menüsü penceresini açar. */
export async function openAppMenu(page: Page): Promise<void> {
  const home = page.getByTestId("home-actions");
  if (await home.isVisible()) await home.click();
  await page.getByTestId("app-bar-menu").click();
}
