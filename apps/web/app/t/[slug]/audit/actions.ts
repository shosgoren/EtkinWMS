"use server";
// Denetim kaydı eylemleri (T-1059). İnce giriş: yalnız girdi doğrulama (zod) + domain okuması; yetki (`audit.view`), süzgeç ve imleç doğrulaması
// domain'dedir (`listAudit`). Bu dosyada DB bağlantısı açılmaz (`getAppDb` yalnız domain'e verilir).
import { headers } from "next/headers";
import { z } from "zod";
import { getAppDb } from "@wms/db";
import { listAudit, type AuditFilters } from "@wms/domain/audit/audit-query";
import { createProductionGuard } from "../../../../lib/action-guard.ts";
import { denetimSatirlari } from "./satirlar.ts";

const guardedAction = createProductionGuard(() => headers());

const moreSchema = z
  .object({
    slug: z.string().min(1).max(63),
    filters: z.object({ from: z.string().max(32).optional(), to: z.string().max(32).optional(), action: z.string().max(64).optional(), q: z.string().max(200).optional() }).strict(),
    cursor: z.string().min(1).max(512),
  })
  .strict();

/** Liste sonuna yaklaşınca sonraki denetim kayıtları (aynı süzgeç). */
export async function loadMoreAuditAction(raw: unknown) {
  return guardedAction({ schema: moreSchema }, async (input, ctx) => {
    const principal = ctx.principal;
    if (principal === null) throw new Error("unreachable: principal required");
    const filters: { from?: string; to?: string; action?: string; q?: string } = {};
    for (const k of ["from", "to", "action", "q"] as const) {
      const v = input.filters[k];
      if (v !== undefined && v !== "") filters[k] = v;
    }
    const page = await listAudit({ db: getAppDb(), principal, tenantSlug: input.slug }, { filters: filters as AuditFilters, cursor: input.cursor });
    return { rows: await denetimSatirlari(page), next: page.nextCursor };
  })(raw);
}
