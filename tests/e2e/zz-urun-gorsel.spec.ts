// T-1145 (kullanıcı isteği 1 Kasım): ürün kartında görsel ekle → şeritte ve listede görünür → büyük görünüm; min / maks stok girilir
// (min > maks alan hatası, sonra kayıt); kullanılmayan birim dönüşümü kaldırılır ve "Geri al" ile geri gelir. Sunucu kuralları (bayt
// imzası, EXIF, yetki, kiracı yalıtımı, IN_USE) int testinde (tests/integration/catalog/item-images.int.test.ts).
// Kullanıcı: demo "Yönetici" (paylaşılan oturum). Ürün bu spec için açılır (sentetik).
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { enterDemoShared } from "./support/demo-session.ts";
import { db } from "./support/package-receiving.ts";

test.use({ trace: "off" });

// 40 × 30 düz renkli PNG (sentetik).
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAPUlEQVRIie3VQQ0AMAwCwClBGIqRNRnb45L+mzSUO2uezLG4Tj3hineqApnKDCSKxWCxWBwWg8VicV+xeAFeftxMh7mQjQAAAABJRU5ErkJggg==",
  "base64",
);

test("T-1145: görsel ekle + listede küçük resim, min / maks gir, dönüşümü kaldır ve geri al", async ({ page }) => {
  test.setTimeout(120_000);
  const [tenant] = await db<{ id: string }>("SELECT id FROM public.tenants WHERE slug = 'demo' LIMIT 1");
  if (tenant === undefined) throw new Error("e2e: demo tenant yok");
  const [adet] = await db<{ id: string }>("SELECT id FROM public.units WHERE tenant_id = $1 AND code = 'ADET'", [tenant.id]);
  const [koli] = await db<{ id: string }>("SELECT id FROM public.units WHERE tenant_id = $1 AND code = 'KOLI'", [tenant.id]);
  const [wh] = await db<{ id: string }>("SELECT id FROM public.warehouses WHERE tenant_id = $1 AND status = 'ACTIVE' ORDER BY code LIMIT 1", [tenant.id]);
  if (adet === undefined || koli === undefined || wh === undefined) throw new Error("e2e: demo birim / depo yok");
  const itemId = randomUUID();
  const code = `T1145-${itemId.slice(0, 6)}`.toUpperCase();
  await db("INSERT INTO public.items (tenant_id, id, code, name, base_unit_id) VALUES ($1, $2, $3, 'T1145 Görsel Ürünü', $4)", [tenant.id, itemId, code, adet.id]);
  await db("INSERT INTO public.unit_conversions (tenant_id, item_id, unit_id, to_base_factor) VALUES ($1, $2, $3, 12)", [tenant.id, itemId, koli.id]);

  await page.goto("/");
  await enterDemoShared(page, "Yönetici");
  await page.goto(`/t/demo/items/${itemId}`);
  await expect(page.getByTestId("item-detail")).toBeVisible();

  // 1. Görsel ekle: şeritte boş kutu → dosya seçilir → kapak görseli (sunucudan gerçekten çözülmüş) + "Geri al" balonu.
  await expect(page.getByTestId("kart-gorsel-bos")).toBeVisible();
  await page.getByTestId("kart-gorsel-dosya").setInputFiles({ name: "urun.png", mimeType: "image/png", buffer: PNG });
  const kapak = page.getByTestId("kart-gorsel");
  await expect(kapak).toBeVisible();
  await expect(page.getByTestId("kalip-toast").filter({ hasText: "Görsel eklendi" })).toBeVisible();
  await expect.poll(async () => kapak.locator("img").evaluate((el) => (el as unknown as { naturalWidth: number }).naturalWidth)).toBeGreaterThan(0);
  // Büyük görünüm açılır, Esc kapatır.
  await kapak.click();
  await expect(page.getByTestId("gorsel-buyuk")).toBeVisible();
  await expect(page.getByTestId("gorsel-kapak")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("gorsel-buyuk")).toHaveCount(0);

  // Listede (Liste görünümü; Kart / Liste geçişi yalnız geniş ekranda) bu ürünün satırında küçük resim.
  await page.goto(`/t/demo/items?q=${encodeURIComponent(code)}`);
  await expect(page.getByTestId("items")).toBeVisible();
  const listeGecis = page.locator('[data-gorunum="liste"]');
  if (await listeGecis.isVisible()) {
    await listeGecis.click();
    await expect(page.getByTestId("items-table").getByTestId("liste-gorsel").first()).toBeVisible();
  }

  // 2. Min / maks: kalem → form; min > maks alan hatası; düzeltince kaydedilir ve kartta görünür.
  await page.goto(`/t/demo/items/${itemId}`);
  await expect(page.getByTestId("item-min")).toContainText("Tanımlı değil");
  await page.getByTestId("item-min-edit").click();
  const form = page.getByTestId("minmax-form");
  await expect(form).toBeVisible();
  await form.locator('input[name="min"]').fill("5");
  await form.locator('input[name="max"]').fill("3");
  await page.getByTestId("minmax-form-save").click();
  await expect(form).toContainText("Maksimum, minimumdan küçük olamaz");
  await form.locator('input[name="max"]').fill("20");
  await page.getByTestId("minmax-form-save").click();
  await expect(page.getByTestId("item-detail")).toBeVisible();
  await expect(page.getByTestId("item-min")).toContainText("5");
  await expect(page.getByTestId("item-max")).toContainText("20");
  const saved = await db<{ min: string; max: string }>("SELECT min_quantity::text AS min, max_quantity::text AS max FROM public.item_stock_policies WHERE tenant_id = $1 AND item_id = $2", [tenant.id, itemId]);
  expect(saved.map((r) => [Number(r.min), Number(r.max)])).toEqual([[5, 20]]);

  // 3. Dönüşüm kaldır → satır gider; "Geri al" → aynı katsayıyla geri gelir.
  await page.goto(`/t/demo/items/${itemId}?sekme=birim`);
  await expect(page.getByTestId("conversion-row")).toHaveCount(1);
  await page.getByTestId("conversion-remove").click();
  await expect(page.getByTestId("conversion-row")).toHaveCount(0);
  const balon = page.getByTestId("kalip-toast").filter({ hasText: "dönüşümü kaldırıldı" });
  await expect(balon).toBeVisible();
  await balon.getByRole("button", { name: "Geri al" }).click();
  await expect(page.getByTestId("conversion-row")).toHaveCount(1);
  await expect(page.getByTestId("conversion-row")).toContainText("12");
});
