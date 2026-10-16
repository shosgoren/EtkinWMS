// T-404 (ADR-027 §4–6, 0041): panelde sürümlü paketler ve paket sınırlarının veritabanında uygulanması. Gerçek wms_app bağlantısı;
// migration rolü yalnız kurulum/doğrulama/temizlik. Kart kabul ölçütü:
// - paket listesi/kaydı yalnız operatör (DB listesi + MFA); uygulama rolü paket tablolarını okuyamaz;
// - fiyat/sınır/özellik değişikliği yeni sürüm, ad/yayın değişikliği sürüm açmaz; önerilen tek ve yayında;
// - sınır: dolu pakette depo/ürün ekleme PLAN_LIMIT, 0 = sınırsız, paketsiz tenant sınırsız, örnek veri sayılmaz;
//   düşürme sonrası mevcut veri korunur (yalnız yeni ekleme reddedilir); başka tenant'ın sınırı okunamaz.
// Fikstürler sentetik (G-09).
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "../../../packages/db/node_modules/drizzle-orm/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient, withTenant } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, createTenantContext, type DbClient } from "../../../packages/db/src/client.ts";
import { AppError } from "../../../packages/shared/src/errors.ts";
import { listPlans, listPublishedPlans, savePlan } from "../../../packages/domain/src/platform/plans.ts";
import { createWarehouse } from "../../../packages/domain/src/warehouse/index.ts";
import { createItem } from "../../../packages/domain/src/catalog/index.ts";
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
const planIds: string[] = [];

const op = () => ({ db: app, principal: { userId: operatorId, mfaVerified: true } });
const owner = (w: TenantWorld) => ({ db: app, principal: { userId: w.ownerUserId, mfaVerified: true }, tenantSlug: w.slug });
const tag = (): string => randomBytes(3).toString("hex");

function plan(over: Partial<{ name: string; price: string; warehouses: number; items: number; published: boolean; recommended: boolean }> = {}) {
  return {
    name: over.name ?? `T404 ${tag()}`,
    price: over.price ?? "1490",
    limits: { admins: 5, field: 5, warehouses: over.warehouses ?? 1, items: over.items ?? 100 },
    features: { qr: true, ship: false, prod: false, api: false },
    published: over.published ?? false,
    recommended: over.recommended ?? false,
  };
}

async function failure(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return e as AppError;
  }
  throw new Error("expected rejection");
}

async function subscribe(w: TenantWorld, planId: string | null): Promise<void> {
  const v = planId === null ? null : (await adm.query<{ v: number }>("SELECT current_version AS v FROM wms_platform.plans WHERE id = $1", [planId])).rows[0]?.v;
  await adm.query(
    `INSERT INTO wms_platform.subscriptions (tenant_id, plan, trial_ends_at, plan_id, plan_version)
     VALUES ($1, 'TRIAL', now() + interval '3 months', $2, $3)
     ON CONFLICT (tenant_id) DO UPDATE SET plan_id = EXCLUDED.plan_id, plan_version = EXCLUDED.plan_version`,
    [w.tenantId, planId, v ?? null],
  );
}

async function activeWarehouses(w: TenantWorld): Promise<number> {
  const r = await adm.query<{ n: number }>("SELECT count(*)::int AS n FROM public.warehouses WHERE tenant_id = $1 AND status = 'ACTIVE' AND NOT is_sample", [w.tenantId]);
  return (r.rows[0] as { n: number }).n;
}

beforeAll(async () => {
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  await adm.connect();
  A = await seedWorld(adm, reg, "A404");
  B = await seedWorld(adm, reg, "B404");
  operatorEmail = `t404-op-${randomBytes(6).toString("hex")}@example.test`;
  const u = await adm.query<{ id: string }>(
    "INSERT INTO public.users (name, email, email_verified, two_factor_enabled) VALUES ('T404 op', $1, true, true) RETURNING id",
    [operatorEmail],
  );
  operatorId = (u.rows[0] as { id: string }).id;
  await adm.query("INSERT INTO wms_platform.operators (email_normalized) VALUES ($1)", [operatorEmail]);
}, 120_000);

