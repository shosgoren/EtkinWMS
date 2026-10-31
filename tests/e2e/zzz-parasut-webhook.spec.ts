// T-1138: Paraşüt anlık bildirim uçtan uca — ERP alanı sahte Paraşüt'e bağlıdır (yoksa bağlanır), ürün akışı açılır, worker zamanlayıcısı
// webhook kaydını kurar ("Anlık bildirim açık" satırı), sahte Paraşüt'te ürün açılır / adı değişir ve imzalı teslim uca POST edilir: ürün
// Ürünler ekranında taramayı (anlık bildirim açıkken 15 dk) beklemeden görünür ve adı değişir. Sahte bilgiler sentetiktir; gerçek ağ yok.
import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { FAKE_PARASUT_DEFAULTS as F } from "../integration/fixtures/fake-parasut.ts";
import { db } from "./support/package-receiving.ts";
import { localClient, loginEmptyTenant, scrubSecretInputs } from "./support/empty-tenant.ts";

type Hook = { id: string; attributes: { model: string; action: string; uri: string; encryption_key: string } };

async function fake<T>(path: string, init?: RequestInit): Promise<T> {
  const base = process.env.E2E_FAKE_PARASUT_URL;
  if (!base) throw new Error("e2e: sahte Paraşüt adresi yok (global-setup)");
  const r = await fetch(`${base}${path}`, init);
  return (await r.json()) as T;
}

async function deliver(page: Page, model: "product", action: "create" | "update", id: string, attributes: Record<string, unknown>): Promise<void> {
  const hooks = (await fake<{ data: Hook[] }>("/__fake/webhooks")).data.filter((h) => h.attributes.model === model && h.attributes.action === action);
  const key = hooks[hooks.length - 1]?.attributes.encryption_key;
  if (!key) throw new Error("e2e: webhook kaydı yok");
  const at = new Date().toISOString();
  const data = JSON.stringify({ id, data: { id, type: "products", attributes: { ...attributes, updated_at: at } } });
  const body = new URLSearchParams({ company_id: F.companyId, resource: model, action, event_date: at, data }).toString();
  const res = await page.request.post("/api/integrations/parasut/webhook", { headers: { "content-type": "www-url-encoded", signature: createHmac("sha256", key).update(data).digest("hex") }, data: body });
  expect(res.status()).toBe(200);
  // Yanlış imza aynı sabit 401 (hangi adımın düştüğü sızmaz).
  const bad = await page.request.post("/api/integrations/parasut/webhook", { headers: { "content-type": "www-url-encoded", signature: "0".repeat(64) }, data: body });
  expect([bad.status(), await bad.text()]).toEqual([401, "rejected"]);
}

if (!process.env.E2E_BASE_URL?.trim()) {
  test.use({ ...localClient("198.51.100.28"), trace: "off" });
  test.afterEach(async ({ page }) => {
    await scrubSecretInputs(page);
  });

  test("T-1138: Paraşüt'te değişen ürün anlık bildirimle Ürünler ekranına gelir", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const { slug } = await loginEmptyTenant(page, "erp");
    await page.goto(`/t/${slug}/integrations?bolum=baglanti`);
    await expect(page.getByTestId("integrations")).toBeVisible();
    if (!(await page.getByTestId("integrations-conn").isVisible())) {
      // T-1137: eski parola yolu kalktı — ortak uygulamanın sahte OAuth akışı (zzz-integrations ile aynı): önceki koşudan kalan kendi
      // uygulama kaydı (OOB) ortak uygulamanın önüne geçmesin.
      await db("DELETE FROM public.integration_oauth_apps WHERE tenant_id=(SELECT id FROM public.tenants WHERE slug=$1)", [slug]);
      await page.reload();
      await page.route("https://api.parasut.com/**", async (route) => {
        const authorize = new URL(route.request().url());
        const back = new URL(authorize.searchParams.get("redirect_uri") ?? "about:blank");
        back.search = new URLSearchParams({ code: F.authorizationCode, state: authorize.searchParams.get("state") ?? "" }).toString();
        await route.fulfill({ status: 302, headers: { location: back.href } });
      });
      await page.getByTestId("integrations-connect").filter({ visible: true }).click();
      await expect(page.getByTestId("kalip-toast")).toContainText("Paraşüt bağlantısı kuruldu");
      await page.unroute("https://api.parasut.com/**");
      await expect(page.getByTestId("integrations-flows")).toBeVisible();
    }
    await db("UPDATE public.integration_flows f SET enabled = true, direction = 'PULL' FROM public.tenants t WHERE t.id = f.tenant_id AND t.slug = $1 AND f.flow = 'PRODUCTS'", [slug]);

    // Worker zamanlayıcısı (30 sn) kayıt işini açar; satır "Anlık bildirim açık" olana kadar sayfa yenilenir.
    await expect
      .poll(async () => {
        await page.goto(`/t/${slug}/integrations?bolum=baglanti`);
        return page.getByTestId("integrations-webhook").getAttribute("data-status");
      }, { timeout: 120_000, intervals: [2_000, 5_000] })
      .toBe("ACTIVE");
    await expect(page.getByTestId("integrations-webhook")).toContainText("Anlık bildirim açık");
    if (testInfo.project.name === "desktop") for (const width of [390, 1180, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      const hook = page.getByTestId("integrations-webhook");
      await expect(hook).toBeVisible();
      await hook.scrollIntoViewIfNeeded();
      const line = await hook.boundingBox();
      expect((line?.x ?? -1) >= 0 && (line?.x ?? 0) + (line?.width ?? 0) <= width).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`webhook-line-${width}.png`) });
    }

    const id = String(700_000 + Math.floor(Math.random() * 99_999));
    const code = `WH-${id}`;
    const name = `Anlik ${id}`;
    await fake("/__fake/products", { method: "POST", body: JSON.stringify({ id, attributes: { code, name, unit: "Adet" } }) });
    await deliver(page, "product", "create", id, { code, name });
    // İş kuyruktan birkaç saniyede alınır; açık liste odakta yenilenir (tarama 15 dk'da bir: görünüm webhook'tan gelir).
    await page.goto(`/t/${slug}/items?q=${code}`);
    await expect(page.getByTestId("items")).toBeVisible();
    await expect
      .poll(async () => {
        await page.evaluate("window.dispatchEvent(new Event('focus'))");
        return page.getByText(name, { exact: true }).count();
      }, { timeout: 30_000, intervals: [1_000, 2_000] })
      .toBeGreaterThan(0);

    // Ad Paraşüt'te değişir: teslimdeki ad değil, Paraşüt'ten yeniden okunan güncel ad yazılır; açık liste odakta yenilenir.
    const renamed = `${name} yeni`;
    await fake("/__fake/products", { method: "POST", body: JSON.stringify({ id, attributes: { code, name: renamed, unit: "Adet" } }) });
    await deliver(page, "product", "update", id, { code, name: "yukteki ad kullanilmaz" });
    await expect
      .poll(async () => {
        await page.evaluate("window.dispatchEvent(new Event('focus'))");
        return page.getByText(renamed, { exact: true }).count();
      }, { timeout: 30_000, intervals: [1_000, 2_000] })
      .toBeGreaterThan(0);
    await expect(page.getByText("yukteki ad kullanilmaz")).toHaveCount(0);
  });
}
