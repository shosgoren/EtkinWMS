// Panel · Ödemeler (T-406, ADR-027 §8; 0043). Şirket kurulana kadar ödeme sağlayıcısı yok: aylık tahakkuk operatörün "Dönem tahakkuku"
// işlemiyle açılır, tahsilat elle "ödendi" işaretlenir (kim/ne zaman kayıtlı). Bütün erişim `wms_probe.platform_*` SECURITY DEFINER
// işlevleriyle (operatör listesi + oturum MFA'sı); yazma işlemleri ayrıca yakın zamanda doğrulama ister.
import { sql } from "drizzle-orm";
import { withUser } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import type { AccessDbClient, AccessPrincipal } from "../identity/access.ts";
import { mapPlatformError, operatorWithRecentAuth, principalOrThrow } from "./demo-requests.ts";

export type ChargeStatus = "PAID" | "OVERDUE" | "PENDING";
export const PAY_METHODS = ["HAVALE", "KART", "NAKIT"] as const;
export type PayMethod = (typeof PAY_METHODS)[number];

export interface ChargeRow {
  readonly id: string;
  readonly tenantId: string;
  readonly company: string;
  /** Abonelik numarası, ör. ABN-0001. */
  readonly ref: string;
  /** Dönemin ilk günü (YYYY-MM-DD). */
  readonly period: string;
  readonly plan: string;
  readonly amount: string;
  readonly dueOn: string;
  readonly status: ChargeStatus;
  readonly paidOn: string | null;
  readonly method: PayMethod | null;
  readonly invoiceNo: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NOTE_MAX = 200;

function dayText(v: unknown): string {
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v);
  if (!DAY.test(s.slice(0, 10))) throw new AppError("INTERNAL");
  return s.slice(0, 10);
}

function priceText(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new AppError("INTERNAL");
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

type DbCharge = {
  id: string;
  tenant_id: string;
  company: string;
  ref: string | null;
  period: Date | string;
  plan_name: string;
  amount: string;
  due_on: Date | string;
  status: string;
  paid_on: Date | string | null;
  paid_method: string | null;
  invoice_no: string | null;
};

export async function listCharges(params: { readonly db: AccessDbClient; readonly principal: AccessPrincipal | null }): Promise<readonly ChargeRow[]> {
  const principal = principalOrThrow(params.principal);
  try {
    const rows = await withUser(params.db, principal.userId, (tx) => tx.execute<DbCharge>(sql`SELECT * FROM wms_probe.platform_list_charges()`));
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      company: r.company,
      ref: r.ref ?? "—",
      period: dayText(r.period),
      plan: r.plan_name,
      amount: priceText(r.amount),
      dueOn: dayText(r.due_on),
      status: r.status === "PAID" ? "PAID" : r.status === "OVERDUE" ? "OVERDUE" : "PENDING",
      paidOn: r.paid_on === null ? null : dayText(r.paid_on),
      method: PAY_METHODS.find((m) => m === r.paid_method) ?? null,
      invoiceNo: r.invoice_no,
    }));
  } catch (e) {
    throw mapPlatformError(e);
  }
}

interface WriteParams {
  readonly db: AccessDbClient;
  readonly principal: AccessPrincipal | null;
  readonly recentAuth: () => Promise<void>;
}

/** Bu ayın tahakkuklarını açar; açılan adet (var olanlar atlanır). */
export async function accrueCharges(params: WriteParams): Promise<number> {
  principalOrThrow(params.principal);
  const principal = await operatorWithRecentAuth(params);
  try {
    const rows = await withUser(params.db, principal.userId, (tx) => tx.execute<{ n: number }>(sql`SELECT wms_probe.platform_accrue_charges() AS n`));
    return Number(rows[0]?.n ?? 0);
  } catch (e) {
    throw mapPlatformError(e);
  }
}

/** Tahakkuku ödendi işaretler (geri alınmaz). Zaten ödenmişse `false`. Tarih YYYY-MM-DD. */
export async function markChargePaid(
  params: WriteParams & { readonly chargeId: string; readonly paidOn: string; readonly method: string; readonly note?: string | null },
): Promise<boolean> {
  principalOrThrow(params.principal);
  if (typeof params.chargeId !== "string" || !UUID.test(params.chargeId)) throw new AppError("VALIDATION_FAILED");
  if (typeof params.paidOn !== "string" || !DAY.test(params.paidOn) || Number.isNaN(Date.parse(`${params.paidOn}T00:00:00Z`))) {
    throw new AppError("VALIDATION_FAILED", { detail: "PAYMENT_INVALID" });
  }
  const method = PAY_METHODS.find((m) => m === params.method);
  if (method === undefined) throw new AppError("VALIDATION_FAILED", { detail: "PAYMENT_INVALID" });
  const note = typeof params.note === "string" ? params.note.trim().replace(/\s+/g, " ") : "";
  if (note.length > NOTE_MAX || /\p{Cc}/u.test(note)) throw new AppError("VALIDATION_FAILED", { detail: "PAYMENT_INVALID" });
  const principal = await operatorWithRecentAuth(params);
  try {
    const rows = await withUser(params.db, principal.userId, (tx) =>
      tx.execute<{ changed: boolean }>(
        sql`SELECT wms_probe.platform_mark_charge_paid(${params.chargeId}::uuid, ${params.paidOn}::date, ${method}, ${note === "" ? null : note}) AS changed`,
      ),
    );
    return rows[0]?.changed === true;
  } catch (e) {
    const err = mapPlatformError(e);
    if (err instanceof AppError && err.code === "VALIDATION_FAILED" && err.detail === undefined) {
      const out = new AppError("VALIDATION_FAILED", { detail: "PAYMENT_INVALID" });
      out.cause = e;
      throw out;
    }
    throw err;
  }
}
