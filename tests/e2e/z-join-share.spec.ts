// T-986b: Ekip › "Saha personeli: katılma QR'ı" paylaşma satırı.
// (1) Demo alanı: paylaşma kilitli; dokunuş sarı "yetkin yok" balonu gösterir; WhatsApp bağlantı değil (href yok). Üst çubukta Sorun bildir,
//     Destek ve Hesap var.
// (2) Boş kiracı (yerel fikstür, iki adımlı girişten hemen sonra → yeniden doğrulama tazedir): QR oluştur → "Bağlantıyı kopyala" düğmesi
//     "Kopyalandı" olur (kullanıcı kararı 21 Ekim: balon/ses yok) ve panoya yalnız katılma bağlantısı yazılır; WhatsApp href'i
//     `https://wa.me/?text=` + hazır metin (firma + bağlantı + "7 gün geçerli"). Uzak koşuda dışlanır (playwright.config.ts EMPTY_TENANT_SPECS).
import { expect, test } from "@playwright/test";
import { localClient, loginEmptyTenant, scrubSecretInputs } from "./support/empty-tenant.ts";
import { loginAdmin } from "./support/import-screen.ts";

test.use({ ...localClient("198.51.100.47"), trace: "off" });
test.afterEach(async ({ page }) => scrubSecretInputs(page));

test("demo: katılma QR'ı paylaşma kilitli; dokununca yetkisiz balonu; üst çubukta Sorun/Destek/Hesap", async ({ page }) => {
  await loginAdmin(page);
  await page.goto("/t/demo/team");
  await expect(page.getByTestId("team")).toBeVisible();
  await expect(page.getByTestId("kalip-support")).toBeVisible();
  await expect(page.getByTestId("kalip-account")).toBeVisible();
  await page.getByTestId("team-main").click();
  await page.getByTestId("team-add-qr").click();
  await expect(page.getByTestId("team-qr-new")).toBeDisabled();
  const wa = page.getByTestId("share-whatsapp");
  await expect(wa).toHaveAttribute("aria-disabled", "true");
  await expect(wa).not.toHaveAttribute("href", /./);
  await page.getByTestId("share-copy").click();
  await expect(page.getByTestId("team-toast")).toContainText("Paylaşma yetkin yok");
  await expect(page.getByTestId("share-copy")).not.toContainText("Kopyalandı");
  // Ana işlem PAYLAŞ demoda pasif görünür ama sessiz değildir.
  await expect(page.getByTestId("team-main")).toContainText("PAYLAŞ");
  await page.getByTestId("team-main").click();
  await expect(page.getByTestId("team-toast")).toContainText("Paylaşma yetkin yok");
});

test("kopyala → düğme 'Kopyalandı'; WhatsApp href'i hazır metin + bağlantı", async ({ page, context, baseURL }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL });
  const { slug } = await loginEmptyTenant(page);
  await page.goto(`/t/${slug}/team`);
  await expect(page.getByTestId("team")).toBeVisible();
  await page.getByTestId("team-main").click();
  await page.getByTestId("team-add-qr").click();
  await page.getByTestId("team-main").click(); // QR OLUŞTUR
  await expect(page.getByTestId("team-qr")).toBeVisible();
  await expect(page.getByTestId("team-main")).toContainText("PAYLAŞ");

  const copy = page.getByTestId("share-copy");
  await copy.click();
  await expect(copy).toContainText("Kopyalandı");
  await expect(page.getByTestId("share-live")).toContainText("kopyalandı");
  const clip = await page.evaluate<string>("navigator.clipboard.readText()");
  expect(clip).toMatch(/^https:\/\/[^\s]+\/field\/join#[^\s]+$/);
  await expect(copy).not.toContainText("Kopyalandı", { timeout: 4000 }); // 2 sn sonra eski haline döner

  const href = await page.getByTestId("share-whatsapp").getAttribute("href");
  expect(href).not.toBeNull();
  expect(href?.startsWith("https://wa.me/?text=")).toBe(true);
  const text = decodeURIComponent((href ?? "").slice("https://wa.me/?text=".length));
  expect(text).toMatch(/^Etkin WMS'de .+ ekibine katıl: https:\/\/\S+ \(7 gün geçerli\)$/);
  expect(text).toContain(clip);
  await expect(page.getByTestId("share-whatsapp")).toHaveAttribute("target", "_blank");
  await expect(page.getByTestId("share-whatsapp")).toHaveAttribute("rel", /noopener/);
});
