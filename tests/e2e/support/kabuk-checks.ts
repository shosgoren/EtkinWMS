// T-958 (I-18, Kabuk.dc.html): ortak alt cam çubuk ve Modüller sayfası. Oturum AÇIKKEN çağrılır (ek demo girişi yok).
// Ölçülenler (390 / 1180 / 1440): çubukta 5 yuva görünür ve ekranın içinde, ana işlem en üstte (dokunuş testi), yatay taşma yok;
// Modüller sayfası açılır, X / perde / Esc ile kapanır, arama süzer. Eşlik görüntüleri test çıktısına yazılır.
import { expect, test, type Page } from "@playwright/test";

export const KABUK_SIZES = [
  { w: 390, h: 844 },
  { w: 1180, h: 820 },
  { w: 1440, h: 900 },
] as const;

/** Giriş animasyonlarını (kaynak `pop`, `rise`) bitirir: eşlik görüntüsü ara karede alınmasın. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate("document.getAnimations().forEach((a) => { if (a.effect && a.effect.getTiming().iterations !== Infinity) a.finish(); })");
}

/** Çubuk ölçüleri: 5 yuva, ekran içinde, soldan sağa sıralı; ana işlem dokunuşta en üstte; yatay taşma yok. */
export async function expectKabukBar(page: Page, mainTestId: string, where: string): Promise<void> {
  const dock = page.getByTestId("kabuk-dock");
  await expect(dock).toBeVisible();
  const m = await page.evaluate<{ n: number; boxes: Array<{ l: number; r: number; t: number; b: number }>; vw: number; vh: number; sw: number; cw: number; hit: boolean }>(`(() => {
    const slots = [...document.querySelectorAll('[data-testid="kabuk-dock"] .dockin > *')];
    const boxes = slots.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; });
    const main = document.querySelector('[data-testid="${mainTestId}"]').getBoundingClientRect();
    const top = document.elementFromPoint(main.left + main.width / 2, main.top + main.height / 2);
    return { n: slots.length, boxes, vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
      hit: top !== null && top.closest('[data-testid="${mainTestId}"]') !== null };
  })()`);
  expect(m.n, `${where}: 5 yuva`).toBe(5);
  for (const [i, b] of m.boxes.entries()) {
    expect(b.r - b.l, `${where}: yuva ${i} genişliği`).toBeGreaterThanOrEqual(44);
    expect(b.b, `${where}: yuva ${i} ekranın içinde`).toBeLessThanOrEqual(m.vh + 0.5);
    expect(b.l, `${where}: yuva ${i} solda taşmaz`).toBeGreaterThanOrEqual(0);
    expect(b.r, `${where}: yuva ${i} sağda taşmaz`).toBeLessThanOrEqual(m.vw + 0.5);
    if (i > 0) expect(b.l, `${where}: yuva sırası`).toBeGreaterThanOrEqual((m.boxes[i - 1]?.r ?? 0) - 0.5);
  }
  if (m.vw >= 1100) expect((m.boxes[4]?.r ?? 0) - (m.boxes[0]?.l ?? 0), `${where}: masaüstünde ortalı hap ≤ 720 px`).toBeLessThanOrEqual(720);
  expect(m.hit, `${where}: ana işlem dokunuşta en üstte`).toBe(true);
  expect(m.sw, `${where}: yatay taşma yok`).toBeLessThanOrEqual(m.cw);
}

/** Modüller sayfası: açılır; arama süzer; X, perde ve Esc kapatır. `mustSee` / `mustNotSee`: modül kimlikleri. */
export async function expectModulesSheet(page: Page, mustSee: readonly string[], mustNotSee: readonly string[], shot?: string): Promise<void> {
  const mods = page.getByTestId("kabuk-mods");
  const sheet = page.getByRole("dialog", { name: "Modüller" });
  await mods.click();
  await expect(sheet).toBeVisible();
  await expect(mods).toHaveAttribute("aria-expanded", "true");
  await expect(sheet).toBeFocused();
  for (const id of mustSee) await expect(sheet.locator(`[data-module="${id}"]`), `modül ${id} görünür`).toHaveCount(1);
  for (const id of mustNotSee) await expect(sheet.locator(`[data-module="${id}"]`), `modül ${id} görünmez`).toHaveCount(0);
  // Telefon/tablette sayfa kaymaz: ızgara kendi içinde taşmaz.
  const ov = await sheet.evaluate((e) => e.scrollHeight - e.clientHeight);
  expect(ov, "Modüller sayfası taşmaz").toBeLessThanOrEqual(1);
  if (shot !== undefined) await settle(page);
  if (shot !== undefined) await page.screenshot({ path: test.info().outputPath(shot) });
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await mods.click();
  await page.getByTestId("kabuk-search").fill("zzqx");
  await expect(sheet.getByText("Bulunamadı · ara ya da söyle")).toBeVisible();
  await page.getByTestId("kabuk-mods-close").click();
  await expect(sheet).toBeHidden();
  await mods.click();
  await expect(sheet).toBeVisible();
  await page.getByTestId("kabuk-mods-back").click({ position: { x: 8, y: 8 } });
  await expect(sheet).toBeHidden();
}