afterAll(async () => {
  // Paylaşılan DB: başka dosyaların aktivasyonu önerilen paketi almasın (abonelik bağlıysa satır silinemeyebilir; yayından kalkar).
  await adm.query("UPDATE wms_platform.plans SET recommended = false, published = false WHERE id = ANY($1::uuid[])", [planIds]).catch(() => undefined);
  await adm.query("DELETE FROM wms_platform.subscriptions WHERE tenant_id = ANY($1::uuid[])", [[A.tenantId, B.tenantId]]).catch(() => undefined);
  await adm.query("DELETE FROM wms_platform.plan_versions WHERE plan_id = ANY($1::uuid[])", [planIds]).catch(() => undefined);
  await adm.query("DELETE FROM wms_platform.plans WHERE id = ANY($1::uuid[])", [planIds]).catch(() => undefined);
  await adm.query("DELETE FROM wms_platform.operators WHERE email_normalized = $1", [operatorEmail]).catch(() => undefined);
  await adm.end();
  await app.close();
}, 60_000);

describe("paketler (operatör)", () => {
  it("yalnız operatör: üye NOT_FOUND, işlev 42501; uygulama rolü paket tablolarını okuyamaz", async () => {
    const e = await failure(listPlans({ db: app, principal: { userId: A.ownerUserId, mfaVerified: true } }));
    expect(e.code).toBe("NOT_FOUND");
    const s = await failure(savePlan({ db: app, principal: { userId: A.ownerUserId, mfaVerified: true }, recentAuth: ok, plan: plan() }));
    expect(s.code).toBe("NOT_FOUND");
    expect((await failure(listPlans({ db: app, principal: { userId: operatorId, mfaVerified: false } }))).detail).toBe("MFA_REQUIRED");
    const raw = await withTenant(createTenantContext(app, A.tenantId), (tx) => tx.execute(sql`SELECT * FROM wms_platform.plans`)).then(
      () => "ok",
      (err: unknown) => String((err as { cause?: { code?: unknown } }).cause?.code ?? (err as { code?: unknown }).code),
    );
    expect(raw).toBe("42501");
  });

  it("sürüm: fiyat/sınır değişince yeni sürüm, yalnız ad değişince aynı sürüm; güvenlik olayı yazılır", async () => {
    const first = await savePlan({ ...op(), recentAuth: ok, plan: plan({ name: `Başlangıç ${tag()}` }) });
    planIds.push(first.id);
    expect(first.version).toBe(1);
    const priced = await savePlan({ ...op(), recentAuth: ok, id: first.id, plan: plan({ name: "Başlangıç", price: "1590,50" }) });
    expect(priced).toEqual({ id: first.id, version: 2 });
    const renamed = await savePlan({ ...op(), recentAuth: ok, id: first.id, plan: plan({ name: "Başlangıç Plus", price: "1590.50" }) });
    expect(renamed.version).toBe(2);
    const listed = (await listPlans(op())).find((p) => p.id === first.id);
    expect(listed).toMatchObject({ name: "Başlangıç Plus", price: "1590.50", version: 2, published: false, customers: 0 });
    const versions = await adm.query<{ version: number; price: string }>(
      "SELECT version, price_monthly::text AS price FROM wms_platform.plan_versions WHERE plan_id = $1 ORDER BY version",
      [first.id],
    );
    expect(versions.rows).toEqual([{ version: 1, price: "1490.00" }, { version: 2, price: "1590.50" }]);
    const ev = await adm.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.security_events WHERE event_type = 'platform.plan.saved' AND detail->>'plan_id' = $1",
      [first.id],
    );
    expect(ev.rows[0]?.n).toBe(3);
  });

  it("önerilen tek ve yayında olmalı; yayındaki liste yalnız yayınlananları içerir; yakın zamanda doğrulama istenir", async () => {
    const bad = await failure(savePlan({ ...op(), recentAuth: ok, plan: plan({ recommended: true, published: false }) }));
    expect([bad.code, bad.detail]).toEqual(["VALIDATION_FAILED", "PLAN_INVALID"]);
    const reauth = async (): Promise<void> => {
      throw Object.assign(new Error("reauth"), { reason: "REAUTH_REQUIRED" });
    };
    expect((await failure(savePlan({ ...op(), recentAuth: reauth, plan: plan() }))).detail).toBe("RECENT_AUTH_REQUIRED");
    const a = await savePlan({ ...op(), recentAuth: ok, plan: plan({ name: `Pro ${tag()}`, published: true, recommended: true }) });
    const b = await savePlan({ ...op(), recentAuth: ok, plan: plan({ name: `Kurumsal ${tag()}`, published: true, recommended: true }) });
    const hidden = await savePlan({ ...op(), recentAuth: ok, plan: plan({ name: `Gizli ${tag()}` }) });
    planIds.push(a.id, b.id, hidden.id);
    const rec = await adm.query<{ id: string }>("SELECT id FROM wms_platform.plans WHERE recommended");
    expect(rec.rows.map((r) => r.id)).toEqual([b.id]);
    const pub = await listPublishedPlans(app);
    const names = pub.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining([expect.stringMatching(/^Pro /), expect.stringMatching(/^Kurumsal /)]));
    expect(names.some((n) => n.startsWith("Gizli "))).toBe(false);
    expect(Object.keys(pub[0] ?? {}).sort()).toEqual(["features", "limits", "name", "price", "recommended"]);
  });
});

