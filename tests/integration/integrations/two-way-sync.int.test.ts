// T-1140 (0069; kullanıcı kararı 31 Ekim 2026): gerçek iki yönlü kart eşitleme + cari/depo kaynak yaşam döngüsü + arşivli raf stok toplamında
// yok. Gerçek wms_app bağlantısı + sahte Paraşüt (gerçek ağ yok). Kanıtlar:
//  (1) BOTH: yerel düzeltme PUT ile gider (yalnız dolu kanonik alanlar), Paraşüt düzeltmesi gelir, ikisi de değişince yeni olan kazanır,
//      zaman bilinmezse Paraşüt; her çakışma `integration.conflict_resolved` audit'i (I-12). Webhook aynı kuralı uygular.
//  (2) PULL hiç göndermez; PUSH hiç almaz. Kesin 4xx kartı bekletir (sonsuz yeniden deneme yok).
//  (3) Cari / depo: Paraşüt'te arşiv ya da ≥30 sn arayla iki yokluk → boştaysa arşiv (via integration), kullanımdaysa PENDING; yeniden
//      etkin olunca yalnız sistemin arşivlediği kart geri açılır; fiziksel silme yok.
//  (4) Arşivli raftaki stok Paraşüt toplamına girmez.
//  (5) Kiracı yalıtımı (I-01…I-03): işaret satırı başka kiracıdan görünmez / yazılamaz; bir kiracının koşusu ötekine dokunmaz.
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, withSystemTenant } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { createSealer } from "../../../packages/shared/src/seal.ts";
import { consumeOnce } from "../../../packages/queue-adapter/src/consume.ts";
import { ParasutClient, runIntegrationSync, runWebhookEvent, setIntegrationFlow, type ConsumeOnce } from "../../../packages/domain/src/integrations/index.ts";
import { saveParty, setPartyArchived } from "../../../packages/domain/src/catalog/parties.ts";
import { updateItem } from "../../../packages/domain/src/catalog/items.ts";
import { archiveWarehouse, renameWarehouse } from "../../../packages/domain/src/warehouse/warehouses.ts";
import { startFakeParasut, type FakeParasut } from "../fixtures/fake-parasut.ts";
import { connectParasutOAuth } from "../fixtures/parasut-oauth.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv, redactErrorChain } from "../harness/env.ts";

const env = readIntEnv(process.env);
const reg = newRegistry();
const sealer = createSealer(randomBytes(32).toString("hex"));

let app: DbClient;
let adm: pg.Client;
let appPg: pg.Client;
let fake: FakeParasut;

beforeAll(async () => {
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  appPg = new pg.Client({ connectionString: env.databaseUrl });
  appPg.on("error", () => undefined);
  try {
    await adm.connect();
    await appPg.connect();
  } catch (e) {
    throw new Error(`connect failed: ${redactErrorChain(e, [env.databaseUrl, env.databaseUrlDirect])}`);
  }
}, 120_000);

afterAll(async () => {
  if (fake !== undefined) await fake.close();
  await appPg.end();
  await adm.end();
  await app.close();
}, 120_000);

beforeEach(async () => {
  if (fake !== undefined) await fake.close();
  fake = await startFakeParasut();
});

const admin = (w: TenantWorld) => ({ db: app, principal: { userId: w.ownerUserId, mfaVerified: true }, tenantSlug: w.slug, recentAuth: async () => undefined });
// Hız sınırı penceresi (10 istek / 10 sn) sanal saatle beklenir: test gerçek zamanda beklemez, sınır yine uygulanır.
const client = () => {
  let t = Date.now();
  return new ParasutClient({ baseUrl: fake.url, now: () => t, sleep: async (ms) => void (t += ms) });
};
const inTenant = (w: TenantWorld) => <T>(fn: Parameters<typeof withSystemTenant<T>>[3]) => withSystemTenant(app, w.tenantId, "test.integration", fn);
const sync = (w: TenantWorld, integrationId: string, flow: string, now?: number) =>
  runIntegrationSync({ inTenant: inTenant(w), client: client(), sealer, ...(now === undefined ? {} : { now: () => now }) }, { integrationId, flow: flow as never, trigger: "MANUAL" }, w.ownerUserId);
const flow = async (w: TenantWorld, f: string, direction: "PULL" | "PUSH" | "BOTH", enabled = true) => expect(await setIntegrationFlow(admin(w), { provider: "PARASUT", flow: f, enabled, direction })).toMatchObject({ ok: true });
async function q<T extends pg.QueryResultRow = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await adm.query<T>(text, params)).rows;
}
async function connect(w: TenantWorld): Promise<string> {
  expect(await connectParasutOAuth(admin(w), { client: client(), sealer }, fake, { productsOff: true })).toEqual({ ok: true, label: fake.opts.companyName });
  return (await q<{ id: string }>("SELECT id FROM public.integrations WHERE tenant_id = $1 AND provider = 'PARASUT'", [w.tenantId]))[0]?.id as string;
}
const link = (w: TenantWorld, type: string, entity: string, ext: string) => adm.query("INSERT INTO public.external_refs (tenant_id, system, entity_type, entity_id, external_id) VALUES ($1, 'PARASUT', $2, $3, $4)", [w.tenantId, type, entity, ext]);
async function party(w: TenantWorld, code: string, name: string, ext: string, extra: { tax?: string } = {}): Promise<string> {
  const id = (await q<{ id: string }>("INSERT INTO public.parties (tenant_id, code, code_key, name, tax_no, created_by) VALUES ($1, $2, upper($2), $3, $4, $5) RETURNING id", [w.tenantId, code, name, extra.tax ?? null, w.ownerMembershipId]))[0]?.id as string;
  await link(w, "PARTY", id, ext);
  return id;
}
async function editParty(w: TenantWorld, id: string, patch: { name?: string; phone?: string }): Promise<void> {
  const cur = (await q<{ code: string; name: string; tax_no: string | null; phone: string | null; version: number }>("SELECT code, name, tax_no, phone, version FROM public.parties WHERE id = $1", [id]))[0]!;
  const r = await saveParty(admin(w), { id, expectedVersion: Number(cur.version), code: cur.code, name: patch.name ?? cur.name, ...(cur.tax_no === null ? {} : { taxNo: cur.tax_no }), ...((patch.phone ?? cur.phone) === null ? {} : { phone: (patch.phone ?? cur.phone) as string }) });
  expect(r).toMatchObject({ ok: true });
}
const partyRow = async (id: string) => (await q<{ name: string; phone: string | null; archived: boolean }>("SELECT name, phone, archived_at IS NOT NULL AS archived FROM public.parties WHERE id = $1", [id]))[0];
const state = async (w: TenantWorld, type: string, id: string) =>
  (await q("SELECT local_hash IS NOT NULL AS marked, source_state, source_disposition, source_managed_archive FROM public.integration_card_states WHERE tenant_id = $1 AND system = 'PARASUT' AND entity_type = $2 AND entity_id = $3", [w.tenantId, type, id]))[0];
