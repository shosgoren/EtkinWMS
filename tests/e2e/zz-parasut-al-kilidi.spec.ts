// T-1201 (kullanıcı kararı 1 Kasım): ürün bölümü "Paraşüt'ten al" iken (bağlantı açık) yeni ürün açılmaz, Paraşüt'e bağlı üründe ad / kod
// değişmez ve ürün arşivlenmez. İşlem gizlenmez: ortak kilit kalıbı (kilit ikonu, `data-kilitli`, gerekçe; dokununca sarı balon + hata
// sesi, Yeni'de "Şimdi eşitle"). Aynı ürün "İki yönlü"de her şey açık. Sunucu reddi int testinde (tests/integration/integrations/source-guard).
// Kullanıcı: demo "Yönetici" (kart anahtarları + entegrasyon yönetimi açık: kilit yetkiden değil kaynaktan gelir).
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { enterDemoReal } from "./support/demo-session.ts";
import { db } from "./support/package-receiving.ts";

test.use({ trace: "off" });

const CREATE = "Ürünler Paraşüt'ten geliyor. Yeni ürünü Paraşüt'te aç; birkaç dakika içinde buraya gelir.";
const FIELD = "Paraşüt'ten geliyor — Paraşüt'te değiştir";
const ARCHIVE = "Paraşüt'te arşivle; Etkin kendiliğinden uyar";

/** Kilitli işlem: görünür, kilitli işaretli, gerekçe erişilebilir adda; dokununca sarı balon gerekçeyi söyler ve adres değişmez. */
async function expectLocked(page: Page, el: Locator, reason: string, where: string): Promise<Locator> {
  await expect(el, `${where}: görünür`).toBeVisible();
  await expect(el, `${where}: kilitli`).toHaveAttribute("data-kilitli", "true");
  await expect(el, `${where}: gerekçe`).toHaveAttribute("aria-description", reason);
  const url = page.url();
  await el.click({ force: true });
  const balon = page.getByTestId("kalip-toast").filter({ hasText: reason });
  await expect(balon, `${where}: balon`).toBeVisible();
  await expect(balon).toHaveAttribute("data-tur", "warn");
  expect(page.url(), `${where}: işlem çağrılmadı`).toBe(url);
  return balon;
}

async function expectOpen(el: Locator, where: string): Promise<void> {
  await expect(el, `${where}: görünür`).toBeVisible();
  await expect(el, `${where}: açık`).not.toHaveAttribute("data-kilitli", "true");
}

