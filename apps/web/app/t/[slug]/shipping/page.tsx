import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { getShippingOrder, listShippingOrders } from "@wms/domain/operations";
import { AppError } from "@wms/shared/errors";
import { LICON } from "../../../design/kalip-icons.ts";
import { KalipDetayIzgara, KalipHero, KalipKartBolum, KalipZaman, type KalipOlay } from "../kalip/detay.tsx";
import { KalipBaslik, KalipEkran } from "../kalip/ekran.tsx";
import { fmtQty } from "../kalip/format.ts";
import { KalipAra, KalipBos, KalipCipler, KalipDaha, KalipKart, KalipKartListe, KalipKilitliEkran } from "../kalip/liste.tsx";
import { BOLUM_ICON, bolumCipleri, kalipDark } from "../stock/belge-kalip.ts";
import { FormEkran } from "../stock/form-ekran.tsx";
import { NewOrderForm, OrderCommand, PickForm, ShipForm } from "./shipping-form.tsx";

// Sevkiyat (T-972, B-63 grup 2): sipariş listesi (KalipListe), sipariş ayrıntısı (KalipDetay: kimlik, satırlar, 1-2-3 adım kartları,
// sevk belgeleri), yeni sipariş (KalipForm). Veri, yetki ve eylemler değişmedi; stok ayırma / toplama / sevk kuralları ve I-15 kilitleri
// sunucu eylemlerindedir. Bilinçli farklar: durum süzgeci sunucuda yok → çipler bölüm geçişidir.
export const dynamic = "force-dynamic";
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const zero = (v: string) => /^0(?:\.0+)?$/.test(v);