const conflicts = (w: TenantWorld, id: string) =>
  q<{ winner: string; basis: string; baseline: boolean }>("SELECT change_summary->>'winner' AS winner, change_summary->>'basis' AS basis, (change_summary->>'baseline')::boolean AS baseline FROM public.audit_logs WHERE tenant_id = $1 AND action = 'integration.conflict_resolved' AND entity_id = $2 ORDER BY occurred_at, id", [w.tenantId, id]);
const puts = () => fake.requests.filter((r) => r.method === "PUT").length;
const contact = (id: string) => fake.contacts.find((c) => c.id === id)!;
const iso = (deltaMs: number) => new Date(Date.now() + deltaMs).toISOString();

describe("(1) iki yönlü (BOTH)", () => {
  it("cari: yerel düzeltme PUT ile gider (yalnız dolu kanonik alanlar); Paraşüt düzeltmesi gelir; değişmeyen kart yeniden gönderilmez", async () => {
    const W = await seedWorld(adm, reg, "T1140A");
    const id = await connect(W);
    fake.contacts.push({ id: "7001", attributes: { name: "Acme", tax_number: "1111111111", account_type: "customer", updated_at: iso(-3_600_000) } });
    const p = await party(W, "C-ACME", "Acme", "7001", { tax: "1111111111" });
    await flow(W, "CONTACTS", "BOTH");
    expect(await sync(W, id, "CONTACTS")).toMatchObject({ kind: "ran", flows: [{ status: "SUCCESS" }] });
    expect(puts()).toBe(0);
    expect(await state(W, "PARTY", p)).toMatchObject({ marked: true, source_state: "ACTIVE" });

    await editParty(W, p, { name: "Acme Yeni", phone: "0532 000 11 22" });
    expect(await sync(W, id, "CONTACTS")).toMatchObject({ kind: "ran", flows: [{ status: "SUCCESS", counts: { updated: 1 } }] });
    expect(fake.updates).toEqual([{ kind: "contacts", id: "7001", attributes: { name: "Acme Yeni", tax_number: "1111111111", phone: "0532 000 11 22" } }]);
    expect(contact("7001").attributes).toMatchObject({ name: "Acme Yeni", account_type: "customer" });
    expect(await conflicts(W, p)).toEqual([]);

    contact("7001").attributes = { ...contact("7001").attributes, name: "Acme Paraşüt", updated_at: iso(0) };
    await sync(W, id, "CONTACTS");
    expect(await partyRow(p)).toMatchObject({ name: "Acme Paraşüt", phone: "0532 000 11 22" });
    expect(puts()).toBe(1);
    // Kararlı: iki taraf da değişmedi → ne PUT ne yazım.
    await sync(W, id, "CONTACTS");
    expect(puts()).toBe(1);
    expect(await conflicts(W, p)).toEqual([]);
  });

  it("ikisi de değişti: yeni olan kazanır; eşit/bilinmeyen zamanda Paraşüt; her çözüm audit'li (değer yazılmaz)", async () => {
    const W = await seedWorld(adm, reg, "T1140B");
    const id = await connect(W);
    fake.contacts.push({ id: "7101", attributes: { name: "Beta", account_type: "customer", updated_at: iso(-7_200_000) } });
    const p = await party(W, "C-BETA", "Beta", "7101");
    await flow(W, "CONTACTS", "BOTH");
    await sync(W, id, "CONTACTS");

    // Etkin daha yeni: Paraşüt bir saat önce değişti, Etkin şimdi.
    contact("7101").attributes = { ...contact("7101").attributes, name: "Beta Uzak", updated_at: iso(-3_600_000) };
    await editParty(W, p, { name: "Beta Yerel" });
    await sync(W, id, "CONTACTS");
    expect((await partyRow(p))?.name).toBe("Beta Yerel");
    expect(contact("7101").attributes.name).toBe("Beta Yerel");
    expect(await conflicts(W, p)).toEqual([{ winner: "ETKIN", basis: "NEWER_LOCAL", baseline: true }]);

    // Paraşüt daha yeni (bir saat ileride).
    const before = puts();
    contact("7101").attributes = { ...contact("7101").attributes, name: "Beta Uzak 2", updated_at: iso(3_600_000) };
    await editParty(W, p, { name: "Beta Yerel 2" });
    await sync(W, id, "CONTACTS");
    expect((await partyRow(p))?.name).toBe("Beta Uzak 2");
    expect(puts()).toBe(before);
    expect((await conflicts(W, p)).at(-1)).toEqual({ winner: "PARASUT", basis: "NEWER_REMOTE", baseline: true });

    // Paraşüt zamanı yok → Paraşüt kazanır, dayanak kaydedilir.
    const { updated_at: _drop, ...rest } = contact("7101").attributes;
    void _drop;
    contact("7101").attributes = { ...rest, name: "Beta Uzak 3" };
    await editParty(W, p, { name: "Beta Yerel 3" });
    await sync(W, id, "CONTACTS");
    expect((await partyRow(p))?.name).toBe("Beta Uzak 3");
    expect((await conflicts(W, p)).at(-1)).toEqual({ winner: "PARASUT", basis: "UNKNOWN_TIME", baseline: true });
    const summary = (await q<{ s: Record<string, unknown> }>("SELECT change_summary AS s FROM public.audit_logs WHERE tenant_id = $1 AND action = 'integration.conflict_resolved' AND entity_id = $2 LIMIT 1", [W.tenantId, p]))[0]?.s ?? {};
    expect(JSON.stringify(summary)).not.toMatch(/Beta|7101/);
  });

  it("ürün ve depo: yerel ad değişikliği yalnız ad olarak PUT ile gider", async () => {
    const W = await seedWorld(adm, reg, "T1140C");
    const id = await connect(W);
    const item = randomUUID();
    await adm.query("INSERT INTO public.items (tenant_id, id, code, name, base_unit_id, tracking_mode) VALUES ($1, $2, 'P-1140', 'Vida', $3, 'NONE')", [W.tenantId, item, W.unitId]);
    await link(W, "ITEM", item, "7201");
    fake.products.push({ id: "7201", attributes: { code: "P-1140", name: "Vida", unit: "adet", archived: false } });
    const wh = randomUUID();
    await adm.query("INSERT INTO public.warehouses (tenant_id, id, code, name) VALUES ($1, $2, 'D-1140', 'Yan Depo')", [W.tenantId, wh]);
    await link(W, "WAREHOUSE", wh, "7202");
    fake.warehouses.push({ id: "7202", attributes: { name: "Yan Depo", archived: false } });
    await flow(W, "PRODUCTS", "BOTH");
    await flow(W, "WAREHOUSES", "BOTH");
    await sync(W, id, "PRODUCTS");
    await sync(W, id, "WAREHOUSES");
    expect(puts()).toBe(0);
    expect(await updateItem(admin(W), { itemId: item, name: "Vida M8" })).toMatchObject({ changed: true });
    expect(await renameWarehouse(admin(W), { warehouseId: wh, name: "Yan Depo 2" })).toMatchObject({ changed: true });
    await sync(W, id, "PRODUCTS");
    await sync(W, id, "WAREHOUSES");
    expect(fake.updates).toEqual([
      { kind: "products", id: "7201", attributes: { name: "Vida M8" } },
      { kind: "warehouses", id: "7202", attributes: { name: "Yan Depo 2" } },
    ]);
    expect(fake.products[0]?.attributes).toMatchObject({ code: "P-1140", unit: "adet" });
  });

  it("ilk bağlama (PR 278 P2): koda / vergi numarasına göre bağlanan kartın adı farklıysa taban yazılmaz, çakışma kuralı işler; iki taraf eşitlenir", async () => {
    const W = await seedWorld(adm, reg, "T1140L");
    const id = await connect(W);
    // Ürün: koda göre bağlanır, adlar farklı, Paraşüt zamanı yok → Paraşüt kazanır (tabansız çakışma, audit'li).
    const item = randomUUID();
    await adm.query("INSERT INTO public.items (tenant_id, id, code, name, base_unit_id, tracking_mode) VALUES ($1, $2, 'P-LINK', 'Yerel Ad', $3, 'NONE')", [W.tenantId, item, W.unitId]);
    fake.products.push({ id: "7251", attributes: { code: "P-LINK", name: "Paraşüt Adı", unit: "adet", archived: false } });
    // Cari (zaman yok): vergi numarasına göre bağlanır → Paraşüt kazanır.
    const p1 = (await q<{ id: string }>("INSERT INTO public.parties (tenant_id, code, code_key, name, tax_no, created_by) VALUES ($1, 'C-L1', 'C-L1', 'Yerel Cari', '2222222222', $2) RETURNING id", [W.tenantId, W.ownerMembershipId]))[0]?.id as string;
    fake.contacts.push({ id: "7252", attributes: { name: "Paraşüt Cari", tax_number: "2222222222", account_type: "customer" } });
    // Cari (Etkin daha yeni): bağlanmadan önce Etkin'de düzeltildi, Paraşüt bir saat önce değişti → Etkin kazanır, PUT ile gider.
    const p2 = (await q<{ id: string }>("INSERT INTO public.parties (tenant_id, code, code_key, name, tax_no, created_by) VALUES ($1, 'C-L2', 'C-L2', 'Eski Ad', '3333333333', $2) RETURNING id", [W.tenantId, W.ownerMembershipId]))[0]?.id as string;
    await editParty(W, p2, { name: "Yerel Yeni" });
    fake.contacts.push({ id: "7253", attributes: { name: "Paraşüt Eski", tax_number: "3333333333", account_type: "customer", updated_at: iso(-3_600_000) } });
    await flow(W, "PRODUCTS", "BOTH");
    await flow(W, "CONTACTS", "BOTH");
    await sync(W, id, "PRODUCTS");
    await sync(W, id, "CONTACTS");
    const itemName = async () => (await q<{ name: string }>("SELECT name FROM public.items WHERE id = $1", [item]))[0]?.name;
    expect(await itemName()).toBe("Paraşüt Adı");
    expect(await conflicts(W, item)).toEqual([{ winner: "PARASUT", basis: "UNKNOWN_TIME", baseline: false }]);
    expect((await partyRow(p1))?.name).toBe("Paraşüt Cari");
    expect(await conflicts(W, p1)).toEqual([{ winner: "PARASUT", basis: "UNKNOWN_TIME", baseline: false }]);
    expect((await partyRow(p2))?.name).toBe("Yerel Yeni");
    expect(contact("7253").attributes.name).toBe("Yerel Yeni");
    expect(await conflicts(W, p2)).toEqual([{ winner: "ETKIN", basis: "NEWER_LOCAL", baseline: false }]);
    expect(fake.updates.filter((u) => u.id === "7251" || u.id === "7252")).toEqual([]);
    expect(await state(W, "ITEM", item)).toMatchObject({ marked: true });
    expect(await state(W, "PARTY", p1)).toMatchObject({ marked: true });
    // Kararlı: artık iki taraf eşit; sonraki koşular ne yazar ne gönderir, sonraki düzeltme yine gider.
    const n = puts();
    await sync(W, id, "PRODUCTS");
    await sync(W, id, "CONTACTS");
    expect(puts()).toBe(n);
    expect((await conflicts(W, item)).length + (await conflicts(W, p1)).length + (await conflicts(W, p2)).length).toBe(3);
    expect(await updateItem(admin(W), { itemId: item, name: "Yerel Ad 2" })).toMatchObject({ changed: true });
    await sync(W, id, "PRODUCTS");
    expect(fake.updates.at(-1)).toEqual({ kind: "products", id: "7251", attributes: { name: "Yerel Ad 2" } });
  });

  it("webhook aynı kuralı uygular: yerel daha yeniyse uygulanmaz (LOCAL_NEWER), Paraşüt daha yeniyse uygulanır", async () => {
    const W = await seedWorld(adm, reg, "T1140W");
    const id = await connect(W);
    fake.contacts.push({ id: "7301", attributes: { name: "Gama", account_type: "customer", updated_at: iso(-7_200_000) } });
    const p = await party(W, "C-GAMA", "Gama", "7301");
    await flow(W, "CONTACTS", "BOTH");
    await sync(W, id, "CONTACTS");
    const run = () => runWebhookEvent({ inTenant: inTenant(W), client: client(), sealer, consumeOnce: consumeOnce as unknown as ConsumeOnce, sleep: async () => undefined }, { integrationId: id, resource: "contact", externalId: "7301", eventKey: randomUUID() });
    contact("7301").attributes = { ...contact("7301").attributes, name: "Gama Uzak", updated_at: iso(-3_600_000) };
    await editParty(W, p, { name: "Gama Yerel" });
    expect(await run()).toEqual({ kind: "applied", outcome: "LOCAL_NEWER" });
    expect((await partyRow(p))?.name).toBe("Gama Yerel");
    contact("7301").attributes = { ...contact("7301").attributes, name: "Gama Uzak 2", updated_at: iso(3_600_000) };
    expect(await run()).toEqual({ kind: "applied", outcome: "UPDATED" });
    expect((await partyRow(p))?.name).toBe("Gama Uzak 2");
    expect((await conflicts(W, p)).at(-1)).toMatchObject({ winner: "PARASUT", basis: "NEWER_REMOTE" });
    expect(puts()).toBe(0);
  });
});

