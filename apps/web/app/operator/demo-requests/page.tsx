import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { isPlatformOperator, listDemoRequests } from "@wms/domain/platform/demo-requests";
import { THEME_COOKIE } from "../../design/theme.ts";
import { decideDemoRequestAction } from "./actions.ts";
import { DemoRequestsView } from "./view.tsx";

// T-994 (ADR-026 §3): yalnız platform operatörü (veritabanındaki liste) görür; operatör değilse sayfa yokmuş gibi 404 (varlık
// sızdırılmaz); operatöre MFA'sız oturumda doğrulama ekranı. Çizim view.tsx (Giris.dc.html `v.op` birebir).
export const dynamic = "force-dynamic";

const PATH = "/operator/demo-requests";
const ERRORS = ["NOT_FOUND", "VERSION_CONFLICT", "VALIDATION_FAILED", "RATE_LIMITED", "INTERNAL", "FORBIDDEN"];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("operator");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function OperatorDemoRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { getAuthService } = await import("../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect(`/login?next=${encodeURIComponent(PATH)}`);
  const db = getAppDb();
  if (!(await isPlatformOperator({ db, principal }))) notFound();
  if (!principal.mfaVerified) redirect(`/mfa?next=${encodeURIComponent(PATH)}`);
  const rows = await listDemoRequests({ db, principal });
  const query = await searchParams;
  const rawErr = Array.isArray(query.error) ? query.error[0] : query.error;
  const dark = (await cookies()).get(THEME_COOKIE)?.value === "koyu";
  return <DemoRequestsView rows={rows} now={new Date()} dark={dark} errorCode={ERRORS.find((c) => c === rawErr)} action={decideDemoRequestAction} />;
}
