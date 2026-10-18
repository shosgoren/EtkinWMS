// Görev ayrılığı (T-416, A-03; 0049). Firma ayarı, varsayılan KAPALI. Açıkken aynı kişi bir işlemin hem hazırlayan hem onaylayan tarafı
// olamaz: belgeyi oluşturan onaylayamaz; sayım satırı sayan fark onaylayamaz; belgeyi oluşturan ya da işleyen ters kayıt yapamaz.
// Denetimler komutun transaction'ında, kilitli kayıtlar okunduktan sonra yapılır. Saha akışlarının kendi oluşturduğu belgeyi aynı komutta
// onaylaması bu kurala girmez (kullanıcı kararı değil, akışın parçası).
import { sql } from "drizzle-orm";
import { AppError } from "@wms/shared/errors";
import { runTenantCommand, type AccessTx, type TenantAccessParams } from "./access.ts";
import { appendAudit } from "@wms/db";

export const SOD_DETAIL = "SEPARATION_OF_DUTIES";

/** Firma ayarı (satır yoksa kapalı). */
export async function separationOfDutiesEnabled(tx: AccessTx, tenantId: string): Promise<boolean> {
  const rows = await tx.execute<{ sod: boolean }>(
    sql`SELECT separation_of_duties AS sod FROM public.tenant_settings WHERE tenant_id = ${tenantId}::uuid`,
  );
  return rows[0]?.sod === true;
}

/** Ayar açıksa ve `actor` yasaklı kişilerden biriyse `FORBIDDEN`/`SEPARATION_OF_DUTIES`. Karşılaştırma büyük/küçük harf duyarsız. */
export async function assertSeparated(tx: AccessTx, tenantId: string, actor: string, forbidden: readonly (string | null | undefined)[]): Promise<void> {
  const a = actor.toLowerCase();
  if (!forbidden.some((f) => typeof f === "string" && f.toLowerCase() === a)) return;
  if (!(await separationOfDutiesEnabled(tx, tenantId))) return;
  throw new AppError("FORBIDDEN", { detail: SOD_DETAIL });
}

export type SetSeparationParams = Omit<TenantAccessParams, "permission"> & { readonly enabled: boolean; readonly requestId?: string | null };

/** `settings.manage` + yeniden giriş (fail-closed). Değişiklik yoksa yazmaz. Kayıt `tenant.settings_changed`. */
export async function setSeparationOfDuties(params: SetSeparationParams): Promise<{ readonly changed: boolean }> {
  const { enabled, requestId, ...access } = params;
  if (typeof enabled !== "boolean") throw new AppError("VALIDATION_FAILED");
  if (access.recentAuth === undefined) throw new AppError("UNAUTHENTICATED", { detail: "RECENT_AUTH_REQUIRED" });
  return runTenantCommand({ ...access, permission: "settings.manage" }, async (tx, m) => {
    const rows = await tx.execute<{ sod: boolean }>(
      sql`SELECT separation_of_duties AS sod FROM public.tenant_settings WHERE tenant_id = ${m.tenantId}::uuid FOR UPDATE`,
    );
    const prev = rows[0];
    if (prev === undefined) throw new AppError("NOT_FOUND");
    if (prev.sod === enabled) return { changed: false };
    await tx.execute(sql`UPDATE public.tenant_settings SET separation_of_duties = ${enabled} WHERE tenant_id = ${m.tenantId}::uuid`);
    await appendAudit(tx, {
      action: "tenant.settings_changed",
      actorUserId: m.userId,
      entityType: "tenant",
      entityId: m.tenantId,
      requestId: requestId ?? null,
      changeSummary: { separationOfDuties: { from: prev.sod, to: enabled } },
    });
    return { changed: true };
  });
}
