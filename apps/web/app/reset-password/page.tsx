import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ResetPasswordForm, ResetRequestForm } from "../auth-forms.tsx";
import { THEME_COOKIE } from "../design/theme.ts";

// Sıfırlama belirteci sorguda gelir: Referer ile sızmasın.
export const metadata: Metadata = { referrer: "no-referrer" };

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

// Belirteç yoksa talep formu; varsa yeni parola formu; `?error=` (Better Auth geçersiz/süresi dolmuş) → bağlantı hatası.
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const token = first(q.token);
  const hasError = first(q.error) !== undefined;
  // T-974 (B-63 grup B): Giris.dc.html `v.auth` kabuğu; tema çerezi sunucudan.
  const dark = (await cookies()).get(THEME_COOKIE)?.value === "koyu";
  if (token === undefined && !hasError) return <ResetRequestForm dark={dark} />;
  return <ResetPasswordForm token={token ?? ""} linkError={hasError || token === ""} dark={dark} />;
}