test("T-1201: Paraşüt'ten al — Yeni ürün, bağlı ürünün adı/kodu ve arşivi kilitli + neden; iki yönlüde açık", async ({ page }) => {
  test.setTimeout(150_000);
  const [tenant] = await db<{ id: string; owner_user: string; owner: string }>(
    "SELECT t.id, m.user_id AS owner_user, m.id AS owner FROM public.tenants t JOIN public.tenant_memberships m ON m.tenant_id = t.id AND m.is_owner WHERE t.slug = 'demo' LIMIT 1",
  );
  if (tenant === undefined) throw new Error("e2e: demo tenant yok");
  const integrationId = randomUUID();
  const itemId = randomUUID();
  const code = `T1201-${itemId.slice(0, 6)}`.toUpperCase();
  // Durum ERROR (bağlantı kesilmedi → kural geçerli): worker zamanlayıcısı yalnız CONNECTED bağlantıyı çalıştırır, sentetik kutuyu açmaya uğraşmaz.
  const box = JSON.stringify({ v: 2, kid: "synthetic", iv: "synthetic", tag: "synthetic", ct: "synthetic" });
  const [existing] = await db<{ id: string }>("SELECT id FROM public.integrations WHERE tenant_id = $1 AND provider = 'PARASUT'", [tenant.id]);
  if (existing !== undefined) throw new Error("e2e: demo tenant'ta beklenmeyen Paraşüt bağlantısı");
  await db(
    "INSERT INTO public.integrations (tenant_id, id, provider, status, account_ref, connected_by, connected_membership_id, connected_at, credentials) VALUES ($1, $2, 'PARASUT', 'ERROR', 'e2e-1201', $3, $4, now(), $5::jsonb)",
    [tenant.id, integrationId, tenant.owner_user, tenant.owner, box],
  );
  try {
    await db("INSERT INTO public.integration_flows (tenant_id, integration_id, flow, direction, enabled) VALUES ($1, $2, 'PRODUCTS', 'PULL', true)", [tenant.id, integrationId]);
    await db(
      "INSERT INTO public.items (tenant_id, id, code, name, base_unit_id) SELECT $1, $2, $3, $4, u.id FROM public.units u WHERE u.tenant_id = $1 AND u.status = 'ACTIVE' ORDER BY (u.code = 'ADET') DESC, u.code LIMIT 1",
      [tenant.id, itemId, code, "T1201 Paraşüt ürünü"],
    );
    await db("INSERT INTO public.external_refs (tenant_id, system, entity_type, entity_id, external_id) VALUES ($1, 'PARASUT', 'ITEM', $2, $3)", [tenant.id, itemId, `e2e-${itemId.slice(0, 8)}`]);

    await page.goto("/");
    await enterDemoReal(page, "Yönetici");
    await expect(page).toHaveURL(/\/t\/demo$/);

    // Liste: Yeni kilitli + neden + "Şimdi eşitle"; `?new=1` formu açmaz.
    await page.goto("/t/demo/items");
    await expect(page.getByTestId("items")).toBeVisible();
    const balon = await expectLocked(page, page.getByTestId("items-add"), CREATE, "ürünler › yeni");
    await expect(balon.getByRole("button", { name: "Şimdi eşitle" })).toBeVisible();
    // Liste satırı Paraşüt bağlılığını taşır (ilk ve sonraki sayfalar aynı okumadan; int: source-guard-pages).
    await page.goto(`/t/demo/items?q=${encodeURIComponent(code)}`);
    await expect(page.getByTestId("item-card").filter({ has: page.locator('[data-kaynak="parasut"]') })).toHaveCount(1);
    await page.goto("/t/demo/items?new=1");
    await expect(page.getByTestId("items")).toBeVisible();
    await expect(page.getByTestId("item-form")).toHaveCount(0);

    // Kart: kod ve arşiv kilitli + neden; Paraşüt notu; Düzenle açık (Etkin'e özgü alanlar), formda ad kilitli + neden.
    await page.goto(`/t/demo/items/${itemId}`);
    await expect(page.getByTestId("item-detail")).toBeVisible();
    await expect(page.getByTestId("item-source-note")).toBeVisible();
    await expectLocked(page, page.getByTestId("item-code-edit"), FIELD, "ürün kartı › kod");
    await expectLocked(page, page.getByTestId("item-archive"), ARCHIVE, "ürün kartı › arşivle");
    await expectOpen(page.getByTestId("item-edit-open"), "ürün kartı › düzenle");
    await page.goto(`/t/demo/items/${itemId}?kod=1`);
    await expect(page.getByTestId("item-detail")).toBeVisible(); // kod formu adresle de açılmaz
    await page.goto(`/t/demo/items/${itemId}?edit=1`);
    await expect(page.getByTestId("item-edit-form")).toBeVisible();
    const name = page.getByTestId("item-edit-name");
    await expect(name).toHaveAttribute("data-kilitli", "true");
    await expect(name).toHaveAttribute("readonly", "");
    await expect(page.getByTestId("item-edit-form")).toContainText(FIELD);
    await name.click();
    await expect(page.getByTestId("kalip-toast").filter({ hasText: FIELD })).toBeVisible();
    await expect(page.getByTestId("item-pick")).toBeVisible(); // toplama kuralı Etkin'e özgü, açık

    // İki yönlü: her şey bugünkü gibi açık.
    await db("UPDATE public.integration_flows SET direction = 'BOTH' WHERE tenant_id = $1 AND integration_id = $2", [tenant.id, integrationId]);
    await page.goto("/t/demo/items");
    await expectOpen(page.getByTestId("items-add"), "iki yönlü › yeni");
    await page.goto(`/t/demo/items?q=${encodeURIComponent(code)}`);
    await expect(page.getByTestId("item-card")).toHaveCount(1);
    await expect(page.locator('[data-kaynak="parasut"]')).toHaveCount(0);
    await page.goto(`/t/demo/items/${itemId}`);
    await expect(page.getByTestId("item-detail")).toBeVisible();
    await expect(page.getByTestId("item-source-note")).toHaveCount(0);
    await expectOpen(page.getByTestId("item-code-edit"), "iki yönlü › kod");
    await expectOpen(page.getByTestId("item-archive"), "iki yönlü › arşivle");
    await page.goto(`/t/demo/items/${itemId}?edit=1`);
    await expect(page.getByTestId("item-edit-name")).not.toHaveAttribute("readonly", "");
  } finally {
    await db("DELETE FROM public.external_refs WHERE tenant_id = $1 AND entity_id = $2", [tenant.id, itemId]);
    await db("DELETE FROM public.integration_runs WHERE tenant_id = $1 AND integration_id = $2", [tenant.id, integrationId]);
    await db("DELETE FROM public.integration_flows WHERE tenant_id = $1 AND integration_id = $2", [tenant.id, integrationId]);
    await db("DELETE FROM public.integrations WHERE tenant_id = $1 AND id = $2", [tenant.id, integrationId]);
    await db("UPDATE public.items SET status = 'ARCHIVED', archived_at = now() WHERE tenant_id = $1 AND id = $2", [tenant.id, itemId]);
  }
});
