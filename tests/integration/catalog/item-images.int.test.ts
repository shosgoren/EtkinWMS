// T-1160 (0074): ürün görseli, min / maks stok ve birim dönüşümü kaldırma. Gerçek wms_app bağlantısı + RLS; fikstür migration rolüyle (adm).
// Route katmanında yalnız kimlik çözümü taklit edilir (`lib/auth-service`, `getAppDb`); sarmalayıcı, yetki, RLS, sayaç, görsel işleme
// (`sharp`) ve domain GERÇEKTİR. Veriler sentetik (G-09).
// Senaryolar: ekle (ilk görsel kapak) / aynı bayt tekrar (idempotent) / değiştir / sil → kapak devri / geri al / kapak yap / 5 sınırı /
// boşaltılmış görsel geri açılamaz; audit (I-12); yetki (PICKER yok, gruptan `items.edit` MFA ister); çapraz tenant (I-01…I-03) ve DB
// bekçileri (DELETE yok, bayt değişmez, imzasız bayt yok); route: JPEG kabul + EXIF silinir, SVG / sahte imza / 5 MiB üstü ret, B'nin
// görseli A'dan 404, yanıt başlıkları; min / maks (≥ 0, ölçek, min ≤ maks, depo kapsamı, idempotent); dönüşüm kaldırma (kullanılmayan
// silinir + Geri al, belge / barkod kullanıyorsa IN_USE, DB bekçisi ham DELETE'i atlar).
import { createRequire } from "node:module";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDbClient, withSystemTenant } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { AppError } from "../../../packages/shared/src/errors.ts";
import {
  addBarcode,
  addItemImage,
  getItemImage,
  listItemConversions,
  listItemImages,
  listItemMainThumbs,
  listItemStockPolicies,
  purgeRemovedItemImages,
  removeItemImage,
  removeUnitConversion,
  restoreItemImage,
  setItemImageMain,
  setItemStockPolicy,
  setUnitConversion,
  type ProcessedItemImage,
} from "../../../packages/domain/src/catalog/index.ts";
import { mkMembership, mkUser, newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv, redactErrorChain } from "../harness/env.ts";

const h = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../../packages/db/src/index.ts", async (orig) => ({ ...(await orig<Record<string, unknown>>()), getAppDb: () => h.db }));
vi.mock("../../../apps/web/lib/auth-service.ts", () => ({
  ensureRecentAuth: () => Promise.resolve(),
  getAuthService: () => ({
    getPrincipal: (headers: Headers) => {
      const u = headers.get("x-test-user");
      return Promise.resolve(u === null ? null : { userId: u, mfaVerified: headers.get("x-test-mfa") !== "0" });
    },
  }),
}));

// `sharp` yalnız web uygulamasının bağımlılığıdır: o paketin çözümleyicisiyle yüklenir (test görselleri üretmek için).
const webRequire = createRequire(path.resolve(import.meta.dirname, "../../../apps/web/package.json"));
const sharp = webRequire("sharp") as typeof import("../../../apps/web/node_modules/sharp/dist/index.d.mts").default;

const env = readIntEnv(process.env);
const reg = newRegistry();
const ORIGIN = "https://app.example.test";
const rnd = (): string => randomBytes(4).toString("hex");

let app: DbClient;
let adm: pg.Client;
let A: TenantWorld;
let B: TenantWorld;
let editorUserId: string;

const as = (w: TenantWorld, userId: string, mfaVerified = true) => ({ db: app, principal: { userId, mfaVerified }, tenantSlug: w.slug });
const admin = (w: TenantWorld) => as(w, w.ownerUserId);

async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return `${e.code}/${e.detail ?? ""}`;
    throw e;
  }
  return "OK";
}

/** Gerçek (yeniden kodlanmış biçimde) WebP + küçük resim; tohum farklıysa (kayıpsız kodlama, belirgin renk farkı) baytlar farklı. */
async function webpImage(seed: number, w = 64, hgt = 48): Promise<ProcessedItemImage> {
  const background = { r: (seed * 37) % 256, g: (seed * 91 + 13) % 256, b: (seed * 53 + 101) % 256 };
  const make = (x: number, y: number) => sharp({ create: { width: x, height: y, channels: 3, background } }).webp({ lossless: true }).toBuffer();
  return { data: new Uint8Array(await make(w, hgt)), thumb: new Uint8Array(await make(16, 12)), width: w, height: hgt };
}

const audits = async (w: TenantWorld, action: string): Promise<number> =>
  Number((await adm.query<{ n: string }>("SELECT count(*) AS n FROM public.audit_logs WHERE tenant_id = $1 AND action = $2", [w.tenantId, action])).rows[0]?.n);

const imagesOf = async (w: TenantWorld, itemId: string) =>
  (await adm.query<{ id: string; is_main: boolean; removed: boolean; has_data: boolean }>(
    "SELECT id, is_main, removed_at IS NOT NULL AS removed, data IS NOT NULL AS has_data FROM public.item_images WHERE tenant_id = $1 AND item_id = $2 ORDER BY created_at, id",
    [w.tenantId, itemId],
  )).rows;

/** Silinmiş görseli 11 dakika önce silinmiş gibi yaşlandırır (yalnız test sahibi; bekçi o an kapalı). */
async function ageRemoved(id: string): Promise<void> {
  await adm.query("ALTER TABLE public.item_images DISABLE TRIGGER item_images_guard");
  try {
    await adm.query("UPDATE public.item_images SET removed_at = now() - interval '11 minutes' WHERE id = $1 AND removed_at IS NOT NULL", [id]);
  } finally {
    await adm.query("ALTER TABLE public.item_images ENABLE ALWAYS TRIGGER item_images_guard");
  }
}

/** Uygulama rolüyle (wms_app) tek transaction'da ham SQL; her zaman geri alınır. */
async function asApp<T>(tenantId: string, run: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: env.databaseUrl });
  c.on("error", () => undefined);
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
    return await run(c);
  } finally {
    await c.query("ROLLBACK").catch(() => undefined);
    await c.end();
  }
}
async function sqlState(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code ?? "?";
  }
  return "OK";
}

