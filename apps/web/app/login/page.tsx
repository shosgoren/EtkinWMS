import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { THEME_COOKIE } from "../design/theme.ts";
import { EmailSignIn } from "./flow.tsx";
import { safeNext } from "../../lib/safe-redirect.ts";
import { appSurface } from "../../lib/surface.ts";

// Ortam bayrakları istek anında okunur (derleme anında değil).
export const dynamic = "force-dynamic";

// `next` davet belirteci taşıyabilir: dış kaynaklara Referer sızmasın.
export const metadata: Metadata = { referrer: "no-referrer" };

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const next = safeNext(first(query.next));
  // A-39: hassas işlem "yeniden doğrula" istediğinde (`reauth=1`) açık oturum varken de form gösterilir; aksi hâlde giriş sayfası
  // oturumu görüp geri gönderir ve kullanıcı döngüye girer. Yeni giriş yeni oturum açar (doğrulama zamanı yenilenir).
  const reauth = first(query.reauth) === "1";

  const { getAuthService } = await import("../../lib/auth-service.ts");
  if (!reauth && (await getAuthService().getPrincipal(await headers())) !== null) redirect(next);

  // A-43: demo uyarısı yalnızca sunucuda karar verilir; bayraklar yokken demo metni hiç render edilmez.
  const demo = process.env.DEMO_MODE === "1" && process.env.WMS_ENV === "staging";
  const socialEnabled = process.env.AUTH_SOCIAL_ENABLED === "true";
  const dark = (await cookies()).get(THEME_COOKIE)?.value === "koyu";
  // T-999b: Giris.dc.html `v.login` E-POSTA sekmesi birebir (flow.tsx); SAHA GİRİŞİ sekmesi `/field`'e gider (T-997).
  return <EmailSignIn dark={dark} next={next} socialEnabled={socialEnabled} demo={demo} fieldTab={appSurface() !== "panel"} reauth={reauth} />;
}
