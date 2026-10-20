import { expect, test } from "@playwright/test";
import { enterDemoShared } from "./support/demo-session.ts";

const DEVICES = [
  { mode: "phone", width: 390, height: 844 },
  { mode: "tablet", width: 1024, height: 768 },
  { mode: "desktop", width: 1440, height: 900 },
] as const;

for (const device of DEVICES) {
  test(`T-929 ${device.mode}: doğrudan giriş, güvenli geri, ana ekran ve ulaşılır gezinme`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: device.width, height: device.height });
    await page.goto("/");
    await enterDemoShared(page, "Yönetici");
    await expect(page).toHaveURL(/\/t\/demo$/);

    // Yeni sekme/doğrudan girişte önceki tarayıcı geçmişi gerekmez. Geri her zaman
    // doğru bölümün listesine gider; yazma veya sahte form verisi gerektirmez.
    const routes = [
      { path: "/field/receive", back: "/field" },
      { path: "/field/putaway", back: "/field" },
    ];
    for (const route of routes) {
      await page.goto(`/t/demo${route.path}`);
      const shell = page.getByTestId("screen-shell");
      await expect(shell).toBeVisible();
      expect(await page.evaluate<string>('getComputedStyle(document.querySelector("[data-testid=screen-shell]")).getPropertyValue("--screen-mode").trim()')).toBe(device.mode);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      const back = page.getByTestId("screen-back").filter({ visible: true });
      const home = page.getByTestId("screen-home").filter({ visible: true });
      await expect(back).toHaveAttribute("href", `/t/demo${route.back}`);
      await expect(home).toHaveAttribute("href", "/t/demo");
      for (const target of [back, home]) {
        await expect(target).toBeVisible();
        const bounds = await target.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.width).toBeGreaterThanOrEqual(48);
        expect(bounds!.height).toBeGreaterThanOrEqual(48);
        if (device.mode !== "desktop") {
          expect(bounds!.y, "geri/ana ekran alt erişim alanında").toBeGreaterThan(device.height * 0.6);
          expect(bounds!.y + bounds!.height, "ekran altına taşmaz").toBeLessThanOrEqual(device.height + 1);
        }
      }
      expect(await page.evaluate<boolean>("document.documentElement.scrollWidth <= window.innerWidth")).toBe(true);
      await back.click();
      await expect(page).toHaveURL(new RegExp(`/t/demo${route.back}$`));
      await page.goto(`/t/demo${route.path}`);
      await page.getByTestId("screen-home").filter({ visible: true }).click();
      await expect(page).toHaveURL(/\/t\/demo$/);
      await expect(page.locator("#main").getByTestId("pano")).toBeVisible();
    }

    // T-968 / T-972: kalıp ekranları eski kabuk yerine ortak alt cam çubuğu kullanır: Geri (bölüm listesine) ve Ana ekran altta, ≥ 48 px.
    const kalipRoutes = [
      { path: "/items", back: "" },
      { path: "/settings", back: "" },
      { path: "/stock", back: "" },
      { path: "/receipts", back: "" },
      { path: "/production?new=1", back: "/production" },
      { path: "/shipping?new=1", back: "/shipping" },
      { path: "/stock/documents?new=TRANSFER", back: "/stock/documents" },
    ];
    for (const { path, back: backPath } of kalipRoutes) {
      await page.goto(`/t/demo${path}`);
      await expect(page.locator(".kalip")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByTestId("screen-back").filter({ visible: true })).toHaveCount(0);
      const back = page.getByTestId("kabuk-back");
      const home = page.getByTestId("kabuk-home");
      if (backPath !== "") await expect(back).toHaveAttribute("href", `/t/demo${backPath}`);
      for (const target of [back, home]) {
        await expect(target).toBeVisible();
        const bounds = await target.boundingBox();
        expect(bounds!.height).toBeGreaterThanOrEqual(48);
        expect(bounds!.y, "geri/ana ekran alt erişim alanında").toBeGreaterThan(device.height * 0.6);
        expect(bounds!.y + bounds!.height, "ekran altına taşmaz").toBeLessThanOrEqual(device.height + 1);
      }
      expect(await page.evaluate<boolean>("document.documentElement.scrollWidth <= window.innerWidth")).toBe(true);
      if (path.startsWith("/stock/documents")) {
        const form = page.locator("form.workflow-form");
        await expect(form).toBeVisible();
        const lastField = form.locator("input").last();
        await lastField.scrollIntoViewIfNeeded();
        await expect(lastField).toBeInViewport();
        const fieldBounds = await lastField.boundingBox();
        const dockBounds = await page.getByTestId("kabuk-dock").boundingBox();
        expect(fieldBounds!.y + fieldBounds!.height, "son alan alt cam çubuğun altında kalmaz").toBeLessThanOrEqual(dockBounds!.y + 1);
        await expect(form.locator(".workflow-primary")).toBeDisabled();
        await page.screenshot({ path: testInfo.outputPath(`${device.mode}-transfer.png`) });
      }
      if (backPath !== "") {
        await back.click();
        await expect(page).toHaveURL(new RegExp(`/t/demo${backPath}$`));
        await page.goto(`/t/demo${path}`);
      }
      await home.click();
      await expect(page).toHaveURL(/\/t\/demo$/);
    }
  });
}
