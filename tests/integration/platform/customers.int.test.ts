// T-403 (ADR-027 §2–3, 0042): panelde müşteriler — yalnız sayılar ve işletim durumu; askıya al / devam ettir / deneme uzat / paket
// değiştir. Gerçek wms_app bağlantısı; migration rolü yalnız kurulum/doğrulama/temizlik. Kart kabul ölçütü:
// - operatör dışı NOT_FOUND (işlev 42501), MFA'sız oturum MFA_REQUIRED;
// - satırda içerik sütunu yok (yalnız kimlik, ad, adres adı, durum, paket, sayılar, son giriş);
// - askıya alınan tenant'ta komutlar TENANT_SUSPENDED; devam ettirince açılır; gerekçesiz askıya alma reddedilir;
// - deneme yalnız TRIAL'da 30 gün uzar; paket değişikliği aboneliği olmayan tenant'a ACTIVE abonelik açar ve sınır hemen geçerli olur;
// - güvenlik olayları ve geçmiş; demo tenant listede yok.
// Fikstürler sentetik (G-09).
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { AppError } from "../../../packages/shared/src/errors.ts";
import {
  changeCustomerPlan,
  extendCustomerTrial,
  getCustomerActivity,
  listCustomers,
  setCustomerSuspended,
} from "../../../packages/domain/src/platform/customers.ts";
import { savePlan } from "../../../packages/domain/src/platform/plans.ts";
import { createWarehouse } from "../../../packages/domain/src/warehouse/index.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";

const env = readIntEnv(process.env);
const reg = newRegistry();
const ok = async (): Promise<void> => undefined;
let app: DbClient;
let adm: pg.Client;
let A: TenantWorld;
let B: TenantWorld;
let operatorId: string;
let operatorEmail: string;
let demoTenant: string | null = null;
const planIds: string[] = [];

const op = () => ({ db: app, principal: { userId: operatorId, mfaVerified: true } });
const owner = (w: TenantWorld) => ({ db: app, principal: { userId: w.ownerUserId, mfaVerified: true }, tenantSlug: w.slug });
const tag = (): string => randomBytes(3).toString("hex");

async function failure(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return e as AppError;
  }
  throw new Error("expected rejection");
}

async function events(type: string, tenant: string): Promise<Record<string, unknown>[]> {
  const r = await adm.query<{ detail: Record<string, unknown> }>(
    "SELECT detail FROM public.security_events WHERE event_type = $1 AND detail ->> 'tenant_id' = $2 ORDER BY occurred_at, id",
    [type, tenant],
  );
  return r.rows.map((x) => x.detail);
}

beforeAll(async () => {
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  await adm.connect();
  A = await seedWorld(adm, reg, "A403");
  B = await seedWorld(adm, reg, "B403");
  operatorEmail = `t403-op-${randomBytes(6).toString("hex")}@example.test`;
  const u = await adm.query<{ id: string }>(
    "INSERT INTO public.users (name, email, email_verified, two_factor_enabled) VALUES ('T403 op', $1, true, true) RETURNING id",
    [operatorEmail],
  );
  operatorId = (u.rows[0] as { id: string }).id;
  await adm.query("INSERT INTO wms_platform.operators (email_normalized) VALUES ($1)", [operatorEmail]);
  await adm.query("INSERT INTO wms_platform.subscriptions (tenant_id, plan, trial_ends_at) VALUES ($1, 'TRIAL', now() + interval '3 months')", [A.tenantId]);
  const d = await adm.query<{ id: string }>(`INSERT INTO public.tenants (slug, name, is_demo) VALUES ($1, 'T403 demo', true) RETURNING id`, [`t403-demo-${tag()}`]);
  demoTenant = (d.rows[0] as { id: string }).id;
}, 120_000);

