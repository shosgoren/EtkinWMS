// T-1006: ilk kurulum SPOTLIGHT TURU uçtan uca (kullanıcı kararı 22 Ekim). Yeni kiracı (kayıt + MFA ile kurulmuş kendi alanı, `E2E_TOUR`)
// girişte turu görür → ortak buzlu perde (`backdrop-filter` + karartma) → "Ekranı aç" ile Ürünler → yalnız Excel düğmesi delikte görünür,
// dokunulabilir ve nabız halkalı; balon ekran içinde (390 / 1180 / 1440, dokunma ≥ 44 px) → ← / → klavye → Atla (sıradaki adım, Geri al balonu)
// → Turu kapat → Pano küçük halkasından adım listesi → "Başla" turu tekrar açar → Esc kapatır → Destek › Rehberi aç da turu açar.
// Masaüstü ve mobil projeler aynı alanı kullanır (CI'da ayrı veritabanları): ikinci yerel koşuda tur kapalı olabilir; o zaman halkadan açılır
// (veri temelli, ortam atlaması değil). Alanı ve e-postayı başka spec kullanmaz (giriş sınırı paylaşılmaz).
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { expectTouchTargets } from "./support/dokunma.ts";
import { KABUK_SIZES, settle } from "./support/kabuk-checks.ts";
import { localClient, loginEmptyTenant, scrubSecretInputs } from "./support/empty-tenant.ts";

// Ekran görüntüleri yalnız yerel kanıt (`.artifacts/t-1006/`, git'e girmez).
const OUT = path.resolve(import.meta.dirname, "../../.artifacts/t-1006");

/** Perdenin bulanıklığı + karartması ve hedefin perde üstünde, görünür ve dokunulabilir olması. */
async function expectSpot(page: Page, target: string): Promise<void> {
  // Delik boyut değişiminden sonra yeniden ölçülür (≤ 300 ms): hedef perde üstünde olana dek beklenir.
  await expect
    .poll(
      () =>
        page.evaluate<boolean>(`(() => {
      const e = document.querySelector(${JSON.stringify(target)});
      // T-1012: iç bağlantılar istemci içi (önceden yükleme): adres hemen değişir, ekran iskeletteyken hedef henüz yoktur.
      if (e === null) return false;
      const b = e.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return hit !== null && e.contains(hit);
    })()`),
      { message: `${target} perde üstünde`, timeout: 5000 },
    )
    .toBe(true);
  const r = await page.evaluate<{ blur: string; bg: string; onTop: boolean; inView: boolean }>(`(() => {
    const all = document.querySelectorAll('[data-testid="kalip-perde"]');
    const cs = getComputedStyle(all[all.length - 1]);
    const e = document.querySelector(${JSON.stringify(target)});
    const b = e.getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return { blur: cs.backdropFilter, bg: cs.backgroundColor, onTop: hit !== null && e.contains(hit), inView: b.top >= 0 && b.bottom <= innerHeight };
  })()`);
  expect(r.blur).toContain("blur(8px)");
  expect(r.bg).not.toBe("rgba(0, 0, 0, 0)");
  expect(r.inView).toBe(true);
  expect(r.onTop).toBe(true);
}

/** Telefon / tablet / masaüstü: balon ekran içinde, yatay taşma yok, balondaki dokunma hedefleri ≥ 44 px; hedef delikte kalır. */
async function measureTip(page: Page, target: string): Promise<void> {
  const original = page.viewportSize();
  for (const { w, h } of KABUK_SIZES) {
    await page.setViewportSize({ width: w, height: h });
    await settle(page);
    await expect
      .poll(
        () =>
          page.evaluate<string>(`(() => {
      const c = document.querySelector('[data-testid="yol-coach"]');
      const r = c.getBoundingClientRect();
      const ok = r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && c.scrollWidth <= c.clientWidth + 1;
      return ok && document.documentElement.scrollWidth <= document.documentElement.clientWidth ? "ok" : Math.round(r.left) + "," + Math.round(r.top) + "," + Math.round(r.right) + "," + Math.round(r.bottom);
    })()`),
        { message: `balon ${w}: ekran içinde`, timeout: 5000 },
      )
      .toBe("ok");
    await expectTouchTargets(page, 44, `balon ${w}`, '[data-testid="yol-coach"]');
    await expectSpot(page, target);
  }
  if (original !== null) await page.setViewportSize(original);
}

