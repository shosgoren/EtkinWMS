import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { getMembershipSummary } from "@wms/domain/identity/member-queries";
import { hasPermission } from "@wms/domain/identity/permissions";
import { getInboundReceipt, listInboundReceipts, type ReceiptCursor, type ReceiptDetail } from "@wms/domain/operations";
import { AppError } from "@wms/shared/errors";
import { SICON } from "../../../../design/saha-icons.ts";
import { dz } from "../../../../design/saha-tokens.ts";
import { Ico, SahaShell } from "../saha-shell.tsx";
import { PrimaryLink } from "./receive-flow.tsx";
import { ReceiveFlow } from "./receive-view.tsx";

export const dynamic = "force-dynamic";

// Sayfalı liste (≤50 satır/sayfa; DESIGN_REVIEW §8.1 R-11).
const PAGE_SIZE = 30;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("receiving");
  return { title: t("flow.pickTitle") };
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
function parseCursor(raw: string | undefined): ReceiptCursor | undefined {
  if (raw === undefined || raw === "") return undefined;
  const i = raw.indexOf("~");
  return i < 0 ? { createdKey: raw, id: "" } : { createdKey: raw.slice(0, i), id: raw.slice(i + 1) };
}

// Saha kabulü (T-313): teslim seç → (istemci) ürün okut → miktar → bitti. Veri `listInboundReceipts` / `getInboundReceipt` (stock.view);
// yazma `stock.post` ve kurallar `receiveGoods` komutundadır. `stock.post` olmayan kullanıcı menüde bu işi göremez; doğrudan adres açılırsa kilit + gerekçe.
export default async function FieldReceivePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const t = await getTranslations("receiving");
  const base = `/t/${encodeURIComponent(slug)}/field/receive`;
  const fieldHome = `/t/${encodeURIComponent(slug)}/field`;
  const { getAuthService } = await import("../../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect(`/login?next=${encodeURIComponent(base)}`);
  const db = getAppDb();
  const call = { db, principal, tenantSlug: slug };

  const summary = await getMembershipSummary({ db, principal });
  const current = summary.memberships.find((m) => m.slug === slug);
  if (current === undefined) notFound();
  const roles = current.roles;
  if (!hasPermission(roles, "stock.post", current.grants)) {
    return (
      <SahaShell hue="green" iconD={SICON.kabul} title={t("flow.lockedTitle")} backHref={fieldHome} footer={<PrimaryLink href={fieldHome}>{t("flow.toField")}</PrimaryLink>}>
        <p className="break-words text-lg text-ink" data-testid="receive-locked">
          {t("flow.lockedReason")}
        </p>
          <Link href="/help" data-testid="help-link" className="flex min-h-12 w-fit items-center rounded-control border-2 border-border-strong bg-surface px-4 text-base font-bold text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus">
            {t("flow.helpCall")}
          </Link>

      </SahaShell>
    );
  }

  const receiptId = first(sp.receipt);
  const guardErrors = (e: unknown): never => {
    if (e instanceof AppError) {
      if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(base)}`);
      if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(base)}`);
    }
    throw e;
  };

  if (receiptId !== undefined && receiptId !== "") {
    let receipt: ReceiptDetail | null = null;
    try {
      receipt = await getInboundReceipt(call, { receiptId });
    } catch (e) {
      if (!(e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "VALIDATION_FAILED"))) guardErrors(e);
    }
    // KAPALI teslim (son kalem alındı) de akışa gider: akış "Teslim tamam" ekranını gösterir; yenilemeden sonra "kaydedildi" ekranı kaybolmaz.
    if (receipt === null || (receipt.status !== "OPEN" && receipt.status !== "CLOSED")) {
      return (
        <SahaShell hue="green" iconD={SICON.kabul} title={t("flow.notOpenTitle")} backHref={base} footer={<PrimaryLink href={base}>{t("flow.otherReceipt")}</PrimaryLink>}>
          <p className="break-words text-lg text-ink">{t("flow.notOpen")}</p>
        </SahaShell>
      );
    }
    const code = first(sp.code);
    return <ReceiveFlow slug={slug} receipt={receipt} {...(code === undefined || code === "" ? {} : { initialCode: code.slice(0, 256) })} />;
  }

  let page: Awaited<ReturnType<typeof listInboundReceipts>>;
  try {
    page = await listInboundReceipts(call, { status: "OPEN", limit: PAGE_SIZE, ...(parseCursor(first(sp.after)) === undefined ? {} : { after: parseCursor(first(sp.after)) as ReceiptCursor }) });
  } catch (e) {
    if (e instanceof AppError && e.code === "VALIDATION_FAILED") redirect(base);
    return guardErrors(e);
  }
  const canCreate = hasPermission(roles, "document.create", current.grants);
  const firstReceipt = page.items[0];
  const rowCls = "job pickrow";
  return (
    <SahaShell
      hue="green"
      iconD={SICON.kabul}
      step={1}
      total={4}
      title={t("flow.pickTitle")}
      instruction={t("flow.pickInstruction")}
      backHref={fieldHome}
      footer={
        firstReceipt !== undefined ? (
          <PrimaryLink href={`${base}?receipt=${encodeURIComponent(firstReceipt.id)}`}>{t("flow.startNext")}</PrimaryLink>
        ) : canCreate ? (
          <PrimaryLink href={`/t/${encodeURIComponent(slug)}/receipts`}>{t("flow.addReceipt")}</PrimaryLink>
        ) : (
          <PrimaryLink href={fieldHome}>{t("flow.toField")}</PrimaryLink>
        )
      }
    >
      {page.items.length === 0 ? (
        <section className="flex min-w-0 flex-col gap-1 rounded-card border-2 border-border bg-surface p-4" data-testid="receive-empty">
          <h2 className="break-words text-xl font-bold text-ink">{t("flow.emptyTitle")}</h2>
          <p className="break-words text-base text-ink-muted">{canCreate ? t("flow.emptyCanCreate") : t("flow.emptyAction")}</p>
        </section>
      ) : (
        <ul aria-label={t("flow.pickTitle")} className="m-0 flex min-w-0 list-none flex-col gap-2 p-0" data-testid="receive-picker">
          {page.items.map((r, i) => {
            const openCount = r.lines.filter((l) => /[1-9]/.test(l.open)).length;
            return (
              <li key={r.id} className="flex min-w-0">
                <Link href={`${base}?receipt=${encodeURIComponent(r.id)}`} className={`${rowCls} w-full`} data-testid="receive-pick" data-receipt-id={r.id}>
                  <span className="uic" style={{ background: dz("2F7D5B") }}>
                    <Ico d={SICON.kabul} size={22} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <b>{r.number}</b>
                    <small>
                      {r.supplierRef === null ? "" : `${r.supplierRef} · `}
                      {t("flow.pickSummary", { lines: r.lines.length, open: openCount })}
                    </small>
                  </span>
                  {i === 0 ? <span className="autosel">{t("flow.next")}</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {page.next === null ? null : (
        <Link href={`${base}?after=${encodeURIComponent(`${page.next.createdKey}~${page.next.id}`)}`} className={`${rowCls} items-center text-base font-bold text-ink`}>
          {t("list.more")}
        </Link>
      )}
      {canCreate && page.items.length > 0 ? (
        <Link href={`/t/${encodeURIComponent(slug)}/receipts`} className="flex min-h-12 items-center text-base font-bold text-accent-ink underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus">
          {t("flow.addReceipt")}
        </Link>
      ) : null}
    </SahaShell>
  );
}
