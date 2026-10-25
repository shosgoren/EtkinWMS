// T-1033 (ALTIN-KURAL 11, kullanıcı kararı 25 Ekim): odak işareti tek halkadır — `box-shadow`, öğenin köşesini izler, renk
// `--color-kr-focus` (açık temada lacivert, koyu temada sarı). Yazı alanı bir alan kutusunun (`design/kural.css` listesindeki
// sınıflar) içindeyse halka kutunun kendisindedir. Eski "4 px sarı outline" artık yoktur.
import { expect, type Locator } from "@playwright/test";

const ALAN_KUTULARI = ".inp, .fld, .srch, .lsearch, .ksrch, .search, .qdisp, .q2, .gnm, .code";

export async function expectOdakHalkasi(locator: Locator, where: string): Promise<void> {
  // Tarayıcı içi işlev: global `document`/`getComputedStyle` yerine öğenin kendi penceresi (e2e tsconfig'inde DOM tipleri yok).
  const r = await locator.evaluate((el, kutular) => {
    const doc = el.ownerDocument;
    const win = doc.defaultView!;
    const yazi = el.matches("input, textarea, select");
    const kutu = yazi ? el.closest(kutular) : null;
    const hedef = kutu ?? el;
    const probe = doc.createElement("i");
    probe.setAttribute("style", "color: var(--color-kr-focus)");
    hedef.appendChild(probe);
    const renk = win.getComputedStyle(probe).color;
    probe.remove();
    return { shadow: win.getComputedStyle(hedef).boxShadow, renk, outline: win.getComputedStyle(el).outlineStyle };
  }, ALAN_KUTULARI);
  expect(r.outline, `${where}: eski dış çizgi yok`).toBe("none");
  expect(r.shadow, `${where}: odak halkası (${r.renk})`).toContain(r.renk);
}
