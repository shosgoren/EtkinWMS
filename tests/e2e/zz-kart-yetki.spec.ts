// T-1141 (kullanıcı kararı 31 Ekim): yetkisi olmayan kullanıcı ürün / cari / depo / raf yeri kartında yeni ekleme, değiştirme (kod dahil),
// arşivleme / geri alma yapamaz. İşlem gizlenmez: ortak kilit kalıbı (kilit ikonu, `data-kilitli`, gerekçe "… yetkin yok · Yetki iste:
// yöneticine sor"; dokununca sarı balon + hata sesi, işlem çağrılmaz). Sunucu reddi int testinde (tests/integration/catalog/card-permissions).
// Kullanıcı: demo "Salt okunur" (READ_ONLY, yalnız `stock.view`).
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { enterDemoReal } from "./support/demo-session.ts";
import { db } from "./support/package-receiving.ts";

test.use({ trace: "off" });

const ASK = "Yetki iste: yöneticine sor";

/** Kilitli işlem: görünür, kilitli işaretli, gerekçe erişilebilir adda; dokununca sarı (uyarı) balon gerekçeyi söyler ve adres değişmez. */
async function expectLocked(page: Page, el: Locator, reason: string, where: string): Promise<void> {
  await expect(el, `${where}: görünür`).toBeVisible();
  await expect(el, `${where}: kilitli`).toHaveAttribute("data-kilitli", "true");
  await expect(el, `${where}: pasif`).toHaveAttribute("aria-disabled", "true");
  await expect(el, `${where}: gerekçe`).toHaveAttribute("aria-description", `${reason} · ${ASK}`);
  const url = page.url();
  // `aria-disabled` öğe gerçek `disabled` değildir (dokunuş yakalanır); Playwright onu "etkin değil" saydığından dokunuş zorlanır.
  await el.click({ force: true });
  const balon = page.getByTestId("kalip-toast").filter({ hasText: reason });
  await expect(balon, `${where}: balon`).toBeVisible();
  await expect(balon).toHaveAttribute("data-tur", "warn");
  await expect(balon).toContainText(ASK);
  expect(page.url(), `${where}: işlem çağrılmadı`).toBe(url);
}

test("T-1141: salt okunur kullanıcıda dört kart bölümünün yazma işlemleri kilitli + neden", async ({ page }) => {
  test.setTimeout(120_000);
  const [tenant] = await db<{ id: string; owner: string }>(
    "SELECT t.id, m.id AS owner FROM public.tenants t JOIN public.tenant_memberships m ON m.tenant_id = t.id AND m.is_owner WHERE t.slug = 'demo' LIMIT 1",
  );
  if (tenant === undefined) throw new Error("e2e: demo tenant yok");
  const partyId = randomUUID();
  const code = `T1141-${partyId.slice(0, 6)}`.toUpperCase();
  await db("INSERT INTO public.parties (tenant_id, id, code, code_key, name, kind, created_by) VALUES ($1, $2, $3, $4, $5, 'CUSTOMER', $6)", [tenant.id, partyId, code, code, "T1141 Yetki Carisi", tenant.owner]);
  try {
    await page.goto("/");
    await enterDemoReal(page, "Salt okunur");
    await expect(page).toHaveURL(/\/t\/demo$/);

    // Ürünler: Yeni ürün kilitli; `?new=1` formu açmaz. Ürün kartında Düzenle (alt çubuk + kart), kod kalemi, barkod ekle, arşivle kilitli.
    await page.goto("/t/demo/items");
    await expect(page.getByTestId("items")).toBeVisible();
    await expectLocked(page, page.getByTestId("items-add"), "Ürün ekleme yetkin yok", "ürünler › yeni");
    await page.goto("/t/demo/items?new=1");
    await expect(page.getByTestId("items")).toBeVisible();
    await expect(page.getByTestId("item-form")).toHaveCount(0);
    await page.goto("/t/demo/items");
    await page.getByTestId("item-card").first().click();
    await expect(page.getByTestId("item-detail")).toBeVisible();
    await expectLocked(page, page.getByTestId("item-edit"), "Ürün değiştirme yetkin yok", "ürün kartı › düzenle (çubuk)");
    await expectLocked(page, page.getByTestId("item-edit-open"), "Ürün değiştirme yetkin yok", "ürün kartı › düzenle");
    await expectLocked(page, page.getByTestId("item-code-edit"), "Ürün değiştirme yetkin yok", "ürün kartı › kod");
    await expectLocked(page, page.getByTestId("item-archive"), "Ürün arşivleme yetkin yok", "ürün kartı › arşivle");
    await page.goto(`${new URL(page.url()).pathname}?edit=1`);
    await expect(page.getByTestId("item-edit-form")).toHaveCount(0);

    // Cariler: Yeni cari kilitli (ana işlem OKUT'a dönmez); kartta Düzenle kilitli; form adresle açılırsa salt okunur + kilit bandı, Arşivle kilitli.
    await page.goto("/t/demo/parties");
    await expect(page.getByTestId("parties")).toBeVisible();
    await expectLocked(page, page.getByTestId("party-new"), "Cari ekleme yetkin yok", "cariler › yeni");
    await page.goto("/t/demo/parties?new=1");
    await expect(page.getByTestId("party-form")).toHaveCount(0);
    await page.goto(`/t/demo/parties/${partyId}`);
    await expect(page.getByTestId("party-detail")).toBeVisible();
    await expectLocked(page, page.getByTestId("party-edit"), "Cari değiştirme yetkin yok", "cari kartı › düzenle");
    await page.goto(`/t/demo/parties?edit=${partyId}`);
    await expect(page.getByTestId("party-form")).toBeVisible();
    await expect(page.getByTestId("kalip-locked")).toContainText("Cari değiştirme yetkin yok");
    await expectLocked(page, page.getByTestId("party-archive"), "Cari arşivleme / geri alma yetkin yok", "cari formu › arşivle");

    // Depolar: Yeni depo, kodu değiştir, arşivle kilitli.
    await page.goto("/t/demo/warehouses");
    await expect(page.getByTestId("warehouses")).toBeVisible();
    await expectLocked(page, page.getByTestId("warehouses-add"), "Depo ekleme yetkin yok", "depolar › yeni");
    const wh = page.getByTestId("warehouse-card").filter({ has: page.getByTestId("warehouse-archive") }).first();
    await expectLocked(page, wh.getByTestId("warehouse-code-edit"), "Depo değiştirme yetkin yok", "depo › kod");
    await expectLocked(page, wh.getByTestId("warehouse-archive"), "Depo arşivleme yetkin yok", "depo › arşivle");

    // Raf yerleri: depo kartında Yeni raf yeri, alt raf yeri, kodu değiştir, arşivle kilitli.
    await wh.locator("a").first().click();
    await expect(page.getByTestId("location-tree")).toBeVisible();
    await expectLocked(page, page.getByTestId("location-add"), "Raf yeri ekleme yetkin yok", "raf yerleri › yeni");
    const row = page.getByTestId("location-row").filter({ has: page.getByTestId("location-archive") }).first();
    await expectLocked(page, row.getByTestId("location-add-child"), "Raf yeri ekleme yetkin yok", "raf yeri › alt");
    await expectLocked(page, row.getByTestId("location-code-edit"), "Raf yeri değiştirme yetkin yok", "raf yeri › kod");
    await expectLocked(page, row.getByTestId("location-archive"), "Raf yeri arşivleme yetkin yok", "raf yeri › arşivle");
  } finally {
    await db("DELETE FROM public.parties WHERE tenant_id = $1 AND id = $2", [tenant.id, partyId]);
  }
});
