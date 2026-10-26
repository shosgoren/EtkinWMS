// T-254 / T-979: cihaza uyumlu kabuk. Eski telefon üst çubuğu, masaüstü çalışma alanı satırı, ScreenShell ve alt sekme çubuğu T-979'da
// kaldırıldı: her ekran kendi kalıp/Pano üst çubuğunu ve ortak alt cam çubuğu (Kabuk) çizer. T-979c: eski "Tüm ekranlar" penceresi de yok —
// görünüm geçişi (Genel bakış ↔ İşlemler) ve ekranlar Modüller'de; Hesap menüsünde kullanıcı / çalışma alanı değiştir, tema, çıkış. Kokpit ("Genel bakış") LİSTE kalıbındadır: işler kart
// listesi (etkin / kilitli + gerekçe / yakında), "Şimdi", "Görevlerim", "Bugün yaptıklarım". Piksel karşılaştırma yok: ölçülen yerleşim
// değerleri (taşma, kaydırma, dokunma hedefi). Ekran görüntüleri `.artifacts/t-254/` altına yazılır (git'e girmez).
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import tr from "../../apps/web/messages/tr.json" with { type: "json" };
import type { Browser, Page } from "@playwright/test";
import { enterDemoReal, enterDemoShared } from "./support/demo-session.ts";
import { panoChecks } from "./support/pano-checks.ts";
import { T270_SIZES, itemsScreenChecks, metrics, smallTargets } from "./support/items-screen.ts";
import { openAccountMenu, selectView, signOut, signOutItem } from "./support/app-menu.ts";
import { expectKabukBar, expectModulesSheet } from "./support/kabuk-checks.ts";

const OUT = process.env.T254_OUT ?? path.resolve(import.meta.dirname, "../../.artifacts/t-254");
const PHONES = [
  { name: "iphone13", width: 390, height: 664 }, // Playwright "iPhone 13" cihaz profili (Safari araç çubukları dahil görünür alan)
  { name: "iphone13-tam", width: 390, height: 844 }, // standalone / tam ekran
  { name: "android-360", width: 360, height: 740 },
  { name: "android-430", width: 430, height: 932 },
] as const;
const OLD_SHELL = ["app-bar", "bottom-nav", "tenant-bar", "screen-shell", "screen-nav", "field-action-bar"] as const;

async function selectCockpitPreference(page: Page): Promise<void> {
  await page.context().addCookies([{ name: "view", value: "cockpit", url: new URL(page.url()).origin }]);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-view", "cockpit");
}

/** Eski kabuk parçaları DOM'da yok; ortak alt cam çubuk görünür. */
async function expectNewShell(page: Page, where: string): Promise<void> {
  for (const old of OLD_SHELL) await expect(page.getByTestId(old), `${where}: eski ${old} yok`).toHaveCount(0);
  await expect(page.locator(".app-header"), `${where}: kök üst bar gizli`).toBeHidden();
  await expect(page.getByTestId("kabuk-dock"), `${where}: ortak alt cam çubuk`).toBeVisible();
}