if (!process.env.E2E_BASE_URL?.trim()) {
  test.use({ ...localClient("198.51.100.29"), trace: "off" });
  test.afterEach(async ({ page }) => {
    await scrubSecretInputs(page);
  });

  test("T-1006: yeni kiracı → tur başlar → perde + parlayan hedef → Atla → kapat → Pano halkasından tekrar aç", async ({ page }, info) => {
    test.setTimeout(180_000);
    mkdirSync(OUT, { recursive: true });
    const shot = (name: string) => page.screenshot({ path: path.join(OUT, `${info.project.name}-${name}.png`) });
    const { slug } = await loginEmptyTenant(page, "tour", { keepTour: true });
    const layer = page.getByTestId("yol-layer");
    const coach = page.getByTestId("yol-coach");
    await expect.poll(async () => layer.getAttribute("data-state"), { timeout: 20_000 }).toMatch(/^(on|off)$/);
    if ((await layer.getAttribute("data-state")) === "off") {
      // İkinci yerel koşu: tur önceden kapatıldı → Pano halkası → adım listesi → Başla.
      await page.getByTestId("yol-card").click();
      await page.locator('[data-testid^="yol-start-"]').first().click();
    }
    // Tur başladı: ilk adım, gerçek ekranı açmayı önerir.
    await expect(coach).toBeVisible();
    await expect(coach).toHaveAttribute("role", "dialog");
    await expect(coach).toHaveAttribute("aria-live", "polite");
    await expect(page.getByTestId("yol-step-no")).toContainText(/ADIM \d\/\d/);
    await shot("tur-baslar");
    const step0 = await coach.getAttribute("data-step");
    if ((await coach.getAttribute("data-state")) === "go") await page.getByTestId("yol-open").click();
    await expect(coach).toHaveAttribute("data-state", "open");
    await expect(page.getByTestId("yol-hole")).toBeVisible();

    if (step0 === "cards") {
      // Adım 1: Ürünler ekranında yalnız Excel düğmesi delikte, net ve dokunulabilir; stok sorusu balonda.
      await expect(page).toHaveURL(new RegExp(`/t/${slug}/items`));
      await expectSpot(page, '[data-tour="excel"]');
      await shot("tur-excel");
      await measureTip(page, '[data-tour="excel"]');
      if (await page.getByTestId("yol-stockq").isVisible()) {
        await page.getByTestId("yol-stock-no").click();
        await expect(page.getByTestId("yol-stockq")).toBeHidden();
      }
      // Hedef gerçekten tıklanabilir: Excel menüsü açılır ve delikte kalır; "İçeri al" → Excel'den aktar, tur aynı adımda Dosya seç'i gösterir.
      await page.locator('[data-tour="excel"]').click();
      await expect(page.getByTestId("kalip-excel-menu")).toBeVisible();
      await expectSpot(page, '[data-testid="kalip-excel-import"]');
      await page.getByTestId("kalip-excel-import").click();
      await expect(page).toHaveURL(new RegExp(`/t/${slug}/import`));
      await expect(coach).toHaveAttribute("data-step", "cards");
      await expect(coach).toHaveAttribute("data-state", "open");
      await expectSpot(page, '[data-tour="main"]');
      await shot("tur-dosya-sec");
    }

    // Klavye: → İleri, ← Geri.
    const before = (await coach.getAttribute("data-step")) ?? "";
    await page.keyboard.press("ArrowRight");
    await expect(coach).not.toHaveAttribute("data-step", before);
    await page.keyboard.press("ArrowLeft");
    await expect(coach).toHaveAttribute("data-step", before);

    // Atla: adım atlanır, tur sıradaki adıma geçer; "Geri al" balonu.
    const skipped = (await coach.getAttribute("data-step")) ?? "";
    await page.getByTestId("yol-skip").click();
    await expect(page.getByTestId("kalip-toast")).toContainText("atlandı");
    await expect(page.getByTestId("balon-eylem")).toContainText("Geri al");
    await expect(coach).not.toHaveAttribute("data-step", skipped);

    // Turu kapat: perde kalkar; Pano'da küçük halka kalır.
    await page.getByTestId("yol-close").click();
    await expect(coach).toBeHidden();
    await expect(page.getByTestId("kalip-perde")).toHaveCount(0);
    await page.goto(`/t/${slug}`);
    await expect.poll(async () => layer.getAttribute("data-state")).toBe("off");
    const ring = page.getByTestId("yol-card");
    await expect(ring).toBeVisible();
    await shot("pano-halka");

    // Halkadan adım listesi (ikincil): atlanan adım işaretli, Geri al ile geri gelir; Başla turu o adımdan tekrar açar.
    await ring.click();
    const sheet = page.getByTestId("yol-sheet");
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId(`yol-step-${skipped}`)).toHaveAttribute("data-state", "skipped");
    await page.getByTestId(`yol-unskip-${skipped}`).click();
    await expect(page.getByTestId(`yol-step-${skipped}`)).not.toHaveAttribute("data-state", "skipped");
    await page.getByTestId(`yol-start-${skipped}`).click();
    await expect(sheet).toBeHidden();
    await expect(coach).toBeVisible();
    await expect(coach).toHaveAttribute("data-step", skipped);

    // Esc turu kapatır; Destek › Rehberi aç turu yeniden açar (eski 3 adımlı rehber açılmaz).
    await page.keyboard.press("Escape");
    await expect(coach).toBeHidden();
    await page.goto(`/t/${slug}`);
    await expect.poll(async () => layer.getAttribute("data-state")).toBe("off");
    await page.getByTestId("pano-help").click();
    await page.getByTestId("support-guide").click();
    await expect(coach).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Birlikte, adım adım." })).toBeHidden();
    await page.getByTestId("yol-close").click();
    await expect(coach).toBeHidden();
  });
}
