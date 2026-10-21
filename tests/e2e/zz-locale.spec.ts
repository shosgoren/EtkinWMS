// T-999c: Ayarlar > Dil çalışma alanının arayüz dilidir. English seçilip kaydedilince Ürünler ekranı ve alt çubuk İngilizce olur; sonra
// Türkçe'ye geri dönülür (demo alanı paylaşılır: geri dönüş `finally` içindedir). Tarayıcı dili (Playwright `tr-TR`) bilerek Türkçe kalır:
// çalışma alanı dili tarayıcı dilinden önce gelir.
import { expect, test, type Page } from "@playwright/test";
import en from "../../apps/web/messages/en.json" with { type: "json" };
import tr from "../../apps/web/messages/tr.json" with { type: "json" };
import { enterDemoShared } from "./support/demo-session.ts";

async function pickLocale(page: Page, locale: "tr" | "en"): Promise<void> {
  await page.goto("/t/demo/settings");
  await page.getByTestId("settings-locale").click();
  const editor = page.getByTestId("settings-locale-editor");
  await expect(editor).toBeVisible();
  await editor.locator(`[data-option="${locale}"]`).click();
  await page.keyboard.press("Escape"); // telefonda alt sayfa perdesi Kaydet'i örter
  await expect(editor).toHaveCount(0);
  const save = page.getByTestId("settings-save");
  if (await save.isDisabled()) return; // zaten bu dilde
  await save.click();
  await page.waitForURL(/[?&](saved|unchanged)=1/);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}

async function expectProducts(page: Page, m: typeof en | typeof tr, locale: "tr" | "en"): Promise<void> {
  await page.goto("/t/demo/items");
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.getByRole("heading", { level: 1, name: m.items.title })).toBeVisible();
  await expect(page.getByTestId("kabuk-home")).toHaveAttribute("aria-label", m.kabuk.home);
  await expect(page.getByTestId("kabuk-back")).toHaveAttribute("aria-label", m.kabuk.back);
  await expect(page.getByTestId("kabuk-mods")).toContainText(m.kabuk.modsShort);
}

test.describe("çalışma alanı dili (T-999c)", () => {
  test("English seçilince Ürünler ve alt çubuk İngilizce; Türkçe'ye geri dönülür", async ({ page }) => {
    await enterDemoShared(page, "Yönetici");
    try {
      await pickLocale(page, "en");
      await expectProducts(page, en, "en");
      await page.getByTestId("kabuk-mods").click();
      await expect(page.getByTestId("kabuk-sheet")).toHaveAttribute("aria-label", en.kabuk.mods);
      await page.getByTestId("kabuk-mods-close").click();
    } finally {
      await pickLocale(page, "tr");
    }
    await expectProducts(page, tr, "tr");
  });
});
