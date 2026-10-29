// T-1102 (kullanıcı 27 Ekim): yüzen kısayol (şimşek) her ekranda; Düzenle seçicisinde üyenin bütün modülleri (Modüller sayfasındaki
// bağlantılı kutular, yetkiyle süzülmüş). Seçilen kısayol halkada görünür ve ekranı açar.
import { expect, test, type Page } from "@playwright/test";
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


test.describe("T-1123 dokunmatik", () => {
  // Masaüstü projesinde de dokunmatik ekran (dokunuşun ardından gelen tıklama yeniden hedeflenir).
  test.use({ hasTouch: true });
  test("T-1123 şimşeğe dokununca halka açık kalır; yeniden dokununca kapanır", async ({ page }) => {
    await page.goto("/");
    await enterDemoShared(page, "Yönetici");
    await page.goto("/t/demo/items");
    const halka = page.getByRole("menu", { name: "Kısayollar" });
    await page.getByTestId("pano-fab").tap();
    await expect(halka).toBeVisible();
    // Dokunuşun ardından gelen tıklama perdeye düşüp halkayı kapatmamalı.
    await page.waitForTimeout(600);
    await expect(halka).toBeVisible();
    await page.getByTestId("pano-fab").tap();
    await expect(halka).toBeHidden();
  });
});

// T-1131 (kullanıcı 29 Ekim: "yüzen simge tıklandığında ekrana sığmayan yerler var, düzenle kısmı sığmıyor"): şimşek hangi konumda olursa
// olsun halka görünür alanın içinde; kısayollar ya görünür ya da halkanın içinde kaydırılarak erişilir; Rehber ve Düzenle kaydırmadan görünür.
const KONUMLAR = [
  { ad: "ust", fx: 0.94, fy: 0.08 },
  { ad: "orta", fx: 0.94, fy: 0.5 },
  { ad: "alt", fx: 0.94, fy: 0.9 },
  { ad: "orta-yatay", fx: 0.5, fy: 0.5 },
] as const;

type Kutu = { x: number; y: number; width: number; height: number };
const icinde = (k: Kutu, d: Kutu): boolean => k.x >= d.x - 0.5 && k.y >= d.y - 0.5 && k.x + k.width <= d.x + d.width + 0.5 && k.y + k.height <= d.y + d.height + 0.5;

