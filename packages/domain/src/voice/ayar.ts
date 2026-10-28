// T-1109 (B-134; kullanıcı kararı 22 Ekim): Etkin sesli yanıt firma ayarı (0063 `tenant_settings.voice_reply`, varsayılan KAPALI).
// Okuma her üyenin (`stock.view`; yalnız bu bayrak döner). Yazma `settings.manage`; değişiklik yoksa yazmaz, kayıt `tenant.settings_changed`.
// Yeniden giriş istenmez: güvenlik denetimi değil, sunum tercihidir (görev ayrılığından farkı bilinçli).
import { sql } from "drizzle-orm";
import { appendAudit } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { runTenantCommand, runTenantQuery, type TenantAccessParams } from "../identity/access.ts";

type Params = Omit<TenantAccessParams, "permission" | "recentAuth">;

/** Firma sesli yanıtı açık mı (satır yoksa kapalı). */
export async function getVoiceReply(params: Params): Promise<boolean> {
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, m) => {
    const rows = await tx.execute<{ v: boolean }>(sql`SELECT voice_reply AS v FROM public.tenant_settings WHERE tenant_id = ${m.tenantId}::uuid`);
    return rows[0]?.v === true;
  });
}

export type SetVoiceReplyParams = Params & { readonly enabled: boolean; readonly requestId?: string | null };

export async function setVoiceReply(params: SetVoiceReplyParams): Promise<{ readonly changed: boolean }> {
  const { enabled, requestId, ...access } = params;
  if (typeof enabled !== "boolean") throw new AppError("VALIDATION_FAILED");
  return runTenantCommand({ ...access, permission: "settings.manage" }, async (tx, m) => {
    const rows = await tx.execute<{ v: boolean }>(
      sql`SELECT voice_reply AS v FROM public.tenant_settings WHERE tenant_id = ${m.tenantId}::uuid FOR UPDATE`,
    );
    const prev = rows[0];
    if (prev === undefined) throw new AppError("NOT_FOUND");
    if (prev.v === enabled) return { changed: false };
    await tx.execute(sql`UPDATE public.tenant_settings SET voice_reply = ${enabled} WHERE tenant_id = ${m.tenantId}::uuid`);
    await appendAudit(tx, {
      action: "tenant.settings_changed",
      actorUserId: m.userId,
      entityType: "tenant",
      entityId: m.tenantId,
      requestId: requestId ?? null,
      changeSummary: { voiceReply: { from: prev.v, to: enabled } },
    });
    return { changed: true };
  });
}
