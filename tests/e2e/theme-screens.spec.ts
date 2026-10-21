import { completeFirstUseGuide } from "./support/first-use-guide.ts";
// T-246b: güven paleti ekran kanıtı (ADR-020). 375x812 ve 1280x800; Akış ve Kokpit; landing + demo girişi sonrası ana ekran.
// Piksel karşılaştırma yok: hesaplanan stil değerleri belirteçlerle eşlenir, ekran görüntüleri .artifacts/t-246b/ altına yazılır.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { enterDemoShared } from "./support/demo-session.ts";
import { appMenuReachable, openAppMenu } from "./support/app-menu.ts";

const OUT = path.resolve(import.meta.dirname, "../../.artifacts/t-246b");
const SIZES = [
  { width: 375, height: 812 },
  { width: 1280, height: 800 },
] as const;
const VIEWS = [
  { key: "flow", label: "İşlemler" },
  { key: "cockpit", label: "Genel bakış" },
] as const;

async function expectNoHorizontalOverflow(page: Page, where: string): Promise<void> {
  const m = await page.evaluate<{ scroll: number; client: number }>("({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth })");
  expect(m.scroll, `${where}: scrollWidth(${m.scroll}) <= clientWidth(${m.client})`).toBeLessThanOrEqual(m.client);
}

/** Belirtecin (`--color-*`) hesaplanan rengi: geçici öğeye uygulanıp `rgb()` biçimine çözülür. */
async function tokenColor(page: Page, token: string): Promise<string> {
  return page.evaluate<string>(
    `(() => { const e = document.createElement("i"); e.style.backgroundColor = "var(--color-${token})"; document.body.append(e); const c = getComputedStyle(e).backgroundColor; e.remove(); return c; })()`,
  );
}

async function selectView(page: Page, label: string): Promise<void> {
  // T-254: telefon genişliğinde görünüm anahtarı menüdedir; önce menü açılır, aynı düğme kullanılır (beklenen davranış aynı).
  const inMenu = await appMenuReachable(page);
  if (inMenu) await openAppMenu(page);
  const button = page.getByRole("button", { name: label, exact: true });
  await button.click();
  // T-988: Akış ana ekranında üst çubuk gizlenir (menü düğmesi Görevlerim başlığındadır); düğme DOM'da kalır, görünürlük şartı aranmaz.
  await expect(page.locator('button[name="view"]', { hasText: label }).first()).toHaveAttribute("aria-pressed", "true");
  if (inMenu) {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  }
}

async function expectFocusRing(page: Page, locator: ReturnType<Page["locator"]>, where: string, expected?: string): Promise<void> {
  await page.keyboard.press("Tab"); // klavye etkileşimi: :focus-visible tetiklenir
  await locator.focus();
  const style = await page.evaluate<{ style: string; color: string }>(
    "(() => { const s = getComputedStyle(document.activeElement); return { style: s.outlineStyle, color: s.outlineColor }; })()",
  );
  expect(style.style, `${where}: outline-style`).toBe("solid");
  expect(style.color, `${where}: outline-color = --color-focus`).toBe(expected ?? (await tokenColor(page, "focus")));
}

for (const size of SIZES) {
  test.describe(`güven paleti ${size.width}px`, () => {
    test.use({ viewport: size });

    test("Akış ve Kokpit: landing ve demo girişi sonrası ana ekran", async ({ page }) => {
      mkdirSync(OUT, { recursive: true });
      const accents: Record<string, string> = {};

      // Landing (oturumsuz): her iki görünümde. Demo girişi hız sınırlı olduğundan ana ekran için tek giriş yapılır.
      for (const view of VIEWS) {
        // Oturumsuz kabuk görünüm düğmesi sunmaz; kaydedilmiş yalnız görsel tercihi iki değerde sınarız.
        await page.context().addCookies([{ name: "view", value: view.key, url: new URL("/", page.url() === "about:blank" ? test.info().project.use.baseURL : page.url()).origin }]);
        await page.goto("/");
        await completeFirstUseGuide(page);
        await expect(page.getByRole("form", { name: "Görünüm" })).toHaveCount(0);
        await expect(page.locator("html")).toHaveAttribute("data-view", view.key);

        // Birincil düğme `accent` zeminli, odak halkası `focus`.
        const primary = page.getByRole("link", { name: "Giriş yap" });
        await expect(primary).toBeVisible();
        const accent = await tokenColor(page, "accent");
        await expect(primary).toHaveCSS("background-color", accent);
        await expectFocusRing(page, primary, `${view.key} landing`);
        accents[view.key] = accent;
        await expectNoHorizontalOverflow(page, `${view.key} ${size.width} landing`);
        await page.screenshot({ path: path.join(OUT, `${view.key}-${size.width}-landing.png`), fullPage: true });
      }

      // Demo girişi → ana ekran; görünüm anahtarı ile Kokpit sonra Akış.
      await enterDemoShared(page, "Yönetici");
      await expect(page).toHaveURL(/\/t\/demo$/);

      for (const view of [...VIEWS].reverse()) {
        await selectView(page, view.label);
        await expect(page.locator("html")).toHaveAttribute("data-view", view.key);
        // T-422: Akış görünümünde hesap sahibinin ana ekranı Pano (rapor kartları).
        const tasks = view.key === "flow" ? page.locator("#main").getByTestId("pano") : page.getByRole("list", { name: "İşler" });
        await expect(tasks).toBeVisible();
        if (view.key === "flow") await expect(tasks.locator("[data-report]")).toHaveCount(5);

        // Kart ikonları dekoratif; iki görünümde de (I-18; T-979 Kokpit liste kalıbında) tasarım kaynağının kendi SVG yolları (svg.ico).
        const icons = tasks.locator("svg.ico");
        expect(await icons.count(), "kart ikonları").toBeGreaterThanOrEqual(view.key === "flow" ? 5 : 9);
        await expect(icons.first()).toHaveAttribute("aria-hidden", "true");
        // T-902 marka kabı ink rengindedir; telefon uygulama çubuğu görünüm accent rengini korur.
        await expect(page.locator(".app-header > div:first-child > span")).toHaveCSS("background-color", await tokenColor(page, "ink"));
        const landingAccent = accents[view.key];
        if (landingAccent === undefined) throw new Error(`Eksik landing accent ölçümü: ${view.key}`);
        // T-979 (B-95): eski telefon uygulama çubuğu kaldırıldı; iki görünümde de ekranın kendi kalıp/Pano başlığı var.
        await expect(page.getByTestId("app-bar")).toHaveCount(0);
        await expect(page.locator("#main").getByTestId("home-actions")).toBeVisible();
        // I-18: Pano ve Kokpit (liste kalıbı) odak halkası tasarım kaynağındaki gibi 4 px sarı (#F4C542).
        await expectFocusRing(page, tasks.getByRole("link").first(), `${view.key} ana ekran`, "rgb(244, 197, 66)");
        await expectNoHorizontalOverflow(page, `${view.key} ${size.width} ana ekran`);
        await page.screenshot({ path: path.join(OUT, `${view.key}-${size.width}-ana-ekran.png`), fullPage: true });
      }

      expect(accents.cockpit, "Kokpit vurgusu Akış'tan farklı").not.toBe(accents.flow);
    });
  });
}
