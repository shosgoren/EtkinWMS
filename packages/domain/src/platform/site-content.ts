// Satış sayfası içeriği (T-407, ADR-027 §6, §9; 0046). Ana başlık, vurgulu satır, alt metin ve fiyat bölümünde gösterilecek paketler panelde
// düzenlenir, süreli önizleme bağlantısıyla denenir ve yayınlanır. Bütün erişim `wms_probe.platform_site_*` SECURITY DEFINER işlevleriyle:
// okuma/kaydetme/yayın/önizleme YALNIZ operatör (veritabanı listesi + oturum MFA'sı); kaydetme, yayın ve önizleme ayrıca yakın zamanda
// doğrulama ister. Satış sitesinin okuduğu `getPublicSite` kimlik gerektirmez ve yalnız yayındaki bilgiyi döner (kişisel veri yok).
// Metin düz metindir: denetim karakteri ve `<` `>` reddedilir; satış sitesi ayrıca kaçışlar (XSS: inceleme).
import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { withUser } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { PLATFORM_NO_USER_ID } from "@wms/shared/queue";
import type { AccessDbClient, AccessPrincipal } from "../identity/access.ts";
import { mapPlatformError, operatorWithRecentAuth, principalOrThrow } from "./demo-requests.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Denetim karakterleri ve köşeli ayraçlar (veritabanı kuralıyla aynı: `[[:cntrl:]<>]`).
const BAD_TEXT = /[\u0000-\u001f\u007f-\u009f<>]/;
export const SITE_LIMITS = { title1: 80, title2: 60, subtitle: 400, plans: 12 } as const;
/** Önizleme sırrı: 32 bayt, base64url (43 karakter). */
const PREVIEW_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export interface SiteContentInput {
  readonly title1: string;
  readonly title2: string;
  readonly subtitle: string;
  /** Fiyat bölümünde gösterilecek paketler (kimlik; sitede yalnız yayındakiler görünür). */
  readonly planIds: readonly string[];
}

export interface SiteContentState extends SiteContentInput {
  readonly version: number;
  /** Düzenlenen sürüm yayınlanmamış taslak mı. */
  readonly draft: boolean;
  readonly savedAt: Date;
  readonly publishedVersion: number | null;
  readonly publishedAt: Date | null;
}

export interface PublicSitePlan {
  readonly name: string;
  readonly recommended: boolean;
  /** Aylık, KDV hariç, TL ("1490" ya da "1490.50"). */
  readonly price: string;
  readonly limits: { readonly admins: number; readonly field: number; readonly warehouses: number; readonly items: number };
  readonly features: { readonly qr: boolean; readonly ship: boolean; readonly prod: boolean; readonly api: boolean };
}

export interface PublicSite {
  readonly version: number;
  readonly preview: boolean;
  readonly title1: string;
  readonly title2: string;
  readonly subtitle: string;
  readonly plans: readonly PublicSitePlan[];
}

function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim().replace(/[ \t]+/g, " ") : "";
}

/** Girdiyi sözleşmeye göre doğrular (veritabanı kuralıyla aynı sınırlar). */
export function normalizeSiteInput(raw: unknown): SiteContentInput {
  const o = raw as Partial<SiteContentInput> | null;
  if (o === null || typeof o !== "object") throw new AppError("VALIDATION_FAILED");
  const title1 = clean(o.title1);
  const title2 = clean(o.title2);
  // Alt metinde satır sonu boşluğa çevrilir (tek paragraf).
  const subtitle = clean(typeof o.subtitle === "string" ? o.subtitle.replace(/\r?\n+/g, " ") : o.subtitle);
  const bad = (s: string, min: number, max: number): boolean => s.length < min || s.length > max || BAD_TEXT.test(s);
  if (bad(title1, 1, SITE_LIMITS.title1) || bad(title2, 1, SITE_LIMITS.title2) || bad(subtitle, 1, SITE_LIMITS.subtitle)) {
    throw new AppError("VALIDATION_FAILED", { detail: "SITE_INVALID" });
  }
  const ids = Array.isArray(o.planIds) ? o.planIds : null;
  if (ids === null || ids.length > SITE_LIMITS.plans || ids.some((id) => typeof id !== "string" || !UUID.test(id))) {
    throw new AppError("VALIDATION_FAILED", { detail: "SITE_INVALID" });
  }
  const planIds = [...new Set(ids.map((id) => id.toLowerCase()))];
  return { title1, title2, subtitle, planIds };
}

export async function getSiteContent(params: { readonly db: AccessDbClient; readonly principal: AccessPrincipal | null }): Promise<SiteContentState | null> {
  const principal = principalOrThrow(params.principal);
  try {
    const rows = await withUser(params.db, principal.userId, (tx) =>
      tx.execute<{
        version: number;
        title1: string;
        title2: string;
        subtitle: string;
        plan_ids: string[] | string | null;
        draft: boolean;
        saved_at: Date | string;
        published_version: number | null;
        published_at: Date | string | null;
      }>(sql`SELECT version, title1, title2, subtitle, plan_ids::text[] AS plan_ids, draft, saved_at, published_version, published_at
               FROM wms_probe.platform_site_get()`),
    );
    const r = rows[0];
    if (r === undefined) return null;
    const ids = Array.isArray(r.plan_ids) ? r.plan_ids : typeof r.plan_ids === "string" ? r.plan_ids.replace(/^\{|\}$/g, "").split(",").filter((x) => x !== "") : [];
    return {
      version: Number(r.version),
      title1: r.title1,
      title2: r.title2,
      subtitle: r.subtitle,
      planIds: ids,
      draft: r.draft === true,
      savedAt: toDate(r.saved_at),
      publishedVersion: r.published_version === null ? null : Number(r.published_version),
      publishedAt: r.published_at === null ? null : toDate(r.published_at),
    };
  } catch (e) {
    throw mapPlatformError(e);
  }
}