beforeAll(async () => {
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  try {
    await adm.connect();
  } catch (e) {
    throw new Error(`connect failed: ${redactErrorChain(e, [env.databaseUrl, env.databaseUrlDirect])}`);
  }
  h.db = app;
  process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("hex"); // sentetik, koşu başına
  process.env.BETTER_AUTH_URL = ORIGIN;
  A = await seedWorld(adm, reg, "A1145");
  B = await seedWorld(adm, reg, "B1145");
  // Gruptan `items.edit` alan saha personeli (T-1142: kart anahtarı MFA ister).
  editorUserId = await mkUser(adm, reg, "A1145 editor");
  const m = await mkMembership(adm, A.tenantId, editorUserId, { roles: ["PICKER"] });
  const g = await adm.query<{ id: string }>("INSERT INTO public.permission_groups (tenant_id, name, grants, created_by) VALUES ($1, 'Kart editörü', ARRAY['items.edit'], $2) RETURNING id", [A.tenantId, A.ownerMembershipId]);
  await adm.query("INSERT INTO public.member_groups (tenant_id, membership_id, group_id, assigned_by) VALUES ($1, $2, $3, $4)", [A.tenantId, m, g.rows[0]?.id, A.ownerMembershipId]);
}, 120_000);

afterAll(async () => {
  // Audit append-only: audit yazan tenant'lar kısa ömürlü ortamda kalır (catalog-qa ile aynı politika).
  await adm?.end().catch(() => undefined);
  await app?.close().catch(() => undefined);
}, 60_000);

