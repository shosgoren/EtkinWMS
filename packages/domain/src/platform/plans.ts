// Paketler (T-404, ADR-027 §4–6; 0041). Paket tabloları platform tarafındadır; bütün erişim `wms_probe.platform_*` SECURITY DEFINER
// işlevleriyle. Listeleme ve kaydetme YALNIZ operatör (veritabanı listesi + oturum MFA'sı); kaydetme ayrıca yakın zamanda doğrulama ister.
// Fiyat/sınır/özellik değişikliği yeni sürüm açar (mevcut müşteriler bağlı oldukları sürümde kalır). Yayındaki paket listesi herkese
// açık bilgidir (satış sayfası). Sınırlar tenant komutlarında veritabanı tetikleyicisiyle uygulanır (`PLAN_LIMIT`, `planLimitError`).
import { sql } from "drizzle-orm";
import { withUser } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { PLATFORM_NO_USER_ID } from "@wms/shared/queue";
import type { AccessDbClient, AccessPrincipal, AccessTx } from "../identity/access.ts";
import { mapPlatformError, operatorWithRecentAuth, principalOrThrow } from "./demo-requests.ts";

export const PLAN_FEATURES = ["qr", "ship", "prod", "api"] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

export interface PlanLimits {
  /** 0 = sınırsız. */
  readonly admins: number;
  readonly field: number;
  readonly warehouses: number;
  readonly items: number;
}

export interface PlanInput {
  readonly name: string;
  /** Aylık fiyat, KDV hariç, TL (en çok iki ondalık). */
  readonly price: string;
  readonly limits: PlanLimits;
  readonly features: Readonly<Record<PlanFeature, boolean>>;
  readonly published: boolean;
  readonly recommended: boolean;
}

export interface PlanRow extends PlanInput {
  readonly id: string;
  readonly version: number;
  /** Bu pakete bağlı müşteri sayısı. */
  readonly customers: number;
}

export interface PublishedPlan {
  readonly name: string;
  readonly recommended: boolean;
  readonly price: string;
  readonly limits: PlanLimits;
  readonly features: Readonly<Record<PlanFeature, boolean>>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRICE = /^\d{1,7}(?:[.,]\d{1,2})?$/;
const NAME_MAX = 60;
const LIMIT_MAX: PlanLimits = { admins: 100_000, field: 100_000, warehouses: 100_000, items: 10_000_000 };

type DbPlan = {
  id: string;
  name: string;
  published: boolean;
  recommended: boolean;
  version: number;
  price_monthly: string;
  max_admins: number;
  max_field: number;
  max_warehouses: number;
  max_items: number;
  feat_qr: boolean;
  feat_ship: boolean;
  feat_prod: boolean;
  feat_api: boolean;
  customers: number;
};

function priceText(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new AppError("INTERNAL");
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function features(r: Pick<DbPlan, "feat_qr" | "feat_ship" | "feat_prod" | "feat_api">): Record<PlanFeature, boolean> {
  return { qr: r.feat_qr === true, ship: r.feat_ship === true, prod: r.feat_prod === true, api: r.feat_api === true };
}

function limits(r: Pick<DbPlan, "max_admins" | "max_field" | "max_warehouses" | "max_items">): PlanLimits {
  return { admins: Number(r.max_admins), field: Number(r.max_field), warehouses: Number(r.max_warehouses), items: Number(r.max_items) };
}

/** Girdiyi sözleşmeye göre doğrular ve DB biçimine çevirir (fiyat noktalı ondalık). */
export function normalizePlanInput(raw: unknown): PlanInput & { readonly priceNumeric: string } {
  const o = raw as Partial<PlanInput> | null;
  if (o === null || typeof o !== "object") throw new AppError("VALIDATION_FAILED");
  const name = typeof o.name === "string" ? o.name.trim().replace(/\s+/g, " ") : "";
  if (name === "" || name.length > NAME_MAX || /[\u0000-\u001f\u007f<>]/.test(name)) throw new AppError("VALIDATION_FAILED", { detail: "NAME" });
  const price = typeof o.price === "string" ? o.price.trim().replace(/\s/g, "") : "";
  if (!PRICE.test(price)) throw new AppError("VALIDATION_FAILED", { detail: "PRICE" });
  const priceNumeric = price.replace(",", ".");
  const l = o.limits as Partial<PlanLimits> | undefined;
  const lim = (k: keyof PlanLimits): number => {
    const v = l?.[k];
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0 || v > LIMIT_MAX[k]) throw new AppError("VALIDATION_FAILED", { detail: "LIMIT" });
    return v;
  };
  const f = o.features as Partial<Record<PlanFeature, boolean>> | undefined;
  const feat = (k: PlanFeature): boolean => {
    const v = f?.[k];
    if (typeof v !== "boolean") throw new AppError("VALIDATION_FAILED");
    return v;
  };
  if (typeof o.published !== "boolean" || typeof o.recommended !== "boolean") throw new AppError("VALIDATION_FAILED");
  if (o.recommended && !o.published) throw new AppError("VALIDATION_FAILED", { detail: "RECOMMENDED_UNPUBLISHED" });
  return {
    name,
    price: priceText(priceNumeric),
    priceNumeric,
    limits: { admins: lim("admins"), field: lim("field"), warehouses: lim("warehouses"), items: lim("items") },
    features: { qr: feat("qr"), ship: feat("ship"), prod: feat("prod"), api: feat("api") },
    published: o.published,
    recommended: o.recommended,
  };
}

export async function listPlans(params: { readonly db: AccessDbClient; readonly principal: AccessPrincipal | null }): Promise<readonly PlanRow[]> {
  const principal = principalOrThrow(params.principal);
  try {
    const rows = await withUser(params.db, principal.userId, (tx) => tx.execute<DbPlan>(sql`SELECT * FROM wms_probe.platform_list_plans()`));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      price: priceText(r.price_monthly),
      limits: limits(r),
      features: features(r),
      published: r.published === true,
      recommended: r.recommended === true,
      version: Number(r.version),
      customers: Number(r.customers),
    }));
  } catch (e) {
    throw mapPlatformError(e);
  }
}

