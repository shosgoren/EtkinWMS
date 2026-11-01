// T-407 (ADR-027 §6) kabul ölçütü, uçtan uca: panelde satış sayfası içeriğini düzenle → yayınla → satış sayfasında. Gerçek panel örneği
// (`APP_SURFACE=panel`, ayrı köken), gerçek giriş + TOTP, gerçek satış sitesi sunucusu (marketing/server.mjs) ana örneğin iç ucundan okur.
// Ayrıca süreli önizleme bağlantısı taslağı gösterir, yayındaki sayfa değişmez. Operatör listesi ve yayındaki paket yerel compose DB'ye
// migration rolüyle `psql` üzerinden yazılır (zzz-activation ile aynı kural: loopback, sterilize hata, sentetik veri). Uzak hedefte
// (E2E_BASE_URL) bu test KAYITLI DEĞİLDİR (atlama değil; panel/satış sitesi örneği ve fikstür kavramı yok).
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { loginPanel, scrubSecretInputs } from "./support/empty-tenant.ts";

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

if (!process.env.E2E_BASE_URL?.trim()) {
  test.afterEach(async ({ page }) => {
    await scrubSecretInputs(page);
  });

  test("T-407: panelde satış sayfası içeriğini düzenle → önizle → yayınla → satış sayfasında başlık ve fiyat bölümü", async ({ page, context }) => {
    test.setTimeout(180_000);
    const panel = process.env.E2E_PANEL_URL;
    const site = process.env.E2E_SITE_URL;
    const email = process.env.E2E_OPERATOR_EMAIL;
    const password = process.env.E2E_OPERATOR_PASSWORD;
    const totpSecret = process.env.E2E_OPERATOR_TOTP_SECRET;
    if (!panel || !site || !email || !password || !totpSecret) throw new Error("e2e: panel/satış sitesi/operatör fikstürü yok (global-setup)");
    // Operatör: veritabanı listesi + doğrulanmış e-posta (panel kuralı); yayındaki sentetik paket.
    psql("UPDATE public.users SET email_verified = true WHERE email = $1", [email]);
    psql("INSERT INTO wms_platform.operators (email_normalized) VALUES ($1) ON CONFLICT DO NOTHING", [email.toLowerCase()]);
    const planId = randomUUID();
    const planName = `E2E Paket ${randomBytes(3).toString("hex")}`;
    psql("INSERT INTO wms_platform.plans (id, name, published) VALUES ($1::uuid, $2, true)", [planId, planName]);
    psql(
      `INSERT INTO wms_platform.plan_versions (plan_id, version, price_monthly, max_admins, max_field, max_warehouses, max_items, feat_qr, feat_ship, feat_prod, feat_api)
       VALUES ($1::uuid, 1, 2490, 3, 0, 2, 1000, true, true, false, false)`,
      [planId],
    );

    await loginPanel(page, panel, { email, password, totpSecret }, "/satis");
    try {
      await expect(page.getByRole("heading", { level: 1, name: "Satış sayfası" })).toBeVisible();
    } catch (e) {
      // Tanı: sayfa metni ve panel örneğinin maskeli günlüğündeki hata satırları (sır içermez; günlük maskelidir).
      const body = (await page.locator("body").innerText().catch(() => "")).slice(0, 400);
      let log = "";
      try {
        log = readFileSync(path.join(process.cwd(), ".artifacts/e2e/web-panel.log"), "utf8").split("\n").filter((l) => /error|Error/.test(l)).slice(-8).join("\n").slice(0, 1500);
      } catch {
        log = "(günlük okunamadı)";
      }
      throw new Error(`satis sayfası açılmadı: ${page.url()}\n--- sayfa ---\n${body}\n--- panel günlüğü ---\n${log}`, { cause: e });
    }
    const title1 = `E2E başlık ${randomBytes(3).toString("hex")}`;
    await page.locator("#y-h1").fill(title1);
    await page.locator("#y-h2").fill("tek ekranda.");
    await page.locator("#y-sub").fill("Uçtan uca denenmiş alt metin.");
    const sw = page.getByRole("switch", { name: planName });
    if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true");
    // Önizleme kartı yazarken güncellenir.
    await expect(page.getByLabel("Satış sayfası önizlemesi")).toContainText(title1);

    // T-1027: başka ziyaretçinin talebi açık panelin sayacına gelir; yazılan taslak korunur.
    // Yalnız loopback DB'de sentetik kayıt; canlı satış formuna müşteri talebi gönderilmez.
    const badge = page.locator('.side button[aria-label="Demo talepleri"] .cnt');
    const before = Number((await badge.count()) ? await badge.textContent() : "0");
    const requestName = `T1027 ${randomBytes(4).toString("hex")}`;
    psql("INSERT INTO wms_platform.demo_requests (id, received_at, name, company, email) VALUES ($1::uuid, now(), $2, 'E2E Otomatik', $3)",
      [randomUUID(), requestName, `${randomUUID()}@example.test`]);
    await expect(badge).toHaveText(String(before + 1));
    await expect(page.locator("#y-h1")).toHaveValue(title1);
    await expect(page.locator("#y-h2")).toHaveValue("tek ekranda.");
    await expect(page.locator("#y-sub")).toHaveValue("Uçtan uca denenmiş alt metin.");

    await page.getByRole("button", { name: "Yayınla" }).click();
    await expect(page.locator(".kpi-s", { hasText: "SON YAYIN" })).toContainText(/SÜRÜM \d+/);

    // Satış sayfası: başlık sunucuda yerleşir (önbellek ≤ 45 sn), fiyat bölümünde yalnız yayındaki seçili paket.
    const visitor = await context.newPage();
    await expect
      .poll(async () => {
        await visitor.goto(`${site}/`);
        return visitor.locator("h1.htitle").innerText();
      }, { timeout: 90_000, intervals: [3_000] })
      .toContain(title1);
    await expect(visitor.locator("h1.htitle")).toContainText("tek ekranda.");
    await expect(visitor.locator(".cine-sub")).toHaveText("Uçtan uca denenmiş alt metin.");
    const pricing = visitor.locator("#kiralama");
    await expect(pricing).toContainText(planName);
    await expect(pricing).toContainText("₺2.490");
    await expect(pricing).toContainText("Sınırsız saha personeli");

    // Önizleme: kaydedilen taslak süreli bağlantıda görünür; yayındaki sayfa değişmez.
    const draft = `E2E taslak ${randomBytes(3).toString("hex")}`;
    await page.locator("#y-h1").fill(draft);
    await page.getByRole("button", { name: "Önizleme bağlantısı" }).click();
    const box = page.getByTestId("site-preview-link");
    await expect(box).toBeVisible();
    const link = ((await box.locator(".mono").textContent()) ?? "").trim();
    expect(link.startsWith(`${site}/?onizleme=`)).toBe(true);
    expect(link.slice(`${site}/?onizleme=`.length)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const response = await visitor.goto(link);
    expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    await expect(visitor.locator("h1.htitle")).toContainText(draft);
    await visitor.goto(`${site}/`);
    await expect(visitor.locator("h1.htitle")).toContainText(title1);
    await visitor.close();

    await page.goto(`${panel}/talepler`);
    await expect(page.locator("tr", { hasText: requestName })).toBeVisible();
    const incoming = `T1027 yeni ${randomBytes(4).toString("hex")}`;
    const incomingEmail = `${randomUUID()}@example.test`;
    psql("INSERT INTO wms_platform.demo_requests (id, received_at, name, company, email) VALUES ($1::uuid, now(), $2, 'E2E Otomatik', $3)",
      [randomUUID(), incoming, incomingEmail]);
    // goto/reload yok: açık listenin kendiliğinden değişmesi kabul ölçütüdür.
    const row = page.locator("tr", { hasText: incoming });
    await expect(row).toBeVisible();
    await expect(page).toHaveURL(`${panel}/talepler`);

    // T-1144 (kullanıcı kararı 1 Kasım): Onayla / Reddet / Geri aç tek soruluk ortak onay penceresinden geçer; Vazgeç hiçbir şey yapmaz.
    // Aynı oturumda (ikinci giriş TOTP kodunu yeniden kullanırdı). Onayı göndermek bu örnekte uygulama kökü (WMS_APP_URL) olmadığından
    // yapılmaz; onay penceresinin sorusu ve Vazgeç denetlenir, onayın kendisi int testindedir (platform/demo-requests.int.test.ts).
    const dialog = page.getByRole("dialog");
    await row.getByRole("button", { name: "Reddet" }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Talep reddedilsin mi?" })).toBeVisible();
    await dialog.getByRole("button", { name: "Vazgeç" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row).toHaveAttribute("data-status", "PENDING");

    await row.getByRole("button", { name: "Reddet" }).click();
    await dialog.getByRole("button", { name: "Reddet" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row).toHaveAttribute("data-status", "REJECTED");
    await expect(page.getByTestId("balon")).toContainText("Talep reddedildi");

    await row.getByRole("button", { name: "Geri aç" }).click();
    await expect(dialog.getByRole("heading", { name: "Talep geri açılsın mı?" })).toBeVisible();
    await dialog.getByRole("button", { name: "Geri aç" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row).toHaveAttribute("data-status", "PENDING");
    await expect(row.getByRole("button", { name: "Geri aç" })).toHaveCount(0);
    await expect(page.getByTestId("balon")).toContainText("Talep geri açıldı");

    await row.getByRole("button", { name: "Onayla" }).click();
    await expect(dialog.getByRole("heading", { name: `${incoming} (${incomingEmail}) adresine giriş bağlantısı gönderilsin mi?` })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Gönder" })).toBeVisible();
    await dialog.getByRole("button", { name: "Vazgeç" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row).toHaveAttribute("data-status", "PENDING");
  });
}
