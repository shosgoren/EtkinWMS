// T-279: boş tenant fikstürü istemcisi. Fikstür `tests/e2e/global-setup.ts` içinde (yerel koşuda) kurulur: demo OLMAYAN bir hesap, uygulamanın
// kendi yoluyla (kayıt ucu + kurulum sihirbazı, M9 koruması etkin) boş bir çalışma alanı açar ve MFA'yı gerçek ekrandan kurar; çalışma alanının sahibi
// TENANT_ADMIN'dir. MFA kuralı (access.ts:92-96) aynen geçerlidir. Kimlik bilgileri YALNIZCA `process.env`'dedir (bellek; parola ve TOTP sırrı her
// koşuda rastgele, diske/loga/rapora yazılmaz, G-09; bu modülü kullanan spec'lerde trace kapalıdır ve `afterEach` gizli alanları boşaltır — aşağıya bkz.). Uzak koşuda (E2E_BASE_URL) fikstür YOKTUR: bu modülü kullanan spec dosyaları
// `playwright.config.ts` `testIgnore` ile dışlanır.
//
// G-09 yöntemi: Playwright her API çağrısını (fill/type/press) değeriyle adım başlığına, rapora, çağrı günlüğüne ve trace'e yazar. Bu yüzden gizli
// değer HİÇBİR Playwright çağrısına parametre olmaz: sayfaya `exposeFunction` ile yalnızca bir işlev adı verilir, sayfa içi sabit bir betik değeri
// o işlevden alıp alana yazar (değer yalnızca sayfa <-> süreç arasında, API parametresi olmadan akar). Hata iletilerine gizli değer girmez.
// Trace bunu KORUMAZ: DOM anlık görüntüsü input değerini, ağ kaydı istek gövdesini saklar → giriş yapan spec'ler `trace: "off"` kullanır.
import { createHmac } from "node:crypto";
import { expect } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { completeFirstUseGuide } from "./first-use-guide.ts";

export interface EmptyTenant {
  readonly slug: string;
  readonly email: string;
  readonly password: string;
  readonly totpSecret: string;
}

/** T-956: each workflow/device provisions a real independent local signup/workspace/MFA actor. */
export const PACKAGE_ACTORS = [
  { workflow: "receiving", fixture: "receivingDesktop", prefix: "E2E_PACKAGE_RECEIVING_DESKTOP", mobile: false, clientIp: "198.51.100.81" },
  { workflow: "receiving", fixture: "receivingMobile", prefix: "E2E_PACKAGE_RECEIVING_MOBILE", mobile: true, clientIp: "198.51.100.82" },
  { workflow: "movement", fixture: "movementDesktop", prefix: "E2E_PACKAGE_MOVEMENT_DESKTOP", mobile: false, clientIp: "198.51.100.83" },
  { workflow: "movement", fixture: "movementMobile", prefix: "E2E_PACKAGE_MOVEMENT_MOBILE", mobile: true, clientIp: "198.51.100.84" },
  { workflow: "transfer", fixture: "transferDesktop", prefix: "E2E_PACKAGE_TRANSFER_DESKTOP", mobile: false, clientIp: "198.51.100.85" },
  { workflow: "transfer", fixture: "transferMobile", prefix: "E2E_PACKAGE_TRANSFER_MOBILE", mobile: true, clientIp: "198.51.100.86" },
  { workflow: "production", fixture: "productionDesktop", prefix: "E2E_PACKAGE_PRODUCTION_DESKTOP", mobile: false, clientIp: "198.51.100.87" },
  { workflow: "production", fixture: "productionMobile", prefix: "E2E_PACKAGE_PRODUCTION_MOBILE", mobile: true, clientIp: "198.51.100.88" },
] as const;
export type PackageWorkflow = (typeof PACKAGE_ACTORS)[number]["workflow"];
type TenantFixture = "empty" | "pilot" | "stockDesktop" | "stockMobile" | "multi" | "erp" | "tour" | (typeof PACKAGE_ACTORS)[number]["fixture"];
export function packageActor(workflow: PackageWorkflow, mobile: boolean) {
  const actor = PACKAGE_ACTORS.find(a => a.workflow === workflow && a.mobile === mobile);
  if (actor === undefined) throw new Error("e2e: unknown package workflow actor");
  return actor;
}

