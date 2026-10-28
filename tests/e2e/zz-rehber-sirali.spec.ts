// T-1124 (kullanıcı 28 Ekim: "rehber işi yaptırmıyor, sırasıyla doldurulacak yere odaklanmıyor; bir bölümün rehberini açınca kaldığım
// yerden devam edemiyorum, başka bölüme geçince tamamen kapanıyor"). İşlem rehberi her adımda doğru alanı delikte gösterir ve klavye odağını
// o alana verir; alan doldurulunca kendiliğinden sıradaki alana geçer. Başka bölüme geçince rehber kapanmaz, yüzen simgeye katlanır:
// "Kaldığın yerden devam" aynı adıma döner, "Başka bölüm" seçiciyi açar; ikinci rehber başlarken birincinin adımı hatırlanır.
// Masaüstü ve mobil projelerde koşar; stok kaydı yapılmaz (ortak demo verisi değişmez).
import { expect, test, type Page } from "@playwright/test";
import { enterDemoShared } from "./support/demo-session.ts";

const TRANSFER = "/t/demo/stock/documents?new=TRANSFER";

async function sec(page: Page, ad: string): Promise<void> {
  const kutu = page.getByRole("searchbox", { name: ad, exact: true });
  await expect(kutu, `${ad}: rehber odağı bu alanda`).toBeFocused();
  // Arama sonucu seçilir (yalnız yazmak seçim yerine geçmez).
  await kutu.fill("");
  await kutu.pressSequentially("a", { delay: 30 });
  const secenek = page.getByRole("option").first();
  await expect(secenek).toBeVisible();
  await secenek.click();
}

