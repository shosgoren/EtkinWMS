import { expect, type Page } from "@playwright/test";

/** Rehberi gerçek düğmeleriyle tamamlar; tercihi önceden yazmaz, modalı DOM'dan kaldırmaz. */
export async function completeFirstUseGuide(page: Page): Promise<void> {
  // SSR'de kapalı gelen dialog, hydration sonrasında açılır. isVisible ile tek seferlik
  // kontrol bu açılışı kaçırabilir. Tercih yalnız okunur; yazmayı uygulama yapar.
  await page.waitForFunction(`() => {
    const dialog = document.querySelector(".guide-dialog");
    return dialog?.open || localStorage.getItem("etkinwms.guide.v1") === "seen";
  }`);
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
