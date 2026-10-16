// Panel · Müşteriler (T-403, ADR-027 §2–3; 0042). Yalnız sayılar ve işletim durumu: kullanıcı/depo/kalem sayıları, son giriş, bu ayki
// hareket sayısı, paket ve deneme bitişi. Tenant içeriği (ürün, stok, kişi) hiçbir yoldan gelmez. Bütün erişim `wms_probe.platform_*`
// SECURITY DEFINER işlevleriyle (operatör listesi + oturum MFA'sı); yazma işlemleri ayrıca yakın zamanda doğrulama ister.
import { sql } from "drizzle-orm";
import { withUser } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import type { AccessDbClient, AccessPrincipal } from "../identity/access.ts";
import { mapPlatformError, operatorWithRecentAuth, principalOrThrow } from "./demo-requests.ts";
import type { PlanLimits } from "./plans.ts";

/** Panel durumu: AKTİF / DENEME / ASKIDA (GECİKMEDE ödeme entegrasyonuyla, T-406). */
export type CustomerState = "ACTIVE" | "TRIAL" | "SUSPENDED";

export interface CustomerRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly state: CustomerState;
  readonly createdAt: Date;
  readonly trialEndsAt: Date | null;
  readonly plan: { readonly id: string; readonly name: string; readonly price: string; readonly limits: PlanLimits } | null;
  readonly counts: { readonly admins: number; readonly field: number; readonly warehouses: number; readonly items: number };
  readonly lastLogin: Date | null;
}

export type CustomerEventKind =
  | "SUSPENDED"
  | "RESUMED"
  | "TRIAL_EXTENDED"
  | "PLAN_CHANGED"
  | "PLAN_ASSIGNED"
  | "TRIAL_STARTED"
  | "DEMO_APPROVED";

export interface CustomerEvent {
  readonly at: Date;
  readonly kind: CustomerEventKind;
  /** Askıya alma gerekçesi (operatörün yazdığı). */
  readonly reason?: string;
  readonly planId?: string;
  readonly fromPlanId?: string;
  readonly trialEndsAt?: Date;
}

export interface CustomerActivity {
  readonly movesThisMonth: number;
  readonly history: readonly CustomerEvent[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASON_MAX = 300;

const KIND: Record<string, CustomerEventKind> = {
  "platform.tenant.suspended": "SUSPENDED",
  "platform.tenant.resumed": "RESUMED",
  "platform.trial.extended": "TRIAL_EXTENDED",
  "platform.plan.changed": "PLAN_CHANGED",
  "platform.plan.assigned": "PLAN_ASSIGNED",
  "trial.started": "TRIAL_STARTED",
  "demo.approved": "DEMO_APPROVED",
};

function date(v: unknown): Date {
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new AppError("INTERNAL");
  return d;
}

function priceText(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new AppError("INTERNAL");
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function tenantId(id: unknown): string {
  if (typeof id !== "string" || !UUID.test(id)) throw new AppError("VALIDATION_FAILED");
  return id;
}

type DbCustomer = {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: Date | string;
  subscription: string | null;
  trial_ends_at: Date | string | null;
  plan_id: string | null;
  plan_name: string | null;
  price_monthly: string | null;
  max_admins: number | null;
  max_field: number | null;
  max_warehouses: number | null;
  max_items: number | null;
  admins: number;
  field: number;
  warehouses: number;
  items: number;
  last_login: Date | string | null;
};

export async function listCustomers(params: { readonly db: AccessDbClient; readonly principal: AccessPrincipal | null }): Promise<readonly CustomerRow[]> {
  const principal = principalOrThrow(params.principal);
  try {
    const rows = await withUser(params.db, principal.userId, (tx) => tx.execute<DbCustomer>(sql`SELECT * FROM wms_probe.platform_list_customers()`));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      state: r.status === "SUSPENDED" ? "SUSPENDED" : r.subscription === "TRIAL" ? "TRIAL" : "ACTIVE",
      createdAt: date(r.created_at),
      trialEndsAt: r.subscription === "TRIAL" && r.trial_ends_at !== null ? date(r.trial_ends_at) : null,
      plan:
        r.plan_id === null
          ? null
          : {
              id: r.plan_id,
              name: r.plan_name ?? "",
              price: priceText(r.price_monthly),
              limits: { admins: Number(r.max_admins), field: Number(r.max_field), warehouses: Number(r.max_warehouses), items: Number(r.max_items) },
            },
      counts: { admins: Number(r.admins), field: Number(r.field), warehouses: Number(r.warehouses), items: Number(r.items) },
      lastLogin: r.last_login === null ? null : date(r.last_login),
    }));
  } catch (e) {
    throw mapPlatformError(e);
  }
}

