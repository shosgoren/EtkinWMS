// T-241: getWarehouse + countLocationsByWarehouse (Q-57). Gerçek wms_app bağlantısı + RLS; fikstürler sentetik (G-09).
import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { AppError } from "../../../packages/shared/src/errors.ts";
import {
  archiveLocation,
  countLocationsByWarehouse,
  createLocation,
  createWarehouse,
  getLocationTree,
  getWarehouse,
  listWarehouses,
  setMembershipWarehouseScopes,
} from "../../../packages/domain/src/warehouse/index.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";

const env = readIntEnv(process.env);
const reg = newRegistry();
let app: DbClient;
let adm: pg.Client;
let A: TenantWorld;
let B: TenantWorld;

const admin = (w: TenantWorld) => ({ db: app, principal: { userId: w.ownerUserId, mfaVerified: true }, tenantSlug: w.slug });
const picker = (w: TenantWorld) => ({ db: app, principal: { userId: w.memberUserId, mfaVerified: true }, tenantSlug: w.slug });
const uniq = (p: string): string => `${p}${randomUUID().slice(0, 8)}`;

async function failure(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return e as AppError;
  }
  throw new Error("expected rejection");
}

async function newWarehouse(w: TenantWorld = A): Promise<string> {
  return (await createWarehouse(admin(w), { code: uniq("rd-"), name: "Okuyucu" })).warehouseId;
}

beforeAll(async () => {
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  await adm.connect();
  A = await seedWorld(adm, reg, "A241");
  B = await seedWorld(adm, reg, "B241");
}, 120_000);

afterEach(async () => {
  delete process.env.WAREHOUSE_SCOPE_ENABLED;
  await adm.query("DELETE FROM public.membership_warehouse_scopes WHERE tenant_id = ANY($1::uuid[])", [[A.tenantId, B.tenantId]]);
});

afterAll(async () => {
  await adm.end();
  await app.close();
}, 60_000);

describe("listWarehouses q (T-978)", () => {
  it("kod ya da ad içinde arar (büyük/küçük harf duyarsız, jokerler kaçışlı); arşivli yalnız istenirse; kapsam ve tenant korunur; sayfalama aramayla çalışır", async () => {
    const tag = randomUUID().slice(0, 6);
    const one = (await createWarehouse(admin(A), { code: `SR-${tag}-1`, name: `Arama Ana ${tag}` })).warehouseId;
    const two = (await createWarehouse(admin(A), { code: `SR-${tag}-2`, name: `Yedek ${tag}` })).warehouseId;
    await createWarehouse(admin(B), { code: `SR-${tag}-1`, name: `Arama Ana ${tag}` });
    const ids = async (input: Parameters<typeof listWarehouses>[1], who = admin(A)) => (await listWarehouses(who, input)).items.map((w) => w.id);
    expect(await ids({ q: `sr-${tag}` })).toEqual([one, two]);
    expect(await ids({ q: `arama ana ${tag}` })).toEqual([one]);
    expect(await ids({ q: `SR_${tag}` })).toEqual([]);
    expect(await ids({ q: "%" })).toEqual([]);
    expect(await ids({ q: "zz-yok-zz" })).toEqual([]);
    // Sayfalama: limit 1 + afterCode aramayla birlikte.
    const p1 = await listWarehouses(admin(A), { q: `SR-${tag}`, limit: 1 });
    expect(p1.items.map((w) => w.id)).toEqual([one]);
    expect(p1.nextAfterCode).not.toBeNull();
    const p2 = await listWarehouses(admin(A), { q: `SR-${tag}`, limit: 1, afterCode: p1.nextAfterCode as string });
    expect(p2.items.map((w) => w.id)).toEqual([two]);
    expect(p2.nextAfterCode).toBeNull();
    // Kapsam açıkken kapsam dışı depo aramada da görünmez.
    process.env.WAREHOUSE_SCOPE_ENABLED = "true";
    await setMembershipWarehouseScopes({ ...admin(A), recentAuth: async () => undefined }, { membershipId: A.memberMembershipId, warehouseIds: [one] });
    expect(await ids({ q: `SR-${tag}` }, picker(A))).toEqual([one]);
    expect((await failure(listWarehouses(admin(A), { q: 5 as unknown as string }))).code).toBe("VALIDATION_FAILED");
  });
});