async function halkaSigar(page: Page, konum: (typeof KONUMLAR)[number], resim?: string): Promise<void> {
  await page.evaluate(`window.localStorage.setItem("etkin-pano-fab", ${JSON.stringify(JSON.stringify({ fx: konum.fx, fy: konum.fy }))})`);
  await page.reload();
  const vp = page.viewportSize();
  if (vp === null) throw new Error("görüntü alanı yok");
  const ekran: Kutu = { x: 0, y: 0, width: vp.width, height: vp.height };
  await page.getByTestId("pano-fab").click();
  const halka = page.getByRole("menu", { name: "Kısayollar" });
  await expect(halka, konum.ad).toHaveAttribute("data-yan", /.+/);
  await page.evaluate(`Promise.all(document.querySelector('.kisayol-kok .halo').getAnimations({ subtree: true }).map((a) => a.finished)).then(() => true)`);
  const hk = await halka.boundingBox();
  expect(hk, konum.ad).not.toBeNull();
  expect(icinde(hk!, ekran), `${konum.ad}: halka ekranın içinde ${JSON.stringify(hk)}`).toBe(true);
  // Rehber ve Düzenle kaydırmadan görünür ve üstleri örtülü değil.
  for (const id of ["pano-guide", "pano-edit"]) {
    const oge = page.getByTestId(id);
    const k = await oge.boundingBox();
    expect(k, `${konum.ad}: ${id}`).not.toBeNull();
    expect(k!.height, `${konum.ad}: ${id} dokunma hedefi`).toBeGreaterThanOrEqual(48);
    expect(icinde(k!, ekran) && icinde(k!, hk!), `${konum.ad}: ${id} görünür ${JSON.stringify(k)}`).toBe(true);
    const ust = await page.evaluate<boolean>(
      `(() => { const el = document.querySelector('[data-testid="${id}"]'); if (el === null) return false;
        const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); })()`,
    );
    expect(ust, `${konum.ad}: ${id} örtülü değil`).toBe(true);
  }
  // Her kısayol görünür ya da halkanın listesinde kaydırılarak görünür olur (sayfa kaymaz).
  const liste = page.getByTestId("pano-fab-list");
  const ogeler = liste.locator('[role="menuitem"]');
  await expect(ogeler).toHaveCount(6);
  // Bu ekran ölçülerinde (en kısası 390×660) 6 kısayol kaydırmasız sığar: yanda tek sütun, dar ekranın ortasında iki sütunlu sıkı düzen.
  expect(await liste.evaluate((el) => el.scrollHeight <= el.clientHeight + 1), `${konum.ad}: liste kaydırmasız`).toBe(true);
  // Her şey göründüğünde alt kenar solmaz (solma yalnız aşağıda gizli kısayol varken).
  await expect(liste, `${konum.ad}: solma yok`).not.toHaveClass(/tasar/);
  if (resim !== undefined) await page.screenshot({ path: resim, animations: "disabled" });
  for (let i = 0; i < 6; i++) {
    const oge = ogeler.nth(i);
    await oge.scrollIntoViewIfNeeded();
    const k = await oge.boundingBox();
    const lk = await liste.boundingBox();
    expect(k !== null && lk !== null && icinde(k, ekran) && icinde(k, lk), `${konum.ad}: kısayol ${i + 1} erişilir`).toBe(true);
  }
  expect(await page.evaluate<number>("document.scrollingElement ? document.scrollingElement.scrollTop : 0"), `${konum.ad}: sayfa kaymadı`).toBe(0);
  await page.keyboard.press("Escape");
  await expect(halka).toBeHidden();
}

test("T-1131 şimşek halkası her konumda ekrana sığar; Rehber ve Düzenle hep görünür; klavyeyle açılır, Esc odağı şimşeğe döndürür", async ({ page }) => {
  await page.goto("/");
  await enterDemoShared(page, "Yönetici");
  await page.goto("/t/demo/items");
  for (const konum of KONUMLAR) await halkaSigar(page, konum);
  // Klavye: Enter halkayı açar ve ilk kısayola odaklanır; ok tuşu gezinir; Esc kapatır ve odak şimşeğe döner.
  await page.getByTestId("pano-fab").focus();
  await page.keyboard.press("Enter");
  const halka = page.getByRole("menu", { name: "Kısayollar" });
  await expect(halka).toBeVisible();
  await expect(halka.locator('[role="menuitem"]').first()).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByTestId("pano-edit")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(halka).toBeHidden();
  await expect(page.getByTestId("pano-fab")).toBeFocused();
});

test.describe("T-1131 kısa telefon (Safari çubukları açık)", () => {
  test.use({ viewport: { width: 390, height: 660 }, hasTouch: true });
  test("T-1131 390×660: şimşek üstte, ortada, altta — halka sığar, kısayollar kayar, Rehber ve Düzenle görünür", async ({ page }, info) => {
    await page.goto("/");
    await enterDemoShared(page, "Yönetici");
    await page.goto("/t/demo/items");
    for (const konum of KONUMLAR) await halkaSigar(page, konum, `tests/.artifacts/t-1131/${info.project.name}-390x660-${konum.ad}.png`);
    // Dokunuşla açılır ve açık kalır (T-1123 korunur).
    await page.getByTestId("pano-fab").tap();
    const halka = page.getByRole("menu", { name: "Kısayollar" });
    await page.waitForTimeout(600);
    await expect(halka).toBeVisible();
    await page.getByTestId("pano-fab").tap();
    await expect(halka).toBeHidden();
  });
});
