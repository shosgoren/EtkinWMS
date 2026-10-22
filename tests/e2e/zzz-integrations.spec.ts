// T-991: ERP entegrasyonu uçtan uca — hesap sahibi Entegrasyon ekranında sahte Paraşüt'e (global-setup, 127.0.0.1) bağlanır, bağlı şeridi
// (yalnız şirket adı, sır yok) görür, bir akışı açar (balon + açık durum) ve bağlantıyı sınar. Ayrı fikstür alanı (`E2E_ERP`); sahte bilgiler
// sentetiktir. Masaüstü ve mobil projeler aynı alanı kullanır: bağlıysa test önce bağlantıyı keser (kes penceresi de sınanır).
import { expect, test } from "@playwright/test";
import { FAKE_PARASUT_DEFAULTS as F } from "../integration/fixtures/fake-parasut.ts";
import { localClient, loginEmptyTenant, scrubSecretInputs } from "./support/empty-tenant.ts";

if (!process.env.E2E_BASE_URL?.trim()) {
  test.use({ ...localClient("198.51.100.27"), trace: "off" });
  test.afterEach(async ({ page }) => {
    await scrubSecretInputs(page);
  });

  test("T-991: Paraşüt'e bağlan, akış aç, bağlantıyı sına", async ({ page }) => {
    test.setTimeout(120_000);
    const { slug } = await loginEmptyTenant(page, "erp");
    await page.goto(`/t/${slug}/integrations`);
    await expect(page.getByTestId("integrations")).toBeVisible();

    if (await page.getByTestId("integrations-conn").isVisible()) {
      await page.getByTestId("integrations-cut").click();
      await page.getByRole("button", { name: "Bağlantıyı kes" }).click();
      await expect(page.getByTestId("integrations-providers")).toBeVisible();
    }

    // Logo yakında: dokununca balon, pencere açılmaz.
    await page.getByTestId("provider-LOGO").click();
    await expect(page.getByTestId("kalip-toast")).toContainText("Logo yakında");

    await page.getByTestId("provider-PARASUT").click();
    const form = page.getByTestId("integrations-form");
    await expect(form).toBeVisible();
    await page.getByTestId("integrations-company").fill(F.companyId);
    await page.getByTestId("integrations-client-id").fill(F.clientId);
    await page.getByTestId("integrations-client-secret").fill(F.clientSecret);
    await page.getByTestId("integrations-email").fill(F.username);
    await page.getByTestId("integrations-password").fill(F.password);
    await page.getByTestId("integrations-form-submit").click();

    const conn = page.getByTestId("integrations-conn");
    await expect(conn).toBeVisible();
    await expect(conn).toContainText(F.companyName);
    await expect(conn).toHaveAttribute("data-status", "CONNECTED");
    const html = await page.content();
    for (const secret of [F.clientSecret, F.password]) expect(html).not.toContain(secret);

    // Sipariş akışı Paraşüt'te yok: anahtar kilitli, dokununca nedenini söyler.
    // T-436 (ALTIN-KURAL 17): kilitli anahtar `aria-disabled` (gerçek `disabled` değil; dokununca nedenini söyler). Playwright etkinlik
    // denetimi bunu "etkin değil" sayar; dokunuş zorlanır (z-join-share ile aynı).
    await page.getByTestId("flow-SALES_ORDERS-toggle").click({ force: true });
    await expect(page.getByTestId("kalip-toast")).toContainText("karşılığı yok");
    await expect(page.getByTestId("flow-SALES_ORDERS")).toHaveAttribute("data-enabled", "false");

    // Ürün kartları akışını aç: açık durum + yön seçimi + balon.
    await page.getByTestId("flow-PRODUCTS-toggle").click();
    await expect(page.getByTestId("flow-PRODUCTS")).toHaveAttribute("data-enabled", "true");
    await expect(page.getByTestId("kalip-toast")).toContainText("Ürün kartları açıldı");
    await expect(page.getByTestId("flow-PRODUCTS").getByRole("radio", { name: "Paraşüt → Etkin" })).toHaveAttribute("aria-checked", "true");

    await page.getByTestId("integrations-test").click();
    await expect(page.getByTestId("kalip-toast")).toContainText("Bağlantı sağlam");
  });
}
