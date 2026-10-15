// T-988 (I-18): Akış ana ekranında (Görevlerim tasarımı) uygulama menüsü sarı ⚠ düğmesinin açılır kutusundadır
// (`home-actions` → `app-bar-menu`); diğer ekranlarda menü düğmesi üst çubuktadır. Testler menüyü bu yardımcıyla açar.
// Aramalar `#main` içindedir: akış (streaming) sırasında React çözülmüş içeriği kısa süre gizli bir kopyada tutar.
import { expect, type Page } from "@playwright/test";

const home = (page: Page) => page.locator("#main").getByTestId("home-actions");
const bar = (page: Page) => page.locator("#main").getByTestId("app-bar-menu");

/** Menü düğmesi bu ekranda erişilebilir mi (ana ekran ⚠ düğmesi ya da üst çubuk menü düğmesi görünür). */
export async function appMenuReachable(page: Page): Promise<boolean> {
  return (await home(page).isVisible()) || (await bar(page).first().isVisible());
}

/** Uygulama menüsü penceresini açar (sayfa hazır olana kadar iki girişten birinin görünmesini bekler). */
export async function openAppMenu(page: Page): Promise<void> {
  await expect(home(page).or(bar(page)).first()).toBeVisible();
  if (await home(page).isVisible()) await home(page).click();
  await bar(page).first().click();
}
