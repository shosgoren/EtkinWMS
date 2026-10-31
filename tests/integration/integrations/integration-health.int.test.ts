// T-1137: ERP bağlantı sağlığı + kuyrukta karar bekleyen satırların çözümü — gerçek wms_app (RLS) ve
// sahte Paraşüt (gerçek ağ yok). Kanıtlar: sağlık sunucuda tenant kapsamında (başka kiracı görmez), webhook ACTIVE eşiği; yeni okuma ve
// komutlar yalnız `settings.manage` + kendi tenant'ı (başka kiracının satır kimliği NOT_FOUND, satır değişmez); her durum değişikliği audit
// (I-12) ve idempotent (ikinci çağrı audit yazmaz); kart bekletmesi "Yeniden dene" ile kalkar ve çakışma sürerse yeniden bekletilir;
// T-1139: bağlantı yalnız OAuth ile kurulur (parola eylemi sunucu eylemlerinden kalktı); 0068'in kestiği eski yöntem bağlantısı AUTH +
// "Yeniden bağlan" olarak görünür. Fikstürler sentetiktir (G-09).
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ db: undefined as unknown, headers: new Headers() }));
vi.mock("../../../apps/web/node_modules/next/headers.js", () => ({
  headers: () => Promise.resolve(h.headers),
  cookies: () => Promise.resolve({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("../../../packages/db/src/index.ts", async (orig) => ({ ...(await orig<Record<string, unknown>>()), getAppDb: () => h.db }));
vi.mock("../../../apps/web/lib/queue.ts", () => ({ getSenderQueue: () => Promise.resolve(undefined) }));
vi.mock("../../../apps/web/lib/auth-service.ts", () => ({
  getAuthService: () => ({
    getPrincipal: (headers: Headers) => {
      const u = headers.get("x-test-user");
      return Promise.resolve(u === null ? null : { userId: u, mfaVerified: true });
    },
  }),
  ensureRecentAuth: () => Promise.resolve(),
}));

import { createDbClient, withSystemTenant } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { AppError } from "../../../packages/shared/src/errors.ts";
import { createSealer } from "../../../packages/shared/src/seal.ts";
import {
  HEALTH_STALE_MS,
  LEGACY_METHOD_REMOVED,
  ParasutClient,
  getIntegrationOutboxIssues,
  getIntegrationOverview,
  resolveIntegrationOutbox,
  retryIntegrationOutbox,
  runIntegrationSync,
  setIntegrationFlow,
} from "../../../packages/domain/src/integrations/index.ts";
import { startFakeParasut, type FakeParasut } from "../fixtures/fake-parasut.ts";
import { connectParasutOAuth } from "../fixtures/parasut-oauth.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv, redactErrorChain } from "../harness/env.ts";

const env = readIntEnv(process.env);
const reg = newRegistry();
const sealer = createSealer(randomBytes(32).toString("hex"));
const ORIGIN = "https://app.example.test";
const WEB = path.resolve(import.meta.dirname, "../../../apps/web");
const ENV_KEYS = ["BETTER_AUTH_URL", "BETTER_AUTH_SECRET", "WMS_ENV"] as const;
const saved: Record<string, string | undefined> = {};

type Result = { ok: true; data: Record<string, unknown> } | { ok: false; error: { code: string; detail?: string } };
type Actions = Record<string, (arg: unknown) => Promise<Result>>;

let app: DbClient;
let adm: pg.Client;
let A: TenantWorld;
let B: TenantWorld;
let fake: FakeParasut;
let actions: Actions;

beforeAll(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  Object.assign(process.env, { BETTER_AUTH_URL: ORIGIN, BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), WMS_ENV: "ci" });
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  try {
    await adm.connect();
  } catch (e) {
    throw new Error(`connect failed: ${redactErrorChain(e, [env.databaseUrl, env.databaseUrlDirect])}`);
  }
  h.db = app;
  A = await seedWorld(adm, reg, "H1137A");
  B = await seedWorld(adm, reg, "H1137B");
  actions = (await import(/* @vite-ignore */ path.join(WEB, "app/t/[slug]/integrations/actions.ts"))) as Actions;
}, 180_000);

afterAll(async () => {
  if (fake !== undefined) await fake.close();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await adm?.end().catch(() => undefined);
  await app?.close().catch(() => undefined);
}, 120_000);

beforeEach(async () => {
  if (fake !== undefined) await fake.close();
  fake = await startFakeParasut();
});

const admin = (w: TenantWorld) => ({ db: app, principal: { userId: w.ownerUserId, mfaVerified: true }, tenantSlug: w.slug, recentAuth: async () => undefined });
const picker = (w: TenantWorld) => ({ db: app, principal: { userId: w.memberUserId, mfaVerified: true }, tenantSlug: w.slug });
const deps = () => ({ client: new ParasutClient({ baseUrl: fake.url, sleep: async () => undefined }), sealer });
async function q<T extends pg.QueryResultRow = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await adm.query<T>(text, params)).rows;
}
/** Migration rolüyle, tenant bağlamında (FORCE RLS tabloları) tek transaction. */
async function inTenant<T extends pg.QueryResultRow = Record<string, unknown>>(w: TenantWorld, text: string, params: unknown[] = []): Promise<T[]> {
  await adm.query("BEGIN");
  try {
    await adm.query("SELECT set_config('app.current_tenant_id', $1, true)", [w.tenantId]);
    const r = await adm.query<T>(text, params);
    await adm.query("COMMIT");
    return r.rows;
  } catch (e) {
    await adm.query("ROLLBACK");
    throw e;
  }
}
async function connect(w: TenantWorld): Promise<string> {
  expect(await connectParasutOAuth(admin(w), deps(), fake, { productsOff: true })).toEqual({ ok: true, label: fake.opts.companyName });
  return (await q<{ id: string }>("SELECT id FROM public.integrations WHERE tenant_id = $1 AND provider = 'PARASUT'", [w.tenantId]))[0]?.id as string;
}
async function outboxRow(w: TenantWorld, integrationId: string, o: { flow?: string; entity?: string; entityId?: string; status: string; code?: string | null; external?: string }): Promise<string> {
  const id = randomUUID();
  await inTenant(w, "INSERT INTO public.integration_outbox (tenant_id, id, integration_id, flow, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5, $6)", [w.tenantId, id, integrationId, o.flow ?? "SHIPMENTS", o.entity ?? "DOCUMENT", o.entityId ?? randomUUID()]);
  await inTenant(w, "UPDATE public.integration_outbox SET status = $3, last_error_code = $4, attempts = 3, external_id = $5 WHERE tenant_id = $1 AND id = $2", [w.tenantId, id, o.status, o.code ?? null, o.external ?? null]);
  return id;
}
const row = async (w: TenantWorld, id: string) =>
  (await inTenant<{ status: string; attempts: number; last_error_code: string | null }>(w, "SELECT status, attempts, last_error_code FROM public.integration_outbox WHERE tenant_id = $1 AND id = $2", [w.tenantId, id]))[0];
const audits = async (w: TenantWorld, action: string) =>
  (await inTenant<{ n: number }>(w, "SELECT count(*)::int AS n FROM public.audit_logs WHERE tenant_id = $1 AND action = $2", [w.tenantId, action]))[0]?.n;
async function fail(p: Promise<unknown>): Promise<AppError> {
  const e = await p.then(() => undefined, (x: unknown) => x);
  expect(e).toBeInstanceOf(AppError);
  return e as AppError;
}

let ipN = 0;
function as(user: string | null): void {
  const hd = new Headers({ "fly-client-ip": `198.51.100.${(++ipN % 250) + 1}`, "user-agent": "t1137-int", origin: ORIGIN });
  if (user !== null) hd.set("x-test-user", user);
  h.headers = hd;
}

describe("bağlantı sağlığı (sunucuda, tenant kapsamında)", () => {
  it("OAuth bağlantısı ok; eski eşitleme STALE, webhook ACTIVE eşiği ürün çekmede 25 dk; ERROR → AUTH; 0068'in kestiği bağlantı AUTH; başka kiracı görmez", async () => {
    const W = await seedWorld(adm, reg, "H1137H");
    const id = await connect(W);
    const o0 = await getIntegrationOverview(admin(W));
    expect(o0.health).toEqual({ level: "ok", cause: null, next: null, flow: null, since: null, code: null });
    let o = o0;

    expect(await setIntegrationFlow(admin(W), { provider: "PARASUT", flow: "PRODUCTS", enabled: true, direction: "PULL" })).toMatchObject({ ok: true });
    await inTenant(W, "UPDATE public.integration_flows SET last_success_at = now() - interval '20 minutes', last_status = 'SUCCESS' WHERE tenant_id = $1 AND flow = 'PRODUCTS'", [W.tenantId]);
    o = await getIntegrationOverview(admin(W));
    expect(o.health).toMatchObject({ level: "warn", cause: "STALE", next: "RUN", flow: "PRODUCTS" });
    expect(Date.now() - (o.health?.since?.getTime() ?? 0)).toBeGreaterThan(HEALTH_STALE_MS);
    await inTenant(W, "UPDATE public.integrations SET webhook_status = 'ACTIVE' WHERE tenant_id = $1 AND id = $2", [W.tenantId, id]);
    expect((await getIntegrationOverview(admin(W))).health?.cause).toBeNull();
    await inTenant(W, "UPDATE public.integration_flows SET last_success_at = now() - interval '30 minutes' WHERE tenant_id = $1 AND flow = 'PRODUCTS'", [W.tenantId]);
    expect((await getIntegrationOverview(admin(W))).health?.cause).toBe("STALE");

    // T-1135 zaman aşımı: açık akışın son koşusu FAILED/TIMEOUT → Şimdi çalıştır.
    // Son başarı TIMEOUT koşusundan ÖNCE (sonra başarı olsaydı bant kalkardı; birim testi).
    await inTenant(W, "UPDATE public.integration_flows SET last_success_at = now() - interval '50 minutes' WHERE tenant_id = $1 AND flow = 'PRODUCTS'", [W.tenantId]);
    await inTenant(W, "INSERT INTO public.integration_runs (tenant_id, id, integration_id, flow, trigger, started_at) VALUES ($1, $2, $3, 'PRODUCTS', 'SCHEDULE', now() - interval '45 minutes')", [W.tenantId, randomUUID(), id]);
    await inTenant(W, "UPDATE public.integration_runs SET status = 'FAILED', error_code = 'TIMEOUT' WHERE tenant_id = $1 AND status = 'RUNNING'", [W.tenantId]);
    expect((await getIntegrationOverview(admin(W))).health).toMatchObject({ level: "error", cause: "TIMEOUT", next: "RUN", flow: "PRODUCTS" });
    await inTenant(W, "UPDATE public.integration_flows SET last_success_at = now(), last_status = 'SUCCESS' WHERE tenant_id = $1 AND flow = 'PRODUCTS'", [W.tenantId]);
    expect((await getIntegrationOverview(admin(W))).health?.cause).toBeNull();

    await inTenant(W, "UPDATE public.integrations SET status = 'ERROR', last_error_code = 'REAUTH_REQUIRED' WHERE tenant_id = $1 AND id = $2", [W.tenantId, id]);
    expect((await getIntegrationOverview(admin(W))).health).toMatchObject({ level: "error", cause: "AUTH", next: "RECONNECT", code: "REAUTH_REQUIRED" });

    // T-1139: migration 0068'in kestiği eski yöntem bağlantısı (DISCONNECTED + LEGACY_METHOD_REMOVED): bağlı değil, tek AUTH bandı.
    await inTenant(W, "UPDATE public.integrations SET status = 'DISCONNECTED', credentials = NULL, last_error_code = $3 WHERE tenant_id = $1 AND id = $2", [W.tenantId, id, LEGACY_METHOD_REMOVED]);
    o = await getIntegrationOverview(admin(W));
    expect(o.providers.find((p) => p.provider === "PARASUT")?.connection).toBeNull();
    expect(o.health).toEqual({ level: "error", cause: "AUTH", next: "RECONNECT", flow: null, since: null, code: "LEGACY_METHOD_REMOVED" });
    // Sıradan kesme (kod yok) sağlık üretmez.
    await inTenant(W, "UPDATE public.integrations SET last_error_code = NULL WHERE tenant_id = $1 AND id = $2", [W.tenantId, id]);
    expect((await getIntegrationOverview(admin(W))).health).toBeNull();

    // Negatif: başka kiracının görünümü bu bağlantıyı içermez; üye (settings.manage yok) okuyamaz.
    expect((await getIntegrationOverview(admin(B))).health).toBeNull();
    expect((await fail(getIntegrationOverview(picker(W)))).code).toBe("FORBIDDEN");
  });
});

describe("kuyrukta karar bekleyenler: okuma + yeniden dene + elle çözüm", () => {
  let idA = "";
  let idB = "";
  beforeAll(async () => {
    fake = await startFakeParasut();
    idA = await connect(A);
    idB = await connect(B);
  });

  it("okuma: CHECK önce, gönderilmiş/bekleyen yok; kendi tenant'ı; üye FORBIDDEN", async () => {
    const check = await outboxRow(A, idA, { status: "CHECK", code: "UNCERTAIN", entityId: A.documentId });
    const failed = await outboxRow(A, idA, { status: "FAILED", code: "PROVIDER_INVALID" });
    await outboxRow(A, idA, { status: "SENT", external: "999" });
    await outboxRow(A, idA, { status: "PENDING" });
    const other = await outboxRow(B, idB, { status: "CHECK", code: "UNCERTAIN" });
    const mine = await getIntegrationOutboxIssues(admin(A));
    const ids = mine.items.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([check, failed]));
    expect(ids).not.toContain(other);
    expect(mine.items.findIndex((r) => r.id === check)).toBeLessThan(mine.items.findIndex((r) => r.id === failed));
    expect(mine.items.every((r) => r.status === "CHECK" || r.status === "FAILED")).toBe(true);
    expect(mine.items.find((r) => r.id === check)).toMatchObject({ flow: "SHIPMENTS", entityType: "DOCUMENT", resolvable: true });
    expect((await getIntegrationOutboxIssues(admin(B))).items.map((r) => r.id)).not.toContain(check);
    expect((await fail(getIntegrationOutboxIssues(picker(A)))).code).toBe("FORBIDDEN");
  });

  it("yeniden dene: CHECK → PENDING (sayaç 0, kod yok) + audit; ikinci çağrı değişiklik yok; gönderilmiş satır değişmez", async () => {
    const id = await outboxRow(A, idA, { status: "CHECK", code: "UNCERTAIN" });
    const before = await audits(A, "integration.outbox_retried");
    expect(await retryIntegrationOutbox(admin(A), { id })).toEqual({ ok: true, changed: true, queued: false });
    expect(await row(A, id)).toEqual({ status: "PENDING", attempts: 0, last_error_code: null });
    expect(await audits(A, "integration.outbox_retried")).toBe((before ?? 0) + 1);
    expect(await retryIntegrationOutbox(admin(A), { id })).toEqual({ ok: true, changed: false, queued: false });
    expect(await audits(A, "integration.outbox_retried")).toBe((before ?? 0) + 1);
    const sent = await outboxRow(A, idA, { status: "SENT", external: "998" });
    expect(await retryIntegrationOutbox(admin(A), { id: sent })).toEqual({ ok: false, reason: "NOT_RETRYABLE" });
    expect((await fail(retryIntegrationOutbox(admin(A), { id: "x'; --" }))).code).toBe("VALIDATION_FAILED");
  });

  it("negatif: başka kiracının satır kimliği NOT_FOUND ve satır değişmez; üye FORBIDDEN", async () => {
    const id = await outboxRow(A, idA, { status: "CHECK", code: "UNCERTAIN" });
    expect(await retryIntegrationOutbox(admin(B), { id })).toEqual({ ok: false, reason: "NOT_FOUND" });
    expect(await resolveIntegrationOutbox(admin(B), { id, resolution: "SENT" })).toEqual({ ok: false, reason: "NOT_FOUND" });
    expect((await fail(retryIntegrationOutbox(picker(A), { id }))).code).toBe("FORBIDDEN");
    expect((await fail(resolveIntegrationOutbox(picker(A), { id, resolution: "SKIP" }))).code).toBe("FORBIDDEN");
    expect(await row(A, id)).toEqual({ status: "CHECK", attempts: 3, last_error_code: "UNCERTAIN" });
  });

  it("elle çözüm: Gönderildi say → FAILED MANUAL_SENT, sorun sayılmaz, listeden kalkar; ikinci kez değişiklik yok; kart satırı UNSUPPORTED", async () => {
    const W = await seedWorld(adm, reg, "H1137R");
    const idW = await connect(W);
    const sent = await outboxRow(W, idW, { status: "CHECK", code: "UNCERTAIN" });
    const skip = await outboxRow(W, idW, { status: "FAILED", code: "PROVIDER_INVALID" });
    const card = await outboxRow(W, idW, { flow: "CONTACTS", entity: "PARTY", status: "FAILED", code: "EXTERNAL_ALREADY_LINKED" });
    expect((await getIntegrationOverview(admin(W))).outbox).toEqual({ pending: 0, check: 1, failed: 1, parked: 1 });
    expect(await resolveIntegrationOutbox(admin(W), { id: sent, resolution: "SENT" })).toEqual({ ok: true, changed: true, queued: false });
    expect(await resolveIntegrationOutbox(admin(W), { id: skip, resolution: "SKIP" })).toEqual({ ok: true, changed: true, queued: false });
    expect(await row(W, sent)).toMatchObject({ status: "FAILED", last_error_code: "MANUAL_SENT" });
    expect(await row(W, skip)).toMatchObject({ status: "FAILED", last_error_code: "MANUAL_SKIPPED" });
    expect(await audits(W, "integration.outbox_resolved")).toBe(2);
    expect(await resolveIntegrationOutbox(admin(W), { id: sent, resolution: "SENT" })).toEqual({ ok: true, changed: false, queued: false });
    expect(await audits(W, "integration.outbox_resolved")).toBe(2);
    expect(await resolveIntegrationOutbox(admin(W), { id: card, resolution: "SKIP" })).toEqual({ ok: false, reason: "UNSUPPORTED" });
    // İnsan kararı yeniden gönderimle bozulmaz (inceleme MINOR-2): elle çözülmüş satır yeniden denenmez, satır ve audit değişmez.
    const retriedBefore = await audits(W, "integration.outbox_retried");
    for (const id of [sent, skip]) expect(await retryIntegrationOutbox(admin(W), { id })).toEqual({ ok: false, reason: "NOT_RETRYABLE" });
    expect(await row(W, sent)).toEqual({ status: "FAILED", attempts: 3, last_error_code: "MANUAL_SENT" });
    expect(await row(W, skip)).toEqual({ status: "FAILED", attempts: 3, last_error_code: "MANUAL_SKIPPED" });
    expect(await audits(W, "integration.outbox_retried")).toBe(retriedBefore);
    expect((await getIntegrationOverview(admin(W))).outbox).toEqual({ pending: 0, check: 0, failed: 0, parked: 1 });
    expect((await getIntegrationOutboxIssues(admin(W))).items.map((r) => r.id)).toEqual([card]);
    const audit = await inTenant<{ s: Record<string, unknown> }>(W, "SELECT change_summary AS s FROM public.audit_logs WHERE tenant_id = $1 AND action = 'integration.outbox_resolved' AND change_summary->>'outbox_id' = $2", [W.tenantId, sent]);
    expect(audit[0]?.s).toMatchObject({ outbox_id: sent, flow: "SHIPMENTS", resolution: "SENT", before: { status: "CHECK", error: "UNCERTAIN" } });
  });
});

