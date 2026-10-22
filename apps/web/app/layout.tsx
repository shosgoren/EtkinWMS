import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import "./globals.css";
import { designFontVars } from "./fonts.ts";
import { FirstUseGuide } from "./first-use-guide.tsx";
import { appSurface } from "../lib/surface.ts";
import { temaKoyu } from "./design/theme.ts";
import { KuralKatmani } from "./t/[slug]/kalip/kural-katmani.tsx";

// Kök yerleşim (T-109; T-1012): eski uygulama üst çubuğu burada DEĞİL (yalnız karşılama sayfası çizer: `welcome-header.tsx`). Her yüzey
// kendi kabuğunu çizer; yükleme/hata/bulunamadı ve istemci içi geçişte eski çubuk DOM'a hiç girmez. `data-view` çerezi Akış/Kokpit içindir.
const VIEWS = ["flow", "cockpit"] as const;
type View = (typeof VIEWS)[number];

function parseView(value: string | undefined): View {
  return VIEWS.find((v) => v === value) ?? "flow";
}

// Cihaz uyumu (T-254): `viewport-fit=cover` ile `env(safe-area-inset-*)` kullanılabilir (çentik, ana ekran çubuğu); yakınlaştırma
// engellenmez (erişilebilirlik). Ana ekrana eklenince tam ekran açılır (`apple-mobile-web-app-capable`).
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("shell");
  return { title: t("productName"), appleWebApp: { capable: true, title: t("productName"), statusBarStyle: "default" } };
}

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const locale = await getLocale();
  const t = await getTranslations("shell");
  const cookieStore = await cookies();
  const view = parseView(cookieStore.get("view")?.value);
  // Yönetim panelinde (ADR-027) müşteri uygulamasının başlığı ve kullanım rehberi yoktur: panel sayfaları kendi kabuğunu çizer, giriş
  // ekranları tasarım kabındadır; operatör olmayan hesaba dönen 404'te de müşteri menüsü görünmez.
  const panel = appSurface() === "panel";

  return (
    <html lang={locale} data-view={view} data-tema={temaKoyu(cookieStore) ? "koyu" : "acik"}>
      <body className={`min-h-dvh bg-bg text-ink antialiased ${designFontVars}`}>
        <NextIntlClientProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-card focus:bg-surface focus:px-4 focus:py-3"
          >
            {t("skipToContent")}
          </a>
          {panel ? null : <FirstUseGuide />}
          <div id="main" tabIndex={-1}>
            {children}
          </div>
          {/* T-436: ALTIN-KURAL 5–17 ortak katman (balon, çevrimdışı, hareket azaltma, otomatik tema) — her yüzeyde bir kez. */}
          <KuralKatmani />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