describe("(2) tek yönler ve kalıcı red", () => {
  it("Paraşüt'ten al: yerel düzeltme hiç gönderilmez; Etkin'den gönder: Paraşüt düzeltmesi hiç alınmaz, yerel düzeltme gider", async () => {
    const W = await seedWorld(adm, reg, "T1140D");
    const id = await connect(W);
    fake.contacts.push({ id: "7401", attributes: { name: "Delta", account_type: "customer" } });
    const p = await party(W, "C-DELTA", "Delta", "7401");
    await flow(W, "CONTACTS", "PULL");
    await sync(W, id, "CONTACTS");
    await editParty(W, p, { name: "Delta Yerel" });
    await sync(W, id, "CONTACTS");
    expect(puts()).toBe(0);
    expect((await partyRow(p))?.name).toBe("Delta"); // almada Paraşüt değeri geçerlidir

    await flow(W, "CONTACTS", "PUSH");
    contact("7401").attributes = { ...contact("7401").attributes, name: "Delta Uzak", updated_at: iso(0) };
    await sync(W, id, "CONTACTS");
    expect((await partyRow(p))?.name).toBe("Delta");
    expect(puts()).toBe(0);
    await editParty(W, p, { name: "Delta Yerel 2" });
    const listsBefore = fake.requests.filter((r) => r.method === "GET" && /\/contacts\?sort=id/.test(r.path)).length;
    await sync(W, id, "CONTACTS");
    expect(fake.updates.at(-1)).toEqual({ kind: "contacts", id: "7401", attributes: { name: "Delta Yerel 2" } });
    expect((await partyRow(p))?.name).toBe("Delta Yerel 2");
    expect(fake.requests.filter((r) => r.method === "GET" && /\/contacts\?sort=id/.test(r.path)).length).toBe(listsBefore); // PUSH katalog taramaz

    // İşaretsiz bağlı kart: PUSH önce karşılaştırır; iki taraf eşitse göndermez.
    fake.contacts.push({ id: "7402", attributes: { name: "Eşit Cari", account_type: "customer" } });
    await party(W, "C-ESIT", "Eşit Cari", "7402");
    const n = puts();
    await sync(W, id, "CONTACTS");
    expect(puts()).toBe(n);
  });

  it("kesin 4xx: kart bekletilir (FAILED UPDATE_REJECTED), sonraki koşu yeniden göndermez", async () => {
    const W = await seedWorld(adm, reg, "T1140E");
    const id = await connect(W);
    const wh = randomUUID();
    await adm.query("INSERT INTO public.warehouses (tenant_id, id, code, name) VALUES ($1, $2, 'D-RED', 'Red Depo')", [W.tenantId, wh]);
    await link(W, "WAREHOUSE", wh, "7501");
    fake.warehouses.push({ id: "7501", attributes: { name: "Red Depo" } });
    await flow(W, "WAREHOUSES", "BOTH");
    await sync(W, id, "WAREHOUSES");
    fake.updateFailure = 422;
    await renameWarehouse(admin(W), { warehouseId: wh, name: "Red Depo 2" });
    expect(await sync(W, id, "WAREHOUSES")).toMatchObject({ kind: "ran", flows: [{ status: "PARTIAL", counts: { failed: 1 } }] });
    expect(await q("SELECT entity_type, status, last_error_code FROM public.integration_outbox WHERE tenant_id = $1 AND entity_id = $2", [W.tenantId, wh])).toEqual([{ entity_type: "WAREHOUSE", status: "FAILED", last_error_code: "UPDATE_REJECTED" }]);
    const n = puts();
    await sync(W, id, "WAREHOUSES");
    expect(puts()).toBe(n);
  });
});

