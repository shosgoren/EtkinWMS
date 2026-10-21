// T-981b: Ürünler ekranında üst çubuktaki Excel düğmesi → buzlu menü (İçeri al / Güncelle / Dışarı aktar) → Dışarı aktar .xlsx indirir
// ve sonuç balonu görünür. Demo yönetici (hesap sahibi: aktarım yetkisi var). Dosya yalnız bellekte doğrulanır (ZIP imzası; G-09).
import { expect, test } from "@playwright/test";
import { localClient } from "./support/empty-tenant.ts";
import { loginAdmin } from "./support/import-screen.ts";

// Demo girişi IP başına sınırlıdır: bu dosya kendi istemci adresini kullanır (yalnız yerel vekil okur).
test.use({ ...localClient("198.51.100.44"), trace: "off" });

test("Ürünler: Excel menüsü → Dışarı aktar .xlsx indirir", async ({ page }) => {
  test.setTimeout(120_000);
  await loginAdmin(page);
  await page.goto("/t/demo/items");
  const excel = page.getByTestId("kalip-excel");
  await expect(excel).toBeVisible();
  await excel.click();
  const menu = page.getByTestId("kalip-excel-menu");
  await expect(menu).toBeVisible();
  await expect(page.getByTestId("kalip-excel-import")).toHaveAttribute("href", "/t/demo/import?tur=urun");
  await expect(page.getByTestId("kalip-excel-update")).toHaveAttribute("href", "/t/demo/import?tur=urun&kip=guncelle");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("kalip-excel-export").click()]);
  expect(download.suggestedFilename()).toMatch(/^etkin-urunler-demo-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const file = Buffer.concat(chunks);
  expect(file.subarray(0, 4).toString("hex")).toBe("504b0304");
  await expect(menu).toBeHidden();
  await expect(page.getByTestId("kalip-toast").last()).toContainText("Excel'e indirildi");
});

// B-112: Ayarlar › Bağlantılar'da Paraşüt satırı Entegrasyon ekranına gider; Logo YAKINDA yer tutucusu kalır.
test("Bağlantılar: Paraşüt → Entegrasyon ekranı, Logo YAKINDA", async ({ page }) => {
  test.setTimeout(120_000);
  await loginAdmin(page);
  await page.goto("/t/demo/settings/baglantilar");
  const parasut = page.getByTestId("entegrasyon-parasut");
  await expect(parasut).toHaveAttribute("href", "/t/demo/integrations");
  await expect(page.getByTestId("entegrasyon-logo")).toContainText("YAKINDA");
  await parasut.click();
  await expect(page).toHaveURL(/\/t\/demo\/integrations$/);
});