export interface SiteWriteParams {
  readonly db: AccessDbClient;
  readonly principal: AccessPrincipal | null;
  readonly recentAuth: () => Promise<void>;
}

function planArray(ids: readonly string[]) {
  return ids.length === 0 ? sql`'{}'::uuid[]` : sql`ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]::uuid[]`;
}

/** Taslağı kaydeder; `publish` ise aynı transaction'da yayınlar. Dönüş: taslağın/yayının sürümü. */
export async function saveSiteContent(params: SiteWriteParams & { readonly content: unknown; readonly publish: boolean }): Promise<{ readonly version: number; readonly published: boolean }> {
  principalOrThrow(params.principal);
  const c = normalizeSiteInput(params.content);
  const principal = await operatorWithRecentAuth(params);
  try {
    return await withUser(params.db, principal.userId, async (tx) => {
      const saved = await tx.execute<{ v: number }>(
        sql`SELECT wms_probe.platform_site_save(${c.title1}, ${c.title2}, ${c.subtitle}, ${planArray(c.planIds)}) AS v`,
      );
      const version = saved[0]?.v;
      if (version === undefined) throw new AppError("INTERNAL");
      if (!params.publish) return { version: Number(version), published: false };
      const pub = await tx.execute<{ v: number }>(sql`SELECT wms_probe.platform_site_publish() AS v`);
      return { version: Number(pub[0]?.v ?? version), published: true };
    });
  } catch (e) {
    throw mapPlatformError(e);
  }
}

/**
 * Taslağı kaydeder ve 30 dakikalık önizleme bağlantısının sırrını üretir. Sır yalnız bu dönüşte vardır (veritabanında SHA-256 özeti);
 * panel bir kez gösterir, loga/işlem kaydına yazılmaz.
 */
export async function createSitePreview(params: SiteWriteParams & { readonly content: unknown }): Promise<{ readonly token: string; readonly expiresAt: Date; readonly version: number }> {
  principalOrThrow(params.principal);
  const c = normalizeSiteInput(params.content);
  const principal = await operatorWithRecentAuth(params);
  const token = randomBytes(32).toString("base64url");
  try {
    return await withUser(params.db, principal.userId, async (tx) => {
      const saved = await tx.execute<{ v: number }>(
        sql`SELECT wms_probe.platform_site_save(${c.title1}, ${c.title2}, ${c.subtitle}, ${planArray(c.planIds)}) AS v`,
      );
      const rows = await tx.execute<{ e: Date | string }>(sql`SELECT wms_probe.platform_site_preview(${previewHash(token)}) AS e`);
      const e = rows[0]?.e;
      if (e === undefined) throw new AppError("INTERNAL");
      return { token, expiresAt: toDate(e), version: Number(saved[0]?.v) };
    });
  } catch (e) {
    throw mapPlatformError(e);
  }
}

export function previewHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function priceText(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/**
 * Satış sitesi: son yayınlanan içerik (geçerli önizleme sırrı verilirse önizlenen sürüm). Kimlik gerektirmez; içerik yoksa `null`.
 * Biçimsiz önizleme sırrı yok sayılır (yayındaki içerik döner).
 */
export async function getPublicSite(db: AccessDbClient, previewToken?: string | null): Promise<PublicSite | null> {
  const hash = typeof previewToken === "string" && PREVIEW_TOKEN.test(previewToken) ? previewHash(previewToken) : null;
  const rows = await withUser(db, PLATFORM_NO_USER_ID, (tx) =>
    tx.execute<{ version: number; preview: boolean; title1: string; title2: string; subtitle: string; plans: unknown }>(
      sql`SELECT * FROM wms_probe.platform_site_public(${hash})`,
    ),
  );
  const r = rows[0];
  if (r === undefined) return null;
  const raw = (typeof r.plans === "string" ? (JSON.parse(r.plans) as unknown) : r.plans) as Record<string, unknown>[] | null;
  const plans: PublicSitePlan[] = (Array.isArray(raw) ? raw : []).map((p) => ({
    name: String(p.name ?? ""),
    recommended: p.recommended === true,
    price: priceText(p.price),
    limits: { admins: Number(p.admins), field: Number(p.field), warehouses: Number(p.warehouses), items: Number(p.items) },
    features: { qr: p.qr === true, ship: p.ship === true, prod: p.prod === true, api: p.api === true },
  }));
  return { version: Number(r.version), preview: r.preview === true, title1: r.title1, title2: r.title2, subtitle: r.subtitle, plans };
}
