// Playwright globalSetup (T-131): yerel yığını kurar; `E2E_BASE_URL` verilmişse (staging) yığın kurmaz, yalnız paylaşılan yönetici oturumunu açar (T-300).
//
// Yerel yığın (compose postgres + pgbouncer ÖNCEDEN ayakta olmalı: `docker compose up -d --wait`):
//   1. `pnpm db:migrate` (demo tenant satırı dahil; DEMO_MODE=1, WMS_ENV=staging)
//   2. worker derlenir ve başlatılır; açılışta `demo.reseed` işi demo kullanıcılarını kurar ("demo.reseed done" günlüğü beklenir)
//   3b. (T-279) boş tenant fikstürü: kayıt açık (ci) KISA ÖMÜRLÜ ikinci web örneğinde hesap + çalışma alanı + MFA (gerçek ekranlar); sonra kapatılır
//   3. web derlenir (E2E_SKIP_BUILD=1 ile atlanır) ve `next start` ile iç porta (PORT+1) açılır
//   4. kendinden imzalı sertifikalı TLS ters vekili PORT'ta dinler (BETTER_AUTH_URL staging kipinde https ister)
// Parolalar/sırlar her koşuda rastgele üretilir (ortamda yoksa); diske/loga yazılmaz. Yalnızca yerel veritabanına (loopback) bağlanır.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { chromium } from "@playwright/test";
import { clearSharedSession, mintSharedSession } from "./support/demo-session.ts";
import { PACKAGE_ACTORS, provisionEmptyTenant } from "./support/empty-tenant.ts";
import { startFakeParasut, type FakeParasut } from "../integration/fixtures/fake-parasut.ts";
import { startFakeVoice, type FakeVoice } from "./support/fake-voice.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, ".artifacts/e2e");
const PLACEHOLDER_SEAL = "0".repeat(64);
// T-278: playwright.config.ts projeleri bu başlıkla ayrı istemci adresi bildirir (yalnızca yerel vekil okur).
const E2E_CLIENT_IP_HEADER = "x-e2e-client-ip";
const TEST_NET_2 = /^198\.51\.100\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

function loadDotEnv(): void {
  // `.env` yoksa `.env.example` (yalnızca yerel yer tutucular; G-09). Var olan ortam değişkenleri ezilmez.
  for (const name of [".env", ".env.example"]) {
    const file = path.join(ROOT, name);
    if (existsSync(file)) {
      process.loadEnvFile(file);
      return;
    }
  }
}

function assertLoopbackDatabase(env: NodeJS.ProcessEnv): void {
  for (const key of ["DATABASE_URL_DIRECT", "DATABASE_URL", "AUTH_DATABASE_URL", "DATABASE_URL_WORKER"]) {
    const value = env[key];
    if (value === undefined || value === "") throw new Error(`e2e: ${key} tanımlı değil (.env / .env.example; docker compose up -d --wait)`);
    const host = new URL(value).hostname;
    if (host !== "localhost" && host !== "127.0.0.1") {
      throw new Error(`e2e: ${key} yerel olmayan bir sunucuya işaret ediyor; yerel koşu yalnızca loopback veritabanına bağlanır (staging için E2E_BASE_URL verin).`);
    }
  }
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, logName: string): void {
  const fd = openSync(path.join(OUT, logName), "w");
  try {
    execFileSync(cmd, args, { cwd: ROOT, env, stdio: ["ignore", fd, fd] });
  } catch (e) {
    throw new Error(`e2e: '${cmd} ${args.join(" ")}' başarısız (bkz. .artifacts/e2e/${logName})`, { cause: e });
  }
}

function start(cmd: string, args: string[], env: NodeJS.ProcessEnv, logName: string): ChildProcess {
  const fd = openSync(path.join(OUT, logName), "w");
  return spawn(cmd, args, { cwd: ROOT, env, stdio: ["ignore", fd, fd], detached: true });
}

