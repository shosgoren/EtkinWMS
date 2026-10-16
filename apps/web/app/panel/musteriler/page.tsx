import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getMessages, getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { getCustomerActivity, listCustomers, type CustomerEvent, type CustomerRow } from "@wms/domain/platform/customers";
import { listPlans } from "@wms/domain/platform/plans";
import { AppError } from "@wms/shared/errors";
import { THEME_COOKIE } from "../../design/theme.ts";
import { panelOperatorOrExit } from "../gate.ts";
import { panelLabels, panelNav } from "../nav.ts";
import { planLines, priceLabel } from "../plan-format.ts";
import { PanelShell } from "../shell.tsx";
import { customerAction } from "./actions.ts";
import {
  MusteriDetail,
  MusterilerList,
  type CustomerDetail,
  type CustomerListItem,
  type CustomerMeter,
  type CustomerStateKey,
  type MusterilerLabels,
  type PlanOption,
} from "./view.tsx";

// Panel · Müşteriler ve müşteri detayı (yonet.etkinyazilim.com/musteriler[?m=<id>]; ADR-027 §2–3, T-403). Yalnız platform operatörü.
// Yalnız sayılar ve işletim durumu; tenant içeriği hiçbir yoldan gelmez.
export const dynamic = "force-dynamic";

const PATH = "/musteriler";
const TZ = "Europe/Istanbul";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("panel.musteriler");
  return { title: t("title"), robots: { index: false, follow: false } };
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function parts(d: Date): Record<string, string> {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  return Object.fromEntries(p.map((x) => [x.type, x.value]));
}

const day = (d: Date): string => {
  const p = parts(d);
  return `${p.day}.${p.month}.${p.year}`;
};
const stamp = (d: Date): string => {
  const p = parts(d);
  return `${p.day}.${p.month} ${p.hour}:${p.minute}`;
};
/** İstanbul gün numarası (gün farkı için). */
const dayNo = (d: Date): number => {
  const p = parts(d);
  return Math.round(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / 86_400_000);
};

function lastLogin(d: Date | null, now: Date, t: { today: string; yesterday: string; daysAgo: string }): string {
  if (d === null) return "—";
  const p = parts(d);
  const diff = dayNo(now) - dayNo(d);
  if (diff <= 0) return `${t.today} ${p.hour}:${p.minute}`;
  if (diff === 1) return `${t.yesterday} ${p.hour}:${p.minute}`;
  return t.daysAgo.replace("{n}", String(diff));
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => w !== "");
  const s = words.length >= 2 ? `${words[0]?.charAt(0) ?? ""}${words[1]?.charAt(0) ?? ""}` : name.trim().slice(0, 2);
  return s.toLocaleUpperCase("tr");
}

function stateOf(r: CustomerRow): CustomerStateKey {
  return r.state;
}

interface Msgs extends MusterilerLabels {
  readonly title: string;
  readonly sub: string;
  readonly detailSub: string;
  readonly today: string;
  readonly yesterday: string;
  readonly daysAgo: string;
  readonly noPlan: string;
  readonly unlimitedMax: string;
  readonly mAdmins: string;
  readonly mField: string;
  readonly mWarehouses: string;
  readonly mItems: string;
  readonly kState: string;
  readonly kPlan: string;
  readonly kCard: string;
  readonly kNext: string;
  readonly kMoves: string;
  readonly vTrial: string;
  readonly vActive: string;
  readonly vSuspended: string;
  readonly vNoCard: string;
  readonly vNextTrial: string;
  readonly vNextNone: string;
  readonly hSuspended: string;
  readonly hResumed: string;
  readonly hExtended: string;
  readonly hPlanChanged: string;
  readonly hPlanAssigned: string;
  readonly hTrialStarted: string;
  readonly hDemoApproved: string;
  readonly unitAdmins: string;
  readonly unitField: string;
  readonly unitWarehouses: string;
  readonly unitItems: string;
  readonly unlimited: string;
}

function meter(label: string, v: number, max: number | null, unlimited: string): CustomerMeter {
  const m = max ?? 0;
  const width = m === 0 ? 8 : Math.min(100, Math.round((v / m) * 100));
  return { label, value: v.toLocaleString("tr-TR"), max: m === 0 ? unlimited : m.toLocaleString("tr-TR"), width: `${width}%`, hot: m !== 0 && v / m >= 0.8 };
}

function historyLine(e: CustomerEvent, m: Msgs, planName: (id: string | undefined) => string): string {
  switch (e.kind) {
    case "SUSPENDED":
      return m.hSuspended.replace("{reason}", () => e.reason ?? "—");
    case "RESUMED":
      return m.hResumed;
    case "TRIAL_EXTENDED":
      return m.hExtended.replace("{date}", () => (e.trialEndsAt === undefined ? "—" : day(e.trialEndsAt)));
    case "PLAN_CHANGED":
      return m.hPlanChanged.replace("{from}", () => (e.fromPlanId === undefined ? m.noPlan : planName(e.fromPlanId))).replace("{to}", () => planName(e.planId));
    case "PLAN_ASSIGNED":
      return m.hPlanAssigned.replace("{to}", () => planName(e.planId));
    case "TRIAL_STARTED":
      return m.hTrialStarted;
    case "DEMO_APPROVED":
      return m.hDemoApproved;
  }
}

