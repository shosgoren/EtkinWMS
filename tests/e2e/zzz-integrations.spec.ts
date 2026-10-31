// T-991: ERP entegrasyonu uçtan uca — hesap sahibi Entegrasyon ekranında sahte Paraşüt'e (global-setup, 127.0.0.1) bağlanır, bağlı şeridi
// (yalnız şirket adı, sır yok) görür, bir akışı açar (balon + açık durum) ve bağlantıyı sınar. Ayrı fikstür alanı (`E2E_ERP`); sahte bilgiler
// sentetiktir. Masaüstü ve mobil projeler aynı alanı kullanır: bağlıysa test önce bağlantıyı keser (kes penceresi de sınanır).
// T-1133: Etkin'in ortak Paraşüt uygulaması (global-setup sentetik ortam değişkenleri): BAĞLAN → Paraşüt izin ekranı (sahte: yönlendirme
// yakalanır, gerçek ağ yok) → callback → tek şirket → bağlı. Müşteri anahtar alanı görmez; kendi uygulaması "Gelişmiş" satırının içinde.
// T-1137: eski "e-posta + parola ile bağlan" kalktı — ikinci bağlanma da ortak uygulamanın sahte OAuth akışıyla (`connectOAuth`).
// Excel bağlı değilken kaynak listesinde kart; bağlantı sağlığı bandı ve karar bekleyen irsaliye satırı sınanır.
// T-1139: parola yöntemi koddan kalktı; migration 0068'in kestiği bağlantının ekranı (tek bant + tek "Yeniden bağlan" → OAuth) sınanır.
import { randomUUID } from "node:crypto";
import { db } from "./support/package-receiving.ts";
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
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