describe("ürün görseli — domain", () => {
  it("ekle (ilk kapak) → aynı bayt tekrar (yeni satır yok) → ikinci görsel → kapak yap → sil (kapak devri) → geri al; her adım audit", async () => {
    const item = A.itemTwoId;
    const one = await addItemImage(admin(A), { itemId: item, image: await webpImage(10) });
    expect(one).toMatchObject({ isMain: true, changed: true, replacedId: null });
    const again = await addItemImage(admin(A), { itemId: item, image: await webpImage(10) });
    expect(again).toEqual({ imageId: one.imageId, replacedId: null, isMain: true, changed: false });
    const two = await addItemImage(admin(A), { itemId: item, image: await webpImage(20) });
    expect(two.isMain).toBe(false);
    expect((await listItemImages(admin(A), item)).map((x) => [x.id, x.isMain])).toEqual([[one.imageId, true], [two.imageId, false]]);
    expect(await setItemImageMain(admin(A), { itemId: item, imageId: two.imageId })).toEqual({ changed: true, previousMainId: one.imageId });
    expect((await setItemImageMain(admin(A), { itemId: item, imageId: two.imageId })).changed).toBe(false);
    const rm = await removeItemImage(admin(A), { itemId: item, imageId: two.imageId });
    expect(rm).toEqual({ changed: true, wasMain: true, newMainId: one.imageId });
    expect((await removeItemImage(admin(A), { itemId: item, imageId: two.imageId })).changed).toBe(false);
    expect(await failure(getItemImage(admin(A), { itemId: item, imageId: two.imageId, variant: "full" }))).toBe("NOT_FOUND/");
    expect(await restoreItemImage(admin(A), { itemId: item, imageId: two.imageId, main: true })).toEqual({ changed: true, isMain: true });
    const rows = await imagesOf(A, item);
    expect(rows.filter((r) => r.is_main).map((r) => r.id)).toEqual([two.imageId]);
    const full = await getItemImage(admin(A), { itemId: item, imageId: two.imageId, variant: "full" });
    expect(Buffer.from(full.bytes).subarray(8, 12).toString()).toBe("WEBP");
    const thumbs = await listItemMainThumbs(admin(A), [item, A.itemId]);
    expect(thumbs).toHaveLength(1);
    expect(thumbs[0]).toMatchObject({ itemId: item, count: 2 });
    expect(thumbs[0]?.thumb?.startsWith("data:image/webp;base64,")).toBe(true);
    for (const [action, n] of [["item_image.added", 2], ["item_image.main_set", 1], ["item_image.removed", 1], ["item_image.restored", 1]] as const) {
      expect(await audits(A, action), action).toBe(n);
    }
    // Audit görsel baytı taşımaz (yalnız kimlik, özet, ölçü).
    const summary = await adm.query<{ s: string }>("SELECT change_summary::text AS s FROM public.audit_logs WHERE tenant_id = $1 AND action = 'item_image.added' LIMIT 1", [A.tenantId]);
    expect(summary.rows[0]?.s).not.toContain("RIFF");
  });

  it("değiştir: eski görsel silinir, yenisi kapak olur; Geri al (yeniyi sil + eskiyi kapak olarak geri aç) eski hâle döner", async () => {
    const item = A.itemNoneId;
    const first = await addItemImage(admin(A), { itemId: item, image: await webpImage(30) });
    const swap = await addItemImage(admin(A), { itemId: item, image: await webpImage(31), replaces: first.imageId });
    expect(swap).toMatchObject({ replacedId: first.imageId, isMain: true, changed: true });
    expect((await imagesOf(A, item)).map((r) => [r.id, r.is_main, r.removed])).toEqual([[first.imageId, false, true], [swap.imageId, true, false]]);
    expect(await audits(A, "item_image.replaced")).toBe(1);
    await removeItemImage(admin(A), { itemId: item, imageId: swap.imageId });
    await restoreItemImage(admin(A), { itemId: item, imageId: first.imageId, main: true });
    expect((await listItemImages(admin(A), item)).map((x) => [x.id, x.isMain])).toEqual([[first.imageId, true]]);
    expect(await failure(addItemImage(admin(A), { itemId: item, image: await webpImage(32), replaces: swap.imageId }))).toBe("NOT_FOUND/");
  });

  it("ürün başına 5 görsel: altıncı IMAGE_LIMIT; geri açma da sınırı aşamaz; boşaltılmış görsel geri açılamaz", async () => {
    const item = (await adm.query<{ id: string }>("INSERT INTO public.items (tenant_id, code, name, base_unit_id) VALUES ($1, $2, 'Sınır ürünü', $3) RETURNING id", [A.tenantId, `LIM-${rnd()}`, A.unitId])).rows[0]!.id;
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await addItemImage(admin(A), { itemId: item, image: await webpImage(100 + i) })).imageId);
    expect(await failure(addItemImage(admin(A), { itemId: item, image: await webpImage(120) }))).toBe("VALIDATION_FAILED/IMAGE_LIMIT");
    await removeItemImage(admin(A), { itemId: item, imageId: ids[0]! });
    await addItemImage(admin(A), { itemId: item, image: await webpImage(121) });
    expect(await failure(restoreItemImage(admin(A), { itemId: item, imageId: ids[0]! }))).toBe("VALIDATION_FAILED/IMAGE_LIMIT");
    // 10 dakikadan eski silinmiş görsel sonraki komutta boşaltılır; boşaltılmış görsel geri açılamaz.
    // Silinme anı bekçide uydurulamaz (MINOR-3); yaşlandırma yalnız test sahibince, bekçi kısa süre kapatılarak (int dosyaları sıralı koşar).
    await ageRemoved(ids[0]!);
    await removeItemImage(admin(A), { itemId: item, imageId: ids[1]! });
    expect((await imagesOf(A, item)).find((r) => r.id === ids[0])?.has_data).toBe(false);
    expect(await failure(restoreItemImage(admin(A), { itemId: item, imageId: ids[0]! }))).toBe("NOT_FOUND/");
  });

  it("çalışma alanı bütçesi (DB yolu): kullanılan + yeni > bütçe ise IMAGE_QUOTA, satır yazılmaz; bütçe yalnız düşürülebilir; silinip boşaltılan sayılmaz", async () => {
    const item = (await adm.query<{ id: string }>("INSERT INTO public.items (tenant_id, code, name, base_unit_id) VALUES ($1, $2, 'Bütçe ürünü', $3) RETURNING id", [B.tenantId, `QTA-${rnd()}`, B.unitId])).rows[0]!.id;
    const used = async (): Promise<number> => Number((await adm.query<{ n: string }>("SELECT coalesce(sum(octet_length(data) + octet_length(thumb)), 0)::text AS n FROM public.item_images WHERE tenant_id = $1 AND data IS NOT NULL", [B.tenantId])).rows[0]?.n);
    const img = await webpImage(150);
    const size = img.data.length + img.thumb.length;
    const now = await used();
    const before = await imagesOf(B, item);
    expect(await failure(addItemImage(admin(B), { itemId: item, image: img, quotaBytes: now + size - 1 }))).toBe("VALIDATION_FAILED/IMAGE_QUOTA");
    expect(await imagesOf(B, item)).toEqual(before);
    const ok = await addItemImage(admin(B), { itemId: item, image: img, quotaBytes: now + size });
    expect(ok.changed).toBe(true);
    // Bütçe yükseltilemez: devasa değer üst sınıra (500 MiB) kırpılır → normal ekleme geçer.
    expect((await addItemImage(admin(B), { itemId: item, image: await webpImage(151), quotaBytes: Number.MAX_SAFE_INTEGER })).changed).toBe(true);
    // Silinip boşaltılan görsel bütçeden düşer.
    await removeItemImage(admin(B), { itemId: item, imageId: ok.imageId });
    await ageRemoved(ok.imageId);
    await withSystemTenant(app, B.tenantId, "item_images.purge", (tx) => purgeRemovedItemImages(tx, B.tenantId));
    const after = await used();
    expect((await addItemImage(admin(B), { itemId: item, image: await webpImage(152), quotaBytes: after + 1_000_000 })).changed).toBe(true);
  });

  it("yetki: PICKER yazamaz (FORBIDDEN, satır/audit yok); gruptan items.edit alan MFA'sız MFA_REQUIRED, MFA'lı yazabilir; arşivli ürüne eklenmez", async () => {
    const before = await imagesOf(A, A.itemId);
    const auditBefore = await audits(A, "item_image.added");
    expect(await failure(addItemImage(as(A, A.memberUserId), { itemId: A.itemId, image: await webpImage(50) }))).toBe("FORBIDDEN/");
    expect(await failure(addItemImage(as(A, editorUserId, false), { itemId: A.itemId, image: await webpImage(51) }))).toBe("FORBIDDEN/MFA_REQUIRED");
    expect(await imagesOf(A, A.itemId)).toEqual(before);
    expect(await audits(A, "item_image.added")).toBe(auditBefore);
    const ok = await addItemImage(as(A, editorUserId), { itemId: A.itemId, image: await webpImage(52) });
    expect(ok.changed).toBe(true);
    expect(await failure(removeItemImage(as(A, A.memberUserId), { itemId: A.itemId, imageId: ok.imageId }))).toBe("FORBIDDEN/");
    expect(await failure(setItemImageMain(as(A, editorUserId, false), { itemId: A.itemId, imageId: ok.imageId }))).toBe("FORBIDDEN/MFA_REQUIRED");
    // Okuma `stock.view`: PICKER görebilir.
    expect((await listItemImages(as(A, A.memberUserId), A.itemId)).map((x) => x.id)).toContain(ok.imageId);
    const archived = (await adm.query<{ id: string }>("INSERT INTO public.items (tenant_id, code, name, base_unit_id, status, archived_at) VALUES ($1, $2, 'Arşivli', $3, 'ARCHIVED', now()) RETURNING id", [A.tenantId, `ARS-${rnd()}`, A.unitId])).rows[0]!.id;
    expect(await failure(addItemImage(admin(A), { itemId: archived, image: await webpImage(53) }))).toBe("VALIDATION_FAILED/");
  });

  it("çapraz tenant: A, B'nin ürününe / görseline erişemez (NOT_FOUND, B'de değişiklik yok); B slug'ı A üyesine kapalı", async () => {
    const bImg = await addItemImage(admin(B), { itemId: B.itemTwoId, image: await webpImage(60) });
    const bBefore = await imagesOf(B, B.itemTwoId);
    expect(await failure(addItemImage(admin(A), { itemId: B.itemTwoId, image: await webpImage(61) }))).toBe("NOT_FOUND/");
    expect(await failure(removeItemImage(admin(A), { itemId: B.itemTwoId, imageId: bImg.imageId }))).toBe("NOT_FOUND/");
    expect(await failure(setItemImageMain(admin(A), { itemId: A.itemTwoId, imageId: bImg.imageId }))).toBe("NOT_FOUND/");
    expect(await failure(restoreItemImage(admin(A), { itemId: A.itemTwoId, imageId: bImg.imageId }))).toBe("NOT_FOUND/");
    expect(await failure(getItemImage(admin(A), { itemId: B.itemTwoId, imageId: bImg.imageId, variant: "full" }))).toBe("NOT_FOUND/");
    expect(await failure(getItemImage(admin(A), { itemId: A.itemTwoId, imageId: bImg.imageId, variant: "thumb" }))).toBe("NOT_FOUND/");
    expect(await failure(listItemImages(admin(A), B.itemTwoId))).toBe("NOT_FOUND/");
    expect(await listItemMainThumbs(admin(A), [B.itemTwoId])).toEqual([]);
    expect(await failure(listItemImages({ ...admin(A), tenantSlug: B.slug }, B.itemTwoId))).toBe("NOT_FOUND/");
    expect(await failure(addItemImage({ ...admin(A), tenantSlug: B.slug }, { itemId: B.itemTwoId, image: await webpImage(62) }))).toBe("NOT_FOUND/");
    expect(await imagesOf(B, B.itemTwoId)).toEqual(bBefore);
    // DB: A bağlamında B satırı görünmez ve güncellenemez.
    await asApp(A.tenantId, async (c) => {
      expect((await c.query("SELECT count(*)::int AS n FROM public.item_images WHERE tenant_id = $1", [B.tenantId])).rows[0]?.n).toBe(0);
      expect((await c.query("UPDATE public.item_images SET is_main = is_main WHERE id = $1", [bImg.imageId])).rowCount).toBe(0);
    });
  });

  it("DB bekçileri: wms_app silemez; baytlar yeni değere değişmez, taze silinmiş satır boşaltılamaz; WebP imzası olmayan bayt ya da 6. görsel giremez", async () => {
    const img = await addItemImage(admin(A), { itemId: A.itemTwoId, image: await webpImage(70) });
    expect(await asApp(A.tenantId, (c) => sqlState(c.query("DELETE FROM public.item_images WHERE id = $1", [img.imageId])))).toBe("42501");
    expect(await asApp(A.tenantId, (c) => sqlState(c.query("UPDATE public.item_images SET data = $2 WHERE id = $1", [img.imageId, Buffer.from("RIFF0000WEBPxxxx")])))).toBe("23514");
    expect(await asApp(A.tenantId, (c) => sqlState(c.query("UPDATE public.item_images SET removed_at = now(), is_main = false, data = NULL, thumb = NULL WHERE id = $1", [img.imageId])))).toBe("23514");
    expect(await asApp(A.tenantId, (c) => sqlState(c.query("UPDATE public.item_images SET sha256 = repeat('a', 64) WHERE id = $1", [img.imageId])))).toBe("42501");
    // MINOR-3: silinme anı işlem anı olmalı; sonradan başka ana çevrilemez.
    expect(await asApp(A.tenantId, (c) => sqlState(c.query("UPDATE public.item_images SET removed_at = now() - interval '1 hour', is_main = false WHERE id = $1", [img.imageId])))).toBe("23514");
    expect(
      await asApp(A.tenantId, async (c) => {
        await c.query("UPDATE public.item_images SET removed_at = now(), is_main = false WHERE id = $1", [img.imageId]);
        return sqlState(c.query("UPDATE public.item_images SET removed_at = removed_at - interval '1 hour' WHERE id = $1", [img.imageId]));
      }),
    ).toBe("23514");
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(
      await asApp(A.tenantId, (c) =>
        sqlState(c.query("INSERT INTO public.item_images (tenant_id, item_id, data, thumb, width, height, sha256) VALUES ($1, $2, $3, $3, 1, 1, repeat('b', 64))", [A.tenantId, A.itemTwoId, svg])),
      ),
    ).toBe("23514");
    expect(
      await asApp(A.tenantId, (c) =>
        sqlState(c.query("INSERT INTO public.item_images (tenant_id, item_id, data, thumb, width, height, sha256) VALUES ($1, $2, $3, $3, 1, 1, repeat('c', 64))", [B.tenantId, B.itemTwoId, Buffer.from("RIFF0000WEBPxxxx")])),
      ),
    ).toBe("42501");
  });
});

