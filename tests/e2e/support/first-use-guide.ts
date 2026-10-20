import { expect, type Page } from "@playwright/test";

/** Rehberi gerçek düğmeleriyle tamamlar; tercihi önceden yazmaz, modalı DOM'dan kaldırmaz. */
export async function completeFirstUseGuide(page: Page): Promise<void> {
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
  if (!await guide.isVisible()) return;
  await expect(guide.getByText("Adım 1 / 3", { exact: true })).toBeVisible();
  await guide.getByRole("button", { name: "Sonraki adım" }).click();
  await expect(guide.getByText("Adım 2 / 3", { exact: true })).toBeVisible();
  await guide.getByRole("button", { name: "Sonraki adım" }).click();
  await expect(guide.getByText("Adım 3 / 3", { exact: true })).toBeVisible();
  await guide.getByRole("button", { name: "Tamam, başlayalım" }).click();
  await expect(guide).not.toBeVisible();
}
