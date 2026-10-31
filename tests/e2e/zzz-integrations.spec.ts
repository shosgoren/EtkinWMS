// T-991: ERP entegrasyonu uçtan uca — hesap sahibi Entegrasyon ekranında sahte Paraşüt'e (global-setup, 127.0.0.1) bağlanır, bağlı şeridi
// (yalnız şirket adı, sır yok) görür, bir akışı açar (balon + açık durum) ve bağlantıyı sınar. Ayrı fikstür alanı (`E2E_ERP`); sahte bilgiler
// sentetiktir. Masaüstü ve mobil projeler aynı alanı kullanır: bağlıysa test önce bağlantıyı keser (kes penceresi de sınanır).
// T-1133: Etkin'in ortak Paraşüt uygulaması (global-setup sentetik ortam değişkenleri): BAĞLAN → Paraşüt izin ekranı (sahte: yönlendirme
// yakalanır, gerçek ağ yok) → callback → tek şirket → bağlı. Müşteri anahtar alanı görmez; kendi uygulaması "Gelişmiş" satırının içinde.
import { randomUUID } from "node:crypto";
import { db } from "./support/package-receiving.ts";
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
    // T-1133: önceki koşudan (öteki proje) kalan kendi uygulama kaydı ortak uygulamanın önüne geçer; senaryo ortak uygulamadan başlar.
    await db("DELETE FROM public.integration_oauth_apps WHERE tenant_id=(SELECT id FROM public.tenants WHERE slug=$1)", [slug]);
    // T-1112: bağlantı kartı "Bağlantı ve veri kaynağı" bölümünde (bağlıyken varsayılan bölüm akışlardır).
    await page.goto(`/t/${slug}/integrations?bolum=baglanti`);
    await expect(page.getByTestId("integrations")).toBeVisible();

    if (await page.getByTestId("integrations-conn").isVisible()) {
      await page.getByTestId("integrations-cut").click();
      await page.getByRole("button", { name: "Bağlantıyı kes" }).click();
      await expect(page.getByTestId("integrations-providers")).toBeVisible();
    }

    // T-1133: ortak uygulama ile bağlan — anahtar alanı yok; BAĞLAN → Paraşüt (sahte izin: yönlendirme yakalanır) → callback → bağlı.
    await expect(page.getByTestId("oauth-app-id")).toHaveCount(0);
    await expect(page.getByTestId("integrations-advanced")).toContainText("Anahtar girmen gerekmez");
    let authorize: URL | null = null;
    await page.route("https://api.parasut.com/**", async (route) => {
      authorize = new URL(route.request().url());
      const back = new URL(authorize.searchParams.get("redirect_uri") ?? "about:blank");
      back.search = new URLSearchParams({ code: F.authorizationCode, state: authorize.searchParams.get("state") ?? "" }).toString();
      await route.fulfill({ status: 302, headers: { location: back.href } });
    });
    await page.getByTestId("integrations-connect").filter({ visible: true }).click();
    await expect(page.getByTestId("kalip-toast")).toContainText("Paraşüt bağlantısı kuruldu");
    await page.unroute("https://api.parasut.com/**");
    const auth = authorize as URL | null;
    if (auth === null) throw new Error("e2e: Paraşüt izin isteği görülmedi");
    expect(auth.pathname).toBe("/oauth/authorize");
    expect(auth.searchParams.get("client_id")).toBe(F.clientId);
    expect(auth.searchParams.get("redirect_uri")).toBe(`${new URL(page.url()).origin}/api/integrations/parasut/callback`);
    expect(auth.href).not.toContain(F.clientSecret);
    await page.goto(`/t/${slug}/integrations?bolum=baglanti`);
    await expect(page.getByTestId("integrations-conn")).toHaveAttribute("data-status", "CONNECTED");
    await expect(page.getByTestId("integrations-conn")).toContainText(F.companyName);
    expect(await page.content()).not.toContain(F.clientSecret);
    await page.getByTestId("integrations-cut").click();
    await page.getByRole("button", { name: "Bağlantıyı kes" }).click();
    await expect(page.getByTestId("integrations-providers")).toBeVisible();

    // T-1104: bağlı değilken tek bağlanma yolu (ana BAĞLAN / Paraşüt kutusu); ayrı "Paraşüt ile bağlan" yok, uygulama bilgileri en altta.
    // T-1112: ekran Ayarlar › Entegrasyonlar sekmesinin kendisidir (üstte ayar sekmeleri); Geri Ayarlar'a döner. Excel aktarımı bu bölümden.
    await expect(page.getByTestId("oauth-connect")).toHaveCount(0);
    // T-1133: kendi uygulaması "Gelişmiş" açılır satırında: 3 adım, gerçek dönüş adresi salt okunur.
    await page.getByTestId("oauth-advanced").click();
    await expect(page.getByTestId("oauth-callback-url")).toHaveText(`${new URL(page.url()).origin}/api/integrations/parasut/callback`);
    await expect(page.getByTestId("oauth-steps")).toContainText("Paraşüt → Ayarlar → Entegrasyonlar → Yeni uygulama → bu adresi yapıştır");
    await expect(page.getByTestId("integrations-advanced").getByTestId("oauth-settings-open")).toBeVisible();
    // Pasif görünür (aria-disabled) ama sessiz değil: dokununca nedeni söyler.
    await expect(page.getByTestId("oauth-connect")).toHaveAttribute("aria-disabled", "true");
    await page.getByTestId("oauth-connect").click({ force: true });
    await expect(page.getByTestId("kalip-toast")).toContainText("Önce anahtarları kaydet");
    // Telefonda alt sayfa (Kapat), masaüstünde satırın kendisi açar/kapatır (KalipSatir).
    const closeEditor = page.getByTestId("oauth-advanced-editor").locator("button.x2");
    if (await closeEditor.isVisible()) await closeEditor.click();
    else await page.getByTestId("oauth-advanced").click();
    await expect(page.getByTestId("oauth-advanced-editor")).toHaveCount(0);
    await expect(page.getByTestId("kabuk-back").filter({ visible: true })).toHaveAttribute("href", `/t/${slug}/settings`);
    await expect(page.getByTestId("kalip-sekme").locator('[data-tab="entegrasyon"]')).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("integrations-excel")).toHaveAttribute("href", `/t/${slug}/settings/baglantilar`);
    // Bağlı değilken akış bölümü boş durum + bağlantıya götüren düğme; alan sahipliği yalnız "Yakında" (sahte denetim yok).
    const bolumler = page.getByTestId("integrations-bolumler");
    await bolumler.locator('[data-bolum="akis"]').click();
    await expect(page).toHaveURL(/bolum=akis/);
    await expect(page.getByTestId("integrations-flows-empty")).toBeVisible();
    await bolumler.locator('[data-bolum="sahiplik"]').click();
    await expect(page.getByTestId("integrations-sahiplik-soon")).toBeVisible();
    await expect(page.getByTestId("integrations-sahiplik").getByRole("radio")).toHaveCount(0);
    await bolumler.locator('[data-bolum="arsiv"]').click();
    await expect(page.getByTestId("integrations-archived")).toHaveAttribute("href", `/t/${slug}/items?status=ARCHIVED`);
    await expect(page.getByTestId("integrations-removed")).toHaveAttribute("href", `/t/${slug}/items?status=REMOVED`);
    await bolumler.locator('[data-bolum="baglanti"]').click();
    await expect(page.getByTestId("integrations-providers")).toBeVisible();
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
    await page.getByTestId("oauth-advanced").click();
    await page.getByTestId("oauth-settings-open").click();
    await expect(page.getByTestId("oauth-settings")).toBeVisible();
    // Adım 1: gerçek dönüş adresi, salt okunur; adım 2 boşken KAYDET sessiz kalmaz (ALTIN-KURAL form kuralı).
    await expect(page.getByTestId("oauth-callback")).toHaveValue(`${new URL(page.url()).origin}/api/integrations/parasut/callback`);
    await expect(page.getByTestId("oauth-callback")).toHaveAttribute("readonly", "");
    await page.getByTestId("oauth-app-id").fill("x");
    await page.getByTestId("oauth-app-id").fill("");
    await page.getByTestId("oauth-oob-toggle").click();
    await page.getByTestId("oauth-settings-save").click();
    await expect(page.getByTestId("kalip-toast")).toContainText("2 alan eksik");
    await expect(page.getByTestId("err-clientId")).toBeVisible();
    await expect(page.getByTestId("err-clientSecret")).toBeVisible();
    await page.getByTestId("oauth-oob-toggle").click();
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

    // T-1112: bağlanınca "Ne çekilsin, gönderilsin" bölümü açılır: her akış tek satır, her zaman görünen yön seçimi; yalnız katalogun
    // desteklediği yönler + "Yalnız Etkin WMS" (= kapalı).
    await expect(page.getByTestId("integrations-flows")).toBeVisible();
    await expect(page.getByTestId("integrations-flows")).toContainText("Paraşüt bağlı");
    await expect(bolumler.locator('[data-bolum="akis"]')).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("flow-WAREHOUSES").getByRole("radio")).toHaveCount(4);
    await expect(page.getByTestId("flow-STOCK").getByRole("radio")).toHaveCount(2);
    await expect(page.getByTestId("flow-STOCK").getByRole("radio", { name: "Paraşüt'e gönder" })).toBeVisible();

    // Sipariş akışı Paraşüt'te yok: yalnız "Yalnız Etkin WMS" seçeneği (seçili) ve nedeni satırda yazar.
    const siparis = page.getByTestId("flow-SALES_ORDERS");
    await expect(siparis).toHaveAttribute("data-enabled", "false");
    await expect(siparis).toContainText("karşılığı yok");
    await expect(siparis.getByRole("radio")).toHaveCount(1);
    await expect(siparis.getByRole("radio", { name: "Yalnız Etkin WMS" })).toHaveAttribute("aria-checked", "true");

    // Ürün kartları: "Paraşüt'ten al" açar (balon), "İki yönlü" yönü değiştirir (kalıcı), "Yalnız Etkin WMS" kapatır.
    const urun = page.getByTestId("flow-PRODUCTS");
    await urun.getByRole("radio", { name: "Paraşüt'ten al" }).click();
    await expect(urun).toHaveAttribute("data-enabled", "true");
    await expect(page.getByTestId("kalip-toast")).toContainText("Ürün kartları açıldı");
    await expect(urun.getByRole("radio", { name: "Paraşüt'ten al" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("flow-PRODUCTS-run")).toBeVisible();
    await urun.getByRole("radio", { name: "İki yönlü" }).click();
    await expect(page.getByTestId("kalip-toast")).toContainText("Ürün kartları: İki yönlü");
    await page.reload();
    await expect(urun.getByRole("radio", { name: "İki yönlü" })).toHaveAttribute("aria-checked", "true");
    await expect(urun).toHaveAttribute("data-enabled", "true");
    await urun.getByRole("radio", { name: "Yalnız Etkin WMS" }).click();
    await expect(urun).toHaveAttribute("data-enabled", "false");
    await expect(page.getByTestId("kalip-toast")).toContainText("Ürün kartları kapandı");
    await expect(urun.getByRole("radio", { name: "Yalnız Etkin WMS" })).toHaveAttribute("aria-checked", "true");
    await page.reload();
    await expect(urun).toHaveAttribute("data-enabled", "false");
    // Telefon genişliğinde alt bölüm listesi kartın üstünde yatay çip satırı; sayfa yatay kaymaz.
    if (testInfo.project.name === "desktop") {
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(bolumler.locator("nav")).toBeVisible();
      await expect(page.getByTestId("integrations-flows")).toBeVisible();
      const nav = await bolumler.locator("nav").boundingBox();
      const card = await page.getByTestId("integrations-flows").boundingBox();
      if (nav === null || card === null) throw new Error("e2e: bölüm listesi ya da kart ölçülemedi");
      expect(nav.y + nav.height).toBeLessThanOrEqual(card.y + 1);
      expect(nav.width).toBeLessThanOrEqual(390);
      const w = await page.evaluate<{ sw: number; cw: number }>("({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })");
      expect(w.sw).toBeLessThanOrEqual(w.cw);
      await page.screenshot({ path: testInfo.outputPath("akis-390.png") });
      await page.setViewportSize({ width: 1440, height: 900 });
      // Masaüstünde liste solda, kart sağda (tuval: 290 px sol sütun).
      const navD = await bolumler.locator("nav").boundingBox();
      const cardD = await page.getByTestId("integrations-flows").boundingBox();
      if (navD === null || cardD === null) throw new Error("e2e: bölüm listesi ya da kart ölçülemedi");
      expect(navD.x + navD.width).toBeLessThanOrEqual(cardD.x);
      await page.screenshot({ path: testInfo.outputPath("akis-1440.png") });
    }
    // Bekleyenler ve hatalar: son koşular listesi bu bölümde.
    await bolumler.locator('[data-bolum="hatalar"]').click();
    await expect(page.getByTestId("integrations-runs")).toBeVisible();

    await bolumler.locator('[data-bolum="baglanti"]').click();
    await expect(page).toHaveURL(/bolum=baglanti/);
    const conn = page.getByTestId("integrations-conn");
    await expect(conn).toBeVisible();
    await expect(conn).toContainText(F.companyName);
    await expect(conn).toHaveAttribute("data-status", "CONNECTED");
    const html = await page.content();
    for (const secret of [F.clientSecret, F.password]) expect(html).not.toContain(secret);


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
    // Kendi uygulaması, eski yetki kodu yöntemiyle (OOB): anahtarlar kaydedilir, bağlan → kod formu.
    await page.getByTestId("oauth-advanced").click();
    await page.getByTestId("oauth-settings-open").click();
    await page.getByTestId("oauth-app-id").fill(F.clientId);
    await page.getByTestId("oauth-app-secret").fill(F.clientSecret);
    await page.getByTestId("oauth-oob-toggle").click();
    await expect(page.getByTestId("oauth-callback")).toHaveValue("urn:ietf:wg:oauth:2.0:oob");
    await page.getByTestId("oauth-settings-save").click();
    await expect(page.getByTestId("integrations")).toBeVisible();
    await page.reload();
    expect(await page.content()).not.toContain(F.clientSecret);
    await page.getByTestId("oauth-advanced").click();
    await page.getByTestId("oauth-connect").click();
    await expect(page.getByTestId("oauth-code-form")).toBeVisible();
    const providerUrl=new URL((await page.getByTestId("oauth-provider-open").getAttribute("href"))!);
    expect(providerUrl.origin).toBe('https://api.parasut.com');expect(providerUrl.searchParams.get('redirect_uri')).toBe('urn:ietf:wg:oauth:2.0:oob');expect(providerUrl.searchParams.get('client_id')).toBe(F.clientId);
    if(testInfo.project.name==='desktop') {
      await page.getByTestId('oauth-code').fill(F.authorizationCode);
      await page.getByTestId('oauth-code-form-save').click();
      await expect(page.getByTestId('integrations-conn')).toHaveAttribute('data-status','CONNECTED');
      expect(await page.content()).not.toContain(F.authorizationCode);
    }

    // Imported products appear on an already open list after returning to the tab; no reload button.
    await page.goto(`/t/${slug}/items`);
    await expect(page.getByTestId("items")).toBeVisible();
    const importedId = randomUUID(), importedName = `Canli aktarim ${importedId.slice(0,8)}`;
    try {
      await db("INSERT INTO public.items(tenant_id,id,code,name,base_unit_id) SELECT t.id,$2,$3,$3,u.id FROM tenants t JOIN units u ON u.tenant_id=t.id AND u.code='ADET' WHERE t.slug=$1", [slug,importedId,importedName]);
      await expect(page.getByText(importedName,{exact:true})).toHaveCount(0);
      await page.evaluate("window.dispatchEvent(new Event('focus'))");
      await expect(page.getByText(importedName,{exact:true}).first()).toBeVisible();
      const cardView=page.locator('[data-gorunum=kart]');if(await cardView.isVisible())await cardView.click();
      // Lifecycle state appears through the same live list refresh in all device layouts.
      await db("UPDATE public.items SET source_state='ARCHIVED',source_disposition='PENDING',source_changed_at=clock_timestamp() WHERE id=$1",[importedId]);
      await page.evaluate("window.dispatchEvent(new Event('focus'))");
      await expect(page.getByTestId('item-card').filter({hasText:importedName})).toContainText('ARŞİV BEKLİYOR');
      if(testInfo.project.name==='desktop')for(const width of [390,1180,1440]){
        await page.setViewportSize({width,height:844});
        const card=page.getByTestId('item-card').filter({hasText:importedName});
        await expect(card).toBeVisible();const rect=await card.boundingBox();
        expect((rect?.x??-1)>=0&&(rect?.x??0)+(rect?.width??0)<=width).toBe(true);
        await page.screenshot({path:testInfo.outputPath(`source-pending-${width}.png`)});
      }
      await db("UPDATE public.items SET source_state='DELETED',source_disposition='REMOVED',source_managed_archive=true,status='ARCHIVED',archived_at=clock_timestamp() WHERE id=$1",[importedId]);
      await page.evaluate("window.dispatchEvent(new Event('focus'))");
      await expect(page.getByText(importedName,{exact:true})).toHaveCount(0);
      const removed=page.locator('[data-chip=removed]');await removed.scrollIntoViewIfNeeded();await removed.click();
      await expect(page.getByTestId('item-card').filter({hasText:importedName})).toContainText('KALDIRILDI');

    } finally { await db("DELETE FROM public.items WHERE id=$1",[importedId]); }

    // Reproduce the live report: an old authenticated session must show a useful reason + a working reauth link.
    await page.goto(`/t/${slug}/integrations?bolum=baglanti`);
    await page.getByTestId("oauth-advanced").click();
    await page.getByTestId("oauth-settings-open").click();
    await page.getByTestId("oauth-app-id").fill(F.clientId);
    await page.getByTestId("oauth-app-secret").fill(F.clientSecret);
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