describe("paket sınırları (veritabanı)", () => {
  it("dolu pakette depo/ürün ekleme PLAN_LIMIT; örnek veri sayılmaz; paket düşürülse de mevcut veri durur", async () => {
    const used = await activeWarehouses(A);
    const tight = await savePlan({ ...op(), recentAuth: ok, plan: plan({ warehouses: used, items: 1_000_000 }) });
    planIds.push(tight.id);
    await subscribe(A, tight.id);
    const e = await failure(createWarehouse(owner(A), { code: `W${tag()}`, name: "Fazla depo" }));
    expect([e.code, e.detail]).toEqual(["VALIDATION_FAILED", "PLAN_LIMIT"]);
    expect(await activeWarehouses(A)).toBe(used);
    // Örnek kayıt sınır dışıdır (T-996).
    await withTenant(createTenantContext(app, A.tenantId), (tx) =>
      tx.execute(sql`INSERT INTO public.warehouses (tenant_id, code, name, is_sample) VALUES (${A.tenantId}::uuid, ${`S${tag()}`}, 'Örnek depo', true)`),
    );
    // Sınır 0 = sınırsız.
    const free = await savePlan({ ...op(), recentAuth: ok, id: tight.id, plan: plan({ warehouses: 0, items: 0 }) });
    await subscribe(A, free.id);
    const w = await createWarehouse(owner(A), { code: `W${tag()}`, name: "Serbest depo" });
    expect(w.warehouseId).toMatch(/^[0-9a-f-]{36}$/);
    // Düşürme: sınır mevcut sayının altına iner; veri silinmez, yalnız yeni ekleme reddedilir.
    const down = await savePlan({ ...op(), recentAuth: ok, id: tight.id, plan: plan({ warehouses: 1, items: 1 }) });
    await subscribe(A, down.id);
    const before = await activeWarehouses(A);
    expect(before).toBeGreaterThan(1);
    expect((await failure(createWarehouse(owner(A), { code: `W${tag()}`, name: "x" }))).detail).toBe("PLAN_LIMIT");
    expect((await failure(createItem(owner(A), { code: `I${tag()}`, name: "x", baseUnitId: A.unitId }))).detail).toBe("PLAN_LIMIT");
    expect(await activeWarehouses(A)).toBe(before);
  });

  it("kullanıcı sınırı rol sınıfına göre: yönetici ve saha ayrı sayılır; arşivden geri alma da sınırlanır", async () => {
    const counts = await adm.query<{ a: number; f: number }>(
      "SELECT public.plan_member_count($1, 'admins', NULL)::int AS a, public.plan_member_count($1, 'field', NULL)::int AS f",
      [A.tenantId],
    );
    const { a, f } = counts.rows[0] as { a: number; f: number };
    const p = await savePlan({ ...op(), recentAuth: ok, plan: { ...plan({ warehouses: 0, items: 0 }), limits: { admins: a, field: f + 1, warehouses: 0, items: 0 } } });
    planIds.push(p.id);
    await subscribe(A, p.id);
    // Rolsüz etkin üyelik (migration rolüyle; sınır dışı) → rol uygulama rolüyle eklenir (sınır burada).
    const mk = async (): Promise<string> => {
      const u = await adm.query<{ id: string }>("INSERT INTO public.users (name, email, email_verified) VALUES ('T404 üye', $1, true) RETURNING id", [`t404-m-${tag()}@example.test`]);
      const m = await adm.query<{ id: string }>("INSERT INTO public.tenant_memberships (tenant_id, user_id, status) VALUES ($1, $2, 'ACTIVE') RETURNING id", [A.tenantId, (u.rows[0] as { id: string }).id]);
      return (m.rows[0] as { id: string }).id;
    };
    const role = (membershipId: string, key: string) =>
      withTenant(createTenantContext(app, A.tenantId), (tx) =>
        tx.execute(sql`INSERT INTO public.membership_roles (tenant_id, membership_id, role_key) VALUES (${A.tenantId}::uuid, ${membershipId}::uuid, ${key})`),
      ).then(
        () => "ok",
        (err: unknown) => String((err as { cause?: { message?: unknown } }).cause?.message ?? (err as { message?: unknown }).message),
      );
    const m1 = await mk();
    expect(await role(m1, "WAREHOUSE_MANAGER")).toBe("PLAN_LIMIT"); // yönetici sınıfı dolu
    expect(await role(m1, "PICKER")).toBe("ok"); // saha sınıfında bir yer var
    const m2 = await mk();
    expect(await role(m2, "COUNTER")).toBe("PLAN_LIMIT"); // saha sınıfı doldu
    expect(await role(m1, "READ_ONLY")).toBe("PLAN_LIMIT"); // sahadan yöneticiye geçiş yönetici sınırına takılır
    // Arşivli depo geri alınırken de sınır uygulanır.
    const tight = await savePlan({ ...op(), recentAuth: ok, plan: plan({ warehouses: 1, items: 0 }) });
    planIds.push(tight.id);
    await subscribe(A, tight.id);
    const arch = await adm.query<{ id: string }>(
      "INSERT INTO public.warehouses (tenant_id, code, name, status, archived_at) VALUES ($1, $2, 'Arşivli', 'ARCHIVED', now()) RETURNING id",
      [A.tenantId, `X${tag()}`],
    );
    const revive = await withTenant(createTenantContext(app, A.tenantId), (tx) =>
      tx.execute(sql`UPDATE public.warehouses SET status = 'ACTIVE', archived_at = NULL WHERE id = ${(arch.rows[0] as { id: string }).id}::uuid`),
    ).then(
      () => "ok",
      (err: unknown) => String((err as { cause?: { message?: unknown } }).cause?.message ?? (err as { message?: unknown }).message),
    );
    expect(revive).toBe("PLAN_LIMIT");
  });

  it("paketsiz tenant sınırsız; sınır yalnız bağlam tenant'ı için okunur", async () => {
    await adm.query("DELETE FROM wms_platform.subscriptions WHERE tenant_id = $1", [B.tenantId]);
    const w = await createWarehouse(owner(B), { code: `W${tag()}`, name: "Paketsiz" });
    expect(w.warehouseId).toMatch(/^[0-9a-f-]{36}$/);
    const lim = await withTenant(createTenantContext(app, B.tenantId), (tx) =>
      tx.execute<{ own: number | null; other: number | null }>(
        sql`SELECT wms_probe.platform_tenant_plan_limit(${B.tenantId}::uuid, 'warehouses') AS own,
                   wms_probe.platform_tenant_plan_limit(${A.tenantId}::uuid, 'warehouses') AS other`,
      ),
    );
    expect(lim[0]).toEqual({ own: null, other: null });
  });
});

describe("uyum", () => {
  it("paket uuid'i biçimsizse VALIDATION_FAILED; olmayan paket NOT_FOUND", async () => {
    expect((await failure(savePlan({ ...op(), recentAuth: ok, id: "x", plan: plan() }))).code).toBe("VALIDATION_FAILED");
    expect((await failure(savePlan({ ...op(), recentAuth: ok, id: randomUUID(), plan: plan() }))).code).toBe("NOT_FOUND");
    expect((await failure(savePlan({ ...op(), recentAuth: ok, plan: { ...plan(), price: "abc" } }))).detail).toBe("PLAN_INVALID");
  });
});
