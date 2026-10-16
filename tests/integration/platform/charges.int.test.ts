// T-406 (ADR-027 §8, 0043): elle izlenen aylık tahakkuk ve tahsilat. Gerçek wms_app bağlantısı; migration rolü yalnız kurulum/doğrulama/
// temizlik. Kart kabul ölçütü:
// - yalnız operatör (NOT_FOUND, MFA_REQUIRED); uygulama rolü tahakkuk tablosunu okuyamaz;
// - dönem tahakkuku idempotent; yalnız denemesi bitmiş/ACTIVE, paketli, askıda olmayan müşteri; tutar paket sürümünün fiyatı;
// - ödendi kaydı bir kez (ikincisi false), gelecek tarih ve geçersiz yöntem reddedilir; olay yazılır, not olaya yazılmaz;
// - vadesi geçmiş ödenmemiş tahakkuk müşteriyi GECİKMEDE yapar.
// Fikstürler sentetik (G-09).
import { randomBytes } from "node:crypto";
import pg from "pg";
import { sql } from "../../../packages/db/node_modules/drizzle-orm/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient, withTenant } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, createTenantContext, type DbClient } from "../../../packages/db/src/client.ts";
import { AppError } from "../../../packages/shared/src/errors.ts";
import { accrueCharges, listCharges, markChargePaid } from "../../../packages/domain/src/platform/charges.ts";
import { listCustomers } from "../../../packages/domain/src/platform/customers.ts";
import { savePlan } from "../../../packages/domain/src/platform/plans.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";

const env = readIntEnv(process.env);
const reg = newRegistry();
const ok = async (): Promise<void> => undefined;
let app: DbClient;
let adm: pg.Client;
let A: TenantWorld;
let B: TenantWorld;
let C: TenantWorld;
let operatorId: string;
let operatorEmail: string;
let planId: string;

const op = () => ({ db: app, principal: { userId: operatorId, mfaVerified: true } });
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