describe("kart bekletmesi (EXTERNAL_ALREADY_LINKED): Yeniden dene bekletmeyi kaldırır", () => {
  it("yeniden dene → sonraki koşu kartı yeniden arar; çakışma sürerse satır yeniden FAILED (sayaç artar), sonsuz döngü yok", async () => {
    const W = await seedWorld(adm, reg, "H1137K");
    const id = await connect(W);
    const y = (await q<{ id: string }>("INSERT INTO public.parties (tenant_id, code, code_key, name, created_by) VALUES ($1, 'C-Y', 'C-Y', 'Ortak Ad', $2) RETURNING id", [W.tenantId, W.ownerMembershipId]))[0]?.id as string;
    const x = (await q<{ id: string }>("INSERT INTO public.parties (tenant_id, code, code_key, name, created_by) VALUES ($1, 'C-X', 'C-X', 'Ortak Ad', $2) RETURNING id", [W.tenantId, W.ownerMembershipId]))[0]?.id as string;
    fake.contacts.push({ id: "751", attributes: { name: "Ortak Ad", account_type: "customer" } });
    await q("INSERT INTO public.external_refs (tenant_id, system, entity_type, entity_id, external_id) VALUES ($1, 'PARASUT', 'PARTY', $2, '751')", [W.tenantId, y]);
    expect(await setIntegrationFlow(admin(W), { provider: "PARASUT", flow: "CONTACTS", enabled: true, direction: "BOTH" })).toMatchObject({ ok: true });
    const sync = () =>
      runIntegrationSync({ inTenant: (fn) => withSystemTenant(app, W.tenantId, "test.integration", fn), client: new ParasutClient({ baseUrl: fake.url, sleep: async () => undefined }), sealer }, { integrationId: id, flow: "CONTACTS", trigger: "MANUAL" }, W.ownerUserId);
    const r1 = await sync();
    expect(r1.kind === "ran" && r1.flows[0]?.counts).toMatchObject({ failed: 1 });
    const parked = (await getIntegrationOutboxIssues(admin(W))).items.find((r) => r.entityType === "PARTY");
    expect(parked).toMatchObject({ flow: "CONTACTS", status: "FAILED", errorCode: "EXTERNAL_ALREADY_LINKED", code: "C-X", resolvable: false });
    const searches = () => fake.requests.filter((r) => r.path.includes("/contacts?filter")).length;
    const n = searches();
    expect(await sync()).toMatchObject({ kind: "ran" });
    expect(searches()).toBe(n); // bekletilen kart aranmaz
    expect(await retryIntegrationOutbox(admin(W), { id: parked?.id as string })).toEqual({ ok: true, changed: true, queued: false });
    expect((await getIntegrationOverview(admin(W))).outbox.parked).toBe(0);
    const r3 = await sync();
    expect(r3.kind === "ran" && r3.flows[0]?.counts).toMatchObject({ failed: 1 });
    expect(searches()).toBeGreaterThan(n); // bekletme kalktı: kart yeniden denendi
    expect(await inTenant(W, "SELECT status, attempts, last_error_code FROM public.integration_outbox WHERE tenant_id = $1 AND entity_id = $2", [W.tenantId, x])).toEqual([{ status: "FAILED", attempts: 1, last_error_code: "EXTERNAL_ALREADY_LINKED" }]);
    const m = searches();
    await sync();
    expect(searches()).toBe(m); // yeniden bekletildi
  });
});

