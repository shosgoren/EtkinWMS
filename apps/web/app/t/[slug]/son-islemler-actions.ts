"use server";
// T-1053 (STANDART §1, tuval "Son işlemler"): üst çubuktaki Son işlemler penceresinin verisi — çağıranın BUGÜN kendi yaptığı işler
// (`listMyActionsToday`: tenant + yalnız kendi `actor_user_id`, `stock.view`, yerel gün). İnce giriş: zod + koruma; yetki domain'dedir.
// Yalnız eylem anahtarı ve zaman döner (audit ayrıntısı / başka kullanıcı satırı yok).
import { headers } from "next/headers";
import { z } from "zod";
import { getAppDb } from "@wms/db";
import { createProductionGuard, limitVerifiedTenant } from "../../../lib/action-guard.ts";

const guardedAction = createProductionGuard(() => headers());
const schema = z.object({ slug: z.string().min(1).max(63) }).strict();

export async function myTodayActionsAction(raw: unknown) {
  return guardedAction({ schema }, async (i, ctx) => {
    if (ctx.principal === null) throw new Error("unreachable: principal required");
    // Domain modülü çağrıda yüklenir: üst çubuk her kalıp ekranına girer; birim testlerin `@wms/db` taklidi bu zinciri yüklemesin.
    const { listMyActionsToday, TODAY_ACTIONS_MAX_LIMIT } = await import("@wms/domain/audit/today");
    await limitVerifiedTenant({ db: getAppDb(), principal: ctx.principal, tenantSlug: i.slug, permission: "stock.view" }, ctx);
    const page = await listMyActionsToday({ db: getAppDb(), principal: ctx.principal, tenantSlug: i.slug }, { limit: TODAY_ACTIONS_MAX_LIMIT });
    return {
      timeZone: page.timeZone,
      items: page.items.map((it) => ({ at: it.occurredAt.toISOString(), key: it.summaryKey })),
    };
  })(raw);
}
