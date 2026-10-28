// T-1102 (kullanıcı 27 Ekim): yüzen kısayol (şimşek) her ekranda; Düzenle seçicisinde üyenin bütün modülleri (Modüller sayfasındaki
// bağlantılı kutular, yetkiyle süzülmüş). Seçilen kısayol halkada görünür ve ekranı açar.
import { expect, test } from "@playwright/test";
import { enterDemoShared } from "./support/demo-session.ts";

test("T-1102 yüzen kısayol her ekranda; Düzenle bütün modülleri listeler, seçilen kısayol açılır", async ({ page }) => {
  await page.goto("/");
  await enterDemoShared(page, "Yönetici");
  for (const yol of ["/t/demo", "/t/demo/items", "/t/demo/warehouses", "/t/demo/parties", "/t/demo/settings", "/t/demo/stock"]) {
    await page.goto(yol);
    await expect(page.getByTestId("pano-fab"), `${yol}: yüzen kısayol`).toBeVisible();
  }
  await page.goto("/t/demo/items");
  await page.getByTestId("pano-fab").click();
  const halka = page.getByRole("menu", { name: "Kısayollar" });
  await expect(halka).toBeVisible();
  // Perde alt çubuk dahil bütün ekranı örter; halka perdenin üstünde.
  await expect(page.locator(".kisayol-kok .hback")).toBeVisible();
  await page.getByTestId("pano-edit").click();
  const secici = page.getByTestId("pano-picker");
  await expect(secici).toBeVisible();
  // Eski Pano listesinde olmayan modüller de seçilebilir (ör. Cariler, Ayarlar, Stok durumu).
  for (const id of ["cari", "ayar", "stok", "urun", "depo"]) await expect(secici.locator(`[data-shortcut="${id}"]`), id).toHaveCount(1);
  expect(await secici.locator("[data-shortcut]").count()).toBeGreaterThanOrEqual(10);
  // Seçimi baştan kur: yalnız Cariler.
  const secili = secici.locator('[data-shortcut][aria-pressed="true"]');
  while ((await secili.count()) > 0) await secili.first().click();
  await secici.locator('[data-shortcut="cari"]').click();
  await page.getByTestId("pano-picker-save").click();
  await expect(secici).toBeHidden();
  await page.goto("/t/demo/warehouses");
  await page.getByTestId("pano-fab").click();
  await expect(halka.locator("[data-shortcut]")).toHaveCount(1);
  await halka.locator('[data-shortcut="cari"]').click();
  await expect(page).toHaveURL(/\/t\/demo\/parties$/);
});

test("T-1120 şimşek halkasında Rehber her ekranda: ekranın rehberi varsa başlar, yoksa rehber seçici açılır", async ({ page }) => {
  await page.goto("/");
  await enterDemoShared(page, "Yönetici");
  for (const yol of ["/t/demo/stock/documents?new=TRANSFER", "/t/demo/audit"]) {
    await page.goto(yol);
    await page.getByTestId("pano-fab").click();
    await page.getByTestId("pano-guide").click();
    // Rehber kartı (ekranın işlem rehberi) ya da rehber/yolculuk seçicisi açılır; şimşek perdenin altında kalır.
    await expect(page.locator('[data-testid="working-guide"], [data-testid="guide-picker"], .ysheet').first(), yol).toBeVisible();
    await expect(page.getByTestId("pano-fab"), `${yol}: şimşek rehberin üstünde değil`).toBeHidden();
    // Ortak demo oturumu: açılan rehberi kapat (sonraki ekran ve testler temiz başlasın).
    const kapat = page.locator('[data-testid="guide-close"]:visible, [data-testid="guide-picker"] .ycls, .ysheet .ycls').first();
    if ((await kapat.count()) > 0) await kapat.click();
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-testid="working-guide"]:not([data-folded="true"]), [data-testid="guide-picker"]')).toHaveCount(0);
  }
});

