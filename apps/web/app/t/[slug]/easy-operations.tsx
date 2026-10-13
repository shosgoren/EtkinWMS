import { getTranslations } from "next-intl/server";
import { ArrowLeftRight, Banner, Boxes, ChevronRight, Lock, PackagePlus, Truck } from "@wms/ui";
import type { TaskMenuProps } from "./task-menu.tsx";

const FOCUS = "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus";
const OPERATIONS = [
  { key: "receive", path: "/field/receive", Icon: PackagePlus, tone: "bg-cat-orange-bg text-cat-orange-ink" },
  { key: "transfer", path: "/stock/documents?new=TRANSFER", Icon: ArrowLeftRight, tone: "bg-cat-sky-bg text-cat-sky-ink" },
  { key: "production", path: "/production", Icon: Boxes, tone: "bg-cat-purple-bg text-cat-purple-ink" },
  { key: "shipping", path: "/shipping", Icon: Truck, tone: "bg-cat-green-bg text-cat-green-ink" },
] as const;

// Display uses the same permission flags as TaskMenu; destination pages/actions remain the authority.
export async function EasyOperations({ slug, allowed, myTasks, now }: TaskMenuProps) {
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

  return (
    <div className="easy-operations flex min-w-0 flex-col gap-5" data-testid="easy-operations">
      <section aria-label={t("easy.label")}>
        <p className="mb-3 text-base text-ink-muted">{t("easy.hint")}</p>
        <ul className="easy-operation-grid m-0 grid list-none grid-cols-2 gap-3 p-0 lg:grid-cols-4">
          {OPERATIONS.map(({ key, path, Icon, tone }) => {
            const active = allowed.stockPost === true;
            const content = (
              <>
                <span className="flex w-full items-start justify-between gap-2">
                  <span className="easy-operation-icon flex size-14 shrink-0 items-center justify-center rounded-2xl bg-surface">
                    <Icon className="size-8" strokeWidth={2} aria-hidden="true" />
                  </span>
                  {active ? <ChevronRight className="size-6 shrink-0" aria-hidden="true" /> : <Lock className="size-6 shrink-0" aria-hidden="true" />}
                </span>
                <span className="break-words text-xl font-extrabold sm:text-2xl">{t(`easy.${key}.title`)}</span>
                <span className="break-words text-sm font-medium leading-snug">{active ? t(`easy.${key}.description`) : t("lockedReason")}</span>
              </>
            );
            const cls = `easy-operation-card ${FOCUS} flex h-full min-h-44 min-w-0 flex-col gap-3 rounded-card border-2 border-transparent p-4 text-left shadow-card sm:min-h-52 sm:p-5 ${active ? tone : "bg-locked-bg text-locked-ink"}`;
            return (
              <li key={key} className="min-w-0">
                {active ? <a href={`${base}${path}`} data-operation={key} data-state="active" className={cls}>{content}</a> :
                  <div role="group" aria-label={t(`easy.${key}.title`)} aria-disabled="true" tabIndex={0} data-operation={key} data-state="locked" className={cls}>{content}</div>}
              </li>
            );
          })}
        </ul>
      </section>

      {now === undefined ? null : (
        <section aria-labelledby="easy-now-title" data-testid="now-card" data-state={now.kind} className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-surface p-4">
          <h2 id="easy-now-title" className="text-lg font-extrabold">{t("now.title")}</h2>
          {now.kind === "error" ? <Banner kind="warning"><p>{now.message}</p><p className="mt-1 text-sm">{now.code}</p></Banner> :
            now.kind === "empty" ? <p data-testid="now-empty" className="text-base text-ink-muted">{t("now.empty")}</p> :
              <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2">
                {now.rows.map(row => {
                  const shown = row.more ? `${row.count}+` : String(row.count);
                  const first = row.next[0];
                  return <li key={row.key} className="flex min-w-0 flex-col gap-2">
                    <a href={first?.href ?? `${base}/field/${row.key === "receive" ? "receive" : "tasks"}`} data-testid={`now-${row.key}`} data-count={row.count} className={`${FOCUS} flex min-h-14 min-w-0 items-center gap-3 rounded-xl border border-border px-3 py-2`}>
                      <span className="flex min-w-0 flex-1 flex-col gap-1"><span className="break-words font-bold">{t(`now.${row.key}`, { count: shown })}</span>
                        {first === undefined ? null : <span data-testid={`now-${row.key}-next`} className="break-words text-sm text-ink-muted">{t("now.next", { label: first.label })}</span>}
                      </span><ChevronRight className="size-6 shrink-0" aria-hidden="true" />
                    </a>
                    {row.next[1] === undefined ? null : <a href={row.next[1].href} data-testid={`now-${row.key}-extra`} className={`${FOCUS} flex min-h-12 items-center rounded-xl px-3 py-2 text-sm font-semibold`}>{t("now.then", { label: row.next[1].label })}</a>}
                  </li>;
                })}
              </ul>}
        </section>
      )}
      {myTasks === undefined ? null : myTasks.kind === "error" ? <Banner kind="warning"><p>{myTasks.message}</p><p className="mt-1 text-sm">{myTasks.code}</p></Banner> :
        myTasks.count > 0 ? <a href={`${base}/field/tasks`} data-testid="my-tasks-card" className={`${FOCUS} flex min-h-14 items-center justify-between gap-3 rounded-card border border-border bg-surface p-4`}>
          <span className="flex min-w-0 flex-col"><span className="text-sm text-ink-muted">{t("myTasks.title")}</span><span className="break-words font-bold">{t("myTasks.assigned", { count: myTasks.more ? `${myTasks.count}+` : String(myTasks.count) })}</span></span><ChevronRight className="size-6 shrink-0" aria-hidden="true" />
        </a> : now?.kind === "rows" ? null : <p data-testid="my-tasks-empty" className="text-sm text-ink-muted">{t("myTasks.empty")}</p>}
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
