import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { GirisBant, GirisBaslik, GirisKabuk } from "../../giris-ui.tsx";
import { temaKoyu } from "../../design/theme.ts";
import { getAppDb } from "@wms/db";
import { runTenantCommand, runTenantQuery } from "@wms/domain/identity/access";
import { MARK_TIMEOUTS, markWorkspaceUsed, needsMark } from "@wms/domain/identity/last-workspace";
import { getMembershipSummary } from "@wms/domain/identity/member-queries";
import { hasPermission } from "@wms/domain/identity/permissions";
import { appSurface } from "../../../lib/surface.ts";
import { AppError } from "@wms/shared/errors";
import { KabukProvider } from "./kabuk/kabuk-bar.tsx";
import { kabukModules } from "./kabuk/modules.ts";

export const dynamic = "force-dynamic";


// Tenant kabuğu (T-119): üyelik SUNUCUDA doğrulanır (üye değil → 404; varlık sızdırılmaz). Yetki kararı domain'dedir
// (`runTenantQuery`); burada yalnızca kullanıcı adı, aktif rol çipi ve tenant değiştirici gösterilir.
export default async function TenantLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  // ADR-027 §1 (T-401 inceleme M-1): müşteri alanı panel kipinde yoktur (proxy'ye ek, sunucu tarafı).
  if (appSurface() === "panel") notFound();
  const { slug } = await params;
  const { getAuthService } = await import("../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect(`/login?next=${encodeURIComponent(`/t/${slug}/members`)}`);
  const db = getAppDb();

  try {
    await runTenantQuery({ db, principal, tenantSlug: slug, permission: "stock.view" }, () => Promise.resolve(true));
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === "NOT_FOUND" || e.code === "FORBIDDEN") {
        // Zorunlu MFA: kurulum ekranına yönlendir (A-38); diğer ret nedenleri 404 (varlık sızdırılmaz).
        if (e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(`/t/${slug}/members`)}`);
        notFound();
      }
      if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(`/t/${slug}/members`)}`);
      if (e.code === "TENANT_SUSPENDED" || e.code === "TENANT_CLOSING") {
        // Sunucu bileşeni hataları üretimde maskelenir (yalnızca digest); kod `error.tsx`'e taşınamaz. Bu yüzden durum burada
        // kodla yakalanır ve çerçeveli bir durum olarak render edilir (çocuklar render edilmez).
        const te = await getTranslations("members.errors");
        const key = e.code.toLowerCase();
        const dark = temaKoyu(await cookies());
        return (
          <GirisKabuk dark={dark} testId="tenant-status">
            <GirisBaslik title={te("tenantStatusTitle")} />
            <GirisBant kind="warn">
              {te(key)} {te(`${key}Action`)}
              <small style={{ display: "block" }}>{te("code", { code: e.code })}</small>
            </GirisBant>
          </GirisKabuk>
        );
      }
    }
    throw e;
  }

  const summary = await getMembershipSummary({ db, principal });
  const current = summary.memberships.find((m) => m.slug === slug);
  if (current === undefined) notFound();
  // T-999: son kullanılan alan (yalnız gerektiğinde ayrı kısa transaction; üyelik/izin yeniden doğrulanır). Bilgi amaçlıdır: yazılamazsa
  // sayfa yine açılır, yalnız kod günlüğe yazılır. Ön yükleme (bağlantı prefetch) isteği kaydetmez (inceleme m2): son alan yalnız gerçek
  // gezinmeyle değişir.
  const reqHeaders = await headers();
  const prefetch = reqHeaders.get("next-router-prefetch") !== null || /prefetch/i.test(reqHeaders.get("sec-purpose") ?? reqHeaders.get("purpose") ?? "");
  if (!prefetch && needsMark(summary, slug, new Date())) {
    await runTenantCommand({ db, principal, tenantSlug: slug, permission: "stock.view", timeouts: MARK_TIMEOUTS }, (tx, m) => markWorkspaceUsed(tx, m)).catch((e: unknown) => {
      console.error(JSON.stringify({ event: "workspace.mark_failed", code: e instanceof AppError ? e.code : "UNKNOWN" }));
    });
  }
  const t = await getTranslations();
  const view = (await cookies()).get("view")?.value === "cockpit" ? "cockpit" : "flow";
  const base = `/t/${encodeURIComponent(slug)}`;
  // T-958: ortak alt çubuğun Modüller sayfası — yalnız üyenin rol/yetki/grup ekranlarının açtığı modüller (sunucuda; hedef sayfa ayrıca denetler).
  const kabuk = {
    base,
    // T-979c: görünüm geçişi (Genel bakış ↔ İşlemler) Modüller'de; eski "Tüm ekranlar" penceresi yok.
    modules: kabukModules(base, { roles: current.roles, grants: current.grants, screens: current.screens }, view),
    workspaces: summary.memberships.length,
    roleLabel: current.roles[0] === undefined ? "" : t(`roles.${current.roles[0]}`),
    tenantName: current.tenantName,
    userName: summary.userName,
    slug,
    // Pano ile aynı kural (page.tsx / pano-home.tsx): stok kaydı ya da belge oluşturma yetkisi + ekran grubunda "problem".
    canReport:
      (hasPermission(current.roles, "stock.post", current.grants) || hasPermission(current.roles, "document.create", current.grants)) &&
      (current.screens === null || current.screens.includes("problem")),
    // T-1002 (B-62): Etkin sesli komut — okuma yetkisi olan her üye; yazma komutları onayda mevcut eylemlerin izinlerini ister.
    etkin: hasPermission(current.roles, "stock.view", current.grants),
    // T-981b: kalıp üst çubuğu Excel düğmesi (gösterim; dışa aktarma ve aktarım sunucuda yine denetlenir).
    excel: {
      data: hasPermission(current.roles, "data.import", current.grants),
      master: hasPermission(current.roles, "data.import", current.grants) && hasPermission(current.roles, "settings.manage", current.grants),
    },
  };

  return (
    <KabukProvider value={kabuk}>
    <div className="tenant-shell flex min-w-0 flex-col">
      {/* T-979 (B-95) / T-979c: eski kabuk ve "Tüm ekranlar" penceresi yok; her ekran kendi kalıp/Pano üst çubuğunu (Hesap menüsü:
          kullanıcı / çalışma alanı değiştir, tema, çıkış) ve ortak alt cam çubuğu (Modüller: ekranlar + Genel bakış geçişi) çizer. */}
      {/* T-965: Suspense yok. Bu yerleşim `force-dynamic` olduğundan `useSearchParams` sunucuda hazırdır (askıya almaz). */}
      <div className="tenant-body flex min-w-0 flex-col">{children}</div>
    </div>
    </KabukProvider>
  );
}
