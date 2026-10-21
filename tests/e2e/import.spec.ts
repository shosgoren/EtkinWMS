// T-427 (T-289'un yerine): "Excel'den aktar" — şablonsuz eşleştirme. Kullanıcının kendi başlıklarıyla (üstte firma adı satırı olan) dosya yüklenir,
// sütunlar kendiliğinden bulunur (BULDUM / DOĞRU MU? / SEÇMEN GEREK), eksik alan önizlemede seçilir, kontrol adımında yeni / var / sorunlu satır sayıları
// görünür, sorunlu satırlar atlanır, aktarım yazılır; aynı başlıklı dosya ikinci kez yüklenince eşleştirme hatırlanır ve ek kayıt olmaz.
// Demo tenant'ta (demo yönetici) her koşu benzersiz kod önekiyle yalnız KENDİ ürünlerini ve demo rafı A3-G03/A3-G04'e kendi stokunu ekler.
// Dosya içeriği sentetiktir (G-09). Ekran görüntüleri `.artifacts/t-289/` altına yazılır (git'e girmez).
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { completeFirstUseGuide } from "./support/first-use-guide.ts";
import { localClient } from "./support/empty-tenant.ts";
import { DESKTOP_SIZES, OUT, PHONE_SIZES, csv, loginAdmin } from "./support/import-screen.ts";

// Demo girişi IP başına 10/10 dk sınırlıdır: bu dosya kendi istemci adresini kullanır (yalnız yerel vekil okur).
test.use({ ...localClient("198.51.100.40") });

async function upload(page: Page, rows: string[]): Promise<void> {
  await page.getByTestId("aktar-file").setInputFiles(csv(rows));
  await expect(page.locator('[data-field]').first()).toBeVisible();
}
const main = (page: Page) => page.getByTestId("aktar-main");