export async function getCustomerActivity(params: {
  readonly db: AccessDbClient;
  readonly principal: AccessPrincipal | null;
  readonly tenantId: string;
}): Promise<CustomerActivity> {
  const principal = principalOrThrow(params.principal);
  const id = tenantId(params.tenantId);
  try {
    const rows = await withUser(params.db, principal.userId, (tx) =>
      tx.execute<{ moves_month: number; at: Date | string | null; kind: string | null; info: Record<string, unknown> | null }>(
        sql`SELECT * FROM wms_probe.platform_customer_activity(${id}::uuid)`,
      ),
    );
    const history: CustomerEvent[] = [];
    for (const r of rows) {
      if (r.kind === null || r.at === null) continue;
      const kind = KIND[r.kind];
      if (kind === undefined) continue;
      const info = r.info ?? {};
      history.push({
        at: date(r.at),
        kind,
        ...(typeof info.reason === "string" ? { reason: info.reason } : {}),
        ...(typeof info.plan_id === "string" ? { planId: info.plan_id } : {}),
        ...(typeof info.from_plan_id === "string" ? { fromPlanId: info.from_plan_id } : {}),
        ...(typeof info.trial_ends_at === "string" ? { trialEndsAt: date(info.trial_ends_at) } : {}),
      });
    }
    return { movesThisMonth: Number(rows[0]?.moves_month ?? 0), history };
  } catch (e) {
    throw mapPlatformError(e);
  }
}

interface WriteParams {
  readonly db: AccessDbClient;
  readonly principal: AccessPrincipal | null;
  readonly recentAuth: () => Promise<void>;
  readonly tenantId: string;
}

/** Askıya al (gerekçe zorunlu, en çok 300 karakter) ya da devam ettir. Durum zaten istenen değerdeyse `false`. */
export async function setCustomerSuspended(params: WriteParams & { readonly suspend: boolean; readonly reason?: string | null }): Promise<boolean> {
  principalOrThrow(params.principal);
  const id = tenantId(params.tenantId);
  const reason = typeof params.reason === "string" ? params.reason.trim().replace(/\s+/g, " ") : "";
  if (params.suspend && reason === "") throw new AppError("VALIDATION_FAILED", { detail: "REASON_REQUIRED" });
  if (reason.length > REASON_MAX || /\p{Cc}/u.test(reason)) throw new AppError("VALIDATION_FAILED");
  const principal = await operatorWithRecentAuth(params);
  try {
    const rows = await withUser(params.db, principal.userId, (tx) =>
      tx.execute<{ changed: boolean }>(
        sql`SELECT wms_probe.platform_set_customer_status(${id}::uuid, ${params.suspend}, ${reason === "" ? null : reason}) AS changed`,
      ),
    );
    return rows[0]?.changed === true;
  } catch (e) {
    throw mapPlatformError(e);
  }
}

/** Denemeyi 30 gün uzatır; yeni bitiş tarihi. */
export async function extendCustomerTrial(params: WriteParams): Promise<Date> {
  principalOrThrow(params.principal);
  const id = tenantId(params.tenantId);
  const principal = await operatorWithRecentAuth(params);
  try {
    const rows = await withUser(params.db, principal.userId, (tx) =>
      tx.execute<{ ends: Date | string }>(sql`SELECT wms_probe.platform_extend_trial(${id}::uuid) AS ends`),
    );
    const r = rows[0];
    if (r === undefined) throw new AppError("INTERNAL");
    return date(r.ends);
  } catch (e) {
    throw mapPlatformError(e);
  }
}

/** Müşteriye paketin güncel sürümünü atar. Değişmediyse `false`. */
export async function changeCustomerPlan(params: WriteParams & { readonly planId: string }): Promise<boolean> {
  principalOrThrow(params.principal);
  const id = tenantId(params.tenantId);
  const plan = tenantId(params.planId);
  const principal = await operatorWithRecentAuth(params);
  try {
    const rows = await withUser(params.db, principal.userId, (tx) =>
      tx.execute<{ changed: boolean }>(sql`SELECT wms_probe.platform_change_customer_plan(${id}::uuid, ${plan}::uuid) AS changed`),
    );
    return rows[0]?.changed === true;
  } catch (e) {
    throw mapPlatformError(e);
  }
}
