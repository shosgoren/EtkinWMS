import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { THEME_COOKIE } from "../design/theme.ts";
import { appSurface } from "../../lib/surface.ts";
import { FieldSignIn } from "./flow.tsx";

// Saha girişi (T-997, ADR-026 §7): çalışma alanı + kullanıcı adı + 6 hane PIN, yalnız kayıtlı cihazda; kayıtsız cihazda etkinleştirme kodu.
// Giris.dc.html `v.login` (SAHA GİRİŞİ sekmesi) + `v.fact` birebir (flow.tsx). Panel yüzeyinde yok.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("field");
  return { title: t("title"), referrer: "no-referrer", robots: { index: false, follow: false } };
}

export default async function FieldPage() {
  if (appSurface() === "panel") notFound();
  const dark = (await cookies()).get(THEME_COOKIE)?.value === "koyu";
  // Gösterilen adres yapılandırılmış uygulama kökünden (istek Host başlığına güvenilmez); tanımsızsa istek kökü.
  let host = (await headers()).get("host") ?? "wms.etkinyazilim.com";
  try {
    const configured = process.env.BETTER_AUTH_URL?.trim();
    if (configured) host = new URL(configured).host;
  } catch {
    // biçimsiz yapılandırma: istek kökü kalır
  }
  return <FieldSignIn dark={dark} host={host} />;
}
