import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Banner } from "@wms/ui";
import { LoginForm } from "../auth-forms.tsx";
import { safeNext } from "../../lib/safe-redirect.ts";

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
  const t = await getTranslations("auth");

  // T-997: saha personeli (e-postasız) ayrı giriş ekranına gider (kullanıcı adı + PIN, yalnız kayıtlı cihaz).
  const fieldLink = (
    <a href="/field" className="text-base font-bold text-ink underline underline-offset-4">
      {t("login.fieldLink")}
    </a>
  );
  return (
    <LoginForm
      next={next}
      socialEnabled={socialEnabled}
      banner={
        <>
          {demo ? <Banner kind="warning">{t("login.demoBanner")}</Banner> : null}
          {fieldLink}
        </>
      }
    />
  );
}