export interface SavePlanParams {
  readonly db: AccessDbClient;
  readonly principal: AccessPrincipal | null;
  readonly recentAuth: () => Promise<void>;
  /** Yoksa yeni paket. */
  readonly id?: string | null;
  readonly plan: unknown;
}

export async function savePlan(params: SavePlanParams): Promise<{ readonly id: string; readonly version: number }> {
  principalOrThrow(params.principal);
  const id = params.id ?? null;
  if (id !== null && (typeof id !== "string" || !UUID.test(id))) throw new AppError("VALIDATION_FAILED");
  const p = normalizePlanInput(params.plan);
  const principal = await operatorWithRecentAuth(params);
  try {
    const rows = await withUser(params.db, principal.userId, (tx) =>
      tx.execute<{ id: string; version: number }>(
        sql`SELECT * FROM wms_probe.platform_save_plan(${id}::uuid, ${p.name}, ${p.priceNumeric}::numeric, ${p.limits.admins}::int,
              ${p.limits.field}::int, ${p.limits.warehouses}::int, ${p.limits.items}::int, ${p.features.qr}, ${p.features.ship},
              ${p.features.prod}, ${p.features.api}, ${p.published}, ${p.recommended})`,
      ),
    );
    const r = rows[0];
    if (r === undefined) throw new AppError("INTERNAL");
    return { id: r.id, version: Number(r.version) };
  } catch (e) {
    throw mapPlatformError(e);
  }
}

/** Satış sayfası: yayındaki paketler (kimlik gerektirmez; kişisel/müşteri verisi yok). */
export async function listPublishedPlans(db: AccessDbClient): Promise<readonly PublishedPlan[]> {
  const rows = await withUser(db, PLATFORM_NO_USER_ID, (tx) =>
    tx.execute<Omit<DbPlan, "id" | "published" | "version" | "customers">>(sql`SELECT * FROM wms_probe.platform_published_plans()`),
  );
  return rows.map((r) => ({ name: r.name, recommended: r.recommended === true, price: priceText(r.price_monthly), limits: limits(r), features: features(r) }));
}

/** Aktivasyon transaction'ında (tenant bağlamı kurulmuş): paketi boş deneme kaydına önerilen paketi atar; yoksa `null`. */
export async function assignDefaultPlan(tx: AccessTx): Promise<string | null> {
  const rows = await tx.execute<{ id: string | null }>(sql`SELECT wms_probe.platform_assign_default_plan() AS id`);
  return rows[0]?.id ?? null;
}
