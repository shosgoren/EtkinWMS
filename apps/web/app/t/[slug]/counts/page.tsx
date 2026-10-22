import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { getMembershipSummary } from "@wms/domain/identity/member-queries";
import { hasPermission } from "@wms/domain/identity/permissions";
import { getCountReview, listCountSessions } from "@wms/domain/operations";
import { listWarehouses } from "@wms/domain/warehouse";
import { AppError } from "@wms/shared/errors";
import { LICON } from "../../../design/kalip-icons.ts";
import { KalipDetayIzgara, KalipHero, KalipKartBolum, KalipZaman, type KalipOlay } from "../kalip/detay.tsx";
import { KalipBaslik, KalipEkran } from "../kalip/ekran.tsx";
import { fmtQty } from "../kalip/format.ts";
import { KalipBos, KalipKart, KalipKartListe, KalipKilitliEkran } from "../kalip/liste.tsx";
import { kalipDark } from "../stock/belge-kalip.ts";
import { FormEkran } from "../stock/form-ekran.tsx";
import { CountCommand, NewCountForm } from "./counts-forms.tsx";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("counts");
  return { title: t("title") };
}

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const ICON = { d: LICON.clip, color: "6C4BD8" } as const;
const STATUS_COLOR: Record<string, string> = { COUNTING: "B85A14", SUBMITTED: "2F5DA8", APPROVED: "6C4BD8", POSTED: "2F7D5B", CANCELLED: "4E6476" };

