// T-421: Yetki grupları (Gruplar.dc.html). Demo alanında yazma kapalıdır (herkese açık demo hesapları yetki yükseltemez): ekran salt okunur
// açılır, HAZIR gruplar (roller) listelenir, bir hazır grup açılınca ekran/yetki kartları kilitli görünür, ekip yönetimi kartı "yalnız yönetici",
// kişiler adımı yalnız o roldekileri gösterir; yatay taşma yok. Yazma kuralları (yalnız hesap sahibi, MFA, birleşim) bütünleşme testindedir.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { localClient } from "./support/empty-tenant.ts";
import { DESKTOP_SIZES, OUT, PHONE_SIZES, loginAdmin } from "./support/import-screen.ts";
import { KABUK_SIZES, expectKabukBar, expectModulesSheet, settle } from "./support/kabuk-checks.ts";

test.use({ ...localClient("198.51.100.43") });

test.describe("Yetki grupları (T-421)", () => {
  test("demo: hazır gruplar salt okunur; kartlar kilitli; taşma yok", async ({ page }, testInfo) => {
    mkdirSync(OUT, { recursive: true });
    const project = testInfo.project.name;
    await loginAdmin(page);
    await page.goto("/t/demo/groups");
    const view = page.getByTestId("groups");
    await expect(view).toBeVisible();
    await expect(view.locator('[data-group="TENANT_ADMIN"]')).toBeVisible();
    await expect(view.locator('[data-group="PICKER"]')).toContainText("HAZIR");
    await expect(page.getByTestId("groups-main")).toBeDisabled(); // demo: yeni grup kapalı
    for (const size of project === "desktop" ? DESKTOP_SIZES : PHONE_SIZES) {
      await page.setViewportSize(size);
      const w = await page.evaluate<{ sw: number; cw: number }>("({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })");
      expect(w.sw, `${size.width}: yatay taşma yok`).toBeLessThanOrEqual(w.cw);
      await page.screenshot({ path: path.join(OUT, `gruplar-${project}-${size.width}.png`) });
    }

    await view.locator('[data-group="PICKER"]').click();
    await expect(page.getByTestId("groups-name")).toHaveAttribute("readonly", "");
    await expect(view.locator('[data-card="receive"]')).toHaveAttribute("aria-disabled", "true");
    await page.getByTestId("groups-tab-pow").click();
    await expect(view.locator('[data-card="scan"]')).toHaveAttribute("aria-pressed", "true");
    await expect(view.locator('[data-card="team"]')).toContainText("YALNIZ YÖNETİCİ ROLÜNDE");
    await page.getByTestId("groups-main").click();
    await expect(view).toContainText("Kişileri seç");
    await page.getByTestId("groups-main").click(); // BİTTİ → liste
    await expect(view.locator('[data-group="TENANT_ADMIN"]')).toBeVisible();
    await page.getByTestId("groups-back").click();
    await expect(page).toHaveURL(/\/t\/demo\/team$/);
  });
});

test.describe("Ekip (T-430)", () => {
  test("demo: kişiler listesi, onay sekmesi, kişi ekle sayfası; taşma yok", async ({ page }, testInfo) => {
    await loginAdmin(page);
    await page.goto("/t/demo/team");
    const team = page.getByTestId("team");
    await expect(team).toBeVisible();
    await page.getByTestId("team-tab-people").click();
    await expect(page.getByTestId("team-people").locator(".pr2").first()).toBeVisible();
    await page.getByTestId("team-tab-pend").click();
    await expect(page.getByTestId("team-none")).toBeVisible();
    await page.getByTestId("team-main").click();
    await expect(page.getByRole("dialog", { name: "Kişi ekle" })).toBeVisible();
    await page.getByTestId("team-add-qr").click();
    await expect(page.getByTestId("team-qr-new")).toBeDisabled(); // demo: QR üretilmez
    const sizes = testInfo.project.name === "desktop" ? DESKTOP_SIZES : PHONE_SIZES;
    for (const size of sizes) {
      await page.setViewportSize(size);
      const w = await page.evaluate<{ sw: number; cw: number }>("({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })");
      expect(w.sw, `${size.width}: yatay taşma yok`).toBeLessThanOrEqual(w.cw);
    }
    await page.getByTestId("team-back").click();
    await expect(page.getByTestId("team-tab-people")).toBeVisible();
  });
});

