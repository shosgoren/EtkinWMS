import { headers } from "next/headers";
import { notFound,redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { getShippingOrder,listShippingOrders } from "@wms/domain/operations";
import { AppError } from "@wms/shared/errors";
import { Banner } from "@wms/ui";
import { NewOrderForm,OrderCommand,PickForm,ShipForm } from "./shipping-form.tsx";
export const dynamic="force-dynamic";
const control="inline-flex min-h-12 items-center rounded-lg border-2 border-border-strong bg-surface px-4 py-2 font-bold focus-visible:outline-3 focus-visible:outline-focus";
const first=(v:string|string[]|undefined)=>Array.isArray(v)?v[0]:v;
const zero=(v:string)=>/^0(?:\.0+)?$/.test(v);
export default async function ShippingPage({params,searchParams}:{params:Promise<{slug:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const {slug}=await params,sp=await searchParams,t=await getTranslations("shipping"),home=`/t/${encodeURIComponent(slug)}`,path=`${home}/shipping`;
 const id=first(sp.id),q=first(sp.q)??"",after=first(sp.after),taskAfter=first(sp.taskAfter),stageAfter=first(sp.stageAfter);
 const {getAuthService}=await import("../../../../lib/auth-service.ts");const principal=await getAuthService().getPrincipal(await headers());
 if(!principal)redirect(`/login?next=${encodeURIComponent(path)}`);
 let data:Awaited<ReturnType<typeof listShippingOrders>>,order:Awaited<ReturnType<typeof getShippingOrder>>|null;
 try{const context={db:getAppDb(),principal,tenantSlug:slug};data=await listShippingOrders(context,{q,...(after?{after}:{})});order=id?await getShippingOrder(context,id,{...(taskAfter?{taskAfter}:{}),...(stageAfter?{stageAfter}:{})}):null;}
 catch(e){if(e instanceof AppError){if(e.code==="NOT_FOUND"||e.code==="VALIDATION_FAILED")notFound();if(e.code==="FORBIDDEN"&&e.detail==="MFA_REQUIRED")redirect(`/mfa?next=${encodeURIComponent(path)}`);if(e.code==="UNAUTHENTICATED")redirect(`/login?next=${encodeURIComponent(path)}`);if(e.code==="FORBIDDEN")return <main className="p-4"><Banner kind="warning">{t("locked")}</Banner></main>;}throw e;}
 const status=(value:string)=>t(value==="OPEN"?"openStatus":value==="CLOSED"?"closedStatus":"cancelledStatus");
 return <main className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-4 px-4 py-6 text-ink">
  <nav className="flex flex-wrap gap-2"><a className={control} href={`${home}/stock`}>{t("stock")}</a><a className={control} href={path}>{t("title")}</a></nav>
  <h1 className="text-2xl font-extrabold">{t("title")}</h1><p>{t("help")}</p>
  {order?<>
   <h2 className="break-words text-xl font-bold">{order.number} · {order.customerRef}</h2><p role="status">{status(order.status)}</p>
   <ul className="flex flex-col gap-3" aria-label={t("lines")}>{order.lines.map(line=><li key={line.id} className="min-w-0 rounded-card border-2 border-border p-3"><h3 className="break-words font-bold">{line.itemName}</h3><dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">{(["requested","reserved","shipped","open"] as const).map(key=><div key={key}><dt>{t(key)}</dt><dd className="break-all font-bold tabular-nums">{line[key]} {line.unitCode}</dd></div>)}</dl></li>)}</ul>
   {order.status==="OPEN"&&<>
    {data.permissions.approve&&<section className="flex flex-col gap-3" aria-label={t("prepare")}><h2 className="font-bold">{t("prepare")}</h2><p>{t("reserveHelp")}</p><div className="flex flex-wrap gap-2"><OrderCommand slug={slug} orderId={order.id} operation="reserve"/><OrderCommand slug={slug} orderId={order.id} operation="assign"/></div></section>}
    <section className="flex flex-col gap-3" aria-label={t("tasks")}><h2 className="font-bold">{t("tasks")}</h2>{order.tasks.length===0&&<p>{t("noTasks")}</p>}
     {order.tasks.map(task=>data.permissions.post&&task.canPick?<PickForm key={task.id} slug={slug} task={task}/>:<p key={task.id}>{task.itemName} · {task.warehouseName} / {task.sourceCode}: {task.quantity} {task.unitCode} — {t("locked")}</p>)}
     {order.taskNext&&<a className={control} href={`${path}?${new URLSearchParams({id:order.id,taskAfter:order.taskNext,...(stageAfter?{stageAfter}:{})})}`}>{t("nextTasks")}</a>}
    </section>
    <section className="flex flex-col gap-3" aria-label={t("staged")}><h2 className="font-bold">{t("staged")}</h2>{order.staged.length===0&&<p>{t("noStaged")}</p>}
     {order.staged.map(row=>data.permissions.post?<ShipForm key={`${row.lineId}:${row.warehouseId}:${row.quantity}`} slug={slug} orderId={order.id} row={row}/>:<p key={`${row.lineId}:${row.warehouseId}`}>{row.itemName} · {row.warehouseName}: {row.quantity} {row.unitCode}</p>)}
     {order.stageNext&&<a className={control} href={`${path}?${new URLSearchParams({id:order.id,stageAfter:order.stageNext,...(taskAfter?{taskAfter}:{})})}`}>{t("nextStaged")}</a>}
    </section>
    {data.permissions.approve&&order.lines.every(line=>zero(line.shipped))&&<OrderCommand key={`${order.id}:${order.version}`} slug={slug} orderId={order.id} operation="cancel" expectedVersion={order.version}/>}
   </>}
   <section aria-label={t("posted")}><h2 className="font-bold">{t("posted")}</h2><ul>{order.posted.map(doc=><li key={doc.id}><a className={control} href={`${home}/stock/documents?id=${doc.id}`}>{doc.number} · {doc.warehouseName} · {doc.date}</a></li>)}</ul></section>
  </>:first(sp.new)==="1"?data.permissions.create?<NewOrderForm slug={slug}/>:<Banner kind="warning">{t("locked")}</Banner>:<>
   {data.permissions.create&&<a className={control} href={`${path}?new=1`}>{t("new")}</a>}
   <form action={path} className="flex flex-wrap gap-2"><label className="min-w-0 flex-1">{t("search")}<input name="q" maxLength={128} defaultValue={q} className={`${control} block w-full`}/></label><button className={control}>{t("find")}</button></form>
   {data.items.length===0&&<p>{t("empty")}</p>}<ul className="flex flex-col gap-3">{data.items.map(row=><li key={row.id}><a className={`${control} flex-col items-start break-words`} href={`${path}?id=${row.id}`}><span>{row.number} · {row.customerRef}</span><span>{status(row.status)}</span></a></li>)}</ul>
   {data.next&&<a className={control} href={`${path}?${new URLSearchParams({q,after:data.next})}`}>{t("next")}</a>}
  </>}
 </main>;
}
