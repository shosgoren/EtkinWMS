// T-407 (ADR-027 §6, §9; 0046): satış sayfası içeriği — panelden düzenle, süreli önizle, yayınla; satış sitesi son yayını okur.
// Gerçek wms_app bağlantısı; migration rolü yalnız kurulum/doğrulama. Kabul:
// - okuma/kaydetme/yayın/önizleme yalnız operatör (DB listesi + MFA); uygulama rolü içerik tablolarını okuyamaz;
// - metin düz metin: `<` `>` ve denetim karakteri, uzunluk aşımı, var olmayan paket reddedilir;
// - taslak sitede görünmez; geçerli önizleme sırrı taslağı gösterir, süresi geçmiş/biçimsiz sır yayını gösterir;
// - yayın sürümlü ve değişmez; fiyat bölümünde yalnız seçili ve YAYINDAKİ paketler; güvenlik olaylarına metin yazılmaz.
// İçerik tablosu paylaşılan DB'de tekildir (tek taslak); bu dosya sırayla koşar. Fikstürler sentetik (G-09).
import { randomBytes } from "node:crypto";
import pg from "pg";
import { sql } from "../../../packages/db/node_modules/drizzle-orm/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient, withTenant } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, createTenantContext, type DbClient } from "../../../packages/db/src/client.ts";
import { AppError } from "../../../packages/shared/src/errors.ts";
import { savePlan } from "../../../packages/domain/src/platform/plans.ts";
import { createSitePreview, getPublicSite, getSiteContent, previewHash, saveSiteContent } from "../../../packages/domain/src/platform/site-content.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";

const env = readIntEnv(process.env);
const reg = newRegistry();
const ok = async (): Promise<void> => undefined;
let app: DbClient;
let adm: pg.Client;
let A: TenantWorld;
let operatorId: string;
let operatorEmail: string;
const planIds: string[] = [];
let shown: string;
let hidden: string;

const op = () => ({ db: app, principal: { userId: operatorId, mfaVerified: true }, recentAuth: ok });
const tag = (): string => randomBytes(3).toString("hex");

