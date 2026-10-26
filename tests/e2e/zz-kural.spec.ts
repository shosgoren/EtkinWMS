// T-436: ALTIN-KURAL 5–17 uçtan uca bekçileri (yönetici demo oturumu).
// - 11: perde / menü Esc ile kapanır, odak açan düğmeye döner.
// - 10: arşivleme onay sormaz; "Geri al" balonu kaydı sunucuda arşivden çıkarır (cari kart).
// - 9: bağlantı kopunca üstte şerit; çevrimdışı gönderim engellenir ve balon çıkar.
// - 7: bulunamayan sayfa tasarım dilinde (ikon, tek cümle, Ana ekran).
// - 12: kalıp ekranlarında dokunma hedefleri ≥ 44 px (üst çubuk ikonları T-982 kapsamında; burada içerik ve alt çubuk ölçülür).
import { expect, test } from "@playwright/test";
import { enterDemoShared } from "./support/demo-session.ts";
import { expectTouchTargets, smallTouchTargets } from "./support/dokunma.ts";

test("T-436 Esc: Modüller ve Hesap menüsü kapanır, odak açan düğmeye döner", async ({ page }) => {
  await page.goto("/");
  await enterDemoShared(page, "Yönetici");
  await page.goto("/t/demo/items");
  await expect(page.locator(".kalip")).toBeVisible();
  const mods = page.getByTestId("kabuk-mods");
  await mods.click();
  await expect(page.getByTestId("kabuk-sheet")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("kabuk-sheet")).toBeHidden();
  await expect(mods).toBeFocused();

  const account = page.getByTestId("kalip-account").getByTestId("home-actions");
  await account.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  // Sessiz tercihi menüde (cihazda saklanır).
  await expect(menu.getByTestId("pano-menu-sound")).toBeVisible();
  // T-1039: Ayarlar her ekranın Hesap menüsünde (yönetici).
  await expect(menu.getByTestId("pano-menu-settings")).toHaveAttribute("href", "/t/demo/settings");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(account).toBeFocused();
});

test("T-436 Geri al: arşive alınan cari kart balondaki Geri al ile listeye döner", async ({ page }) => {
  await page.goto("/");
  await enterDemoShared(page, "Yönetici");
  const id = `${Date.now().toString(36)}${test.info().project.name.slice(0, 1)}`.toUpperCase();
  const name = `Geri Al Cari ${id}`;
  await page.goto("/t/demo/parties");
  await page.getByTestId("party-new").click();
  const form = page.getByTestId("party-form");
  await expect(form).toBeVisible();
  await form.getByLabel("Cari kodu *").fill(`GA-${id}`);
  await form.getByLabel("Ünvan *").fill(name);
  await page.getByTestId("party-form-save").click();
  const card = page.getByTestId("party-card").filter({ hasText: name });
  await expect(card).toBeVisible();

  await card.click();
  await page.getByTestId("party-archive").click();
  // Onay penceresi yok: doğrudan arşivlenir, "Geri al" balonu çıkar.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const undo = page.getByTestId("balon-eylem");
  await expect(undo).toBeVisible();
  await undo.click();
  await expect(page.getByTestId("balon").getByText("Geri alındı")).toBeVisible();
  // Sunucuda gerçekten arşivden çıktı: yenilenen etkin listede yine var.
  await page.reload();
  await expect(page.getByTestId("party-card").filter({ hasText: name })).toBeVisible();
});

test("T-436 çevrimdışı: şerit görünür, gönderim engellenir", async ({ page, context }) => {
  await page.goto("/");
  await enterDemoShared(page, "Yönetici");
  await page.goto("/t/demo/parties");
  await expect(page.locator(".kalip")).toBeVisible();
  await context.setOffline(true);
  try {
    await expect(page.getByTestId("cevrimdisi-serit")).toBeVisible();
    const search = page.getByRole("search").getByRole("searchbox");
    await search.fill("zz");
    await search.press("Enter");
    await expect(page.getByTestId("balon").getByText("Bağlantı yok · bağlanınca tekrar dene")).toBeVisible();
    await expect(page).toHaveURL(/\/t\/demo\/parties$/);
  } finally {
    await context.setOffline(false);
  }
  await expect(page.getByTestId("cevrimdisi-serit")).toBeHidden();
});

test("T-436 bulunamadı: tasarım dilinde, tek başlık, Ana ekran düğmesi", async ({ page }) => {
  await page.goto("/");
  await enterDemoShared(page, "Yönetici");
  await page.goto("/t/demo/boyle-bir-ekran-yok");
  const nf = page.getByTestId("bulunamadi-ekrani");
  await expect(nf).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(nf.getByTestId("hata-ana")).toBeVisible();
});

test("T-436 dokunma hedefi: kalıp ekranlarında içerik ve alt çubuk ≥ 44 px", async ({ page }) => {
  await page.goto("/");
  await enterDemoShared(page, "Yönetici");
  const bad: Record<string, unknown> = {};
  for (const path of ["/items", "/parties", "/warehouses", "/settings", "/members", "/stock", "/receipts", "/tasks"]) {
    await page.goto(`/t/demo${path}`);
    await expect(page.locator(".kalip")).toBeVisible();
    const small = await smallTouchTargets(page, 44, '#kalip-main, [data-testid="kabuk-dock"]');
    if (small.length > 0) bad[path] = small;
  }
  expect(bad, "kalıp ekranlarında 44 px altındaki dokunma hedefleri").toEqual({});
  // Modüller sayfası (arama mikrofonu dahil).
  await page.getByTestId("kabuk-mods").click();
  await expect(page.getByTestId("kabuk-sheet")).toBeVisible();
  await expectTouchTargets(page, 44, "Modüller", '[data-testid="kabuk-sheet"]');
  await page.keyboard.press("Escape");
  // Saha ekranları: 48 px (içerik ve alt çubuk).
  for (const path of ["/field", "/field/putaway"]) {
    await page.goto(`/t/demo${path}`);
    await expect(page.getByTestId("kabuk-dock")).toBeVisible();
    await expectTouchTargets(page, 48, path, '.dzs main, [data-testid="kabuk-dock"]');
  }
});