afterAll(async () => {
  await adm.query("UPDATE public.tenants SET status = 'ACTIVE' WHERE id = ANY($1::uuid[])", [[A.tenantId, B.tenantId]]).catch(() => undefined);
  await adm.query("DELETE FROM wms_platform.subscriptions WHERE tenant_id = ANY($1::uuid[])", [[A.tenantId, B.tenantId]]).catch(() => undefined);
  await adm.query("UPDATE wms_platform.plans SET recommended = false, published = false WHERE id = ANY($1::uuid[])", [planIds]).catch(() => undefined);
  await adm.query("DELETE FROM wms_platform.plan_versions WHERE plan_id = ANY($1::uuid[])", [planIds]).catch(() => undefined);
  await adm.query("DELETE FROM wms_platform.plans WHERE id = ANY($1::uuid[])", [planIds]).catch(() => undefined);
  if (demoTenant !== null) await adm.query("DELETE FROM public.tenants WHERE id = $1", [demoTenant]).catch(() => undefined);
  await adm.query("DELETE FROM wms_platform.operators WHERE email_normalized = $1", [operatorEmail]).catch(() => undefined);
  await adm.end();
  await app.close();
}, 60_000);

describe("müşteriler (operatör, yalnız sayılar)", () => {
  it("yalnız operatör: üye NOT_FOUND (veritabanı işlevi 42501), MFA'sız MFA_REQUIRED; yazma işlemleri de NOT_FOUND", async () => {
    const member = { db: app, principal: { userId: A.ownerUserId, mfaVerified: true } };
    expect((await failure(listCustomers(member))).code).toBe("NOT_FOUND");
    expect((await failure(getCustomerActivity({ ...member, tenantId: B.tenantId }))).code).toBe("NOT_FOUND");
    expect((await failure(setCustomerSuspended({ ...member, recentAuth: ok, tenantId: B.tenantId, suspend: true, reason: "x" }))).code).toBe("NOT_FOUND");
    expect((await failure(extendCustomerTrial({ ...member, recentAuth: ok, tenantId: A.tenantId }))).code).toBe("NOT_FOUND");
    expect((await failure(listCustomers({ db: app, principal: { userId: operatorId, mfaVerified: false } }))).detail).toBe("MFA_REQUIRED");
  });

  it("liste: yalnız sayılar ve durum; demo tenant yok; deneme ve paketsiz durumlar", async () => {
    const rows = await listCustomers(op());
    const a = rows.find((r) => r.id === A.tenantId);
    const b = rows.find((r) => r.id === B.tenantId);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(rows.some((r) => r.id === demoTenant)).toBe(false);
    expect(Object.keys(a as object).sort()).toEqual(["counts", "createdAt", "id", "lastLogin", "name", "plan", "slug", "state", "trialEndsAt"]);
    expect(Object.keys((a as { counts: object }).counts).sort()).toEqual(["admins", "field", "items", "warehouses"]);
    expect(a?.state).toBe("TRIAL");
    expect(a?.trialEndsAt).toBeInstanceOf(Date);
    expect(b?.state).toBe("ACTIVE");
    expect(b?.plan).toBeNull();
    const wh = await adm.query<{ n: number }>("SELECT count(*)::int AS n FROM public.warehouses WHERE tenant_id = $1 AND status = 'ACTIVE' AND NOT is_sample", [A.tenantId]);
    expect(a?.counts.warehouses).toBe((wh.rows[0] as { n: number }).n);
    expect((a?.counts.admins ?? 0) + (a?.counts.field ?? 0)).toBeGreaterThanOrEqual(1);
  });

  it("askıya al: gerekçe zorunlu; askıdaki tenant'ta komut TENANT_SUSPENDED; devam ettirince açılır; olaylar yazılır", async () => {
    const e = await failure(setCustomerSuspended({ ...op(), recentAuth: ok, tenantId: B.tenantId, suspend: true, reason: "  " }));
    expect([e.code, e.detail]).toEqual(["VALIDATION_FAILED", "REASON_REQUIRED"]);
    expect(await setCustomerSuspended({ ...op(), recentAuth: ok, tenantId: B.tenantId, suspend: true, reason: "2 dönem ödeme yok" })).toBe(true);
    expect(await setCustomerSuspended({ ...op(), recentAuth: ok, tenantId: B.tenantId, suspend: true, reason: "tekrar" })).toBe(false);
    expect((await listCustomers(op())).find((r) => r.id === B.tenantId)?.state).toBe("SUSPENDED");
    expect((await failure(createWarehouse(owner(B), { code: `W${tag()}`, name: "Askıda" }))).code).toBe("TENANT_SUSPENDED");
    expect(await setCustomerSuspended({ ...op(), recentAuth: ok, tenantId: B.tenantId, suspend: false })).toBe(true);
    const w = await createWarehouse(owner(B), { code: `W${tag()}`, name: "Açıldı" });
    expect(w.warehouseId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await events("platform.tenant.suspended", B.tenantId)).toEqual([{ tenant_id: B.tenantId, reason: "2 dönem ödeme yok" }]);
    expect(await events("platform.tenant.resumed", B.tenantId)).toEqual([{ tenant_id: B.tenantId }]);
    // Demo tenant askıya alınamaz (yok sayılır).
    expect((await failure(setCustomerSuspended({ ...op(), recentAuth: ok, tenantId: demoTenant as string, suspend: true, reason: "x" }))).code).toBe("NOT_FOUND");
  });

  it("deneme uzatma: yalnız TRIAL; 30 gün ileri", async () => {
    const before = (await listCustomers(op())).find((r) => r.id === A.tenantId)?.trialEndsAt as Date;
    const after = await extendCustomerTrial({ ...op(), recentAuth: ok, tenantId: A.tenantId });
    expect(Math.round((after.getTime() - before.getTime()) / 86_400_000)).toBe(30);
    expect((await failure(extendCustomerTrial({ ...op(), recentAuth: ok, tenantId: B.tenantId }))).code).toBe("VERSION_CONFLICT");
    expect((await events("platform.trial.extended", A.tenantId)).length).toBe(1);
  });

  it("paket değiştir: aboneliksiz tenant'a ACTIVE abonelik; aynı paket false; sınır hemen geçerli; geçmişte görünür", async () => {
    const p = await savePlan({
      ...op(),
      recentAuth: ok,
      plan: { name: `T403 ${tag()}`, price: "990", limits: { admins: 0, field: 0, warehouses: 1, items: 0 }, features: { qr: true, ship: false, prod: false, api: false }, published: false, recommended: false },
    });
    planIds.push(p.id);
    expect(await changeCustomerPlan({ ...op(), recentAuth: ok, tenantId: B.tenantId, planId: p.id })).toBe(true);
    expect(await changeCustomerPlan({ ...op(), recentAuth: ok, tenantId: B.tenantId, planId: p.id })).toBe(false);
    const sub = await adm.query<{ plan: string; plan_id: string }>("SELECT plan, plan_id FROM wms_platform.subscriptions WHERE tenant_id = $1", [B.tenantId]);
    expect(sub.rows[0]).toEqual({ plan: "ACTIVE", plan_id: p.id });
    const row = (await listCustomers(op())).find((r) => r.id === B.tenantId);
    expect([row?.state, row?.plan?.id, row?.plan?.limits.warehouses]).toEqual(["ACTIVE", p.id, 1]);
    expect((await failure(createWarehouse(owner(B), { code: `W${tag()}`, name: "Fazla" }))).detail).toBe("PLAN_LIMIT");
    const act = await getCustomerActivity({ ...op(), tenantId: B.tenantId });
    expect(act.movesThisMonth).toBeGreaterThanOrEqual(0);
    expect(act.history.map((h) => h.kind)).toEqual(expect.arrayContaining(["PLAN_CHANGED", "SUSPENDED", "RESUMED"]));
    expect(act.history.find((h) => h.kind === "SUSPENDED")?.reason).toBe("2 dönem ödeme yok");
    expect((await failure(changeCustomerPlan({ ...op(), recentAuth: ok, tenantId: B.tenantId, planId: "00000000-0000-4000-8000-000000000000" }))).code).toBe("NOT_FOUND");
  });
});
