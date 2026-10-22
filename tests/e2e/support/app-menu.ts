// T-979c: eski "Tüm ekranlar" penceresi kaldırıldı. Hesap işlemleri ekranın kendi menüsündedir:
//   - Pano ve kalıp ekranları: sağ üstteki Hesap düğmesi (`home-actions`) → Kullanıcı değiştir · Çalışma alanı değiştir · tema · Çıkış yap
//     (`pano-menu-*`); görünüm geçişi (Genel bakış ↔ İşlemler) ortak alt çubuğun Modüller sayfasında (`data-module="kokpit" | "akis"`).
//   - Görevlerim (Akış ana ekranı, alt çubuk yok): sarı ⚠ düğmesi (`home-actions`) → Genel bakış (`home-overview`) · Çıkış yap (`home-signout`).
// Aramalar `#main` içindedir ve yalnız görünen öğe alınır (akış sırasında React çözülmüş içeriği kısa süre gizli kopyada tutabilir).
import { expect, type Page } from "@playwright/test";

const actions = (page: Page) => page.locator("#main").getByTestId("home-actions").filter({ visible: true });
const outItem = (page: Page) => page.getByTestId("pano-menu-out").or(page.getByTestId("home-signout")).filter({ visible: true });

/** Ekranın hesap menüsünü açar (Hesap düğmesi ya da Görevlerim ⚠ kutusu). Menü yeniden çizilirse kısa denemelerle yeniden açar. */
export async function openAccountMenu(page: Page): Promise<void> {
  await expect(actions(page).first()).toBeVisible();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (!(await outItem(page).first().isVisible())) await actions(page).first().click({ timeout: 5_000 });
      await expect(outItem(page).first()).toBeVisible({ timeout: 5_000 });
      return;
    } catch (e) {
      if (attempt === 2) throw e;
      await page.waitForTimeout(500);
    }
  }
}

/** Hesap menüsündeki "Çıkış yap" öğesi (menü açık olmalı). */
export function signOutItem(page: Page) {
  return outItem(page).first();
}

/** Hesap menüsünden çıkış yapar ve giriş ekranını bekler. */
export async function signOut(page: Page): Promise<void> {
  await openAccountMenu(page);
  await signOutItem(page).click();
  await expect(page).toHaveURL(/\/login$/);
}

/**
 * Görünümü seçer. Ortak alt çubuk varsa Modüller sayfasındaki geçiş kutusu; Görevlerim'de ⚠ kutusundaki Genel bakış; zaten o görünümdeyse
 * bir şey yapmaz. Sonunda `html[data-view]` doğrulanır.
 */
export async function selectView(page: Page, view: "flow" | "cockpit"): Promise<void> {
  const html = page.locator("html");
  if ((await html.getAttribute("data-view")) === view) return;
  const mods = page.getByTestId("kabuk-mods").filter({ visible: true });
  // T-436: kiracı `loading.tsx` (iskelet) ile içerik akışla gelir; React çözülmüş içeriği kısa süre gizli kopyada tutar. Önce ekranın
  // görünür hâli (hesap düğmesi) beklenir, sonra alt çubuk olup olmadığına bakılır.
  await expect(actions(page).first()).toBeVisible();
  if (await mods.first().isVisible()) {
    await mods.first().click();
    const tile = page.getByRole("dialog", { name: "Modüller" }).locator(`[data-module="${view === "cockpit" ? "kokpit" : "akis"}"]`);
    await expect(tile).toBeVisible();
    await tile.click();
  } else {
    await actions(page).first().click();
    await page.getByTestId("home-overview").click();
  }
  await expect(html).toHaveAttribute("data-view", view);
}