export function emptyTenant(fixture: TenantFixture = "empty"): EmptyTenant {
  if (process.env.E2E_BASE_URL?.trim()) throw new Error("e2e: yerel tenant fikstürü uzak hedefte kullanılamaz");
  const actor = PACKAGE_ACTORS.find(a => a.fixture === fixture);
  const legacy = { empty: "E2E_EMPTY", pilot: "E2E_PILOT", stockDesktop: "E2E_STOCK_DESKTOP", stockMobile: "E2E_STOCK_MOBILE", multi: "E2E_MULTI", erp: "E2E_ERP", tour: "E2E_TOUR" };
  const prefix = actor?.prefix ?? legacy[fixture as keyof typeof legacy];
  if (prefix === undefined) throw new Error("e2e: unknown tenant fixture");
  const slug = process.env[`${prefix}_SLUG`];
  const email = process.env[`${prefix}_EMAIL`];
  const password = process.env[`${prefix}_PASSWORD`];
  const totpSecret = process.env[`${prefix}_TOTP_SECRET`];
  if (!slug || !email || !password || !totpSecret) {
    throw new Error("e2e: boş tenant fikstürü yok (global-setup yerel yığında kurar; uzak koşuda bu spec dışlanır)");
  }
  return { slug, email, password, totpSecret };
}

/** Yerel TLS vekili için test istemci adresi (TEST-NET-2); uzak hedefte başlık eklenmez (playwright.config.ts localClient ile aynı koşul). */
export function localClient(ip: string): { extraHTTPHeaders?: Record<string, string> } {
  return process.env.E2E_BASE_URL?.trim() ? {} : { extraHTTPHeaders: { "x-e2e-client-ip": ip } };
}

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase()) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("e2e: TOTP sırrı base32 değil");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/**
 * RFC 6238 TOTP (HMAC-SHA1, 30 sn, 6 hane; sunucu varsayılanı: better-auth `createOTP` period 30, digits 6). Sunucu ±1 pencere kabul eder ve
 * kullanılmış kodu tekrar reddetmez (better-auth totp doğrulaması yalnızca `createOTP(...).verify` çağırır, tüketim kaydı yok); bu yüzden her çağrı
 * o anki pencerenin kodunu üretir ve pencere sınırı yarışı ±1 toleransla karşılanır: bekleme ya da zaman aşımı artırımı gerekmez.
 */
export function totpNow(secret: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const off = (h[h.length - 1] ?? 0) & 0x0f;
  const bin = (((h[off] ?? 0) & 0x7f) << 24) | (((h[off + 1] ?? 0) & 0xff) << 16) | (((h[off + 2] ?? 0) & 0xff) << 8) | ((h[off + 3] ?? 0) & 0xff);
  return String(bin % 1_000_000).padStart(6, "0");
}

export interface SecretSource {
  readonly password: string;
  /** MFA kurulumundan sonra bilinir. */
  totpSecret?: string;
}

/** Sayfaya gizli değer kaynağını bağlar (sayfa başına bir kez; gezinmelerde kalır). Değerler Playwright API parametresi değildir. */
async function bindSecrets(page: Page, src: SecretSource): Promise<void> {
  await page.exposeFunction("__e2eSecret", (kind: string): string => {
    if (kind === "password") return src.password;
    if (kind === "totp" && src.totpSecret !== undefined) return totpNow(src.totpSecret);
    throw new Error("e2e: bilinmeyen gizli değer türü");
  });
}

