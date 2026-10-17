import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getMessages, getTranslations } from "next-intl/server";
import { getAppDb, getHealthProbe, type HealthSnapshot } from "@wms/db";
import { listCharges } from "@wms/domain/platform/charges";
import { listCustomers, type CustomerRow } from "@wms/domain/platform/customers";
import { listDemoRequests } from "@wms/domain/platform/demo-requests";
import { AppError } from "@wms/shared/errors";
import { loadMailConfig } from "@wms/shared/mailer";
import { THEME_COOKIE } from "../design/theme.ts";
import { C, dz } from "../design/yonet-tokens.ts";
import { YICON } from "../design/yonet-icons.ts";
import { panelOperatorOrExit } from "./gate.ts";
import { panelLabels, panelNav } from "./nav.ts";
import { nearLimit } from "./ozet-rules.ts";
import { OzetView, type OzetHealth, type OzetKpi, type OzetTodo } from "./ozet-view.tsx";
import { PanelShell } from "./shell.tsx";

// Panel · Özet (yonet.etkinyazilim.com/; ADR-027 §2, §9, T-408). Yalnız platform operatörü. Göstergeler yalnız sayı; yapılacaklar
// bekleyen talep, geciken tahakkuk, 30 gün içinde biten deneme ve paket sınırına yaklaşan müşteri; sistem durumu derin sağlık
// yoklamasından (veritabanı, kuyruk, worker) ve posta ayarından.
export const dynamic = "force-dynamic";

const TZ = "Europe/Istanbul";
const DAY = 86_400_000;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("panel.ozet");
  return { title: t("title"), robots: { index: false, follow: false } };
}

interface Msgs {
  readonly title: string;
  readonly sub: string;
  readonly kActive: string;
  readonly kActiveSub: string;
  readonly kTrial: string;
  readonly kTrialSub: string;
  readonly kLate: string;
  readonly kLateSub: string;
  readonly kReq: string;
  readonly kReqSub: string;
  readonly todoHead: string;
  readonly todoCount: string;
  readonly todoEmpty: string;
  readonly wToday: string;
  readonly w30: string;
  readonly wNow: string;
  readonly tagReq: string;
  readonly tagPay: string;
  readonly tagTrial: string;
  readonly tagLimit: string;
  readonly tReq: string;
  readonly tPay: string;
  readonly tTrial: string;
  readonly tLimit: string;
  readonly units: { readonly admins: string; readonly field: string; readonly warehouses: string; readonly items: string };
  readonly nouns: { readonly admins: string; readonly field: string; readonly warehouses: string; readonly items: string };
  readonly monthNames: readonly string[];
  readonly healthHead: string;
  readonly checked: string;
  readonly hApp: string;
  readonly hWorker: string;
  readonly hBackup: string;
  readonly hMail: string;
  readonly hPay: string;
  readonly vOk: string;
  readonly vDbDown: string;
  readonly vQueueSlow: string;
  readonly vWorkerDown: string;
  readonly vBackup: string;
  readonly vMailOn: string;
  readonly vMailOff: string;
  readonly vPay: string;
}

function fill(s: string, v: Readonly<Record<string, string | number>>): string {
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));
}

