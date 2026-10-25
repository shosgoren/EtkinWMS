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
    // Belirteç doğrudan okunur (`#rrggbb`) ve tarayıcının box-shadow biçimine (`rgb(r, g, b)`) çevrilir. Çocuk öğeye renk verip okumak
    // `input` içinde çalışmaz (boş öğe; çocuğu belirteci miras almaz).
    const ham = win.getComputedStyle(hedef).getPropertyValue("--color-kr-focus").trim();
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(ham);
    const renk = m ? `rgb(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)})` : ham;
    return { shadow: win.getComputedStyle(hedef).boxShadow, renk, outline: win.getComputedStyle(el).outlineStyle };
  }, ALAN_KUTULARI);
  expect(r.outline, `${where}: eski dış çizgi yok`).toBe("none");
  expect(r.shadow, `${where}: odak halkası (${r.renk})`).toContain(r.renk);
}