test.describe("Tablet alt çubuk (T-921)", () => {
  test("1180 px: eski iç ekran gezinmesi yeni tasarım ekranlarını örtmez; orta ana işlem en üstte; Kullanıcılar bağlantısı çerçevede ortalı", async ({ page }) => {
    await loginAdmin(page);
    await page.setViewportSize({ width: 1180, height: 820 });
    // Aktar'ın ilk adımında (tür seçimi) tasarım gereği orta ana işlem yoktur: orada yalnız eski gezinmenin gizliliği denetlenir.
    await page.goto("/t/demo/import");
    await expect(page.getByTestId("aktar")).toBeVisible();
    await expect(page.getByTestId("screen-nav")).toBeHidden();
    for (const [url, root, main] of [
      ["/t/demo/team", "team", "team-main"],
      ["/t/demo/groups", "groups", "groups-main"],
    ] as const) {
      await page.goto(url);
      await expect(page.getByTestId(root)).toBeVisible();
      await expect(page.getByTestId("screen-nav")).toBeHidden();
      await expect(page.getByTestId(main)).toBeVisible();
      const onTop = await page.evaluate<boolean>(
        `(() => { const el = document.querySelector('[data-testid="${main}"]'); if (el === null) return false;
          const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return hit !== null && (hit === el || el.contains(hit)); })()`,
      );
      expect(onTop, `${url}: orta ana işlem başka bir katmanın altında kalmamalı`).toBe(true);
    }
    await page.goto("/t/demo/team");
    await expect(page.getByTestId("team-manage")).toHaveCSS("display", "flex");
    await expect(page.getByTestId("team-manage")).toHaveCSS("align-items", "center");
  });
});

// T-958 (Kabuk.dc.html): ortak alt cam çubuk Pano (ana ekran) ve alt ekranda (Ekip) aynı bileşen; Modüller sayfası yetkiye göre.
test.describe("Ortak alt çubuk ve Modüller (T-958)", () => {
  test("yönetici: 5 yuva, ana işlem üstte, Modüller açılır/kapanır, taşma yok", async ({ page }, testInfo) => {
    await loginAdmin(page);
    const desk = testInfo.project.name === "desktop";
    for (const s of KABUK_SIZES) {
      await page.setViewportSize({ width: s.w, height: s.h });
      await page.goto("/t/demo");
      await expect(page.getByTestId("pano-problem")).toBeVisible();
      await expect(page.getByTestId("pano-scan")).toHaveAttribute("href", "/t/demo/field");
      await expect(page.getByTestId("kabuk-home")).toHaveAttribute("aria-current", "page");
      await expectKabukBar(page, "pano-scan", `pano ${s.w}`);
      await settle(page);
      if (desk) await page.screenshot({ path: testInfo.outputPath(`app-pano-${s.w}.png`) });
      await page.goto("/t/demo/team");
      await expect(page.getByTestId("team")).toBeVisible();
      await expect(page.getByTestId("team-back")).toBeVisible();
      await expectKabukBar(page, "team-main", `ekip ${s.w}`);
      await settle(page);
      if (desk) await page.screenshot({ path: testInfo.outputPath(`app-ekip-${s.w}.png`) });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expectModulesSheet(page, ["home", "urun", "satin"], [], desk ? "app-moduller-390.png" : undefined);
    // YAKINDA modülü bağlantı değildir; gerçek modül gerçek ekrana gider.
    await page.getByTestId("kabuk-mods").click();
    const sheet = page.getByRole("dialog", { name: "Modüller" });
    await expect(sheet.locator('[data-module="satin"]')).toHaveAttribute("data-soon", "true");
    await expect(sheet.locator('a[data-module="satin"]')).toHaveCount(0);
    // Telefonda 12 kutu: yöneticinin 24 kutusunun (20 modül + T-979c Stok / Ayarlar / Kim ne yaptı? + Genel bakış geçişi) 11'i + "+13 daha";
    // arama sığmayanı bulur.
    await expect(page.getByTestId("kabuk-more")).toContainText("+13 daha");
    await page.getByTestId("kabuk-search").fill("ekip");
    await sheet.locator('[data-module="ekip"]').click();
    await expect(page).toHaveURL(/\/t\/demo\/team$/);
    if (desk) {
      for (const s of KABUK_SIZES.slice(1)) {
        await page.setViewportSize({ width: s.w, height: s.h });
        await page.getByTestId("kabuk-mods").click();
        await settle(page);
        await page.screenshot({ path: testInfo.outputPath(`app-moduller-${s.w}.png`) });
        await page.keyboard.press("Escape");
      }
    }
  });
});
