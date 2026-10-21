import { test } from "@playwright/test";
import { loginEmptyTenant } from "./support/empty-tenant.ts";
const OUT = "/private/tmp/claude-501/-Users-shosgoren-Documents-2027-EtkinWMS-EtkinWMS-main/afeb8b6f-616b-4d9a-9517-3991198a2092/scratchpad/shots";
test("probe: perde", async ({ page }) => {
  const { slug } = await loginEmptyTenant(page);
  for (const p of ["parties", "team", ""]) {
    await page.goto(`/t/${slug}/${p}`);
    await page.waitForTimeout(1500);
    const mods = page.getByTestId("kabuk-mods");
    if (!(await mods.isVisible().catch(() => false))) { console.log(p, "no mods"); continue; }
    await mods.click();
    await page.waitForTimeout(600);
    const info = await page.evaluate(() => {
      const h = document.querySelector(".dzk .hback");
      if (!h) return "no hback";
      const cs = getComputedStyle(h); const r = h.getBoundingClientRect();
      const top = document.elementFromPoint(innerWidth / 2, 60);
      return JSON.stringify({ bf: cs.backdropFilter, bg: cs.backgroundColor, r: [r.x, r.y, r.width, r.height], top: top?.className });
    });
    console.log(p, info);
    await page.screenshot({ path: `${OUT}/mods-${p || "home"}.png` });
  }
});