async function hedefDelikte(page: Page, secici: string): Promise<void> {
  // Hedef görünür ve buzlu perdede onun çevresi açık (delik).
  await expect(page.locator(secici).first()).toBeVisible();
  await expect(page.getByTestId("kalip-perde")).toHaveAttribute("style", /path\(evenodd/);
  const kutu = await page.locator(secici).first().boundingBox();
  expect(kutu, `${secici}: ölçülebilir`).not.toBeNull();
  // Deliğin içinde perde yoktur: hedefin ortasındaki öğe perde değildir.
  const x = Math.round(kutu!.x + Math.min(20, kutu!.width / 2));
  const y = Math.round(kutu!.y + kutu!.height / 2);
  const ust = await page.evaluate(`document.elementFromPoint(${x}, ${y})?.getAttribute("data-testid") ?? ""`);
  expect(ust).not.toBe("kalip-perde");
}

test("T-1124 stok çıkışı rehberi: her adım doğru alanı odaklar, doldurunca sıradakine geçer", async ({ page }) => {
  await page.goto("/");
  await enterDemoShared(page, "Yönetici");
  await page.goto("/t/demo/stock/documents?new=STOCK_OUT");
  await page.getByTestId("operation-guide-trigger").first().click();
  const kart = page.getByTestId("working-guide");
  await expect(kart).toHaveAttribute("data-step", "source");
  await expect(kart).toContainText("Adım 1/5");
  await hedefDelikte(page, '[data-guide="source"]');

  // 1. Kaynak: depo → raf (raf alanı depo seçilince açılır; odak kendiliğinden ona geçer).
  await sec(page, "Depo");
  await sec(page, "Konum");
  await expect(kart).toHaveAttribute("data-step", "item");
  await expect(kart).toContainText("Adım 2/5");
  await hedefDelikte(page, '[data-guide="item"]');

  // 2. Ürün.
  await sec(page, "Ürün");
  await expect(kart).toHaveAttribute("data-step", "quantity");

  // 3. Miktar ve açıklama: odak miktarda; ikisi de dolunca sonraki adıma geçer (yazarken ilerlemez).
  const miktar = page.locator('input[data-guide="quantity"]');
  await expect(miktar).toBeFocused();
  await hedefDelikte(page, 'input[data-guide="quantity"]');
  await miktar.pressSequentially("12", { delay: 40 });
  await expect(miktar).toHaveValue("12");
  await expect(kart).toHaveAttribute("data-step", "quantity");
  await page.getByLabel(/İşlem açıklaması/).fill("Rehber deneme");
  await expect(kart).toHaveAttribute("data-step", "issueSummary");
  await expect(kart).toContainText("Adım 4/5");

  // 4. Özet + ana işlem delikte; odak alt çubuğun ana işleminde (kayıt yapılmaz: ortak demo verisi değişmez).
  await expect(page.locator('[data-tour="main"]').first()).toBeFocused();
  await hedefDelikte(page, '[data-tour="main"]');
  await page.getByTestId("guide-close").first().click();
  await expect(kart).toHaveCount(0);
});

test("T-1124 transfer rehberi: kaynak seçilince hedef alana geçer; aynı depo hedef sayılmaz (adım ilerlemez)", async ({ page }) => {
  await page.goto("/");
  await enterDemoShared(page, "Yönetici");
  await page.goto(TRANSFER);
  await page.getByTestId("operation-guide-trigger").first().click();
  const kart = page.getByTestId("working-guide");
  await expect(kart).toHaveAttribute("data-step", "source");
  await sec(page, "Depo");
  await sec(page, "Konum");
  await expect(kart).toHaveAttribute("data-step", "target");
  await hedefDelikte(page, '[data-guide="target"]');
  // Demo tek depolu: hedef de aynı depo olur → form aktarmayı kabul etmez, rehber de "bitti" saymaz.
  await sec(page, "Hedef depo");
  await sec(page, "Hedef konum");
  await page.waitForTimeout(900);
  await expect(kart).toHaveAttribute("data-step", "target");
  await page.getByTestId("guide-close").first().click();
});

test("T-1124 başka bölüme geçince rehber kapanmaz: kaldığın yerden devam, başka bölüm ve ilk rehbere dönüş", async ({ page }) => {
  await page.goto("/");
  await enterDemoShared(page, "Yönetici");
  await page.goto(TRANSFER);
  await page.getByTestId("operation-guide-trigger").first().click();
  const kart = page.getByTestId("working-guide");
  await expect(kart).toHaveAttribute("data-step", "source");
  // Algılanamayan iş için küçük ok: hedef adıma geç.
  await page.getByTestId("guide-next").click();
  await expect(kart).toContainText("Adım 2/5");

  // Bulanık alana dokun (serbest bırak), sonra başka bölüme geç (uygulama içi): rehber kapanmaz, yüzen simgede kalır.
  await page.getByTestId("kalip-perde").click({ position: { x: 4, y: 4 } });
  await expect(kart).toHaveAttribute("data-folded", "true");
  await page.getByTestId("kabuk-home").first().click();
  if (await page.getByTestId("kalip-unsaved-leave").isVisible()) await page.getByTestId("kalip-unsaved-leave").click();
  await expect(page).toHaveURL(/\/t\/demo$/);
  await expect(kart).toHaveAttribute("data-folded", "true");
  await expect(page.getByTestId("guide-expand")).toContainText("Adım 2/5");
  await expect(page.getByTestId("guide-other")).toBeVisible();
  await expect(page.getByTestId("guide-restart")).toBeVisible();
  // Katlı simge yüzen kısayolu (şimşek) örtmez: şimşeğe dokunulabilir.
  await expect(page.getByTestId("pano-fab")).toBeVisible();
  const fab = await page.getByTestId("pano-fab").boundingBox();
  const cip = await kart.boundingBox();
  expect(fab !== null && cip !== null && (fab.x >= cip.x + cip.width || fab.y + fab.height <= cip.y || fab.y >= cip.y + cip.height)).toBe(true);
  await page.screenshot({ path: `tests/.artifacts/t-1124/${test.info().project.name}-katli.png`, animations: "disabled" });

  // Kaldığın yerden devam: rehberin ekranına döner, aynı adım.
  await page.getByTestId("guide-expand").click();
  await expect(page).toHaveURL(/new=TRANSFER/);
  await expect(kart).toHaveAttribute("data-folded", "false");
  await expect(kart).toHaveAttribute("data-step", "target");
  await expect(page.getByRole("searchbox", { name: "Hedef depo", exact: true })).toBeFocused();

  // Tam sayfa yüklemesiyle başka bölüm: yine katlı simge (kapanmaz).
  await page.goto("/t/demo/items");
  await expect(kart).toHaveAttribute("data-folded", "true");
  await expect(page.getByTestId("guide-expand")).toContainText("Adım 2/5");

  // Başka bölüm: seçici açılır; ilk rehberin adımı seçicide görünür, başka rehber başlar.
  await page.getByTestId("guide-other").click();
  const secici = page.getByTestId("guide-picker");
  await expect(secici).toBeVisible();
  await expect(secici.getByTestId("guide-progress-transfer")).toContainText("2/5");
  await page.getByTestId("guide-start-issue").click();
  await expect(page).toHaveURL(/new=STOCK_OUT/);
  await expect(kart).toHaveAttribute("data-folded", "false");
  await expect(kart).toHaveAttribute("data-step", "source");
  await expect(kart).toContainText("Stok çıkışı");

  // Yüzen kısayol halkasındaki "Rehber" bu ekranın rehberini sürdürür (seçici açmaz).
  await page.getByTestId("kalip-perde").click({ position: { x: 4, y: 4 } });
  await expect(kart).toHaveAttribute("data-folded", "true");
  await page.getByTestId("pano-fab").click();
  await page.getByTestId("pano-guide").click();
  await expect(kart).toHaveAttribute("data-folded", "false");
  await expect(kart).toContainText("Stok çıkışı");

  // İlk rehbere dönüş: katla → Başka bölüm → Transfer; kaldığı adımdan sürer.
  await page.getByTestId("kalip-perde").click({ position: { x: 4, y: 4 } });
  await page.getByTestId("guide-other").click();
  await expect(secici.getByTestId("guide-progress-issue")).toContainText("1/5");
  await page.getByTestId("guide-start-transfer").click();
  await expect(page).toHaveURL(/new=TRANSFER/);
  await expect(kart).toHaveAttribute("data-step", "target");
  await expect(kart).toContainText("Adım 2/5");
  await expect(kart).toContainText("Transfer");

  // Kapat yalnız bu rehberi bitirir; diğerinin adımı seçicide kalır.
  await page.getByTestId("guide-close").first().click();
  await expect(kart).toHaveCount(0);
  await page.getByTestId("operation-guide-trigger").first().click();
  await expect(kart).toHaveAttribute("data-step", "target");
  await page.getByTestId("guide-close").first().click();
});