function isoToday(): string {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(new Date());
  const g = (k: string): string => p.find((x) => x.type === k)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

beforeAll(async () => {
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  await adm.connect();
  A = await seedWorld(adm, reg, "A406");
  B = await seedWorld(adm, reg, "B406");
  C = await seedWorld(adm, reg, "C406");
  operatorEmail = `t406-op-${randomBytes(6).toString("hex")}@example.test`;
  const u = await adm.query<{ id: string }>(
    "INSERT INTO public.users (name, email, email_verified, two_factor_enabled) VALUES ('T406 op', $1, true, true) RETURNING id",
    [operatorEmail],
  );
  operatorId = (u.rows[0] as { id: string }).id;
  await adm.query("INSERT INTO wms_platform.operators (email_normalized) VALUES ($1)", [operatorEmail]);
  const p = await savePlan({
    ...op(),
    recentAuth: ok,
    plan: { name: `T406 ${tag()}`, price: "1490,50", limits: { admins: 0, field: 0, warehouses: 0, items: 0 }, features: { qr: true, ship: false, prod: false, api: false }, published: false, recommended: false },
  });
  planId = p.id;
  // A: denemesi bitmiş (tahakkuk açılır); B: denemesi sürüyor (açılmaz); C: askıda (açılmaz).
  for (const [w, ends] of [[A, "now() - interval '1 day'"], [B, "now() + interval '30 days'"], [C, "now() - interval '1 day'"]] as const) {
    await adm.query(
      `INSERT INTO wms_platform.subscriptions (tenant_id, plan, trial_ends_at, started_at, plan_id, plan_version)
       VALUES ($1, 'TRIAL', ${ends}, now() - interval '100 days', $2, 1)`,
      [w.tenantId, planId],
    );
  }
  await adm.query("UPDATE public.tenants SET status = 'SUSPENDED' WHERE id = $1", [C.tenantId]);
}, 120_000);

afterAll(async () => {
  const ids = [A.tenantId, B.tenantId, C.tenantId];
  await adm.query("UPDATE public.tenants SET status = 'ACTIVE' WHERE id = ANY($1::uuid[])", [ids]).catch(() => undefined);
  await adm.query("DELETE FROM wms_platform.charges WHERE tenant_id = ANY($1::uuid[])", [ids]).catch(() => undefined);
  await adm.query("DELETE FROM wms_platform.subscriptions WHERE tenant_id = ANY($1::uuid[])", [ids]).catch(() => undefined);
  await adm.query("DELETE FROM wms_platform.plan_versions WHERE plan_id = $1", [planId]).catch(() => undefined);
  await adm.query("DELETE FROM wms_platform.plans WHERE id = $1", [planId]).catch(() => undefined);
  await adm.query("DELETE FROM wms_platform.operators WHERE email_normalized = $1", [operatorEmail]).catch(() => undefined);
  await adm.end();
  await app.close();
}, 60_000);

describe("ödemeler (operatör, elle tahsilat)", () => {
  it("yalnız operatör; uygulama rolü tahakkuk tablosunu okuyamaz", async () => {
    const member = { db: app, principal: { userId: A.ownerUserId, mfaVerified: true } };
    expect((await failure(listCharges(member))).code).toBe("NOT_FOUND");
    expect((await failure(accrueCharges({ ...member, recentAuth: ok }))).code).toBe("NOT_FOUND");
    expect((await failure(listCharges({ db: app, principal: { userId: operatorId, mfaVerified: false } }))).detail).toBe("MFA_REQUIRED");
    const raw = await withTenant(createTenantContext(app, A.tenantId), (tx) => tx.execute(sql`SELECT * FROM wms_platform.charges`)).then(
      () => "ok",
      (err: unknown) => String((err as { cause?: { code?: unknown } }).cause?.code ?? (err as { code?: unknown }).code),
    );
    expect(raw).toBe("42501");
  });

  it("dönem tahakkuku: idempotent; yalnız denemesi bitmiş ve askıda olmayan; tutar paket fiyatı; abonelik numarası", async () => {
    await accrueCharges({ ...op(), recentAuth: ok });
    expect(await accrueCharges({ ...op(), recentAuth: ok })).toBe(0);
    const rows = (await listCharges(op())).filter((r) => [A.tenantId, B.tenantId, C.tenantId].includes(r.tenantId));
    expect(rows.map((r) => r.tenantId)).toEqual([A.tenantId]);
    const a = rows[0];
    expect(a?.amount).toBe("1490.50");
    expect(a?.ref).toMatch(/^ABN-\d{4,}$/);
    expect(a?.period).toBe(`${isoToday().slice(0, 7)}-01`);
    expect(a?.status).toBe("PENDING");
    expect((a?.dueOn ?? "") >= isoToday()).toBe(true);
  });

  it("vadesi geçen tahakkuk GECİKMEDE; ödendi kaydı bir kez, geçersiz girdiler reddedilir; olay yazılır, not olaya yazılmaz", async () => {
    const a = (await listCharges(op())).find((r) => r.tenantId === A.tenantId);
    expect(a).toBeDefined();
    const id = (a as { id: string }).id;
    await adm.query("UPDATE wms_platform.charges SET due_on = period WHERE id = $1 AND period < (now() AT TIME ZONE 'Europe/Istanbul')::date", [id]);
    const due = await adm.query<{ d: string }>("SELECT due_on::text AS d FROM wms_platform.charges WHERE id = $1", [id]);
    if ((due.rows[0] as { d: string }).d < isoToday()) {
      expect((await listCharges(op())).find((r) => r.id === id)?.status).toBe("OVERDUE");
      expect((await listCustomers(op())).find((r) => r.id === A.tenantId)?.state).toBe("OVERDUE");
    }
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    expect((await failure(markChargePaid({ ...op(), recentAuth: ok, chargeId: id, paidOn: future, method: "HAVALE" }))).detail).toBe("PAYMENT_INVALID");
    expect((await failure(markChargePaid({ ...op(), recentAuth: ok, chargeId: id, paidOn: isoToday(), method: "CEK" }))).detail).toBe("PAYMENT_INVALID");
    expect(await markChargePaid({ ...op(), recentAuth: ok, chargeId: id, paidOn: isoToday(), method: "HAVALE", note: "dekont 42" })).toBe(true);
    expect(await markChargePaid({ ...op(), recentAuth: ok, chargeId: id, paidOn: isoToday(), method: "NAKIT" })).toBe(false);
    const after = (await listCharges(op())).find((r) => r.id === id);
    expect([after?.status, after?.method, after?.paidOn]).toEqual(["PAID", "HAVALE", isoToday()]);
    expect((await listCustomers(op())).find((r) => r.id === A.tenantId)?.state).toBe("TRIAL");
    const ev = await adm.query<{ detail: Record<string, unknown> }>(
      "SELECT detail FROM public.security_events WHERE event_type = 'platform.charge.paid' AND detail ->> 'charge_id' = $1",
      [id],
    );
    expect(ev.rows.length).toBe(1);
    expect(JSON.stringify(ev.rows[0]?.detail)).not.toContain("dekont");
  });
});
