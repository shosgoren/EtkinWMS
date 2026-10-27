// T-981b → T-1092: Excel yalnız Ayarlar › Bağlantılar'da (kullanıcı kararı 27 Ekim; listelerde Excel düğmesi yok). Alan Ürünler +
// İşlem Dışarı aktar → ana düğme .xlsx indirir ve sonuç balonu görünür. Demo yönetici (hesap sahibi: aktarım yetkisi var). Dosya yalnız bellekte doğrulanır (ZIP imzası; G-09).
import { expect, test } from "@playwright/test";
import { localClient } from "./support/empty-tenant.ts";
import { loginAdmin } from "./support/import-screen.ts";

// Demo girişi IP başına sınırlıdır: bu dosya kendi istemci adresini kullanır (yalnız yerel vekil okur).
test.use({ ...localClient("198.51.100.44"), trace: "off" });

test("Bağlantılar: Ürünler → Dışarı aktar .xlsx indirir; listelerde Excel düğmesi yok", async ({ page }) => {
  test.setTimeout(120_000);
  await loginAdmin(page);
  for (const yol of ["/t/demo/items", "/t/demo/parties", "/t/demo/warehouses"]) {
    await page.goto(yol);
    await expect(page.locator(".kalip").filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByTestId("kalip-excel"), `${yol}: Excel düğmesi yok`).toHaveCount(0);
  }
  await page.goto("/t/demo/settings/baglantilar");
  await page.getByRole("radiogroup", { name: "1 · Alan" }).getByRole("radio", { name: /Ürünler/ }).click();
  await page.getByRole("radiogroup", { name: "2 · İşlem" }).getByRole("radio", { name: /Dışarı aktar/ }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("baglantilar-main").filter({ visible: true }).first().click()]);
  expect(download.suggestedFilename()).toMatch(/^etkin-urunler-demo-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const file = Buffer.concat(chunks);
  expect(file.subarray(0, 4).toString("hex")).toBe("504b0304");
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