// T-977 (B-51 yönetici): sayım oturumları (liste `listCountSessions`, document.approve), yeni sayım (`?new=1`: depo + raf kodları; başlat + raf görevleri),
// fark incelemesi (`?id=`: `getCountReview`; kör oturumda referans/fark yalnız `count_diff.approve` sahibine). Komutlar: onayla / fişi işle (`count_diff.approve`;
// görev ayrılığı açıksa sayımı yapan onaylayamaz), iptal (`document.approve`). Saha sayımı `/field/count` ekranındadır.
export default async function CountsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const t = await getTranslations("counts");
  const locale = await getLocale();
  const home = `/t/${encodeURIComponent(slug)}`;
  const path = `${home}/counts`;
  const { getAuthService } = await import("../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect(`/login?next=${encodeURIComponent(path)}`);
  const db = getAppDb();
  const call = { db, principal, tenantSlug: slug };
  const dark = await kalipDark();
  const summary = await getMembershipSummary({ db, principal });
  const current = summary.memberships.find((m) => m.slug === slug);
  if (current === undefined) notFound();
  const locked = (
    <main className="flex w-full min-w-0 flex-col">
      <KalipKilitliEkran title={t("title")} icon={ICON} text={t("locked")} hint={t("lockedHint")} dark={dark} home={home} />
    </main>
  );
  if (!hasPermission(current.roles, "document.approve", current.grants)) return locked;
  const canDiff = hasPermission(current.roles, "count_diff.approve", current.grants);
  const guard = (e: unknown): never => {
    if (e instanceof AppError) {
      if (e.code === "NOT_FOUND" || e.code === "VALIDATION_FAILED") notFound();
      if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(path)}`);
      if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(path)}`);
    }
    throw e;
  };
  const statusText = (s: string) => t(`status.${s}`);
  const newMain = { label: t("newShort"), aria: t("new"), d: LICON.plus, href: `${path}?new=1`, testId: "counts-new" };

  const id = first(sp.id);
  if (id !== undefined && id !== "") {
    let review: Awaited<ReturnType<typeof getCountReview>>;
    try {
      review = await getCountReview(call, { sessionId: id });
    } catch (e) {
      return guard(e);
    }
    const s = review.session;
    const open = s.status === "COUNTING" || s.status === "SUBMITTED";
    const uncounted = review.lines.filter((l) => l.counted === null).length;
    const lines: KalipOlay[] = review.lines.map((l, i) => {
      const diff = l.difference === null ? null : fmtQty(l.difference, locale);
      const bad = l.difference !== null && !/^-?0(?:\.0+)?$/.test(l.difference);
      return {
        key: `${l.locationCode}:${l.itemCode}:${l.stockStatus}:${i}`,
        title: `${l.locationCode} · ${l.itemName}`,
        meta: [l.reference === null ? t("hidden") : `${t("reference")} ${fmtQty(l.reference, locale)}`, l.counted === null ? t("notCounted") : `${t("counted")} ${fmtQty(l.counted, locale)}`].join(" · "),
        q: diff === null ? (l.counted === null ? "—" : "") : `${bad && !diff.startsWith("-") ? "+" : ""}${diff} ${l.unitCode}`,
        d: LICON.box,
        color: l.counted === null ? "B85A14" : bad ? "C62828" : "2F7D5B",
        qColor: bad ? "C62828" : "2F7D5B",
      };
    });
    const tasks: KalipOlay[] = review.tasks.map((x) => ({
      key: x.id,
      title: x.locationCode,
      meta: `${t(`taskStatus.${x.status}`)}${x.assigneeName === null ? "" : ` · ${x.assigneeName}`}`,
      q: "",
      d: LICON.raf,
      color: x.status === "DONE" ? "2F7D5B" : x.status === "CANCELLED" ? "4E6476" : "6C4BD8",
      qColor: "2F7D5B",
    }));
    return (
      <main className="flex w-full min-w-0 flex-col">
        <KalipEkran kind="detay" dark={dark} title={t("title")} icon={ICON} heading={false} testId="count-detail" bar={{ back: { href: path }, main: newMain }}>
          <KalipDetayIzgara
            left={
              <>
                <KalipHero label={t("hero")} name={s.warehouseName} code={`${s.startedByName} · ${s.startedAt.toISOString().slice(0, 10)}`} tags={s.blind ? [t("blindTag")] : []} d={ICON.d} color={STATUS_COLOR[s.status] ?? ICON.color} total={{ value: String(review.lines.length), sub: t("lineUnit"), crit: uncounted > 0 }} testId="count-hero">
                  <span className="tags">
                    <span className="tag" role="status" data-status={s.status}>
                      {statusText(s.status)}
                    </span>
                  </span>
                </KalipHero>
                <KalipKartBolum title={t("lines")} sub={uncounted > 0 ? t("uncounted", { n: uncounted }) : t("allCounted")} d={LICON.box} color="2F5DA8" testId="count-lines">
                  {lines.length === 0 ? <small className="mono">{t("noLines")}</small> : <KalipZaman items={lines} />}
                </KalipKartBolum>
                <KalipKartBolum title={t("tasks")} d={LICON.raf} color="6C4BD8" testId="count-tasks">
                  {tasks.length === 0 ? <small className="mono">{t("noTasks")}</small> : <KalipZaman items={tasks} />}
                </KalipKartBolum>
              </>
            }
            right={
              <>
                {open && canDiff ? (
                  <KalipKartBolum title={t("approve")} sub={uncounted > 0 ? t("approveWait") : t("approveSub")} d={LICON.check} color="2F7D5B" testId="count-approve-card">
                    {uncounted > 0 ? <small className="mono">{t("approveWait")}</small> : <CountCommand slug={slug} sessionId={s.id} operation="approve" />}
                  </KalipKartBolum>
                ) : null}
                {s.status === "APPROVED" && canDiff ? (
                  <KalipKartBolum title={t("post")} sub={t("postSub")} d={LICON.clip} color="6C4BD8" testId="count-post-card">
                    <CountCommand slug={slug} sessionId={s.id} operation="post" />
                  </KalipKartBolum>
                ) : null}
                {!canDiff && (open || s.status === "APPROVED") ? (
                  <KalipKartBolum title={t("approve")} d={LICON.lock} color="4E6476">
                    <small className="mono">{t("noDiffPermission")}</small>
                  </KalipKartBolum>
                ) : null}
                {open || s.status === "APPROVED" ? (
                  <KalipKartBolum title={t("cancel")} d={LICON.trash} color="C62828" testId="count-cancel-card">
                    <CountCommand slug={slug} sessionId={s.id} operation="cancel" />
                  </KalipKartBolum>
                ) : null}
                {s.status === "CANCELLED" && s.cancelReason !== null ? (
                  <KalipKartBolum title={t("cancelled")} d={LICON.info} color="4E6476">
                    <small>{s.cancelReason}</small>
                  </KalipKartBolum>
                ) : null}
              </>
            }
          />
        </KalipEkran>
      </main>
    );
  }

  if (first(sp.new) === "1") {
    let warehouses: { id: string; code: string; name: string }[] = [];
    try {
      warehouses = (await listWarehouses(call)).items.filter((w) => w.status === "ACTIVE").map((w) => ({ id: w.id, code: w.code, name: w.name }));
    } catch (e) {
      guard(e);
    }
    return (
      <main className="flex w-full min-w-0 flex-col">
        <FormEkran dark={dark} title={t("new")} icon={ICON} back={path} mainLabel={t("startShort")} mainAria={t("start")} testId="count-new">
          {warehouses.length === 0 ? <KalipBos title={t("noWarehouse")} iconD={LICON.depo} action={{ label: t("toWarehouses"), href: `${home}/warehouses`, kind: "go" }} /> : <NewCountForm slug={slug} warehouses={warehouses} />}
        </FormEkran>
      </main>
    );
  }

  let sessions: Awaited<ReturnType<typeof listCountSessions>>;
  try {
    sessions = await listCountSessions(call, { limit: 50 });
  } catch (e) {
    if (e instanceof AppError && e.code === "FORBIDDEN" && e.detail === undefined) return locked;
    return guard(e);
  }
  return (
    <main className="flex w-full min-w-0 flex-col">
      <KalipEkran kind="liste" dark={dark} title={t("title")} icon={ICON} testId="counts" bar={{ back: { href: `${home}/tasks?kind=COUNT` }, main: newMain }}>
        {sessions.length === 0 ? (
          <KalipBos title={t("empty")} hint={t("emptyHint")} action={{ label: t("firstCount"), href: `${path}?new=1`, kind: "add" }} iconD={ICON.d} />
        ) : (
          <>
            <KalipBaslik title={t("count", { n: sessions.length })} hint={t("hint")} />
            <KalipKartListe label={t("title")}>
              {sessions.map((s, i) => (
                <KalipKart
                  key={s.id}
                  index={i}
                  name={`${s.warehouseName} · ${t("racksN", { n: s.locationCount })}`}
                  code={[statusText(s.status), `${s.countedCount}/${s.lineCount}`, s.startedAt.toISOString().slice(0, 10), ...s.assignees].join(" · ")}
                  d={s.status === "POSTED" ? LICON.check : ICON.d}
                  color={STATUS_COLOR[s.status] ?? ICON.color}
                  href={`${path}?id=${s.id}`}
                  aria={`${s.warehouseName} · ${statusText(s.status)}`}
                  testId="count-card"
                />
              ))}
            </KalipKartListe>
          </>
        )}
      </KalipEkran>
    </main>
  );
}
