// T-1063 (kullanıcı 27 Ekim): engelleyen katman (perde) açıkken bütün görüntü alanı — üst çubuk, içerik VE alt cam çubuk — perdenin
// altında bulanık görünür; alt çubuk kaybolmaz, perde yalnız üst çubuğa hapsolmaz. Masaüstü, tablet ve telefonda; ortak ekranlarda.
// Denetim: perdenin kapladığı alan görüntü alanının tamamı; üç noktada (üst köşe, sol orta, alt çubuğun ortası) en üstteki öğe perde
// (ya da açılan panel); alt çubuk görünür kalır.
import { expect, test, type Page } from "@playwright/test";
import { enterDemoShared } from "./support/demo-session.ts";

const BOYUTLAR = [
  { ad: "masaüstü", w: 1280, h: 800 },
  { ad: "tablet", w: 820, h: 1180 },
  { ad: "telefon", w: 390, h: 844 },
] as const;
const EKRANLAR = ["", "/groups", "/items", "/parties", "/team", "/settings"] as const;

/** `perde` seçicisindeki öğe görüntü alanını kaplıyor ve verilen noktalarda en üstte (ya da `panel` içinde) mi? */
async function perdeOrtuyor(page: Page, perde: string, panel: string): Promise<string[]> {
  // Tarayıcıda çalışan denetim (dizge: test derlemesi DOM türlerini içermez).
  return page.evaluate<string[]>(`(() => {
    const perde = ${JSON.stringify(perde)}, panel = ${JSON.stringify(panel)};
    const hatalar = [];
    const p = document.querySelector(perde);
    if (p === null) return ["perde yok"];
    const r = p.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    if (r.left > 1 || r.top > 1 || r.right < vw - 1 || r.bottom < vh - 1) hatalar.push("perde alanı " + Math.round(r.width) + "x" + Math.round(r.height) + " (görüntü " + vw + "x" + vh + ")");
    const dock = document.querySelector('[data-testid="kabuk-dock"]');
    const noktalar = [["üst köşe", 6, 6], ["sol orta", 6, Math.round(vh / 2)]];
    if (dock !== null) {
      const d = dock.getBoundingClientRect();
      if (d.width === 0 || d.height === 0 || getComputedStyle(dock).visibility === "hidden") hatalar.push("alt çubuk görünmüyor");
      else noktalar.push(["alt çubuk", Math.round(d.left + 12), Math.round(d.top + d.height / 2)]);
    }
    for (const [ad, x, y] of noktalar) {
      const el = document.elementFromPoint(x, y);
      if (el === null || !(el === p || p.contains(el) || el.closest(panel) !== null)) hatalar.push(ad + ": en üstte perde değil (" + (el ? el.tagName + "." + el.className : "yok") + ")");
    }
    return hatalar;
  })()`);
}

for (const b of BOYUTLAR) {
  test(`T-1063 perde: Hesap menüsü bütün ekranı bulanıklaştırır, alt çubuk kaybolmaz (${b.ad})`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: b.w, height: b.h });
    await page.goto("/");
    await enterDemoShared(page, "Yönetici");
    const hatalar: string[] = [];
    for (const yol of EKRANLAR) {
      await page.goto(`/t/demo${yol}`);
      const dugme = page.getByTestId("home-actions").first();
      await expect(dugme).toBeVisible();
      const dockVardi = (await page.getByTestId("kabuk-dock").count()) > 0;
      await dugme.click();
      await expect(page.locator(".halo.tmenu")).toBeVisible();
      for (const h of await perdeOrtuyor(page, ".hmenu-kok .hback", ".halo.tmenu")) hatalar.push(`${yol || "/"} ${h}`);
      if (dockVardi) await expect(page.getByTestId("kabuk-dock"), `${yol}: alt çubuk`).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator(".halo.tmenu")).toHaveCount(0);
    }
    expect(hatalar, hatalar.join("\n")).toEqual([]);
  });

  test(`T-1063 perde: Modüller sayfası açıkken perde bütün ekranı örter (${b.ad})`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: b.w, height: b.h });
    await page.goto("/");
    await enterDemoShared(page, "Yönetici");
    const hatalar: string[] = [];
    for (const yol of EKRANLAR) {
      await page.goto(`/t/demo${yol}`);
      const mods = page.getByTestId("kabuk-mods");
      if ((await mods.count()) === 0) continue;
      await mods.click();
      await expect(page.getByTestId("kabuk-sheet")).toBeVisible();
      // Modüller sayfası alt çubuğun üstünde açılır; çubuk sayfanın parçasıdır (kaynak): perde çubuk dışındaki alanı örter.
      for (const h of (await perdeOrtuyor(page, '[data-testid="kabuk-mods-back"]', '[data-testid="kabuk-sheet"], [data-testid="kabuk-dock"]')).filter((x) => !x.startsWith("alt çubuk:")))
        hatalar.push(`${yol || "/"} ${h}`);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("kabuk-sheet")).toHaveCount(0);
    }
    expect(hatalar, hatalar.join("\n")).toEqual([]);
  });
}

test("T-1063 perde: yarım işte Hesap menüsünden Çıkış yap — ortak çıkış kutusu menünün üstünde ve tıklanır", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await enterDemoShared(page, "Yönetici");
  await page.goto("/t/demo/parties?new=1");
  await page.locator('input[name="name"]').fill("Yarım iş");
  await page.getByTestId("home-actions").first().click();
  await page.getByTestId("pano-menu-out").click();
  const kutu = page.getByTestId("kalip-unsaved");
  await expect(kutu).toBeVisible();
  const kal = page.getByTestId("kalip-unsaved-leave");
  const b = await kal.boundingBox();
  const ust = await page.evaluate<string>(`(() => { const el = document.elementFromPoint(${Math.round((b?.x ?? 0) + (b?.width ?? 0) / 2)}, ${Math.round((b?.y ?? 0) + (b?.height ?? 0) / 2)}); return el ? (el.closest('[data-testid="kalip-unsaved"]') ? "kutu" : el.className) : "yok"; })()`);
  expect(ust).toBe("kutu");
  await expect(page.locator(".hmenu-kok .hback")).toBeHidden();
});
