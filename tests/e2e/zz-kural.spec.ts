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

// T-1046 (Codex P1): Ayarlar sekmeleri tek taslağın bölümleridir — sekme geçişi "kaydetmeden çık" sormaz, taslağı silmez ya da gizli
// bırakmaz; değişiklik Firma'ya dönünce de işaretli, Kaydet etkin. Entegrasyonlar ayrı ekrandır (koruma orada sorar).
test("T-1046 Ayarlar sekmeleri arası geçiş taslağı korur", async ({ page }) => {
  await page.goto("/");
  await enterDemoShared(page, "Yönetici");
  await page.goto("/t/demo/settings");
  await page.getByTestId("settings-locale").click();
  await page.getByTestId("settings-locale-editor").getByText("English", { exact: true }).click();
  await expect(page.getByTestId("settings-locale")).toHaveAttribute("data-changed", "true");
  await page.keyboard.press("Escape");
  await page.getByTestId("kalip-sekme").locator('[data-tab="gorunum"]').click();
  await expect(page).toHaveURL(/sekme=gorunum/);
  await expect(page.getByTestId("kalip-unsaved")).toHaveCount(0);
  await expect(page.getByTestId("settings-save")).toBeEnabled();
  await page.getByTestId("kalip-sekme").locator('[data-tab="firma"]').click();
  await expect(page.getByTestId("settings-locale")).toHaveAttribute("data-changed", "true");
  await page.getByTestId("kalip-sekme").locator('[data-tab="entegrasyon"]').click();
  await expect(page.getByTestId("kalip-unsaved")).toBeVisible();
});

// T-1047 (STANDART §2): liste kalıbı — Kart/Liste geçişi, sıralanan tablo, Sütunlar seçimi; seçim cihazda kalır (yeniden açılışta).
test("T-1047 Ürünler: Kart/Liste, sıralama, Sütunlar", async ({ page }) => {
  // Telefonda her zaman kart (tablo sığmaz); liste görünümü geniş ekranda sınanır.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await enterDemoShared(page, "Yönetici");
  await page.goto("/t/demo/items");
  await expect(page.getByTestId("item-card").first()).toBeVisible();
  await page.getByTestId("kalip-gorunum").locator('[data-gorunum="liste"]').click();
  const tablo = page.getByTestId("items-table");
  await expect(tablo).toBeVisible();
  await expect(page.getByTestId("item-card")).toHaveCount(0);
  const ilk = async (): Promise<string> => (await tablo.locator("tbody tr").first().locator("td").first().innerText()).trim();
  await tablo.getByRole("button", { name: "Kod" }).click();
  const artan = await ilk();
  await tablo.getByRole("button", { name: "Kod" }).click();
  await expect(tablo.locator("th").first()).toHaveAttribute("aria-sort", "descending");
  expect(await ilk()).not.toBe(artan);
  await page.getByTestId("kalip-sutunlar").click();
  await page.getByTestId("kalip-sutunlar-pencere").getByLabel("Birim", { exact: true }).uncheck();
  await expect(tablo.locator("th", { hasText: "Birim" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("items-table")).toBeVisible();
  await expect(page.getByTestId("items-table").locator("th", { hasText: "Birim" })).toHaveCount(0);
  // Temizlik: varsayılan görünüm (diğer testler kart bekler).
  await page.getByTestId("kalip-sutunlar").click();
  await page.getByTestId("kalip-sutunlar-pencere").getByRole("button", { name: "Varsayılana dön" }).click();
  await page.getByTestId("kalip-gorunum").locator('[data-gorunum="kart"]').click();
  await expect(page.getByTestId("item-card").first()).toBeVisible();
});

// T-1048: aynı liste kalıbı Cariler ve Depolar'da (ortak parçalar).
test("T-1048 Cariler ve Depolar: Kart/Liste tablosu", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await enterDemoShared(page, "Yönetici");
  for (const [yol, tablo] of [["/t/demo/parties", "parties-table"], ["/t/demo/warehouses", "warehouses-table"]] as const) {
    await page.goto(yol);
    await page.getByTestId("kalip-gorunum").locator('[data-gorunum="liste"]').click();
    await expect(page.getByTestId(tablo)).toBeVisible();
    await expect(page.getByTestId(tablo).locator("tbody tr").first()).toBeVisible();
    await page.getByTestId("kalip-gorunum").locator('[data-gorunum="kart"]').click();
    await expect(page.getByTestId(tablo)).toHaveCount(0);
  }
});

// T-1049 (STANDART §3): ürün kartı kayıt kartı kalıbında — üst şerit (ad + etiketler), sekmeler (adres `?sekme=`), Genel'de bilgi
// kutucukları; Barkodlar sekmesi ekleme düğmesini taşır; içerik dokunma hedefleri ≥ 44 px; telefonda yatay taşma yok.
test("T-1049 Ürün kartı: şerit, sekmeler, bilgi kutucukları", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await enterDemoShared(page, "Yönetici");
  await page.goto("/t/demo/items");
  await page.getByTestId("item-card").first().click();
  await expect(page).toHaveURL(/\/items\/[0-9a-f-]{36}$/);
  const kart = page.getByTestId("item-kart");
  await expect(kart).toBeVisible();
  await expect(kart.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("kalip-code")).toBeVisible();
  await expect(page.getByTestId("kart-sekme-genel")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("kart-bilgi-unit")).toBeVisible();
  // Genel: 3 sütun (bilgi kutucukları aynı satırda).
  const y = async (k: string): Promise<number> => (await page.getByTestId(`kart-bilgi-${k}`).boundingBox())?.y ?? -1;
  expect(await y("name")).toBe(await y("type"));
  expect(await smallTouchTargets(page, 44, "#kalip-main")).toEqual([]);
  await page.getByTestId("kart-sekme-barkod").click();
  await expect(page).toHaveURL(/\?sekme=barkod$/);
  await expect(page.getByTestId("barcode-add")).toBeVisible();
  await expect(page.getByTestId("kart-bilgi-unit")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("kart-sekme-barkod")).toBeVisible();
  const tasma = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(tasma).toBeLessThanOrEqual(0);
});
