// T-991: ERP entegrasyonu uçtan uca — hesap sahibi Entegrasyon ekranında sahte Paraşüt'e (global-setup, 127.0.0.1) bağlanır, bağlı şeridi
// (yalnız şirket adı, sır yok) görür, bir akışı açar (balon + açık durum) ve bağlantıyı sınar. Ayrı fikstür alanı (`E2E_ERP`); sahte bilgiler
// sentetiktir. Masaüstü ve mobil projeler aynı alanı kullanır: bağlıysa test önce bağlantıyı keser (kes penceresi de sınanır).
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { FAKE_PARASUT_DEFAULTS as F } from "../integration/fixtures/fake-parasut.ts";
import { localClient, loginEmptyTenant, scrubSecretInputs } from "./support/empty-tenant.ts";

// Only the current synthetic local session is aged; never executes against a remote DB and never logs cookie/URL.
function expireRecentAuth(token: string): void {
  const raw = process.env.DATABASE_URL_DIRECT;
  if (!raw || process.env.E2E_BASE_URL?.trim()) throw new Error("e2e: local database required");
  const u = new URL(raw);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) throw new Error("e2e: local database required");
  const env = { PATH: process.env.PATH, PGHOST: u.hostname.replace(/^\[|\]$/g,""), PGPORT: u.port || "5432", PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: decodeURIComponent(u.pathname.slice(1)) };
  const literal = token.replaceAll("'", "''");
  try {
    const count = execFileSync("psql", ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"], {env, input: `WITH aged AS (UPDATE public.sessions SET created_at=now()-interval '11 minutes' WHERE token='${literal}' RETURNING 1) SELECT count(*) FROM aged;`, encoding:"utf8", stdio:["pipe","pipe","pipe"]});
    if (count.trim() !== "1") throw new Error("missing fixture session");
  } catch { throw new Error("e2e: local session aging failed"); }
}

