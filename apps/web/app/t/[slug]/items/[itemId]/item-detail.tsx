"use client";
// Ürün ayrıntısı (T-216). Kurallar SUNUCUDADIR: değişmez alanlar (A-87), katsayı biçimi/ölçeği (I-09), barkod belirsizliği (A-69) ve
// yetki domain'de uygulanır; burada yalnızca gösterilir. Katsayı ve miktar alanları DİZGİ olarak kalır (`Number`'a çevrilmez).
// Mobilde kart/liste görünümü (tablo yok → yatay taşma yok). Sunucu reddi neden + sonraki eylemle gösterilir.
// T-968 (B-63): KalipDetay.dc.html detay kalıbı — büyük ikonlu kimlik kartı (ad, kod, etiketler, toplam stok), hızlı işlemler (yalnız
// yetkili: etiket, sayım, transfer), "Nerede?" (depo → raf, minimum), son hareketler (zaman çizgisi); ana işlem DÜZENLE kart bilgileri
// bölümüne götürür. Düzenleme bölümleri (kart, birim katsayıları, barkodlar, arşiv) aynı eylemlerle kalıbın kartlarında.
// Bilinçli farklar: "Sayım" kısayolu ürün sayımı değil görev listesidir (ürüne özel sayım başlatma yok); stok sorgusu okunamazsa
// toplam / Nerede? / hareketler çizilmez (uydurma yok).
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Banner, Button, ConfirmDialog, TextField } from "@wms/ui";
import { LICON } from "../../../../design/kalip-icons.ts";
import { CodeChangedNotice, CodeEditDialog } from "../../code-edit-dialog.tsx";
import { KalipDetayIzgara, KalipHero, KalipHizli, KalipKartBolum, KalipMinimum, KalipNerede, KalipTumu, KalipUyari, KalipZaman, type KalipHizliIslem, type KalipOlay, type KalipYer } from "../../kalip/detay.tsx";
import { Ico, KalipEkran, tone } from "../../kalip/ekran.tsx";
import { approx, fmtQty, stockTone, sumDecimal } from "../../kalip/format.ts";
import { addBarcodeAction, archiveItemAction, removeBarcodeAction, setConversionAction, updateItemAction } from "../actions.ts";
import { CARD_VISUAL } from "../card-visual.ts";
import { CARD_TYPES, SELECT_CLS, ServerErrorBanner, toServerError } from "../items-view.tsx";
import type { CardType, ServerError, UnitOption } from "../items-view.tsx";

export interface ItemDetailItem {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: "ACTIVE" | "ARCHIVED";
  readonly baseUnitId: string;
  readonly baseUnitCode: string;
  readonly trackingMode: string;
  readonly quantityScale: number;
  readonly pickPolicy: string;
  readonly cardType: CardType;
}
export interface ConversionView {
  readonly unitId: string;
  readonly unitCode: string;
  readonly unitName: string;
  readonly factor: string;
}
export interface BarcodeView {
  readonly id: string;
  readonly barcode: string;
  readonly unitId: string;
  readonly unitCode: string;
  readonly quantity: string;
  readonly ambiguous: boolean;
}

const PICK = ["FIFO", "FEFO"] as const;

/** Düzenleme bölümü: kalıbın başlıklı kartı (`.card > .ch`); içerik mevcut formlar. */
function Section({ title, sub, d, color, children, id }: { title: string; sub: string; d: string; color: string; children: ReactNode; id: string }) {
  return (
    <KalipKartBolum title={title} sub={sub} d={d} color={color} testId={id}>
      <div id={id} className="flex min-w-0 flex-col gap-3">
        {children}
      </div>
    </KalipKartBolum>
  );
}

/** Ürün kartı stok özeti (sunucu, `getItemStockCard`); okunamadıysa `null` → bölümler çizilmez. */
export interface ItemStockCardView {
  readonly places: readonly { readonly warehouseId: string; readonly warehouseName: string; readonly locationCode: string; readonly quantity: string }[];
  readonly min: string | null;
  readonly moves: readonly { readonly documentId: string; readonly kind: "STOCK_IN" | "STOCK_OUT" | "STOCK_MOVE" | "REVERSAL"; readonly number: string | null; readonly occurredAt: string; readonly actorName: string | null; readonly net: string; readonly moved: string; readonly locations: string }[];
}

