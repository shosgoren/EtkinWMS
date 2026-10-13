"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Banner, PackagePlus } from "@wms/ui";
import { PrimaryButton, SecondaryButton, ScanPanel, useScanner, useScanPrimary } from "../../field/receive/receive-flow.tsx";
import { FormSteps } from "../../screen-shell.tsx";
import { ErrorNotice, type ErrorInfo, type ActionResult } from "../receipt-form.tsx";
import { getPackageReceiptAction, packageItemOptionsAction, packageReceivingLocationsAction, packageWarehousesAction, postPackageReceiptAction, preparePackageReceiptAction, resolvePackageItemScanAction, searchPackageItemsAction, type PackageCommandDto, type PackageItemDto, type PackageItemOptionsDto, type PackageReceiptDto } from "./actions.ts";

type Place = { readonly id: string; readonly code: string; readonly name: string };
export interface PackageEntry { quantity: string; lotCode?: string; producedOn?: string; expiresOn?: string }
export type PackageInput = { mode: "equal"; count: number } & PackageEntry | { mode: "explicit"; packages: PackageEntry[] };
export interface PrepareInput { slug: string; warehouseId: string; receivingLocationId: string; itemId: string; unitId: string; kind: "VARIL" | "KOLI"; packages: PackageInput }
export const packageLabelHref = (slug: string, documentId: string): string => `/t/${encodeURIComponent(slug)}/receipts/packages/labels?document=${encodeURIComponent(documentId)}`;