describe("getWarehouse", () => {
  it("returns the same row listWarehouses returns, archived included", async () => {
    const id = await newWarehouse();
    const listed = (await listWarehouses(picker(A), { includeArchived: true })).items.find((w) => w.id === id);
    expect(listed).toBeDefined();
    expect(await getWarehouse(picker(A), { warehouseId: id })).toEqual(listed);
    await adm.query("UPDATE public.warehouses SET status = 'ARCHIVED', archived_at = now() WHERE id = $1", [id]);
    const archived = (await listWarehouses(picker(A), { includeArchived: true })).items.find((w) => w.id === id);
    expect(archived?.status).toBe("ARCHIVED");
    expect(await getWarehouse(picker(A), { warehouseId: id })).toEqual(archived);
  });

  it("flag off: scope rows are ignored (same as listWarehouses)", async () => {
    const other = await newWarehouse();
    await setMembershipWarehouseScopes({ ...admin(A), recentAuth: async () => undefined }, { membershipId: A.memberMembershipId, warehouseIds: [A.warehouseId] });
    expect((await getWarehouse(picker(A), { warehouseId: other })).id).toBe(other);
    expect((await listWarehouses(picker(A))).items.some((w) => w.id === other)).toBe(true);
  });

  it("flag on: scoped member sees only scoped warehouse; out-of-scope, other-tenant and missing give the identical NOT_FOUND", async () => {
    process.env.WAREHOUSE_SCOPE_ENABLED = "true";
    const other = await newWarehouse();
    await setMembershipWarehouseScopes({ ...admin(A), recentAuth: async () => undefined }, { membershipId: A.memberMembershipId, warehouseIds: [A.warehouseId] });
    expect((await getWarehouse(picker(A), { warehouseId: A.warehouseId })).id).toBe(A.warehouseId);
    const outOfScope = await failure(getWarehouse(picker(A), { warehouseId: other }));
    const foreign = await failure(getWarehouse(picker(A), { warehouseId: B.warehouseId }));
    const missing = await failure(getWarehouse(picker(A), { warehouseId: randomUUID() }));
    for (const e of [outOfScope, foreign, missing]) {
      expect(e.code).toBe("NOT_FOUND");
      expect(e.detail).toBe(missing.detail);
      expect(e.message).toBe(missing.message);
    }
    // listWarehouses ile görünürlük eşdeğerliği
    expect((await listWarehouses(picker(A), { includeArchived: true })).items.map((w) => w.id)).toEqual([A.warehouseId]);
    // TENANT_ADMIN kapsamdan etkilenmez
    expect((await getWarehouse(admin(A), { warehouseId: other })).id).toBe(other);
  });

  it("unscoped member (no scope rows) sees every warehouse with the flag on", async () => {
    process.env.WAREHOUSE_SCOPE_ENABLED = "true";
    const other = await newWarehouse();
    expect((await getWarehouse(picker(A), { warehouseId: other })).id).toBe(other);
  });

  it("other tenant's warehouse is NOT_FOUND even for an admin, and invalid ids are VALIDATION_FAILED", async () => {
    expect((await failure(getWarehouse(admin(A), { warehouseId: B.warehouseId }))).code).toBe("NOT_FOUND");
    expect((await failure(getWarehouse(admin(A), { warehouseId: "nope" }))).code).toBe("VALIDATION_FAILED");
  });
});

describe("countLocationsByWarehouse", () => {
  async function seedLocations(wid: string, active: number, archived: number): Promise<void> {
    const ids: string[] = [];
    for (let i = 0; i < active + archived; i++) ids.push((await createLocation(admin(A), { warehouseId: wid, code: uniq("L"), name: "Lok", kind: "STORAGE" })).locationId);
    for (const id of ids.slice(active)) await archiveLocation(admin(A), { locationId: id });
  }

  it("counts equal getLocationTree (active by default, archived opt-in); empty warehouse is 0", async () => {
    const w1 = await newWarehouse();
    const w2 = await newWarehouse();
    const w3 = await newWarehouse();
    await seedLocations(w1, 3, 2);
    await seedLocations(w2, 1, 0);
    const counts = await countLocationsByWarehouse(picker(A), { warehouseIds: [w1, w2, w3] });
    expect(counts.size).toBe(3);
    for (const w of [w1, w2, w3]) {
      expect(counts.get(w)).toBe((await getLocationTree(picker(A), { warehouseId: w })).items.length);
    }
    expect([counts.get(w1), counts.get(w2), counts.get(w3)]).toEqual([3, 1, 0]);
    const all = await countLocationsByWarehouse(picker(A), { warehouseIds: [w1], includeArchived: true });
    expect(all.get(w1)).toBe((await getLocationTree(picker(A), { warehouseId: w1, includeArchived: true })).items.length);
    expect(all.get(w1)).toBe(5);
  });

  it("duplicate ids collapse; other tenant and missing ids are absent", async () => {
    const w1 = await newWarehouse();
    await seedLocations(w1, 2, 0);
    const counts = await countLocationsByWarehouse(picker(A), { warehouseIds: [w1, w1.toUpperCase(), B.warehouseId, randomUUID()] });
    expect([...counts.entries()]).toEqual([[w1, 2]]);
  });

  it("out-of-scope warehouses are absent from the result (flag on), visible ones kept", async () => {
    process.env.WAREHOUSE_SCOPE_ENABLED = "true";
    const other = await newWarehouse();
    await seedLocations(other, 2, 0);
    await setMembershipWarehouseScopes({ ...admin(A), recentAuth: async () => undefined }, { membershipId: A.memberMembershipId, warehouseIds: [A.warehouseId] });
    const counts = await countLocationsByWarehouse(picker(A), { warehouseIds: [A.warehouseId, other] });
    expect([...counts.keys()]).toEqual([A.warehouseId]);
    expect(counts.has(other)).toBe(false);
    expect((await countLocationsByWarehouse(picker(A), { warehouseIds: [other] })).size).toBe(0);
    // admin tümünü görür
    expect((await countLocationsByWarehouse(admin(A), { warehouseIds: [other] })).get(other)).toBe(2);
  });

  it("accepts exactly 100 ids and rejects 101, empty and malformed input", async () => {
    const hundred = Array.from({ length: 100 }, () => randomUUID());
    expect((await countLocationsByWarehouse(picker(A), { warehouseIds: hundred })).size).toBe(0);
    expect((await failure(countLocationsByWarehouse(picker(A), { warehouseIds: [...hundred, randomUUID()] }))).code).toBe("VALIDATION_FAILED");
    expect((await failure(countLocationsByWarehouse(picker(A), { warehouseIds: [] }))).code).toBe("VALIDATION_FAILED");
    expect((await failure(countLocationsByWarehouse(picker(A), { warehouseIds: ["x"] }))).code).toBe("VALIDATION_FAILED");
  });
});