function content(over: Partial<{ title1: string; title2: string; subtitle: string; planIds: string[] }> = {}) {
  return {
    title1: over.title1 ?? `T407 başlık ${tag()}`,
    title2: over.title2 ?? "en kolay hali.",
    subtitle: over.subtitle ?? "Mal kabulden sevkiyata her iş telefonda.",
    planIds: over.planIds ?? [shown, hidden],
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

beforeAll(async () => {
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  await adm.connect();
  A = await seedWorld(adm, reg, "A407");
  operatorEmail = `t407-op-${randomBytes(6).toString("hex")}@example.test`;
  const u = await adm.query<{ id: string }>(
    "INSERT INTO public.users (name, email, email_verified, two_factor_enabled) VALUES ('T407 op', $1, true, true) RETURNING id",
    [operatorEmail],
  );
  operatorId = (u.rows[0] as { id: string }).id;
  await adm.query("INSERT INTO wms_platform.operators (email_normalized) VALUES ($1)", [operatorEmail]);
  const plan = (name: string, published: boolean) => ({
    name,
    price: "1490.5",
    limits: { admins: 2, field: 0, warehouses: 1, items: 500 },
    features: { qr: true, ship: true, prod: false, api: false },
    published,
    recommended: false,
  });
  shown = (await savePlan({ ...op(), plan: plan(`T407 yayında ${tag()}`, true) })).id;
  hidden = (await savePlan({ ...op(), plan: plan(`T407 taslak ${tag()}`, false) })).id;
  planIds.push(shown, hidden);
}, 120_000);

afterAll(async () => {
  await adm.query("UPDATE wms_platform.plans SET recommended = false, published = false WHERE id = ANY($1::uuid[])", [planIds]).catch(() => undefined);
  await adm.query("DELETE FROM wms_platform.site_previews WHERE created_by = $1", [operatorId]).catch(() => undefined);
  await adm.query("DELETE FROM wms_platform.operators WHERE email_normalized = $1", [operatorEmail]).catch(() => undefined);
  await adm.end();
  await app.close();
}, 60_000);

describe("satış sayfası içeriği", () => {
  it("yalnız operatör: üye NOT_FOUND; MFA'sız MFA_REQUIRED; uygulama rolü içerik tablolarını okuyamaz", async () => {
    const member = { db: app, principal: { userId: A.ownerUserId, mfaVerified: true }, recentAuth: ok };
    expect((await failure(getSiteContent(member))).code).toBe("NOT_FOUND");
    expect((await failure(saveSiteContent({ ...member, content: content(), publish: true }))).code).toBe("NOT_FOUND");
    expect((await failure(createSitePreview({ ...member, content: content() }))).code).toBe("NOT_FOUND");
    expect((await failure(getSiteContent({ db: app, principal: { userId: operatorId, mfaVerified: false } }))).detail).toBe("MFA_REQUIRED");
    for (const t of ["wms_platform.site_content", "wms_platform.site_previews"]) {
      const raw = await withTenant(createTenantContext(app, A.tenantId), (tx) => tx.execute(sql.raw(`SELECT * FROM ${t}`))).then(
        () => "ok",
        (err: unknown) => String((err as { cause?: { code?: unknown } }).cause?.code ?? (err as { code?: unknown }).code),
      );
      expect(raw, t).toBe("42501");
    }
    // Yakın zamanda doğrulama yoksa yazma yok.
    const reauth = await failure(
      saveSiteContent({ ...op(), recentAuth: () => Promise.reject(Object.assign(new Error("x"), { reason: "REAUTH_REQUIRED" })), content: content(), publish: false }),
    );
    expect([reauth.code, reauth.detail]).toEqual(["UNAUTHENTICATED", "RECENT_AUTH_REQUIRED"]);
  });

  it("metin düz metin: köşeli ayraç, denetim karakteri, uzunluk ve var olmayan paket reddedilir", async () => {
    for (const bad of [
      content({ title1: "<script>alert(1)</script>" }),
      content({ title2: "a>b" }),
      content({ subtitle: "satır\u0007zil" }),
      content({ title1: "x".repeat(81) }),
      content({ subtitle: "" }),
      content({ title2: " " }),
      content({ planIds: ["not-a-uuid"] }),
    ]) {
      expect((await failure(saveSiteContent({ ...op(), content: bad, publish: false }))).code).toBe("VALIDATION_FAILED");
    }
    // Biçimi geçerli ama var olmayan paket: veritabanı işlevi reddeder (22023).
    const ghost = await failure(saveSiteContent({ ...op(), content: content({ planIds: ["00000000-0000-4000-8000-000000000407"] }), publish: false }));
    expect(ghost.code).toBe("VALIDATION_FAILED");
    // Veritabanı kuralı da aynı: işlev atlanıp doğrudan yazılsa bile `<` kabul edilmez.
    const direct = await adm.query("INSERT INTO wms_platform.site_content (version, title1, title2, subtitle) VALUES (100000, '<b>', 'y', 'x')").then(
      () => "ok",
      (e: { code?: string }) => e.code,
    );
    expect(direct).toBe("23514");
  });

  it("taslak sitede görünmez; önizleme taslağı gösterir; yayınla → site yeni içeriği ve yalnız yayındaki paketi gösterir", async () => {
    const before = await getPublicSite(app, null);
    const draft = content({ title1: `T407 taslak ${tag()}` });
    const saved = await saveSiteContent({ ...op(), content: draft, publish: false });
    expect(saved.published).toBe(false);
    const state = await getSiteContent({ db: app, principal: { userId: operatorId, mfaVerified: true } });
    expect(state).toMatchObject({ version: saved.version, draft: true, title1: draft.title1, title2: draft.title2, subtitle: draft.subtitle });
    expect([...(state?.planIds ?? [])].sort()).toEqual([shown, hidden].sort());
    // Site hâlâ önceki yayını gösterir (taslak sızmaz).
    expect((await getPublicSite(app, null))?.version ?? null).toBe(before?.version ?? null);

    const pv = await createSitePreview({ ...op(), content: draft });
    expect(pv.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pv.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 60_000);
    expect(pv.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000 + 5_000);
    const viaPreview = await getPublicSite(app, pv.token);
    expect(viaPreview).toMatchObject({ preview: true, version: saved.version, title1: draft.title1 });
    // Sır veritabanında yalnız özet olarak durur.
    const stored = await adm.query<{ token_hash: string }>("SELECT token_hash FROM wms_platform.site_previews WHERE created_by = $1", [operatorId]);
    expect(stored.rows.map((r) => r.token_hash)).toContain(previewHash(pv.token));
    expect(JSON.stringify(stored.rows)).not.toContain(pv.token);
    // Biçimsiz ya da bilinmeyen sır: yayındaki içerik.
    for (const t of ["kisa", randomBytes(32).toString("base64url"), `${pv.token}x`]) {
      expect((await getPublicSite(app, t))?.preview ?? false).toBe(false);
    }

    const pub = await saveSiteContent({ ...op(), content: draft, publish: true });
    expect(pub).toEqual({ version: saved.version, published: true });
    const site = await getPublicSite(app, null);
    expect(site).toMatchObject({ preview: false, version: saved.version, title1: draft.title1, title2: draft.title2, subtitle: draft.subtitle });
    // Fiyat bölümü: seçili iki paketten yalnız yayındaki; fiyat ve sınırlar güncel sürümden.
    expect(site?.plans.map((p) => p.price)).toEqual(["1490.50"]);
    expect(site?.plans[0]).toMatchObject({ recommended: false, limits: { admins: 2, field: 0, warehouses: 1, items: 500 }, features: { qr: true, ship: true, prod: false, api: false } });
    const after = await getSiteContent({ db: app, principal: { userId: operatorId, mfaVerified: true } });
    expect(after).toMatchObject({ draft: false, version: saved.version, publishedVersion: saved.version });
  });

  it("yayınlanmış sürüm değişmez; yeni kayıt yeni sürüm açar; süresi geçmiş önizleme yayını gösterir; paket yayından kalkınca sitede görünmez", async () => {
    const live = await getPublicSite(app, null);
    expect(live).not.toBeNull();
    const v = live?.version as number;
    const upd = await adm.query("UPDATE wms_platform.site_content SET title1 = 'değişti' WHERE version = $1", [v]).then(
      () => "ok",
      (e: { code?: string }) => e.code,
    );
    expect(upd).toBe("55000");
    const del = await adm.query("DELETE FROM wms_platform.site_content WHERE version = $1", [v]).then(
      () => "ok",
      (e: { code?: string }) => e.code,
    );
    expect(del).toBe("55000");

    const next = await saveSiteContent({ ...op(), content: content({ title1: `T407 yeni ${tag()}` }), publish: false });
    expect(next.version).toBe(v + 1);
    const pv = await createSitePreview({ ...op(), content: content({ title1: `T407 önizleme ${tag()}` }) });
    expect((await getPublicSite(app, pv.token))?.version).toBe(v + 1);
    await adm.query(
      "UPDATE wms_platform.site_previews SET created_at = now() - interval '1 hour', expires_at = now() - interval '31 minutes' WHERE token_hash = $1",
      [previewHash(pv.token)],
    );
    expect(await getPublicSite(app, pv.token)).toMatchObject({ preview: false, version: v });

    await adm.query("UPDATE wms_platform.plans SET published = false WHERE id = $1", [shown]);
    expect((await getPublicSite(app, null))?.plans).toEqual([]);
    await adm.query("UPDATE wms_platform.plans SET published = true WHERE id = $1", [shown]);
  });

  it("güvenlik olayları sürüm numarası taşır, metin taşımaz", async () => {
    const title1 = `T407 olay ${tag()}`;
    const r = await saveSiteContent({ ...op(), content: content({ title1 }), publish: true });
    const ev = await adm.query<{ event_type: string; detail: Record<string, unknown> }>(
      "SELECT event_type, detail FROM public.security_events WHERE user_id = $1 AND event_type LIKE 'platform.site.%' ORDER BY occurred_at",
      [operatorId],
    );
    const types = new Set(ev.rows.map((e) => e.event_type));
    expect([...types].sort()).toEqual(["platform.site.preview", "platform.site.published", "platform.site.saved"]);
    expect(ev.rows.some((e) => e.event_type === "platform.site.published" && e.detail.version === r.version)).toBe(true);
    expect(JSON.stringify(ev.rows)).not.toContain(title1);
  });
});