describe("sunucu eylemleri (gerçek sorgu yolu)", () => {
  it("T-1139: e-posta + parola ile bağlanma eylemi yok (yalnız OAuth eylemleri); hiçbir satır/istek yazılmaz", async () => {
    expect(actions.connectParasutAction).toBeUndefined();
    expect(Object.keys(actions).filter((k) => /password|parola|legacy/i.test(k))).toEqual([]);
    for (const k of ["beginParasutOAuthAction", "completeParasutOAuthCodeAction", "selectParasutOAuthCompanyAction"]) expect(Object.keys(actions)).toContain(k);
    expect(fake.requests.filter((r) => r.path.includes("oauth/token"))).toEqual([]);
  });

  it("yeniden dene / elle çöz eylemleri: kendi satırı olur; başka kiracının satırı NOT_FOUND; üye FORBIDDEN", async () => {
    const W = await seedWorld(adm, reg, "H1137S");
    const idW = await connect(W);
    const id = await outboxRow(W, idW, { status: "CHECK", code: "UNCERTAIN" });
    as(B.ownerUserId);
    expect(await actions.retryIntegrationOutboxAction!({ slug: B.slug, id })).toEqual({ ok: true, data: { ok: false, reason: "NOT_FOUND" } });
    as(B.ownerUserId);
    expect(await actions.resolveIntegrationOutboxAction!({ slug: B.slug, id, resolution: "SENT" })).toEqual({ ok: true, data: { ok: false, reason: "NOT_FOUND" } });
    as(W.memberUserId);
    expect(await actions.retryIntegrationOutboxAction!({ slug: W.slug, id })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await row(W, id)).toEqual({ status: "CHECK", attempts: 3, last_error_code: "UNCERTAIN" });
    as(W.ownerUserId);
    expect(await actions.retryIntegrationOutboxAction!({ slug: W.slug, id })).toEqual({ ok: true, data: { ok: true, changed: true, queued: false } });
    expect(await row(W, id)).toEqual({ status: "PENDING", attempts: 0, last_error_code: null });
    const id2 = await outboxRow(W, idW, { status: "CHECK", code: "UNCERTAIN" });
    as(W.ownerUserId);
    expect(await actions.resolveIntegrationOutboxAction!({ slug: W.slug, id: id2, resolution: "SKIP" })).toEqual({ ok: true, data: { ok: true, changed: true, queued: false } });
    as(W.ownerUserId);
    expect(await actions.retryIntegrationOutboxAction!({ slug: W.slug, id: id2 })).toEqual({ ok: true, data: { ok: false, reason: "NOT_RETRYABLE" } });
    expect(await row(W, id2)).toEqual({ status: "FAILED", attempts: 3, last_error_code: "MANUAL_SKIPPED" });
  });
});