/** T-1133 ortak uygulama ile bağlan: BAĞLAN → Paraşüt izin ekranı (sahte: yönlendirme yakalanır) → callback → tek şirket → bağlı. */
async function connectOAuth(page: Page, trigger = "integrations-connect"): Promise<URL> {
  let authorize: URL | null = null;
  await page.route("https://api.parasut.com/**", async (route) => {
    authorize = new URL(route.request().url());
    const back = new URL(authorize.searchParams.get("redirect_uri") ?? "about:blank");
    back.search = new URLSearchParams({ code: F.authorizationCode, state: authorize.searchParams.get("state") ?? "" }).toString();
    await route.fulfill({ status: 302, headers: { location: back.href } });
  });
  await page.getByTestId(trigger).filter({ visible: true }).click();
  await expect(page.getByTestId("kalip-toast")).toContainText("Paraşüt bağlantısı kuruldu");
  await page.unroute("https://api.parasut.com/**");
  const auth = authorize as URL | null;
  if (auth === null) throw new Error("e2e: Paraşüt izin isteği görülmedi");
  return auth;
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
    // T-1134 (ALTIN-KURAL 11): kapalı ilk kullanım penceresi klavye sırasında değil (`inert`); birkaç Tab'da kalıp üst çubuğuna ulaşılır.
    await expect(page.locator("dialog.guide-dialog")).toHaveAttribute("inert", "");
    await expect(page.locator("dialog.guide-dialog")).not.toHaveAttribute("open", "");
    let ustCubukta = false;
    for (let i = 0; i < 4 && !ustCubukta; i++) {
      await page.keyboard.press("Tab");
      ustCubukta = await page.evaluate<boolean>('document.activeElement?.closest(".kalip .top") != null && document.activeElement?.closest("dialog") == null');
    }
    expect(ustCubukta, "Tab birkaç adımda kalıp üst çubuğuna ulaşır (gizli pencere içinde dolanmaz)").toBe(true);

    if (await page.getByTestId("integrations-conn").isVisible()) {
      await page.getByTestId("integrations-cut").click();
      await page.getByRole("button", { name: "Bağlantıyı kes" }).click();
      await expect(page.getByTestId("integrations-providers")).toBeVisible();
    }

    // T-1133: ortak uygulama ile bağlan — anahtar alanı yok; BAĞLAN → Paraşüt (sahte izin: yönlendirme yakalanır) → callback → bağlı.
    await expect(page.getByTestId("oauth-app-id")).toHaveCount(0);
    await expect(page.getByTestId("integrations-advanced")).toContainText("Anahtar girmen gerekmez");
    const auth = await connectOAuth(page);
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
    // T-1137: bağlı değilken Excel, kaynak listesinde Paraşüt'ün yanında bir veri kaynağı kartı (ayrı satır yok); mevcut Excel aktarım
    // ekranını açar (aktarma mantığı tek yerde).
    // Tek Excel girişi (aynı test kimliği import.spec'te de kullanılır): bağlı değilken kaynak listesindeki kart.
    await expect(page.getByTestId("integrations-excel")).toHaveCount(1);
    const excel = page.getByTestId("integrations-providers").getByTestId("integrations-excel");
    await expect(excel).toHaveAttribute("data-provider", "EXCEL");
    await expect(excel).toContainText("Excel");
    expect((await excel.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await excel.click();
    await expect(page).toHaveURL(new RegExp(`/t/${slug}/settings/baglantilar$`));
    await page.goto(`/t/${slug}/integrations?bolum=baglanti`);
    // Bağlı değilken akış bölümü boş durum + bağlantıya götüren düğme; alan sahipliği yalnız "Yakında" (sahte denetim yok).
    const bolumler = page.getByTestId("integrations-bolumler");
    await bolumler.locator('[data-bolum="akis"]').click();
    await expect(page).toHaveURL(/bolum=akis/);
    await expect(page.getByTestId("integrations-flows-empty")).toBeVisible();
    // T-1134: form kabındaki boş durum biçimli (başlık / ipucu / düğme alt alta, düğme yazının üstüne binmez; 390 px'te de).
    const bosDuzen = async (where: string): Promise<void> => {
      const bos = page.getByTestId("integrations-flows-empty");
      const r = await bos.evaluate((el) => { const cs = el.ownerDocument.defaultView!.getComputedStyle(el); const b = el.querySelector("b")!.getBoundingClientRect(); const s = el.querySelector("small")!.getBoundingClientRect(); const a = el.querySelector("a.btn")!.getBoundingClientRect(); return { display: cs.display, b: [b.top, b.bottom], s: [s.top, s.bottom], a: [a.top, a.bottom, a.height], w: el.getBoundingClientRect().width }; });
      expect(r.display, `${where}: boş durum sütun`).toBe("flex");
      expect(r.s[0]!, `${where}: ipucu başlığın altında`).toBeGreaterThanOrEqual(r.b[1]! - 0.5);
      expect(r.a[0]!, `${where}: düğme ipucunun altında`).toBeGreaterThanOrEqual(r.s[1]! - 0.5);
      expect(r.a[2]!, `${where}: düğme ≥ 44 px`).toBeGreaterThanOrEqual(44);
    };
    await bosDuzen(testInfo.project.name);
    if (testInfo.project.name === "desktop") {
      await page.setViewportSize({ width: 390, height: 844 });
      await bosDuzen("390");
      await page.screenshot({ path: testInfo.outputPath("akis-bos-390.png") });
      await page.setViewportSize({ width: 1280, height: 800 });
    }
    // T-1134: Alan sahipliği çıkmaz değil — solda YAKINDA rozeti, içeride tek cümle + yön seçimine götüren düğme.
    await expect(bolumler.getByTestId("alt-bolum-sahiplik-soon")).toHaveText("YAKINDA");
    await bolumler.locator('[data-bolum="sahiplik"]').click();
    await expect(page.getByTestId("integrations-sahiplik-soon")).toBeVisible();
    await expect(page.getByTestId("integrations-sahiplik-soon")).toContainText("Alan sahipliği yakında");
    await expect(page.getByTestId("integrations-sahiplik-soon")).not.toContainText("gelecekYAKINDA");
    await expect(page.getByTestId("integrations-sahiplik-soon").getByTestId("kalip-empty-action")).toHaveAttribute("href", /bolum=akis$/);
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
    // T-1137/T-1139: parola yöntemine giriş yok (ne bu formda ne ekranda); sunucu eylemi de yok (int test).
    await expect(page.getByTestId("oauth-legacy")).toHaveCount(0);
    await expect(page.getByTestId("integrations-form")).toHaveCount(0);
    await page.goto(`/t/${slug}/integrations?bolum=baglanti`);
    await expect(page.getByTestId("integrations-password")).toHaveCount(0);
    await connectOAuth(page);

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
    await expect(siparis).toContainText("sipariş yok");
    await expect(siparis.getByRole("radio")).toHaveCount(1);
    await expect(siparis.getByRole("radio", { name: "Yalnız Etkin WMS" })).toHaveAttribute("aria-checked", "true");

    // T-1136: dolu katalog — her koşuda yeni, Paraşüt'e eşlenmemiş bir ürün (öteki proje / önceki koşu eskilerini eşlemiş olabilir).
    const yonKodu = `E2E-YON-${randomUUID().slice(0, 8)}`;
    await db("INSERT INTO public.items (tenant_id, id, code, name, base_unit_id) SELECT t.id, gen_random_uuid(), $2, $2, (SELECT u.id FROM public.units u WHERE u.tenant_id = t.id AND u.status = 'ACTIVE' ORDER BY (u.code = 'ADET') DESC, u.code LIMIT 1) FROM public.tenants t WHERE t.slug = $1", [slug, yonKodu]);
    // Ürün kartları: "Paraşüt'ten al" açar (balon), "İki yönlü" yönü değiştirir (kalıcı), "Yalnız Etkin WMS" kapatır. T-1136: her seçimin
    // altında sonucu tek cümle; dolu katalogda yeni "al" / yeni "gönder" önce onay sorar (Vazgeç eski yönü korur, Evet kaydeder).
    const urun = page.getByTestId("flow-PRODUCTS");
    const sonuc = page.getByTestId("flow-PRODUCTS-sonuc");
    const sonucMetin = sonuc.locator(":scope > span"); // simge / Etkin "e" işareti hariç, yalnız cümle
    const onayAl = page.getByRole("dialog", { name: "Ürün kartları: Paraşüt'ten al?" });
    await expect(urun).toHaveAttribute("data-enabled", "false");
    await expect(sonucMetin).toHaveText("Eşitleme yapılmaz.");
    await expect(page.getByTestId("flow-WAREHOUSES-sonuc")).toBeVisible();
    await expect(page.getByTestId("flow-STOCK-sonuc")).toHaveCount(0);
    await urun.getByRole("radio", { name: "Paraşüt'ten al" }).click();
    await expect(onayAl).toBeVisible();
    await expect(onayAl).toContainText(/Sende [\d.]+ ürün var\. Paraşüt'teki ürünler stok koduna göre bunlarla eşleşir, eşleşmeyenler yeni kart olur; bağlı kartların adı Paraşüt'tekiyle güncellenir, Paraşüt'te silinen ya da arşivlenen ürünler burada arşive alınır\./);
    await expect(onayAl.getByRole("button", { name: "Evet, Paraşüt'ten al" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("yon-onay.png") });
    await onayAl.getByRole("button", { name: "Vazgeç" }).click();
    await expect(onayAl).toBeHidden();
    await expect(urun).toHaveAttribute("data-enabled", "false");
    await expect(urun.getByRole("radio", { name: "Yalnız Etkin WMS" })).toHaveAttribute("aria-checked", "true");
    await expect(sonucMetin).toHaveText("Eşitleme yapılmaz.");
    await urun.getByRole("radio", { name: "Paraşüt'ten al" }).click();
    await onayAl.getByRole("button", { name: "Evet, Paraşüt'ten al" }).click();
    await expect(urun).toHaveAttribute("data-enabled", "true");
    await expect(page.getByTestId("kalip-toast")).toContainText("Ürün kartları açıldı");
    await expect(urun.getByRole("radio", { name: "Paraşüt'ten al" })).toHaveAttribute("aria-checked", "true");
    await expect(sonucMetin).toHaveText("Paraşüt'ten gelir, ona uyar; buradan gitmez.");
    await expect(page.getByTestId("flow-PRODUCTS-run")).toBeVisible();
    await expect(page.getByTestId("flow-PRODUCTS-toggle")).not.toHaveAttribute("aria-busy", "true");
    // Al → iki yönlü: eşlenmemiş yerel ürün (yukarıdaki) Paraşüt'e gidecek → onay.
    await urun.getByRole("radio", { name: "İki yönlü" }).click();
    const onayIki = page.getByRole("dialog", { name: "Ürün kartları: İki yönlü?" });
    await expect(onayIki).toContainText("Paraşüt'e gönderilir");
    await onayIki.getByRole("button", { name: "Evet, iki yönlü yap" }).click();
    await expect(page.getByTestId("kalip-toast")).toContainText("Ürün kartları: İki yönlü");
    await expect(sonucMetin).toHaveText("Eksikler eklenir; çakışmada Paraşüt kazanır.");
    await page.reload();
    await expect(urun.getByRole("radio", { name: "İki yönlü" })).toHaveAttribute("aria-checked", "true");
    await expect(urun).toHaveAttribute("data-enabled", "true");
    await urun.getByRole("radio", { name: "Yalnız Etkin WMS" }).click();
    await expect(urun).toHaveAttribute("data-enabled", "false");
    await expect(page.getByTestId("kalip-toast")).toContainText("Ürün kartları kapandı");
    await expect(urun.getByRole("radio", { name: "Yalnız Etkin WMS" })).toHaveAttribute("aria-checked", "true");
    await page.reload();
    await expect(urun).toHaveAttribute("data-enabled", "false");
    // T-1134: telefon ölçüleri — yön düğmeleri üç satıra kırılmaz (≥ 140 px, ≤ 2 satır), içerik alanı alt çubuğun üstünde biter (sayfa
    // kaymaz, yalnız bölüm kayar), "Şimdi çalıştır" ≥ 44 px.
    const telefonOlc = async (where: string): Promise<void> => {
      const yon = await page.getByTestId("flow-PRODUCTS-toggle").locator("button").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height }; }));
      expect(yon.length).toBe(4);
      for (const b of yon) {
        expect(b.w, `${where}: yön düğmesi geniş`).toBeGreaterThanOrEqual(140);
        expect(b.h, `${where}: yön düğmesi en çok iki satır`).toBeLessThanOrEqual(64);
      }
      const o = await page.evaluate<{ innerBottom: number; dockTop: number; docSw: number; docCw: number; docSh: number; winH: number }>(`(() => { const inner = document.querySelector(".dzf .inner").getBoundingClientRect(); const dock = document.querySelector('[data-testid="kabuk-dock"]').getBoundingClientRect(); return { innerBottom: inner.bottom, dockTop: dock.top, docSw: document.documentElement.scrollWidth, docCw: document.documentElement.clientWidth, docSh: document.documentElement.scrollHeight, winH: window.innerHeight }; })()`);
      expect(o.innerBottom, `${where}: içerik alanı alt çubuğun üstünde biter`).toBeLessThanOrEqual(o.dockTop + 1);
      expect(o.docSh, `${where}: sayfa gövdesi kaymaz`).toBeLessThanOrEqual(o.winH);
      expect(o.docSw).toBeLessThanOrEqual(o.docCw);
      const run = await page.getByTestId("flow-PRODUCTS-run").boundingBox();
      expect(run?.height ?? 0, `${where}: Şimdi çalıştır ≥ 44 px`).toBeGreaterThanOrEqual(44);
      // T-1136: sonuç cümlesi satırın içinde kalır ve en çok iki satırdır (390 px'te çoğunlukla tek satır).
      const not = await sonuc.boundingBox();
      const satir = await urun.boundingBox();
      if (not === null || satir === null) throw new Error("e2e: sonuç cümlesi ölçülemedi");
      expect(not.height, `${where}: sonuç cümlesi en çok iki satır`).toBeLessThanOrEqual(36);
      expect(not.x + not.width, `${where}: sonuç cümlesi satırdan taşmaz`).toBeLessThanOrEqual(satir.x + satir.width + 1);
    };
    await urun.getByRole("radio", { name: "Paraşüt'ten al" }).click();
    await onayAl.getByRole("button", { name: "Evet, Paraşüt'ten al" }).click();
    await expect(urun).toHaveAttribute("data-enabled", "true");
    await expect(page.getByTestId("flow-PRODUCTS-run")).toBeVisible();
    await expect(page.getByTestId("flow-PRODUCTS-toggle")).not.toHaveAttribute("aria-busy", "true");
    if (testInfo.project.name === "mobile") await telefonOlc("mobile");
    // Telefon genişliğinde alt bölüm listesi kartın üstünde yatay çip satırı; sayfa yatay kaymaz.
    if (testInfo.project.name === "desktop") {
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(bolumler.locator("nav")).toBeVisible();
      await expect(page.getByTestId("integrations-flows")).toBeVisible();
      await telefonOlc("390");
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
    // T-1134: "Nasıl kullanırım" › Ürünleri aktar › Paraşüt ile — bağlıyken ilk adım kendiliğinden biter; akış adımının deliği Ürün
    // kartları SATIRINDA (perde satırın ortasını örtmez), metin yönü söyler; yön seçilince eşitle adımına geçer.
    // Önceki yön kaydı bitmeden yeni seçim yok sayılır (aynı işlem iki kez gönderilmez): önce iş bitsin.
    await expect(page.getByTestId("flow-PRODUCTS-toggle")).not.toHaveAttribute("aria-busy", "true");
    await urun.getByRole("radio", { name: "Yalnız Etkin WMS" }).click();
    await expect(urun).toHaveAttribute("data-enabled", "false");
    // Kapatma sunucuya yazılmadan rehber açılırsa sayfa sunucunun eski "açık" verisiyle yeniden çizilir ve akış adımı kendiliğinden geçer
    // (telefonda prepush koşusunda görüldü): kayıt bitsin, balon gelsin.
    await expect(page.getByTestId("flow-PRODUCTS-toggle")).not.toHaveAttribute("aria-busy", "true");
    await expect(page.getByTestId("kalip-toast")).toContainText("Ürün kartları kapandı");
    await page.getByTestId("operation-guide-trigger").first().click();
    await expect(page.getByTestId("guide-picker")).toBeVisible();
    await page.getByTestId("adim-basla-urun-PARASUT").click();
    const rehber = page.getByTestId("adim-rehber");
    await expect(rehber).toHaveAttribute("data-step", "akis_urun");
    await expect(page.getByTestId("adim-metin")).toContainText("Ürün kartları için yönü seç");
    const perde = page.getByTestId("kalip-perde");
    await expect(perde).toHaveAttribute("style", /path\(evenodd/);
    await expect.poll(async () => page.evaluate<boolean>(`(() => { const r = document.querySelector('[data-testid="flow-PRODUCTS"]').getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return el?.closest('[data-testid="flow-PRODUCTS"]') != null && el?.closest('[data-testid="kalip-perde"]') == null; })()`), "delik Ürün kartları satırını açık bırakır").toBe(true);
    await urun.getByRole("radio", { name: "Paraşüt'ten al" }).click();
    await onayAl.getByRole("button", { name: "Evet, Paraşüt'ten al" }).click();
    await expect(rehber).toHaveAttribute("data-step", "esitle");
    await page.getByTestId("adim-kapat").first().click();
    await expect(rehber).toHaveCount(0);
    // Bekleyenler ve hatalar: son koşular listesi bu bölümde.
    await bolumler.locator('[data-bolum="hatalar"]').click();
    await expect(page.getByTestId("integrations-runs")).toBeVisible();

    await bolumler.locator('[data-bolum="baglanti"]').click();
    await expect(page).toHaveURL(/bolum=baglanti/);
    const conn = page.getByTestId("integrations-conn");
    await expect(conn).toBeVisible();
    await expect(conn).toContainText(F.companyName);
    await expect(conn).toHaveAttribute("data-status", "CONNECTED");
    // T-1134: bağlıyken bağlantı bölümünde eski "AÇ / KAPAT · YÖNÜ SEÇ · GERİSİ KENDİLİĞİNDEN" ipucu yok; "SON SINAMA" yerine "SON KONTROL".
    await expect(page.getByTestId("integrations-baglanti")).not.toContainText("GERİSİ KENDİLİĞİNDEN");
    await expect(page.getByTestId("integrations-baglanti")).not.toContainText("SON SINAMA");
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
    // T-1137: bağlantı sağlığı bandı — OAuth ile bağlı: ok bandı. Bağlantı koparsa (401 / yeniden giriş) bant kırmızı,
    // tek cümle + tek sonraki adım "Yeniden bağlan" (≥ 44 px); "Bağlantı ve veri kaynağı" rozet alır. Durum sentetik olarak kurulur, geri alınır.
    await expect(page.getByTestId("integrations-health")).toBeVisible();
    await expect(page.getByTestId("integrations-health")).toHaveAttribute("data-level", "ok");
    const tenantIntegration = "(SELECT i.id FROM public.integrations i JOIN public.tenants t ON t.id = i.tenant_id WHERE t.slug = $1 AND i.provider = 'PARASUT')";
    try {
      await db(`UPDATE public.integrations SET status = 'ERROR', last_error_code = 'REAUTH_REQUIRED' WHERE id = ${tenantIntegration}`, [slug]);
      await page.reload();
      // Bağlantı bölümünde kopma bağlantı satırının kendisidir (çift bant yok); sağlık bandı akış bölümünün üstünde.
      await expect(page.getByTestId("integrations-conn")).toHaveAttribute("data-status", "ERROR");
      await expect(page.getByTestId("integrations-reconnect")).toBeVisible();
      await expect(page.getByTestId("integrations-health")).toHaveCount(0);
      await expect(bolumler.getByTestId("alt-bolum-baglanti-badge")).toHaveText("1");
      await bolumler.locator('[data-bolum="akis"]').click();
      const band = page.getByTestId("integrations-health-akis");
      await expect(band).toHaveAttribute("data-cause", "AUTH");
      await expect(band).toContainText("Paraşüt bağlantısı koptu");
      await expect(band).toContainText("Paraşüt yeniden giriş istiyor");
      const next = page.getByTestId("integrations-health-akis-next");
      await expect(next).toHaveAttribute("data-next", "RECONNECT");
      await expect(next).toContainText("Yeniden bağlan");
      await expect(next).toBeVisible();
      await expect.poll(async () => (await next.boundingBox())?.height ?? 0, { message: "Yeniden bağlan ≥ 44 px" }).toBeGreaterThanOrEqual(44);
      if (testInfo.project.name === "desktop") await page.screenshot({ path: testInfo.outputPath("health-auth-1280.png") });
    } finally {
      await db(`UPDATE public.integrations SET status = 'CONNECTED', last_error_code = NULL WHERE id = ${tenantIntegration}`, [slug]);
    }

    // T-1137: karar bekleyen irsaliye (Paraşüt yanıt vermedi → CHECK): satırda Yeniden gönder / Gönderildi say / Gönderme; çift irsaliye
    // riski olan yeniden gönderim onay ister. Satırlar sentetik (rastgele belge kimliği); test sonunda silinir.
    const tenantId = (await db<{ id: string }>("SELECT id FROM public.tenants WHERE slug = $1", [slug]))[0]!.id;
    const rowIds = [randomUUID(), randomUUID()];
    try {
      for (const id of rowIds) {
        await db(`INSERT INTO public.integration_outbox (tenant_id, id, integration_id, flow, entity_type, entity_id) VALUES ($1, $2, ${tenantIntegration.replace("$1", "$3")}, 'SHIPMENTS', 'DOCUMENT', $4)`, [tenantId, id, slug, randomUUID()]);
        await db("UPDATE public.integration_outbox SET status = 'CHECK', last_error_code = 'UNCERTAIN' WHERE id = $1", [id]);
      }
      await page.goto(`/t/${slug}/integrations?bolum=hatalar`);
      const issue = (id: string) => page.locator(`[data-testid="integration-issue"][data-id="${id}"]`);
      await expect(issue(rowIds[0]!)).toHaveAttribute("data-status", "CHECK");
      await expect(issue(rowIds[0]!)).toContainText("PARAŞÜT YANIT VERMEDİ");
      for (const b of ["issue-retry", "issue-sent", "issue-skip"]) {
        await expect(issue(rowIds[0]!).getByTestId(b)).toBeVisible();
        await expect.poll(async () => (await issue(rowIds[0]!).getByTestId(b).boundingBox())?.height ?? 0, { message: `${b} ≥ 44 px` }).toBeGreaterThanOrEqual(44);
      }
      await issue(rowIds[0]!).getByTestId("issue-retry").click();
      const resend = page.getByRole("dialog").filter({ hasText: "yeniden gönderilsin mi?" });
      await expect(resend).toBeVisible();
      await resend.getByRole("button", { name: "Yeniden gönder" }).click();
      await expect(page.getByTestId("kalip-toast")).toContainText(/Sıraya alındı|Bir sonraki eşitlemede/);
      await expect(issue(rowIds[0]!)).toHaveCount(0);
      expect((await db<{ status: string }>("SELECT status FROM public.integration_outbox WHERE id = $1", [rowIds[0]]))[0]?.status).toBe("PENDING");
      await issue(rowIds[1]!).getByTestId("issue-sent").click();
      await page.getByRole("dialog").filter({ hasText: "gönderildi sayılsın mı?" }).getByRole("button", { name: "Gönderildi say" }).click();
      await expect(page.getByTestId("kalip-toast")).toContainText("Gönderildi sayıldı");
      await expect(issue(rowIds[1]!)).toHaveCount(0);
      expect(await db("SELECT status, last_error_code FROM public.integration_outbox WHERE id = $1", [rowIds[1]])).toEqual([{ status: "FAILED", last_error_code: "MANUAL_SENT" }]);
      if (testInfo.project.name === "mobile") {
        const o = await page.evaluate<{ sh: number; h: number }>("({ sh: document.documentElement.scrollHeight, h: window.innerHeight })");
        expect(o.sh, "telefonda sayfa kaymaz, yalnız bölüm kayar").toBeLessThanOrEqual(o.h);
      }
    } finally {
      await db("DELETE FROM public.integration_outbox WHERE id = ANY($1::uuid[])", [`{${rowIds.join(",")}}`]);
    }
    await page.goto(`/t/${slug}/integrations?bolum=baglanti`);

    await page.getByTestId("integrations-test").click();
    await expect(page.getByTestId("kalip-toast")).toContainText("Bağlantı sağlam");

    // T-1139: migration 0068'in eski yöntem bağlantısına yaptığı durum sentetik kurulur (DISCONNECTED + kimlik yok + LEGACY_METHOD_REMOVED,
    // webhook anahtarları silinmiş). Ekran: bağlı değil; Paraşüt kartının yerinde tek kırmızı bant ve tek "Yeniden bağlan"; Excel kartı durur;
    // Bağlantı bölümünde rozet. Düğme OAuth'u başlatır; yeniden bağlanınca bağlı şerit döner.
    await db(`UPDATE public.integration_webhooks SET status = 'DELETED', key_box = NULL WHERE integration_id = ${tenantIntegration} AND status = 'ACTIVE'`, [slug]);
    await db(`UPDATE public.integrations SET status = 'DISCONNECTED', credentials = NULL, last_error_code = 'LEGACY_METHOD_REMOVED', webhook_status = 'OFF', webhook_checked_at = NULL WHERE id = ${tenantIntegration}`, [slug]);
    await page.goto(`/t/${slug}/integrations?bolum=baglanti`);
    const renew = page.getByTestId("integrations-health");
    await expect(renew).toHaveAttribute("data-cause", "AUTH");
    await expect(renew).toHaveAttribute("data-code", "LEGACY_METHOD_REMOVED");
    await expect(renew).toContainText("Paraşüt bağlantısı yenilendi; devam etmek için yeniden bağlan.");
    await expect(page.getByTestId("integrations-conn")).toHaveCount(0);
    await expect(page.getByTestId("provider-PARASUT")).toHaveCount(0);
    await expect(page.getByTestId("integrations-excel")).toBeVisible();
    await expect(page.getByTestId("integrations-baglanti").getByRole("button", { name: "Yeniden bağlan" })).toHaveCount(1);
    await expect(page.getByTestId("integrations-bolumler").getByTestId("alt-bolum-baglanti-badge")).toHaveText("1");
    const renewNext = page.getByTestId("integrations-health-next");
    await expect(renewNext).toHaveAttribute("data-next", "RECONNECT");
    await expect.poll(async () => (await renewNext.boundingBox())?.height ?? 0, { message: "Yeniden bağlan ≥ 44 px" }).toBeGreaterThanOrEqual(44);
    if (testInfo.project.name === "desktop") await page.screenshot({ path: testInfo.outputPath("legacy-renew-1280.png") });
    await expect(renew).not.toContainText(/parola/i);
    await expect(page.getByText("Yeni yönteme geç")).toHaveCount(0);
    await connectOAuth(page, "integrations-health-next");
    await expect(page.getByTestId("integrations-conn")).toHaveAttribute("data-status", "CONNECTED");
    expect((await db<{ code: string | null }>(`SELECT last_error_code AS code FROM public.integrations WHERE id = ${tenantIntegration}`, [slug]))[0]?.code).toBeNull();
    // Kendi uygulaması, eski yetki kodu yöntemiyle (OOB): anahtarlar kaydedilir, bağlan → kod formu.
    await page.getByTestId("oauth-advanced").click();
    await page.getByTestId("oauth-settings-open").click();
    await page.getByTestId("oauth-app-id").fill(F.clientId);
    await page.getByTestId("oauth-app-secret").fill(F.clientSecret);
    await page.getByTestId("oauth-oob-toggle").click();
    await expect(page.getByTestId("oauth-callback")).toHaveValue("urn:ietf:wg:oauth:2.0:oob");
    // Kopyala, seçili yöntemde GÖSTERİLEN adresi kopyalar (OOB → URN; PR inceleme bulgusu).
    if (testInfo.project.name === "desktop") {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
      await page.getByTestId("oauth-copy").click();
      await expect(page.getByTestId("oauth-copy")).toContainText("Kopyalandı");
      expect(await page.evaluate("navigator.clipboard.readText()")).toBe("urn:ietf:wg:oauth:2.0:oob");
    }
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
