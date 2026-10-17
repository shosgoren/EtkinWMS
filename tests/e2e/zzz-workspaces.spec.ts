// T-999 (ADR-026 §6) kabul ölçütü, uçtan uca: girişten sonra tek üyelikte doğrudan alana, çok üyelikte son kullanılan alana (sunucuda,
// 0048), son alan yoksa seçiciye; pasif (REMOVED) üyelik seçicide yoktur. Çok üyelikli kullanıcı gerçek kayıt/MFA yolundan kurulur
// (global-setup `E2E_MULTI`); ikinci (ACTIVE) ve pasif üyelik yerel compose DB'ye migration rolüyle `psql` üzerinden yazılır (zzz-activation
// ile aynı kural: loopback, sterilize hata, sentetik veri) ve test sonunda geri alınır. Uzak hedefte (E2E_BASE_URL) bu test KAYITLI DEĞİLDİR.
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { completeFirstUseGuide } from "./support/first-use-guide.ts";
import { emptyTenant, localClient, loginLanding, scrubSecretInputs } from "./support/empty-tenant.ts";

type Row = Record<string, string>;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const lit = (v: unknown): string => (v === null || v === undefined ? "NULL" : typeof v === "number" || typeof v === "boolean" ? String(v) : `'${String(v).replaceAll("'", "''")}'`);
function psql<T = Row>(text: string, params: unknown[] = []): T[] {
  const url = process.env.DATABASE_URL_DIRECT;
  if (url === undefined || url === "") throw new Error("e2e: DATABASE_URL_DIRECT yok (globalSetup .env yükler)");
  const u = new URL(url);
  if (!LOOPBACK.has(u.hostname)) throw new Error("e2e: fikstür veritabanı loopback değil; yerel olmayan sunucuya yazılmaz");
  const env = { PATH: process.env.PATH, PGHOST: u.hostname.replace(/^\[|\]$/g, ""), PGPORT: u.port === "" ? "5432" : u.port, PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, "")) };
  const sql = text.replace(/\$(\d+)/g, (_m, i: string) => lit(params[Number(i) - 1]));
  const select = /^\s*SELECT/i.test(sql);
  try {
    const out = execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-X", "-q", "-A", "-t"], { input: select ? `SELECT COALESCE(json_agg(t), '[]'::json) FROM (${sql}) t` : sql, encoding: "utf8", env, stdio: ["pipe", "pipe", "pipe"] });
    return select ? (JSON.parse(out.trim() || "[]") as T[]) : [];
  } catch (e) {
    throw new Error(`e2e: fikstür SQL başarısız (psql çıkış durumu ${(e as { status?: number | null }).status ?? "?"})`); // argv/ortam/URL/çıktı iletiye girmez (G-09)
  }
}

const one = <T>(rows: T[]): T => {
  const r = rows[0];
  if (r === undefined || rows.length !== 1) throw new Error("e2e: fikstür satırı bulunamadı");
  return r;
};

