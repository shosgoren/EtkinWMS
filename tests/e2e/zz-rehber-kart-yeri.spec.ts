// T-1130 (kullanıcı 29 Ekim, iPhone: "rehber yine ilgili alanın üstünde kalmış; başka yerlerde varsa hepsini düzelt"). Rehber kartı
// kullanıcıya yaptırdığı yeri (alan, düğme) hiçbir görünümde örtmez ve o yer görünen alanda (alt çubuğun üstünde) kalır:
// - kurulum yolculuğu "Depo ve raflar" adımı: DEPO EKLE (alt çubuk) ve açılan "Yeni depo" formunda "Depo adı" alanı + KAYDET;
// - işlem rehberi (stok çıkışı): her adımın hedef alanı ve son adımda ana işlem.
// Projenin kendi görünümü (masaüstü 1280×800, mobil 393×727), telefon 390×844 ve kısa telefon 390×660 (Safari çubukları açıkken görünen
// yükseklik). Kayıt yapılmaz (form kaydedilmez; ortak demo verisi değişmez).
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { enterDemoShared } from "./support/demo-session.ts";
import { loginEmptyTenant, scrubSecretInputs } from "./support/empty-tenant.ts";

const OUT = path.resolve("tests/.artifacts/t-1130");

type Kutu = { x: number; y: number; width: number; height: number };
const yaz = (k: Kutu): string => `${Math.round(k.x)},${Math.round(k.y)} ${Math.round(k.width)}×${Math.round(k.height)}`;

/** Kart hedefi örtmüyor ve hedef görünen alanda; hedef alt çubuğun ana işlemi değilse alt çubuğun da üstünde. */
async function ortmez(page: Page, kart: Locator, hedef: Locator, ad: string): Promise<void> {
  const cubuk = page.getByTestId("kabuk-dock").first();
  await expect
    .poll(
      async () => {
        const k = await kart.boundingBox();
        const h = await hedef.boundingBox();
        const vp = page.viewportSize();
        if (k === null || h === null || vp === null) return "ölçülemedi";
        if (k.x < h.x + h.width && h.x < k.x + k.width && k.y < h.y + h.height && h.y < k.y + k.height) return `örtüşüyor: kart ${yaz(k)} · hedef ${yaz(h)}`;
        if (h.y < 0 || h.y + h.height > vp.height) return `hedef görünmüyor: ${yaz(h)} · görünüm ${vp.width}×${vp.height}`;
        if (k.y < 0 || k.y + k.height > vp.height) return `kart görünmüyor: ${yaz(k)}`;
        const ana = await hedef.evaluate((el) => el.closest('[data-testid="kabuk-dock"]') !== null);
        const c = await cubuk.boundingBox();
        if (!ana && c !== null && h.y + h.height > c.y) return `hedef alt çubuğun altında: ${yaz(h)} · çubuk ${yaz(c)}`;
        if (c !== null && k.y + k.height > c.y && k.y < c.y + c.height && k.x < c.x + c.width && c.x < k.x + k.width) return `kart alt çubuğu örtüyor: ${yaz(k)}`;
        return "tamam";
      },
      { message: ad, timeout: 8000 },
    )
    .toBe("tamam");
}

function boyAdi(page: Page, proje: string): string {
  const vp = page.viewportSize();
  return vp === null ? proje : `${proje}-${vp.width}x${vp.height}`;
}

/** Kurulum yolculuğu "Depo ve raflar" adımı, verilen görünümlerde sırayla (tek giriş: aynı kiracıya art arda giriş MFA'da reddedilebiliyor). */
async function kurulumYeniDepo(page: Page, proje: string, boyutlar: readonly ({ width: number; height: number } | null)[]): Promise<void> {
  test.setTimeout(240000);
  mkdirSync(OUT, { recursive: true });
  const device = proje === "mobile" ? "MOBILE" : "DESKTOP";
  for (const key of ["SLUG", "EMAIL", "PASSWORD", "TOTP_SECRET"]) {
    const value = process.env[`E2E_TOUR_YER_${device}_${key}`];
    if (!value) throw new Error("e2e: rehber kart yeri fikstürü yok");
    process.env[`E2E_TOUR_${key}`] = value;
  }
  const { slug } = await loginEmptyTenant(page, "tour", { keepTour: true });
  for (const boyut of boyutlar) {
    if (boyut !== null) await page.setViewportSize(boyut);
    await yeniDepoAdimi(page, proje, slug);
  }
}

