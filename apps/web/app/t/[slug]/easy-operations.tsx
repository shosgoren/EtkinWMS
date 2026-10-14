import { getTranslations } from "next-intl/server";
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Banner, Boxes, ChevronRight, CircleCheck, ClipboardCheck, Clock, ListChecks, Lock, PackagePlus, Truck } from "@wms/ui";
import type { TaskMenuProps } from "./task-menu.tsx";

const FOCUS = "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus";
// T-984: "Görevlerim" tasarımı (Bakış). Dört gerçek iş aynı hedeflere gider; renk kategori `cat-*-ink` zemini + yüzey yazısıdır (ikon + metin de taşır).
const OPERATIONS = [
  { key: "receive", path: "/field/receive", Icon: PackagePlus, tone: "bg-cat-green-ink text-surface" },
  { key: "shipping", path: "/shipping", Icon: Truck, tone: "bg-cat-teal-ink text-surface" },
  { key: "transfer", path: "/stock/documents?new=TRANSFER", Icon: ArrowLeftRight, tone: "bg-cat-purple-ink text-surface" },
  { key: "production", path: "/production", Icon: Boxes, tone: "bg-cat-orange-ink text-surface" },
] as const;

/** Gösterilen sayı: tek sayfaya sığmadıysa "n+". */
const shown = (count: number, more: boolean): string => (more ? `${count}+` : String(count));

