// T-969 (B-86): OKUT doğrudan okutma ekranını açar; eski "Saha" iş seçme menüsü (Kabul / Yerleştirme / Toplama kartları) yoktur.
// Tek kısa akış: alt çubuktaki OKUT → kamera alanı + "Okut ya da söyle" + NFC / Kodu yaz; yazılan tanınmayan kod kırmızı sonuç ve
// "tekrar okut" verir (stok değişmez, kayıt yazılmaz). Kod çözmenin kendisi entegrasyon testindedir (field-scan.int.test.ts).
import { expect, test } from "@playwright/test";
import { enterDemoShared } from "./support/demo-session.ts";

test("OKUT doğrudan okutma açar; menü yok", async ({ page }) => {
  await page.goto("/");
  await enterDemoShared(page, "Yönetici");
  await expect(page).toHaveURL(/\/t\/demo$/);
  // Alt çubuktaki OKUT doğrudan /field'a gider (ara menü yok).
  await page.getByTestId("pano-scan").filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/t\/demo\/field$/);

  const screen = page.getByTestId("okut-screen");
  await expect(screen).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Okut" })).toBeVisible();
  await expect(page.getByTestId("okut-camera")).toBeVisible();
  // Kamera hemen açılmaya çalışır: ya tarıyor ya da izin/kamera rehberi gösteriyor (bu tarayıcıda kamera yok).
  await expect(screen).toHaveAttribute("data-camera", /^(starting|scanning|failed)$/);
  await expect(page.getByText("Okut ya da söyle")).toBeVisible();
  await expect(page.getByTestId("okut-nfc")).toBeVisible();
  await expect(page.getByTestId("okut-type")).toBeVisible();
  // Eski iş seçme menüsü yok: kilitli "Toplama" gibi kartlar listelenmez.
  await expect(page.getByRole("list", { name: "Saha işleri" })).toHaveCount(0);
  await expect(page.getByText("Toplama", { exact: true })).toHaveCount(0);

  // Kodu yaz → tanınmayan kod: kırmızı sonuç + tekrar okut.
  await page.getByTestId("okut-type").click();
  await page.getByTestId("okut-code").fill(`YOK-${Date.now()}`);
  await page.getByTestId("okut-code-go").click();
  await expect(page.getByTestId("saha-verdict")).toHaveAttribute("data-ok", "false");
  await expect(page.getByTestId("okut-unknown")).toContainText("Bu kod sistemde yok.");
  await page.getByTestId("okut-rescan").click();
  await expect(screen).toHaveAttribute("data-state", "idle");
  expect(await page.evaluate<boolean>("document.documentElement.scrollWidth <= window.innerWidth")).toBe(true);
});
