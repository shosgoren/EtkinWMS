// T-996 (ADR-026 §4, 0040): deneme alanında örnek veri yükleme ve "Örnek verileri temizle". Gerçek wms_app / wms_auth / wms_worker
// bağlantıları; migration rolü yalnız kurulum/doğrulama. Kart kabul ölçütü:
// - aktivasyonda "Örnek verilerle": ayrı "Örnek depo" + bölge/raf/göz + ürünler `is_sample`, stok hareketi yok; "Boş başla": hiçbiri;
// - hareketsiz örnek: tek transaction'da hepsi silinir (dönüşüm ve sayım kilitleri dahil), tek `sample_data.cleared` (DELETED);
// - hareketli örnek: silinmez, pasife alınır (ARCHIVED); defter satır sayısı DEĞİŞMEZ (I-08); stok dururken pasife alınamaz (IN_USE);
// - DB sınırı: wms_app örnek olmayan satırı silemez (satır yerinde kalır), gerçek satır sonradan örnek işaretlenemez (42501).
// Fikstürler sentetik (G-09); parola çalışma anında üretilir.
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "../../../packages/db/node_modules/drizzle-orm/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient, withTenant } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, createTenantContext, type DbClient } from "../../../packages/db/src/client.ts";
import { createAuth, readAuthEnv, type AuthService } from "../../../packages/auth/src/index.ts";
import { createJobQueue, installQueueSchema, type PgBossJobQueue } from "../../../packages/queue-adapter/src/index.ts";
import { AppError } from "../../../packages/shared/src/errors.ts";
import { loadMailConfig } from "../../../packages/shared/src/mailer.ts";
import { decideDemoRequest, ingestDemoLeads } from "../../../packages/domain/src/platform/demo-requests.ts";
import { activateTrial } from "../../../packages/domain/src/platform/activation.ts";
import {
  SAMPLE_ITEMS,
  SAMPLE_LOCATIONS,
  SAMPLE_WAREHOUSE,
  clearSampleData,
  getSampleDataStatus,
} from "../../../packages/domain/src/onboarding/sample-data.ts";
import { approveDocument, createStockDocument, postDocument } from "../../../packages/domain/src/stock/index.ts";
import { readAuthDatabaseUrl, readIntEnv, readWorkerDatabaseUrl, redactErrorChain } from "../harness/env.ts";

const env = readIntEnv(process.env);
const authUrl = readAuthDatabaseUrl(process.env);
const urls = [env.databaseUrl, env.databaseUrlDirect, authUrl];
const PASSWORD = `P${randomBytes(12).toString("hex")}`;
const ok = async (): Promise<void> => undefined;
const mailOff = loadMailConfig({});

let app: DbClient;
let worker: DbClient;
let authClient: DbClient;
let auth: AuthService;
let adm: pg.Client;
let queue: PgBossJobQueue;
let operatorId: string;
let operatorEmail: string;
const leadIds: string[] = [];

interface Trial {
  readonly tenantId: string;
  readonly slug: string;
  readonly ownerId: string;
}

async function trial(sample: boolean): Promise<Trial> {
  const id = randomUUID();
  leadIds.push(id);
  const email = `t996-${randomBytes(5).toString("hex")}@example.test`;
  await ingestDemoLeads({ db: worker, jsonl: `${JSON.stringify({ id, createdAt: new Date().toISOString(), name: "Örnek Kişi", company: "Örnek AŞ", email })}\n` });
  const d = await decideDemoRequest(
    { db: app, principal: { userId: operatorId, mfaVerified: true }, id, decision: "APPROVED", recentAuth: ok },
    { mailConfig: mailOff, queue: { enqueuePlatform: async () => ({ jobId: randomUUID() }) } },
  );
  const token = d.activation?.token;
  if (token === undefined) throw new Error("expected SCREEN token");
  const slug = `t996-${randomBytes(4).toString("hex")}`;
  const r = await activateTrial(
    { db: app, token, company: "Örnek AŞ", workspaceName: slug, sample, password: PASSWORD },
    { createActivatedAccount: (input) => auth.createActivatedAccount(input), mailConfig: mailOff, queue },
  );
  const owner = await adm.query<{ id: string }>("SELECT id FROM public.users WHERE email = $1", [email]);
  return { tenantId: r.tenantId, slug: r.tenantSlug, ownerId: (owner.rows[0] as { id: string }).id };
}

