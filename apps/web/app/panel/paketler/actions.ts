"use server";
// Paket kaydı (T-404, ADR-027 §4). İnce giriş katmanı: Origin + hız sınırı + hata maskeleme `createProductionGuard`'da (panel kipi);
// operatör/MFA/yakın zamanda doğrulama ve sürümleme domain'de (`savePlan`) ve veritabanı işlevinde.
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getAppDb } from "@wms/db";
import { savePlan } from "@wms/domain/platform/plans";
import { createProductionGuard } from "../../../lib/action-guard.ts";
import { appSurface } from "../../../lib/surface.ts";

const PATH = "/paketler";
const INTERNAL_PATH = "/panel/paketler";
const guardedAction = createProductionGuard(() => headers(), undefined, "panel");
const int = z.number().int().min(0).max(10_000_000);
const schema = z
  .object({
    id: z.string().max(64),
    intent: z.enum(["DRAFT", "PUBLISH"]),
    name: z.string().max(200),
    price: z.string().max(32),
    limits: z.object({ admins: int, field: int, warehouses: int, items: int }).strict(),
    features: z.object({ qr: z.boolean(), ship: z.boolean(), prod: z.boolean(), api: z.boolean() }).strict(),
    recommended: z.boolean(),
  })
  .strict();

export interface PlanActionState {
  readonly error?: string;
}

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

function count(v: string): number {
  const n = Number.parseInt(v.replace(/\D/g, ""), 10);
  return Number.isNaN(n) ? -1 : n;
}

function features(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export async function savePlanAction(_prev: PlanActionState, form: FormData): Promise<PlanActionState> {
  if (appSurface() !== "panel") notFound();
  const requestHeaders = await headers();
  const { ensureRecentAuth } = await import("../../../lib/auth-service.ts");
  const result = await guardedAction({ schema }, async (input, ctx) => {
    const published = input.intent === "PUBLISH";
    return savePlan({
      db: getAppDb(),
      principal: ctx.principal,
      recentAuth: () => ensureRecentAuth(requestHeaders),
      id: input.id === "" ? null : input.id,
      plan: {
        name: input.name,
        price: input.price,
        limits: input.limits,
        features: input.features,
        published,
        recommended: published && input.recommended,
      },
    });
  })({
    id: field(form, "id"),
    intent: field(form, "intent"),
    name: field(form, "name"),
    price: field(form, "price"),
    limits: {
      admins: count(field(form, "lim_admins")),
      field: count(field(form, "lim_field")),
      warehouses: count(field(form, "lim_warehouses")),
      items: count(field(form, "lim_items")),
    },
    features: features(field(form, "features")),
    recommended: field(form, "recommended") === "1",
  });
  if (!result.ok) {
    if (result.error.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(PATH)}`);
    if (result.error.code === "FORBIDDEN" && result.error.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(PATH)}`);
    return { error: result.error.detail === undefined ? result.error.code : `${result.error.code}/${result.error.detail}` };
  }
  revalidatePath(INTERNAL_PATH);
  redirect(`${PATH}?p=${encodeURIComponent(result.data.id)}`);
}
