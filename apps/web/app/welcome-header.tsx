import { cookies } from "next/headers";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SignOutButton } from "./auth-forms.tsx";
import { BrandMark } from "./brand-mark.tsx";
import { GuideTrigger } from "./first-use-guide.tsx";
import { appSurface } from "../lib/surface.ts";

// T-1012 (kullanıcı bildirimi 22 Ekim): eski uygulama üst çubuğu (T-109: Kolay mod, Akış/Kokpit anahtarı, Nasıl kullanırım?, Yardım) artık kök
// yerleşimde DEĞİL. Yalnız onu hâlâ kullanan karşılama sayfası (`/`, yalnız demo/kayıt açık ortamlarda) çizer. Çalışma alanı (`/t/*`), giriş,
// panel, yükleme, hata ve bulunamadı ekranlarında DOM'da hiç yoktur; CSS ile gizleme gerekmez, geçişte parlayamaz.
const VIEWS = ["flow", "cockpit"] as const;
type View = (typeof VIEWS)[number];
const VIEW_COOKIE = "view";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const TOUCH = "min-h-12 min-w-12";

function parseView(value: string | undefined): View {
  return VIEWS.find((v) => v === value) ?? "flow";
}

async function setView(formData: FormData): Promise<void> {
  "use server";
  const next = parseView(String(formData.get("view") ?? ""));
  (await cookies()).set(VIEW_COOKIE, next, { path: "/", maxAge: ONE_YEAR_SECONDS, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
}

export async function WelcomeHeader() {
  // Yönetim panelinde (ADR-027) müşteri uygulamasının başlığı yoktur.
  if (appSurface() === "panel") return null;
  const t = await getTranslations("shell");
  const cookieStore = await cookies();
  const view = parseView(cookieStore.get(VIEW_COOKIE)?.value);
  // İyimser: yalnızca oturum çerezinin varlığı (çıkış düğmesi gösterimi); yetki sunucuda (proxy.ts notu).
  const hasSession = cookieStore.getAll().some((c) => /^(?:__Secure-)?better-auth\.session_token$/.test(c.name));
  return (
    <header className="app-header sticky top-0 z-40 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border bg-surface px-4 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center">
          <BrandMark className="size-full" />
        </span>
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-xl font-extrabold">{t("productName")}</span>
          <span className="w-fit rounded-full bg-accent-soft px-2 text-xs font-bold text-accent-ink">{t("easyMode")}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {hasSession ? (
          <form action={setView} aria-label={t("viewSwitch.label")}>
            <div className="flex rounded-full bg-accent-soft p-1" role="group">
              {VIEWS.map((v) => (
                <button
                  key={v}
                  type="submit"
                  name="view"
                  value={v}
                  aria-pressed={view === v}
                  className={`${TOUCH} cursor-pointer rounded-full px-4 text-sm font-bold ${view === v ? "bg-ink text-surface" : "text-ink"}`}
                >
                  {t(`viewSwitch.${v}`)}
                </button>
              ))}
            </div>
          </form>
        ) : null}

        {hasSession ? <SignOutButton /> : null}

        <GuideTrigger className={`${TOUCH} inline-flex cursor-pointer items-center justify-center rounded-full border-2 border-border-strong bg-surface px-4 text-sm font-bold text-ink`} />
        <Link href="/help" className={`${TOUCH} inline-flex items-center justify-center rounded-full bg-accent-soft px-4 text-sm font-bold text-accent-ink`}>
          <span className="sm:hidden">{t("help.short")}</span>
          <span className="hidden sm:inline">{t("help.full")}</span>
        </Link>
      </div>
    </header>
  );
}