// ---------------------------------------------------------------------------------------------
// Route katmanı (yükleme + sunma)
// ---------------------------------------------------------------------------------------------
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
let ipN = 0;
function req(url: string, init: { method: "GET" | "POST"; user: string | null; body?: Uint8Array; mfa?: boolean; site?: string }): Request {
  const headers = new Headers({ "fly-client-ip": `203.0.113.${(ipN++ % 250) + 1}`, "sec-fetch-site": init.site ?? "same-origin" });
  if (init.user !== null) headers.set("x-test-user", init.user);
  if (init.mfa === false) headers.set("x-test-mfa", "0");
  if (init.method === "POST") headers.set("origin", ORIGIN);
  // Tarayıcı Blob gövdesinde uzunluğu kendisi gönderir; sentetik istekte açıkça (rota Content-Length ister, MINOR-B).
  if (init.body !== undefined) headers.set("content-length", String(init.body.length));
  return new Request(url, { method: init.method, headers, ...(init.body === undefined ? {} : { body: init.body as unknown as NonNullable<RequestInit["body"]> }) });
}

describe("ürün görseli — süreli boşaltma (worker yolu, MINOR-2)", () => {
  it("withSystemTenant + aynı RLS: yalnız 10 dk'dan eski silinmiş satırın baytları boşalır; taze silinmiş ve etkin görsel kalır; başka tenant'a dokunmaz", async () => {
    const item = (await adm.query<{ id: string }>("INSERT INTO public.items (tenant_id, code, name, base_unit_id) VALUES ($1, $2, 'Boşaltma ürünü', $3) RETURNING id", [A.tenantId, `PRG-${rnd()}`, A.unitId])).rows[0]!.id;
    const old = await addItemImage(admin(A), { itemId: item, image: await webpImage(140) });
    const fresh = await addItemImage(admin(A), { itemId: item, image: await webpImage(141) });
    const keep = await addItemImage(admin(A), { itemId: item, image: await webpImage(142) });
    await removeItemImage(admin(A), { itemId: item, imageId: old.imageId });
    await removeItemImage(admin(A), { itemId: item, imageId: fresh.imageId });
    await ageRemoved(old.imageId);
    const bImg = await addItemImage(admin(B), { itemId: B.itemTwoId, image: await webpImage(143) });
    await removeItemImage(admin(B), { itemId: B.itemTwoId, imageId: bImg.imageId });
    await ageRemoved(bImg.imageId);
    const n = await withSystemTenant(app, A.tenantId, "item_images.purge", (tx) => purgeRemovedItemImages(tx, A.tenantId));
    expect(n).toBeGreaterThanOrEqual(1);
    const rows = await imagesOf(A, item);
    expect(rows.find((r) => r.id === old.imageId)?.has_data).toBe(false);
    expect(rows.find((r) => r.id === fresh.imageId)?.has_data).toBe(true);
    expect(rows.find((r) => r.id === keep.imageId)?.has_data).toBe(true);
    expect((await imagesOf(B, B.itemTwoId)).find((r) => r.id === bImg.imageId)?.has_data).toBe(true);
    // İkinci koşu idempotent.
    expect(await withSystemTenant(app, A.tenantId, "item_images.purge", (tx) => purgeRemovedItemImages(tx, A.tenantId))).toBe(0);
  });
});

