// T-246c: yönetim ekranları (ayarlar, üyeler + davet penceresi, denetim kaydı) güven paletinde (ADR-020).
// Demo yönetici girişi; 375x812 ve 1280x800; Akış ve Kokpit. Piksel karşılaştırma yok: hesaplanan stil + taşma + görünür metin.
// Görüntüler `.artifacts/t-246c/<görünüm>-<genişlik>-<ekran>.png` altına yazılır (git'e girmez).
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { enterDemoShared } from "./support/demo-session.ts";
import { appMenuReachable, openAppMenu } from "./support/app-menu.ts";

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

        // T-971: önceki adım kalıp ekranında (depo/lokasyon) bitebilir; kalıp ekranları ve Genel bakış Pano'su eski kabuğun görünüm anahtarını
        // çizmez. Anahtar erişilebilirse (ana ekranın eski kabuğu) tıklanır; değilse görünüm çerezi doğrudan yazılır (ekran yine `data-view` ile doğrulanır).
        await page.goto("/t/demo");
        // Görünüm anahtarı: seçili durum aria-pressed + metinle (renk tek taşıyıcı değil).
        // T-254: telefon genişliğinde anahtar menüdedir; önce menü açılır, aynı düğme kullanılır.
        const inMenu = await appMenuReachable(page);
        if (inMenu) await openAppMenu(page);
        const toggle = page.getByRole("button", { name: view.label, exact: true });
        if ((await toggle.count()) > 0) {
          await toggle.click();
          await expect(page.locator("html")).toHaveAttribute("data-view", view.id);
          // Genel bakış'a geçince ana ekran Pano olur (anahtar yok); anahtar kaldıysa seçili durumu doğrulanır.
          const after = page.getByRole("button", { name: view.label, exact: true }).and(page.locator("[aria-pressed]"));
          if ((await after.count()) > 0) await expect(after.first()).toHaveAttribute("aria-pressed", "true");
          if (inMenu && (await page.getByRole("dialog").count()) > 0) {
            await page.keyboard.press("Escape");
            await expect(page.getByRole("dialog")).toBeHidden();
          }
        } else {
          if (inMenu) await page.keyboard.press("Escape");
          await page.context().addCookies([{ name: "view", value: view.id, url: new URL(page.url()).origin }]);
          await page.reload();
        }
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
          // T-971: denetim kaydı liste kalıbında (KalipEkran); odak halkası kalıbın kendi halkasıdır (`.dzl .app :focus-visible`, sarı).
          {
            const action = page.locator("#action");
            await action.focus();
            await page.keyboard.press("Shift+Tab");
            await page.keyboard.press("Tab");
            await expect(action, "denetim: eylem süzgeci odakta").toBeFocused();
            expect(await computed(action, "outline-style"), "denetim: eylem süzgeci outline-style").toBe("solid");
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
          const itemDialog = page.getByRole("dialog");
          await expect(itemDialog).toBeVisible();
          // T-974: ürün penceresi alanları kalıp alanı (`.fld`).
          await expectKalipField(page, itemDialog.locator('input[name="code"]'), "ürün oluştur: kod", false);
          await expectKalipField(page, itemDialog.locator("#create-base-unit"), "ürün oluştur: temel birim", false);
          await expectNoHorizontalOverflow(page, "ürün oluştur penceresi");
          await shot("items-create");
          await page.keyboard.press("Escape");
          await expect(itemDialog).toBeHidden();

          // T-246d — Depolar: oluşturma penceresi (girdi + seçim) ve varsa lokasyon ağacı.
          await page.goto("/t/demo/warehouses");
          await expect(page.getByRole("heading", { level: 1, name: "Depo ve raflar" })).toBeVisible();
          await expectNoHorizontalOverflow(page, "depolar");
          await shot("warehouses");
          await page.getByRole("button", { name: "Yeni depo" }).click();
          const whDialog = page.getByRole("dialog");
          await expect(whDialog).toBeVisible();
          // T-974: kalıp penceresi alanları (`.fld`).
          await expectKalipField(page, whDialog.locator('input[name="code"]'), "depo oluştur: kod", false);
          await expectKalipField(page, whDialog.locator('input[name="name"]'), "depo oluştur: ad");
          await expectNoHorizontalOverflow(page, "depo oluştur penceresi");
          await shot("warehouses-create");
          await page.keyboard.press("Escape");
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
            const locDialog = page.getByRole("dialog");
            await expectKalipField(page, locDialog.locator("#create-kind"), "lokasyon oluştur: tür", false); // T-974
            await expectNoHorizontalOverflow(page, "lokasyon oluştur penceresi");
            await page.keyboard.press("Escape");
            await expect(locDialog).toBeHidden();
          }
      });
    }
  }
});
