import { sql } from "drizzle-orm";
import { appendAudit } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { runTenantCommand, runTenantQuery } from "../identity/access.ts";
import type { ConnectionCallParams } from "./connections.ts";

export async function getProductBarcodeSetting(params: ConnectionCallParams): Promise<boolean> {
  return runTenantQuery({ ...params, permission: "settings.manage" }, async (tx, m) => {
    const rows = await tx.execute<{ enabled: boolean }>(sql`SELECT pull_product_barcodes AS enabled FROM public.integrations WHERE tenant_id=${m.tenantId}::uuid AND provider='PARASUT'`);
    return rows[0]?.enabled === true;
  });
}

export async function setProductBarcodeSetting(params: ConnectionCallParams, input: { readonly enabled: boolean; readonly requestId?: string | null }): Promise<{ readonly changed: boolean }> {
  if (typeof input.enabled !== "boolean") throw new AppError("VALIDATION_FAILED");
  return runTenantCommand({ ...params, permission: "settings.manage" }, async (tx, m) => {
    const demo = await tx.execute<{ is_demo: boolean }>(sql`SELECT is_demo FROM public.tenants WHERE id=${m.tenantId}::uuid`);
    if (demo[0]?.is_demo) throw new AppError("FORBIDDEN");
    const rows = await tx.execute<{ id: string; pull_product_barcodes: boolean }>(sql`SELECT id, pull_product_barcodes FROM public.integrations WHERE tenant_id=${m.tenantId}::uuid AND provider='PARASUT' AND status<>'DISCONNECTED' FOR UPDATE`);
    const row = rows[0];
    if (row === undefined) throw new AppError("NOT_FOUND");
    if (row.pull_product_barcodes === input.enabled) return { changed: false };
    await tx.execute(sql`UPDATE public.integrations SET pull_product_barcodes=${input.enabled} WHERE tenant_id=${m.tenantId}::uuid AND id=${row.id}::uuid`);
    await appendAudit(tx, { action: "integration.flow_changed", actorUserId: m.userId, entityType: "integration", entityId: row.id, requestId: input.requestId ?? null,
      changeSummary: { provider: "PARASUT", flow: "PRODUCTS", pull_product_barcodes: input.enabled, before: row.pull_product_barcodes } });
    return { changed: true };
  });
}
