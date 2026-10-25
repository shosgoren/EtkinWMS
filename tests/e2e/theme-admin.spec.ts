// T-246c: yönetim ekranları (ayarlar, üyeler + davet penceresi, denetim kaydı) güven paletinde (ADR-020).
// Demo yönetici girişi; 375x812 ve 1280x800; Akış ve Kokpit. Piksel karşılaştırma yok: hesaplanan stil + taşma + görünür metin.
// Görüntüler `.artifacts/t-246c/<görünüm>-<genişlik>-<ekran>.png` altına yazılır (git'e girmez).
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { enterDemoShared } from "./support/demo-session.ts";
import { selectView } from "./support/app-menu.ts";
import { expectOdakHalkasi } from "./support/odak.ts";

const SIZES = [
  { width: 375, height: 812 },
  { width: 1280, height: 800 },
] as const;
const VIEWS = [
  { id: "flow", label: "İşlemler" },
  { id: "cockpit", label: "Genel bakış" },
] as const;
const OUT = ".artifacts/t-246c";

async function expectNoHorizontalOverflow(page: Page, where: string): Promise<void> {
  const m = await page.evaluate<{ scroll: number; client: number }>("({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth })");
  expect(m.scroll, `${where}: scrollWidth(${m.scroll}) <= clientWidth(${m.client})`).toBeLessThanOrEqual(m.client);
}

/** Belirteci tarayıcıda çözer (`var(--color-*)` → hesaplanan renk); girdi stiliyle aynı biçimde karşılaştırılır. */
async function tokenColor(page: Page, token: string): Promise<string> {
  return page.evaluate(
    `(() => { const p = document.createElement("span"); p.style.color = "var(${token})"; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; })()`,
  );
}

// Kök tsconfig'de DOM tipleri yok (lib: ES2023); işlev tarayıcıda çalışır, burada yalnızca tür bildirimi.
declare const getComputedStyle: (el: unknown) => { getPropertyValue(prop: string): string };

async function computed(locator: Locator, prop: string): Promise<string> {
  return locator.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
}

async function expectBorderStrong(page: Page, rawField: Locator, name: string): Promise<void> {
  // Streaming may retain an invisible resolved fragment; two visible controls still fail.
  const field = rawField.filter({ visible: true });
  await expect(field, `${name}: tek görünür alan`).toHaveCount(1);
  await expect(field, name).toBeVisible();
  const strong = await tokenColor(page, "--color-border-strong");
  for (const side of ["top", "right", "bottom", "left"]) {
    expect(await computed(field, `border-${side}-color`), `${name}: border-${side}-color`).toBe(strong);
  }
}

/** T-974 (B-63 grup B): kalıp penceresindeki alan kaynağın `.fld` kutusundadır (kenarlık yok); klavye odağında kutu halkası görünür. */
async function expectKalipField(page: Page, rawField: Locator, name: string, focus = true): Promise<void> {
  const field = rawField.filter({ visible: true });
  await expect(field, `${name}: tek görünür alan`).toHaveCount(1);
  await expect(field.locator("xpath=ancestor::label[contains(concat(' ', @class, ' '), ' fld ')]"), `${name}: kalıp alanı (.fld)`).toHaveCount(1);
  if (!focus) return;
  await field.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(field, `${name}: odakta`).toBeFocused();
  const ring = await computed(field.locator("xpath=ancestor::label[1]"), "box-shadow");
  expect(ring, `${name}: odak halkası`).not.toBe("none");
}