// Preview only: bounded decimal strings become scaled BigInts, never floating point.
// This is presentation arithmetic; the server remains the conversion/validation authority.
interface PreviewDecimal { units: bigint; scale: number }
function previewUnits(raw: string): PreviewDecimal {
  if (raw.length > 64 || !/^\d+(?:\.\d+)?$/.test(raw)) throw new Error("quantity");
  const [whole = "0", fraction = ""] = raw.split(".");
  const significant = fraction.replace(/0+$/, "");
  const value = BigInt(`${whole}${significant}`);
  if (value <= 0n) throw new Error("quantity");
  return { units: value, scale: significant.length };
}
function sumPreview(a: PreviewDecimal, b: PreviewDecimal): PreviewDecimal {
  const scale = Math.max(a.scale, b.scale);
  return { units: a.units * 10n ** BigInt(scale - a.scale) + b.units * 10n ** BigInt(scale - b.scale), scale };
}
function previewDecimal({ units, scale }: PreviewDecimal): string {
  if (scale === 0) return units.toString();
  const digits = units.toString().padStart(scale + 1, "0");
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  return `${digits.slice(0, -scale)}${fraction ? `.${fraction}` : ""}`;
}
export function packagePreview(input: PackageInput, options: PackageItemOptionsDto, unitId: string): { count: number; total: string; baseTotal: string } | null {
  try {
    if (options.item.trackingMode !== "NONE" && options.item.trackingMode !== "LOT") return null;
    const unit = options.units.find(u => u.unitId === unitId);
    if (!unit) return null;
    const rows = input.mode === "equal" ? (Number.isInteger(input.count) && input.count >= 1 && input.count <= 200 ? Array.from({ length: input.count }, () => input) : []) : input.packages;
    if (rows.length < 1 || rows.length > 200) return null;
    let total: PreviewDecimal = { units: 0n, scale: 0 }, baseTotal: PreviewDecimal = { units: 0n, scale: 0 };
    const factor = previewUnits(unit.toBaseFactor);
    for (const row of rows) {
      const q = previewUnits(row.quantity);
      if (options.item.trackingMode === "LOT" && !row.lotCode?.trim()) return null;
      for (const date of [row.producedOn, row.expiresOn]) {
        if (date !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) return null;
      }
      if (row.producedOn && row.expiresOn && row.producedOn > row.expiresOn) return null;
      const converted = { units: q.units * factor.units, scale: q.scale + factor.scale };
      if (converted.scale > options.item.quantityScale && converted.units % (10n ** BigInt(converted.scale - options.item.quantityScale)) !== 0n) return null;
      total = sumPreview(total, q); baseTotal = sumPreview(baseTotal, converted);
    }
    return { count: rows.length, total: previewDecimal(total), baseTotal: previewDecimal(baseTotal) };
  } catch { return null; }
}
export function displayQuantity(q: string): string {
  const [whole = "0", fraction] = q.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}${fraction ? `,${fraction}` : ""}`;
}
interface Ports {
  prepare: (input: PrepareInput & { clientKey: string }) => Promise<ActionResult<PackageCommandDto>>;
  post: (input: { slug: string; clientKey: string; documentId: string; expectedVersion: number }) => Promise<ActionResult<PackageCommandDto>>;
  get: (input: { slug: string; documentId: string }) => Promise<ActionResult<PackageReceiptDto>>;
}
// A submission freezes its content. Unknown prepare outcomes can only retry the same content/key.
// A prepared document survives read/post failures and is never prepared a second time.
export function createPackageSubmission(initial: PackageReceiptDto | null, ports: Ports, generate = () => crypto.randomUUID()) {
  let prepareKey: string | null = null, postKey: string | null = null;
  let frozen: PrepareInput | null = null, documentId = initial?.documentId ?? null;
  let receipt = initial, pending = false, uncertainPrepare = false;
  return {
    get documentId() { return documentId; },
    get frozen() { return frozen !== null || documentId !== null; },
    async run(input: PrepareInput | null, slug: string, prepared: (id: string) => void): Promise<PackageReceiptDto> {
      if (pending) throw { code: "BUSY" };
      pending = true;
      const unwrap = <T,>(r: ActionResult<T>): T => { if (!r.ok) throw r.error; return r.data; };
      try {
        if (documentId === null) {
          if (frozen === null) { if (input === null) throw { code: "VALIDATION_FAILED" }; frozen = structuredClone(input); }
          prepareKey ??= generate();
          let preparedResult: ActionResult<PackageCommandDto>;
          try { preparedResult = await ports.prepare({ ...frozen, clientKey: prepareKey }); }
          catch (e) { uncertainPrepare = true; throw e; }
          if (!preparedResult.ok) {
            // Only explicit validation/access rejection proves this attempt wrote no draft:
            // action guard rejects before write; command transaction rolls back, and a
            // concurrently completed replay is returned as success (stock/command.ts).
            // After any prior unknown outcome, even a later permission rejection cannot
            // prove the earlier attempt did not commit, so preserve key/content forever.
            const definiteRejection = preparedResult.error.code === "VALIDATION_FAILED" || preparedResult.error.code === "FORBIDDEN";
            if (definiteRejection && !uncertainPrepare) { frozen = null; prepareKey = null; }
            else if (!definiteRejection) uncertainPrepare = true;
            throw preparedResult.error;
          }
          const command = preparedResult.data;
          documentId = command.documentId;
          prepared(documentId);
        }
        receipt ??= unwrap(await ports.get({ slug, documentId }));
        if (receipt.documentStatus !== "POSTED") {
          if (receipt.documentStatus !== "DRAFT") throw { code: "VALIDATION_FAILED" };
          postKey ??= generate();
          unwrap(await ports.post({ slug, documentId, expectedVersion: receipt.documentVersion, clientKey: postKey }));
          // A successful command is durable even if the following metadata read fails.
          receipt = null;
          receipt = unwrap(await ports.get({ slug, documentId }));
        }
        return receipt;
      } finally { pending = false; }
    },
  };
}
const control = "min-h-12 w-full min-w-0 rounded-control border-2 border-border-strong bg-surface px-3 text-base text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus";
const card = "min-w-0 rounded-card border-2 border-border bg-surface p-4";
export function PackageFlow({ slug, initial, canWrite }: { slug: string; initial: PackageReceiptDto | null; canWrite: boolean }) {
  const t = useTranslations("packageReceiving");
  const [stage, setStage] = useState(initial ? 3 : 1);
  const [receipt, setReceipt] = useState(initial);
  const [options, setOptions] = useState<PackageItemOptionsDto | null>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<readonly PackageItemDto[]>([]);
  const [warehouses, setWarehouses] = useState<readonly Place[]>([]);
  const [locations, setLocations] = useState<readonly Place[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [kind, setKind] = useState<"VARIL" | "KOLI">("VARIL");
  const [count, setCount] = useState("1");
  const [equal, setEqual] = useState(true);
  const [optionalMetadata, setOptionalMetadata] = useState(false);
  const [entry, setEntry] = useState<PackageEntry>({ quantity: "" });
  const [rows, setRows] = useState<PackageEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [last, setLast] = useState("");
  const lock = useRef(false);
  const sequence = useRef(0);
  const submission = useRef<ReturnType<typeof createPackageSubmission> | null>(null);
  if (submission.current === null) submission.current = createPackageSubmission(initial, { prepare: preparePackageReceiptAction, post: postPackageReceiptAction, get: getPackageReceiptAction });
  const frozen = submission.current.frozen;
  const posted = receipt?.documentStatus === "POSTED";
  function fail(e: unknown) {
    setError(e !== null && typeof e === "object" && "code" in e ? e as ErrorInfo : { code: "NETWORK" });
  }
  async function loadLocations(id: string) {
    setLocations([]); setLocationId("");
    const all: Place[] = [];
    let after: { depth: number; code: string; id: string } | undefined;
    do {
      const r = await packageReceivingLocationsAction({ slug, warehouseId: id, ...(after ? { after } : {}) });
      if (!r.ok) throw r.error;
      all.push(...r.data.items); after = r.data.next ?? undefined;
    } while (after);
    setLocations(all); if (all.length === 1) setLocationId(all[0]?.id ?? "");
  }
  async function choose(itemId: string, scanned?: PackageItemOptionsDto & { selectedUnitId: string }) {
    if (lock.current) return;
    ++sequence.current;
    lock.current = true; setBusy(true); setError(null);
    try {
      const r = scanned ? { ok: true as const, data: scanned } : await packageItemOptionsAction({ slug, itemId });
      if (!r.ok) throw r.error;
      setOptions(r.data); setUnitId(scanned?.selectedUnitId ?? r.data.baseUnit.id); setQuery(r.data.item.name); setFound([]);
      const all: Place[] = [];
      let afterCode: string | undefined;
      do {
        const w = await packageWarehousesAction({ slug, ...(afterCode ? { afterCode } : {}) });
        if (!w.ok) throw w.error;
        all.push(...w.data.items); afterCode = w.data.nextAfterCode ?? undefined;
      } while (afterCode);
      setWarehouses(all); setWarehouseId(""); setLocations([]); setLocationId("");
      if (all.length === 1) { setWarehouseId(all[0]?.id ?? ""); await loadLocations(all[0]?.id ?? ""); }
    } catch (e) { fail(e); } finally { lock.current = false; setBusy(false); }
  }
  async function scan(code: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setLast(code);
    try {
      const r = await resolvePackageItemScanAction({ slug, code });
      if (!r.ok) throw r.error;
      lock.current = false;
      await choose(r.data.item.id, r.data);
    } catch (e) { fail(e); } finally { lock.current = false; setBusy(false); }
  }
  const scanner = useScanner(v => void scan(v), stage === 1 && !busy && !frozen, () => lock.current);
  const camera = useScanPrimary(scanner.camera, { busy, name: options?.item.name, code: last, alerting: error !== null });
  async function search(q: string) {
    setQuery(q); setOptions(null); setFound([]); setError(null);
    const seq = ++sequence.current;
    if (!q.trim()) return;
    try {
      const r = await searchPackageItemsAction({ slug, q: q.trim() });
      if (seq !== sequence.current) return;
      if (!r.ok) throw r.error;
      setFound(r.data.items);
    } catch (e) { if (seq === sequence.current) fail(e); }
  }
  const packageInput: PackageInput = equal ? { mode: "equal", count: /^\d{1,3}$/.test(count) ? Number(count) : 0, ...entry } : { mode: "explicit", packages: rows };
  const validCount = /^\d{1,3}$/.test(count) && Number(count) >= 1 && Number(count) <= 200 && (equal || rows.length === Number(count));
  const preview = options && validCount ? packagePreview(packageInput, options, unitId) : null;
  const unsupported = options && options.item.trackingMode !== "NONE" && options.item.trackingMode !== "LOT";
  const input: PrepareInput | null = options && preview && warehouseId && locationId ? { slug, itemId: options.item.id, warehouseId, receivingLocationId: locationId, unitId, kind, packages: packageInput } : null;
  async function accept() {
    if (lock.current || !canWrite) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      const r = await submission.current?.run(input, slug, id => {
        window.history.replaceState(null, "", `/t/${encodeURIComponent(slug)}/receipts/packages?document=${encodeURIComponent(id)}`);
      });
      if (r) { setReceipt(r); if (r.documentStatus === "POSTED") setStage(4); }
    } catch (e) { fail(e); } finally { lock.current = false; setBusy(false); }
  }
  function entryFields(value: PackageEntry, update: (row: PackageEntry) => void, prefix: string) {
    return <div className="grid min-w-0 gap-3 md:grid-cols-2">
      <label className="flex min-w-0 flex-col gap-1">{t("quantity")}<input aria-label={`${prefix} ${t("quantity")}`} className={control} inputMode="decimal" value={value.quantity} maxLength={32} onChange={e => update({ ...value, quantity: e.target.value })} /></label>
      {options?.item.trackingMode === "LOT" || optionalMetadata ? <>
        <label className="flex min-w-0 flex-col gap-1">{t("lot")}<input aria-label={`${prefix} ${t("lot")}`} className={control} value={value.lotCode ?? ""} maxLength={64} onChange={e => { const next = { ...value }; if (e.target.value) next.lotCode = e.target.value; else delete next.lotCode; update(next); }} /></label>
        <label className="flex min-w-0 flex-col gap-1">{t("produced")}<input aria-label={`${prefix} ${t("produced")}`} type="date" className={control} value={value.producedOn ?? ""} onChange={e => { const next = { ...value }; if (e.target.value) next.producedOn = e.target.value; else delete next.producedOn; update(next); }} /></label>
        <label className="flex min-w-0 flex-col gap-1">{t("expires")}<input aria-label={`${prefix} ${t("expires")}`} type="date" className={control} value={value.expiresOn ?? ""} onChange={e => { const next = { ...value }; if (e.target.value) next.expiresOn = e.target.value; else delete next.expiresOn; update(next); }} /></label>
      </> : null}
    </div>;
  }
  return <main className="package-flow mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-4 px-4 py-4" data-testid="package-flow" data-stage={posted ? 4 : stage}>
    <h1 className="flex items-center gap-2 break-words text-2xl font-extrabold text-ink"><PackagePlus aria-hidden="true" className="size-6 shrink-0" />{t("title")}</h1>
    <FormSteps labels={[t("product"), t("packages"), t("review"), t("labels")]} />
    {error ? <ErrorNotice error={error} context="create" /> : null}
    {scanner.dropped ? <Banner kind="warning">⚠ {t("scanDropped")}</Banner> : null}
    <div className="package-layout grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <section className="flex min-w-0 flex-col gap-4">
        {stage === 1 && !receipt ? <fieldset disabled={busy || frozen} className="flex min-w-0 flex-col gap-3">
          <legend className="mb-2 text-xl font-bold">{t("product")}</legend>
          <label className="flex min-w-0 flex-col gap-1">{t("search")}<input className={control} value={query} maxLength={128} onChange={e => void search(e.target.value)} /></label>
          <ul className="flex min-w-0 flex-col gap-2">{found.map(item => <li key={item.id}><button type="button" className={`${control} text-left`} onClick={() => void choose(item.id)}>{item.code} · {item.name}</button></li>)}</ul>
          <ScanPanel service={scanner.service} prompt={t("scan")} last={last} ready={camera.ready} hue="green" />
          <SecondaryButton onClick={camera.press} disabled={busy}>{t("scan")}</SecondaryButton>
          {options ? <p className="break-words font-bold">{options.item.code} · {options.item.name}</p> : null}
          {unsupported ? <Banner kind="warning">⚠ {t("serial")}</Banner> : null}
          <PrimaryButton disabled={!options || !!unsupported || busy} onClick={() => setStage(2)}>{t("next")}</PrimaryButton>
        </fieldset> : null}
        {stage === 2 && !receipt ? <fieldset disabled={busy || frozen} className="flex min-w-0 flex-col gap-4">
          <legend className="mb-2 text-xl font-bold">{t("packages")}</legend>
          <div className="grid min-w-0 gap-3 md:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1">{t("warehouse")}<select className={control} value={warehouseId} onChange={e => { const id = e.target.value; setWarehouseId(id); lock.current = true; setBusy(true); void loadLocations(id).catch(fail).finally(() => { lock.current = false; setBusy(false); }); }}><option value="">{t("choose")}</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></label>
            <label className="flex min-w-0 flex-col gap-1">{t("location")}<select className={control} value={locationId} onChange={e => setLocationId(e.target.value)}><option value="">{t("choose")}</option>{locations.map(l => <option key={l.id} value={l.id}>{l.code} · {l.name}</option>)}</select></label>
            <label className="flex min-w-0 flex-col gap-1">{t("kind")}<select className={control} value={kind} onChange={e => setKind(e.target.value as "VARIL" | "KOLI")}><option value="VARIL">{t("barrel")}</option><option value="KOLI">{t("box")}</option></select></label>
            <label className="flex min-w-0 flex-col gap-1">{t("unit")}<select className={control} value={unitId} onChange={e => setUnitId(e.target.value)}>{options?.units.map(u => <option key={u.unitId} value={u.unitId}>{u.unitCode} · {u.unitName}</option>)}</select></label>
          </div>
          {warehouses.length === 0 ? <Banner kind="warning">⚠ {t("noWarehouse")}</Banner> : warehouseId && locations.length === 0 ? <Banner kind="warning">⚠ {t("noLocation")}</Banner> : null}
          <label className="flex min-w-0 flex-col gap-1">{t("count")}<input className={control} inputMode="numeric" value={count} maxLength={4} aria-invalid={!/^\d{1,3}$/.test(count) || Number(count) < 1 || Number(count) > 200} onChange={e => { setCount(e.target.value); if (/^\d{1,3}$/.test(e.target.value) && Number(e.target.value) >= 1 && Number(e.target.value) <= 200) setRows(old => Array.from({ length: Number(e.target.value) }, (_, i) => old[i] ?? { ...entry })); }} /></label>
          <SecondaryButton pressed={!equal} onClick={() => { if (equal && /^\d{1,3}$/.test(count) && Number(count) >= 1 && Number(count) <= 200) setRows(Array.from({ length: Number(count) }, () => ({ ...entry }))); setEqual(!equal); }}>{equal ? t("different") : t("equal")}</SecondaryButton>
          {options?.item.trackingMode === "NONE" ? <SecondaryButton pressed={optionalMetadata} onClick={() => setOptionalMetadata(!optionalMetadata)}>{t("optionalMetadata")}</SecondaryButton> : null}
          {equal ? <div className={card}>{entryFields(entry, setEntry, t("each"))}</div> : rows.map((row, i) => <section className={card} key={i}><h2 className="mb-3 font-bold">{t("packageNo", { n: i + 1 })}</h2>{entryFields(row, value => setRows(old => old.map((r, j) => i === j ? value : r)), `${i + 1}`)}</section>)}
          {!preview ? <p role="status" className="text-danger-ink">⚠ {t("invalid")}</p> : null}
          <div className="package-actions flex gap-3"><SecondaryButton onClick={() => setStage(1)}>{t("back")}</SecondaryButton><PrimaryButton disabled={!input} onClick={() => setStage(3)}>{t("review")}</PrimaryButton></div>
        </fieldset> : null}
        {stage >= 3 || receipt ? <section className={`${card} flex flex-col gap-3`}>
          <h2 className="text-xl font-bold">{posted ? `✓ ${t("posted")}` : t("review")}</h2>
          {frozen && !posted ? <p>🔒 {t("draftLocked")}</p> : null}
          {receipt ? <><p>{receipt.receiptNumber}</p><p className="font-bold">{t("countSummary", { n: receipt.packages.length })}</p><p>{t("initialQuantity")}</p><ul className="flex min-w-0 flex-col gap-2">{receipt.packages.map(p => <li key={p.id} className={`${card} break-words`}>{t("packageNo", { n: p.packageNo })} · {p.itemName} · {displayQuantity(p.quantity)} {p.unitCode}<p>{p.lotCode} {p.producedOn} {p.expiresOn}</p><p>{p.stockStatus === "QUARANTINE" ? `⚠ ${t("quarantine")}` : p.stockStatus}</p></li>)}</ul></> : <><p>{options?.item.name}</p><p>{warehouses.find(w => w.id === warehouseId)?.name} · {locations.find(l => l.id === locationId)?.name}</p><p>{t(kind === "VARIL" ? "barrel" : "box")}</p><ul className="flex min-w-0 flex-col gap-2">{(equal ? Array.from({ length: preview?.count ?? 0 }, () => entry) : rows).map((r, i) => <li key={i} className={`${card} break-words`}>{t("packageNo", { n: i + 1 })} · {r.quantity} {options?.units.find(u => u.unitId === unitId)?.unitCode}<p>{r.lotCode} {r.producedOn} {r.expiresOn}</p></li>)}</ul></>}
          {!canWrite && !posted ? <p role="alert">🔒 {t("locked")}</p> : null}
          {posted && receipt ? <Link href={packageLabelHref(slug, receipt.documentId)} className="flex min-h-14 items-center justify-center rounded-control bg-accent px-4 font-bold text-on-accent">{t("labels")}</Link> : canWrite ? <div className="package-actions flex gap-3">{!frozen ? <SecondaryButton disabled={busy} onClick={() => setStage(2)}>{t("edit")}</SecondaryButton> : null}<PrimaryButton loading={busy} disabled={!input && !frozen} onClick={() => void accept()}>{error || initial ? t("retry") : t("accept")}</PrimaryButton></div> : null}
        </section> : null}
      </section>
      <aside className={`${card} package-summary flex flex-col gap-2 self-start`} aria-live="polite">
        <h2 className="text-lg font-bold">{t("summary")}</h2><p className="break-words">{options?.item.name ?? receipt?.packages[0]?.itemName ?? t("chooseProduct")}</p>
        {preview && options ? <p className="text-xl font-extrabold" data-testid="package-total">{t("countSummary", { n: preview.count })} / {displayQuantity(preview.baseTotal)} {options.baseUnit.code}</p> : null}
        <p>{t("initialQuantity")}</p>
      </aside>
    </div>
    {camera.overlay}
    <style>{`@media (min-width:768px) and (max-width:1199px){.package-layout{grid-template-columns:minmax(0,1fr)}.package-summary{order:-1}} @media (max-width:767px),(pointer:coarse) and (max-height:500px){.package-layout{grid-template-columns:minmax(0,1fr)}.package-summary{order:-1}.package-actions{position:sticky;bottom:0;background:var(--color-surface);z-index:5;padding-block:.5rem}.package-flow fieldset>div.grid,.package-flow fieldset section>div.grid{grid-template-columns:minmax(0,1fr)}}`}</style>
  </main>;
}