describe("ürün görseli — route", () => {
  let upload: Handler;
  let serve: Handler;
  beforeAll(async () => {
    upload = (await import("../../../apps/web/app/api/t/[slug]/items/[itemId]/images/route.ts")).POST as unknown as Handler;
    serve = (await import("../../../apps/web/app/api/t/[slug]/items/[itemId]/images/[imageId]/route.ts")).GET as unknown as Handler;
  });
  const post = (w: TenantWorld, itemId: string, user: string | null, body: Uint8Array, extra: { mfa?: boolean; query?: string; site?: string; slug?: string } = {}) =>
    upload(req(`${ORIGIN}/api/t/${extra.slug ?? w.slug}/items/${itemId}/images${extra.query ?? ""}`, { method: "POST", user, body, ...(extra.mfa === undefined ? {} : { mfa: extra.mfa }), ...(extra.site === undefined ? {} : { site: extra.site }) }), {
      params: Promise.resolve({ slug: extra.slug ?? w.slug, itemId }),
    });
  const get = (slug: string, itemId: string, imageId: string, user: string | null, q = "") =>
    serve(req(`${ORIGIN}/api/t/${slug}/items/${itemId}/images/${imageId}${q}`, { method: "GET", user }), { params: Promise.resolve({ slug, itemId, imageId }) });

  it("JPEG (EXIF + konum) yüklenir → WebP saklanır, meta veri yok; görsel yalnız aynı tenant'tan, güvenli başlıklarla sunulur", async () => {
    const item = (await adm.query<{ id: string }>("INSERT INTO public.items (tenant_id, code, name, base_unit_id) VALUES ($1, $2, 'Route ürünü', $3) RETURNING id", [A.tenantId, `RT-${rnd()}`, A.unitId])).rows[0]!.id;
    const jpeg = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: 9, g: 99, b: 199 } } })
      .withExifMerge({ IFD0: { Artist: "Gizli Kişi" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "41/1 0/1 0/1" } })
      .jpeg()
      .toBuffer();
    const res = await post(A, item, A.ownerUserId, new Uint8Array(jpeg));
    expect(res.status, await res.clone().text()).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { imageId: string; isMain: boolean; changed: boolean };
    expect(body).toMatchObject({ isMain: true, changed: true });
    const stored = await adm.query<{ data: Buffer; width: number; height: number }>("SELECT data, width, height FROM public.item_images WHERE id = $1", [body.imageId]);
    const row = stored.rows[0]!;
    expect([row.width, row.height]).toEqual([1280, 960]);
    expect((await sharp(row.data).metadata()).exif).toBeUndefined();
    expect(row.data.includes(Buffer.from("Gizli"))).toBe(false);

    const ok = await get(A.slug, item, body.imageId, A.memberUserId, "?v=x");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/webp");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    expect(ok.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(ok.headers.get("cache-control")).toContain("private");
    expect(Buffer.from(await ok.arrayBuffer()).subarray(8, 12).toString()).toBe("WEBP");
    const thumb = await get(A.slug, item, body.imageId, A.memberUserId, "?t=1");
    expect(thumb.status).toBe(200);
    // B'nin üyesi A'nın görselini göremez; A'nın görseli B slug'ıyla da açılmaz; oturumsuz 401.
    expect((await get(A.slug, item, body.imageId, B.ownerUserId)).status).toBe(404);
    expect((await get(B.slug, item, body.imageId, B.ownerUserId)).status).toBe(404);
    expect((await get(B.slug, item, body.imageId, A.ownerUserId)).status).toBe(404);
    expect((await get(A.slug, item, body.imageId, null)).status).toBe(401);
    const missing = await get(A.slug, item, randomUUID(), A.ownerUserId);
    expect(missing.status).toBe(404);
  });

  it("yavaş damlatılan gövde ~20 sn sonra 400 IMAGE_TIMEOUT; beklerken işleme yuvası tutulmaz (başka yükleme yuva alabilir)", async () => {
    const { tryAcquireImageSlot, IMAGE_SLOTS } = await import("../../../apps/web/lib/item-image.ts");
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])); } });
    const headers = new Headers({ "fly-client-ip": `203.0.113.${(ipN++ % 250) + 1}`, "sec-fetch-site": "same-origin", "x-test-user": A.ownerUserId, origin: ORIGIN, "content-length": "4096" });
    const pending = upload(new Request(`${ORIGIN}/api/t/${A.slug}/items/${A.itemTwoId}/images`, { method: "POST", headers, body, duplex: "half" } as RequestInit), { params: Promise.resolve({ slug: A.slug, itemId: A.itemTwoId }) });
    await new Promise((r) => setTimeout(r, 1500));
    const held = Array.from({ length: IMAGE_SLOTS }, () => tryAcquireImageSlot());
    expect(held.every((x) => x !== null)).toBe(true);
    for (const r of held) r?.();
    const res = await pending;
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error?: { detail?: string } }).error?.detail).toBe("IMAGE_TIMEOUT");
    const again = Array.from({ length: IMAGE_SLOTS }, () => tryAcquireImageSlot());
    expect(again.every((x) => x !== null)).toBe(true);
    for (const r of again) r?.();
  }, 45_000);

  it("MINOR-B: okuma yuvaları doluyken 429 IMAGE_BUSY (gövde okunmaz); Content-Length yoksa 400 IMAGE_LENGTH_REQUIRED; satır yazılmaz", async () => {
    const { tryAcquireReadSlot, READ_SLOTS } = await import("../../../apps/web/lib/upload-body.ts");
    const item = A.itemTwoId;
    const before = await imagesOf(A, item);
    const png = new Uint8Array(await sharp({ create: { width: 7, height: 7, channels: 3, background: { r: 66, g: 2, b: 19 } } }).png().toBuffer());
    const held = Array.from({ length: READ_SLOTS }, () => tryAcquireReadSlot());
    try {
      const res = await post(A, item, A.ownerUserId, png);
      expect(res.status).toBe(429);
      expect(((await res.json()) as { error?: { detail?: string } }).error?.detail).toBe("IMAGE_BUSY");
    } finally {
      for (const r of held) r?.();
    }
    const headers = new Headers({ "fly-client-ip": `203.0.113.${(ipN++ % 250) + 1}`, "sec-fetch-site": "same-origin", "x-test-user": A.ownerUserId, origin: ORIGIN });
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(png); c.close(); } });
    const noLen = await upload(new Request(`${ORIGIN}/api/t/${A.slug}/items/${item}/images`, { method: "POST", headers, body, duplex: "half" } as RequestInit), { params: Promise.resolve({ slug: A.slug, itemId: item }) });
    expect(noLen.status).toBe(400);
    expect(((await noLen.json()) as { error?: { detail?: string } }).error?.detail).toBe("IMAGE_LENGTH_REQUIRED");
    expect(await imagesOf(A, item)).toEqual(before);
  });

  it("işleme yuvaları doluyken 429 IMAGE_BUSY (gövde işlenmez, satır yazılmaz); yuva boşalınca yükleme geçer", async () => {
    const { tryAcquireImageSlot, IMAGE_SLOTS } = await import("../../../apps/web/lib/item-image.ts");
    const item = A.itemTwoId;
    const before = await imagesOf(A, item);
    const png = new Uint8Array(await sharp({ create: { width: 9, height: 9, channels: 3, background: { r: 77, g: 1, b: 9 } } }).png().toBuffer());
    const held = Array.from({ length: IMAGE_SLOTS }, () => tryAcquireImageSlot());
    try {
      const res = await post(A, item, A.ownerUserId, png);
      expect(res.status).toBe(429);
      const j = (await res.json()) as { error?: { code: string; detail?: string } };
      expect(j.error).toMatchObject({ code: "RATE_LIMITED", detail: "IMAGE_BUSY" });
      expect(await imagesOf(A, item)).toEqual(before);
    } finally {
      for (const r of held) r?.();
    }
    expect((await post(A, item, A.ownerUserId, png)).status).toBe(200);
  });

  it("SVG, sahte imza, GIF ve 5 MiB üstü 400; PICKER 403; MFA'sız editör 403; A üyesi B slug'ında 404; çapraz site POST 403; satır yazılmaz", async () => {
    const item = A.itemTwoId;
    const before = await imagesOf(A, item);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
    const code = async (r: Response): Promise<string> => {
      const j = (await r.json()) as { error?: { code: string; detail?: string } };
      return `${r.status} ${j.error?.code ?? ""}/${j.error?.detail ?? ""}`;
    };
    expect(await code(await post(A, item, A.ownerUserId, new Uint8Array(svg)))).toBe("400 VALIDATION_FAILED/IMAGE_INVALID");
    expect(await code(await post(A, item, A.ownerUserId, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Buffer.from("<script>alert(1)</script>")])))).toBe("400 VALIDATION_FAILED/IMAGE_INVALID");
    const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 1, b: 1 } } }).gif().toBuffer();
    expect(await code(await post(A, item, A.ownerUserId, new Uint8Array(gif)))).toBe("400 VALIDATION_FAILED/IMAGE_INVALID");
    const big = new Uint8Array(5 * 1024 * 1024 + 10);
    big.set([0xff, 0xd8, 0xff, 0xe0]);
    expect(await code(await post(A, item, A.ownerUserId, big))).toBe("400 VALIDATION_FAILED/IMAGE_TOO_LARGE");
    const png = new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 5, g: 5, b: 5 } } }).png().toBuffer());
    expect((await post(A, item, A.memberUserId, png)).status).toBe(403);
    expect(await code(await post(A, item, editorUserId, png, { mfa: false }))).toBe("403 FORBIDDEN/MFA_REQUIRED");
    expect((await post(A, B.itemTwoId, A.ownerUserId, png, { slug: B.slug })).status).toBe(404);
    expect((await post(A, B.itemTwoId, A.ownerUserId, png)).status).toBe(404);
    expect((await post(A, item, A.ownerUserId, png, { site: "cross-site" })).status).toBe(403);
    expect((await post(A, item, null, png)).status).toBe(401);
    expect(await imagesOf(A, item)).toEqual(before);
  });
});