const access = (t: Trial) => ({ db: app, principal: { userId: t.ownerId, mfaVerified: true }, tenantSlug: t.slug });

async function counts(tenantId: string) {
  const r = await adm.query<{ w: number; l: number; i: number; u: number; k: number; aw: number; al: number; ai: number }>(
    `SELECT (SELECT count(*)::int FROM public.warehouses WHERE tenant_id = $1 AND is_sample) AS w,
            (SELECT count(*)::int FROM public.locations WHERE tenant_id = $1 AND is_sample) AS l,
            (SELECT count(*)::int FROM public.items WHERE tenant_id = $1 AND is_sample) AS i,
            (SELECT count(*)::int FROM public.unit_conversions c JOIN public.items it ON it.tenant_id = c.tenant_id AND it.id = c.item_id
              WHERE c.tenant_id = $1 AND it.is_sample) AS u,
            (SELECT count(*)::int FROM public.location_count_locks k JOIN public.locations l ON l.tenant_id = k.tenant_id AND l.id = k.location_id
              WHERE k.tenant_id = $1 AND l.is_sample) AS k,
            (SELECT count(*)::int FROM public.warehouses WHERE tenant_id = $1 AND is_sample AND status = 'ARCHIVED') AS aw,
            (SELECT count(*)::int FROM public.locations WHERE tenant_id = $1 AND is_sample AND status = 'ARCHIVED') AS al,
            (SELECT count(*)::int FROM public.items WHERE tenant_id = $1 AND is_sample AND status = 'ARCHIVED') AS ai`,
    [tenantId],
  );
  return r.rows[0] as { w: number; l: number; i: number; u: number; k: number; aw: number; al: number; ai: number };
}

async function audits(tenantId: string, action: string) {
  const r = await adm.query<{ change_summary: Record<string, unknown> }>(
    "SELECT change_summary FROM public.audit_logs WHERE tenant_id = $1 AND action = $2 ORDER BY created_at",
    [tenantId, action],
  );
  return r.rows.map((x) => x.change_summary);
}

async function ledgerCount(tenantId: string): Promise<number> {
  return ((await adm.query<{ n: number }>("SELECT count(*)::int AS n FROM public.stock_ledger WHERE tenant_id = $1", [tenantId])).rows[0] as { n: number }).n;
}

const failure = async (p: Promise<unknown>): Promise<AppError> => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return e as AppError;
  }
  throw new Error("expected rejection");
};

/** Örnek ürünle tek satırlık giriş ya da çıkış belgesi (gerçek stok komutları: oluştur → onayla → kaydet). */
async function move(t: Trial, kind: "STOCK_IN" | "STOCK_OUT", quantity: string): Promise<void> {
  const ids = await adm.query<{ w: string; l: string; i: string; u: string }>(
    `SELECT w.id AS w, l.id AS l, i.id AS i, i.base_unit_id AS u
       FROM public.warehouses w
       JOIN public.locations l ON l.tenant_id = w.tenant_id AND l.warehouse_id = w.id AND l.code = 'A1-G01'
       JOIN public.items i ON i.tenant_id = w.tenant_id AND i.code = $2
      WHERE w.tenant_id = $1 AND w.code = $3`,
    [t.tenantId, SAMPLE_ITEMS[0]?.code, SAMPLE_WAREHOUSE.code],
  );
  const x = ids.rows[0] as { w: string; l: string; i: string; u: string };
  const p = (key: string) => ({ ...access(t), clientKey: key, queue });
  const line = {
    itemId: x.i,
    unitId: x.u,
    quantity,
    conversionFactor: "1",
    baseQuantity: quantity,
    ...(kind === "STOCK_IN" ? { targetLocationId: x.l } : { sourceLocationId: x.l }),
  };
  const doc = await createStockDocument(p(randomUUID()), { kind, warehouseId: x.w, reason: "T-996 int", lines: [line] });
  const documentId = doc.documentId as string;
  await approveDocument(p(randomUUID()), { documentId, expectedVersion: 1 });
  await postDocument(p(randomUUID()), { documentId, expectedVersion: 2 });
}

