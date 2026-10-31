// T-1142 (kullanıcı kararı 31 Ekim: "kullanıcı yetkilendirme bölümü pratik ve akıcı olmalı, tüm yetkiler toggle ile"): Ayarlar › Kullanıcılar ve
// yetki › Yetkiler. Hesap sahibi (boş tenant fikstürü, MFA'lı) bir grupta "Ürün değiştir"i açar → ANINDA kaydedilir (Kaydet yok), balon söyler;
// sayfa yenilenince açık kalır; kişi görünümünde aynı yetki "grubundan" gelir ve rolden fark olarak işaretlenir; "Rol varsayılanına dön" tek
// dokunuşta grubu kaldırır. Kilitli satır (yalnız Yönetici) gizlenmez, dokununca gerekçe balonu. Telefonda yatay taşma yok, dokunma hedefi ≥ 44 px.
// Sunucu kuralları (yalnız hesap sahibi, MFA, kısmi anahtar, çapraz tenant) int testinde (tests/integration/identity/permission-screen).
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { localClient, loginEmptyTenant } from "./support/empty-tenant.ts";
import { expectTouchTargets } from "./support/dokunma.ts";
import { db } from "./support/package-receiving.ts";

test.use({ ...localClient("198.51.100.61"), trace: "off" });

