// T-423 (I-18): saha personelinin yeni ana ekranı (Pano.dc.html kabuğu). Ölçülenler: üst çubuk + alt cam çubuk görünür, telefonda ve
// tablette sayfa kaymaz (yatay da dikey de), menü cam kutusu açılır/kapanır, yüzen kısayol halkası açılır, uygulama menüsüne
// ("Tüm ekranlar") ulaşılır, tema geçişi kalıcıdır. Eşlik görüntüleri (açık/koyu × 390/1180/1440) test çıktısına yazılır.
import { expect, test } from "@playwright/test";
import { enterDemoReal } from "./support/demo-session.ts";
import { openAppMenu } from "./support/app-menu.ts";

const SIZES = [
  { w: 390, h: 844, scroll: false },
  { w: 1180, h: 820, scroll: false },
  { w: 1440, h: 900, scroll: true },
] as const;

test("saha ana ekranı: Pano kabuğu, kaydırmasız telefon/tablet, menü, kısayol ve tema", async ({ page }, testInfo) => {
  await page.goto("/");
  await enterDemoReal(page, "Toplayıcı");
  await expect(page).toHaveURL(/\/t\/demo$/);
  const pano = page.locator("#main").getByTestId("pano");
  await expect(pano).toBeVisible();
  await expect(page.locator("#main").getByTestId("easy-operations")).toHaveCount(0);

  for (const dark of [false, true]) {
    for (const s of SIZES) {
      await page.setViewportSize({ width: s.w, height: s.h });
      await page.goto("/t/demo");
      await expect(pano).toBeVisible();
      await expect(pano.locator(".top")).toBeVisible();
      await expect(pano.locator(".dock")).toBeVisible();
      await expect(pano.getByTestId("pano-scan")).toHaveAttribute("href", "/t/demo/field");
      await expect(pano.locator(".tasks > .tk").first()).toBeVisible();
      const m = await page.evaluate<{ sw: number; cw: number; sh: number; ch: number; dockBottom: number }>(`(() => {
        const d = document.documentElement;
        const dock = document.querySelector('[data-testid="pano"] .dock').getBoundingClientRect();
        return { sw: d.scrollWidth, cw: d.clientWidth, sh: d.scrollHeight, ch: d.clientHeight, dockBottom: dock.bottom };
      })()`);
      expect(m.sw, `${s.w}: yatay kaydırma yok`).toBeLessThanOrEqual(m.cw);
      expect(m.dockBottom, `${s.w}: alt çubuk ekranın içinde`).toBeLessThanOrEqual(s.h + 0.5);
      if (!s.scroll) expect(m.sh, `${s.w}: dikey kaydırma yok`).toBeLessThanOrEqual(m.ch);
      await page.screenshot({ path: testInfo.outputPath(`pano-field-${dark ? "koyu" : "acik"}-${s.w}.png`) });
    }
    if (!dark) {
      // Hesap menüsü: cam kutu + perde; perdeye dokununca kapanır.
      await page.getByTestId("home-actions").click();
      const menu = pano.getByRole("menu", { name: "HESAP" });
      await expect(menu).toBeVisible();
      await expect(menu.getByRole("menuitem", { name: "Çıkış yap" })).toBeVisible();
      await pano.locator(".hback").click({ position: { x: 10, y: 10 } });
      await expect(menu).toBeHidden();
      // Yüzen kısayol: dokununca halka açılır.
      await pano.getByTestId("pano-fab").click();
      await expect(pano.getByRole("menu", { name: "Kısayollar" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(pano.getByRole("menu", { name: "Kısayollar" })).toBeHidden();
      // Uygulama menüsü (tüm ekranlar) erişilebilir.
      await openAppMenu(page);
      await expect(page.getByRole("dialog", { name: "Menü" })).toBeVisible();
      await page.keyboard.press("Escape");
      // Tema: menüden karanlık; çerez kalıcı.
      await page.getByTestId("home-actions").click();
      await pano.getByTestId("pano-menu-theme").click();
      await expect(pano).toHaveClass(/dz-dark/);
      await page.keyboard.press("Escape");
    }
  }
  await page.goto("/t/demo");
  await expect(pano).toHaveClass(/dz-dark/);
  // Temayı geri al (sonraki testler açık temayla başlar).
  await page.getByTestId("home-actions").click();
  await pano.getByTestId("pano-menu-theme").click();
  await expect(pano).not.toHaveClass(/dz-dark/);
});