export interface ItemQuickAccess {
  readonly label: boolean;
  readonly count: boolean;
  readonly transfer: boolean;
}

// Kaynak MV renkleri: giriş yeşil, transfer mor, çıkış turuncu, ters kayıt lacivert; Nerede? depo renkleri sırayla.
const MOVE_VIS = {
  STOCK_IN: { d: LICON.moveIn, color: "2F7D5B", q: "17583C" },
  STOCK_OUT: { d: LICON.moveOut, color: "B5552B", q: "8A3E10" },
  STOCK_MOVE: { d: LICON.transfer, color: "6C4BD8", q: "4B2FA8" },
  REVERSAL: { d: LICON.transfer, color: "172E42", q: "172E42" },
} as const;
const PLACE_COLORS = ["2F5DA8", "0E7C7B", "6C4BD8", "B07D0B", "2F7D5B"] as const;

export function ItemDetail({
  slug,
  dark,
  canManage,
  quick,
  stockCard,
  inUse,
  units,
  item,
  conversions,
  barcodes,
}: {
  slug: string;
  dark: boolean;
  canManage: boolean;
  quick: ItemQuickAccess;
  stockCard: ItemStockCardView | null;
  inUse: boolean;
  units: readonly UnitOption[];
  item: ItemDetailItem;
  conversions: readonly ConversionView[];
  barcodes: readonly BarcodeView[];
}) {
  const t = useTranslations("items");
  const td = useTranslations("items.detail");
  const tt = useTranslations("items.tracking");
  const tp = useTranslations("items.pick");
  const tc = useTranslations("items.cardType");
  const tk = useTranslations("items.detail.k");
  const locale = useLocale();
  const router = useRouter();
  const base = `/t/${encodeURIComponent(slug)}/items`;
  const returnTo = `${base}/${encodeURIComponent(item.id)}`;
  const active = item.status === "ACTIVE";
  const writable = canManage && active;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ServerError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [removing, setRemoving] = useState<BarcodeView | null>(null);
  const [round, setRound] = useState(0);
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeChanged, setCodeChanged] = useState<{ readonly from: string; readonly to: string } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const otherUnits = units.filter((u) => u.id !== item.baseUnitId);

  /** Ortak eylem sarmalayıcısı: hata banner'da kalır; başarıda bildirim + sunucu verisini yenile. */
  async function run(name: string, doneKey: string, call: () => Promise<{ ok: true } | { ok: false; error: ServerError }>): Promise<boolean> {
    setBusy(name);
    setError(null);
    setNotice(null);
    const res = await call();
    setBusy(null);
    if (!res.ok) {
      setError(toServerError(res.error));
      return false;
    }
    setNotice(td(doneKey));
    setRound((n) => n + 1);
    router.refresh();
    return true;
  }

  async function changeCode(code: string) {
    const r = await updateItemAction({ slug, itemId: item.id, code });
    return r.ok ? ({ ok: true, changed: r.data.changed } as const) : ({ ok: false, error: toServerError(r.error) } as const);
  }
  /** "Geri al" (N-03): eski koda dönüş aynı sunucu komutudur; eski kod başkasına verildiyse sunucu reddi gösterilir. */
  async function undoCode() {
    if (codeChanged === null) return;
    setUndoing(true);
    setError(null);
    const r = await changeCode(codeChanged.from);
    setUndoing(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setCodeChanged(null);
    setNotice(td("done.codeUndone"));
    router.refresh();
  }

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    await run("save", "done.saved", async () => {
      const r = await updateItemAction({ slug, itemId: item.id, name: String(f.get("name") ?? ""), pickPolicy: String(f.get("pickPolicy") ?? ""), cardType: String(f.get("cardType") ?? "") });
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    });
  }
  async function onConversion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    // Katsayı DİZGİ olarak iletilir (I-09); biçim/ölçek denetimi sunucuda.
    await run("conversion", "done.conversion", async () => {
      const r = await setConversionAction({ slug, itemId: item.id, unitId: String(f.get("unitId") ?? ""), factor: String(f.get("factor") ?? "") });
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    });
  }
  async function onBarcode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const unitId = String(f.get("unitId") ?? "");
    const quantity = String(f.get("quantity") ?? "").trim();
    await run("barcode", "done.barcodeAdded", async () => {
      const r = await addBarcodeAction({ slug, itemId: item.id, unitId: unitId === "" ? null : unitId, barcode: String(f.get("barcode") ?? ""), quantity: quantity === "" ? null : quantity });
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    });
  }
  async function onRemove() {
    if (removing === null) return;
    const target = removing;
    setRemoving(null);
    await run("remove", "done.barcodeRemoved", async () => {
      const r = await removeBarcodeAction({ slug, barcodeId: target.id });
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    });
  }
  async function onArchive() {
    setArchiveOpen(false);
    await run("archive", "done.archived", async () => {
      const r = await archiveItemAction({ slug, itemId: item.id });
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    });
  }

  // T-968 (KalipDetay): toplam, "Nerede?" ve son hareketler gerçek stok sorgusundan (kapsamdaki depolar). Veri yoksa bölüm çizilmez.
  const vis = CARD_VISUAL[item.cardType];
  const unit = item.baseUnitCode;
  const fq = (v: string): string => fmtQty(v, locale);
  const totalRaw = stockCard === null ? null : sumDecimal(stockCard.places.map((p) => p.quantity));
  const tn = stockCard === null || totalRaw === null ? "ok" : stockTone(totalRaw, stockCard.min);
  const byWh = new Map<string, { name: string; rows: { code: string; q: string }[] }>();
  for (const p of stockCard?.places ?? []) {
    const w = byWh.get(p.warehouseId) ?? { name: p.warehouseName, rows: [] };
    w.rows.push({ code: p.locationCode, q: p.quantity });
    byWh.set(p.warehouseId, w);
  }
  const totalN = Math.max(approx(totalRaw), approx(stockCard?.min), 0);
  const places: KalipYer[] = [...byWh.entries()].map(([id, w], i) => {
    const sum = sumDecimal(w.rows.map((r) => r.q));
    const share = (q: string): number => (totalN > 0 ? Math.max(0, approx(q)) / totalN : 0);
    return {
      key: id,
      name: w.name,
      meta: tk("racks", { n: w.rows.length, codes: w.rows.map((r) => r.code).join(", ") }),
      qty: `${fq(sum)} ${unit}`,
      share: share(sum),
      color: PLACE_COLORS[i % PLACE_COLORS.length] ?? "2F5DA8",
      racks: w.rows.map((r) => ({ code: r.code, qty: `${fq(r.q)} ${unit}`, share: share(r.q) })),
    };
  });
  const when = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const day = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(now) - day(d)) / 86400000);
    const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    return diff <= 0 ? tk("today", { time }) : diff === 1 ? tk("yesterday", { time }) : tk("daysAgo", { n: diff });
  };
  const events: KalipOlay[] = (stockCard?.moves ?? []).map((m) => {
    const v = MOVE_VIS[m.kind];
    const kindName = tk(`kind_${m.kind}`);
    const q = m.kind === "STOCK_MOVE" ? fq(m.moved) : approx(m.net) > 0 ? `+${fq(m.net)}` : fq(m.net);
    return {
      key: m.documentId,
      title: [kindName, m.number, m.locations].filter((x) => x !== null && x !== "").join(" · "),
      meta: [when(m.occurredAt), m.actorName?.toLocaleUpperCase(locale === "en" ? "en" : "tr")].filter((x) => x !== undefined && x !== null && x !== "").join(" · "),
      q,
      d: v.d,
      color: v.color,
      qColor: v.q,
    };
  });
  const quickItems: KalipHizliIslem[] = [
    ...(quick.label ? [{ key: "label", label: tk("qLabel"), d: LICON.printer, color: "172E42", href: `/t/${encodeURIComponent(slug)}/labels?item=${encodeURIComponent(item.id)}` }] : []),
    ...(quick.count ? [{ key: "count", label: tk("qCount"), d: LICON.clip, color: "2F5DA8", href: `/t/${encodeURIComponent(slug)}/field/tasks` }] : []),
    ...(quick.transfer ? [{ key: "transfer", label: tk("qTransfer"), d: LICON.transfer, color: "6C4BD8", href: `/t/${encodeURIComponent(slug)}/stock/documents?new=TRANSFER` }] : []),
  ];
  const tags = [tc(item.cardType), tk("unitTag", { unit }), ...(item.trackingMode === "NONE" ? [] : [tt(item.trackingMode)]), tp(item.pickPolicy), ...(active ? [] : [t("status.ARCHIVED")])].map((x) => x.toLocaleUpperCase(locale === "en" ? "en" : "tr"));
  const toEdit = (): void => {
    tone("tap");
    const el = document.getElementById("sec-card");
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    el?.querySelector<HTMLInputElement>('input[name="name"]')?.focus({ preventScroll: true });
  };

  return (
    <>
      <KalipEkran
        kind="detay"
        dark={dark}
        title={tk("screenTitle")}
        icon={{ d: LICON.box, color: "2F5DA8" }}
        heading={false}
        testId="item-detail"
        bar={{
          back: { href: base, aria: td("back") },
          main: { label: tk("edit"), aria: tk("editAria"), d: LICON.pencil, onClick: toEdit, disabled: !writable, testId: "item-edit" },
        }}
      >
        <KalipDetayIzgara
          left={
            <>
              <KalipHero
                label={tk("hero")}
                name={item.name}
                code={item.code}
                tags={tags}
                d={vis.d}
                color={vis.color}
                {...(totalRaw === null ? {} : { total: { value: fq(totalRaw), sub: tk("total", { unit }), crit: tn === "crit" } })}
              >
                <span hidden data-testid="card-type">
                  {tc(item.cardType)}
                </span>
              </KalipHero>
              <KalipHizli label={tk("quick")} items={quickItems} />
              {writable ? (
                <button type="button" className="more" onClick={() => setCodeOpen(true)} aria-label={td("codeEdit.for", { name: item.name })}>
                  <i>
                    <Ico d={LICON.pencil} size={18} />
                  </i>
                  {td("codeEdit.button")}
                </button>
              ) : null}
              {canManage ? null : <p className="sr">{t("lockedReason")}</p>}
              {active ? null : <Banner kind="info">{td("archivedNote")}</Banner>}
              {stockCard === null ? null : (
                <KalipKartBolum title={tk("where")} sub={tk("whereSub")} d={LICON.depo} color="2F5DA8" testId="item-where">
                  {tn !== "ok" && stockCard.min !== null && totalRaw !== null ? <KalipUyari title={tk("belowMin")} sub={tk("belowMinSub", { have: fq(totalRaw), min: fq(stockCard.min), unit })} /> : null}
                  {places.length === 0 ? <small className="mono">{tk("whereEmpty")}</small> : <KalipNerede places={places} />}
                  {stockCard.min === null ? null : <KalipMinimum label={tk("min", { min: fq(stockCard.min), unit })} state={tn === "ok" ? tk("minOk") : tk("minLow")} ok={tn === "ok"} />}
                </KalipKartBolum>
              )}
            </>
          }
          right={
            <>
              {stockCard === null ? null : (
                <KalipKartBolum title={tk("moves")} sub={tk("movesSub")} d={LICON.clock} color="0E7C7B" testId="item-moves">
                  {events.length === 0 ? <small className="mono">{tk("movesEmpty")}</small> : <KalipZaman items={events} />}
                  <KalipTumu href={`/t/${encodeURIComponent(slug)}/stock/documents`}>{tk("allMoves")}</KalipTumu>
                </KalipKartBolum>
              )}
              {codeChanged ? <CodeChangedNotice from={codeChanged.from} to={item.code === codeChanged.from ? codeChanged.to : item.code} busy={undoing} onUndo={() => void undoCode()} /> : null}
              {notice ? <Banner kind="info">{notice}</Banner> : null}
              {error ? <ServerErrorBanner error={error} returnTo={returnTo} /> : null}

              <Section id="sec-card" title={td("cardTitle")} sub={tk("editSub")} d={LICON.pencil} color="2F5DA8">
                <form key={`save-${round}`} onSubmit={(e) => void onSave(e)} className="flex min-w-0 flex-col gap-4">
                  <TextField label={t("form.name")} name="name" defaultValue={item.name} autoComplete="off" required maxLength={512} disabled={!writable} />
                  <div className="flex min-w-0 flex-col gap-1">
                    <label htmlFor="detail-card-type" className="text-base font-semibold">
                      {t("form.cardType")}
                    </label>
                    <select id="detail-card-type" name="cardType" defaultValue={item.cardType} disabled={!writable} className={SELECT_CLS}>
                      {CARD_TYPES.map((k) => (
                        <option key={k} value={k}>
                          {k} · {tc(k)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <label htmlFor="detail-pick" className="text-base font-semibold">
                      {t("form.pick")}
                    </label>
                    <select id="detail-pick" name="pickPolicy" defaultValue={item.pickPolicy} disabled={!writable} className={SELECT_CLS}>
                      {PICK.map((k) => (
                        <option key={k} value={k}>
                          {tp(k)}
                        </option>
                      ))}
                    </select>
                  </div>
                  {writable ? (
                    <div>
                      <Button type="submit" loading={busy === "save"}>
                        {td("save")}
                      </Button>
                    </div>
                  ) : null}
                </form>
                <dl className="m-0 flex min-w-0 flex-col gap-2">
                  <div className="min-w-0">
                    <dt className="text-sm font-semibold text-ink-muted">{t("form.baseUnit")}</dt>
                    <dd className="m-0 break-words text-base text-ink">{item.baseUnitCode}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-sm font-semibold text-ink-muted">{t("form.scale")}</dt>
                    <dd className="m-0 break-words text-base text-ink">{item.quantityScale === 0 ? t("form.scaleInteger") : t("form.scaleDecimals", { count: item.quantityScale })}</dd>
                  </div>
                  {item.trackingMode === "NONE" ? null : (
                    <div className="min-w-0">
                      <dt className="text-sm font-semibold text-ink-muted">{t("form.tracking")}</dt>
                      <dd className="m-0 break-words text-base text-ink">{tt(item.trackingMode)}</dd>
                    </div>
                  )}
                </dl>
                <p className="break-words text-sm text-ink-muted">{inUse ? td("lockedInUse") : td("lockedFixed")}</p>
              </Section>

              <Section id="sec-conv" title={td("conversionsTitle")} sub={tk("convSub")} d={LICON.grid} color="6C4BD8">
                <p className="break-words text-sm text-ink-muted">{td("conversionsHint", { unit: item.baseUnitCode })}</p>
                {conversions.length === 0 ? (
                  <p className="break-words text-base text-ink-muted">{td("conversionsEmpty")}</p>
                ) : (
                  <ul className="m-0 flex min-w-0 list-none flex-col gap-2 p-0">
                    {conversions.map((c) => (
                      <li key={c.unitId} data-testid="conversion-row" className="min-w-0 break-words rounded-card border-2 border-border p-3 text-base text-ink">
                        {td("conversionLine", { unit: c.unitCode, factor: c.factor, base: item.baseUnitCode })}
                      </li>
                    ))}
                  </ul>
                )}
                {writable ? (
                  <form key={`conv-${round}`} onSubmit={(e) => void onConversion(e)} className="flex min-w-0 flex-col gap-3">
                    <div className="flex min-w-0 flex-col gap-1">
                      <label htmlFor="conv-unit" className="text-base font-semibold">
                        {td("conversionUnit")}
                      </label>
                      <select id="conv-unit" name="unitId" required defaultValue={otherUnits[0]?.id ?? ""} className={SELECT_CLS}>
                        {otherUnits.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.code} · {u.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <TextField label={td("conversionFactor", { base: item.baseUnitCode })} hint={td("conversionFactorHint")} name="factor" inputMode="decimal" autoComplete="off" required maxLength={64} />
                    <div>
                      <Button type="submit" loading={busy === "conversion"}>
                        {td("conversionSave")}
                      </Button>
                    </div>
                  </form>
                ) : null}
              </Section>

              <Section id="sec-bc" title={td("barcodesTitle")} sub={tk("bcSub")} d={LICON.cam} color="0E7C7B">
                <p className="break-words text-sm text-ink-muted">{td("barcodesHint")}</p>
                {barcodes.length === 0 ? (
                  <p className="break-words text-base text-ink-muted">{td("barcodesEmpty")}</p>
                ) : (
                  <ul className="m-0 flex min-w-0 list-none flex-col gap-2 p-0">
                    {barcodes.map((b) => (
                      <li key={b.id} data-testid="barcode-row" className="flex min-w-0 flex-col gap-2 rounded-card border-2 border-border p-3">
                        <span className="min-w-0 break-all text-base font-semibold text-ink">{b.barcode}</span>
                        <span className="min-w-0 break-words text-sm text-ink-muted">{td("barcodeMeta", { unit: b.unitCode, quantity: b.quantity })}</span>
                        {b.ambiguous ? <Banner kind="warning">{td("barcodeAmbiguous")}</Banner> : null}
                        {writable ? (
                          <div>
                            <Button variant="secondary" onClick={() => setRemoving(b)} aria-label={td("barcodeRemoveFor", { barcode: b.barcode })}>
                              {td("barcodeRemove")}
                            </Button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                {writable ? (
                  <form key={`bc-${round}`} onSubmit={(e) => void onBarcode(e)} className="flex min-w-0 flex-col gap-3">
                    <TextField label={td("barcodeValue")} hint={td("barcodeValueHint")} name="barcode" autoComplete="off" autoCapitalize="off" required maxLength={512} />
                    <div className="flex min-w-0 flex-col gap-1">
                      <label htmlFor="bc-unit" className="text-base font-semibold">
                        {td("barcodeUnit")}
                      </label>
                      <select id="bc-unit" name="unitId" defaultValue="" className={SELECT_CLS}>
                        <option value="">{td("barcodeUnitBase", { unit: item.baseUnitCode })}</option>
                        {otherUnits.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.code} · {u.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <TextField label={td("barcodeQuantity")} hint={td("barcodeQuantityHint")} name="quantity" inputMode="decimal" autoComplete="off" maxLength={64} />
                    <div>
                      <Button type="submit" loading={busy === "barcode"}>
                        {td("barcodeAdd")}
                      </Button>
                    </div>
                  </form>
                ) : null}
              </Section>

              {writable ? (
                <Section id="sec-archive" title={td("archiveTitle")} sub={tk("archiveSub")} d={LICON.lock} color="B5552B">
                  <p className="break-words text-sm text-ink-muted">{td("archiveHint")}</p>
                  <div>
                    <Button variant="danger" onClick={() => setArchiveOpen(true)} loading={busy === "archive"}>
                      {td("archive")}
                    </Button>
                  </div>
                </Section>
              ) : null}

            </>
          }
        />
      </KalipEkran>

      <CodeEditDialog
        open={codeOpen}
        subject={item.name}
        current={item.code}
        titleId="code-edit-item-title"
        onClose={() => setCodeOpen(false)}
        submit={changeCode}
        renderError={(e) => <ServerErrorBanner error={e} returnTo={returnTo} />}
        onDone={(r) => {
          setCodeOpen(false);
          setError(null);
          if (r.changed) {
            setNotice(null);
            setCodeChanged({ from: r.from, to: r.to });
          } else setNotice(td("done.codeSame"));
          router.refresh();
        }}
      />
      <ConfirmDialog
        open={archiveOpen}
        title={td("confirmArchive.title", { name: item.name })}
        description={td("confirmArchive.description", { name: item.name, code: item.code })}
        confirmLabel={td("confirmArchive.button")}
        cancelLabel={t("form.cancel")}
        variant="danger"
        onConfirm={() => void onArchive()}
        onCancel={() => setArchiveOpen(false)}
      />
      <ConfirmDialog
        open={removing !== null}
        title={td("confirmRemove.title")}
        description={td("confirmRemove.description", { barcode: removing?.barcode ?? "" })}
        confirmLabel={td("confirmRemove.button")}
        cancelLabel={t("form.cancel")}
        variant="danger"
        onConfirm={() => void onRemove()}
        onCancel={() => setRemoving(null)}
      />
    </>
  );
}
