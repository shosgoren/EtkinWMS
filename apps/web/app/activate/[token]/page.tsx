import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { previewActivation } from "@wms/domain/platform/activation";
import { temaKoyu } from "../../design/theme.ts";
import { appSurface } from "../../../lib/surface.ts";
import { ActivationFlow } from "./flow.tsx";

// Deneme aktivasyonu (T-995, ADR-026 §3.3): onaylı demo talebinin tek kullanımlık bağlantısı. Giris.dc.html `v.act` birebir (flow.tsx).
// Bağlantı geçersizse (yok/süresi dolmuş/kullanılmış/biçimsiz — hepsi aynı) tasarımın "Bu bağlantı kullanılamıyor" durumu.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("activate");
  return { title: t("title"), referrer: "no-referrer", robots: { index: false, follow: false } };
}

export default async function ActivatePage({ params }: { params: Promise<{ token: string }> }) {
  if (appSurface() === "panel") notFound();
  const { token } = await params;
  const preview = await previewActivation({ db: getAppDb(), token });
  const dark = temaKoyu(await cookies());
  // Gösterilen adres yapılandırılmış uygulama kökünden (istek Host başlığına güvenilmez; inceleme nit); tanımsızsa istek kökü.
  let host = (await headers()).get("host") ?? "wms.etkinyazilim.com";
  try {
    const configured = process.env.BETTER_AUTH_URL?.trim();
    if (configured) host = new URL(configured).host;
  } catch {
    // biçimsiz yapılandırma: istek kökü kalır
  }
  return (
    <ActivationFlow
      dark={dark}
      host={host}
      token={preview === null ? null : token}
      preview={preview === null ? null : { company: preview.company, email: preview.email, emailVerifiedByLink: preview.emailVerifiedByLink }}
    />
  );
}
