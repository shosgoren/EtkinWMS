"use client";
// Paketli kabul (T-938): ürün → paketler → kontrol → etiket. Hazırlama/işleme tek gönderim nesnesindedir (createPackageSubmission:
// idempotency anahtarı ve içerik dondurulur); yetki ve kurallar sunucuda.
// T-973 (B-63, I-18): FORM kalıbı kabı (KalipEkran `form`): kalıp üst çubuğu + ortak alt cam çubuk (Geri: Beklenen teslimler, Ana ekran,
// ana işlem İLERİ = adımın kendi birincil düğmesine basar; kabul sonrası ETİKET). Adım içerikleri, alan adları ve düğme adları aynı.
// T-1121: uyarılar (okutma düştü, seri takipli ürün, depo / raf yeri yok) kalıp uyarı bandında (`KalipUyari`; eski Banner ve "⚠" metni
// yerine ikonlu); ekran düzeninin Tailwind sınıfları satır içi düzen + aşağıdaki yerleşim stiline taşındı.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { feedback } from "@wms/ui";
import { PrimaryButton, SecondaryButton, ScanPanel, useScanner, useScanPrimary } from "../../field/receive/receive-flow.tsx";
import { KalipAdimlar } from "../../kalip/adimlar.tsx";
import { ErrorNotice, type ErrorInfo, type ActionResult } from "../receipt-form.tsx";
import { LICON } from "../../../../design/kalip-icons.ts";
import { Ico, KalipEkran } from "../../kalip/ekran.tsx";
import { KalipAlan, KalipAnahtar, KalipGrup, KalipSecenek } from "../../kalip/form.tsx";
import { KalipSecim } from "../../kalip/secim.tsx";
import { kdz } from "../../kalip/tokens.ts";
import { KalipUyari } from "../../kalip/uyari.tsx";
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
export function PackageFlow({ slug, initial, canWrite, dark = false }: { slug: string; initial: PackageReceiptDto | null; canWrite: boolean; dark?: boolean }) {
  const t = useTranslations("packageReceiving");
  const [clientReady, setClientReady] = useState(false);
  useEffect(() => { setClientReady(true); }, []);
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
  // T-973: kalıp alanları (`.fld`); erişilebilir adlar (aria-label önekleri) e2e sözleşmesidir.
  function entryFields(value: PackageEntry, update: (row: PackageEntry) => void, prefix: string) {
    return <div className="pk-grid">
      <KalipAlan label={t("quantity")} aria-label={`${prefix} ${t("quantity")}`} inputMode="decimal" value={value.quantity} maxLength={32} onChange={e => update({ ...value, quantity: e.target.value })} />
      {options?.item.trackingMode === "LOT" || optionalMetadata ? <>
        <KalipAlan label={t("lot")} aria-label={`${prefix} ${t("lot")}`} value={value.lotCode ?? ""} maxLength={64} onChange={e => { const next = { ...value }; if (e.target.value) next.lotCode = e.target.value; else delete next.lotCode; update(next); }} />
        <KalipAlan label={t("produced")} aria-label={`${prefix} ${t("produced")}`} type="date" value={value.producedOn ?? ""} onChange={e => { const next = { ...value }; if (e.target.value) next.producedOn = e.target.value; else delete next.producedOn; update(next); }} />
        <KalipAlan label={t("expires")} aria-label={`${prefix} ${t("expires")}`} type="date" value={value.expiresOn ?? ""} onChange={e => { const next = { ...value }; if (e.target.value) next.expiresOn = e.target.value; else delete next.expiresOn; update(next); }} />
      </> : null}
    </div>;
  }
  const home = `/t/${encodeURIComponent(slug)}`;
  const pressPrimary = () => {
    const primary = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="package-flow"] button.flow-primary'));
    const target = primary.find(b => !b.disabled);
    if (target === undefined) { feedback.error(); primary[0]?.scrollIntoView({ block: "center" }); return; }
    feedback.minor(); target.click();
  };
  const main = posted && receipt
    ? { label: t("k.labelsShort"), aria: t("k.labelsAria"), d: LICON.printer, href: packageLabelHref(slug, receipt.documentId), testId: "package-main" }
    : { label: t("k.nextShort"), aria: t("k.nextAria"), d: LICON.arrow, onClick: pressPrimary, disabled: busy || (!canWrite && stage >= 3), testId: "package-main" };
  return <KalipEkran kind="form" dark={dark} title={t("title")} icon={{ d: LICON.koli, color: "2F7D5B" }} testId="package-receiving"
    bar={{ back: { href: `${home}/receipts`, testId: "screen-back" }, homeNav: { href: home, testId: "screen-home" }, main }}>
  <div className="package-flow" style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%", maxWidth: "72rem", minWidth: 0, margin: "0 auto", padding: "8px 0" }} data-testid="package-flow" data-stage={posted ? 4 : stage}>
    <p className="sr">{t("k.intro")}</p>
    <KalipAdimlar labels={[t("product"), t("packages"), t("review"), t("labels")]} />
    {error ? <ErrorNotice error={error} context="create" /> : null}
    {scanner.dropped ? <KalipUyari tone="uyari"><p>{t("scanDropped")}</p></KalipUyari> : null}
    <div className="package-layout">
      <section style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        {stage === 1 && !receipt ? <fieldset disabled={busy || frozen} className="pk-fs">
          <legend className="sr">{t("product")}</legend>
          <KalipGrup title={t("product")} sub={t("chooseProduct")} d={LICON.search} color="2F7D5B" testId="package-product">
            <div className="pk-body">
              <KalipAlan label={t("search")} value={query} maxLength={128} onChange={e => void search(e.target.value)} />
              {found.length > 0 ? <ul className="pk-list">{found.map(item => <li key={item.id}><button type="button" className="gp pk-pick" onClick={() => void choose(item.id)}>{item.code} · {item.name}</button></li>)}</ul> : null}
              <ScanPanel variant="kalip" service={scanner.service} prompt={t("scan")} last={last} ready={camera.ready} hue="green" />
              <SecondaryButton onClick={camera.press} disabled={busy}>{t("scan")}</SecondaryButton>
              {options ? <p className="pk-card pk-chosen"><Ico d={LICON.check} size={20} />{options.item.code} · {options.item.name}</p> : null}
              {unsupported ? <KalipUyari tone="uyari"><p>{t("serial")}</p></KalipUyari> : null}
              <PrimaryButton disabled={!options || !!unsupported || busy} onClick={() => setStage(2)}>{t("next")}</PrimaryButton>
            </div>
          </KalipGrup>
        </fieldset> : null}
        {stage === 2 && !receipt ? <fieldset disabled={busy || frozen} className="pk-fs">
          <legend className="sr">{t("packages")}</legend>
          <KalipGrup title={t("packages")} sub={options ? `${options.item.code} · ${options.item.name}` : undefined} d={LICON.koli} color="0E7C7B" testId="package-packages">
            <div className="pk-body">
              <div className="pk-grid">
                <KalipSecim name="warehouseId" label={t("warehouse")} placeholder={t("choose")} color="30475A" icon={{ d: LICON.depo, color: "30475A" }} value={warehouseId} options={warehouses.map(w => ({ id: w.id, label: `${w.code} · ${w.name}`, d: LICON.depo }))} onPick={id => { if (id === warehouseId) return; setWarehouseId(id); lock.current = true; setBusy(true); void loadLocations(id).catch(fail).finally(() => { lock.current = false; setBusy(false); }); }} testId="package-warehouse" />
                <KalipSecim name="locationId" label={t("location")} placeholder={t("choose")} color="2F7D5B" icon={{ d: LICON.moveIn, color: "2F7D5B" }} value={locationId} options={locations.map(l => ({ id: l.id, label: `${l.code} · ${l.name}`, d: LICON.moveIn }))} onPick={setLocationId} testId="package-location" />
              </div>
              {/* ALTIN-KURAL 8: boş seçimde çıkmaz yok — sıradaki adım bağlantısı (depolar / deponun lokasyon ağacı). */}
              {warehouses.length === 0 ? <KalipUyari tone="uyari"><p>{t("noWarehouse")}</p><Link href={`/t/${encodeURIComponent(slug)}/warehouses`} data-testid="package-empty-action"><Ico d={LICON.arrow} size={16} />{t("toWarehouses")}</Link></KalipUyari> : warehouseId && locations.length === 0 ? <KalipUyari tone="uyari"><p>{t("noLocation")}</p><a href={`/t/${encodeURIComponent(slug)}/warehouses/${encodeURIComponent(warehouseId)}`} data-testid="package-empty-action"><Ico d={LICON.plus} size={16} />{t("toLocations")}</a></KalipUyari> : null}
              <div className="pk-body pk-tight"><span className="pk-lab">{t("kind")}</span>
                <KalipSecenek label={t("kind")} color="0E7C7B" value={kind} onPick={id => setKind(id as "VARIL" | "KOLI")} options={[{ id: "VARIL", label: t("barrel"), d: LICON.koli }, { id: "KOLI", label: t("box"), d: LICON.box }]} />
              </div>
              <div className="pk-grid">
                <KalipSecim name="unitId" label={t("unit")} color="0E7C7B" value={unitId} options={(options?.units ?? []).map(u => ({ id: u.unitId, label: `${u.unitCode} · ${u.unitName}` }))} onPick={setUnitId} testId="package-unit" />
                <KalipAlan label={t("count")} inputMode="numeric" value={count} maxLength={4} aria-invalid={!/^\d{1,3}$/.test(count) || Number(count) < 1 || Number(count) > 200} onChange={e => { setCount(e.target.value); if (/^\d{1,3}$/.test(e.target.value) && Number(e.target.value) >= 1 && Number(e.target.value) <= 200) setRows(old => Array.from({ length: Number(e.target.value) }, (_, i) => old[i] ?? { ...entry })); }} />
              </div>
              <KalipAnahtar title={t("different")} d={LICON.grid} color="6C4BD8" on={!equal} aria={t("different")} onToggle={() => { if (equal && /^\d{1,3}$/.test(count) && Number(count) >= 1 && Number(count) <= 200) setRows(Array.from({ length: Number(count) }, () => ({ ...entry }))); setEqual(!equal); }} />
              {options?.item.trackingMode === "NONE" ? <KalipAnahtar title={t("optionalMetadata")} d={LICON.tag} color="B85A14" on={optionalMetadata} aria={t("optionalMetadata")} onToggle={() => setOptionalMetadata(!optionalMetadata)} /> : null}
              {equal ? <div className="pk-card"><h2 className="pk-h">{t("each")}</h2>{entryFields(entry, setEntry, t("each"))}</div> : rows.map((row, i) => <section className="pk-card" key={i}><h2 className="pk-h">{t("packageNo", { n: i + 1 })}</h2>{entryFields(row, value => setRows(old => old.map((r, j) => i === j ? value : r)), `${i + 1}`)}</section>)}
              {!preview ? <p role="status" className="pill warn pk-note">⚠ {t("invalid")}</p> : null}
              <div className="package-actions"><SecondaryButton onClick={() => setStage(1)}>{t("back")}</SecondaryButton><PrimaryButton disabled={!input} onClick={() => setStage(3)}>{t("review")}</PrimaryButton></div>
            </div>
          </KalipGrup>
        </fieldset> : null}
        {stage >= 3 || receipt ? <section className="sg" aria-label={posted ? t("posted") : t("review")} data-testid="package-review">
          <div className="sgh"><i style={{ background: kdz("dzf", posted ? "2F7D5B" : "2F5DA8") }}><Ico d={posted ? LICON.check : LICON.clip} size={24} /></i><span><h2 className="pk-h2"><b>{posted ? `✓ ${t("posted")}` : t("review")}</b></h2></span></div>
          <div className="pk-body">
          {frozen && !posted ? <p className="pill warn pk-note">🔒 {t("draftLocked")}</p> : null}
          {receipt ? <><p className="pk-meta">{receipt.receiptNumber}</p><p className="pk-strong">{t("countSummary", { n: receipt.packages.length })}</p><p className="pk-meta">{t("initialQuantity")}</p><ul className="pk-list">{receipt.packages.map(p => <li key={p.id} className="pk-card">{t("packageNo", { n: p.packageNo })} · {p.itemName} · {displayQuantity(p.quantity)} {p.unitCode}<p>{p.lotCode} {p.producedOn} {p.expiresOn}</p><p>{p.stockStatus === "QUARANTINE" ? `⚠ ${t("quarantine")}` : p.stockStatus}</p></li>)}</ul></> : <><p className="pk-strong">{options?.item.name}</p><p className="pk-meta">{warehouses.find(w => w.id === warehouseId)?.name} · {locations.find(l => l.id === locationId)?.name}</p><p className="pk-meta">{t(kind === "VARIL" ? "barrel" : "box")}</p><ul className="pk-list">{(equal ? Array.from({ length: preview?.count ?? 0 }, () => entry) : rows).map((r, i) => <li key={i} className="pk-card">{t("packageNo", { n: i + 1 })} · {r.quantity} {options?.units.find(u => u.unitId === unitId)?.unitCode}<p>{r.lotCode} {r.producedOn} {r.expiresOn}</p></li>)}</ul></>}
          {!canWrite && !posted ? <p role="alert" className="pill warn pk-note">🔒 {t("locked")}</p> : null}
          {posted && receipt ? <Link href={packageLabelHref(slug, receipt.documentId)} className="btn n pk-wide">{t("labels")}</Link> : canWrite ? <div className="package-actions">{!frozen ? <SecondaryButton disabled={busy} onClick={() => setStage(2)}>{t("edit")}</SecondaryButton> : null}<PrimaryButton loading={busy} disabled={!clientReady || (!input && !frozen)} onClick={() => void accept()}>{error || initial ? t("retry") : t("accept")}</PrimaryButton></div> : null}
          </div>
        </section> : null}
      </section>
      <aside className="pk-card package-summary" aria-live="polite">
        <h2 className="pk-h">{t("summary")}</h2><p style={{ overflowWrap: "anywhere" }}>{options?.item.name ?? receipt?.packages[0]?.itemName ?? t("chooseProduct")}</p>
        {preview && options ? <p className="pk-total" data-testid="package-total">{t("countSummary", { n: preview.count })} / {displayQuantity(preview.baseTotal)} {options.baseUnit.code}</p> : null}
        <p className="pk-meta">{t("initialQuantity")}</p>
      </aside>
    </div>
    {camera.overlay}
    <style>{`.package-layout{display:grid;gap:16px;min-width:0}@media (min-width:1280px){.package-layout{grid-template-columns:minmax(0,1fr) minmax(0,22rem)}}.package-actions{display:flex;gap:12px}.package-summary{display:flex;flex-direction:column;gap:8px;align-self:start} @media (min-width:768px) and (max-width:1199px){.package-layout{grid-template-columns:minmax(0,1fr)}.package-summary{order:-1}} @media (max-width:767px),(pointer:coarse) and (max-height:500px){.package-layout{grid-template-columns:minmax(0,1fr)}.package-summary{order:-1}.package-actions{position:sticky;bottom:0;z-index:5;padding-block:.5rem}}`}</style>
  </div>
  </KalipEkran>;
}