test.describe("Excel'den aktar (T-427)", () => {
  test("şablonsuz ürün ve açılış stoku: otomatik eşleştirme, eksik alan seçimi, sorunluları atla, hatırlanan eşleştirme", async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    mkdirSync(OUT, { recursive: true });
    const project = testInfo.project.name;
    const sizes = project === "desktop" ? DESKTOP_SIZES : PHONE_SIZES;
    const p = `T427-${Date.now()}${project === "desktop" ? "D" : "M"}`;
    await loginAdmin(page);

    // Ayarlar sayfasındaki bağlantıyla gelinir; ekran Aktar tasarımıdır.
    await page.goto("/t/demo/settings");
    await page.getByTestId("settings-import").click(); // T-968: Ayarlar form kalıbındaki "Excel’den toplu aktar" satırı
    await expect(page).toHaveURL(/\/t\/demo\/import$/);
    const aktar = page.getByTestId("aktar");
    await expect(aktar).toBeVisible();
    await expect(aktar.locator('[data-kind="cari"]')).toBeEnabled(); // T-428: cari kartlar açık
    for (const size of sizes) {
      await page.setViewportSize(size);
      const w = await page.evaluate<{ sw: number; cw: number }>("({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })");
      expect(w.sw, `${size.width}: yatay taşma yok`).toBeLessThanOrEqual(w.cw);
      await page.screenshot({ path: path.join(OUT, `aktar-${project}-${size.width}-tur.png`) });
    }

    // 1) Ürün kartları: üstte firma adı, kendi başlıkları; tüm alanlar BULDUM.
    await aktar.locator('[data-kind="stok"]').click();
    const products = [
      "ÖRNEK FİRMA · MALZEME LİSTESİ",
      "",
      "Stok Kodu;Malzeme Açıklaması;Birimi;Koli Mik.;Fiyat",
      `${p}-1;Vida M6;ADET;50;4,20`,
      `${p}-2;Somun M6;ADET;100;1,15`,
      `${p}-3;Pul M6;ADET;;0,30`,
    ];
    await upload(page, products);
    await expect(aktar.locator('[data-field="kod"]')).toHaveAttribute("data-state", "auto");
    await expect(aktar.locator('[data-field="ad"]')).toHaveAttribute("data-state", "auto");
    await expect(aktar.locator('[data-field="koli"]')).toHaveAttribute("data-state", "auto");
    await expect(aktar).toContainText("BAŞLIK 3. SATIRDA");
    await expect(aktar).toContainText("Kullanılmayan sütun: E · Fiyat");
    await expect(main(page)).toHaveAttribute("aria-label", "KONTROL ET");
    await page.screenshot({ path: path.join(OUT, `aktar-${project}-eslestir.png`) });
    await main(page).click();
    await expect(page.getByTestId("aktar-new")).toHaveText("3");
    await expect(page.getByTestId("aktar-bad")).toHaveText("0");
    await main(page).click();
    await expect(page.getByTestId("aktar-done")).toHaveAttribute("data-partial", "false");
    await expect(page.getByTestId("aktar-counts")).toContainText("3 YENİ");

    // 2) Aynı başlıklı dosya: eşleştirme hatırlanır; ürünler zaten var, yeni kayıt yok.
    await main(page).click(); // BİTTİ → baştan
    await aktar.locator('[data-kind="stok"]').click();
    await upload(page, products);
    await expect(aktar).toContainText("EŞLEŞTİRME HATIRLANDI");
    await main(page).click();
    await expect(page.getByTestId("aktar-new")).toHaveText("0");
    await main(page).click();
    await expect(page.getByTestId("aktar-counts")).toContainText("3 ZATEN VARDI");

    // 3) Sorunlu satır (kesirli koli): varsayılan "sorunluları atla" ile kalanlar aktarılır.
    await main(page).click();
    await aktar.locator('[data-kind="stok"]').click();
    await upload(page, ["Kod;Ad;Koli içi adet", `${p}-4;Cıvata;10`, `${p}-5;Kelepçe;12,5`]);
    await main(page).click();
    await expect(page.getByTestId("aktar-bad")).toHaveText("1");
    await expect(page.getByTestId("aktar-new")).toHaveText("1");
    await expect(aktar).toContainText("SATIR 3");
    await main(page).click();
    await expect(page.getByTestId("aktar-counts")).toContainText("1 YENİ");
    await expect(page.getByTestId("aktar-counts")).toContainText("1 ATLANDI");

    // 4) Açılış stoku: miktar sütununun başlığı tanınmaz → içerikten önerilir (DOĞRU MU?), kullanıcı sütunu seçer.
    await main(page).click();
    await aktar.locator('[data-kind="acilis"]').click();
    await upload(page, ["Ürün Kodu;Lokasyon;Sütun3", `${p}-1;A3-G04;40`, `${p}-2;a3-g03;25`]);
    await expect(aktar.locator('[data-field="miktar"]')).toHaveAttribute("data-state", "sug");
    await expect(main(page)).toHaveAttribute("aria-label", "1 ALAN BEKLİYOR");
    await main(page).click();
    const sheet = page.getByRole("dialog", { name: "Sütun seç" });
    await expect(sheet).toBeVisible();
    await sheet.locator('[data-col="C"]').click();
    await expect(aktar.locator('[data-field="miktar"]')).toHaveAttribute("data-state", "user");
    await main(page).click();
    await expect(page.getByTestId("aktar-new")).toHaveText("2");
    await main(page).click();
    await expect(page.getByTestId("aktar-done")).toHaveAttribute("data-partial", "false");
    await page.screenshot({ path: path.join(OUT, `aktar-${project}-bitti.png`) });

    // 5) Cari kartlar (T-428): kendi başlıklarıyla; tekrar yüklemede yeni kayıt yok; cari listesinde görünür.
    await main(page).click();
    await aktar.locator('[data-kind="cari"]').click();
    const cari = ["CARİ KOD;Hesap Adı;VKN/TCKN;V.D.;GSM;MAIL;ŞEHİR", `${p}-C1;Kaya Otomotiv;5230012345;Kozyatağı;0532 111 22 33;satis@kaya.com;İstanbul`, `${p}-C2;Demir Lastik;3310098765;Nilüfer;0533 444 55 66;;Bursa`];
    await upload(page, cari);
    await expect(aktar.locator('[data-field="kod"]')).toHaveAttribute("data-state", "auto");
    await expect(aktar.locator('[data-field="unvan"]')).toHaveAttribute("data-state", "auto");
    await main(page).click();
    await expect(page.getByTestId("aktar-new")).toHaveText("2");
    await main(page).click();
    await expect(page.getByTestId("aktar-counts")).toContainText("2 YENİ");
    await main(page).click();
    await aktar.locator('[data-kind="cari"]').click();
    await upload(page, cari);
    await main(page).click();
    await expect(page.getByTestId("aktar-new")).toHaveText("0");
    await page.goto(`/t/demo/parties?q=${p}-C1`);
    await expect(page.getByTestId("parties").getByText("Kaya Otomotiv")).toBeVisible();

    // Ürünler listesinde içe aktarılan ürün görünür.
    await page.goto(`/t/demo/items?q=${p}-1`);
    await expect(page.getByText(`${p}-1`).first()).toBeVisible();
  });

  test("kaydedilmemiş iş: ana ekran düğmesi cam kutuyla sorar; vazgeçince ekranda kalır", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/t/demo/import");
    const aktar = page.getByTestId("aktar");
    await aktar.locator('[data-kind="stok"]').click();
    await upload(page, ["Kod;Ad", "X-1;Deneme"]);
    await page.getByTestId("aktar-home").click();
    const box = page.getByRole("alertdialog", { name: "Aktarım yarıda kalsın mı?" });
    await expect(box).toBeVisible();
    await box.getByRole("button", { name: "Vazgeç, burada kalayım" }).click();
    await expect(box).toBeHidden();
    await expect(aktar.locator('[data-field="kod"]')).toBeVisible();
    await page.getByTestId("aktar-home").click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Kaydetmeden çık" }).click();
    await expect(page).toHaveURL(/\/t\/demo$/);
  });

  test("yetkisiz kullanıcı (salt okunur): neden + sonraki eylem, form yok", async ({ page }) => {
    await page.goto("/");
    await completeFirstUseGuide(page);
    await page.getByRole("button", { name: "Salt okunur olarak gir" }).click();
    await expect(page).toHaveURL(/\/t\/demo$/);
    await page.goto("/t/demo/import");
    await expect(page.getByRole("heading", { level: 1, name: "Ürün ve stok içe aktar" })).toBeVisible();
    await expect(page.getByText("Bu ekranı kullanmak için ürün ve ayar yetkisi gerekir.")).toBeVisible();
    await expect(page.getByTestId("aktar")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Geri dön" })).toBeVisible();
  });
});