// Tek test, tek demo girişi: demo girişi hız sınırlıdır (kombinasyon başına giriş "Çok fazla deneme" döndürür).
test("yönetim ekranları: Akış/Kokpit x 375/1280 px", async ({ page }) => {
  await page.goto("/");
  await enterDemoShared(page, "Yönetici");
  await expect(page).toHaveURL(/\/t\/demo$/);

  for (const size of SIZES) {
    for (const view of VIEWS) {
      await test.step(`${view.label} ${size.width}px`, async () => {
        await page.setViewportSize(size);
        const shot = async (screen: string): Promise<void> => {
          await page.screenshot({ path: `${OUT}/${view.id}-${size.width}-${screen}.png`, fullPage: true });
        };

        // T-979c: görünüm geçişi ortak alt çubuğun Modüller sayfasında (ana ekran Pano / Kokpit); seçim `data-view` ile doğrulanır.
        await page.goto("/t/demo");
        await selectView(page, view.id as "flow" | "cockpit");
        await expect(page.locator("html")).toHaveAttribute("data-view", view.id);

          // Ayarlar.
          await page.goto("/t/demo/settings");
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          await expect(page.locator("html")).toHaveAttribute("data-view", view.id);
          // T-968: Ayarlar form kalıbında (KalipForm): satıra dokununca düzenleyici açılır; kaynak tasarımın kendi kenarlık/odak dili.
          await page.getByTestId("settings-locale").click();
          await expect(page.getByTestId("settings-locale-editor")).toBeVisible();
          await page.keyboard.press("Escape"); // telefonda alt sayfa perdesi satırı örter; Escape kapatır
          await expect(page.getByTestId("settings-locale-editor")).toHaveCount(0);
          await expectNoHorizontalOverflow(page, "ayarlar");
          await shot("settings");

          // Üyeler: sahip rozeti metni görünür; davet penceresi açık.
          await page.goto("/t/demo/members");
          await expect(page.getByRole("heading", { level: 1, name: "Üyeler" })).toBeVisible();
          await expect(page.getByTestId("member-card").getByText("Sahip", { exact: true }).first()).toBeVisible();
          await expectBorderStrong(page, page.getByTestId("member-role").first(), "üyeler: rol seçimi"); // T-990: tetik düğmesi (yerel liste yok)
          await expectNoHorizontalOverflow(page, "üyeler");
          await shot("members");
          const invite = page.getByRole("button", { name: "Üye davet et" });
          await expect(invite).toBeEnabled();
          await invite.click();
          const dialog = page.getByTestId("invite-form"); // T-990: davet tam ekran form (`?invite=1`)
          await expect(dialog).toBeVisible();
          const email = dialog.getByLabel("E-posta");
          await expectKalipField(page, email, "davet: e-posta"); // T-974: kalıp alanı (.fld)

          await expectNoHorizontalOverflow(page, "davet penceresi");
          await shot("members-invite");
          await page.getByTestId("kabuk-back").click();
          await expect(dialog).toBeHidden();

          // Denetim kaydı.
          await page.goto("/t/demo/audit");
          await expect(page.getByRole("heading", { level: 1, name: "Kim ne yaptı?" })).toBeVisible();
          await expectBorderStrong(page, page.locator("#from"), "denetim: başlangıç tarihi");
          await expectBorderStrong(page, page.locator("#action"), "denetim: eylem süzgeci");
          // T-971 / T-1033: denetim kaydı liste kalıbında (KalipEkran); odak işareti ortak tek halka (ALTIN-KURAL 11).
          {
            const action = page.locator("#action");
            await action.focus();
            await page.keyboard.press("Shift+Tab");
            await page.keyboard.press("Tab");
            await expect(action, "denetim: eylem süzgeci odakta").toBeFocused();
            await expectOdakHalkasi(action, "denetim: eylem süzgeci");
          }
          await expectNoHorizontalOverflow(page, "denetim kaydı");
          await shot("audit");

          // T-246d — Ürünler: arama alanı + durum seçimi + oluşturma penceresi.
          await page.goto("/t/demo/items");
          await expect(page.getByRole("heading", { level: 1, name: "Ürünler" })).toBeVisible();
          // T-968: Ürünler liste kalıbında (KalipListe): arama + süzgeç çipleri (durum "Arşivli" çipi).
          await expect(page.getByRole("searchbox", { name: "Ürün ara" })).toBeVisible();
          await expect(page.getByRole("group", { name: "Süzgeç" })).toBeVisible();
          await expectNoHorizontalOverflow(page, "ürünler");
          await shot("items");
          await page.getByRole("button", { name: "Yeni ürün" }).click();
          // T-990: ekleme tam ekran formdur (pencere değil); alanlar kalıp alanı (`.fld`), seçimler kutu/aramalı seçim.
          const itemDialog = page.getByTestId("item-form");
          await expect(itemDialog).toBeVisible();
          await expectKalipField(page, itemDialog.locator('input[name="code"]'), "ürün oluştur: kod", false);
          await expect(itemDialog.locator('[data-alan="unitId"]'), "ürün oluştur: temel birim").toBeVisible();
          await expectNoHorizontalOverflow(page, "ürün oluştur formu");
          await shot("items-create");
          await page.getByTestId("kabuk-back").click();
          await expect(itemDialog).toBeHidden();

          // T-246d — Depolar: oluşturma penceresi (girdi + seçim) ve varsa lokasyon ağacı.
          await page.goto("/t/demo/warehouses");
          await expect(page.getByRole("heading", { level: 1, name: "Depo ve raflar" })).toBeVisible();
          await expectNoHorizontalOverflow(page, "depolar");
          await shot("warehouses");
          await page.getByRole("button", { name: "Yeni depo" }).click();
          const whDialog = page.getByTestId("warehouse-form");
          await expect(whDialog).toBeVisible();
          // T-990: tam ekran form alanları (`.fld`).
          await expectKalipField(page, whDialog.locator('input[name="code"]'), "depo oluştur: kod", false);
          await expectKalipField(page, whDialog.locator('input[name="name"]'), "depo oluştur: ad");
          await expectNoHorizontalOverflow(page, "depo oluştur formu");
          await shot("warehouses-create");
          await page.getByTestId("kabuk-back").click();
          const leave = page.getByTestId("kalip-unsaved-leave");
          if (await leave.isVisible()) await leave.click(); // ilk depoda önerilen ad değişiklik sayılır
          await expect(whDialog).toBeHidden();
          const openTree = page.getByRole("link", { name: "Lokasyonları aç" }).first();
          if (await openTree.count()) {
            await openTree.click();
            await expect(page.getByRole("button", { name: "Lokasyon ekle", exact: true })).toBeVisible();
            const toggle = page.getByRole("button", { name: /altını (aç|kapat)/ }).first();
            if (await toggle.count()) await expectBorderStrong(page, toggle, "lokasyon ağacı: aç/kapat düğmesi");
            await expectNoHorizontalOverflow(page, "lokasyon ağacı");
            await shot("location-tree");
            await page.getByRole("button", { name: "Lokasyon ekle", exact: true }).click();
            const locDialog = page.getByTestId("location-form");
            await expect(locDialog.locator('[data-alan="kind"]').getByRole("radiogroup"), "lokasyon oluştur: tür").toBeVisible(); // T-990
            await expectNoHorizontalOverflow(page, "lokasyon oluştur formu");
            await page.getByTestId("kabuk-back").click();
            const leaveLoc = page.getByTestId("kalip-unsaved-leave");
            if (await leaveLoc.isVisible()) await leaveLoc.click();
            await expect(locDialog).toBeHidden();
          }
      });
    }
  }
});
