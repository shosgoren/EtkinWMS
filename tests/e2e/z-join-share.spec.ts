// T-986b: Ekip › "Saha personeli: katılma QR'ı" paylaşma satırı.
// (1) Demo alanı: paylaşma kilitli; dokunuş sarı "yetkin yok" balonu gösterir; WhatsApp bağlantı değil (href yok). Üst çubukta Sorun bildir,
//     Destek ve Hesap var.
// (2) Kopyala → "Kopyalandı" ve WhatsApp href'i: gerçek QR üretimi demoda kapalı olduğundan boş kiracı fikstüründe, `empty-tenant.spec.ts`.
import { expect, test } from "@playwright/test";
import { localClient } from "./support/empty-tenant.ts";
import { loginAdmin } from "./support/import-screen.ts";

test.use({ ...localClient("198.51.100.47") });

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
  // Kilitli çip `aria-disabled` (gerçek `disabled` değil): kullanıcı dokunabilir ve nedeni duyar; Playwright etkinlik denetimi bunu "etkin değil"
  // sayar, bu yüzden dokunuş zorlanır.
  await page.getByTestId("share-copy").click({ force: true });
  await expect(page.getByTestId("kalip-toast")).toContainText("Paylaşma yetkin yok");
  await expect(page.getByTestId("share-copy")).not.toContainText("Kopyalandı");
  // Ana işlem PAYLAŞ demoda pasif görünür ama sessiz değildir.
  await expect(page.getByTestId("team-main")).toContainText("PAYLAŞ");
  await page.getByTestId("team-main").click();
  await expect(page.getByTestId("kalip-toast")).toContainText("Paylaşma yetkin yok");
});
