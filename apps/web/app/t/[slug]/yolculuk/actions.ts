"use server";
// T-1006: ilk kurulum yolculuğu — ince giriş katmanı. Rol kararı (yalnız hesap sahibi / depo yöneticisi), tamamlanma hesabı (gerçek veri)
// ve audit domain'dedir (`@wms/domain/onboarding/journey`); burada Origin + hız sınırı + hata maskeleme (`createProductionGuard`).
import { headers } from "next/headers";
import { z } from "zod";
import { getAppDb } from "@wms/db";
import { JOURNEY_STEPS, getSetupJourney, markLabelsPrinted, setJourneyChoice } from "@wms/domain/onboarding/journey";
import { createProductionGuard, limitVerifiedTenant, type ActionContext } from "../../../../lib/action-guard.ts";
import { toJourneyData as serialize } from "./serialize.ts";

const guardedAction = createProductionGuard(() => headers());
const slug = z.string().min(1).max(63);
const step = z.enum(JOURNEY_STEPS);
const readSchema = z.object({ slug }).strict();
const choiceSchema = z
  .object({
    slug,
    skip: step.optional(),
    unskip: step.optional(),
    makesProduction: z.boolean().optional(),
    cardSource: z.enum(["EXCEL", "PARASUT"]).optional(),
    openingStockWanted: z.boolean().optional(),
    dismiss: z.literal(true).optional(),
    tour: z.enum(["start", "close"]).optional(),
  })
  .strict();

function principalOf(ctx: ActionContext) {
  if (ctx.principal === null) throw new Error("unreachable: principal required");
  return ctx.principal;
}

export async function getJourneyAction(raw: unknown) {
  return guardedAction({ schema: readSchema }, async (i, ctx) => serialize(await getSetupJourney({ db: getAppDb(), principal: principalOf(ctx), tenantSlug: i.slug })))(raw);
}

export async function setJourneyChoiceAction(raw: unknown) {
  return guardedAction({ schema: choiceSchema }, async (i, ctx) => {
    const a = { db: getAppDb(), principal: principalOf(ctx), tenantSlug: i.slug };
    await limitVerifiedTenant({ ...a, permission: "stock.view" }, ctx);
    const { slug: _s, ...choice } = i;
    void _s;
    return serialize(await setJourneyChoice(a, { ...choice, requestId: ctx.requestId }));
  })(raw);
}

/** Etiket ekranı YAZDIR: yolculuk adım 4'ün gerçek kaydı (ilk yazdırma). */
export async function markLabelsPrintedAction(raw: unknown) {
  return guardedAction({ schema: readSchema }, async (i, ctx) => {
    const a = { db: getAppDb(), principal: principalOf(ctx), tenantSlug: i.slug };
    await limitVerifiedTenant({ ...a, permission: "stock.view" }, ctx);
    return markLabelsPrinted(a);
  })(raw);
}
