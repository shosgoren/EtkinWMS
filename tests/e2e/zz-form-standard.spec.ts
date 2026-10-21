// T-990 (B-97, ALTIN-KURAL "Ekran standardı", kullanıcı 21 Ekim): ortak form standardının uçtan uca kanıtı — Cariler tam ekran formu.
//  (1) değişiklik yokken Geri uyarısız çıkar; (2) değişiklik varken Geri / Ana ekran YALNIZ uygulamanın cam kutusunu açar (tarayıcı
//  penceresi asla açılmaz); yazılıp silinen alan değişiklik sayılmaz; (3) boş zorunlu alanla Kaydet: alan altında neden, balon, odak;
//  (4) Modüller açıkken perde ortak buzlu perdedir (backdrop-filter, ≥8px).
import { expect, test, type Page } from "@playwright/test";
import { localClient, loginEmptyTenant } from "./support/empty-tenant.ts";

// Kendi istemci adresi: projenin ortak giriş kovasını (sonraki panel/demo girişleri) tüketmesin (T-278 deseni).
test.use(localClient("198.51.100.51"));

/** Tarayıcının kendi kutusu (beforeunload / confirm / alert) açılırsa test düşer. */
function noBrowserDialog(page: Page): string[] {
  const seen: string[] = [];
  page.on("dialog", (d) => {
    seen.push(`${d.type()}: ${d.message()}`);
    void d.dismiss();
  });
  return seen;
}

test("ortak form standardı: çıkış kutusu, zorunlu alan uyarısı, ortak perde (Cariler)", async ({ page }) => {
  const seen = noBrowserDialog(page);
  const { slug } = await loginEmptyTenant(page);
  await page.goto(`/t/${slug}/parties`);
  const form = page.getByTestId("party-form");

  // (1) değişiklik yok → Geri uyarısız listeye döner.
  await page.getByTestId("party-new").click();
  await expect(form).toBeVisible();
  await expect(page).toHaveURL(/[?&]new=1/);
  await page.getByTestId("kabuk-back").click();
  await expect(page.getByTestId("kalip-unsaved")).toHaveCount(0);
  await expect(page.getByTestId("party-new")).toBeVisible();
  await expect(page).not.toHaveURL(/new=1/);

  // Yazılıp silinen alan değişiklik sayılmaz.
  await page.getByTestId("party-new").click();
  const taxOffice = form.getByLabel("Vergi dairesi", { exact: true });
  await taxOffice.fill("Kadıköy");
  await taxOffice.fill("");
  await page.getByTestId("kabuk-back").click();
  await expect(page.getByTestId("kalip-unsaved")).toHaveCount(0);
  await expect(page.getByTestId("party-new")).toBeVisible();

  // (3) zorunlu alanlar boş, isteğe bağlı alan dolu → Kaydet sessiz kalmaz.
  await page.getByTestId("party-new").click();
  await form.getByLabel("Vergi dairesi", { exact: true }).fill("Kadıköy");
  await page.getByTestId("party-form-save").click();
  await expect(page.getByTestId("err-code")).toHaveText(/Zorunlu/);
  await expect(page.getByTestId("err-name")).toHaveText(/Zorunlu/);
  await expect(page.getByTestId("kalip-toast")).toContainText("2 alan eksik: Cari kodu, Ünvan");
  const code = form.locator('input[name="code"]');
  await expect(code).toBeFocused();
  await expect(code).toHaveAttribute("aria-invalid", "true");
  await expect(form.locator('label.fld.bad[data-alan="code"]')).toBeVisible();
  // Alanı düzeltince o alanın hatası kalkar.
  await code.fill("C-1");
  await expect(page.getByTestId("err-code")).toHaveCount(0);

  // (2) değişiklik var → Geri ve Ana ekran yalnız uygulamanın cam kutusunu açar.
  await page.getByTestId("kabuk-back").click();
  const box = page.getByTestId("kalip-unsaved");
  await expect(box).toBeVisible();
  await expect(box).toContainText("Kaydetmeden çık");
  await page.getByTestId("kalip-unsaved-stay").click();
  await expect(box).toHaveCount(0);
  await expect(form).toBeVisible();
  await page.getByTestId("kabuk-home").click();
  await expect(box).toBeVisible();
  await page.getByTestId("kalip-unsaved-leave").click();
  await expect(page).toHaveURL(new RegExp(`/t/${slug}/?(\\?.*)?$`));
  await expect(page.getByTestId("kalip-toast-discarded")).toHaveText("Değişiklikler bırakıldı");

  // (4) Modüller: ortak buzlu perde.
  await page.goto(`/t/${slug}/parties`);
  await page.getByTestId("kabuk-mods").click();
  await expect(page.getByTestId("kabuk-sheet")).toBeVisible();
  const blur = await page.locator(".dzk .hback").evaluate((el) => el.ownerDocument.defaultView!.getComputedStyle(el).getPropertyValue("backdrop-filter"));
  expect(blur).toMatch(/blur\((8|9|\d{2,})px\)/);

  expect(seen, "tarayıcının kendi penceresi açılmamalı").toEqual([]);
});