describe("(3) cari ve depo kaynak yaşam döngüsü", () => {
  it("cari: Paraşüt'te arşiv → boştaysa arşiv; yeniden etkin → geri açılır; kullanıcının kendi arşivi korunur", async () => {
    const W = await seedWorld(adm, reg, "T1140F");
    const id = await connect(W);
    fake.contacts.push({ id: "7601", attributes: { name: "Boş Cari", account_type: "customer", archived: false } });
    const p = await party(W, "C-BOS", "Boş Cari", "7601");
    await flow(W, "CONTACTS", "PULL");
    await sync(W, id, "CONTACTS");
    contact("7601").attributes.archived = true;
    await sync(W, id, "CONTACTS");
    expect((await partyRow(p))?.archived).toBe(true);
    expect(await state(W, "PARTY", p)).toMatchObject({ source_state: "ARCHIVED", source_disposition: "ARCHIVED", source_managed_archive: true });
    expect((await q<{ via: string }>("SELECT change_summary->>'via' AS via FROM public.audit_logs WHERE tenant_id = $1 AND action = 'party.archived' AND entity_id = $2", [W.tenantId, p]))[0]?.via).toBe("integration");
    contact("7601").attributes.archived = false;
    await sync(W, id, "CONTACTS");
    expect((await partyRow(p))?.archived).toBe(false);
    expect(await state(W, "PARTY", p)).toMatchObject({ source_state: "ACTIVE", source_disposition: "NONE", source_managed_archive: false });
    // Kullanıcı arşivledi: Paraşüt etkin kalsa da açılmaz.
    await adm.query("UPDATE public.parties SET archived_at = now() WHERE id = $1", [p]);
    await sync(W, id, "CONTACTS");
    expect((await partyRow(p))?.archived).toBe(true);
  });

  it("cari: açık siparişteyken PENDING (arşivlenmez), sipariş kapanınca arşivlenir; Paraşüt'te silinen ≥30 sn arayla iki yoklukla arşivlenir, fiziksel silme yok", async () => {
    const W = await seedWorld(adm, reg, "T1140G");
    const id = await connect(W);
    // Fikstürün açık siparişi `sentetik-musteri` koduna bağlıdır.
    fake.contacts.push({ id: "7701", attributes: { name: "Sentetik Müşteri", account_type: "customer", archived: false } });
    const busy = await party(W, "sentetik-musteri", "Sentetik Müşteri", "7701");
    fake.contacts.push({ id: "7702", attributes: { name: "Silinecek", account_type: "customer", archived: false } });
    const gone = await party(W, "C-SIL", "Silinecek", "7702");
    await flow(W, "CONTACTS", "PULL");
    await sync(W, id, "CONTACTS");
    contact("7701").attributes.archived = true;
    await sync(W, id, "CONTACTS");
    expect((await partyRow(busy))?.archived).toBe(false);
    expect(await state(W, "PARTY", busy)).toMatchObject({ source_state: "ARCHIVED", source_disposition: "PENDING" });
    await adm.query("UPDATE public.sales_orders SET status = 'CLOSED' WHERE tenant_id = $1", [W.tenantId]);
    await sync(W, id, "CONTACTS");
    expect((await partyRow(busy))?.archived).toBe(true);

    fake.contacts.splice(fake.contacts.findIndex((c) => c.id === "7702"), 1);
    const t = Date.now();
    await sync(W, id, "CONTACTS", t);
    expect((await partyRow(gone))?.archived).toBe(false);
    await sync(W, id, "CONTACTS", t + 10_000);
    expect((await partyRow(gone))?.archived).toBe(false);
    await sync(W, id, "CONTACTS", t + 31_000);
    expect((await partyRow(gone))?.archived).toBe(true);
    expect(await state(W, "PARTY", gone)).toMatchObject({ source_state: "DELETED", source_disposition: "ARCHIVED" });
    expect((await q<{ n: number }>("SELECT count(*)::int AS n FROM public.parties WHERE id = $1", [gone]))[0]?.n).toBe(1);
  });

  it("depo: boş depo arşivlenir ve yeniden etkin olunca geri açılır; etkin lokasyonlu / stoklu depo PENDING kalır", async () => {
    const W = await seedWorld(adm, reg, "T1140H");
    const id = await connect(W);
    const empty = randomUUID();
    await adm.query("INSERT INTO public.warehouses (tenant_id, id, code, name) VALUES ($1, $2, 'D-BOS', 'Boş Depo')", [W.tenantId, empty]);
    await link(W, "WAREHOUSE", empty, "7801");
    await link(W, "WAREHOUSE", W.warehouseId, "7802");
    const mainName = (await q<{ name: string }>("SELECT name FROM public.warehouses WHERE id = $1", [W.warehouseId]))[0]?.name as string;
    fake.warehouses.push({ id: "7801", attributes: { name: "Boş Depo", archived: false } }, { id: "7802", attributes: { name: mainName, archived: false } });
    await flow(W, "WAREHOUSES", "PULL");
    await sync(W, id, "WAREHOUSES");
    const ledger = async () => (await q<{ n: number }>("SELECT count(*)::int AS n FROM public.stock_ledger WHERE tenant_id = $1", [W.tenantId]))[0]?.n;
    const before = await ledger();
    for (const w of fake.warehouses) w.attributes.archived = true;
    await sync(W, id, "WAREHOUSES");
    const wh = async (x: string) => (await q<{ status: string }>("SELECT status FROM public.warehouses WHERE id = $1", [x]))[0]?.status;
    expect(await wh(empty)).toBe("ARCHIVED");
    expect(await state(W, "WAREHOUSE", empty)).toMatchObject({ source_disposition: "ARCHIVED", source_managed_archive: true });
    expect(await wh(W.warehouseId)).toBe("ACTIVE");
    expect(await state(W, "WAREHOUSE", W.warehouseId)).toMatchObject({ source_state: "ARCHIVED", source_disposition: "PENDING" });
    expect(await ledger()).toBe(before);
    for (const w of fake.warehouses) w.attributes.archived = false;
    await sync(W, id, "WAREHOUSES");
    expect(await wh(empty)).toBe("ACTIVE");
    expect(await state(W, "WAREHOUSE", W.warehouseId)).toMatchObject({ source_state: "ACTIVE", source_disposition: "NONE" });
    expect((await q("SELECT action FROM public.audit_logs WHERE tenant_id = $1 AND entity_id = $2 AND action IN ('warehouse.archived', 'warehouse.restored') ORDER BY occurred_at, id", [W.tenantId, empty])).map((r) => r.action)).toEqual(["warehouse.archived", "warehouse.restored"]);
  });
});