beforeAll(async () => {
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  worker = createDbClient({ url: readWorkerDatabaseUrl(process.env), poolMax: 1, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  authClient = createDbClient({ url: authUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  auth = createAuth({
    client: authClient,
    env: readAuthEnv({ BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), BETTER_AUTH_URL: "http://localhost:3000", DATABASE_URL: env.databaseUrl, AUTH_DATABASE_URL: authUrl }),
  });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  try {
    await adm.connect();
    await installQueueSchema({ url: env.databaseUrlDirect });
  } catch (e) {
    throw new Error(`connect failed: ${redactErrorChain(e, urls)}`);
  }
  queue = createJobQueue({
    connectionString: env.databaseUrl,
    max: 2,
    pollingIntervalSeconds: 0.5,
    stopTimeoutMs: 5000,
    runInTenant: (tenantId, _reason, fn) => withTenant(createTenantContext(app, tenantId), fn),
  });
  await queue.start();
  operatorEmail = `t996-op-${randomBytes(6).toString("hex")}@example.test`;
  const op = await adm.query<{ id: string }>(
    "INSERT INTO public.users (name, email, email_verified, two_factor_enabled) VALUES ('T996 fixture', $1, true, true) RETURNING id",
    [operatorEmail],
  );
  operatorId = (op.rows[0] as { id: string }).id;
  await adm.query("INSERT INTO wms_platform.operators (email_normalized) VALUES ($1)", [operatorEmail]);
}, 120_000);

afterAll(async () => {
  // Audit/tenant/defter satırları append-only ve kısa ömürlü ortam (activation testiyle aynı); yalnız platform kayıtları temizlenir.
  await adm.query("DELETE FROM wms_platform.subscriptions WHERE demo_request_id = ANY($1::uuid[])", [leadIds]).catch(() => undefined);
  await adm.query("DELETE FROM wms_platform.demo_requests WHERE id = ANY($1::uuid[])", [leadIds]).catch(() => undefined);
  await adm.query("DELETE FROM wms_platform.operators WHERE email_normalized = $1", [operatorEmail]).catch(() => undefined);
  await queue.stop();
  await adm.end();
  await app.close();
  await worker.close();
  await authClient.close();
}, 60_000);

describe("yükleme", () => {
  it("örnek verilerle: ayrı Örnek depo, bölge > raf > göz, ürünler ve koli dönüşümleri örnek işaretli; stok hareketi yok; tek audit", async () => {
    const t = await trial(true);
    const c = await counts(t.tenantId);
    const conversions = SAMPLE_ITEMS.filter((x) => x.perKoli !== null).length;
    expect(c).toEqual({ w: 1, l: SAMPLE_LOCATIONS.length, i: SAMPLE_ITEMS.length, u: conversions, k: SAMPLE_LOCATIONS.length, aw: 0, al: 0, ai: 0 });
    const wh = await adm.query("SELECT code, name, status FROM public.warehouses WHERE tenant_id = $1", [t.tenantId]);
    expect(wh.rows).toEqual([{ code: SAMPLE_WAREHOUSE.code, name: SAMPLE_WAREHOUSE.name, status: "ACTIVE" }]);
    const tree = await adm.query<{ depth: number; n: number }>(
      "SELECT depth, count(*)::int AS n FROM public.locations WHERE tenant_id = $1 GROUP BY depth ORDER BY depth",
      [t.tenantId],
    );
    expect(tree.rows).toEqual([{ depth: 0, n: 1 }, { depth: 1, n: 3 }, { depth: 2, n: 12 }]);
    expect(await ledgerCount(t.tenantId)).toBe(0);
    expect(await audits(t.tenantId, "sample_data.loaded")).toEqual([{ warehouses: 1, locations: SAMPLE_LOCATIONS.length, items: SAMPLE_ITEMS.length }]);
    expect((await getSampleDataStatus(access(t))).active).toEqual({ warehouses: 1, locations: SAMPLE_LOCATIONS.length, items: SAMPLE_ITEMS.length });
  }, 60_000);

  it("boş başla: örnek kayıt yok, temizleme NONE ve audit yazmaz", async () => {
    const t = await trial(false);
    expect(await counts(t.tenantId)).toEqual({ w: 0, l: 0, i: 0, u: 0, k: 0, aw: 0, al: 0, ai: 0 });
    expect(await clearSampleData({ ...access(t), recentAuth: ok })).toEqual({ mode: "NONE", counts: { warehouses: 0, locations: 0, items: 0 } });
    expect(await audits(t.tenantId, "sample_data.cleared")).toEqual([]);
  }, 60_000);
});

describe("temizleme", () => {
  it("hareketsiz örnek: hepsi tek transaction'da silinir (dönüşüm ve sayım kilitleri dahil); ikinci çağrı NONE", async () => {
    const t = await trial(true);
    const r = await clearSampleData({ ...access(t), recentAuth: ok });
    expect(r).toEqual({ mode: "DELETED", counts: { warehouses: 1, locations: SAMPLE_LOCATIONS.length, items: SAMPLE_ITEMS.length } });
    expect(await counts(t.tenantId)).toEqual({ w: 0, l: 0, i: 0, u: 0, k: 0, aw: 0, al: 0, ai: 0 });
    expect(await audits(t.tenantId, "sample_data.cleared")).toEqual([
      { mode: "DELETED", warehouses: 1, locations: SAMPLE_LOCATIONS.length, items: SAMPLE_ITEMS.length },
    ]);
    expect((await clearSampleData({ ...access(t), recentAuth: ok })).mode).toBe("NONE");
    expect(await audits(t.tenantId, "sample_data.cleared")).toHaveLength(1);
    // Standart birimler örnek değildir: yerinde kalır.
    const units = await adm.query<{ n: number }>("SELECT count(*)::int AS n FROM public.units WHERE tenant_id = $1 AND code IN ('ADET','KOLI')", [t.tenantId]);
    expect(units.rows[0]?.n).toBe(2);
  }, 60_000);

  it("hareketli örnek: stok dururken IN_USE (hiçbir şey değişmez); stok sıfırlanınca silinmez pasife alınır, defter satır sayısı aynı", async () => {
    const t = await trial(true);
    await move(t, "STOCK_IN", "10");
    const before = await ledgerCount(t.tenantId);
    expect(before).toBeGreaterThan(0);

    const busy = await failure(clearSampleData({ ...access(t), recentAuth: ok }));
    expect([busy.code, busy.detail]).toEqual(["VALIDATION_FAILED", "IN_USE"]);
    expect(await counts(t.tenantId)).toMatchObject({ w: 1, l: SAMPLE_LOCATIONS.length, i: SAMPLE_ITEMS.length, aw: 0, al: 0, ai: 0 });
    expect(await audits(t.tenantId, "sample_data.cleared")).toEqual([]);

    await move(t, "STOCK_OUT", "10");
    const moved = await ledgerCount(t.tenantId);
    const r = await clearSampleData({ ...access(t), recentAuth: ok });
    expect(r).toEqual({ mode: "ARCHIVED", counts: { warehouses: 1, locations: SAMPLE_LOCATIONS.length, items: SAMPLE_ITEMS.length } });
    expect(await ledgerCount(t.tenantId)).toBe(moved); // I-08: işlenmiş defter silinmez
    const c = await counts(t.tenantId);
    expect(c).toEqual({
      w: 1,
      l: SAMPLE_LOCATIONS.length,
      i: SAMPLE_ITEMS.length,
      u: SAMPLE_ITEMS.filter((x) => x.perKoli !== null).length,
      k: SAMPLE_LOCATIONS.length,
      aw: 1,
      al: SAMPLE_LOCATIONS.length,
      ai: SAMPLE_ITEMS.length,
    });
    expect(await audits(t.tenantId, "sample_data.cleared")).toEqual([
      { mode: "ARCHIVED", warehouses: 1, locations: SAMPLE_LOCATIONS.length, items: SAMPLE_ITEMS.length },
    ]);
    expect((await getSampleDataStatus(access(t))).active).toEqual({ warehouses: 0, locations: 0, items: 0 });
    expect((await clearSampleData({ ...access(t), recentAuth: ok })).mode).toBe("NONE");
  }, 120_000);

  it("örnek rafın altına açılmış gerçek lokasyon: silme geri alınır; pasife almada o rafın örnek ataları ve depo açık kalır", async () => {
    const t = await trial(true);
    const rack = await adm.query<{ id: string; warehouse_id: string }>(
      "SELECT id, warehouse_id FROM public.locations WHERE tenant_id = $1 AND code = 'A-R1'",
      [t.tenantId],
    );
    const r1 = rack.rows[0] as { id: string; warehouse_id: string };
    const real = randomUUID();
    await withTenant(createTenantContext(app, t.tenantId), async (tx) => {
      await tx.execute(
        sql`INSERT INTO public.locations (tenant_id, id, warehouse_id, parent_id, code, name, depth, kind)
            VALUES (${t.tenantId}::uuid, ${real}::uuid, ${r1.warehouse_id}::uuid, ${r1.id}::uuid, 'GERCEK-1', 'Gerçek göz', 2, 'STORAGE')`,
      );
    });
    const r = await clearSampleData({ ...access(t), recentAuth: ok });
    expect(r).toEqual({ mode: "ARCHIVED", counts: { warehouses: 0, locations: SAMPLE_LOCATIONS.length - 2, items: SAMPLE_ITEMS.length } });
    const open = await adm.query<{ code: string }>(
      "SELECT code FROM public.locations WHERE tenant_id = $1 AND status = 'ACTIVE' ORDER BY code",
      [t.tenantId],
    );
    expect(open.rows.map((x) => x.code)).toEqual(["A", "A-R1", "GERCEK-1"]);
    expect((await adm.query("SELECT status FROM public.warehouses WHERE tenant_id = $1", [t.tenantId])).rows).toEqual([{ status: "ACTIVE" }]);
  }, 60_000);

  it("yakın zamanda doğrulama istenir; reddedilirse hiçbir şey silinmez", async () => {
    const t = await trial(true);
    const reauth = async (): Promise<void> => {
      throw Object.assign(new Error("reauth"), { reason: "REAUTH_REQUIRED" });
    };
    const e = await failure(clearSampleData({ ...access(t), recentAuth: reauth }));
    expect([e.code, e.detail]).toEqual(["UNAUTHENTICATED", "RECENT_AUTH_REQUIRED"]);
    expect((await counts(t.tenantId)).w).toBe(1);
  }, 60_000);
});

describe("DB sınırı (0040)", () => {
  it("DELETE yetkisi beş tabloda yalnız wms_app'te (tetikleyici başka rolleri sınamaz; başka çalışma rolüne verilmemeli)", async () => {
    const r = await adm.query<{ role: string; t: string; d: boolean; tr: boolean }>(
      `SELECT r AS role, t, has_table_privilege(r, 'public.' || t, 'DELETE') AS d, has_table_privilege(r, 'public.' || t, 'TRUNCATE') AS tr
         FROM unnest(ARRAY['wms_app','wms_auth','wms_worker','wms_ops','wms_identity_probe']) r,
              unnest(ARRAY['warehouses','locations','location_count_locks','items','unit_conversions']) t
        ORDER BY 1, 2`,
    );
    expect(r.rows.filter((x) => x.d).map((x) => x.role)).toEqual(Array(5).fill("wms_app"));
    expect(r.rows.filter((x) => x.tr)).toEqual([]);
  });

  it("wms_app örnek olmayan satırı silemez (atlanır, satır yerinde); gerçek satır örnek işaretlenemez; başka tenant'ın örneği görünmez", async () => {
    const t = await trial(true);
    const other = await trial(true);
    const real = randomUUID();
    await withTenant(createTenantContext(app, t.tenantId), async (tx) => {
      await tx.execute(sql`INSERT INTO public.warehouses (tenant_id, id, code, name) VALUES (${t.tenantId}::uuid, ${real}::uuid, 'GERCEK', 'Gerçek depo')`);
    });
    const deleted = await withTenant(createTenantContext(app, t.tenantId), (tx) =>
      tx.execute<{ id: string }>(sql`DELETE FROM public.warehouses WHERE NOT is_sample RETURNING id`),
    );
    expect(deleted).toEqual([]);
    expect((await adm.query("SELECT 1 FROM public.warehouses WHERE id = $1", [real])).rowCount).toBe(1);

    const mark = await withTenant(createTenantContext(app, t.tenantId), (tx) =>
      tx.execute(sql`UPDATE public.warehouses SET is_sample = true WHERE id = ${real}::uuid`),
    ).then(
      () => "ok",
      (err: unknown) => String((err as { cause?: { code?: unknown } }).cause?.code ?? (err as { code?: unknown }).code),
    );
    expect(mark).toBe("42501");

    const foreign = await withTenant(createTenantContext(app, t.tenantId), (tx) =>
      tx.execute<{ id: string }>(sql`DELETE FROM public.items WHERE tenant_id = ${other.tenantId}::uuid RETURNING id`),
    );
    expect(foreign).toEqual([]);
    expect((await counts(other.tenantId)).i).toBe(SAMPLE_ITEMS.length);
  }, 60_000);
});
