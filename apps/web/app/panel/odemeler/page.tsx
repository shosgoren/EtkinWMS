import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getMessages, getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { listCharges, type ChargeRow } from "@wms/domain/platform/charges";
import { AppError } from "@wms/shared/errors";
import { temaKoyu } from "../../design/theme.ts";
import { YICON } from "../../design/yonet-icons.ts";
import { panelOperatorOrExit } from "../gate.ts";
import { panelLabels, panelNav } from "../nav.ts";
import { priceLabel } from "../plan-format.ts";
import { PanelShell } from "../shell.tsx";
import { paymentAction } from "./actions.ts";
import { OdemelerView, type ChargeItem, type ChargeStatusKey, type OdemelerLabels, type PaymentKpi } from "./view.tsx";

// Panel · Ödemeler (yonet.etkinyazilim.com/odemeler; ADR-027 §8, T-406). Yalnız platform operatörü. Ödeme sağlayıcısı bağlanana dek
// tahakkuk ve tahsilat burada elle izlenir.
export const dynamic = "force-dynamic";

const PATH = "/odemeler";
const TZ = "Europe/Istanbul";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("panel.odemeler");
  return { title: t("title"), robots: { index: false, follow: false } };
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

interface Msgs extends OdemelerLabels {
  readonly title: string;
  readonly sub: string;
  readonly newAccrual: string;
  readonly months: readonly string[];
  readonly monthNames: readonly string[];
  readonly kPaid: string;
  readonly kPaidSub: string;
  readonly kOverdue: string;
  readonly kOverdueSub: string;
  readonly kPending: string;
  readonly kPendingSub: string;
  readonly kPendingNone: string;
  readonly kInvoice: string;
  readonly kInvoiceSub: string;
  readonly invoicePending: string;
}

function todayParts(now: Date): { y: string; m: string; d: string } {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(now);
  const get = (k: string): string => p.find((x) => x.type === k)?.value ?? "";
  return { y: get("year"), m: get("month"), d: get("day") };
}

function periodLabel(iso: string, months: readonly string[]): string {
  const [y, m] = iso.split("-");
  return `${months[Number(m) - 1] ?? m} ${y}`;
}

export default async function OdemelerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const principal = await panelOperatorOrExit(PATH);
  const rows: readonly ChargeRow[] = await listCharges({ db: getAppDb(), principal }).catch((e: unknown) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const query = await searchParams;
  const t = ((await getMessages()).panel as unknown as { odemeler: Msgs }).odemeler;
  const now = new Date();
  const td = todayParts(now);
  const thisMonth = `${td.y}-${td.m}`;
  const paidThisMonth = rows.filter((r) => r.paidOn !== null && r.paidOn.startsWith(thisMonth)).length;
  const overdue = rows.filter((r) => r.status === "OVERDUE");
  const pending = rows.filter((r) => r.status === "PENDING");
  const nextDue = pending.map((r) => r.dueOn).sort()[0];
  const invoiceWaiting = rows.filter((r) => r.status === "PAID" && r.invoiceNo === null).length;
  const kpis: PaymentKpi[] = [
    { label: t.kPaid, n: String(paidThisMonth), sub: t.kPaidSub, color: "17804F", icon: YICON.check },
    {
      label: t.kOverdue,
      n: String(overdue.length),
      sub: t.kOverdueSub.replace("{n}", () => String(new Set(overdue.map((r) => r.tenantId)).size)),
      color: "C62828",
      icon: YICON.warn,
    },
    {
      label: t.kPending,
      n: String(pending.length),
      sub: nextDue === undefined ? t.kPendingNone : t.kPendingSub.replace("{date}", () => `${nextDue.slice(8, 10)}.${nextDue.slice(5, 7)}`),
      color: "B07D00",
      icon: YICON.clock,
    },
    { label: t.kInvoice, n: String(invoiceWaiting), sub: t.kInvoiceSub, color: "3D2A6B", icon: YICON.pay },
  ];
  const items: ChargeItem[] = rows.map((r) => ({
    id: r.id,
    company: r.company,
    ref: r.ref,
    period: periodLabel(r.period, t.months),
    plan: r.plan,
    amount: priceLabel(r.amount),
    status: r.status,
    invoice: r.invoiceNo ?? (r.status === "PAID" ? t.invoicePending : "—"),
  }));
  const tabParam = first(query.d);
  const tab: "all" | ChargeStatusKey = tabParam === "PAID" || tabParam === "OVERDUE" || tabParam === "PENDING" ? tabParam : "all";
  const dark = temaKoyu(await cookies());
  return (
    <PanelShell
      dark={dark}
      current="odemeler"
      title={t.title}
      sub={t.sub}
      nav={await panelNav(principal, undefined, overdue.length)}
      labels={await panelLabels()}
      action={{ label: t.newAccrual, href: `${PATH}?tahakkuk=1` }}
    >
      <OdemelerView
        key={`${tab}-${first(query.tahakkuk) ?? ""}`}
        rows={items}
        kpis={kpis}
        tab={tab}
        today={`${td.d}.${td.m}.${td.y}`}
        accrueOpen={first(query.tahakkuk) === "1"}
        labels={{ ...t, accrueTitle: t.accrueTitle.replace("{period}", () => periodLabel(`${thisMonth}-01`, t.monthNames)) }}
        action={paymentAction}
      />
    </PanelShell>
  );
}
