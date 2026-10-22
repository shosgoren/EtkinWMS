import { expect, type Page } from "@playwright/test";

/** Rehberi gerçek düğmeleriyle tamamlar; tercihi önceden yazmaz, modalı DOM'dan kaldırmaz. */
export async function completeFirstUseGuide(page: Page, opts: { readonly keepTour?: boolean } = {}): Promise<void> {
  const pathname = new URL(page.url()).pathname;
  if (pathname !== "/") {
    // T-1012: eski ilk rehber yalnız karşılama sayfasında kendiliğinden açılır; başka ekranda açık olmamalı. Çalışma alanında T-1006 turu kapatılır.
    await expect(page.locator(".guide-dialog")).not.toBeVisible();
    if (opts.keepTour !== true) await closeSetupTour(page);
    return;
  }
  // SSR'de kapalı gelen dialog, hydration sonrasında açılır. isVisible ile tek seferlik
  // kontrol bu açılışı kaçırabilir. Tercih yalnız okunur; yazmayı uygulama yapar.
  // T-970 (B-64c): eski `waitForFunction("() => {...}")` dizesi bir İFADE olarak değerlendirilip fonksiyon nesnesi döndürüyordu
  // (her zaman doğru) ve hiç beklemiyordu; yavaş CI'da rehber açılmadan dönülüyor, rehber sonraki ekranda açılıp kipli pencere
  // arka planı `inert` yaptığından `fill()` metni kayboluyordu. Dize ifadeyi sayfada yoklamak CSP `unsafe-eval` ister; bu yüzden
  // her yoklama `page.evaluate` (CDP, CSP dışı) ile çalışır.
  await expect.poll(() => page.evaluate<boolean>(`(() => {
    const dialog = document.querySelector(".guide-dialog");
    return dialog?.open === true || localStorage.getItem("etkinwms.guide.v1") === "seen";
  })()`), { timeout: 30_000 }).toBe(true);
  const guide = page.getByRole("dialog", { name: "Birlikte, adım adım." });
  if (!await guide.isVisible()) return opts.keepTour === true ? undefined : closeSetupTour(page);
  await expect(guide.getByText("Adım 1 / 3", { exact: true })).toBeVisible();
  await guide.getByRole("button", { name: "Sonraki adım" }).click();
  await expect(guide.getByText("Adım 2 / 3", { exact: true })).toBeVisible();
  await guide.getByRole("button", { name: "Sonraki adım" }).click();
  await expect(guide.getByText("Adım 3 / 3", { exact: true })).toBeVisible();
  await guide.getByRole("button", { name: "Tamam, başlayalım" }).click();
  await expect(guide).not.toBeVisible();
  if (opts.keepTour !== true) await closeSetupTour(page);
}

/**
 * T-1006: yeni kiracıda (hesap sahibi / yönetici) spotlight kurulum turu ilk girişte kendiliğinden başlar ve perdeyle ekranı kaplar. Bu yardımcıyı
 * kullanan spec'ler turu sınamaz: tur katmanı karar verene dek beklenir (`data-state` loading/wait değil), tur açıksa gerçek "Turu kapat"
 * düğmesiyle kapatılır. Katman yoksa (saha rolleri, kiracı dışı sayfa) hemen döner.
 */
export async function closeSetupTour(page: Page): Promise<void> {
  const layer = page.getByTestId("yol-layer");
  if ((await layer.count()) === 0) return;
  await expect.poll(async () => (await layer.getAttribute("data-state")) ?? "off", { timeout: 20_000 }).not.toMatch(/^(loading|wait)$/);
  // Otomatik başlatma sunucu yanıtını bekler: kısa süre "on" olabilir.
  await expect.poll(async () => {
    const st = await layer.getAttribute("data-state");
    if (st === "on") await page.getByTestId("yol-close").click();
    return st;
  }, { timeout: 20_000, intervals: [500, 1000, 1000, 2000] }).toBe("off");
}