export default async function ShippingPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params,
    sp = await searchParams,
    t = await getTranslations("shipping"),
    so = await getTranslations("stockOverview"),
    tk = await getTranslations("kural"),
    locale = await getLocale(),
    home = `/t/${encodeURIComponent(slug)}`,
    path = `${home}/shipping`;
  const id = first(sp.id),
    q = first(sp.q) ?? "",
    after = first(sp.after),
    taskAfter = first(sp.taskAfter),
    stageAfter = first(sp.stageAfter);
  const { getAuthService } = await import("../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (!principal) redirect(`/login?next=${encodeURIComponent(path)}`);
  const dark = await kalipDark();
  let data: Awaited<ReturnType<typeof listShippingOrders>>, order: Awaited<ReturnType<typeof getShippingOrder>> | null;
  try {
    const context = { db: getAppDb(), principal, tenantSlug: slug };
    data = await listShippingOrders(context, { q, withTotal: !id && first(sp.new) !== "1" && !after, ...(after ? { after } : {}) });
    order = id ? await getShippingOrder(context, id, { ...(taskAfter ? { taskAfter } : {}), ...(stageAfter ? { stageAfter } : {}) }) : null;
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === "NOT_FOUND" || e.code === "VALIDATION_FAILED") notFound();
      if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(path)}`);
      if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(path)}`);
      if (e.code === "FORBIDDEN")
        return (
          <main className="flex w-full min-w-0 flex-col">
            <KalipKilitliEkran title={t("title")} icon={BOLUM_ICON.shipping} text={t("locked")} hint={t("k.lockedHint")} dark={dark} home={home} />
          </main>
        );
    }
    throw e;
  }
  const status = (value: string) => t(value === "OPEN" ? "openStatus" : value === "CLOSED" ? "closedStatus" : "cancelledStatus");
  const fq = (v: string) => fmtQty(v, locale);
  const newMain = { label: t("k.newShort"), aria: t("new"), d: LICON.plus, href: `${path}?new=1`, disabled: !data.permissions.create, testId: "shipping-new" };

  if (order) {
    const lines: KalipOlay[] = order.lines.map((line) => ({
      key: line.id,
      title: line.itemName,
      meta: `${t("requested")} ${fq(line.requested)} · ${t("reserved")} ${fq(line.reserved)} · ${t("shipped")} ${fq(line.shipped)}`,
      q: `${t("open")} ${fq(line.open)} ${line.unitCode}`,
      d: LICON.box,
      color: zero(line.open) ? "2F7D5B" : "B85A14",
      qColor: zero(line.open) ? "2F7D5B" : "B85A14",
    }));
    return (
      <main className="flex w-full min-w-0 flex-col">
        <KalipEkran kind="detay" dark={dark} title={t("title")} icon={BOLUM_ICON.shipping} heading={false} testId="shipping-detail" bar={{ back: { href: path }, main: newMain }}>
          <KalipDetayIzgara
            left={
              <>
                <KalipHero label={t("k.hero")} name={order.number} code={order.customerRef ?? ""} tags={[]} d={BOLUM_ICON.shipping.d} color={BOLUM_ICON.shipping.color} total={{ value: String(order.lines.length), sub: t("k.lineUnit"), crit: false }} testId="shipping-hero">
                  <span className="tags">
                    <span className="tag" role="status" data-status={order.status}>
                      {status(order.status)}
                    </span>
                  </span>
                </KalipHero>
                <KalipKartBolum label={t("lines")} title={t("lines")} sub={t("help")} d={LICON.box} color="2F5DA8" testId="shipping-lines">
                  <KalipZaman items={lines} />
                </KalipKartBolum>
                <KalipKartBolum label={t("posted")} title={t("posted")} d={LICON.clip} color="6C4BD8" testId="shipping-posted">
                  {order.posted.length === 0 ? <small className="mono">{t("k.noPosted")}</small> : null}
                  {order.posted.map((doc) => (
                    <a key={doc.id} className="more" href={`${home}/stock/documents?id=${doc.id}`}>
                      {doc.number} · {doc.warehouseName} · {doc.date}
                    </a>
                  ))}
                </KalipKartBolum>
              </>
            }
            right={
              order.status === "OPEN" ? (
                <>
                  {data.permissions.approve && (
                    <KalipKartBolum label={t("prepare")} title={t("prepare")} sub={t("reserveHelp")} d={LICON.lock} color="2F5DA8" testId="shipping-prepare">
                      <div className="flex flex-wrap gap-2">
                        <OrderCommand slug={slug} orderId={order.id} operation="reserve" />
                        <OrderCommand slug={slug} orderId={order.id} operation="assign" />
                      </div>
                    </KalipKartBolum>
                  )}
                  <KalipKartBolum label={t("tasks")} title={t("tasks")} d={LICON.raf} color="0E7C7B" testId="shipping-tasks">
                    {order.tasks.length === 0 && <small className="mono">{t("noTasks")}</small>}
                    {data.permissions.post && order.tasks.some((x) => x.canPick) ? (
                      // T-977: aynı toplama görevleri sahada (okut → doğrula → miktar) yürütülebilir.
                      <a className="more" href={`${home}/field/pick?${new URLSearchParams({ task: order.tasks.find((x) => x.canPick)?.id ?? "" })}`} data-testid="shipping-field-pick">
                        {t("k.fieldPick")}
                      </a>
                    ) : null}
                    {order.tasks.map((task) =>
                      data.permissions.post && task.canPick ? (
                        <PickForm key={task.id} slug={slug} task={task} />
                      ) : (
                        <p key={task.id}>
                          {task.itemName} · {task.warehouseName} / {task.sourceCode}: {task.quantity} {task.unitCode} — {t("locked")}
                        </p>
                      ),
                    )}
                    {order.taskNext && (
                      <a className="more" href={`${path}?${new URLSearchParams({ id: order.id, taskAfter: order.taskNext, ...(stageAfter ? { stageAfter } : {}) })}`}>
                        {t("nextTasks")}
                      </a>
                    )}
                  </KalipKartBolum>
                  <KalipKartBolum label={t("staged")} title={t("staged")} d={LICON.moveOut} color="B85A14" testId="shipping-staged">
                    {order.staged.length === 0 && <small className="mono">{t("noStaged")}</small>}
                    {data.permissions.post && order.staged.length > 0 ? (
                      <a className="more" href={`${home}/field/ship?${new URLSearchParams({ order: order.id })}`} data-testid="shipping-field-ship">
                        {t("k.fieldShip")}
                      </a>
                    ) : null}
                    {order.staged.map((row) =>
                      data.permissions.post ? (
                        <ShipForm key={`${row.lineId}:${row.warehouseId}:${row.quantity}`} slug={slug} orderId={order.id} row={row} />
                      ) : (
                        <p key={`${row.lineId}:${row.warehouseId}`}>
                          {row.itemName} · {row.warehouseName}: {row.quantity} {row.unitCode}
                        </p>
                      ),
                    )}
                    {order.stageNext && (
                      <a className="more" href={`${path}?${new URLSearchParams({ id: order.id, stageAfter: order.stageNext, ...(taskAfter ? { taskAfter } : {}) })}`}>
                        {t("nextStaged")}
                      </a>
                    )}
                  </KalipKartBolum>
                  {data.permissions.approve && order.lines.every((line) => zero(line.shipped)) && (
                    <KalipKartBolum title={t("cancel")} d={LICON.trash} color="C62828" testId="shipping-cancel">
                      <OrderCommand key={`${order.id}:${order.version}`} slug={slug} orderId={order.id} operation="cancel" expectedVersion={order.version} />
                    </KalipKartBolum>
                  )}
                </>
              ) : null
            }
          />
        </KalipEkran>
      </main>
    );
  }

  if (first(sp.new) === "1") {
    if (!data.permissions.create)
      return (
        <main className="flex w-full min-w-0 flex-col">
          <KalipKilitliEkran title={t("new")} icon={BOLUM_ICON.shipping} text={t("locked")} hint={t("k.lockedHint")} dark={dark} home={path} />
        </main>
      );
    return (
      <main className="flex w-full min-w-0 flex-col">
        <FormEkran dark={dark} title={t("new")} icon={BOLUM_ICON.shipping} back={path} mainLabel={t("k.saveShort")} mainAria={t("k.saveAria")} testId="shipping-new-form">
          <NewOrderForm slug={slug} />
        </FormEkran>
      </main>
    );
  }

  const chips = bolumCipleri(home, "shipping", { stock: so("k.chipStock"), documents: so("k.chipDocs"), shipping: so("k.chipShipping"), production: so("k.chipProduction") });
  return (
    <main className="flex w-full min-w-0 flex-col">
      <KalipEkran kind="liste" dark={dark} title={t("title")} icon={BOLUM_ICON.shipping} testId="shipping" bar={{ back: { href: home }, main: newMain }}>
        <KalipAra label={t("search")} placeholder={t("search")} action={path} defaultValue={q} />
        <KalipCipler label={so("k.chips")} chips={chips} />
        {data.items.length === 0 ? (
          <KalipBos
            title={q !== "" ? tk("notFoundSearch") : t("empty")}
            hint={data.permissions.create ? t("k.emptyHint") : t("help")}
            action={q !== "" ? { label: so("reset"), href: path, kind: "clear" } : data.permissions.create ? { label: t("k.firstOrder"), href: `${path}?new=1`, kind: "add" } : { label: tk("home"), href: home, kind: "go" }}
            iconD={BOLUM_ICON.shipping.d}
          />
        ) : (
          <>
            <KalipBaslik title={data.total !== undefined ? t("k.count", { n: data.total }) : data.next === null && after === undefined ? t("k.count", { n: data.items.length }) : t("k.countMore", { n: data.items.length })} hint={t("k.hint")} />
            <KalipKartListe label={t("title")}>
              {data.items.map((row, i) => (
                <KalipKart
                  key={row.id}
                  index={i}
                  name={row.number}
                  code={[row.customerRef, status(row.status)].filter((x) => x !== null && x !== "").join(" · ")}
                  d={row.status === "CLOSED" ? LICON.check : row.status === "OPEN" ? BOLUM_ICON.shipping.d : LICON.close}
                  color={row.status === "CLOSED" ? "2F7D5B" : row.status === "OPEN" ? BOLUM_ICON.shipping.color : "4E6476"}
                  href={`${path}?id=${row.id}`}
                  aria={[row.number, row.customerRef, status(row.status)].filter((x) => x !== null && x !== "").join(" · ")}
                  testId="shipping-card"
                />
              ))}
            </KalipKartListe>
          </>
        )}
        {data.next ? (
          <KalipDaha href={`${path}?${new URLSearchParams({ q, after: data.next })}`} iconD={LICON.plus}>
            {t("next")}
          </KalipDaha>
        ) : null}
      </KalipEkran>
    </main>
  );
}