describe("min / maks stok", () => {
  it("depo başına yazılır, okunur ve audit'lenir; değişmeyen değer yazılmaz; 0 / 0 satır açmaz", async () => {
    const item = A.itemTwoId;
    expect(await setItemStockPolicy(admin(A), { itemId: item, warehouseId: A.warehouseId, min: "0", max: "0" })).toMatchObject({ changed: false });
    expect((await adm.query("SELECT 1 FROM public.item_stock_policies WHERE tenant_id = $1 AND item_id = $2", [A.tenantId, item])).rowCount).toBe(0);
    expect(await setItemStockPolicy(admin(A), { itemId: item, warehouseId: A.warehouseId, min: "5", max: "20" })).toEqual({ changed: true, min: "5", max: "20" });
    expect((await setItemStockPolicy(admin(A), { itemId: item, warehouseId: A.warehouseId, min: "5.000", max: "20" })).changed).toBe(false);
    expect((await setItemStockPolicy(admin(A), { itemId: item, warehouseId: A.warehouseId, min: "7", max: "7" })).changed).toBe(true);
    const list = await listItemStockPolicies(admin(A), item);
    expect(list.find((p) => p.warehouseId === A.warehouseId)).toMatchObject({ min: "7", max: "7" });
    expect(await audits(A, "item_stock_policy.set")).toBe(2);
    const last = await adm.query<{ s: Record<string, unknown> }>("SELECT change_summary AS s FROM public.audit_logs WHERE tenant_id = $1 AND action = 'item_stock_policy.set' ORDER BY occurred_at DESC, id DESC LIMIT 1", [A.tenantId]);
    expect(last.rows[0]?.s).toMatchObject({ min: "7", max: "7", previous_min: "5", previous_max: "20" });
  });

  it("doğrulama: min > maks MIN_MAX_INVALID, negatif / biçimsiz VALIDATION_FAILED, ürünün ondalık hassasiyeti QUANTITY_SCALE; hiçbiri yazılmaz", async () => {
    const item = A.itemNoneId;
    const before = (await adm.query("SELECT min_quantity::text, max_quantity::text FROM public.item_stock_policies WHERE tenant_id = $1 AND item_id = $2 ORDER BY warehouse_id", [A.tenantId, item])).rows;
    expect(await failure(setItemStockPolicy(admin(A), { itemId: item, warehouseId: A.warehouseId, min: "10", max: "9" }))).toBe("VALIDATION_FAILED/MIN_MAX_INVALID");
    expect(await failure(setItemStockPolicy(admin(A), { itemId: item, warehouseId: A.warehouseId, min: "-1", max: "9" }))).toBe("VALIDATION_FAILED/");
    expect(await failure(setItemStockPolicy(admin(A), { itemId: item, warehouseId: A.warehouseId, min: "1e3", max: "9" }))).toBe("VALIDATION_FAILED/");
    expect(await failure(setItemStockPolicy(admin(A), { itemId: item, warehouseId: A.warehouseId, min: "1,5", max: "9" }))).toBe("VALIDATION_FAILED/");
    expect(await failure(setItemStockPolicy(admin(A), { itemId: item, warehouseId: A.warehouseId, min: "1.5", max: "9" }))).toBe("VALIDATION_FAILED/QUANTITY_SCALE");
    expect(await failure(setItemStockPolicy(admin(A), { itemId: item, warehouseId: A.warehouseId, min: "1", max: "123456789012345" }))).toBe("VALIDATION_FAILED/");
    expect((await adm.query("SELECT min_quantity::text, max_quantity::text FROM public.item_stock_policies WHERE tenant_id = $1 AND item_id = $2 ORDER BY warehouse_id", [A.tenantId, item])).rows).toEqual(before);
    // Ondalıklı üründe aynı değer geçer (I-09: dizgi, yuvarlama yok).
    const dec = (await adm.query<{ id: string }>("INSERT INTO public.items (tenant_id, code, name, base_unit_id, quantity_scale) VALUES ($1, $2, 'Ondalıklı', $3, 3) RETURNING id", [A.tenantId, `DEC-${rnd()}`, A.unitId])).rows[0]!.id;
    expect(await setItemStockPolicy(admin(A), { itemId: dec, warehouseId: A.warehouseId, min: "1.250", max: "2.5" })).toEqual({ changed: true, min: "1.25", max: "2.5" });
    expect(await failure(setItemStockPolicy(admin(A), { itemId: dec, warehouseId: A.warehouseId, min: "1.2345", max: "2.5" }))).toBe("VALIDATION_FAILED/QUANTITY_SCALE");
  });

  it("yetki ve kapsam: PICKER FORBIDDEN, MFA'sız editör MFA_REQUIRED; B'nin deposu / ürünü NOT_FOUND; kapsam dışı depo WAREHOUSE_OUT_OF_SCOPE", async () => {
    const item = A.itemTwoId;
    expect(await failure(setItemStockPolicy(as(A, A.memberUserId), { itemId: item, warehouseId: A.warehouseId, min: "1", max: "2" }))).toBe("FORBIDDEN/");
    expect(await failure(setItemStockPolicy(as(A, editorUserId, false), { itemId: item, warehouseId: A.warehouseId, min: "1", max: "2" }))).toBe("FORBIDDEN/MFA_REQUIRED");
    expect(await failure(setItemStockPolicy(admin(A), { itemId: item, warehouseId: B.warehouseId, min: "1", max: "2" }))).toBe("NOT_FOUND/");
    expect(await failure(setItemStockPolicy(admin(A), { itemId: B.itemTwoId, warehouseId: A.warehouseId, min: "1", max: "2" }))).toBe("NOT_FOUND/");
    expect(await failure(listItemStockPolicies(admin(A), B.itemTwoId))).toBe("NOT_FOUND/");
    expect((await adm.query("SELECT 1 FROM public.item_stock_policies WHERE tenant_id = $1 AND warehouse_id = $2 AND item_id = $3", [B.tenantId, B.warehouseId, B.itemTwoId])).rowCount).toBe(0);
    // Depo kapsamı (bayrak açık): editör yalnız ikinci depoya bağlı → ilk depo yazılamaz ve listede görünmez.
    const other = (await adm.query<{ id: string }>("INSERT INTO public.warehouses (tenant_id, code, name) VALUES ($1, $2, 'Kapsam deposu') RETURNING id", [A.tenantId, `W-${rnd()}`])).rows[0]!.id;
    const m = (await adm.query<{ id: string }>("SELECT id FROM public.tenant_memberships WHERE tenant_id = $1 AND user_id = $2", [A.tenantId, editorUserId])).rows[0]!.id;
    await adm.query("INSERT INTO public.membership_warehouse_scopes (tenant_id, membership_id, warehouse_id) VALUES ($1, $2, $3)", [A.tenantId, m, other]);
    const saved = process.env.WAREHOUSE_SCOPE_ENABLED;
    process.env.WAREHOUSE_SCOPE_ENABLED = "true";
    try {
      expect(await failure(setItemStockPolicy(as(A, editorUserId), { itemId: item, warehouseId: A.warehouseId, min: "1", max: "2" }))).toBe("FORBIDDEN/WAREHOUSE_OUT_OF_SCOPE");
      expect((await setItemStockPolicy(as(A, editorUserId), { itemId: item, warehouseId: other, min: "1", max: "2" })).changed).toBe(true);
      expect((await listItemStockPolicies(as(A, editorUserId), item)).map((p) => p.warehouseId)).toEqual([other]);
    } finally {
      if (saved === undefined) delete process.env.WAREHOUSE_SCOPE_ENABLED;
      else process.env.WAREHOUSE_SCOPE_ENABLED = saved;
    }
  });
});

