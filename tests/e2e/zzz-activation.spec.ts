// T-995 (ADR-026 §3.3–3.5): onaylı demo talebinin bağlantısıyla deneme alanı kurulumu, uçtan uca (gerçek web + DB + Better Auth + TOTP).
// Yığın e2e kipinde posta kapalıdır (`MAIL_MODE=disabled`): bağlantı ekranda teslim edilmiş gibi fikstürle yazılır ve hazır ekranı "gönderildi"
// demez (sahte başarı yok). Kabul: 4 adım + hazır ekranı, sahip giriş yapmış ve iki adımlı doğrulama kurulu, kısa adres `/<alan>` → `/t/<alan>`,
// bağlantı ikinci kez kullanılamaz. Fikstür migration rolüyle `psql` üzerinden yerel compose DB'ye yazılır (camera-scan ile aynı kural: loopback,
// sterilize hata, sentetik veri). Uzak hedefte (E2E_BASE_URL) bu test KAYITLI DEĞİLDİR (atlama değil; fikstür kavramı yok).
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { totpNow } from "./support/empty-tenant.ts";

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

/** Onaylı talep + ekranda teslim edilmiş bağlantı (yalnız özeti DB'de). Karar veren: herhangi bir mevcut kullanıcı (sentetik fikstür). */
function approvedRequest(): { id: string; email: string; token: string } {
  const id = randomUUID();
  const email = `t995-e2e-${randomBytes(5).toString("hex")}@example.test`;
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token, "utf8").digest("hex");
  const decider = psql<{ id: string }>("SELECT id::text AS id FROM public.users ORDER BY created_at LIMIT 1")[0]?.id;
  if (decider === undefined) throw new Error("e2e: karar veren kullanıcı fikstürü yok");
  psql(
    `INSERT INTO wms_platform.demo_requests (id, received_at, name, company, email, status, decided_at, decided_by,
                                             activation_token_hash, activation_delivery, activation_expires_at)
     VALUES ($1::uuid, now(), 'E2E Kişi', 'E2E Deneme AŞ', $2, 'APPROVED', now(), $3::uuid, $4, 'SCREEN', now() + interval '72 hours')`,
    [id, email, decider, hash],
  );
  return { id, email, token };
}

if (!process.env.E2E_BASE_URL?.trim()) {
  test("T-995: bağlantıdan deneme alanı — ad, örnek veri, parola, iki adımlı doğrulama, hazır; kısa adres; bağlantı tek kullanımlık", async ({ page }) => {
    test.setTimeout(120_000);
    const r = approvedRequest();
    const slug = `e2e-${randomBytes(4).toString("hex")}`;
    const password = `E2e-${randomBytes(12).toString("hex")}`;

    await page.goto(`/activate/${r.token}`);
    await expect(page.getByRole("heading", { level: 1, name: "Çalışma alanınızı adlandırın" })).toBeVisible();
    await expect(page.locator("#g-co")).toHaveValue("E2E Deneme AŞ");
    // Hidrasyon tamamlanmadan yazılan değer React durumuyla ezilir: önce firma adından üretilen adın sunucu yanıtı beklenir.
    await expect(page.locator("#g-slug-h")).toHaveText(/^Uygun · adresiniz .+\/e2e-deneme-as$/);
    const slugInput = page.locator("#g-slug");
    await slugInput.click();
    await slugInput.press("ControlOrMeta+a");
    await slugInput.pressSequentially(slug, { delay: 20 });
    await expect(slugInput).toHaveValue(slug);
    await expect(page.locator("#g-slug-h")).toHaveText(new RegExp(`^Uygun · adresiniz .+/${slug}$`));
    await page.getByRole("button", { name: /DEVAM/ }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Nasıl başlamak istersiniz?" })).toBeVisible();
    await page.getByRole("radio", { name: /Boş başla/ }).click();
    await page.getByRole("button", { name: /DEVAM/ }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Parolanızı belirleyin" })).toBeVisible();
    await expect(page.getByText(r.email)).toBeVisible();
    await expect(page.getByText("Girişte bu adresi kullanacaksınız")).toBeVisible(); // ekranda teslim: adres doğrulandı denmez
    const save = page.getByRole("button", { name: /PAROLAYI KAYDET/ });
    await expect(save).toBeDisabled();
    await page.locator("#g-np").fill(password);
    await save.click();

    // T-1034: iki adımlı doğrulama sihirbazı — 1 uygulama → 2 hesabı ekle → 3 kod (altıncı rakamda doğrular) → 4 yedek kodlar.
    await expect(page.getByRole("heading", { level: 1, name: "Telefonunuza doğrulama uygulaması kurun" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /UYGULAMA KURULU, DEVAM/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Hesabınızı uygulamaya ekleyin" })).toBeVisible();
    await page.getByRole("button", { name: "QR okutamıyorum" }).click();
    const key = ((await page.getByTestId("totp-anahtar").locator("code").textContent()) ?? "").replace(/\s+/g, "");
    expect(key).toMatch(/^[A-Z2-7]{16,}$/);
    await page.getByRole("button", { name: /EKLEDİM, DEVAM/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Uygulamadaki kodu yazın" })).toBeVisible();
    await page.getByLabel("6 haneli kod").fill(totpNow(key));
    await expect(page.getByRole("heading", { level: 1, name: "Yedek kodlarınızı saklayın" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("totp-yedek").locator("dd")).toHaveCount(10);
    await page.getByRole("button", { name: /TAMAMLA/ }).click();
    await expect(page.getByText("Devam etmek için kodları kaydettiğinizi işaretleyin.")).toBeVisible();
    await page.getByRole("checkbox", { name: "Kodları kaydettim" }).click();
    await page.getByRole("button", { name: /TAMAMLA/ }).click();

    await expect(page.getByText("Çalışma alanınız hazır")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/DENEME · 3 AY · \d{2}\.\d{2}\.\d{4}/)).toBeVisible();
    await expect(page.getByText(/Bu adresi ve çalışma alanı adresinizi not alın/)).toBeVisible(); // posta kapalı: "gönderildi" yok
    const sub = psql<{ plan: string; exact: boolean }>(
      `SELECT s.plan, s.trial_ends_at = s.started_at + interval '3 months' AS exact
         FROM wms_platform.subscriptions s JOIN public.tenants t ON t.id = s.tenant_id WHERE t.slug = $1`,
      [slug],
    );
    expect(sub).toEqual([{ plan: "TRIAL", exact: true }]);
    const owner = psql<{ two_factor_enabled: boolean }>("SELECT two_factor_enabled FROM public.users WHERE email = $1", [r.email]);
    expect(owner).toEqual([{ two_factor_enabled: true }]);

    await page.getByRole("button", { name: /ÇALIŞMA ALANINI AÇ/ }).click();
    await page.waitForURL(new RegExp(`/(t/${slug}|onboarding)`), { timeout: 30_000 });

    // Kısa adres yalnız yönlendirir; üyelik `/t/<alan>`'da yine denetlenir.
    const resp = await page.request.get(`/${slug}`, { maxRedirects: 0 });
    expect(resp.status()).toBe(307);
    expect(resp.headers()["location"]).toMatch(new RegExp(`/t/${slug}$`));

    // Tek kullanım: aynı bağlantı artık geçersiz.
    await page.goto(`/activate/${r.token}`);
    await expect(page.getByRole("heading", { level: 1, name: "Bu bağlantı kullanılamıyor" })).toBeVisible();
  });
}