/** İstanbul takvim günü (YYYY-MM-DD). */
function day(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function trialTodos(customers: readonly CustomerRow[], now: Date, t: Msgs): OzetTodo[] {
  const fmt = new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
  return customers
    .filter((c) => c.state === "TRIAL" && c.trialEndsAt !== null && c.trialEndsAt.getTime() >= now.getTime() && c.trialEndsAt.getTime() - now.getTime() <= 30 * DAY)
    .sort((a, b) => (a.trialEndsAt?.getTime() ?? 0) - (b.trialEndsAt?.getTime() ?? 0))
    .map((c) => ({ when: t.w30, tag: t.tagTrial, bg: dz("FFE7A8"), fg: dz("4A3500"), text: fill(t.tTrial, { company: c.name, date: fmt.format(c.trialEndsAt as Date) }) }));
}

function limitTodos(customers: readonly CustomerRow[], t: Msgs): OzetTodo[] {
  const out: OzetTodo[] = [];
  for (const c of customers) {
    if (c.plan === null || c.state === "SUSPENDED") continue;
    for (const k of ["admins", "field", "warehouses", "items"] as const) {
      const left = nearLimit(c.plan.limits[k], c.counts[k]);
      if (left === null) continue;
      out.push({ when: t.wNow, tag: t.tagLimit, bg: C.chip, fg: C.fg, text: fill(t.tLimit, { company: c.name, unit: t.units[k], n: left.toLocaleString("tr-TR"), noun: t.nouns[k] }) });
    }
  }
  return out;
}

function healthRows(snap: HealthSnapshot | null, mailOn: boolean, t: Msgs): OzetHealth[] {
  const ok = dz("17804F");
  const warn = dz("B07D00");
  const bad = dz("C62828");
  const db = snap?.db.ok === true;
  const worker = snap?.worker.ok === true && snap.queue.ok;
  const flow = snap?.progress.ok === true;
  return [
    { k: t.hApp, v: db ? t.vOk : t.vDbDown, color: db ? ok : bad },
    { k: t.hWorker, v: worker ? (flow ? t.vOk : t.vQueueSlow) : t.vWorkerDown, color: worker ? (flow ? ok : warn) : bad },
    { k: t.hBackup, v: t.vBackup, color: C.track },
    { k: t.hMail, v: mailOn ? t.vMailOn : t.vMailOff, color: mailOn ? ok : warn },
    { k: t.hPay, v: t.vPay, color: warn },
  ];
}

export default async function PanelHome() {
  const principal = await panelOperatorOrExit("/");
  const db = getAppDb();
  const [customers, charges, requests] = await Promise.all([
    listCustomers({ db, principal }),
    listCharges({ db, principal }),
    listDemoRequests({ db, principal }),
  ]).catch((e: unknown) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const snap = await getHealthProbe()
    .check()
    .catch(() => null);
  let mailOn = false;
  try {
    mailOn = loadMailConfig(process.env).mode === "resend";
  } catch {
    mailOn = false;
  }
  const t = ((await getMessages()).panel as unknown as { ozet: Msgs }).ozet;
  const now = new Date();
  const today = day(now);
  const pending = requests.filter((r) => r.status === "PENDING").length;
  const overdue = charges.filter((c) => c.status === "OVERDUE");
  const count = (s: CustomerRow["state"]): number => customers.filter((c) => c.state === s).length;
  const trialSoon = trialTodos(customers, now, t);
  const kpis: OzetKpi[] = [
    { label: t.kActive, value: count("ACTIVE"), sub: t.kActiveSub, accent: dz("17804F"), icon: YICON.check },
    { label: t.kTrial, value: count("TRIAL"), sub: fill(t.kTrialSub, { n: trialSoon.length }), accent: dz("B07D00"), icon: YICON.clock },
    { label: t.kLate, value: count("OVERDUE"), sub: fill(t.kLateSub, { n: overdue.length }), accent: dz("C62828"), icon: YICON.warn },
    { label: t.kReq, value: pending, sub: t.kReqSub, accent: dz("3D2A6B"), icon: YICON.req },
  ];
  const todos: OzetTodo[] = [
    ...(pending > 0 ? [{ when: t.wToday, tag: t.tagReq, bg: dz("3D2A6B"), fg: dz("FFFFFF"), text: fill(t.tReq, { n: pending }) }] : []),
    ...overdue.map((c) => ({
      when: t.wToday,
      tag: t.tagPay,
      bg: dz("C62828"),
      fg: dz("FFFFFF"),
      text: fill(t.tPay, {
        company: c.company,
        month: t.monthNames[Number(c.period.slice(5, 7)) - 1] ?? c.period,
        days: Math.max(Math.round((Date.parse(today) - Date.parse(c.dueOn)) / DAY), 1),
      }),
    })),
    ...trialSoon,
    ...limitTodos(customers, t),
  ];
  const time = new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  const dark = (await cookies()).get(THEME_COOKIE)?.value === "koyu";
  return (
    <PanelShell
      dark={dark}
      current="ozet"
      title={t.title}
      sub={fill(t.sub, { n: customers.length })}
      nav={await panelNav(principal, pending, overdue.length)}
      labels={await panelLabels()}
    >
      <OzetView
        kpis={kpis}
        todos={todos}
        todoHead={t.todoHead}
        todoCount={fill(t.todoCount, { n: todos.length })}
        emptyTodo={t.todoEmpty}
        health={healthRows(snap, mailOn, t)}
        healthHead={t.healthHead}
        checked={fill(t.checked, { time })}
      />
    </PanelShell>
  );
}