// Display uses the same permission flags as TaskMenu; destination pages/actions remain the authority.
export async function EasyOperations({ slug, allowed, myTasks, now, todayDone }: TaskMenuProps) {
  const t = await getTranslations("home");
  const base = `/t/${encodeURIComponent(slug)}`;
  const links = [
    { key: "stock", path: "/stock", allowed: allowed.stockView },
    { key: "items", path: "/items", allowed: allowed.stockView },
    { key: "warehouses", path: "/warehouses", allowed: true },
    { key: "tasks", path: "/field/tasks", allowed: allowed.stockView },
    { key: "members", path: "/members", allowed: allowed.usersManage },
    { key: "settings", path: "/settings", allowed: allowed.settingsManage },
    { key: "audit", path: "/audit", allowed: allowed.auditView },
  ] as const;

  // Gerçek sayılar (uydurma yok): bekleyen = "Şimdi" satırları, atanan = Görevlerim özeti, bugün = kendi işlem kayıtlarım.
  const rows = now?.kind === "rows" ? now.rows : [];
  const receiveRow = rows.find((r) => r.key === "receive");
  const putawayRow = rows.find((r) => r.key === "putaway");
  const pending = now === undefined || now.kind === "error" ? null : { count: rows.reduce((a, r) => a + r.count, 0), more: rows.some((r) => r.more) };
  const assigned = myTasks?.kind === "count" ? myTasks : null;
  const pulse = [
    pending === null ? null : { key: "pending", Icon: Clock, value: shown(pending.count, pending.more) },
    assigned === null ? null : { key: "assigned", Icon: ListChecks, value: shown(assigned.count, assigned.more) },
    todayDone === undefined ? null : { key: "today", Icon: CircleCheck, value: shown(todayDone.count, todayDone.more) },
  ].filter((x) => x !== null);
  const active = allowed.stockPost === true;

  return (
    <div className="easy-operations flex min-w-0 flex-col gap-5" data-testid="easy-operations">
      {pulse.length === 0 ? null : (
        <section aria-label={t("easy.pulse.label")} className="easy-pulse grid min-w-0 gap-2" style={{ gridTemplateColumns: `repeat(${pulse.length}, minmax(0, 1fr))` }}>
          {pulse.map(({ key, Icon, value }) => (
            <p key={key} data-pulse={key} className="easy-pulse-item m-0 flex min-w-0 flex-col gap-1 rounded-card bg-surface px-3 py-3 shadow-card">
              <span className="flex min-w-0 items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-ink-muted">
                <Icon className="size-4 shrink-0" strokeWidth={2.4} aria-hidden="true" />
                <span className="truncate">{t(`easy.pulse.${key}`)}</span>
              </span>
              <span className="easy-pulse-value text-3xl font-extrabold leading-none text-ink">{value}</span>
            </p>
          ))}
        </section>
      )}

      <section aria-labelledby="easy-tasks-title" className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 items-baseline justify-between gap-3">
          <h2 id="easy-tasks-title" className="text-sm font-extrabold uppercase tracking-widest text-ink">{t("easy.label")}</h2>
          <p className="m-0 truncate text-sm text-ink-muted">{t("easy.hint")}</p>
        </div>
        <ul className="easy-operation-grid m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-5">
          {OPERATIONS.map(({ key, path, Icon, tone }) => {
            // Mal kabul döşemesi gerçek bekleyenleri sayıyla gösterir; diğerleri kısa açıklama taşır.
            const counts = key === "receive" && (receiveRow !== undefined || putawayRow !== undefined) ? [
              receiveRow === undefined ? null : { k: "receipts", v: shown(receiveRow.count, receiveRow.more) },
              putawayRow === undefined ? null : { k: "putaway", v: shown(putawayRow.count, putawayRow.more) },
            ].filter((x) => x !== null) : [];
            const content = (
              <>
                <span className="easy-operation-icon flex size-14 shrink-0 items-center justify-center rounded-2xl">
                  <Icon className="size-8" strokeWidth={2} aria-hidden="true" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="break-words text-xl font-extrabold leading-tight">{t(`easy.${key}.title`)}</span>
                  {active && counts.length > 0 ? (
                    <span className="easy-operation-counts flex flex-wrap items-end gap-x-4 gap-y-1" data-testid="easy-receive-counts">
                      {counts.map((c) => (
                        <span key={c.k} className="flex flex-col">
                          <b className="text-3xl font-extrabold leading-none">{c.v}</b>
                          <small className="text-xs font-extrabold uppercase tracking-wider">{t(`easy.counts.${c.k}`)}</small>
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="break-words text-sm font-medium leading-snug">{active ? t(`easy.${key}.description`) : t("lockedReason")}</span>
                  )}
                </span>
                {active ? <ChevronRight className="size-7 shrink-0" aria-hidden="true" /> : <Lock className="size-6 shrink-0" aria-hidden="true" />}
              </>
            );
            const cls = `easy-operation-card ${FOCUS} flex h-full min-h-24 min-w-0 items-center gap-4 rounded-3xl p-4 text-left lg:min-h-52 lg:flex-col lg:items-start ${active ? tone : "bg-locked-bg text-locked-ink"}`;
            return (
              <li key={key} className="min-w-0">
                {active ? <a href={`${base}${path}`} data-operation={key} data-state="active" className={cls}>{content}</a> :
                  <div role="group" aria-label={t(`easy.${key}.title`)} aria-disabled="true" tabIndex={0} data-operation={key} data-state="locked" className={cls}>{content}</div>}
              </li>
            );
          })}
          {/* Sayım: alan işlevleri var, saha ekranı henüz yok — dürüstçe "Yakında" (tıklanmaz, iş sayısına girmez). */}
          <li className="min-w-0">
            <div role="group" aria-label={t("easy.count.title")} data-soon="count" className="easy-operation-card flex h-full min-h-24 min-w-0 items-center gap-4 rounded-3xl bg-locked-bg p-4 text-left text-locked-ink lg:min-h-52 lg:flex-col lg:items-start" data-state="locked">
              <span className="easy-operation-icon flex size-14 shrink-0 items-center justify-center rounded-2xl">
                <ClipboardCheck className="size-8" strokeWidth={2} aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="break-words text-xl font-extrabold leading-tight">{t("easy.count.title")}</span>
                <span className="break-words text-sm font-medium leading-snug">{t("easy.count.description")}</span>
              </span>
              <span className="shrink-0 rounded-full bg-surface px-3 py-1 text-xs font-extrabold uppercase tracking-wider">{t("soonLabel")}</span>
            </div>
          </li>
        </ul>
      </section>

      {now === undefined ? null : (
        <section aria-labelledby="easy-now-title" data-testid="now-card" data-state={now.kind} className="easy-now flex min-w-0 flex-col gap-3 rounded-3xl bg-surface p-4 shadow-card">
          <h2 id="easy-now-title" className="text-sm font-extrabold uppercase tracking-widest">{t("now.title")}</h2>
          {now.kind === "error" ? <Banner kind="warning"><p>{now.message}</p><p className="mt-1 text-sm">{now.code}</p></Banner> :
            now.kind === "empty" ? <p data-testid="now-empty" className="flex items-center gap-2 text-base text-ink-muted"><CircleCheck className="size-5 shrink-0" aria-hidden="true" />{t("now.empty")}</p> :
              <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2">
                {now.rows.map(row => {
                  const first = row.next[0];
                  return <li key={row.key} className="flex min-w-0 flex-col gap-2">
                    <a href={first?.href ?? `${base}/field/${row.key === "receive" ? "receive" : "tasks"}`} data-testid={`now-${row.key}`} data-count={row.count} className={`${FOCUS} easy-now-row flex min-h-16 min-w-0 items-center gap-3 rounded-2xl px-3 py-2 ${row.key === "receive" ? "bg-cat-green-bg text-cat-green-ink" : "bg-cat-sky-bg text-cat-sky-ink"}`}>
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface">{row.key === "receive" ? <PackagePlus className="size-6" aria-hidden="true" /> : <ArrowDownToLine className="size-6" aria-hidden="true" />}</span>
                      <span className="flex min-w-0 flex-1 flex-col gap-1"><span className="break-words font-extrabold">{t(`now.${row.key}`, { count: shown(row.count, row.more) })}</span>
                        {first === undefined ? null : <span data-testid={`now-${row.key}-next`} className="break-words text-sm font-semibold">{t("now.next", { label: first.label })}</span>}
                      </span><ChevronRight className="size-6 shrink-0" aria-hidden="true" />
                    </a>
                    {row.next[1] === undefined ? null : <a href={row.next[1].href} data-testid={`now-${row.key}-extra`} className={`${FOCUS} flex min-h-12 items-center rounded-xl px-3 py-2 text-sm font-semibold`}>{t("now.then", { label: row.next[1].label })}</a>}
                  </li>;
                })}
              </ul>}
        </section>
      )}
      {myTasks === undefined ? null : myTasks.kind === "error" ? <Banner kind="warning"><p>{myTasks.message}</p><p className="mt-1 text-sm">{myTasks.code}</p></Banner> :
        myTasks.count > 0 ? <a href={`${base}/field/tasks`} data-testid="my-tasks-card" className={`${FOCUS} flex min-h-16 items-center justify-between gap-3 rounded-3xl bg-ink p-4 text-surface`}>
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface text-ink"><ListChecks className="size-6" aria-hidden="true" /></span>
          <span className="flex min-w-0 flex-1 flex-col"><span className="text-xs font-extrabold uppercase tracking-widest">{t("myTasks.title")}</span><span className="break-words text-lg font-extrabold">{t("myTasks.assigned", { count: myTasks.more ? `${myTasks.count}+` : String(myTasks.count) })}</span></span><ChevronRight className="size-6 shrink-0" aria-hidden="true" />
        </a> : now?.kind === "rows" ? null : <p data-testid="my-tasks-empty" className="text-sm text-ink-muted">{t("myTasks.empty")}</p>}

      {active ? (
        <section aria-labelledby="easy-manual-title" className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 items-baseline justify-between gap-3">
            <h2 id="easy-manual-title" className="text-sm font-extrabold uppercase tracking-widest text-ink">{t("easy.manual.title")}</h2>
            <p className="m-0 truncate text-sm text-ink-muted">{t("easy.manual.hint")}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:max-w-xl">
            <a href={`${base}/stock/documents?new=STOCK_IN`} data-manual="in" className={`${FOCUS} easy-manual flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 border-ink px-3 text-sm font-extrabold uppercase tracking-wide text-ink`}><ArrowDownToLine className="size-5 shrink-0" aria-hidden="true" />{t("easy.manual.in")}</a>
            <a href={`${base}/stock/documents?new=STOCK_OUT`} data-manual="out" className={`${FOCUS} easy-manual flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 border-ink px-3 text-sm font-extrabold uppercase tracking-wide text-ink`}><ArrowUpFromLine className="size-5 shrink-0" aria-hidden="true" />{t("easy.manual.out")}</a>
          </div>
        </section>
      ) : null}

      <nav aria-label={t("easy.links")} className="flex min-w-0 flex-wrap gap-2">
        {links.slice(0, 4).filter(link => link.allowed).map(link => <a key={link.key} href={`${base}${link.path}`} className={`${FOCUS} inline-flex min-h-12 min-w-12 items-center justify-center rounded-xl border border-border-strong bg-surface px-4 py-2 text-sm font-bold`}>{t(`easy.${link.key}`)}</a>)}
        {links.slice(4).some(link => link.allowed) ? <details className="w-full min-w-0">
          <summary className={`${FOCUS} min-h-12 w-fit cursor-pointer rounded-xl px-4 py-3 text-sm font-bold`}>{t("easy.links")}</summary>
          <div className="flex flex-wrap gap-2 pt-2">
            {links.slice(4).filter(link => link.allowed).map(link => <a key={link.key} href={`${base}${link.path}`} className={`${FOCUS} inline-flex min-h-12 min-w-12 items-center justify-center rounded-xl border border-border-strong bg-surface px-4 py-2 text-sm font-bold`}>{t(`easy.${link.key}`)}</a>)}
          </div>
        </details> : null}
      </nav>
    </div>
  );
}
