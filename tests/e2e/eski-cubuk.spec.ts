// T-1012 (kullanıcı bildirimi 22 Ekim): ekranlar arası geçişte eski "Kolay mod · İşlemler/Genel bakış · Yardım" üst çubuğu bir an görünüp
// kayboluyordu (tablet/masaüstünde yükleme ekranında kalıcı). Çubuk artık kök yerleşimde yok; bu spec çalışma alanında hiçbir durumda
// DOM'a girmediğini sınar: Ana ekran ↔ Ürünler ↔ Depolar istemci içi geçişi (belge yenilenmez), yükleme iskeleti, hata ve bulunamadı.
// Yalnız son görüntüye bakmak yetmez: MutationObserver bir anlık eklemeyi de yakalar. Telefon, tablet ve masaüstü ölçüleri.
import { expect, test, type Page } from "@playwright/test";
import { enterDemoShared } from "./support/demo-session.ts";
import { completeFirstUseGuide } from "./support/first-use-guide.ts";

const SIZES = [
  { name: "telefon", width: 390, height: 780 },
  { name: "tablet", width: 900, height: 1180 },
  { name: "masaüstü", width: 1440, height: 900 },
] as const;

const LEGACY = ".app-header";

/** Belgeye iz bırakır: eski çubuk bir an eklense `seen`, tam sayfa yüklemesi olursa iz kaybolur (`undefined`). */
async function armProbe(page: Page): Promise<void> {
  await page.evaluate(`(() => {
    const w = window;
    w.__t1012 = { seen: document.querySelector(${JSON.stringify(LEGACY)}) !== null };
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) {
        if (n instanceof Element && (n.matches(${JSON.stringify(LEGACY)}) || n.querySelector(${JSON.stringify(LEGACY)}) !== null)) w.__t1012.seen = true;
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  })()`);
}

async function expectClean(page: Page, where: string): Promise<void> {
  await expect(page.locator(LEGACY), `${where}: eski çubuk DOM'da yok`).toHaveCount(0);
  expect(await page.evaluate("window.__t1012"), `${where}: belge yenilenmedi ve eski çubuk bir an bile eklenmedi`).toEqual({ seen: false });
}

/** Ortak alt çubuğun Modüller sayfasından modül açar (telefonda ilk sayfaya sığmazsa aramayla, kaynaktaki "ara ya da söyle"). */
async function openModule(page: Page, id: string, name: string): Promise<void> {
  await page.getByTestId("kabuk-mods").filter({ visible: true }).first().click();
  const sheet = page.getByRole("dialog", { name: "Modüller" });
  const tile = sheet.locator(`[data-module="${id}"]`);
  if (!(await tile.isVisible())) await page.getByTestId("kabuk-search").fill(name);
  await tile.click();
}

/** Asıl gezinme isteğini (önceden yükleme değil) geciktirir: istemci içi geçişte yükleme iskeleti görünür kalır. */
async function slowNavigation(page: Page, ms: number): Promise<() => Promise<void>> {
  const handler = async (route: import("@playwright/test").Route) => {
    const h = route.request().headers();
    if (h.rsc === "1" && h["next-router-prefetch"] === undefined) await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  };
  await page.route("**/t/demo/**", handler);
  return () => page.unroute("**/t/demo/**", handler);
}

for (const size of SIZES) {
  test(`T-1012 eski üst çubuk geçiş, yükleme ve bulunamadıda DOM'a girmez (${size.name})`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/");
    await enterDemoShared(page, "Yönetici");
    await expect(page).toHaveURL(/\/t\/demo$/);
    await completeFirstUseGuide(page);
    await expect(page.getByTestId("kabuk-mods").filter({ visible: true }).first()).toBeVisible();
    await armProbe(page);
    await expectClean(page, "Ana ekran");

    // Ana ekran → Ürünler → Depolar → Ürünler → Ana ekran: hepsi istemci içi geçiş.
    await openModule(page, "urun", "Ürünler");
    await expect(page).toHaveURL(/\/t\/demo\/items$/);
    await expect(page.getByRole("heading", { name: "Ürünler", exact: true }).filter({ visible: true }).first()).toBeVisible();
    await expectClean(page, "Ürünler");
    await openModule(page, "depo", "Depolar");
    await expect(page).toHaveURL(/\/t\/demo\/warehouses$/);
    await expect(page.locator(".kalip").filter({ visible: true }).first()).toBeVisible();
    await expectClean(page, "Depolar");
    await openModule(page, "urun", "Ürünler");
    await expect(page).toHaveURL(/\/t\/demo\/items$/);
    await expectClean(page, "Ürünler (dönüş)");
    // Ortak kalıp süzgeç çipi de istemci içi bağlantıdır.
    await page.getByRole("link", { name: "Arşivli", exact: true }).click();
    await expect(page).toHaveURL(/\/items\?status=ARCHIVED$/);
    await expectClean(page, "Ürünler süzgeç");
    await page.getByRole("navigation", { name: "Alt çubuk", exact: true }).getByRole("link", { name: "Ana ekran", exact: true }).click();
    await expect(page).toHaveURL(/\/t\/demo$/);
    await expectClean(page, "Ana ekran (dönüş)");

    // Yükleme: gezinme yanıtı gecikirken kiracı iskeleti görünür; eski çubuk yine yok.
    const restore = await slowNavigation(page, 2_500);
    await openModule(page, "depo", "Depolar");
    await expect(page.getByTestId("iskelet")).toBeVisible();
    await expectClean(page, "yükleme iskeleti");
    await expect(page).toHaveURL(/\/t\/demo\/warehouses$/);
    await expect(page.getByTestId("iskelet")).toHaveCount(0, { timeout: 15_000 });
    await expectClean(page, "yükleme sonrası");
    await restore();

    // Hata: kiracı `error.tsx` bulunamadı ile aynı ortak hata ekranını (`HataEkrani`) çizer; kök yerleşimde eski çubuk olmadığından iki
    // durumda da DOM'a giremez. Üretim yapısında sunucu hatası güvenle tetiklenemediği için (RSC yanıtı bozulunca Next tam sayfa yüklemesine
    // döner) hata sınırının bağımsızlığı birim bekçisinde (`apps/web/app/eski-kabuk.test.ts`), ortak ekran burada sınanır.
    // Bulunamadı (tam sayfa yükleme, ilk SSR): eski çubuk sunucu çıktısında da yok.
    const res = await page.goto("/t/demo/olmayan-t1012-ekran");
    expect(await res?.text(), "SSR çıktısında eski çubuk yok").not.toContain("app-header");
    await expect(page.getByTestId("bulunamadi-ekrani")).toBeVisible();
    await expect(page.locator(LEGACY)).toHaveCount(0);
    // Çalışma alanı dışındaki bulunamadı ekranı da aynı ortak kabuk: eski çubuk yok.
    await page.goto("/olmayan-t1012-adres");
    await expect(page.getByTestId("bulunamadi-ekrani")).toBeVisible();
    await expect(page.locator(LEGACY)).toHaveCount(0);
  });
}