describe("birim dönüşümü kaldırma", () => {
  it("kullanılmayan dönüşüm silinir + audit; Geri al aynı katsayıyı yazar; yoksa changed=false", async () => {
    await setUnitConversion(admin(A), { itemId: A.itemTwoId, unitId: A.boxUnitId, factor: "6.5" });
    expect((await listItemConversions(admin(A), A.itemTwoId)).find((c) => c.unitId === A.boxUnitId)?.usage).toBeNull();
    expect(await removeUnitConversion(admin(A), { itemId: A.itemTwoId, unitId: A.boxUnitId })).toEqual({ changed: true, factor: "6.5" });
    expect(await removeUnitConversion(admin(A), { itemId: A.itemTwoId, unitId: A.boxUnitId })).toEqual({ changed: false, factor: null });
    expect(await audits(A, "unit_conversion.removed")).toBe(1);
    await setUnitConversion(admin(A), { itemId: A.itemTwoId, unitId: A.boxUnitId, factor: "6.5" });
    expect((await listItemConversions(admin(A), A.itemTwoId)).map((c) => [c.unitId, c.factor])).toEqual([[A.boxUnitId, "6.5"]]);
  });

  it("belge satırı ya da birimli barkod kullanıyorsa IN_USE (işlenmiş geçmiş korunur); okuma nedeni gösterir; ham DELETE de silmez", async () => {
    // Belge: tracking NONE ürününe koli dönüşümü + DRAFT belgede koli satırı.
    await setUnitConversion(admin(A), { itemId: A.itemNoneId, unitId: A.boxUnitId, factor: "10" });
    await adm.query(
      `INSERT INTO public.document_lines (tenant_id, id, document_id, line_no, item_id, unit_id, quantity, conversion_factor, base_quantity, target_location_id)
       VALUES ($1, $2, $3, 77, $4, $5, 1, 10, 10, $6)`,
      [A.tenantId, randomUUID(), A.documentId, A.itemNoneId, A.boxUnitId, A.rootLocationId],
    );
    expect((await listItemConversions(admin(A), A.itemNoneId)).find((c) => c.unitId === A.boxUnitId)?.usage).toBe("DOCUMENT");
    expect(await failure(removeUnitConversion(admin(A), { itemId: A.itemNoneId, unitId: A.boxUnitId }))).toBe("VALIDATION_FAILED/IN_USE");
    // Barkod: fikstür ürününün koli dönüşümüne birimli barkod.
    await addBarcode(admin(A), { itemId: A.itemId, unitId: A.boxUnitId, barcode: `KOLI-${rnd()}`, quantity: null });
    expect((await listItemConversions(admin(A), A.itemId)).find((c) => c.unitId === A.boxUnitId)?.usage).toBe("BARCODE");
    expect(await failure(removeUnitConversion(admin(A), { itemId: A.itemId, unitId: A.boxUnitId }))).toBe("VALIDATION_FAILED/IN_USE");
    const left = await adm.query("SELECT 1 FROM public.unit_conversions WHERE tenant_id = $1 AND unit_id = $2 AND item_id = ANY($3::uuid[])", [A.tenantId, A.boxUnitId, [A.itemId, A.itemNoneId]]);
    expect(left.rowCount).toBe(2);
    // DB bekçisi (0074): uygulama rolünün ham DELETE'i kullanılan satırı atlar.
    expect(await asApp(A.tenantId, async (c) => (await c.query("DELETE FROM public.unit_conversions WHERE item_id = ANY($1::uuid[]) AND unit_id = $2", [[A.itemId, A.itemNoneId], A.boxUnitId])).rowCount)).toBe(0);
  });

  it("yetki ve tenant: PICKER FORBIDDEN, MFA'sız editör MFA_REQUIRED, B'nin ürünü NOT_FOUND; B'de dönüşüm kalır", async () => {
    await setUnitConversion(admin(B), { itemId: B.itemTwoId, unitId: B.boxUnitId, factor: "4" });
    expect(await failure(removeUnitConversion(as(A, A.memberUserId), { itemId: A.itemTwoId, unitId: A.boxUnitId }))).toBe("FORBIDDEN/");
    expect(await failure(removeUnitConversion(as(A, editorUserId, false), { itemId: A.itemTwoId, unitId: A.boxUnitId }))).toBe("FORBIDDEN/MFA_REQUIRED");
    expect(await failure(removeUnitConversion(admin(A), { itemId: B.itemTwoId, unitId: B.boxUnitId }))).toBe("NOT_FOUND/");
    expect((await adm.query("SELECT 1 FROM public.unit_conversions WHERE tenant_id = $1 AND item_id = $2", [B.tenantId, B.itemTwoId])).rowCount).toBe(1);
  });
});
