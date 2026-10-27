// T-423 (I-18): saha personelinin yeni ana ekranı (Pano.dc.html kabuğu). Toplayıcı oturumu AÇIKKEN çağrılır (ek demo girişi yok:
// demo girişi hız sınırlıdır). Ölçülenler: üst çubuk + alt cam çubuk görünür, yatay kaydırma yok, telefon/tablette içerik alanı taşmaz,
// Hesap menüsü cam kutusu açılır/kapanır, yüzen kısayol halkası açılır, görünüm geçişi (Genel bakış) Modüller'de (T-979c), tema kalıcıdır.
// Eşlik görüntüleri (açık/koyu × 390/1180/1440) test çıktısına yazılır.
import { expect, test, type Page } from "@playwright/test";

const SIZES = [
  { w: 390, h: 844 },
  { w: 1180, h: 820 },
  { w: 1440, h: 900 },
] as const;

export async function panoChecks(page: Page): Promise<void> {
  await page.context().clearCookies({ name: "view" });
  await page.goto("/t/demo");
  const pano = page.locator("#main").getByTestId("pano");
  await expect(pano).toBeVisible();
  await expect(page.locator("#main").getByTestId("easy-operations")).toHaveCount(0);

  for (const dark of [false, true]) {
    for (const s of SIZES) {
      await page.setViewportSize({ width: s.w, height: s.h });
      await page.goto("/t/demo");
      await expect(pano).toBeVisible();
      await expect(pano.locator(".top")).toBeVisible();
      // T-958: alt cam çubuk ortak bileşendir (Kabuk.dc.html), Pano kabının dışında çizilir.
      await expect(page.getByTestId("kabuk-dock")).toBeVisible();
      await expect(page.getByTestId("pano-scan")).toHaveAttribute("href", "/t/demo/field");
      await expect(pano.locator(".tasks > .tk, .counthero").first()).toBeVisible();
      const m = await page.evaluate<{ sw: number; cw: number; ish: number; ich: number; ov: string; dockBottom: number }>(`(() => {
        const d = document.documentElement;
        const inner = document.querySelector('[data-testid="pano"] .inner');
        const dock = document.querySelector('[data-testid="kabuk-dock"]').getBoundingClientRect();
        return { sw: d.scrollWidth, cw: d.clientWidth, ish: inner.scrollHeight, ich: inner.clientHeight, ov: getComputedStyle(inner).overflowY, dockBottom: dock.bottom };
      })()`);
      expect(m.sw, `${s.w}: yatay kaydırma yok`).toBeLessThanOrEqual(m.cw);
      expect(m.dockBottom, `${s.w}: alt çubuk ekranın içinde`).toBeLessThanOrEqual(s.h + 0.5);
      // Telefon/tablet kırılımında (`overflow: hidden`) içerik alanı taşmaz: kaydırma yok kuralı.
      if (m.ov === "hidden") expect(m.ish, `${s.w}: içerik alanı taşmaz`).toBeLessThanOrEqual(m.ich + 1);
      await page.screenshot({ path: test.info().outputPath(`pano-field-${dark ? "koyu" : "acik"}-${s.w}.png`) });
    }
    if (!dark) {
      // Hesap menüsü: cam kutu + perde; Esc kapatır.
      await pano.getByTestId("home-actions").click();
      // T-1080: Hesap menüsü sayfa kökünde (portal).
      const menu = page.getByRole("menu", { name: "HESAP" });
      await expect(menu).toBeVisible();
      await expect(menu.getByRole("menuitem", { name: "Çıkış yap" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      // Yüzen kısayol: dokununca halka açılır (T-1102: her ekranda, sayfa kökünde — portal).
      await page.getByTestId("pano-fab").click();
      const halo = page.getByRole("menu", { name: "Kısayollar" });
      await expect(halo).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(halo).toBeHidden();
      // T-979c: eski "Tüm ekranlar" maddesi yok; görünüm geçişi Modüller'de (her üye).
      await pano.getByTestId("home-actions").click();
      await expect(page.getByRole("menu", { name: "HESAP" }).getByRole("menuitem", { name: "Tüm ekranlar" })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await page.getByTestId("kabuk-mods").click();
      await expect(page.getByRole("dialog", { name: "Modüller" }).locator('[data-module="kokpit"]')).toBeVisible();
      await page.keyboard.press("Escape");
      // Tema: üst çubuktaki seçiciden karanlık (T-1044: masaüstünde menüde değil, üst çubukta).
      await pano.getByTestId("st-tema").getByRole("radio", { name: "Koyu tema" }).click();
      await expect(pano).toHaveClass(/dz-dark/);
    }
  }
  // Tema çerezde kalıcı; sonra açığa geri alınır (sonraki adımlar açık temayla sürer).
  await page.goto("/t/demo");
  await expect(pano).toHaveClass(/dz-dark/);
  await pano.getByTestId("st-tema").getByRole("radio", { name: "Açık tema" }).click();
  await expect(pano).not.toHaveClass(/dz-dark/);
}