test("yetki ekranı: grupta aç/kapa anında kaydedilir, kişide etkisi görünür, rol varsayılanına dönülür", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const { slug } = await loginEmptyTenant(page);
  const tag = randomUUID().slice(0, 6);
  const person = `Yetki Deneme ${tag}`;
  const groupName = `Kartçılar ${tag}`;
  // Sentetik üye (G-09): Toplayıcı + Sayımcı rollerinde, gruba sahibin ekranından konur.
  const [tenant] = await db<{ id: string; owner: string }>("SELECT t.id, m.id AS owner FROM public.tenants t JOIN public.tenant_memberships m ON m.tenant_id = t.id AND m.is_owner WHERE t.slug = $1 LIMIT 1", [slug]);
  if (tenant === undefined) throw new Error("e2e: tenant yok");
  await db("INSERT INTO public.users (name, email) VALUES ($1, $2)", [person, `yetki-${tag}@example.test`]);
  const [user] = await db<{ id: string }>("SELECT id FROM public.users WHERE email = $1", [`yetki-${tag}@example.test`]);
  if (user === undefined) throw new Error("e2e: kullanıcı yok");
  await db("INSERT INTO public.tenant_memberships (tenant_id, user_id, status) VALUES ($1, $2, 'ACTIVE')", [tenant.id, user.id]);
  const [member] = await db<{ id: string }>("SELECT id FROM public.tenant_memberships WHERE tenant_id = $1 AND user_id = $2", [tenant.id, user.id]);
  if (member === undefined) throw new Error("e2e: üyelik yok");
  await db("INSERT INTO public.membership_roles (tenant_id, membership_id, role_key) VALUES ($1, $2, 'PICKER')", [tenant.id, member.id]);
  // İki rollü üye: kişi görünümü rollerin birleşimini gösterir (ilk rol değil).
  await db("INSERT INTO public.membership_roles (tenant_id, membership_id, role_key) VALUES ($1, $2, 'COUNTER')", [tenant.id, member.id]);
  await db("INSERT INTO public.permission_groups (tenant_id, name, created_by) VALUES ($1, $2, $3)", [tenant.id, groupName, tenant.owner]);
  const [group] = await db<{ id: string }>("SELECT id FROM public.permission_groups WHERE tenant_id = $1 AND name = $2", [tenant.id, groupName]);
  if (group === undefined) throw new Error("e2e: grup yok");
  await db("INSERT INTO public.member_groups (tenant_id, membership_id, group_id, assigned_by) VALUES ($1, $2, $3, $4)", [tenant.id, member.id, group.id, tenant.owner]);

  // Ayarlar › Kullanıcılar ve yetki → Yetkiler.
  await page.goto(`/t/${slug}/settings?sekme=kullanici`);
  await page.getByTestId("settings-yetkiler").click();
  await expect(page.getByTestId("yetkiler")).toBeVisible();
  await page.getByTestId("yetki-bolumler").locator(`[data-bolum="grup-${group.id}"]`).click();
  const card = page.getByTestId("yetki-grup");
  await expect(card).toContainText(groupName);

  // Aç: ANINDA kaydedilir, balon + açık durumu.
  const row = page.getByTestId("yetki-items.edit");
  await expect(row).toHaveAttribute("aria-pressed", "false");
  await row.click();
  await expect(row).toHaveAttribute("aria-pressed", "true");
  const ok = page.getByTestId("kalip-toast").filter({ hasText: `${groupName}: Ürün değiştir` });
  await expect(ok).toBeVisible();
  await expect(ok).toHaveAttribute("data-tur", "ok");
  await expect.poll(async () => (await db<{ g: string[] }>("SELECT grants AS g FROM public.permission_groups WHERE id = $1", [group.id]))[0]?.g).toEqual(["items.edit"]);

  // Kilitli satır gizlenmez: gerekçe balonu, durum değişmez.
  const admin = page.getByTestId("yetki-settings.manage");
  await expect(admin).toHaveAttribute("data-kilitli", "true");
  await admin.click({ force: true });
  await expect(page.getByTestId("kalip-toast").filter({ hasText: "Yalnız Yönetici rolünde" })).toBeVisible();
  await expect(admin).toHaveAttribute("aria-pressed", "false");

  // Arama süzer.
  await page.getByTestId("yetki-ara").fill("arşiv");
  await expect(page.getByTestId("yetki-bolum-items")).toBeVisible();
  await expect(page.getByTestId("yetki-items.edit")).toHaveCount(0);
  await page.getByTestId("yetki-ara").fill("");

  // Yenilenince açık kalır.
  await page.reload();
  await expect(page.getByTestId("yetki-items.edit")).toHaveAttribute("aria-pressed", "true");

  // Telefon: yatay taşma yok, dokunma hedefleri ≥ 44 px.
  if (testInfo.project.name === "mobile") {
    const w = await page.evaluate<{ sw: number; cw: number }>("({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })");
    expect(w.sw, "yatay taşma yok").toBeLessThanOrEqual(w.cw);
    await expectTouchTargets(page, 44, "yetki ekranı", '[data-testid="yetki-grup"]');
  }

  // Kişi: yetki grubundan gelir, rolden fark işaretli; rol varsayılanına dön.
  await page.goto(`/t/${slug}/yetkiler?bolum=kisiler&kisi=${member.id}`);
  const kisi = page.getByTestId("yetki-kisi");
  await expect(kisi).toContainText(person);
  const eff = page.getByTestId("yetki-kisi-items.edit");
  await expect(eff).toHaveAttribute("aria-pressed", "true");
  await expect(eff).toHaveAttribute("data-changed", "true");
  await expect(eff).toContainText(`${groupName} grubundan`);
  await expect(page.getByTestId("yetki-kisi-stock.post")).toContainText("Rolünden");
  await expect(page.getByTestId("yetki-kisi-documents.create")).toContainText("Rolünden");
  await expect(page.getByTestId("yetki-kisi-documents.create")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("yetki-kisi-fark")).toContainText("1 yetki rolünden fazla");
  await page.getByTestId("yetki-kisi-sifirla").click();
  await expect(page.getByTestId("kalip-toast").filter({ hasText: `${person}: rol varsayılanına döndü` })).toBeVisible();
  await expect(eff).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("yetki-kisi-fark")).toContainText("Rol varsayılanında");
  await expect.poll(async () => (await db<{ n: number }>("SELECT count(*)::int AS n FROM public.member_groups WHERE membership_id = $1", [member.id]))[0]?.n).toBe(0);
});
