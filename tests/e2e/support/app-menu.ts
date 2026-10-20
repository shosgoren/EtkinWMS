// T-988 (I-18): Akış ana ekranında (Görevlerim tasarımı) uygulama menüsü sarı ⚠ düğmesinin açılır kutusundadır
// (`home-actions` → `app-bar-menu`); diğer ekranlarda menü düğmesi üst çubuktadır. Testler menüyü bu yardımcıyla açar.
// Aramalar `#main` içindedir: akış (streaming) sırasında React çözülmüş içeriği kısa süre gizli bir kopyada tutar.
import { expect, type Page } from "@playwright/test";

// T-971: kalıp ekranlarında eski üst çubuk (içindeki menü düğmesiyle) DOM'da gizli durur; Hesap menüsündeki "Tüm ekranlar" aynı kimliği taşır.
// Bu yüzden yalnız görünen öğe alınır.
const home = (page: Page) => page.locator("#main").getByTestId("home-actions").filter({ visible: true });
const bar = (page: Page) => page.locator("#main").getByTestId("app-bar-menu").filter({ visible: true });

/** Menü düğmesi bu ekranda erişilebilir mi (ana ekran ⚠ düğmesi ya da üst çubuk menü düğmesi görünür). */
export async function appMenuReachable(page: Page): Promise<boolean> {
  return (await home(page).first().isVisible()) || (await bar(page).first().isVisible());
}

/** Uygulama menüsü penceresini açar (sayfa hazır olana kadar iki girişten birinin görünmesini bekler). */
export async function openAppMenu(page: Page): Promise<void> {
  await expect(home(page).or(bar(page)).first()).toBeVisible();
  // T-422: Pano ana ekranında menü hidrasyon/akış sırasında yeniden çizilebilir (öğe ayrılır); kısa denemelerle yeniden açılır.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (!(await bar(page).first().isVisible()) && (await home(page).first().isVisible())) await home(page).first().click({ timeout: 5_000 });
      await bar(page).first().click({ timeout: 5_000 });
      return;
    } catch (e) {
      if (attempt === 2) throw e;
      await page.waitForTimeout(500);
    }
  }
}