if (!process.env.E2E_BASE_URL?.trim()) {
  test.use({ ...localClient("198.51.100.27"), trace: "off" });
  test.afterEach(async ({ page }) => {
    await scrubSecretInputs(page);
  });

  test("T-991: Paraşüt'e bağlan, akış aç, bağlantıyı sına", async ({ page }, testInfo) => {
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

    const rejected=await page.request.get('/api/integrations/parasut/callback?code=synthetic&state=invalid');
    expect(rejected.status()).toBe(400);expect(rejected.headers()['cache-control']).toBe('no-store');expect(rejected.headers()['referrer-policy']).toBe('no-referrer');expect(await rejected.text()).not.toContain('synthetic');
    // A fabricated browser binding cannot authorize a callback; mismatches do not consume it, replay fails closed.
    const binding={slug,id:'00000000-0000-4000-8000-000000000001',state:'a'.repeat(64),nonce:'b'.repeat(64)};
    const origin=new URL(page.url()).origin;
    const cookieName=origin.startsWith('https:')?'__Host-etkin-parasut-oauth':'etkin-parasut-oauth';
    await page.context().addCookies([{name:cookieName,value:Buffer.from(JSON.stringify(binding)).toString('base64url'),url:origin,httpOnly:true,secure:origin.startsWith('https:'),sameSite:'Lax'}]);
    const wrong=await page.request.get('/api/integrations/parasut/callback?code=synthetic&state='+ 'c'.repeat(64),{maxRedirects:0});expect(wrong.status()).toBe(400);
    const invalid=await page.request.get('/api/integrations/parasut/callback?code=synthetic&state='+binding.state,{maxRedirects:0});expect(invalid.status()).toBe(303);expect(invalid.headers()['location']).not.toContain('synthetic');expect(invalid.headers()['location']).toContain('oauth_result=failed');
    const replay=await page.request.get('/api/integrations/parasut/callback?code=synthetic&state='+binding.state,{maxRedirects:0});expect(replay.status()).toBe(400);
    await page.getByTestId("oauth-settings-open").click();
    await expect(page.getByTestId("oauth-settings")).toBeVisible();
    await expect(page.getByTestId("oauth-callback")).toHaveValue("");
    if(testInfo.project.name==="desktop")for(const width of [390,1180,1440]) {
      await page.setViewportSize({width,height:844});
      for(const id of ['oauth-app-id','oauth-app-secret','oauth-callback']) {const field=page.getByTestId(id).locator('..');const bounds=await field.boundingBox();await field.click({position:{x:5,y:5}});await expect(page.getByTestId(id)).toBeFocused();expect(bounds?.height).toBeGreaterThanOrEqual(44);expect((bounds?.x??-1)>=0&&(bounds?.x??0)+(bounds?.width??0)<=width).toBe(true);}
      await page.screenshot({path:testInfo.outputPath(`oauth-settings-${width}.png`)});
    }
    await page.getByTestId("oauth-legacy").click();
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

    const barcodeToggle = page.getByTestId("product-barcode-toggle");
    await expect(barcodeToggle).toBeVisible();
    const initialBarcode = await barcodeToggle.getAttribute("aria-pressed");
    await barcodeToggle.click();
    await expect(barcodeToggle).toHaveAttribute("aria-pressed", initialBarcode === "true" ? "false" : "true");
    await expect(page.getByTestId("kalip-toast")).toContainText("Barkod tercihi kaydedildi");
    await page.reload();
    await expect(barcodeToggle).toHaveAttribute("aria-pressed", initialBarcode === "true" ? "false" : "true");
    await barcodeToggle.click();
    await expect(barcodeToggle).toHaveAttribute("aria-pressed", initialBarcode ?? "false");

    if (testInfo.project.name === "desktop") {
      for (const width of [390, 1180, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        await barcodeToggle.scrollIntoViewIfNeeded();
        await expect(barcodeToggle).toBeVisible();
        const bounds = await barcodeToggle.boundingBox();
        expect(bounds?.height).toBeGreaterThanOrEqual(44);
        expect((bounds?.x ?? -1) >= 0 && (bounds?.x ?? 0) + (bounds?.width ?? 0) <= width).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`barcode-${width}.png`) });
      }
    }
    await page.getByTestId("integrations-test").click();
    await expect(page.getByTestId("kalip-toast")).toContainText("Bağlantı sağlam");
    await page.getByTestId("oauth-settings-open").click();
    await page.getByTestId("oauth-app-id").fill(F.clientId);
    await page.getByTestId("oauth-app-secret").fill(F.clientSecret);
    await page.getByTestId("oauth-callback").fill(F.redirectUri);
    await page.getByTestId("oauth-settings-save").click();
    await expect(page.getByTestId("integrations")).toBeVisible();
    await page.reload();
    expect(await page.content()).not.toContain(F.clientSecret);
    await page.getByTestId("oauth-connect").click();
    await expect(page.getByTestId("oauth-code-form")).toBeVisible();
    const providerUrl=new URL((await page.getByTestId("oauth-provider-open").getAttribute("href"))!);
    expect(providerUrl.origin).toBe('https://api.parasut.com');expect(providerUrl.searchParams.get('redirect_uri')).toBe(F.redirectUri);expect(providerUrl.searchParams.get('client_id')).toBe(F.clientId);
    if(testInfo.project.name==='desktop') {
      await page.getByTestId('oauth-code').fill(F.authorizationCode);
      await page.getByTestId('oauth-code-form-save').click();
      await expect(page.getByTestId('integrations-conn')).toHaveAttribute('data-status','CONNECTED');
      expect(await page.content()).not.toContain(F.authorizationCode);
    }

    // Reproduce the live report: an old authenticated session must show a useful reason + a working reauth link.
    await page.goto(`/t/${slug}/integrations`);
    await page.getByTestId("oauth-settings-open").click();
    await page.getByTestId("oauth-app-id").fill(F.clientId);
    await page.getByTestId("oauth-app-secret").fill(F.clientSecret);
    await page.getByTestId("oauth-callback").fill(F.redirectUri);
    const cookie = (await page.context().cookies()).find(c => c.name.endsWith("session_token"));
    if (!cookie) throw new Error("e2e: fixture session missing");
    expireRecentAuth(decodeURIComponent(cookie.value).split(".")[0]!);
    await page.getByTestId("oauth-settings-save").click();
    await expect(page.getByTestId("kalip-form-issue")).toContainText("yeniden giriş gerekiyor");
    const reauth = page.getByTestId("oauth-reauth");
    await expect(reauth).toBeVisible();
    await expect(reauth).toHaveAttribute("href", `/login?reauth=1&next=${encodeURIComponent(`/t/${slug}/integrations`)}`);
    await expect(page.getByTestId("oauth-app-secret")).toHaveValue(F.clientSecret);
    expect(await reauth.getAttribute("href")).not.toContain(F.clientSecret);
  });
}
