// T-431: satış sitesi demo formu geri bildirimi, uçtan uca (gerçek satış sitesi sunucusu marketing/server.mjs, gerçek tarayıcı).
// `/api/demo` yanıtı tarayıcıda karşılanır: yerel e2e kökeni (localhost:<port>) sunucunun izinli köken listesinde yoktur ve
// gerçek talep kaydı/bildirim bu testin konusu değildir (kayıt ucunun kimlik dönüşü marketing/demo-api.test.mjs'de).
// Uzak hedefte (E2E_BASE_URL) satış sitesi örneği olmadığından bu dosya KAYITLI DEĞİLDİR (atlama değil; zzz-site-content ile aynı kural).
import { expect, test, type Page, type Route } from "@playwright/test";

const ID = "1a2b3c4d-5e6f-4a1b-9c2d-0123456789ab";

async function fill(page: Page): Promise<void> {
  const form = page.locator("#demo-form");
  await form.locator('[name="name"]').fill("Ayşe Test");
  await form.locator('[name="company"]').fill("Örnek Depo A.Ş.");
  await form.locator('[name="email"]').fill("ayse@ornek.com");
  await form.locator('[name="consent"]').check();
}

async function open(page: Page): Promise<void> {
  const site = process.env.E2E_SITE_URL;
  if (!site) throw new Error("e2e: satış sitesi adresi yok (global-setup E2E_SITE_URL)");
  await page.goto(`${site}/#demo`);
  await expect(page.locator("#demo-form button[type=submit]")).toBeVisible();
}

if (!process.env.E2E_BASE_URL?.trim() || process.env.E2E_SITE_URL) {
  test("T-431: boş gönderimde alan altı uyarılar; gönderilirken gösterge ve tek istek; başarıda onay kutusu, talep no ve odak", async ({ page }) => {
    await open(page);
    const form = page.locator("#demo-form");
    const submit = form.locator("button[type=submit]");

    await submit.click();
    await expect(page.locator("#err-name")).toHaveText("Adınızı yazın.");
    await expect(page.locator("#err-company")).toBeVisible();
    await expect(page.locator("#err-email")).toBeVisible();
    await expect(page.locator("#err-consent")).toBeVisible();
    await expect(form.locator('[name="name"]')).toHaveAttribute("aria-invalid", "true");
    await expect(form.locator('[name="name"]')).toBeFocused();
    await expect(page.locator("#form-status")).toContainText("Eksik ya da hatalı alanları düzeltin.");

    await form.locator('[name="email"]').fill("gecersiz");
    await submit.click();
    await expect(page.locator("#err-email")).toHaveText("Geçerli bir e-posta yazın (ör. ad@firma.com).");
    await fill(page);
    await expect(page.locator("#demo-form .ferr")).toHaveCount(0);

    let calls = 0;
    let release: () => void = () => {};
    const held = new Promise<void>((r) => { release = r; });
    await page.route("**/api/demo", async (route: Route) => {
      calls++;
      await held;
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, id: ID }) });
    });
    await submit.click();
    await expect(submit).toHaveAttribute("aria-disabled", "true");
    await expect(submit.locator(".fspin")).toBeVisible();
    await expect(submit).toContainText("Gönderiliyor…");
    await submit.click({ force: true });
    await form.locator('[name="email"]').press("Enter");
    release();

    const done = page.getByTestId("demo-success");
    await expect(done).toBeVisible();
    const title = page.getByRole("heading", { name: "Talebiniz başarıyla gönderildi" });
    await expect(title).toBeFocused();
    await expect(done).toContainText("En geç 1 iş günü içinde sizinle iletişime geçeceğiz.");
    await expect(page.getByTestId("demo-ref")).toContainText("1A2B3C4D");
    await expect(done.getByRole("link", { name: /Ana sayfaya dön/ })).toHaveAttribute("href", "/");
    await expect(page.locator("#form-status")).toHaveText(/Talebiniz başarıyla gönderildi\. En geç 1 iş günü/);
    await expect(form.locator('[name="name"]')).toHaveCount(0);
    expect(calls).toBe(1);
  });

  test("T-431: gönderim hatasında bilgiler kalır, kırmızı satır ve 'tekrar dene'; İngilizce başarı metni", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "EN", exact: true }).first().click();
    await fill(page);
    const form = page.locator("#demo-form");
    let fail = true;
    await page.route("**/api/demo", (route: Route) =>
      fail
        ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "x" }) })
        : route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, id: ID }) }),
    );
    await form.locator("button[type=submit]").click();
    const status = page.locator("#form-status");
    await expect(status).toHaveClass(/\berr\b/);
    await expect(status).toContainText("Could not send");
    await expect(form.locator('[name="name"]')).toHaveValue("Ayşe Test");
    await expect(form.locator('[name="email"]')).toHaveValue("ayse@ornek.com");
    await expect(form.locator('[name="consent"]')).toBeChecked();

    fail = false;
    await status.getByRole("button", { name: "try again" }).click();
    await expect(page.getByRole("heading", { name: "Your request has been sent" })).toBeFocused();
    await expect(page.getByTestId("demo-success")).toContainText("We will get in touch within 1 business day at the latest.");
    await expect(page.getByTestId("demo-ref")).toContainText("1A2B3C4D");
  });
}