/** Kokpit kart listesi: etkin kartlar bağlantı, kilitli/yakında kartlar bağlantı değil (gerekçe metniyle); kartlar ≥ 48 px, yatay taşma yok. */
async function expectCockpit(page: Page, where: string, counts: { active: number; locked: number; soon: number }): Promise<void> {
  const screen = page.getByTestId("kokpit");
  await expect(screen, `${where}: Kokpit liste kalıbında`).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: /^Merhaba / })).toBeVisible();
  const tasks = page.getByRole("list", { name: "İşler" });
  await expect(tasks.locator('a[data-state="active"]')).toHaveCount(counts.active);
  await expect(tasks.locator('[data-state="locked"]')).toHaveCount(counts.locked);
  await expect(tasks.locator('[data-state="soon"]')).toHaveCount(counts.soon);
  await expect(tasks.locator('a[data-state="soon"], a[data-state="locked"]')).toHaveCount(0);
  for (const key of ["count", "undo"] as const) await expect(tasks.locator('[data-state="soon"]').filter({ hasText: tr.home.tasks[key].title })).toContainText("Yakında");
  if (counts.locked > 0) await expect(tasks.locator('[data-state="locked"]').first()).toContainText(tr.home.lockedReason);
  for (const card of await tasks.locator("[data-state]").all()) expect((await card.boundingBox())?.height ?? 0, `${where}: kart yüksekliği`).toBeGreaterThanOrEqual(48);
  // T-979b (B-99): bütün ekran (üst çubuk Sorun / Destek / Hesap ve alt cam çubuk dahil).
  expect(await smallTargets(page, "body"), `${where}: 48 px altı dokunma hedefi`).toEqual([]);
  const m = await metrics(page);
  expect(m.scrollWidth, `${where}: yatay taşma yok`).toBeLessThanOrEqual(m.clientWidth);
  expect(m.scrollHeight, `${where}: sayfa gövdesi kaymaz (içerik alanı kayar)`).toBeLessThanOrEqual(m.innerHeight);
  await expectNewShell(page, where);
}

