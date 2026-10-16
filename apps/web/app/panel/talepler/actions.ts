"use server";
// Demo talebi kararı ve yeni aktivasyon bağlantısı (T-994 → panel, ADR-027 §1; T-995 ADR-026 §3.3). İnce giriş katmanı: Origin + hız
// sınırı + hata maskeleme `createProductionGuard`'da; panel kipi burada, operatör/MFA/yakın zamanda doğrulama domain'de (operatör
// veritabanında). Ekranda teslimde (posta kapalı) düz bağlantı YALNIZ bu yanıtta döner (istemci durumunda gösterilir; URL'ye, çereze ya da
// loga yazılmaz).
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { decideDemoRequest, reissueActivation, type ActivationDeliveryDeps } from "@wms/domain/platform/demo-requests";
import { getAppDb } from "@wms/db";
import { assertMailModeAllowed, loadMailConfig } from "@wms/shared/mailer";
import { createProductionGuard } from "../../../lib/action-guard.ts";
import { getSenderQueue } from "../../../lib/queue.ts";
import { appSurface } from "../../../lib/surface.ts";

const PATH = "/talepler";
const INTERNAL_PATH = "/panel/talepler";
const guardedAction = createProductionGuard(() => headers(), undefined, "panel");
const schema = z.object({ id: z.string().max(64), intent: z.enum(["APPROVED", "REJECTED", "REISSUE"]) }).strict();

export interface TaleplerActionState {
  /** Ekranda teslim: müşteriye iletilecek tek seferlik bağlantı. */
  readonly link?: string;
  readonly error?: string;
}

const unavailableQueue: ActivationDeliveryDeps["queue"] = {
  enqueuePlatform: () => Promise.reject(new Error("job queue is not available in the web process")),
};

function log(entry: Readonly<Record<string, unknown>>): void {
  console.error(JSON.stringify(entry));
}

/** Aktivasyon bağlantısının kökü müşteri uygulamasıdır (panel kökü değil): `WMS_APP_URL`; tek kipli ortamda istek kökeni. */
function appBase(origin: string): string | undefined {
  const configured = process.env.WMS_APP_URL?.trim();
  if (configured !== undefined && configured !== "") {
    try {
      const u = new URL(configured);
      if (u.protocol === "https:" || u.protocol === "http:") return u.origin;
    } catch {
      return undefined;
    }
    return undefined;
  }
  return appSurface() === "panel" ? undefined : origin;
}

export async function demoRequestAction(_prev: TaleplerActionState, form: FormData): Promise<TaleplerActionState> {
  if (appSurface() !== "panel") notFound();
  const id = form.get("id");
  const intent = form.get("intent");
  const requestHeaders = await headers();
  const { ensureRecentAuth } = await import("../../../lib/auth-service.ts");
  const result = await guardedAction({ schema }, async (input, ctx) => {
    const mailConfig = loadMailConfig(process.env);
    assertMailModeAllowed(mailConfig, process.env.WMS_ENV?.trim());
    const base = appBase(ctx.origin);
    if (base === undefined) throw new Error("WMS_APP_URL is not configured for the panel");
    const deps: ActivationDeliveryDeps = { mailConfig, queue: (await getSenderQueue()) ?? unavailableQueue, log };
    const common = { db: getAppDb(), principal: ctx.principal, id: input.id, recentAuth: () => ensureRecentAuth(requestHeaders) };
    const issued =
      input.intent === "REISSUE"
        ? await reissueActivation(common, deps)
        : (await decideDemoRequest({ ...common, decision: input.intent }, deps)).activation;
    return { link: issued?.token === undefined ? undefined : `${base}/activate/${issued.token}` };
  })({ id: typeof id === "string" ? id : "", intent: typeof intent === "string" ? intent : "" });
  if (!result.ok) {
    if (result.error.code === "UNAUTHENTICATED") {
      // Yakın zamanda doğrulama gerekiyorsa giriş sayfası açık oturumda da formu gösterir (`reauth=1`); yoksa döngü olur.
      const reauth = result.error.detail === "RECENT_AUTH_REQUIRED" ? "reauth=1&" : "";
      redirect(`/login?${reauth}next=${encodeURIComponent(PATH)}`);
    }
    if (result.error.code === "FORBIDDEN" && result.error.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(PATH)}`);
    revalidatePath(INTERNAL_PATH);
    return { error: result.error.code };
  }
  revalidatePath(INTERNAL_PATH);
  return result.data.link === undefined ? {} : { link: result.data.link };
}