describe("(6) güvenlik incelemesi (PR 278 @ 4963bf3, MINOR-1…5) ve kiracı yönü", () => {
  it("MINOR-2: yerel zaman yalnız kanonik alanı değiştiren kayıttan; sonradan gelen ilgisiz audit Etkin'i kazandırmaz", async () => {
    const W = await seedWorld(adm, reg, "T1140M2");
    const id = await connect(W);
    fake.contacts.push({ id: "8001", attributes: { name: "Zeta", account_type: "customer", updated_at: iso(-7_200_000) } });
    const p = await party(W, "C-ZETA", "Zeta", "8001");
    await flow(W, "CONTACTS", "BOTH");
    await sync(W, id, "CONTACTS");
    await editParty(W, p, { name: "Zeta Yerel" }); // T1
    contact("8001").attributes = { ...contact("8001").attributes, name: "Zeta Uzak", updated_at: iso(1_000) }; // T2 > T1
    // T3 > T2: kanonik alanı değiştirmeyen kayıt (ör. arşiv/geri al) + başka bir kiracıdaki aynı kimlikli kayıt.
    const other = await seedWorld(adm, reg, "T1140M2B");
    await adm.query("INSERT INTO public.audit_logs (tenant_id, action, entity_type, entity_id, occurred_at) VALUES ($1, 'party.archived', 'party', $2, now() + interval '1 hour'), ($3, 'party.updated', 'party', $2, now() + interval '1 hour')", [W.tenantId, p, other.tenantId]);
    await sync(W, id, "CONTACTS");
    expect((await partyRow(p))?.name).toBe("Zeta Uzak");
    expect((await conflicts(W, p)).at(-1)).toMatchObject({ winner: "PARASUT", basis: "NEWER_REMOTE" });
    expect(puts()).toBe(0);
  });

  it("MINOR-3: kullanıcının geri açtığı / yeniden arşivlediği cari ve depo sistemce çevrilmez", async () => {
    const W = await seedWorld(adm, reg, "T1140M3");
    const id = await connect(W);
    fake.contacts.push({ id: "8101", attributes: { name: "Eta", account_type: "customer", archived: true } });
    const p = await party(W, "C-ETA", "Eta", "8101");
    const wh = randomUUID();
    await adm.query("INSERT INTO public.warehouses (tenant_id, id, code, name) VALUES ($1, $2, 'D-ETA', 'Eta Depo')", [W.tenantId, wh]);
    await link(W, "WAREHOUSE", wh, "8102");
    fake.warehouses.push({ id: "8102", attributes: { name: "Eta Depo", archived: true } });
    await flow(W, "CONTACTS", "PULL");
    await flow(W, "WAREHOUSES", "PULL");
    await sync(W, id, "CONTACTS");
    await sync(W, id, "WAREHOUSES");
    expect((await partyRow(p))?.archived).toBe(true);
    expect(await state(W, "PARTY", p)).toMatchObject({ source_managed_archive: true });
    // Kullanıcı geri açar: Paraşüt'te hâlâ arşivli olsa da sistem yeniden arşivlemez.
    const ver = async () => Number((await q<{ v: number }>("SELECT version AS v FROM public.parties WHERE id = $1", [p]))[0]?.v);
    await setPartyArchived(admin(W), { id: p, expectedVersion: await ver(), archived: false });
    expect(await state(W, "PARTY", p)).toMatchObject({ source_managed_archive: false });
    await sync(W, id, "CONTACTS");
    expect((await partyRow(p))?.archived).toBe(false);
    // Kullanıcı yeniden arşivler; Paraşüt'te etkin olunca açılmaz (kullanıcının arşivi).
    await setPartyArchived(admin(W), { id: p, expectedVersion: await ver(), archived: true });
    contact("8101").attributes.archived = false;
    await sync(W, id, "CONTACTS");
    expect((await partyRow(p))?.archived).toBe(true);
    // Depo: sistem arşivledi; kullanıcı arşivi sahiplenir → Paraşüt'te etkin olunca açılmaz.
    expect(await state(W, "WAREHOUSE", wh)).toMatchObject({ source_managed_archive: true });
    expect(await archiveWarehouse(admin(W), { warehouseId: wh })).toEqual({ archived: true });
    expect(await state(W, "WAREHOUSE", wh)).toMatchObject({ source_managed_archive: false });
    fake.warehouses[0]!.attributes.archived = false;
    await sync(W, id, "WAREHOUSES");
    expect((await q<{ status: string }>("SELECT status FROM public.warehouses WHERE id = $1", [wh]))[0]?.status).toBe("ARCHIVED");
  });

  it("MINOR-4: koşu ya da webhook sürerken yön değişirse eski yönle hiçbir şey yazılmaz / gönderilmez", async () => {
    const W = await seedWorld(adm, reg, "T1140M4");
    const id = await connect(W);
    fake.contacts.push({ id: "8201", attributes: { name: "Teta", account_type: "customer", updated_at: iso(-7_200_000) } });
    const p = await party(W, "C-TETA", "Teta", "8201");
    await flow(W, "CONTACTS", "BOTH");
    await sync(W, id, "CONTACTS");
    await editParty(W, p, { name: "Teta Yerel" });
    contact("8201").attributes = { ...contact("8201").attributes, name: "Teta Uzak", updated_at: iso(-3_600_000) };
    // Sync: katalog okunurken kullanıcı yönü "Paraşüt'ten al"a çevirir.
    const c = client();
    const list = c.list.bind(c);
    c.list = async (...a) => {
      const r = await list(...a);
      await q("UPDATE public.integration_flows SET direction = 'PULL' WHERE tenant_id = $1 AND flow = 'CONTACTS'", [W.tenantId]);
      return r;
    };
    const r = await runIntegrationSync({ inTenant: inTenant(W), client: c, sealer }, { integrationId: id, flow: "CONTACTS", trigger: "MANUAL" }, W.ownerUserId);
    expect(r).toMatchObject({ kind: "ran", flows: [{ status: "FAILED", errorCode: "FLOW_CHANGED" }] });
    expect(puts()).toBe(0);
    expect((await partyRow(p))?.name).toBe("Teta Yerel");
    // Webhook: Paraşüt okunurken yön BOTH → PULL; işin başındaki yönle yazılmaz.
    await q("UPDATE public.integration_flows SET direction = 'BOTH' WHERE tenant_id = $1 AND flow = 'CONTACTS'", [W.tenantId]);
    const wc = client();
    const read = wc.contact.bind(wc);
    wc.contact = async (...a) => {
      const x = await read(...a);
      await q("UPDATE public.integration_flows SET direction = 'PULL' WHERE tenant_id = $1 AND flow = 'CONTACTS'", [W.tenantId]);
      return x;
    };
    const w = await runWebhookEvent({ inTenant: inTenant(W), client: wc, sealer, consumeOnce: consumeOnce as unknown as ConsumeOnce, sleep: async () => undefined }, { integrationId: id, resource: "contact", externalId: "8201", eventKey: randomUUID() });
    expect(w).toEqual({ kind: "skipped", reason: "NOT_CONNECTED" });
    expect((await partyRow(p))?.name).toBe("Teta Yerel");
  });

  it("MINOR-5: Paraşüt'te bulunmayan bağlı kart her koşuda yeniden sorulmaz (BOTH imza yenilenir, PUSH bekletilir)", async () => {
    const W = await seedWorld(adm, reg, "T1140M5");
    const id = await connect(W);
    const gone = await party(W, "C-YOK", "Yok Cari", "8301");
    await flow(W, "CONTACTS", "BOTH");
    const asked = () => fake.requests.filter((r) => r.method === "GET" && r.path === "/v4/115/contacts/8301").length;
    await sync(W, id, "CONTACTS");
    const after1 = asked();
    expect(after1).toBeGreaterThan(0);
    await sync(W, id, "CONTACTS");
    // İkinci koşuda yalnız yaşam döngüsü (iki yokluk) sorar; düzeltme turu tekrar sormaz.
    expect(asked() - after1).toBeLessThanOrEqual(1);
    const p2 = await party(W, "C-YOK2", "Yok Cari 2", "8302");
    await flow(W, "CONTACTS", "PUSH");
    await sync(W, id, "CONTACTS");
    expect(await q("SELECT status, last_error_code FROM public.integration_outbox WHERE tenant_id = $1 AND entity_id = $2", [W.tenantId, p2])).toEqual([{ status: "FAILED", last_error_code: "REMOTE_NOT_FOUND" }]);
    const n = fake.requests.filter((r) => r.path === "/v4/115/contacts/8302").length;
    await sync(W, id, "CONTACTS");
    expect(fake.requests.filter((r) => r.path === "/v4/115/contacts/8302").length).toBe(n);
    expect((await q<{ sig: boolean }>("SELECT local_sig IS NOT NULL AS sig FROM public.integration_card_states WHERE tenant_id = $1 AND entity_id = $2", [W.tenantId, gone]))[0]?.sig).toBe(true);
  });

  it("MINOR-A: BOTH'ta yerel düzeltme + geçici 404 + kart geri gelir → düzeltme yine Paraşüt'e gider (kaybolmaz)", async () => {
    const W = await seedWorld(adm, reg, "T1140MA");
    const id = await connect(W);
    fake.contacts.push({ id: "8501", attributes: { name: "Kappa", account_type: "customer", updated_at: iso(-7_200_000) } });
    const p = await party(W, "C-KAPPA", "Kappa", "8501");
    await flow(W, "CONTACTS", "BOTH");
    await sync(W, id, "CONTACTS");
    await editParty(W, p, { name: "Kappa Yerel" });
    const saved = fake.contacts.splice(fake.contacts.findIndex((c) => c.id === "8501"), 1);
    await sync(W, id, "CONTACTS"); // düzeltme turu 404 görür → imza yenilenir; yaşam döngüsü ilk yokluğu yazar
    expect(fake.updates).toEqual([]);
    fake.contacts.push(...saved);
    await sync(W, id, "CONTACTS"); // tarama kartı görür, yerel taraf kazanır (DEFERRED) → aynı koşunun düzeltme turunda gider
    expect(fake.updates).toEqual([{ kind: "contacts", id: "8501", attributes: { name: "Kappa Yerel" } }]);
    expect(contact("8501").attributes.name).toBe("Kappa Yerel");
    expect((await partyRow(p))?.name).toBe("Kappa Yerel");
    const n = puts();
    await sync(W, id, "CONTACTS");
    expect(puts()).toBe(n);
  });

  it("kiracı A'nın koşusu kiracı B'nin dış kimliğine asla PUT göndermez", async () => {
    const A = await seedWorld(adm, reg, "T1140NA");
    const B = await seedWorld(adm, reg, "T1140NB");
    const idA = await connect(A);
    fake.contacts.push({ id: "8401", attributes: { name: "A Cari", account_type: "customer" } }, { id: "8402", attributes: { name: "B Cari", account_type: "customer" } });
    const pa = await party(A, "C-NA", "A Cari", "8401");
    const pb = await party(B, "C-NB", "B Cari", "8402");
    // B'de düzeltilmiş, işaretli ama imzası eski kart: kiracı süzgeci olmasa aday olurdu.
    await adm.query("UPDATE public.parties SET name = 'B Yerel' WHERE id = $1", [pb]);
    await adm.query("INSERT INTO public.integration_card_states (tenant_id, system, entity_type, entity_id, local_hash, remote_hash, local_sig, synced_at) VALUES ($1, 'PARASUT', 'PARTY', $2, $3, $3, $4, now())", [B.tenantId, pb, "a".repeat(64), "b".repeat(32)]);
    await flow(A, "CONTACTS", "BOTH");
    await sync(A, idA, "CONTACTS");
    await editParty(A, pa, { name: "A Yerel" });
    await sync(A, idA, "CONTACTS");
    expect(fake.updates.map((u) => u.id)).toEqual(["8401"]);
    expect(fake.requests.some((r) => r.path.includes("/contacts/8402"))).toBe(false);
    expect(await q("SELECT local_sig FROM public.integration_card_states WHERE tenant_id = $1 AND entity_id = $2", [B.tenantId, pb])).toEqual([{ local_sig: "b".repeat(32) }]);
  });
});

