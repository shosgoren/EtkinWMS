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
    // Codex P2 (PR 197): depo tablosunda kartın yönetim işlemleri (kodu değiştir, arşivle) satırda.
    if (tablo === "warehouses-table") await expect(page.getByTestId(tablo).getByRole("button", { name: /için kodu değiştir$/ }).first()).toBeVisible();
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
  const tasma = await page.evaluate<number>("document.documentElement.scrollWidth - document.documentElement.clientWidth");
  expect(tasma).toBeLessThanOrEqual(0);
});

// T-1050 (kullanıcı 26 Ekim, iPhone görüntüsü): Pano üst çubuğu — masaüstünde "Merhaba <ad>" (tuval), telefonda yalnız logo (firma adı
// kesilmez); sabit "DOKUN → RAPOR AÇILIR" ipucu yok; Hesap düğmesinde baş harf.
test("T-1050 Pano: selam üst çubukta, telefonda yalnız logo, ipucu yok", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await enterDemoShared(page, "Yönetici");
  await page.goto("/t/demo");
  await expect(page.getByTestId("pano")).toBeVisible();
  const selam = page.getByTestId("pano").locator(".top .stselam");
  await expect(selam).toBeVisible();
  await expect(selam).toContainText(/^Merhaba /);
  await expect(page.getByRole("heading", { level: 1, name: /^Merhaba / })).toHaveCount(1);
  await expect(page.getByText("DOKUN → RAPOR AÇILIR")).toHaveCount(0);
  await expect(page.getByTestId("home-actions").locator(".stav")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(selam).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: /^Merhaba / })).toBeVisible();
});
// T-1051 (STANDART §3): depo kartı kayıt kartı kalıbında — şerit (ad h1, kod, durum, Raf yeri kutusu) + raf yeri ağacı; ≥ 44 px; telefonda taşma yok.
test("T-1051 Depo kartı: şerit ve raf yeri ağacı", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await enterDemoShared(page, "Yönetici");
  await page.goto("/t/demo/warehouses");
  await page.getByTestId("warehouse-card").first().locator("a").first().click();
  await expect(page).toHaveURL(/\/warehouses\/[0-9a-f-]{36}$/);
  const kart = page.getByTestId("warehouse-kart");
  await expect(kart).toBeVisible();
  await expect(kart.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("kalip-code")).toBeVisible();
  await expect(page.getByTestId("kalip-total")).toBeVisible();
  await expect(page.getByTestId("location-tree-card")).toBeVisible();
  expect(await smallTouchTargets(page, 44, "#kalip-main")).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(kart).toBeVisible();
  const tasma = await page.evaluate<number>("document.documentElement.scrollWidth - document.documentElement.clientWidth");
  expect(tasma).toBeLessThanOrEqual(0);
});

