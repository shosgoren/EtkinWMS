import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { getMembershipSummary } from "@wms/domain/identity/member-queries";
import { hasPermission } from "@wms/domain/identity/permissions";
import { listInboundReceipts, type ReceiptCursor } from "@wms/domain/operations";
import { listWarehouses } from "@wms/domain/warehouse";
import { AppError } from "@wms/shared/errors";
import { packageReceivingEnabled } from "../../../../lib/package-receiving-config.ts";
import { FormEkran } from "../stock/form-ekran.tsx";
import { kalipDark } from "../stock/belge-kalip.ts";
import { LICON } from "../../../design/kalip-icons.ts";
import { ReceiptNewForm, ReceiptsList } from "./receipts-view.tsx";

export const dynamic = "force-dynamic";

// Sayfalı liste (≤50 satır/sayfa; sanallaştırma 200+ satırlık tek sayfa gerekince takip kartı — DESIGN_REVIEW §8.1 R-11).
const PAGE_SIZE = 30;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("receiving");
  return { title: t("title") };
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
function parseCursor(raw: string | undefined): ReceiptCursor | undefined {
  if (raw === undefined || raw === "") return undefined;
  const i = raw.indexOf("~");
  return i < 0 ? { createdKey: raw, id: "" } : { createdKey: raw.slice(0, i), id: raw.slice(i + 1) };
}

// Masaüstü "Beklenen teslimler" (T-313): sunucu bileşeni; veri `listInboundReceipts` (stock.view, keyset). Oluşturma ve kalite onayı kararı yalnızca
// gösterimdir (`document.create` / `document.approve`); eylem sunucuda yeniden denetler. Üye değil → 404; MFA → kurulum; oturum yok → giriş.
export default async function ReceiptsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const after = parseCursor(first(sp.after));
  const returnTo = `/t/${encodeURIComponent(slug)}/receipts`;
  const { getAuthService } = await import("../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  const db = getAppDb();
  const call = { db, principal, tenantSlug: slug };
  const t = await getTranslations("receiving");

  let roles: readonly string[];
  let grants: readonly string[] = [];
  let page: Awaited<ReturnType<typeof listInboundReceipts>>;
  let warehouses: Awaited<ReturnType<typeof listWarehouses>>;
  try {
    const summary = await getMembershipSummary({ db, principal });
    const current = summary.memberships.find((m) => m.slug === slug);
    if (current === undefined) notFound();
    roles = current.roles;
    grants = current.grants;
    page = await listInboundReceipts(call, { limit: PAGE_SIZE, ...(after === undefined ? {} : { after }) });
    warehouses = await listWarehouses(call);
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === "NOT_FOUND" || e.code === "VALIDATION_FAILED") notFound();
      if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(returnTo)}`);
      if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(returnTo)}`);
    }
    throw e;
  }

  const nextHref = page.next === null ? null : `${returnTo}?${new URLSearchParams({ after: `${page.next.createdKey}~${page.next.id}` }).toString()}`;
  const dark = await kalipDark();
  const canCreate = hasPermission(roles, "document.create", grants);
  const activeWarehouses = warehouses.items.filter((w) => w.status === "ACTIVE").map((w) => ({ id: w.id, code: w.code, name: w.name }));
  if (first(sp.new) === "1" && canCreate) {
    return (
      <main className="flex w-full min-w-0 flex-col">
        <FormEkran dark={dark} title={t("form.title")} icon={{ d: LICON.moveIn, color: "2F7D5B" }} back={returnTo} mainLabel={t("k.saveShort")} mainAria={t("form.save")} testId="receipt-new">
          <ReceiptNewForm slug={slug} warehouses={activeWarehouses} />
        </FormEkran>
      </main>
    );
  }
  const created = first(sp.created);
  return (
    <main className="flex w-full min-w-0 flex-col">
      <ReceiptsList
        slug={slug}
        dark={dark}
        receipts={page.items}
        nextHref={nextHref}
        canCreate={canCreate}
        canApprove={hasPermission(roles, "document.approve", grants)}
        packageHref={packageReceivingEnabled() && hasPermission(roles, "stock.view", grants) && canCreate && hasPermission(roles, "stock.post", grants) ? `${returnTo}/packages` : null}
        created={created !== undefined && /^[A-Z0-9-]{1,40}$/.test(created) ? created : null}
      />
    </main>
  );
}
