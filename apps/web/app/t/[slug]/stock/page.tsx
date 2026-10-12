import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Banner } from "@wms/ui";
import { getAppDb } from "@wms/db";
import { listStockOverview } from "@wms/domain/stock";
import { AppError } from "@wms/shared/errors";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("stockOverview");
  return { title: t("title") };
}
const first = (v: string | string[] | undefined): string | undefined => Array.isArray(v) ? v[0] : v;
const control = "inline-flex min-h-12 items-center justify-center rounded-lg border-2 border-border-strong px-4 py-2 font-bold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus";

export default async function StockPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const q = first(sp.q) ?? "";
  const after = first(sp.after);
  const warehouseId = first(sp.warehouse);
  const home = `/t/${encodeURIComponent(slug)}`;
  const path = `${home}/stock`;
  const t = await getTranslations("stockOverview");
  const documents = await getTranslations("stockDocuments");
  const { getAuthService } = await import("../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect(`/login?next=${encodeURIComponent(path)}`);
  let data: Awaited<ReturnType<typeof listStockOverview>>;
  try {
    data = await listStockOverview({ db: getAppDb(), principal, tenantSlug: slug }, {
      q, ...(after ? { after } : {}), ...(warehouseId ? { warehouseId } : {}),
    });
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === "NOT_FOUND" || e.code === "VALIDATION_FAILED") notFound();
      if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(path)}`);
      if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(path)}`);
      if (e.code === "FORBIDDEN") return <main className="mx-auto max-w-3xl p-4"><h1 className="text-2xl font-extrabold">{t("title")}</h1><Banner kind="warning">{t("locked")}</Banner></main>;
    }
    throw e;
  }
  const nextParams = new URLSearchParams({ q });
  if (warehouseId) nextParams.set("warehouse", warehouseId);
  if (data.next) nextParams.set("after", data.next);
  return (
    <main className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-4 px-4 py-6 text-ink">
      <a href={home} className={`${control} self-start`}>{t("home")}</a>
      <nav className="flex flex-wrap gap-2" aria-label={documents("title")}>
        <a href={`${path}/documents`} className={control}>{documents("title")}</a>
        <a href={`${path}/documents?new=STOCK_IN`} className={control}>{documents("in")}</a>
        <a href={`${path}/documents?new=STOCK_OUT`} className={control}>{documents("out")}</a>
        <a href={`${path}/documents?new=TRANSFER`} className={control}>{documents("transfer")}</a>
        <a href={`${home}/shipping`} className={control}>{documents("shipping")}</a>
        <a href={`${home}/production`} className={control}>{documents("production")}</a>
      </nav>
      <h1 className="text-2xl font-extrabold">{t("title")}</h1>
      <p className="text-ink-muted">{t("description")}</p>
      <form action={path} className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 font-bold">{t("search")}
          <input name="q" defaultValue={q} maxLength={128} className="min-h-12 w-full rounded-lg border-2 border-border-strong bg-surface px-3 font-normal focus-visible:outline-3 focus-visible:outline-focus" />
        </label>
        {warehouseId && <input type="hidden" name="warehouse" value={warehouseId} />}
        <button className={`${control} bg-accent text-on-accent`} type="submit">{t("find")}</button>
        {(q || after || warehouseId) && <a className={control} href={path}>{t("reset")}</a>}
      </form>
      <details className="rounded-card border border-border bg-surface p-3">
        <summary className="min-h-12 cursor-pointer content-center font-bold">{t("help")}</summary>
        <p>{t("explanation")}</p>
      </details>
      {data.items.length === 0 ? <Banner kind="info"><p>{t("empty")}</p><p>{t("emptyAction")}</p></Banner> : (
        <ul className="flex min-w-0 flex-col gap-3" aria-label={t("title")}>
          {data.items.map((row) => <li key={`${row.warehouseId}:${row.itemId}`} className="min-w-0 rounded-card border-2 border-border bg-surface p-4 shadow-card">
            <h2 className="break-words text-lg font-bold">{row.itemName}</h2>
            <p className="break-words text-ink-muted">{row.itemCode}</p>
            <p className="mt-2 break-words font-bold">{t("warehouse")}: {row.warehouseName} ({row.warehouseCode})</p>
            <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {(["physical", "reserved", "available"] as const).map((key) => <div key={key}>
                <dt className="text-sm text-ink-muted">{t(key)}</dt>
                <dd className={`break-all font-bold tabular-nums ${key === "available" ? "text-xl" : "text-lg"}`}>{row[key]} {row.unitCode}</dd>
              </div>)}
            </dl>
          </li>)}
        </ul>
      )}
      <nav className="flex flex-wrap gap-2" aria-label={t("pages")}>
        {after && <a href={`${path}?${new URLSearchParams({ q, ...(warehouseId ? { warehouse: warehouseId } : {}) })}`} className={control}>{t("first")}</a>}
        {data.next && <a href={`${path}?${nextParams}`} className={control}>{t("next")}</a>}
      </nav>
    </main>
  );
}
