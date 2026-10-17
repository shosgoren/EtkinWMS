"use server";
// Satış sayfası içeriği (T-407, ADR-027 §6). İnce giriş katmanı: Origin + hız sınırı + hata maskeleme `createProductionGuard`'da (panel
// kipi); operatör/MFA/yakın zamanda doğrulama domain'de, metin kuralları domain + veritabanında. Önizleme bağlantısının sırrı YALNIZ bu
// yanıtta döner (istemci durumunda gösterilir; URL'ye, çereze ya da loga yazılmaz).
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getAppDb } from "@wms/db";
import { createSitePreview, saveSiteContent } from "@wms/domain/platform/site-content";
import { createProductionGuard } from "../../../lib/action-guard.ts";
import { appSurface } from "../../../lib/surface.ts";

const PATH = "/satis";
const INTERNAL_PATH = "/panel/satis";
const guardedAction = createProductionGuard(() => headers(), undefined, "panel");
const schema = z
  .object({
    intent: z.enum(["PREVIEW", "PUBLISH"]),
    title1: z.string().max(400),
    title2: z.string().max(400),
    subtitle: z.string().max(2000),
    planIds: z.array(z.string().max(64)).max(50),
  })
  .strict();

export interface SiteActionState {
  /** Önizleme bağlantısı (yalnız bu yanıtta). */
  readonly link?: string;
  readonly published?: number;
  readonly error?: string;
}

/** Satış sitesinin kökü: `MARKETING_URL` (yerel/deneme ortamı), yoksa etkinyazilim.com. */
function siteBase(): string {
  const configured = process.env.MARKETING_URL?.trim();
  if (configured !== undefined && configured !== "") {
    try {
      const u = new URL(configured);
      if (u.protocol === "https:" || u.protocol === "http:") return u.origin;
    } catch {
      // geçersiz ayar: varsayılan
    }
  }
  return "https://etkinyazilim.com";
}

function plans(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== "string" || raw === "") return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const text = (v: FormDataEntryValue | null): string => (typeof v === "string" ? v : "");

export async function siteContentAction(_prev: SiteActionState, form: FormData): Promise<SiteActionState> {
  if (appSurface() !== "panel") notFound();
  const requestHeaders = await headers();
  const { ensureRecentAuth } = await import("../../../lib/auth-service.ts");
  const result = await guardedAction({ schema }, async (input, ctx): Promise<SiteActionState> => {
    const common = { db: getAppDb(), principal: ctx.principal, recentAuth: () => ensureRecentAuth(requestHeaders) };
    const content = { title1: input.title1, title2: input.title2, subtitle: input.subtitle, planIds: input.planIds };
    if (input.intent === "PREVIEW") {
      const p = await createSitePreview({ ...common, content });
      return { link: `${siteBase()}/?onizleme=${p.token}` };
    }
    const r = await saveSiteContent({ ...common, content, publish: true });
    return { published: r.version };
  })({
    intent: text(form.get("intent")),
    title1: text(form.get("title1")),
    title2: text(form.get("title2")),
    subtitle: text(form.get("subtitle")),
    planIds: plans(form.get("plans")),
  });
  if (!result.ok) {
    if (result.error.code === "UNAUTHENTICATED") {
      redirect(`/login?${result.error.detail === "RECENT_AUTH_REQUIRED" ? "reauth=1&" : ""}next=${encodeURIComponent(PATH)}`);
    }
    if (result.error.code === "FORBIDDEN" && result.error.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(PATH)}`);
    return { error: result.error.detail === undefined ? result.error.code : `${result.error.code}/${result.error.detail}` };
  }
  revalidatePath(INTERNAL_PATH);
  return result.data;
}
