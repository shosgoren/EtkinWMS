// T-408 (ADR-027 §9; 0047): panel işlem kaydı. Gerçek wms_app bağlantısı; migration rolü yalnız kurulum/temizlik. Kabul:
// - yalnız operatör (DB listesi + MFA); üye NOT_FOUND;
// - kaynak platform.* güvenlik olayları, en yeni önce; operatör/sistem ayrımı; firma ve paket adı çözülür;
// - ayrıntı yalnız izinli anahtarlar: kullanıcı kimliği, IP, istek kimliği, iç kimlikler (tenant/talep/tahakkuk) dönmez; sınır 1–200.
// Fikstürler sentetik (G-09).
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { AppError } from "../../../packages/shared/src/errors.ts";
import { listPanelEvents } from "../../../packages/domain/src/platform/events.ts";
import { savePlan } from "../../../packages/domain/src/platform/plans.ts";
import { setCustomerSuspended } from "../../../packages/domain/src/platform/customers.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";

const env = readIntEnv(process.env);
const reg = newRegistry();
const ok = async (): Promise<void> => undefined;
let app: DbClient;
let adm: pg.Client;
let A: TenantWorld;
let aName: string;
let operatorId: string;
let operatorEmail: string;
let planId: string;
const planName = `T408 ${randomBytes(3).toString("hex")}`;
const reason = `T408 gerekçe ${randomBytes(3).toString("hex")}`;

const op = () => ({ db: app, principal: { userId: operatorId, mfaVerified: true }, recentAuth: ok });

beforeAll(async () => {
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  await adm.connect();
  A = await seedWorld(adm, reg, "A408");
  aName = ((await adm.query<{ name: string }>("SELECT name FROM public.tenants WHERE id = $1", [A.tenantId])).rows[0] as { name: string }).name;
  operatorEmail = `t408-op-${randomBytes(6).toString("hex")}@example.test`;
  const u = await adm.query<{ id: string }>(
    "INSERT INTO public.users (name, email, email_verified, two_factor_enabled) VALUES ('T408 op', $1, true, true) RETURNING id",
    [operatorEmail],
  );
  operatorId = (u.rows[0] as { id: string }).id;
  await adm.query("INSERT INTO wms_platform.operators (email_normalized) VALUES ($1)", [operatorEmail]);
  planId = (
    await savePlan({
      ...op(),
      plan: { name: planName, price: "990", limits: { admins: 1, field: 1, warehouses: 1, items: 10 }, features: { qr: true, ship: false, prod: false, api: false }, published: false, recommended: false },
    })
  ).id;
  await setCustomerSuspended({ ...op(), tenantId: A.tenantId, suspend: true, reason });
  await setCustomerSuspended({ ...op(), tenantId: A.tenantId, suspend: false });
}, 120_000);

afterAll(async () => {
  await adm.query("DELETE FROM wms_platform.plan_versions WHERE plan_id = $1", [planId]).catch(() => undefined);
  await adm.query("DELETE FROM wms_platform.plans WHERE id = $1", [planId]).catch(() => undefined);
  await adm.query("DELETE FROM wms_platform.operators WHERE email_normalized = $1", [operatorEmail]).catch(() => undefined);
  await adm.end();
  await app.close();
}, 60_000);

describe("panel işlem kaydı", () => {
  it("yalnız operatör: üye NOT_FOUND, MFA'sız MFA_REQUIRED", async () => {
    const e = await listPanelEvents({ db: app, principal: { userId: A.ownerUserId, mfaVerified: true } }).then(
      () => null,
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe("NOT_FOUND");
    const m = await listPanelEvents({ db: app, principal: { userId: operatorId, mfaVerified: false } }).then(
      () => null,
      (x: unknown) => x,
    );
    expect((m as AppError).detail).toBe("MFA_REQUIRED");
  });

  it("platform olayları en yeni önce; firma/paket adı çözülür; gerekçe görünür; iç kimlik, IP ve kullanıcı kimliği dönmez", async () => {
    const rows = await listPanelEvents({ db: app, principal: { userId: operatorId, mfaVerified: true }, limit: 200 });
    for (let i = 1; i < rows.length; i++) expect((rows[i - 1] as { at: Date }).at.getTime()).toBeGreaterThanOrEqual((rows[i] as { at: Date }).at.getTime());
    expect(rows.every((r) => r.kind.startsWith("platform."))).toBe(true);
    const mine = rows.filter((r) => r.company === aName || r.plan === planName);
    const kinds = mine.map((r) => r.kind);
    expect(kinds).toEqual(expect.arrayContaining(["platform.plan.saved", "platform.tenant.suspended", "platform.tenant.resumed"]));
    // En yeni önce: devam ettirme askıya almadan önce listelenir.
    expect(kinds.indexOf("platform.tenant.resumed")).toBeLessThan(kinds.indexOf("platform.tenant.suspended"));
    const saved = mine.find((r) => r.kind === "platform.plan.saved");
    expect(saved).toMatchObject({ byOperator: true, plan: planName, info: { version: 1, published: false } });
    const susp = mine.find((r) => r.kind === "platform.tenant.suspended");
    expect(susp).toMatchObject({ company: aName, info: { reason } });
    const text = JSON.stringify(rows);
    for (const secret of [operatorId, A.tenantId, planId, operatorEmail]) expect(text).not.toContain(secret);
    for (const key of ["user_id", "ip", "user_agent", "request_id", "tenant_id", "plan_id", "charge_id", "demo_request_id"]) expect(text).not.toContain(`"${key}"`);
  });

  it("sınır 1–200 arasında tutulur", async () => {
    const one = await listPanelEvents({ db: app, principal: { userId: operatorId, mfaVerified: true }, limit: 1 });
    expect(one.length).toBe(1);
    const many = await listPanelEvents({ db: app, principal: { userId: operatorId, mfaVerified: true }, limit: 10_000 });
    expect(many.length).toBeLessThanOrEqual(200);
  });
});