/** Alana, bağlı kaynaktan gelen gizli değeri yazar (React'in `input` olayı dahil). Betik sabittir; yalnızca seçici ve tür adı geçer. */
async function fillSecret(page: Page, selector: string, kind: "password" | "totp"): Promise<void> {
  await page.locator(selector).waitFor();
  await page.evaluate(`(async () => {
    const el = document.querySelector(${JSON.stringify(selector)});
    const value = await window.__e2eSecret(${JSON.stringify(kind)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
}

/**
 * Gizli değer taşıyabilen alanları boşaltır. Başarısız testte Playwright, bağlam kapanırken sayfanın erişilebilirlik ağacını
 * `error-context.md`'ye (HTML rapor eki, CI artifact) yazar ve parola alanının değerini maskelemez (T-279 SR @87e6912). Anlık görüntü
 * kullanıcı `afterEach` kancalarından SONRA alınır; bu yüzden giriş yapan spec'ler bunu `test.afterEach` içinde çağırır (zaman aşımı dahil).
 */
export async function scrubSecretInputs(page: Page): Promise<void> {
  if (page.isClosed()) return;
  await page.evaluate(`(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    for (const el of document.querySelectorAll('input[type="password"], input[name="password"], input[name="code"], input[autocomplete="one-time-code"]')) {
      set.call(el, "");
    }
  })()`);
}

/** Normal e-posta/parola giriş formu + iki adım (TOTP) ekranı; girişten sonra kiracı ana ekranı. */
export async function loginEmptyTenant(page: Page, fixture: TenantFixture = "empty", opts: { readonly keepTour?: boolean } = {}): Promise<EmptyTenant> {
  const t = emptyTenant(fixture);
  await bindSecrets(page, { password: t.password, totpSecret: t.totpSecret });
  await page.goto(`/login?next=${encodeURIComponent(`/t/${t.slug}`)}`);
  await page.getByLabel("E-posta").fill(t.email);
  await fillSecret(page, 'input[name="password"]', "password");
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/mfa\?/);
  await fillSecret(page, 'input[name="code"]', "totp");
  await page.getByRole("button", { name: "Doğrula" }).click();
  await expect(page).toHaveURL(new RegExp(`/t/${t.slug}$`));
  // T-983: giriş adımlarında rehber açılmaz; girişten sonraki ilk ekranda tamamlanır. T-1006: kurulum turu da (sınayan spec hariç) kapatılır.
  await completeFirstUseGuide(page, opts);
  return t;
}

/** T-999: `next` olmadan giriş (açılış yönlendirmesi sınanır); iki adım doğrulamadan sonra `landing` adresi beklenir. */
export async function loginLanding(page: Page, fixture: TenantFixture, landing: RegExp): Promise<EmptyTenant> {
  const t = emptyTenant(fixture);
  await bindSecrets(page, { password: t.password, totpSecret: t.totpSecret });
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(t.email);
  await fillSecret(page, 'input[name="password"]', "password");
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/mfa\?/);
  await fillSecret(page, 'input[name="code"]', "totp");
  await page.getByRole("button", { name: "Doğrula" }).click();
  await expect(page).toHaveURL(landing);
  return t;
}

/** T-407: panel (operatör) girişi — aynı giriş ve iki adım ekranları, panel kökeninde; gizli değerler sayfaya bağlı kaynaktan. */
export async function loginPanel(page: Page, origin: string, account: { readonly email: string; readonly password: string; readonly totpSecret: string }, next: string): Promise<void> {
  await bindSecrets(page, { password: account.password, totpSecret: account.totpSecret });
  await page.goto(`${origin}/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("E-posta").fill(account.email);
  await fillSecret(page, 'input[name="password"]', "password");
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/mfa\?/);
  await fillSecret(page, 'input[name="code"]', "totp");
  await page.getByRole("button", { name: "Doğrula" }).click();
  await expect(page).toHaveURL(`${origin}${next}`);
}

