// Panel kapısı (ADR-027 §1): panel kipi + oturum + veritabanındaki operatör listesi (0038) + oturum düzeyi MFA. Operatör değilse sayfa
// yokmuş gibi 404 (varlık sızdırılmaz). Her panel sayfası çizimden ÖNCE çağırır; eylemler ayrıca domain'de yeniden denetler.
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getAppDb } from "@wms/db";
import { isPlatformOperator } from "@wms/domain/platform/demo-requests";
import { appSurface } from "../../lib/surface.ts";

export interface OperatorPrincipal {
  readonly userId: string;
  readonly mfaVerified: boolean;
}

export async function requireOperator(returnTo: string): Promise<OperatorPrincipal> {
  if (appSurface() !== "panel") notFound();
  const { getAuthService } = await import("../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  if (!(await isPlatformOperator({ db: getAppDb(), principal }))) notFound();
  if (!principal.mfaVerified) redirect(`/mfa?next=${encodeURIComponent(returnTo)}`);
  return principal;
}
