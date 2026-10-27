import { expect, test } from "@playwright/test";
import { enterDemoReal } from "./support/demo-session.ts";
import { completeFirstUseGuide } from "./support/first-use-guide.ts";

test("stok: ana menü, gerçek veriler, arama, yardım ve mobil taşma", async ({ page }) => {
  await page.goto("/");
  // T-1101: "Nasıl kullanırım?" yalnız karşılama sayfasındadır (T-1012: çalışma alanında üst çubuk yok). Önceden demo girişine dokunduktan
  // SONRA aranıyordu: gezinme o an bittiyse düğme yoktu (ara sıra takılma). Rehber girişten önce karşılama sayfasında denetlenir.
  await completeFirstUseGuide(page);
  await page.getByRole("button", { name: "Nasıl kullanırım?" }).click();
  await expect(page.getByRole("dialog", { name: "Birlikte, adım adım." })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Birlikte, adım adım." })).not.toBeVisible();
  await enterDemoReal(page, "Yönetici");
  // T-979c: Stok durumu ortak alt çubuğun Modüller sayfasında (eski "Tüm ekranlar" penceresi yok).
  await expect(page).toHaveURL(/\/t\/demo$/);
  await page.getByTestId("kabuk-mods").click();
  // Telefonda ilk sayfaya sığmayabilir: arama ile bulunur (kaynaktaki "ara ya da söyle").
  await page.getByTestId("kabuk-search").fill("Stok durumu");
  await page.getByRole("dialog", { name: "Modüller" }).locator('[data-module="stok"]').click();
  await expect(page.getByRole("heading", { name: "Stok durumu", exact: true })).toBeVisible();
  const rows = page.getByRole("list", { name: "Stok durumu" }).getByRole("listitem");
  expect(await rows.count()).toBeGreaterThan(0);
  // T-972 (liste kalıbı): rozet kullanılabilir miktar + birim; ek satır depo / fiziksel / ayrılmış. Karta dokununca ürün kartı açılır.
  await expect(rows.first()).toContainText("Kullanılabilir");
  await expect(rows.first()).toContainText("Depo:");
  await expect(rows.first()).toHaveAttribute("href", /\/t\/demo\/items\/[0-9a-f-]{36}$/);
  await page.getByText("Miktarlar ne anlama geliyor?", { exact: true }).click();
  await expect(page.getByText(/Kabul alanı, hasarlı/)).toBeVisible();
  const layout = await page.evaluate("({scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth})") as { scroll: number; width: number };
  expect(layout.scroll).toBeLessThanOrEqual(layout.width);
  const back = await page.getByTestId("kabuk-back").boundingBox();
  expect(back?.height).toBeGreaterThanOrEqual(48);
  await page.getByRole("searchbox", { name: "Ürün veya depo ara" }).fill("missing-item-903");
  await page.getByRole("searchbox", { name: "Ürün veya depo ara" }).press("Enter");
  await expect(page.getByText("Bulunamadı · ara ya da söyle", { exact: true })).toBeVisible(); // ALTIN-KURAL 8: ortak arama-sonuç-yok cümlesi
  await page.getByRole("link", { name: "Temizle" }).click();
  await expect(rows.first()).toBeVisible();
});

test("stok: oturumsuz erişim giriş ister", async ({ page }) => {
  await page.goto("/t/demo/stock");
  await expect(page).toHaveURL(/\/login\?next=/);
});