async function yeniDepoAdimi(page: Page, proje: string, slug: string): Promise<void> {
  await page.goto(`/t/${slug}`);
  await expect.poll(() => page.getByTestId("yol-layer").getAttribute("data-state")).toMatch(/^(on|off)$/);
  if (await page.getByTestId("yol-close").isVisible()) {
    await page.getByTestId("yol-close").click();
    await expect(page.getByTestId("yol-coach")).toBeHidden();
  }
  await page.goto(`/t/${slug}`);
  await page.getByTestId("yol-card").click();
  await page.getByTestId("yol-start-shelves").click();
  await expect(page.getByTestId("yol-coach")).toHaveAttribute("data-step", "shelves");
  const kart = page.getByTestId("yol-kart");
  await expect(kart).toBeVisible();
  // 1. DEPO EKLE (alt çubuğun ana işlemi) örtülmez.
  const ana = page.locator('[data-tour="main"]').first();
  await ortmez(page, kart, ana, "DEPO EKLE");
  await ana.click();
  // 2. "Yeni depo" formu: kart "Depo adı" alanını (etiketiyle) ve KAYDET'i örtmez.
  const form = page.getByTestId("warehouse-form");
  await expect(form).toBeVisible();
  await expect(page.getByTestId("yol-metin")).toContainText("KAYDET");
  const ad = form.locator('label:has(input[name="name"])').first();
  // Teslim görüntüsü (kart yerine oturduktan sonra; ölçüm aşağıda bekleme koşuluyla). Başsız Chromium görüntüsü delikli buzlu perdeyi
  // (backdrop-filter + clip-path) bütün sayfayı örten gri katman olarak çiziyor; görüntüde yalnız perde gizlenir (kart ve form görünür).
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, `${boyAdi(page, proje)}-yeni-depo.png`), animations: "disabled", style: ".kperde { display: none !important; }" });
  await ortmez(page, kart, ad, "Depo adı");
  await ortmez(page, kart, page.locator('[data-tour="main"]').first(), "KAYDET");
  // 3. Alana dokunup yazınca (telefonda klavye) kart yine alanı örtmez.
  const girdi = form.locator('input[name="name"]').first();
  await girdi.click();
  await girdi.fill(`QA yer ${proje}`);
  await ortmez(page, kart, ad, "Depo adı (yazarken)");
  // Kaydedilmez: yolculuk kapatılır, form bırakılır.
  await page.getByTestId("yol-close").click();
  await expect(page.getByTestId("yol-coach")).toBeHidden();
}

/** `odak`: hedef görünen alana kartla birlikte sığmayacak kadar uzunsa (klavye açık) yalnız odaktaki alan denetlenir (rehber onu odaklar). */
async function islemRehberi(page: Page, odak = false): Promise<void> {
  await page.goto("/");
  await enterDemoShared(page, "Yönetici");
  await page.goto("/t/demo/stock/documents?new=STOCK_OUT");
  await page.getByTestId("operation-guide-trigger").first().click();
  const kart = page.getByTestId("working-guide");
  await expect(kart).toHaveAttribute("data-folded", "false");
  const adimlar: readonly [string, readonly string[]][] = [
    ["source", ['[data-guide="source"]']],
    ["item", ['[data-guide="item"]']],
    ["quantity", ['[data-guide="quantity"]', '[data-guide="reason"]']],
    ["issueSummary", ['[data-tour="main"]']],
  ];
  for (const [i, [adim, hedefler]] of adimlar.entries()) {
    await expect(kart).toHaveAttribute("data-step", adim);
    if (odak) await ortmez(page, kart, page.locator(":focus"), `${adim}: odaktaki alan`);
    else for (const sel of hedefler) await ortmez(page, kart, page.locator(sel).filter({ visible: true }).first(), `${adim}: ${sel}`);
    if (i < adimlar.length - 1) await page.getByTestId("guide-next").click();
  }
  await page.getByTestId("guide-close").first().click();
  await expect(kart).toHaveCount(0);
}

if (!process.env.E2E_BASE_URL?.trim()) {
  test.use({ trace: "off", actionTimeout: 15000 });
  test.afterEach(async ({ page }) => {
    await scrubSecretInputs(page);
  });

  test.describe("projenin görünümü", () => {
    test.use({ extraHTTPHeaders: { "x-e2e-client-ip": "198.51.100.234" } });
    test("kurulum yolculuğu Yeni depo (proje görünümü, 390×844, 390×660, 390×420): kart Depo adı alanını ve KAYDET'i örtmez", async ({ page }, info) => {
      await kurulumYeniDepo(page, info.project.name, [null, { width: 390, height: 844 }, { width: 390, height: 660 }, { width: 390, height: 420 }]);
    });
    test("işlem rehberi stok çıkışı: kart hiçbir adımın hedefini örtmez", async ({ page }) => {
      await islemRehberi(page);
    });
  });

  test.describe("telefon 390×844", () => {
    test.use({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "x-e2e-client-ip": "198.51.100.235" } });
    test("işlem rehberi stok çıkışı: kart hiçbir adımın hedefini örtmez", async ({ page }) => {
      await islemRehberi(page);
    });
  });

  test.describe("kısa telefon 390×660 (Safari çubukları açık)", () => {
    test.use({ viewport: { width: 390, height: 660 }, extraHTTPHeaders: { "x-e2e-client-ip": "198.51.100.236" } });
    test("işlem rehberi stok çıkışı: kart hiçbir adımın hedefini örtmez", async ({ page }) => {
      await islemRehberi(page);
    });
  });

  // T-1130 (Codex P2): telefon klavyesi açıkken görünen alan ~420 px; kalıp formunun alanları sabit kabuğun (.dzf) içindeki kayan .inner'da
  // olduğundan kart için .inner kaydırılır (alanlar "sabit" sayılırsa kaydırma hesaplanmaz, aşağıdaki alan kartın altında ya da dışarıda kalır).
  test.describe("klavye açık telefon 390×420", () => {
    test.use({ viewport: { width: 390, height: 420 }, extraHTTPHeaders: { "x-e2e-client-ip": "198.51.100.237" } });
    test("işlem rehberi stok çıkışı: kart odaktaki alanı örtmez, alan görünür (kayan .inner kaydırılır)", async ({ page }) => {
      await islemRehberi(page, true);
    });
  });
}
