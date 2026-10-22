// T-436 (ALTIN-KURAL 12): dokunma hedefi ölçüm yardımcısı. Ekrandaki görünür her dokunulabilir öğe (bağlantı, düğme, rol=button/menuitem/
// tab/switch, seçim kutusu, özet) en az `min` px (genel 44, saha 48). Etkin alan: öğenin kendisi ya da onu saran `<label>` (kaynak
// tasarımdaki `.fld`, `.lsearch` gibi alan kutuları dokunma alanıdır). Muaf: metin içi bağlantı (paragraf içinde, WCAG 2.5.8 satır içi
// istisnası), ekran okuyucuya özel (≤ 2 px) ve `aria-hidden` öğeler, `disabled` olmayan ama görünmeyen öğeler.
import { expect, type Page } from "@playwright/test";

export interface DokunmaHatasi {
  readonly what: string;
  readonly w: number;
  readonly h: number;
}

/** Ölçer; `min` altındaki öğeleri döner. `scope`: CSS seçici (varsayılan bütün sayfa). */
export async function smallTouchTargets(page: Page, min: number, scope = "body"): Promise<DokunmaHatasi[]> {
  // e2e tsconfig'inde DOM tipleri yok (diğer yardımcılar gibi): ölçüm dizge ifadesiyle tarayıcıda koşar.
  return page.evaluate<DokunmaHatasi[]>(`(() => {
    const min = ${JSON.stringify(min)};
    const scope = ${JSON.stringify(scope)};
    const SEL = 'a[href], button, [role="button"], [role="menuitem"], [role="tab"], [role="switch"], [role="checkbox"], select, summary, input:not([type="hidden"])';
    const out = [];
    const seen = new Set();
    for (const root of document.querySelectorAll(scope)) {
      for (const el of root.querySelectorAll(SEL)) {
        if (seen.has(el)) continue;
        seen.add(el);
        if (el.closest('[aria-hidden="true"], [hidden], [inert]') !== null) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 2 || r.height <= 2) continue;
        if (el.tagName === "A" && el.closest("p, li > span, small") !== null && el.closest("nav, [role=list], .ulist") === null) continue;
        const lab = el.closest("label");
        const lr = lab === null ? r : lab.getBoundingClientRect();
        const w = Math.max(r.width, lr.width);
        const h = Math.max(r.height, lr.height);
        if (w + 0.5 < min || h + 0.5 < min) {
          const id = el.getAttribute("data-testid") || el.getAttribute("aria-label") || (el.textContent || "").trim().slice(0, 40);
          const cls = typeof el.className === "string" && el.className.trim() !== "" ? "." + el.className.trim().split(/\\s+/).slice(0, 2).join(".") : "";
          out.push({ what: el.tagName.toLowerCase() + cls + " «" + id + "»", w: Math.round(w), h: Math.round(h) });
        }
      }
    }
    return out;
  })()`);
}

/** Ekrandaki bütün dokunma hedefleri ≥ `min` px. */
export async function expectTouchTargets(page: Page, min: number, where: string, scope = "body"): Promise<void> {
  const bad = await smallTouchTargets(page, min, scope);
  expect(bad, `${where}: ${min} px altındaki dokunma hedefleri`).toEqual([]);
}
