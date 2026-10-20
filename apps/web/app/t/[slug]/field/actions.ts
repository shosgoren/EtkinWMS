"use server";
// T-969 (B-86): OKUT ekranının tek eylemi — okutulan kodu çözer ve gidilecek ekranı söyler. İnce giriş: zod + domain okuma sorgusu
// (`resolveFieldScan`, stock.view, tenant/RLS/depo kapsamı domain'de). Yazma yok. Yazma yetkisi (`stock.post`) yalnız YÖNLENDİRME için
// sorulur (yazma ekranı mı okuma ekranı mı); asıl yetki kararı gidilen ekranın komutundadır. Başka tenant'ın kodu `unknown` döner.
import { headers } from "next/headers";
import { z } from "zod";
import { getAppDb } from "@wms/db";
import { runTenantQuery } from "@wms/domain/identity/access";
import { FIELD_SCAN_CODE_MAX, findFieldWork, resolveCurrentPackageQr, resolveFieldScan, type FieldWork } from "@wms/domain/operations";
import { AppError } from "@wms/shared/errors";
import { createProductionGuard } from "../../../../lib/action-guard.ts";
import { packageReceivingEnabled } from "../../../../lib/package-receiving-config.ts";

const guardedAction = createProductionGuard(() => headers());
const schema = z.object({ slug: z.string().min(1).max(63), code: z.string().min(1).max(FIELD_SCAN_CODE_MAX) }).strict();

export type FieldScanTarget =
  | { readonly kind: "receive" | "putaway" | "item" | "stock" | "receipts" | "package" | "pick" | "count"; readonly href: string; readonly name: string; readonly sub: string }
  | { readonly kind: "unknown"; readonly reason: "not_found" | "ambiguous" };

const PKG_PREFIX = "EWMS:PKG:";

export async function resolveFieldScanAction(raw: unknown) {
  return guardedAction({ schema }, async (input, ctx): Promise<FieldScanTarget> => {
    if (ctx.principal === null) throw new AppError("UNAUTHENTICATED");
    const params = { db: getAppDb(), principal: ctx.principal, tenantSlug: input.slug };
    const base = `/t/${encodeURIComponent(input.slug)}`;
    const code = input.code.trim();
    // Paket QR (EWMS:PKG:1:<uuid>): paket akışı açıksa paket ekranı; kapalıysa tanınmayan kod (ekran yok, sahte bağlantı yok).
    if (code.startsWith(PKG_PREFIX)) {
      if (!packageReceivingEnabled()) return { kind: "unknown", reason: "not_found" };
      try {
        const p = await resolveCurrentPackageQr(params, { qr: code });
        return { kind: "package", href: `${base}/field/packages?${new URLSearchParams({ package: p.id })}`, name: p.itemName, sub: p.itemCode };
      } catch (e) {
        if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "VALIDATION_FAILED")) return { kind: "unknown", reason: "not_found" };
        throw e;
      }
    }
    const found = await resolveFieldScan(params, { code });
    if (found.kind === "unknown") return found;
    const canPost = await runTenantQuery({ ...params, permission: "stock.post" }, () => Promise.resolve(true)).catch((e: unknown) => {
      if (e instanceof AppError && e.code === "FORBIDDEN" && e.detail === undefined) return false;
      throw e;
    });
    const q = (o: Record<string, string>): string => new URLSearchParams(o).toString();
    // T-977: okutulan raf/ürün bekleyen bir toplama ya da sayım işine aitse o işe gidilir. Sıra: bana atanmış iş → (ürün) bekleyen kabul →
    // üstlenilebilir iş → eski hedefler. Görev listesi domain'de yetki + kapsamla süzülür; gidilen ekranın komutu yeniden denetler.
    const work: FieldWork =
      found.kind === "item" ? await findFieldWork(params, { itemId: found.itemId }) : found.kind === "location" ? await findFieldWork(params, { locationId: found.locationId }) : { pick: null, count: null };
    const pickTo = (taskId: string, name: string, sub: string, withCode: boolean): FieldScanTarget => ({ kind: "pick", href: `${base}/field/pick?${q({ task: taskId, ...(withCode ? { code } : {}) })}`, name, sub });
    const countTo = (taskId: string, name: string, sub: string): FieldScanTarget => ({ kind: "count", href: `${base}/field/count?${q({ task: taskId, code })}`, name, sub });
    if (found.kind === "location") {
      const label = found.name || found.code;
      if (work.count?.mine === true) return countTo(work.count.taskId, label, found.code);
      if (work.pick?.mine === true) return pickTo(work.pick.taskId, label, found.code, true);
      if (work.count !== null) return countTo(work.count.taskId, label, found.code);
      if (work.pick !== null) return pickTo(work.pick.taskId, label, found.code, true);
    }
    if (found.kind === "item" && work.pick !== null && (work.pick.mine || found.receipt === null)) {
      return pickTo(work.pick.taskId, found.itemName, found.itemCode, false);
    }
    switch (found.kind) {
      case "item":
        if (canPost && found.receipt !== null) {
          return { kind: "receive", href: `${base}/field/receive?${q({ receipt: found.receipt.id, code })}`, name: found.itemName, sub: `${found.itemCode} · ${found.receipt.number}` };
        }
        return { kind: "item", href: `${base}/items/${encodeURIComponent(found.itemId)}`, name: found.itemName, sub: found.itemCode };
      case "receipt":
        return canPost
          ? { kind: "receive", href: `${base}/field/receive?${q({ receipt: found.receipt.id })}`, name: found.receipt.number, sub: "" }
          : { kind: "receipts", href: `${base}/receipts`, name: found.receipt.number, sub: "" };
      case "location":
        return canPost
          ? { kind: "putaway", href: `${base}/field/putaway?${q({ wh: found.warehouseId, code })}`, name: found.name || found.code, sub: found.code }
          : { kind: "stock", href: `${base}/stock?${q({ warehouse: found.warehouseId })}`, name: found.name || found.code, sub: found.code };
    }
  })(raw);
}