describe("(4) stok toplamı", () => {
  it("arşivli raftaki stok Paraşüt toplamına girmez", async () => {
    const W = await seedWorld(adm, reg, "T1140S");
    const id = await connect(W);
    await link(W, "ITEM", W.itemNoneId, "7901");
    await link(W, "WAREHOUSE", W.warehouseId, "7902");
    const shelf = randomUUID();
    const dim = randomUUID();
    await adm.query("BEGIN");
    try {
      await adm.query("SELECT set_config('app.current_tenant_id', $1, true)", [W.tenantId]);
      await adm.query("INSERT INTO public.locations (tenant_id, id, warehouse_id, parent_id, code, name, depth, kind) VALUES ($1, $2, $3, NULL, 'ARS', 'Arşiv raf', 0, 'STORAGE')", [W.tenantId, shelf, W.warehouseId]);
      await adm.query("INSERT INTO public.stock_dimensions (tenant_id, id, item_id, location_id) VALUES ($1, $2, $3, $4)", [W.tenantId, dim, W.itemNoneId, shelf]);
      await adm.query("INSERT INTO public.stock_ledger (tenant_id, id, document_id, document_line_id, stock_dimension_id, quantity, reason, business_date, actor_user_id) VALUES ($1, $2, $3, $4, $5, 6, 'T1140 fikstur', '2026-10-31', $6)", [W.tenantId, randomUUID(), W.documentId, W.documentLineNoneId, dim, W.ownerUserId]);
      await adm.query("INSERT INTO public.stock_balances (tenant_id, stock_dimension_id, quantity) VALUES ($1, $2, 6)", [W.tenantId, dim]);
      await adm.query("UPDATE public.locations SET status = 'ARCHIVED', archived_at = now() WHERE tenant_id = $1 AND id = $2", [W.tenantId, shelf]);
      await adm.query("COMMIT");
    } catch (e) {
      await adm.query("ROLLBACK");
      throw e;
    }
    const doc = randomUUID();
    await adm.query(
      `INSERT INTO public.documents (tenant_id, id, kind, type_version_id, warehouse_id, business_date, created_by, reason, status, number)
       SELECT $1, $2, 'STOCK_IN', id, $3, '2026-10-30', $4, 'import.opening_stock', 'POSTED', 'DVR-1140' FROM public.document_type_versions WHERE tenant_id IS NULL AND key = 'STOCK_IN' AND version = 1`,
      [W.tenantId, doc, W.warehouseId, W.ownerUserId],
    );
    expect(await setIntegrationFlow(admin(W), { provider: "PARASUT", flow: "STOCK", enabled: true, direction: "PUSH" })).toMatchObject({ ok: true });
    expect(await sync(W, id, "STOCK")).toMatchObject({ kind: "ran", flows: [{ flow: "STOCK", status: "SUCCESS" }] });
    const raw = fake.requests.find((x) => x.path === "/v4/115/stock_updates")?.body ?? "";
    expect(raw).toContain('"new_total_inventory":10'); // kök raf 10; arşivli raftaki 6 yok
    expect(raw).not.toContain('"new_total_inventory":16');
  });
});

