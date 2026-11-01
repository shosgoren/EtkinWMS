import { customLabelHref } from "../custom-labels/routing.ts";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import {
  LABEL_TEMPLATE_VERSION,
  LabelCharsetError,
  LabelTooLongError,
  MAX_LABELS_PER_DOCUMENT,
  loadLabelSource,
  loadProductLabelBatch,
  toSvgPages,
  toZplDocument,
} from "@wms/domain/labels";
import { ITEM_CARD_TYPES } from "@wms/domain/catalog";
import { parseExtraFilters, domainExtraFilters } from "../items/filters.ts";
import { productQrDocument } from "./product-qr.ts";
import { LICON } from "../../../design/kalip-icons.ts";
import { KalipKilitliEkran } from "../kalip/liste.tsx";
import { temaKoyu } from "../../../design/theme.ts";
import { LabelNotice, LabelPreview, LabelShell } from "./label-preview.tsx";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("labels");
  return { title: t("title") };
}

type Search = Record<string, string | string[] | undefined>;
function one(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

export default async function LabelsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const t = await getTranslations("labels");
  const tp = await getTranslations("items.productLabels");
  const { getAuthService } = await import("../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  const qs = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v] as [string, string]] : [])));
  const returnTo = `/t/${encodeURIComponent(slug)}/labels${qs.size > 0 ? `?${qs.toString()}` : ""}`;
  if (principal === null) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  const copiesRaw = one(sp.copies);
  const copies = copiesRaw === undefined ? 1 : /^\d{1,4}$/.test(copiesRaw) ? Number(copiesRaw) : 0;
  const call = { db: getAppDb(), principal, tenantSlug: slug };

  const dark = temaKoyu(await cookies());
  // Geri: etiketin geldiği ekran (ürün kartı / depo), yoksa ana ekran.
  const home = `/t/${encodeURIComponent(slug)}`;
  const itemId = one(sp.item);
  const warehouseId = one(sp.warehouse);
  const batchMode = one(sp.products) === "1";
  const filterParams = new URLSearchParams(qs);
  for (const key of ["products", "after", "copies"]) filterParams.delete(key);
  const back = batchMode ? `${home}/items?${filterParams.toString()}` : itemId !== undefined ? `${home}/items/${encodeURIComponent(itemId)}` : warehouseId !== undefined ? `${home}/warehouses/${encodeURIComponent(warehouseId)}` : home;
  const main = (children: React.ReactNode) => <main className="flex w-full min-w-0 flex-col">{children}</main>;
  const backAction = { label: t("goBack"), href: back };
  const shell = (children: React.ReactNode) =>
    main(
      <LabelShell dark={dark} back={back} title={t("title")}>
        {children}
      </LabelShell>,
    );

  try {
    if (copies < 1) return shell(<LabelNotice title={t("errors.copies", { max: MAX_LABELS_PER_DOCUMENT })} action={backAction} />);
    if (batchMode) {
      if (itemId !== undefined || warehouseId !== undefined || ["q", "type", "status", "after", "copies"].some((key) => Array.isArray(sp[key]))) notFound();
      const extra = parseExtraFilters(sp);
      const type = one(sp.type);
      const status = one(sp.status) ?? "ACTIVE";
      if (extra === null || (type !== undefined && !(ITEM_CARD_TYPES as readonly string[]).includes(type)) || (status !== "ACTIVE" && status !== "ARCHIVED")) notFound();
      const source = await loadProductLabelBatch(call, { ...domainExtraFilters(extra), status, ...(type === undefined ? {} : { cardType: type as "HM" | "YM" | "MM" | "TM" }), ...(one(sp.q) === undefined ? {} : { q: one(sp.q)! }), ...(one(sp.after) === undefined ? {} : { after: one(sp.after)! }), limit: 100 });
      if (source.datas.length === 0) return shell(<LabelNotice title={tp("empty")} action={backAction} />);
      if (source.datas.length * copies > MAX_LABELS_PER_DOCUMENT) return shell(<LabelNotice title={t("errors.copies", { max: MAX_LABELS_PER_DOCUMENT })} action={backAction} />);
      const nextCustom = new URLSearchParams(qs);if(source.nextCursor!==null)nextCustom.set('after',source.nextCursor);
      const custom = await customLabelHref(call,{kind:'PRODUCT',ids:source.itemIds},{copies,...(source.nextCursor===null?{}:{batchNext:nextCustom.toString()})});if(custom!==null)redirect(custom);
      let document: ReturnType<typeof productQrDocument>;
      try { document = productQrDocument(source.datas, copies); }
      catch (e) { if (e instanceof AppError && e.code === "VALIDATION_FAILED") return shell(<LabelNotice title={tp("invalidBarcode")} hint={tp("invalidBarcodeHint")} action={backAction} />); throw e; }
      const next = new URLSearchParams(qs);
      if (source.nextCursor !== null) next.set("after", source.nextCursor);
      return main(<LabelPreview dark={dark} back={back} pages={document.pages} minWidth={document.minWidth} minHeight={document.minHeight} zpl="" fileName="urun-qr.zpl" templateVersion="product-qr-v1" bridgeEnabled={false} batchSummary={tp("batch", { count: source.datas.length, total: source.total })} {...(source.nextCursor === null ? {} : { nextHref: `${home}/labels?${next.toString()}` })} />);
    }
    const customSource = itemId!==undefined?{kind:'PRODUCT' as const,ids:[itemId]}:warehouseId!==undefined?{kind:'LOCATION' as const,warehouseId,...(one(sp.location)?{locationId:one(sp.location)!}:{}),subtree:one(sp.subtree)==='1'}:null;
    if(customSource){const custom=await customLabelHref(call,customSource,{copies});if(custom!==null)redirect(custom);}
    const source = await loadLabelSource(call, { itemId, warehouseId, locationId: one(sp.location), subtree: one(sp.subtree) === "1" });
    if (source === null) {
      return shell(<LabelNotice title={t("noSource")} hint={t("noSourceAction")} action={{ label: t("toItems"), href: `${home}/items` }} />);
    }
    let pages: readonly string[];
    let zpl: string;
    try {
      pages = toSvgPages(source.template, source.datas, copies);
      zpl = toZplDocument(source.template, source.datas, copies);
    } catch (e) {
      if (e instanceof LabelCharsetError) return shell(<LabelNotice title={t("errors.charset")} hint={t("errors.charsetAction")} action={backAction} />);
      if (e instanceof LabelTooLongError) return shell(<LabelNotice title={t("errors.tooLong")} hint={t("errors.tooLongAction")} action={backAction} />);
      if (e instanceof AppError && e.code === "VALIDATION_FAILED") return shell(<LabelNotice title={t("errors.copies", { max: MAX_LABELS_PER_DOCUMENT })} action={backAction} />);
      throw e;
    }
    return main(
      <LabelPreview
        dark={dark}
        back={back}
        pages={pages}
        zpl={zpl}
        fileName={`${source.name.replace(/[^A-Za-z0-9._-]+/g, "_")}.zpl`}
        templateVersion={LABEL_TEMPLATE_VERSION[source.template]}
        bridgeEnabled={process.env.LABEL_LOCAL_BRIDGE_ENABLED === "true"}
      />,
    );
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === "NOT_FOUND" || e.code === "VALIDATION_FAILED") notFound();
      if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(returnTo)}`);
      if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(returnTo)}`);
      if (e.code === "FORBIDDEN") {
        return main(<KalipKilitliEkran title={t("title")} icon={{ d: LICON.printer, color: "172E42" }} text={t("locked")} hint={t("lockedAction")} dark={dark} home={home} />);
      }
    }
    throw e;
  }
}
