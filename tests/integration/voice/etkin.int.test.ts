// T-1002 (B-62): Etkin sesli komut — gerçek DB'de eşleştirme RLS/kiracı yalıtımı (başka kiracının ürünü/rafı eşleşmez), yetkisiz (üye olmayan)
// kullanıcı reddi ve kullanıcı başına "voice" hız sınırı (paylaşılan DB sayacı). Ses servisi gerekmez: metin doğrudan verilir.
import pg from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { answerVoiceCommand, loadVoiceCatalog } from "../../../packages/domain/src/voice/index.ts";
import { createDbRateLimitStore, createRateLimiter, RATE_LIMITS } from "../../../apps/web/lib/rate-limit.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";

const env = readIntEnv(process.env);
let app: DbClient, adm: pg.Client, A: TenantWorld, B: TenantWorld;
let secretItemId: string;
const params = (w: TenantWorld, userId = w.ownerUserId) => ({ db: app, principal: { userId, mfaVerified: true }, tenantSlug: w.slug });

beforeAll(async () => {
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  await adm.connect();
  const reg = newRegistry();
  A = await seedWorld(adm, reg, "VOICE1002A");
  B = await seedWorld(adm, reg, "VOICE1002B");
  secretItemId = randomUUID();
  await adm.query(
    "INSERT INTO public.items (tenant_id, id, code, name, base_unit_id, tracking_mode) VALUES ($1, $2, 'GZL-77', 'Gizli kauçuk bant', $3, 'NONE')",
    [B.tenantId, secretItemId, B.unitId],
  );
}, 120000);
afterAll(async () => {
  await adm.end();
  await app.close();
});

describe("Etkin eşleştirme kiracı yalıtımı", () => {
  it("başka kiracının ürünü eşleşmez; kendi kiracısında eşleşir", async () => {
    const inA = await answerVoiceCommand(params(A), "Stokta kaç tane gizli kauçuk bant var");
    expect(inA).toMatchObject({ type: "read", rows: [], empty: "item" });
    const inB = await answerVoiceCommand(params(B), "Stokta kaç tane gizli kauçuk bant var");
    expect(inB).toMatchObject({ type: "read", title: "Gizli kauçuk bant", rows: [{ title: "Gizli kauçuk bant" }] });
  });

  it("aday listeleri yalnız kendi kiracısının satırları (aynı raf kodu iki kiracıda da var)", async () => {
    const cat = await loadVoiceCatalog(params(A), { items: true, locations: true, warehouses: true, parties: true, people: true, orders: true });
    expect(cat.items.some((i) => i.id === secretItemId)).toBe(false);
    expect(cat.locations.map((l) => l.id).sort()).toEqual([A.rootLocationId, A.childLocationId].sort());
    expect(cat.warehouses.map((w) => w.id)).toEqual([A.warehouseId]);
    const write = await answerVoiceCommand(params(A), "Beş adet ürün üç Z bir R bir rafına koy");
    expect(write).toMatchObject({ type: "write", op: "stockIn", draft: { locationId: A.childLocationId, warehouseId: A.warehouseId } });
  });

  it("üye olmayan kullanıcı başka kiracının adıyla sorgulayamaz", async () => {
    await expect(answerVoiceCommand(params(A, B.ownerUserId), "C bir rafında ne var")).rejects.toMatchObject({ code: expect.stringMatching(/^(FORBIDDEN|NOT_FOUND)$/) });
    await expect(loadVoiceCatalog(params(A, B.ownerUserId), { items: true })).rejects.toMatchObject({ code: expect.stringMatching(/^(FORBIDDEN|NOT_FOUND)$/) });
  });
});

describe("Etkin hız sınırı (kullanıcı başına, paylaşılan DB sayacı)", () => {
  it("dakikada 20 konuşma; 21. RATE_LIMITED; başka kullanıcı etkilenmez", async () => {
    const now = new Date();
    const limiter = createRateLimiter({ store: createDbRateLimitStore(app), secret: randomBytes(32).toString("hex"), now: () => now });
    const user = `voice-${randomUUID()}`;
    expect(RATE_LIMITS.voice.limit).toBe(20);
    for (let i = 0; i < 20; i++) await limiter.check("voice", user);
    await expect(limiter.check("voice", user)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(limiter.check("voice", `voice-${randomUUID()}`)).resolves.toBeUndefined();
  });
});

// T-1106: doğal sesle okuma kendi kovasında — dakikada 30 cümle; konuşma (voice) kovasını tüketmez.
describe("Etkin sesli okuma hız sınırı (tts kovası)", () => {
  it("dakikada 30 okuma; 31. RATE_LIMITED; voice kovası ayrı", async () => {
    const now = new Date();
    const limiter = createRateLimiter({ store: createDbRateLimitStore(app), secret: randomBytes(32).toString("hex"), now: () => now });
    const user = `tts-${randomUUID()}`;
    expect(RATE_LIMITS.tts.limit).toBe(30);
    for (let i = 0; i < 30; i++) await limiter.check("tts", user);
    await expect(limiter.check("tts", user)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(limiter.check("voice", user)).resolves.toBeUndefined();
  });
});