if (!process.env.E2E_BASE_URL?.trim()) {
  // Kendi hız sınırı kovası; giriş yapan spec: trace kapalı (G-09, empty-tenant.ts başı).
  test.use({ ...localClient("198.51.100.25"), trace: "off" });
  test.afterEach(async ({ page }) => {
    await scrubSecretInputs(page);
  });

  test("T-999: tek üyelik → alan; çok üyelik → son alan; son alan yoksa seçici; pasif üyelik seçicide yok", async ({ page }) => {
    test.setTimeout(150_000);
    const multi = emptyTenant("multi");
    const opEmail = process.env.E2E_OPERATOR_EMAIL;
    if (!opEmail) throw new Error("e2e: operatör fikstürü yok (global-setup)");
    const me = one(psql<{ id: string }>("SELECT id::text AS id FROM public.users WHERE email = $1", [multi.email])).id;
    const own = one(psql<{ name: string }>("SELECT name FROM public.tenants WHERE slug = $1", [multi.slug]));
    // İkinci (aktif) alan: operatör fikstürünün alanı; pasif alan: boş tenant fikstürünün alanı (ana uygulamada başka spec kullanmaz/etkilenmez).
    const second = one(
      psql<{ id: string; slug: string; name: string }>(
        `SELECT t.id::text AS id, t.slug, t.name FROM public.tenants t JOIN public.tenant_memberships m ON m.tenant_id = t.id
           JOIN public.users u ON u.id = m.user_id WHERE u.email = $1 AND m.is_owner`,
        [opEmail],
      ),
    );
    const passive = one(psql<{ id: string; name: string }>("SELECT id::text AS id, name FROM public.tenants WHERE slug = $1", [emptyTenant("empty").slug]));
    const cleanup = (): void => {
      psql(
        `DELETE FROM public.membership_roles WHERE membership_id IN
           (SELECT id FROM public.tenant_memberships WHERE user_id = $1::uuid AND tenant_id IN ($2::uuid, $3::uuid));
         DELETE FROM public.tenant_memberships WHERE user_id = $1::uuid AND tenant_id IN ($2::uuid, $3::uuid);
         UPDATE public.tenant_memberships SET last_used_at = NULL WHERE user_id = $1::uuid;`,
        [me, second.id, passive.id],
      );
    };
    cleanup();
    try {
      // 1) Tek üyelik: doğrudan kendi alanı.
      await loginLanding(page, "multi", new RegExp(`/t/${multi.slug}$`));
      await completeFirstUseGuide(page);

      // 2) İkinci aktif üyelik + pasif üyelik.
      psql(
        `WITH a AS (INSERT INTO public.tenant_memberships (tenant_id, user_id, status) VALUES ($2::uuid, $1::uuid, 'ACTIVE') RETURNING id, tenant_id)
         INSERT INTO public.membership_roles (tenant_id, membership_id, role_key) SELECT tenant_id, id, 'WAREHOUSE_MANAGER' FROM a;
         WITH p AS (INSERT INTO public.tenant_memberships (tenant_id, user_id, status, removed_at) VALUES ($3::uuid, $1::uuid, 'REMOVED', now()) RETURNING id, tenant_id)
         INSERT INTO public.membership_roles (tenant_id, membership_id, role_key) SELECT tenant_id, id, 'PICKER' FROM p;`,
        [me, second.id, passive.id],
      );

      // 3) Çok üyelik, son alan = kendi alanı (1. adımda kabuk kaydetti) → açılış doğrudan oraya.
      await page.goto("/");
      await expect(page).toHaveURL(new RegExp(`/t/${multi.slug}$`));

      // 4) Seçici: iki aktif alan, "SON" kendi alanında; pasif alan yok.
      await page.goto("/workspaces");
      const picker = page.getByTestId("workspaces");
      await expect(picker.getByRole("heading", { level: 1, name: "Çalışma alanı seçin" })).toBeVisible();
      const rows = picker.locator("a.row");
      await expect(rows).toHaveCount(2);
      await expect(picker.locator("a.row", { hasText: own.name })).toContainText("SON");
      await expect(picker.locator("a.row", { hasText: second.name })).not.toContainText("SON");
      await expect(picker.locator("a.row", { hasText: passive.name })).toHaveCount(0);

      // 5) İkinci alanı seç → orada; açılış artık ikinci alana gider.
      await picker.locator("a.row", { hasText: second.name }).click();
      await expect(page).toHaveURL(new RegExp(`/t/${second.slug}$`));
      await page.goto("/");
      await expect(page).toHaveURL(new RegExp(`/t/${second.slug}$`));

      // 6) Son alan kaydı yok → seçici ("SON" çipi yok).
      psql("UPDATE public.tenant_memberships SET last_used_at = NULL WHERE user_id = $1::uuid", [me]);
      await page.goto("/");
      await expect(page).toHaveURL(/\/workspaces$/);
      await expect(page.getByTestId("workspaces").locator("a.row")).toHaveCount(2);
      await expect(page.getByTestId("workspaces").getByText("SON", { exact: true })).toHaveCount(0);
    } finally {
      cleanup();
    }
  });
}