test("telefon kabuğu: Kokpit liste kalıbında, eski kabuk yok, uygulama menüsü; masaüstü ve yatay telefon", async ({ page, browser }, testInfo) => {
  mkdirSync(OUT, { recursive: true });
  const tag = testInfo.project.name;

  await page.setViewportSize({ width: PHONES[0].width, height: PHONES[0].height });
  await page.goto("/");
  await enterDemoReal(page, "Yönetici");
  await expect(page).toHaveURL(/\/t\/demo$/);
  // T-422: hesap sahibinin açılışı Pano (depo panosu); eski kabuk yok.
  await expect(page.locator("#main").getByTestId("pano")).toBeVisible();
  await expectNewShell(page, "pano");

  await selectCockpitPreference(page);
  for (const size of PHONES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/t/demo");
    await expectCockpit(page, size.name, { active: 7, locked: 0, soon: 2 });
    await page.screenshot({ path: path.join(OUT, `${tag}-${size.name}-kokpit.png`) });
  }

  // T-979c: Hesap menüsü — Kullanıcı değiştir, tema, Çıkış (eski "Tüm ekranlar" maddesi yok; tek çalışma alanında "Çalışma alanı değiştir" yok);
  // görünüm geçişi Modüller'de (İşlemler ↔ Genel bakış), hedefler ≥ 48 px.
  await page.setViewportSize({ width: 390, height: 664 });
  await page.goto("/t/demo");
  await openAccountMenu(page);
  const account = page.getByRole("menu", { name: "HESAP" });
  // T-1044: "Kullanıcı değiştir" kaldırıldı (Çıkış yap ile aynı işti); Çıkış yap her zaman menüde.
  await expect(account.getByRole("menuitem", { name: "Kullanıcı değiştir" })).toHaveCount(0);
  await expect(account.getByRole("menuitem", { name: "Çıkış yap" })).toBeVisible();
  await expect(account.getByRole("menuitem", { name: "Tüm ekranlar" })).toHaveCount(0);
  await expect(account.getByRole("menuitem", { name: "Çalışma alanı değiştir" })).toHaveCount(0);
  expect(await smallTargets(page, '[role="menu"]'), "hesap menüsü: 48 px altı dokunma hedefi").toEqual([]);
  await page.keyboard.press("Escape");
  await expect(account).toBeHidden();
  await selectView(page, "flow");
  await expect(page.locator("#main").getByTestId("pano")).toBeVisible();
  await selectView(page, "cockpit");
  await expect(page.getByTestId("kokpit")).toBeVisible();

  // İç ekran: üyeler ekranında gövde kaymaz, yalnız içerik alanı kayar, yatay taşma yok; eski kabuk yok.
  await page.goto("/t/demo/members");
  await expect(page.getByRole("heading", { level: 1, name: "Üyeler" })).toBeVisible();
  const inner = await metrics(page);
  expect(inner.scrollHeight, "üyeler: sayfa gövdesi kaymaz").toBeLessThanOrEqual(inner.innerHeight);
  expect(inner.scrollWidth, "üyeler: yatay taşma yok").toBeLessThanOrEqual(inner.clientWidth);
  await expectNewShell(page, "üyeler");

  // Sunucu/ağ hatası: çıkış başarısızsa neden menüde görünür.
  await page.goto("/t/demo");
  await openAccountMenu(page);
  await page.route("**/sign-out", (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
  await signOutItem(page).click();
  await expect(page.getByRole("menu", { name: "HESAP" }).getByRole("alert")).toBeVisible();
  await page.unroute("**/sign-out");
  await page.keyboard.press("Escape");

  // Masaüstü (1280x800): aynı Kokpit kalıbı; eski kök üst bar ve çalışma alanı satırı yok.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/t/demo");
  await expectCockpit(page, "masaüstü", { active: 7, locked: 0, soon: 2 });
  // T-1045 (STANDART §1): sabit açıklama yazısı yok; ad üst çubukta "Merhaba <ad>".
  await expect(page.getByText("Yapmak istediğin işe dokun.")).toHaveCount(0);
  await page.screenshot({ path: path.join(OUT, `${tag}-masaustu-kokpit.png`) });

  // T-292: aynı oturumla yatay telefon (dokunmatik) ve karşılaştırma boyutları.
  await landscapePhoneChecks(browser, page, tag);

  // Gerçek çıkış (Hesap menüsünden).
  await page.setViewportSize({ width: 390, height: 664 });
  await page.goto("/t/demo");
  await signOut(page);
});

// T-270 / T-979: role göre Kokpit kartları (toplayıcı: 4 etkin, 3 yetkisiz + gerekçe, 2 yakında) üç telefon boyutunda; "bekleyen iş yok"
// durumu (yönetici: "Şimdi" boş) ve Ürünler ekranı denetimleri. Rol başına ayrı demo girişi.
const T270_ROLES = [
  { label: "Yönetici", shot: "admin", counts: { active: 7, locked: 0, soon: 2 } },
  { label: "Toplayıcı", shot: "picker", counts: { active: 4, locked: 3, soon: 2 } },
] as const;

test("Kokpit role göre (T-270): etkin, yetkisiz ve yakında işler kartları; bekleyen iş yok; Ürünler ekranı", async ({ page }) => {
  const OUT_T270 = process.env.T270_OUT ?? path.resolve(import.meta.dirname, "../../.artifacts/t-270");
  mkdirSync(OUT_T270, { recursive: true });
  const tag = test.info().project.name;
  for (const role of T270_ROLES) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await enterDemoReal(page, role.label);
    await expect(page).toHaveURL(/\/t\/demo$/);
    // T-423: toplayıcının varsayılan açılışı Pano.
    if (role.shot === "picker") {
      await panoChecks(page);
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await selectCockpitPreference(page);
    for (const size of T270_SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto("/t/demo");
      const where = `${role.shot} ${size.width}x${size.height}`;
      await expectCockpit(page, where, role.counts);
      if (role.shot === "picker") {
        const locked = page.getByRole("list", { name: "İşler" }).locator('[data-state="locked"]');
        for (const name of ["Ekibimi yönet", "Ayarlar", "Kim ne yaptı?"]) await expect(locked.filter({ hasText: name })).toBeVisible();
      }
      await page.screenshot({ path: path.join(OUT_T270, `final-${tag}-${role.shot}-${size.width}-kokpit.png`) });
    }
    if (role.shot === "admin") {
      // T-280: "bekleyen iş yok" durumu dürüstçe söylenir (sayı uydurulmaz).
      await expect(page.getByTestId("now-card")).toHaveAttribute("data-state", "empty");
      await expect(page.getByTestId("now-empty")).toHaveText("Bekleyen iş yok");
      await itemsScreenChecks(page, { slug: "demo", empty: false });
    }
    await signOut(page);
  }
});

// T-292: yatay telefon. Demo girişi hız sınırlı olduğundan yeni giriş yapılmaz: T-254 testinin oturumu, dokunmatik + mobil yeni bağlama
// taşınır. Ölçülen değerler: Kokpit kalıbı, ortak alt cam çubuk, taşma. Görüntüler `.artifacts/t-292/` altına (git'e girmez).
const OUT_T292 = process.env.T292_OUT ?? path.resolve(import.meta.dirname, "../../.artifacts/t-292");

async function landscapePhoneChecks(browser: Browser, source: Page, tag: string): Promise<void> {
  mkdirSync(OUT_T292, { recursive: true });
  const { baseURL, ignoreHTTPSErrors, locale, extraHTTPHeaders } = test.info().project.use;
  const context = await browser.newContext({
    baseURL,
    ignoreHTTPSErrors,
    locale,
    extraHTTPHeaders,
    hasTouch: true,
    isMobile: true,
    storageState: await source.context().storageState(),
  });
  try {
    const page = await context.newPage();
    await context.addCookies([{ name: "view", value: "cockpit", url: new URL(source.url()).origin }]);
    const cases = [
      { name: "yatay-844x390", width: 844, height: 390 },
      { name: "yatay-740x360", width: 740, height: 360 },
      { name: "dikey-390x844", width: 390, height: 844 },
      { name: "masaustu-1280x800", width: 1280, height: 800 },
    ] as const;
    for (const c of cases) {
      await page.setViewportSize({ width: c.width, height: c.height });
      await page.goto("/t/demo");
      await expect(page.getByTestId("kokpit")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: /^Merhaba / })).toBeVisible();
      const m = await metrics(page);
      expect(m.scrollWidth, `${c.name}: yatay taşma yok`).toBeLessThanOrEqual(m.clientWidth);
      await expectNewShell(page, c.name);
      await page.screenshot({ path: path.join(OUT_T292, `${tag}-${c.name}.png`) });
    }
  } finally {
    await context.close();
  }
}

