// T-279: boş tenant (depo/ürün/lokasyon yok) üzerinde Ürünler ekranı boş durumu: S-01 kurulum satırı + B-03 öğreten adımlar + geometri.
// Demo tenant T-223'ten beri dolu açıldığı için bu ölçütler yalnızca global-setup'ın kurduğu fikstür tenant'ta üretilebilir (bkz. support/empty-tenant.ts).
// Ölçümler mobile-shell.spec.ts ile AYNI işlevdir (support/items-screen.ts, `empty: true`). Uzak koşuda dışlanır (playwright.config.ts testIgnore).
import { expect, test } from "@playwright/test";
import { itemsScreenChecks } from "./support/items-screen.ts";
import { loginEmptyTenant, localClient, scrubSecretInputs } from "./support/empty-tenant.ts";

// Parola/TOTP kodu hiçbir Playwright çağrısına parametre olmaz (support/empty-tenant.ts: exposeFunction; G-09) → adım başlıkları/rapor temiz.
// Trace KAPALI: trace DOM anlık görüntüsü input değerini (`__playwright_value_`, parola alanı dahil) ve ağ kaydı giriş isteği gövdesini
// saklar; başarısız testte parola trace.zip'e (CI artifact) düşerdi (T-279 SR @70003ef). Hata bağlamı (error-context.md) sayfa erişilebilirlik ağacını yazar ve parola değerini maskelemez → `afterEach` gizli alanları boşaltır (scrubSecretInputs). Hata kanıtı: ekran görüntüsü (parola alanı noktalı) + boşaltılmış hata bağlamı.
test.use({ ...localClient("198.51.100.11"), trace: "off" });
test.afterEach(async ({ page }) => scrubSecretInputs(page));

test("boş kiracı: ürünler ekranı boş durumu (S-01, B-03, B-02, I-01..I-05, B-04, B-05)", async ({ page }) => {
  const t = await loginEmptyTenant(page);
  await itemsScreenChecks(page, { slug: t.slug, empty: true });
});

// T-986b: katılma QR'ı paylaşma (iki adımlı girişten hemen sonra → yeniden doğrulama tazedir). Kopyalayınca düğme "Kopyalandı" olur
// (kullanıcı kararı 21 Ekim: balon/ses yok), panoya yalnız katılma bağlantısı yazılır; WhatsApp href'i `https://wa.me/?text=` + hazır metin.
test("kopyala → düğme 'Kopyalandı'; WhatsApp href'i hazır metin + bağlantı", async ({ page, context, baseURL }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL });
  const { slug } = await loginEmptyTenant(page);
  await page.goto(`/t/${slug}/team`);
  await expect(page.getByTestId("team")).toBeVisible();
  await page.getByTestId("team-main").click();
  await page.getByTestId("team-add-qr").click();
  await page.getByTestId("team-main").click(); // QR OLUŞTUR
  await expect(page.getByTestId("team-qr")).toBeVisible();
  await expect(page.getByTestId("team-main")).toContainText("PAYLAŞ");

  const copy = page.getByTestId("share-copy");
  await copy.click();
  await expect(copy).toContainText("Kopyalandı");
  await expect(page.getByTestId("share-live")).toContainText("kopyalandı");
  const clip = await page.evaluate<string>("navigator.clipboard.readText()");
  expect(clip).toMatch(/^https:\/\/[^\s]+\/field\/join#[^\s]+$/);
  await expect(copy).not.toContainText("Kopyalandı", { timeout: 4000 }); // 2 sn sonra eski haline döner

  const href = await page.getByTestId("share-whatsapp").getAttribute("href");
  expect(href).not.toBeNull();
  expect(href?.startsWith("https://wa.me/?text=")).toBe(true);
  const text = decodeURIComponent((href ?? "").slice("https://wa.me/?text=".length));
  expect(text).toMatch(/^Etkin WMS'de .+ ekibine katıl: https:\/\/\S+ \(7 gün geçerli\)$/);
  expect(text).toContain(clip);
  await expect(page.getByTestId("share-whatsapp")).toHaveAttribute("target", "_blank");
  await expect(page.getByTestId("share-whatsapp")).toHaveAttribute("rel", /noopener/);
});
