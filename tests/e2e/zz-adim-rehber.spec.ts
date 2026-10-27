// T-1095 (kullanıcı 27 Ekim): "Nasıl kullanırım?" adım adım rehberi — ekran bulanıklaşır, yalnız yapılacak yer açık kalır; kullanıcı işi
// yapınca kendiliğinden ilerler ("İleri" yok). Bulanık alana dokununca serbest bırakır, küçük yüzen simge kalır: kaldığın yerden / baştan.
import { expect, test } from "@playwright/test";
import { enterDemoShared } from "./support/demo-session.ts";
import { csv } from "./support/import-screen.ts";

test("T-1095 Ürünleri Excel ile aktar: odaklanır, işi yapınca ilerler, serbest bırakır ve baştan / kaldığı yerden devam eder", async ({ page }) => {
  await page.goto("/");
  await enterDemoShared(page, "Yönetici");
  await page.goto("/t/demo/settings/baglantilar");
  await page.getByTestId("operation-guide-trigger").first().click();
  await expect(page.getByTestId("guide-picker")).toBeVisible();
  // Uzun seçim listesinde satırlar ezilip üst üste binmez (liste kayar).
  const satirlar = await page.locator('[data-testid="guide-picker"] .yst').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return [r.top, r.bottom]; }));
  expect(satirlar.length).toBeGreaterThan(3);
  for (let i = 1; i < satirlar.length; i++) expect(satirlar[i]![0]).toBeGreaterThanOrEqual(satirlar[i - 1]![1] - 0.5);
  await page.getByTestId("adim-basla-urun-EXCEL").click();

  const rehber = page.getByTestId("adim-rehber");
  const perde = page.getByTestId("kalip-perde");
  await expect(rehber).toHaveAttribute("data-step", "alan_urun");
  await expect(rehber).not.toContainText("İleri");
  // Perde bütün ekranı örter ama hedefin çevresi açıktır (delik).
  await expect(perde).toBeVisible();
  await expect(perde).toHaveAttribute("style", /polygon\(evenodd/);

  // Kullanıcı işi yapar → rehber kendiliğinden ilerler.
  await page.getByTestId("baglantilar-alan").locator('[data-option="items"]').click();
  await expect(rehber).toHaveAttribute("data-step", "iceri");
  await page.getByTestId("baglantilar-islem").locator('[data-option="import"]').click();
  await expect(rehber).toHaveAttribute("data-step", "ana");

  // Bulanık alana dokunmak serbest bırakır: küçük yüzen simge.
  await perde.click({ position: { x: 4, y: 4 } });
  await expect(perde).toHaveCount(0);
  await expect(page.getByTestId("adim-devam")).toBeVisible();
  await expect(page.getByTestId("adim-devam")).toContainText("3/6");
  await page.getByTestId("adim-devam").click();
  await expect(rehber).toHaveAttribute("data-step", "ana");

  // Ana düğme → Aktar ekranı; rehber dosya adımına geçer.
  await page.getByTestId("baglantilar-main").filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/t\/demo\/import\?tur=urun/);
  await expect(rehber).toHaveAttribute("data-step", "dosya");

  // Tek sayfalı dosya (sayfa seçici yok) yüklenince de kontrol adımına geçer.
  await page.getByTestId("aktar-file").setInputFiles(csv(["Stok Kodu;Stok İsmi;Birimi", "T1095-1;Rehber Conta;ADET"]));
  await expect(rehber).toHaveAttribute("data-step", "kontrol");
  await expect(perde).toHaveAttribute("style", /polygon\(evenodd/);

  // Sayfa yenilenince aktarma başa döner (türü korunur): rehber de dosya adımına döner, hedef yine açık.
  page.on("dialog", (dg) => void dg.accept());
  await page.reload();
  await expect(page).toHaveURL(/\/t\/demo\/import\?tur=urun/);
  await expect(page.getByTestId("aktar-drop")).toBeVisible();
  await expect(rehber).toHaveAttribute("data-step", "dosya");

  // Baştan: ilk adımın ekranına döner.
  await perde.click({ position: { x: 4, y: 4 } });
  await page.getByTestId("adim-bastan").click();
  await expect(page).toHaveURL(/\/settings\/baglantilar$/);
  await expect(page.getByTestId("adim-rehber")).toBeVisible();
  await page.getByTestId("adim-kapat").first().click();
  await expect(page.getByTestId("adim-rehber")).toHaveCount(0);
});