// T-422 (T-928'in yerine): Akış görünümünde hesap sahibinin ana ekranı Pano (depo panosu); ayrıntılı Kokpit ayrı tercih olarak kalır.
test("Pano hesap sahibi: rapor kartları, kaydırmasız telefon/tablet, ekip menüsü, Tüm ekranlar ve Kokpit geçişi", async ({ page }) => {
  await page.goto("/");
  await enterDemoShared(page, "Yönetici");
  await page.context().addCookies([{ name: "view", value: "flow", url: new URL(page.url()).origin }]);
  const reports = { critical: "/stock", orders: "/shipping", turn: "/stock", buy: "/stock", count: "/tasks?kind=COUNT" };
  for (const [width, height] of [[390, 844], [1024, 768], [1280, 800]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/t/demo");
    await expect(page.locator("html")).toHaveAttribute("data-view", "flow");
    const pano = page.locator("#main").getByTestId("pano");
    await expect(pano).toBeVisible();
    await expect(pano.locator("[data-report]")).toHaveCount(5);
    await expect(page.locator(".task-grid")).toHaveCount(0);
    for (const [key, href] of Object.entries(reports)) {
      const card = pano.locator(`[data-report="${key}"]`);
      await expect(card).toHaveAttribute("href", `/t/demo${href}`);
      await expect(card.locator("svg").first()).toHaveAttribute("aria-hidden", "true");
      const box = await card.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(48);
    }
    const m = await page.evaluate<{ sw: number; cw: number; ish: number; ich: number; ov: string }>(`(() => {
      const d = document.documentElement; const inner = document.querySelector('[data-testid="pano"] .inner');
      return { sw: d.scrollWidth, cw: d.clientWidth, ish: inner.scrollHeight, ich: inner.clientHeight, ov: getComputedStyle(inner).overflowY };
    })()`);
    expect(m.sw, `${width}: yatay taşma yok`).toBeLessThanOrEqual(m.cw);
    if (m.ov === "hidden") expect(m.ish, `${width}: içerik alanı taşmaz`).toBeLessThanOrEqual(m.ich + 1);
    // Ekip menüsü: Kullanıcılar bağlantısı; eski "Tüm ekranlar" yok (T-979c).
    await pano.getByTestId("home-actions").click();
    const team = pano.getByRole("menu", { name: "EKİP" });
    await expect(team.getByRole("menuitem", { name: "Kullanıcılar" })).toHaveAttribute("href", "/t/demo/team");
    await expect(team.getByRole("menuitem", { name: "Tüm ekranlar" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(team).toBeHidden();
  }
  await page.locator("#main").getByTestId("pano").locator('[data-report="orders"]').click();
  await expect(page).toHaveURL(/\/t\/demo\/shipping$/);
  await page.goto("/t/demo");
  await selectView(page, "cockpit");
  await expect(page.locator("#main").getByTestId("pano")).toHaveCount(0);
  await expect(page.getByRole("list", { name: "İşler" })).toBeVisible();
});

test("kolay Akış: salt okunur kullanıcıda dört yazma işi kilitli, stok okuma açık", async ({ page }) => {
  await page.goto("/");
  await enterDemoReal(page, "Salt okunur");
  await expect(page).toHaveURL(/\/t\/demo$/);
  await expect(page.getByRole("heading", { level: 1, name: "Ne yapmak istiyorsun?" })).toBeVisible();
  await page.context().addCookies([{ name: "view", value: "flow", url: new URL(page.url()).origin }]);
  await page.goto("/t/demo");
  const easy = page.locator("#main").getByTestId("easy-operations");
  await expect(easy.locator('[data-operation][data-state="locked"]')).toHaveCount(4);
  await expect(easy.locator('a[data-operation]')).toHaveCount(0);
  for (const card of await easy.locator('[data-operation]').all()) {
    await expect(card).toHaveAttribute("aria-disabled", "true");
  }
  // Plan dışı (manuel giriş/çıkış) yazma işidir: salt okuyana çizilmez.
  await expect(easy.locator("[data-manual]")).toHaveCount(0);
  // I-18 öncelik: yetkisiz eylem çizilmez — salt okuyan "Sorun bildir" görmez; ⚠ kutusunda Genel bakış ve Çıkış yap (T-979c, eski Menü yok).
  await page.locator("#main").getByTestId("home-actions").click();
  await expect(page.locator("#main").getByTestId("home-overview")).toBeVisible();
  await expect(page.locator("#main").getByTestId("home-signout")).toBeVisible();
  await expect(page.locator("#main").getByTestId("app-bar-menu")).toHaveCount(0);
  await expect(page.locator("#main").getByTestId("report-problem")).toHaveCount(0);
  // T-958 / T-979c: ortak alt çubuğun Modüller sayfası salt okuyana yönetici / yazma modüllerini göstermez; Stok durumu ve Genel bakış görünür.
  await page.goto("/t/demo/parties");
  await expectKabukBar(page, "kabuk-scan", "cariler salt okunur");
  await expectModulesSheet(page, ["home", "kokpit", "urun"], ["ekip", "excel", "abone", "etiket", "satin", "trans", "topla", "ayar"]);
  // Telefonda ilk sayfaya sığmayan modüller aramayla bulunur.
  await page.getByTestId("kabuk-mods").click();
  await page.getByTestId("kabuk-search").fill("Stok durumu");
  await expect(page.getByRole("dialog", { name: "Modüller" }).locator('[data-module="stok"]')).toHaveCount(1);
  await page.keyboard.press("Escape");
});