describe("(5) kiracı yalıtımı", () => {
  it("işaret / yaşam döngüsü satırı başka kiracıdan görünmez ve yazılamaz; bir kiracının koşusu ötekine dokunmaz", async () => {
    const A = await seedWorld(adm, reg, "T1140IA");
    const B = await seedWorld(adm, reg, "T1140IB");
    const idA = await connect(A);
    fake.contacts.push({ id: "7951", attributes: { name: "Yalıtım", account_type: "customer", archived: false } });
    const pa = await party(A, "C-YAL", "Yalıtım", "7951");
    const pb = (await q<{ id: string }>("INSERT INTO public.parties (tenant_id, code, code_key, name, created_by) VALUES ($1, 'C-YAL', 'C-YAL', 'Yalıtım', $2) RETURNING id", [B.tenantId, B.ownerMembershipId]))[0]?.id as string;
    await flow(A, "CONTACTS", "BOTH");
    await sync(A, idA, "CONTACTS");
    expect(await state(A, "PARTY", pa)).toMatchObject({ marked: true });
    expect(await q("SELECT 1 FROM public.integration_card_states WHERE tenant_id = $1", [B.tenantId])).toEqual([]);
    await appPg.query("BEGIN");
    try {
      await appPg.query("SELECT set_config('app.current_tenant_id', $1, true)", [B.tenantId]);
      expect((await appPg.query("SELECT 1 FROM public.integration_card_states WHERE tenant_id = $1", [A.tenantId])).rowCount).toBe(0);
      expect((await appPg.query("UPDATE public.integration_card_states SET local_sig = NULL WHERE tenant_id = $1", [A.tenantId])).rowCount).toBe(0);
      await expect(appPg.query("INSERT INTO public.integration_card_states (tenant_id, system, entity_type, entity_id) VALUES ($1, 'PARASUT', 'PARTY', $2)", [A.tenantId, pa])).rejects.toMatchObject({ code: "42501" });
    } finally {
      await appPg.query("ROLLBACK");
    }
    await appPg.query("BEGIN");
    try {
      await appPg.query("SELECT set_config('app.current_tenant_id', $1, true)", [A.tenantId]);
      await expect(appPg.query("DELETE FROM public.integration_card_states WHERE tenant_id = $1", [A.tenantId])).rejects.toMatchObject({ code: "42501" });
    } finally {
      await appPg.query("ROLLBACK");
    }
    contact("7951").attributes.archived = true;
    await sync(A, idA, "CONTACTS");
    expect((await partyRow(pa))?.archived).toBe(true);
    expect((await partyRow(pb))?.archived).toBe(false);
  });
});