// T-1052 (STANDART §4): form kalıbı masaüstünde — canlı ad şeridi formun üstünde (sağ sütun değil), gruplar yan yana; telefonda taşma yok.
test("T-1052 Form: üst şerit ve yan yana gruplar", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await enterDemoShared(page, "Yönetici");
  await page.goto("/t/demo/parties?new=1");
  const serit = page.getByTestId("kalip-preview");
  await expect(serit).toBeVisible();
  const gruplar = page.locator(".dzf .kfc .sg");
  await expect(gruplar.nth(1)).toBeVisible();
  const kutu = async (i: number) => (await gruplar.nth(i).boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  const s = (await serit.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  const g0 = await kutu(0);
  const g1 = await kutu(1);
  expect(s.y + s.height).toBeLessThanOrEqual(g0.y);
  expect(Math.abs(g0.y - g1.y)).toBeLessThan(2);
  expect(g1.x).toBeGreaterThan(g0.x);
  await page.getByLabel("Ünvan", { exact: false }).first().fill("Şerit Deneme");
  await expect(serit).toContainText("Şerit Deneme");
  await page.setViewportSize({ width: 390, height: 844 });
  const tasma = await page.evaluate<number>("document.documentElement.scrollWidth - document.documentElement.clientWidth");
  expect(tasma).toBeLessThanOrEqual(0);
});

// T-1053 (STANDART §1): üst çubukta Son işlemler — pencere bugün yaptıklarını gösterir, Esc kapatır ve odak düğmeye döner; telefonda gizli.
test("T-1053 Son işlemler: pencere açılır, Esc kapatır", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await enterDemoShared(page, "Yönetici");
  await page.goto("/t/demo/items");
  const dugme = page.getByTestId("st-son-islemler");
  await expect(dugme).toBeVisible();
  await dugme.click();
  const pencere = page.getByTestId("st-son-islemler-pencere");
  await expect(pencere).toBeVisible();
  await expect(pencere.getByText("Bugün yaptıkların")).toBeVisible();
  await expect(pencere.getByText("Yükleniyor…")).toHaveCount(0);
  // Codex P1 (PR 202): ortak perde arkayı örter; Tab odağı pencerede tutar.
  await expect(page.getByTestId("kalip-perde")).toBeVisible();
  await page.keyboard.press("Tab");
  expect(await page.evaluate<boolean>("document.activeElement !== null && document.activeElement.closest('[data-testid=\"st-son-islemler-pencere\"]') !== null")).toBe(true);
  await page.keyboard.press("Escape");
  await expect(pencere).toHaveCount(0);
  await expect(dugme).toBeFocused();
  // Tablet (900 px) ve telefonda gizli: üst çubukta ekran adına yer kalır (eski-cubuk tablet).
  await page.setViewportSize({ width: 900, height: 1180 });
  await expect(dugme).toBeHidden();
  await expect(page.getByRole("heading", { name: "Ürünler", exact: true }).filter({ visible: true }).first()).toBeVisible();
});
// T-1055 (kullanıcı kararı 26 Ekim): sayfa yerine kaydırma — arama ve süzgeç yerinde kalır, yalnız liste kayar; telefonda bütün kartlar ve
// bütün çipler (çip şeridi sağa kayar); liste sonunda sayı; tabloda sütun başlığı sabit.
test("T-1055 Liste: yalnız liste kayar, üst bölüm yerinde", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 660 });
  await page.goto("/");
  await enterDemoShared(page, "Yönetici");
  await page.goto("/t/demo/items");
  const ara = page.getByRole("searchbox", { name: "Ürün ara" });
  await expect(ara).toBeVisible();
  const once = await ara.boundingBox();
  const kartlar = page.getByTestId("item-card");
  expect(await kartlar.count()).toBeGreaterThan(5);
  // Kaynaktaki "telefonda ilk 5 kart" kısıtı yok: altıncı kart da çizilir.
  await expect(kartlar.nth(5)).toBeAttached();
  expect(await kartlar.nth(5).evaluate("(e) => getComputedStyle(e).display")).not.toBe("none");
  // Yüksekliği sınırlı listede kartlar sıkışmaz: içerik kartı taşmaz, kartlar üst üste binmez (uzun kabul kartı CI'da bindi).
  expect(await page.evaluate<boolean>("(() => { const k = [...document.querySelectorAll('#kalip-main > .ulist > .uc')]; return k.length > 5 && k.every((e, i) => e.scrollHeight <= e.clientHeight + 1 && (i === 0 || e.getBoundingClientRect().top >= k[i - 1].getBoundingClientRect().bottom - 1)); })()")).toBe(true);
  // Liste kendi içinde en alta kayar; sayfa gövdesi kaymaz, arama yerinde kalır.
  expect(await page.evaluate<boolean>("(() => { const l = document.querySelector('#kalip-main > .ulist'); if (!l) return false; l.scrollTop = l.scrollHeight; return l.scrollTop > 0; })()")).toBe(true);
  await expect(ara).toBeInViewport();
  const sonra = await ara.boundingBox();
  expect(Math.abs((sonra?.y ?? 0) - (once?.y ?? 0))).toBeLessThan(2);
  expect(await page.evaluate<boolean>("document.scrollingElement.scrollHeight <= window.innerHeight + 1")).toBe(true);
  await expect(page.getByTestId("items-sonsuz")).toBeInViewport();
  await expect(page.getByTestId("items-sonsuz")).toHaveAttribute("data-devam", "0");
  // Çipler: hepsi var, şerit yatay kayar.
  const cipler = page.getByRole("group", { name: "Süzgeç" }).locator(".fch");
  expect(await cipler.count()).toBeGreaterThanOrEqual(6);
  expect(await page.evaluate<boolean>("(() => { const s = document.querySelector('.fchips'); return !!s && getComputedStyle(s).overflowX === 'auto' && s.scrollWidth > s.clientWidth; })()")).toBe(true);
  // T-1057: her süzgeç çipi sayfayı açar (kart türü çipi sunucuda çöküyordu; hiçbir test çipe basmıyordu).
  const hedefler = await cipler.evaluateAll((elements) => elements.map((element) => ({ id: element.getAttribute("data-chip"), href: element.getAttribute("href") })));
  for (const hedef of hedefler) {
    expect(hedef.id).not.toBeNull();
    expect(hedef.href).not.toBeNull();
    // T-1064: Süz ve QR ayrı ekran açar; her bağlantı aynı başlangıç listesinden denenir.
    await page.goto("/t/demo/items");
    await expect(ara).toBeVisible();
    await page.getByRole("group", { name: "Süzgeç" }).locator(`[data-chip="${hedef.id}"]`).click();
    await expect(page).toHaveURL(new URL(hedef.href!, page.url()).href);
    if (hedef.id === "filters") {
      await expect(page.getByTestId("item-filters")).toBeVisible();
      await expect(page.getByLabel("Kategori adı", { exact: true })).toBeVisible();
    } else if (hedef.id === "qr-labels") {
      await expect(page.getByTestId("labels")).toBeVisible();
      await expect(page.getByTestId("label-sheet").or(page.getByTestId("labels-notice"))).toBeVisible();
    } else {
      await expect(ara).toBeVisible();
    }
    await expect(page.getByText("Bir şeyler ters gitti")).toHaveCount(0);
  }
  await page.goto("/t/demo/items");
  // T-1058: Cariler aynı kalıpta — liste sonunda otomatik yükleme ögesi (demo verisi tek sayfa: devamı yok).
  await page.goto("/t/demo/parties");
  await expect(page.getByTestId("parties-sonsuz")).toHaveAttribute("data-devam", "0");
  // T-1059: belgeler, görevler, beklenen teslimler, denetim kaydı — sayfa düğmesi yok; liste doluysa sonunda otomatik yükleme ögesi.
  for (const [adres, kart, sonsuz] of [
    ["/t/demo/stock/documents", "document-card", "documents-sonsuz"],
    ["/t/demo/tasks", "task-row", "tasks-sonsuz"],
    ["/t/demo/receipts", "receipt-row", "receipts-sonsuz"],
    ["/t/demo/audit", "audit-row", "audit-sonsuz"],
  ] as const) {
    await page.goto(adres);
    await expect(page.getByText("Bir şeyler ters gitti")).toHaveCount(0);
    if ((await page.getByTestId(kart).count()) > 0) await expect(page.getByTestId(sonsuz)).toBeAttached();
  }
  await page.goto("/t/demo/items");
  // Masaüstü tablo: başlık sabit (sticky), tablo kendi içinde kayar.
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.getByTestId("kalip-gorunum").getByRole("radio", { name: "Liste" }).click();
  await expect(page.getByTestId("items-table")).toBeVisible();
  expect(await page.evaluate<string>("getComputedStyle(document.querySelector('[data-testid=\"items-table\"] th')).position")).toBe("sticky");
  await page.getByTestId("kalip-gorunum").getByRole("radio", { name: "Kart" }).click();
});