export default async function MusterilerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const principal = await panelOperatorOrExit(PATH);
  const db = getAppDb();
  const onMissing = (e: unknown): never => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  };
  const [rows, plans] = await Promise.all([listCustomers({ db, principal }).catch(onMissing), listPlans({ db, principal }).catch(onMissing)]);
  const query = await searchParams;
  const m = (await getMessages()).panel as unknown as { musteriler: Msgs };
  const t = m.musteriler;
  const labels: MusterilerLabels = t;
  const dark = (await cookies()).get(THEME_COOKIE)?.value === "koyu";
  const shell = { dark, nav: await panelNav(principal), labels: await panelLabels() };
  const now = new Date();
  const planName = (id: string | undefined): string => plans.find((p) => p.id === id)?.name ?? "—";

  const picked = first(query.m);
  const cx = picked === undefined ? undefined : rows.find((r) => r.id === picked);
  if (picked !== undefined) {
    if (cx === undefined) return notFound();
    const act = await getCustomerActivity({ db, principal, tenantId: cx.id }).catch(onMissing);
    const rank = (id: string | null): number => (id === null ? -1 : plans.findIndex((p) => p.id === id));
    const st = stateOf(cx);
    const planPrice = cx.plan === null ? "" : ` · ₺${priceLabel(cx.plan.price)} ${t.perMonth.toLocaleLowerCase("tr")}`;
    const sub =
      st === "TRIAL"
        ? [
            { k: t.kState, v: t.vTrial.replace("{date}", cx.trialEndsAt === null ? "—" : day(cx.trialEndsAt)) },
            { k: t.kPlan, v: cx.plan?.name ?? t.noPlan },
            { k: t.kCard, v: t.vNoCard },
            { k: t.kNext, v: t.vNextTrial },
            { k: t.kMoves, v: act.movesThisMonth.toLocaleString("tr-TR") },
          ]
        : [
            { k: t.kState, v: st === "SUSPENDED" ? t.vSuspended : t.vActive },
            { k: t.kPlan, v: cx.plan === null ? t.noPlan : `${cx.plan.name}${planPrice}` },
            { k: t.kCard, v: t.vNoCard },
            { k: t.kNext, v: t.vNextNone },
            { k: t.kMoves, v: act.movesThisMonth.toLocaleString("tr-TR") },
          ];
    const lim = cx.plan?.limits ?? null;
    const cu: CustomerDetail = {
      id: cx.id,
      name: cx.name,
      slug: cx.slug,
      since: day(cx.createdAt),
      initials: initials(cx.name),
      state: st,
      planLabel: (cx.plan?.name ?? t.noPlan).toLocaleUpperCase("tr"),
      planId: cx.plan?.id ?? null,
      planRank: rank(cx.plan?.id ?? null),
      meters: [
        meter(t.mAdmins, cx.counts.admins, lim?.admins ?? null, t.unlimitedMax),
        meter(t.mField, cx.counts.field, lim?.field ?? null, t.unlimitedMax),
        meter(t.mWarehouses, cx.counts.warehouses, lim?.warehouses ?? null, t.unlimitedMax),
        meter(t.mItems, cx.counts.items, lim?.items ?? null, t.unlimitedMax),
      ],
      sub,
      hist: act.history.map((e) => ({ t: stamp(e.at), l: historyLine(e, t, planName) })),
    };
    const options: PlanOption[] = plans.map((p, i) => ({
      id: p.id,
      name: p.name,
      price: priceLabel(p.price),
      sum: planLines(p, { unlimited: t.unlimited, admins: t.unitAdmins, field: t.unitField, warehouses: t.unitWarehouses, items: t.unitItems }).slice(0, 2).join(" · "),
      rank: i,
    }));
    return (
      <PanelShell {...shell} current="musteriler" title={cx.name} sub={t.detailSub} backHref={PATH}>
        <MusteriDetail key={`${cx.id}-${st}-${cu.planId ?? ""}`} cu={cu} plans={options} labels={labels} action={customerAction} />
      </PanelShell>
    );
  }

  const tabParam = first(query.d);
  const tab: "all" | CustomerStateKey = tabParam === "ACTIVE" || tabParam === "TRIAL" || tabParam === "SUSPENDED" || tabParam === "OVERDUE" ? tabParam : "all";
  const counts = { all: rows.length, ACTIVE: 0, TRIAL: 0, OVERDUE: 0, SUSPENDED: 0 };
  for (const r of rows) counts[stateOf(r)]++;
  const list: CustomerListItem[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    state: stateOf(r),
    plan: r.plan?.name ?? "—",
    users: `${r.counts.admins} + ${r.counts.field}`,
    warehouses: r.counts.warehouses.toLocaleString("tr-TR"),
    items: r.counts.items.toLocaleString("tr-TR"),
    last: lastLogin(r.lastLogin, now, t),
  }));
  return (
    <PanelShell {...shell} current="musteriler" title={t.title} sub={t.sub}>
      <MusterilerList key={`${tab}`} rows={list} counts={counts} tab={tab} q={first(query.q) ?? ""} labels={labels} />
    </PanelShell>
  );
}