/** Next'in desteklenen standalone çıktısı: Cloud'da derleme ayrı yerel konteynerde yapılabilir. */
function startWeb(port: number, env: NodeJS.ProcessEnv, logName: string, host = "127.0.0.1"): ChildProcess {
  if (process.env.E2E_STANDALONE === "1") {
    const webRoot = path.join(ROOT, "apps/web");
    const output = path.join(webRoot, ".next/standalone/apps/web");
    if (!existsSync(path.join(output, "server.js"))) throw new Error("e2e: standalone build yok");
    cpSync(path.join(webRoot, ".next/static"), path.join(output, ".next/static"), { recursive: true });
    if (existsSync(path.join(webRoot, "public"))) cpSync(path.join(webRoot, "public"), path.join(output, "public"), { recursive: true });
    return start("node", [path.join(output, "server.js")], { ...env, PORT: String(port), HOSTNAME: host }, logName);
  }
  return start("pnpm", ["--filter", "@wms/web", "exec", "next", "start", "-p", String(port), "-H", host], env, logName);
}

function stop(child: ChildProcess | undefined): void {
  if (child?.pid === undefined) return;
  try {
    process.kill(-child.pid, "SIGTERM"); // süreç grubu (pnpm → node)
  } catch {
    // zaten çıkmış
  }
}

async function waitFor(what: string, timeoutMs: number, probe: () => Promise<boolean> | boolean): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`e2e: zaman aşımı — ${what} (${timeoutMs} ms)`);
}

function startTlsProxy(port: number, targetPort: number, keyFile: string, certFile: string): https.Server {
  const server = https.createServer({ key: readFileSync(keyFile), cert: readFileSync(certFile) }, (req, res) => {
    // T-278: her Playwright projesi ayrı bir cihazdır; vekil istemci adresini test başlığından alır (yalnız TEST-NET-2,
    // RFC 5737), yoksa soket adresinden. Başlık uygulamaya iletilmez.
    const { [E2E_CLIENT_IP_HEADER]: declared, ...forwardHeaders } = req.headers;
    const clientIp = typeof declared === "string" && TEST_NET_2.test(declared) ? declared : (req.socket.remoteAddress ?? "127.0.0.1");
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: targetPort,
        method: req.method,
        path: req.url,
        // Fly kenarını taklit eder: uygulama istemci IP'sini yalnızca `Fly-Client-IP`'den okur (apps/web/lib/rate-limit.ts).
        // T-407: üretimdeki Caddy gibi `X-Forwarded-Host` da verilir; yoksa Next iç yeniden yazmayı (panel `/satis` → `/panel/satis`)
        // kendi iç portuna https ile dış vekil isteği sanıyordu.
        headers: { ...forwardHeaders, "x-forwarded-proto": "https", "x-forwarded-host": req.headers.host ?? `localhost:${port}`, "fly-client-ip": clientIp },
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });
  server.listen(port, "127.0.0.1");
  return server;
}

