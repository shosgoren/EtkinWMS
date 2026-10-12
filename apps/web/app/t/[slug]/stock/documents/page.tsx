import { headers } from "next/headers";
import { notFound,redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { getStockDocument,listStockDocuments } from "@wms/domain/stock";
import { AppError } from "@wms/shared/errors";
import { Banner } from "@wms/ui";
import { DocumentControls,DocumentForm } from "./document-form.tsx";
export const dynamic="force-dynamic";
const control="inline-flex min-h-12 items-center rounded-lg border-2 border-border-strong bg-surface px-4 py-2 font-bold focus-visible:outline-3 focus-visible:outline-focus";
const first=(v:string|string[]|undefined)=>Array.isArray(v)?v[0]:v;
export default async function DocumentsPage({params,searchParams}:{params:Promise<{slug:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const {slug}=await params,sp=await searchParams,t=await getTranslations("stockDocuments");
  const path=`/t/${encodeURIComponent(slug)}/stock/documents`,id=first(sp.id),kind=first(sp.new),after=first(sp.after);
  const {getAuthService}=await import("../../../../../lib/auth-service.ts");
  const principal=await getAuthService().getPrincipal(await headers());
  if(!principal) redirect(`/login?next=${encodeURIComponent(path)}`);
  let list:Awaited<ReturnType<typeof listStockDocuments>>,doc:Awaited<ReturnType<typeof getStockDocument>>|null;
  try{
    const context={db:getAppDb(),principal,tenantSlug:slug};
    list=await listStockDocuments(context,after?{after}:{}); doc=id?await getStockDocument(context,id):null;
  }catch(e){
    if(e instanceof AppError){
      if(e.code === "NOT_FOUND" || e.code === "VALIDATION_FAILED") notFound();
      if(e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(path)}`);
      if(e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(path)}`);
      if(e.code === "FORBIDDEN") return <main className="p-4"><Banner kind="warning">{t("locked")}</Banner></main>;
    }throw e;
  }
  return <main className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-4 px-4 py-6 text-ink">
    <nav className="flex flex-wrap gap-2"><a className={control} href={`/t/${encodeURIComponent(slug)}/stock`}>{t("stock")}</a><a className={control} href={path}>{t("title")}</a></nav>
    <h1 className="text-2xl font-extrabold">{kind === "STOCK_IN"?t("in"):kind === "STOCK_OUT"?t("out"):kind === "TRANSFER"?t("transfer"):t("title")}</h1>
    {doc ? <>
      <h2 className="text-xl font-bold">{doc.number ?? t("draft")} · {t(doc.kind === "STOCK_IN"?"in":"out")}</h2>
      <p>{doc.warehouseName} · {doc.businessDate}</p><p role="status">{t(`states.${doc.status}`)}</p><p>{doc.reason}</p>
      <ul className="flex flex-col gap-3">{doc.lines.map(line=><li key={line.id} className="rounded-card border-2 border-border p-4">
        <p className="font-bold">{line.itemCode} — {line.itemName}</p><p>{doc.kind === "STOCK_IN"?"+":"−"}{line.quantity} {line.unitCode}</p>
        <p>{line.sourceCode ?? line.targetCode}</p>{line.lotCode && <p>{t("lot")}: {line.lotCode}</p>}{line.serialNo && <p>{t("serial")}: {line.serialNo}</p>}
      </li>)}</ul>
      <p>{doc.status === "POSTED"?t("postedHelp"):t("notPosted")}</p>
      {doc.related.map(other=><a key={other.id} className={control} href={`${path}?id=${other.id}`}>{t("related")}: {other.number} · {other.warehouseName}</a>)}
      <DocumentControls key={`${doc.id}:${doc.version}`} slug={slug} document={doc} permissions={list.permissions}/>
    </> : (kind === "STOCK_IN" || kind === "STOCK_OUT" || kind === "TRANSFER") ? (kind === "TRANSFER" ? list.permissions.post : list.permissions.create) ? <DocumentForm slug={slug} kind={kind}/> : <Banner kind="warning">{t("locked")}</Banner> : <>
      {list.permissions.create && <nav className="flex flex-wrap gap-2"><a className={control} href={`${path}?new=STOCK_IN`}>{t("in")}</a><a className={control} href={`${path}?new=STOCK_OUT`}>{t("out")}</a></nav>}
      {list.permissions.post && <a className={control} href={`${path}?new=TRANSFER`}>{t("transfer")}</a>}
      {list.items.length === 0 && <p>{t("empty")}</p>}
      <ul className="flex flex-col gap-3">{list.items.map(row=><li key={row.id}><a className={`${control} flex-col items-start`} href={`${path}?id=${row.id}`}>
        <span>{row.number ?? t("draft")} · {t(row.kind === "STOCK_IN"?"in":"out")}</span><span>{row.warehouseName} · {row.businessDate} · {t(`states.${row.status}`)}</span><span>{row.reason}</span>
      </a></li>)}</ul>
      {list.next && <a className={control} href={`${path}?after=${encodeURIComponent(list.next)}`}>{t("next")}</a>}
    </>}
  </main>;
}