export interface ProvisionInput {
  readonly browser: Browser;
  /** Kayıt açık (WMS_ENV=ci, SIGNUP_ENABLED=true) ikinci web örneğinin https kökü (tek aşım: workspaceCreationAllowed ortam kapısı). */
  readonly origin: string;
  /** Yalnızca yerel vekil için TEST-NET-2 istemci adresi (kendi hız sınırı kovası). */
  readonly clientIp: string;
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly workspaceName: string;
}

/**
 * Hesap + çalışma alanı + MFA: uygulamanın kendi yolundan (kayıt ucu, kurulum sihirbazı, MFA kurulum ekranı). DB'ye doğrudan yazı yok; M9 ve
 * MFA kuralları değişmez. Tracing hiç başlatılmaz (global-setup); gizli değerler Playwright API parametresi olmaz (dosya başı). TOTP sırrı
 * yalnızca bellekte okunur ve döner; çağıran `process.env`'e koyar.
 */
export async function provisionEmptyTenant(input: ProvisionInput): Promise<{ slug: string; totpSecret: string }> {
  const context = await input.browser.newContext({
    baseURL: input.origin,
    ignoreHTTPSErrors: true,
    locale: "tr-TR",
    extraHTTPHeaders: { "x-e2e-client-ip": input.clientIp },
  });
  try {
    const page = await context.newPage();
    const src: SecretSource = { password: input.password };
    await bindSecrets(page, src);
    // 1) Hesap: Better Auth kayıt ucu (yalnızca local/ci'da açık, A-50). Gövde sayfa içinden gider: değer API parametresi olmaz.
    await page.goto("/login");
    const signedUp = await page.evaluate<number>(`(async () => {
      const password = await window.__e2eSecret("password");
      const res = await fetch("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: ${JSON.stringify(input.name)}, email: ${JSON.stringify(input.email)}, password }),
      });
      return res.status;
    })()`);
    expect(signedUp, "kayıt ucu durum kodu").toBe(200);
    // 2) Çalışma alanı: kurulum sihirbazı (createWorkspace; M9 etkin, demo olmayan e-posta).
    await page.goto("/onboarding");
    await completeFirstUseGuide(page);
    await page.getByLabel("Çalışma alanı adı").fill(input.workspaceName);
    await page.getByRole("button", { name: "Devam" }).click();
    await page.getByRole("button", { name: "Oluştur" }).click();
    // TENANT_ADMIN MFA ister: kiracı düzeni kurulum ekranına yönlendirir (A-38).
    await expect(page).toHaveURL(/\/mfa\?next=/);
    const slug = /^\/t\/([^/]+)\//.exec(new URL(new URL(page.url()).searchParams.get("next") ?? "", page.url()).pathname)?.[1] ?? "";
    expect(slug !== "", "çalışma alanı adresi").toBe(true);
    // 3) MFA kurulumu (T-1034 sihirbazı): parola onayı → uygulama kurulu → "QR okutamıyorum" ile anahtarı oku → ilk kod
    //    (altıncı rakamda kendiliğinden doğrular) → yedek kodları kaydettim → tamamla.
    await fillSecret(page, 'input[name="password"]', "password");
    await page.getByRole("button", { name: "Kuruluma başla" }).click();
    await page.getByTestId("totp-app-ok").click();
    await page.getByTestId("totp-qr-yok").click();
    const secret = ((await page.getByTestId("totp-anahtar").locator("code").textContent()) ?? "").replace(/\s+/g, "");
    expect(/^[A-Z2-7]{16,}$/.test(secret), "TOTP anahtarı ekranda").toBe(true); // ileti sırrı içermez
    src.totpSecret = secret;
    await page.getByTestId("totp-eklendi").click();
    await fillSecret(page, 'input[name="code"]', "totp");
    await expect(page.getByTestId("totp-adim-4")).toBeVisible();
    await page.getByTestId("totp-kaydettim").click();
    await page.getByTestId("totp-bitir").click();
    await expect(page.getByText("İki adımlı doğrulama etkinleştirildi.")).toBeVisible();
    return { slug, totpSecret: secret };
  } finally {
    await context.close();
  }
}