export default async function globalSetup(): Promise<(() => Promise<void>) | undefined> {
  const remote = process.env.E2E_BASE_URL?.trim();
  if (remote) {
    // staging/uzak koşu: yığın dışarıda. T-300: tek runner IP'si demo giriş sınırını (10 / 10 dk) aşmasın diye yönetici için BİR KEZ gerçek
    // ekrandan girilir; oturum `.artifacts/session/` altına yazılır (artifact'a girmez). Çıkış yapan spec'ler kendi girişini yapar.
    const browser = await chromium.launch(process.env.E2E_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.E2E_CHROMIUM_EXECUTABLE_PATH } : {});
    try {
      await mintSharedSession(browser, remote);
    } finally {
      await browser.close();
    }
    return undefined;
  }

  mkdirSync(OUT, { recursive: true });
  loadDotEnv();
  const port = Number(process.env.E2E_PORT ?? "3100");
  const innerPort = port + 1;

  const env: NodeJS.ProcessEnv = { ...process.env };
  env.WMS_ENV = "staging";
  env.DEMO_MODE = "1";
  env.DEMO_EMAIL_DOMAIN = "example.invalid";
  env.MAIL_MODE = "disabled"; // staging kipinde mailpit kapalı; davet bağlantısı ekranda gösterilir
  env.BETTER_AUTH_URL = `https://localhost:${port}`;
  env.DEMO_PASSWORD ||= randomBytes(18).toString("hex");
  env.BETTER_AUTH_SECRET ||= randomBytes(32).toString("hex");
  if (!env.QUEUE_SEAL_KEY || env.QUEUE_SEAL_KEY === PLACEHOLDER_SEAL) env.QUEUE_SEAL_KEY = randomBytes(32).toString("hex");
  // T-413 (A-77 kararı 18 Ekim): canlıda depo kapsamı açık; uçtan uca testler aynı kipte koşar.
  env.WAREHOUSE_SCOPE_ENABLED = "true";
  assertLoopbackDatabase(env);
  // T-991: sahte Paraşüt (yalnız 127.0.0.1; gerçek ağ yok). Web ve worker sağlayıcı adresini buradan alır (geri döngü dışı adres reddedilir).
  const fakeParasut: FakeParasut = await startFakeParasut();
  env.PARASUT_BASE_URL = fakeParasut.url;
  // T-1002: sahte iç ses servisi (yalnız 127.0.0.1; model yok). Web Etkin isteğini buraya iletir.
  const fakeVoice: FakeVoice = await startFakeVoice();
  env.VOICE_URL = fakeVoice.url;
  // T-938: local, loopback-asserted web subprocesses only. Remote early return above never enables this flag.
  const packageWebEnv = { ...env, PACKAGE_RECEIVING_ENABLED: "true" };

  run("pnpm", ["db:migrate"], env, "migrate.log");
  run("pnpm", ["--filter", "@wms/worker", "build"], env, "worker-build.log");
  if (process.env.E2E_SKIP_BUILD !== "1") run("pnpm", ["--filter", "@wms/web", "build"], packageWebEnv, "web-build.log");

  const children: ChildProcess[] = [];
  let proxy: https.Server | undefined;
  let proxyPanel: https.Server | undefined;
  const teardown = async (): Promise<void> => {
    clearSharedSession();
    await fakeParasut.close().catch(() => undefined);
    await fakeVoice.close().catch(() => undefined);
    for (const prefix of ["E2E_EMPTY", "E2E_PILOT", "E2E_STOCK_DESKTOP", "E2E_STOCK_MOBILE", "E2E_OPERATOR", "E2E_MULTI", "E2E_ERP", "E2E_TOUR", "E2E_TOUR_SETUP_DESKTOP", "E2E_TOUR_SETUP_MOBILE", "E2E_TOUR_OP_DESKTOP", "E2E_TOUR_OP_MOBILE", "E2E_TOUR_RACE_DESKTOP", "E2E_TOUR_RACE_MOBILE", ...PACKAGE_ACTORS.map(actor => actor.prefix)]) {
      for (const key of ["SLUG", "EMAIL", "PASSWORD", "TOTP_SECRET"]) delete process.env[`${prefix}_${key}`];
    }
    proxy?.close();
    proxy?.closeAllConnections();
    proxyPanel?.close();
    proxyPanel?.closeAllConnections();
    for (const c of children) stop(c);
  };

  try {
    const worker = start("node", ["apps/worker/dist/main.js"], env, "worker.log");
    children.push(worker);
    await waitFor("worker demo.reseed tamamlanmadı (bkz. .artifacts/e2e/worker.log)", 120_000, () => {
      if (worker.exitCode !== null) throw new Error("e2e: worker beklenmedik biçimde çıktı (bkz. .artifacts/e2e/worker.log)");
      return readFileSync(path.join(OUT, "worker.log"), "utf8").includes('"msg":"demo.reseed done"');
    });

    const web = startWeb(innerPort, packageWebEnv, "web.log");
    children.push(web);
    await waitFor("web hazır değil (bkz. .artifacts/e2e/web.log)", 120_000, async () => {
      if (web.exitCode !== null) throw new Error("e2e: web beklenmedik biçimde çıktı (bkz. .artifacts/e2e/web.log)");
      try {
        return (await fetch(`http://127.0.0.1:${innerPort}/api/health/live`)).ok;
      } catch {
        return false;
      }
    });

    const key = path.join(OUT, "tls-key.pem");
    const cert = path.join(OUT, "tls-cert.pem");
    execFileSync(
      "openssl",
      ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost", "-keyout", key, "-out", cert],
      { stdio: "ignore" },
    );
    proxy = startTlsProxy(port, innerPort, key, cert);
    await waitFor("TLS vekili hazır değil", 10_000, async () => {
      return new Promise<boolean>((resolve) => {
        // Kendinden imzalı yerel sertifika: yalnızca bu hazır olma yoklaması doğrulamayı atlar.
        const req = https.get({ host: "localhost", port, path: "/api/health/live", rejectUnauthorized: false }, (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        });
        req.on("error", () => resolve(false));
      });
    });

    // T-407: panel kipi (yonet. eşdeğeri, aynı derleme `APP_SURFACE=panel`, ayrı köken/çerez) ve satış sitesi sunucusu. Satış sitesi içeriği
    // ana örneğin iç ucundan okur (üretimdeki `http://web:3000/api/public/site` eşdeğeri). Uçtan uca: panelde düzenle → yayınla → satış sayfası.
    const innerPanel = port + 5;
    const portPanel = port + 4;
    const portSite = port + 6;
    const panelEnv: NodeJS.ProcessEnv = { ...env, APP_SURFACE: "panel", BETTER_AUTH_URL: `https://localhost:${portPanel}`, MARKETING_URL: `http://localhost:${portSite}` };
    delete panelEnv.DEMO_MODE;
    // Üretimdeki gibi tüm arayüzlerde (HOSTNAME=0.0.0.0): Next bu durumda iç yeniden yazmanın kökenini istek başlıklarından kurar; belirli
    // bir adrese bağlıyken kendi `localhost:<iç port>` kökenini https sanıp yeniden yazmayı dış vekil isteğine çeviriyordu (T-407).
    const panel = startWeb(innerPanel, panelEnv, "web-panel.log", "0.0.0.0");
    children.push(panel);
    const site = start("node", ["marketing/server.mjs"], { PATH: process.env.PATH, PORT: String(portSite), LEAD_DIR: path.join(OUT, "marketing-leads"), SITE_CONTENT_URL: `http://127.0.0.1:${innerPort}/api/public/site` }, "marketing.log");
    children.push(site);
    await waitFor("panel örneği hazır değil (bkz. .artifacts/e2e/web-panel.log)", 120_000, async () => {
      if (panel.exitCode !== null) throw new Error("e2e: panel örneği beklenmedik biçimde çıktı (bkz. .artifacts/e2e/web-panel.log)");
      try {
        return (await fetch(`http://127.0.0.1:${innerPanel}/api/health/live`)).ok;
      } catch {
        return false;
      }
    });
    proxyPanel = startTlsProxy(portPanel, innerPanel, key, cert);
    await waitFor("satış sitesi hazır değil (bkz. .artifacts/e2e/marketing.log)", 30_000, async () => {
      if (site.exitCode !== null) throw new Error("e2e: satış sitesi beklenmedik biçimde çıktı (bkz. .artifacts/e2e/marketing.log)");
      try {
        return (await fetch(`http://127.0.0.1:${portSite}/`)).ok;
      } catch {
        return false;
      }
    });
    process.env.E2E_PANEL_URL = `https://localhost:${portPanel}`;
    process.env.E2E_SITE_URL = `http://localhost:${portSite}`;

    // T-279: boş tenant fikstürü (depo/ürün yok). TENANT_ADMIN MFA ister (access.ts:92-96) ve demo hesapları MFA kuramaz; bu yüzden fikstür
    // DEMO OLMAYAN bir hesaptır ve çalışma alanını kendisi açar (M9 etkin: DEMO_EMAIL_DOMAIN iletilir). Üretimdeki yol kullanılır: kayıt ucu +
    // kurulum sihirbazı + gerçek MFA ekranı. Kalan TEK aşım ortam kapısıdır (`workspaceCreationAllowed`: WMS_ENV=ci + SIGNUP_ENABLED=true): bu
    // kapı YALNIZCA kısa ömürlü ikinci bir web örneğinde (aynı DB) açılır ve fikstür kurulunca kapatılır; testlerin koştuğu örnek staging kalır.
    // Parola/TOTP sırrı her koşuda rastgele; yalnızca bellekte/process.env.
    const suffix = randomBytes(4).toString("hex");
    const innerB = port + 2;
    const portB = port + 3;
    const envB: NodeJS.ProcessEnv = { ...packageWebEnv, WMS_ENV: "ci", SIGNUP_ENABLED: "true", BETTER_AUTH_URL: `https://localhost:${portB}` };
    delete envB.DEMO_MODE; // demo girişi yalnızca ana örnekte
    const webB = startWeb(innerB, envB, "web-signup.log");
    children.push(webB);
    await waitFor("kayıt açık web örneği hazır değil (bkz. .artifacts/e2e/web-signup.log)", 120_000, async () => {
      if (webB.exitCode !== null) throw new Error("e2e: kayıt açık web örneği çıktı (bkz. .artifacts/e2e/web-signup.log)");
      try {
        return (await fetch(`http://127.0.0.1:${innerB}/api/health/live`)).ok;
      } catch {
        return false;
      }
    });
    const proxyB = startTlsProxy(portB, innerB, key, cert);
    const closeProxyB = (): void => {
      proxyB.close();
      proxyB.closeAllConnections();
    };
    const email = `bos-${suffix}@example.test`; // demo olmayan alan adı (DEMO_EMAIL_DOMAIN=example.invalid)
    const password = randomBytes(18).toString("hex");
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    let setupError: unknown;
    try {
      browser = await chromium.launch(process.env.E2E_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.E2E_CHROMIUM_EXECUTABLE_PATH } : {});
      await mintSharedSession(browser, `https://localhost:${port}`);
      const made = await provisionEmptyTenant({
        browser,
        origin: `https://localhost:${portB}`,
        clientIp: "198.51.100.20",
        name: "E2E bos kiracı yöneticisi",
        email,
        password,
        workspaceName: `E2E bos ${suffix}`,
      });
      process.env.E2E_EMPTY_SLUG = made.slug;
      process.env.E2E_EMPTY_EMAIL = email;
      process.env.E2E_EMPTY_PASSWORD = password;
      process.env.E2E_EMPTY_TOTP_SECRET = made.totpSecret;
      // Stok/üretim testleri boş durum ölçümlerinin tenant'ını dolduramaz. Aynı gerçek kayıt/MFA yolu, ayrı hesap ve tenant.
      const pilotEmail = `pilot-${suffix}@example.test`;
      const pilotPassword = randomBytes(18).toString("hex");
      const pilot = await provisionEmptyTenant({
        browser,
        origin: `https://localhost:${portB}`,
        clientIp: "198.51.100.20",
        name: "E2E pilot yöneticisi",
        email: pilotEmail,
        password: pilotPassword,
        workspaceName: `E2E pilot ${suffix}`,
      });
      process.env.E2E_PILOT_SLUG = pilot.slug;
      process.env.E2E_PILOT_EMAIL = pilotEmail;
      process.env.E2E_PILOT_PASSWORD = pilotPassword;
      process.env.E2E_PILOT_TOTP_SECRET = pilot.totpSecret;
      // Stok akışında iki proje aynı kullanıcı hız kovasını tüketmez. Sınırlar değişmez;
      // ayrı gerçek hesap/tenant/MFA oluşturulur, mevcut boş/pilot fikstürleri korunur.
      for (const device of ["DESKTOP", "MOBILE"] as const) {
        const stockEmail = `stock-${device.toLowerCase()}-${suffix}@example.test`;
        const stockPassword = randomBytes(18).toString("hex");
        const stock = await provisionEmptyTenant({
          browser,
          origin: `https://localhost:${portB}`,
          clientIp: device === "DESKTOP" ? "198.51.100.21" : "198.51.100.22",
          name: `E2E stock ${device}`,
          email: stockEmail,
          password: stockPassword,
          workspaceName: `E2E stock ${device} ${suffix}`,
        });
        const prefix = `E2E_STOCK_${device}`;
        process.env[`${prefix}_SLUG`] = stock.slug;
        process.env[`${prefix}_EMAIL`] = stockEmail;
        process.env[`${prefix}_PASSWORD`] = stockPassword;
        process.env[`${prefix}_TOTP_SECRET`] = stock.totpSecret;
      }
      // Package workflows must not consume the legacy stock principal's user-level request budget.
      // Provisioning remains local-only and uses the same real signup/workspace/MFA screens.
      for (const actor of PACKAGE_ACTORS) {
        const device = actor.mobile ? "MOBILE" : "DESKTOP";
        const actorEmail = `package-${actor.workflow}-${device.toLowerCase()}-${suffix}@example.test`;
        const actorPassword = randomBytes(18).toString("hex");
        const made = await provisionEmptyTenant({
          browser,
          origin: `https://localhost:${portB}`,
          clientIp: actor.clientIp,
          name: `E2E package ${actor.workflow} ${device}`,
          email: actorEmail,
          password: actorPassword,
          workspaceName: `E2E package ${actor.workflow} ${device} ${suffix}`,
        });
        process.env[`${actor.prefix}_SLUG`] = made.slug;
        process.env[`${actor.prefix}_EMAIL`] = actorEmail;
        process.env[`${actor.prefix}_PASSWORD`] = actorPassword;
        process.env[`${actor.prefix}_TOTP_SECRET`] = made.totpSecret;
      }
      // T-407: panel operatörü olacak hesap (aynı gerçek kayıt/MFA yolu). Operatör listesine spec ekler (yerel DB fikstürü).
      const opEmail = `operator-${suffix}@example.test`;
      const opPassword = randomBytes(18).toString("hex");
      const opMade = await provisionEmptyTenant({
        browser,
        origin: `https://localhost:${portB}`,
        clientIp: "198.51.100.23",
        name: "E2E operatör",
        email: opEmail,
        password: opPassword,
        workspaceName: `E2E operator ${suffix}`,
      });
      process.env.E2E_OPERATOR_EMAIL = opEmail;
      process.env.E2E_OPERATOR_PASSWORD = opPassword;
      process.env.E2E_OPERATOR_TOTP_SECRET = opMade.totpSecret;
      // T-999: çok üyelikli kullanıcı (kendi alanı; ikinci ve pasif üyelikleri spec yerel DB'ye ekler).
      const multiEmail = `multi-${suffix}@example.test`;
      const multiPassword = randomBytes(18).toString("hex");
      const multiMade = await provisionEmptyTenant({
        browser,
        origin: `https://localhost:${portB}`,
        clientIp: "198.51.100.24",
        name: "E2E çok üyelik",
        email: multiEmail,
        password: multiPassword,
        workspaceName: `E2E multi ${suffix}`,
      });
      process.env.E2E_MULTI_SLUG = multiMade.slug;
      process.env.E2E_MULTI_EMAIL = multiEmail;
      process.env.E2E_MULTI_PASSWORD = multiPassword;
      process.env.E2E_MULTI_TOTP_SECRET = multiMade.totpSecret;
      // T-991: ERP entegrasyonu (sahte Paraşüt'e bağlanır; kendi alanı, başka spec'in boş alan varsayımını bozmaz).
      const erpEmail = `erp-${suffix}@example.test`;
      const erpPassword = randomBytes(18).toString("hex");
      const erpMade = await provisionEmptyTenant({
        browser,
        origin: `https://localhost:${portB}`,
        clientIp: "198.51.100.26",
        name: "E2E ERP",
        email: erpEmail,
        password: erpPassword,
        workspaceName: `E2E ERP ${suffix}`,
      });
      process.env.E2E_ERP_SLUG = erpMade.slug;
      process.env.E2E_ERP_EMAIL = erpEmail;
      process.env.E2E_ERP_PASSWORD = erpPassword;
      process.env.E2E_ERP_TOTP_SECRET = erpMade.totpSecret;
      // T-1006: kurulum turu (yeni kiracı, hiç adım tamam değil → tur ilk girişte başlar; kendi alanı ve e-postası: giriş sınırı paylaşılmaz).
      // T-1026: cihaz ve senaryo arasında rehber seçimi/tamamlanma paylaşılmaz. Kayıt açık örnek yine testlerden ÖNCE kapanır.
      for (const [index, guideCase] of ["SETUP_DESKTOP", "SETUP_MOBILE", "OP_DESKTOP", "OP_MOBILE", "RACE_DESKTOP", "RACE_MOBILE"].entries()) {
        const tourEmail = `tour-${guideCase.toLowerCase()}-${suffix}@example.test`;
        const tourPassword = randomBytes(18).toString("hex");
        const tourMade = await provisionEmptyTenant({
          browser,
          origin: `https://localhost:${portB}`,
          clientIp: `198.51.100.${226 + index}`,
          name: "E2E kurulum turu",
          email: tourEmail,
          password: tourPassword,
          workspaceName: `E2E tur ${guideCase.toLowerCase()} ${suffix}`,
        });
        const prefix = `E2E_TOUR_${guideCase}`;
        process.env[`${prefix}_SLUG`] = tourMade.slug;
        process.env[`${prefix}_EMAIL`] = tourEmail;
        process.env[`${prefix}_PASSWORD`] = tourPassword;
        process.env[`${prefix}_TOTP_SECRET`] = tourMade.totpSecret;
        if (index === 0) {
          process.env.E2E_TOUR_SLUG = tourMade.slug;
          process.env.E2E_TOUR_EMAIL = tourEmail;
          process.env.E2E_TOUR_PASSWORD = tourPassword;
          process.env.E2E_TOUR_TOTP_SECRET = tourMade.totpSecret;
        }
      }
    } catch (e) {
      setupError = e;
    }
    // Kayıt açık örnek her yolda kapanır ve testler başlamadan çıkışı beklenir. Temizlik hatası kurulum hatasını EZMEZ: hepsi birlikte
    // fırlatılır (T-279 SR MINOR; G-07).
    const cleanupErrors: unknown[] = [];
    const cleanupSteps: (() => Promise<void> | void)[] = [
      async () => browser?.close(),
      closeProxyB,
      () => stop(webB),
      async () => waitFor("kayıt açık web örneği kapanmadı", 15_000, () => webB.exitCode !== null || webB.signalCode !== null),
    ];
    for (const step of cleanupSteps) {
      try {
        await step();
      } catch (e) {
        cleanupErrors.push(e);
      }
    }
    if (setupError !== undefined) {
      if (cleanupErrors.length === 0) throw setupError;
      throw new AggregateError([setupError, ...cleanupErrors], "e2e: boş tenant fikstürü kurulamadı (ve temizlik hatası)", { cause: setupError });
    }
    if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, "e2e: kayıt açık web örneği temizliği başarısız");
  } catch (e) {
    await teardown();
    throw e;
  }
  return teardown;
}
