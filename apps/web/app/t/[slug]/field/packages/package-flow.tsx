"use client";
// Saha paket işlemi (T-938…): paket QR okut → kalite onayı / yerleştirme / depoya taşıma. Yetki, sürüm ve tekrar (idempotency) kuralları
// sunucuda; bu dosya yalnız girdi toplar.
// T-973 (B-63, I-18): Saha kalıbı (KalipSaha.dc.html; `SahaShell`): üst çubuk + 3 adım (OKUT · DOĞRULA · MİKTAR karşılığı: paket okut,
// paketi gör, işlemi onayla) + ortak alt cam çubuk. Okutma adımlarında çubuğun ana işlemi OKUT; diğer adımlarda adımın tek işlemi çubuğun
// hemen üstündeki sabit düğmededir (eski düğme adları ve test kimlikleri korunur).
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeftRight, CircleCheck, Lock, Package, ScanLine, TriangleAlert, Warehouse } from "@wms/ui";
import { PrimaryButton, SecondaryButton, ScanPanel, useScanner, useScanPrimary } from "../receive/receive-flow.tsx";
import { ErrorNotice, type ErrorInfo } from "../../receipts/receipt-form.tsx";
import { LICON } from "../../../../design/kalip-icons.ts";
import { SICON } from "../../../../design/saha-icons.ts";
import { SahaShell } from "../saha-shell.tsx";
import { getCurrentPackageAction, resolveCurrentPackageQrAction, qualityReleasePackageAction, putawayPackageAction, packageStorageLocationsAction, resolvePackageDestinationAction, transferPackageAction, packageTransferWarehousesAction, packageTransferLocationsAction, resolvePackageTransferDestinationAction, type CurrentPackageDto, type PackageDestinationCursor } from "./actions.ts";

type Place = { readonly id: string; readonly code: string; readonly name: string };
type FrozenCommand = { slug: string; clientKey: string; packageId: string; predecessorVersion: number; currentBalanceVersion: string; targetLocationId?: string };
const card = "min-w-0 rounded-card border-2 border-border bg-surface p-4";
const focus = "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus";
// Display strings only: the server is the quantity and permission authority.
const quantity = (q: string): string => q.replace(/\.0+$/, "").replace(".", ",");

export function PackageMovementFlow({ slug, initial }: { slug: string; initial: CurrentPackageDto | null }) {
  const t = useTranslations("packageMovement");
  const ts = useTranslations("saha");
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  const [current, setCurrent] = useState(initial);
  const [stage, setStage] = useState<"package" | "current" | "destination" | "transferWarehouse" | "transferDestination" | "transferConfirm">(initial ? "current" : "package");
  const [place, setPlace] = useState<Place | null>(null);
  const [places, setPlaces] = useState<readonly Place[]>([]);
  const [targetWarehouse, setTargetWarehouse] = useState<Place | null>(null);
  const [warehouses, setWarehouses] = useState<readonly Place[]>([]);
  const [warehouseAfter, setWarehouseAfter] = useState<string | null>(null);
  const [locationAfter, setLocationAfter] = useState<PackageDestinationCursor | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [last, setLast] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [needsReload, setNeedsReload] = useState(false);
  const [retry, setRetry] = useState(false);
  const pending = useRef(false);
  const frozen = useRef<{ action: "QC_RELEASE" | "PUTAWAY" | "TRANSFER"; input: FrozenCommand } | null>(null);
  const uncertain = useRef(false);
  const home = `/t/${encodeURIComponent(slug)}/field`;
  const fail = (e: unknown) => setError(typeof e === "object" && e !== null && "code" in e ? e as ErrorInfo : { code: "NETWORK" });
  const blocked = useCallback(() => pending.current || frozen.current !== null, []);
  const nextPackage = () => {
    if (pending.current || frozen.current) return;
    setCurrent(null); setStage("package"); setLast(""); setError(null); setSaved(null); setPlace(null); setTargetWarehouse(null);
    const url = new URL(globalThis.location.href);
    url.searchParams.delete("package");
    globalThis.history.replaceState(null, "", url);
  };

  const scan = async (code: string) => {
    if (!ready || pending.current || frozen.current) return;
    pending.current = true; setBusy(true); setError(null); setLast(code);
    try {
      if ((stage === "destination" || stage === "transferDestination") && current) {
        if (stage === "transferDestination" && !targetWarehouse) return;
        const r = stage === "transferDestination" && targetWarehouse
          ? await resolvePackageTransferDestinationAction({ slug, packageId: current.id, warehouseId: targetWarehouse.id, code })
          : await resolvePackageDestinationAction({ slug, packageId: current.id, code });
        if (!r.ok) throw r.error;
        setPlace(r.data);
      } else {
        const r = await resolveCurrentPackageQrAction({ slug, qr: code });
        if (!r.ok) throw r.error;
        setCurrent(r.data); setStage("current"); setPlace(null); setSaved(null); setNeedsReload(false);
        const url = new URL(globalThis.location.href);
        url.searchParams.set("package", r.data.id);
        globalThis.history.replaceState(null, "", url);
      }
    } catch (e) { fail(e); }
    finally { pending.current = false; setBusy(false); }
  };
  const isDestination = stage === "destination" || stage === "transferDestination";
  const { service, camera } = useScanner(v => void scan(v), ready && (stage === "package" || isDestination) && !busy, blocked);
  const scanner = useScanPrimary(camera, { busy, name: isDestination ? place?.name : current?.itemName, code: last, alerting: error !== null });

  const refresh = async () => {
    if (!current || pending.current || frozen.current) return;
    pending.current = true; setBusy(true); setError(null);
    try {
      const r = await getCurrentPackageAction({ slug, packageId: current.id });
      if (!r.ok) throw r.error;
      setCurrent(r.data); setNeedsReload(false); setPlace(null); setTargetWarehouse(null); setStage("current");
    } catch (e) { setNeedsReload(true); fail(e); }
    finally { pending.current = false; setBusy(false); }
  };

  const destination = async () => {
    if (!current || pending.current || frozen.current) return;
    setStage("destination"); setPlace(null); setLast(""); setPlaces([]); setError(null);
    pending.current = true; setBusy(true);
    try {
      // A short server-authorized first page supplements scanning; it is not the complete inventory.
      const r = await packageStorageLocationsAction({ slug, packageId: current.id });
      if (!r.ok) throw r.error;
      setPlaces(r.data.items);
    } catch (e) { fail(e); }
    finally { pending.current = false; setBusy(false); }
  };

  const transferWarehouses = async (more = false) => {
    if (!ready || !current || !current.canTransfer || pending.current || frozen.current) return;
    pending.current = true; setBusy(true); setError(null);
    if (!more) { setStage("transferWarehouse"); setWarehouses([]); setWarehouseAfter(null); setTargetWarehouse(null); setPlace(null); setSaved(null); }
    try {
      const r = await packageTransferWarehousesAction({ slug, packageId: current.id, ...(more && warehouseAfter ? { afterCode: warehouseAfter } : {}) });
      if (!r.ok) throw r.error;
      setWarehouses(old => more ? [...old, ...r.data.items] : r.data.items); setWarehouseAfter(r.data.nextAfterCode);
    } catch (e) { fail(e); }
    finally { pending.current = false; setBusy(false); }
  };

  const transferLocations = async (warehouse: Place, more = false) => {
    if (!ready || !current || pending.current || frozen.current) return;
    pending.current = true; setBusy(true); setError(null);
    if (!more) { setTargetWarehouse(warehouse); setStage("transferDestination"); setPlaces([]); setPlace(null); setLast(""); setLocationAfter(null); }
    try {
      const r = await packageTransferLocationsAction({ slug, packageId: current.id, warehouseId: warehouse.id,
        ...(more && locationAfter ? { after: locationAfter } : {}) });
      if (!r.ok) throw r.error;
      setPlaces(old => more ? [...old, ...r.data.items] : r.data.items); setLocationAfter(r.data.next);
    } catch (e) { fail(e); }
    finally { pending.current = false; setBusy(false); }
  };

  const execute = async (action: "QC_RELEASE" | "PUTAWAY" | "TRANSFER") => {
    if (!ready || !current || pending.current || needsReload) return;
    if (!frozen.current) {
      if (current.currentBalanceVersion === null || (action === "TRANSFER" ? !current.canTransfer : !current.allowedActions.includes(action)) || (action !== "QC_RELEASE" && !place)) return;
      frozen.current = { action, input: { slug, clientKey: crypto.randomUUID(), packageId: current.id,
        predecessorVersion: current.predecessorVersion, currentBalanceVersion: current.currentBalanceVersion,
        ...(action !== "QC_RELEASE" && place ? { targetLocationId: place.id } : {}) } };
    }
    pending.current = true; setBusy(true); setError(null); setRetry(false);
    try {
      const f = frozen.current;
      let r;
      try { r = f.action === "QC_RELEASE" ? await qualityReleasePackageAction(f.input) : f.action === "TRANSFER" ? await transferPackageAction(f.input) : await putawayPackageAction(f.input); }
      catch (e) { uncertain.current = true; throw e; }
      if (!r.ok) {
        // After an unknown response, a later rejection cannot prove the original command did not commit.
        if (!uncertain.current && r.error.code !== "INTERNAL") {
          frozen.current = null; setNeedsReload(true);
        } else { uncertain.current = true; setRetry(true); }
        throw r.error;
      }
      frozen.current = null; uncertain.current = false;
      setSaved(r.data.documentId); setNeedsReload(true); setStage("current");
      // Saved is durable; a failed current read cannot turn the command into a second mutation.
      const fresh = await getCurrentPackageAction({ slug, packageId: current.id });
      if (!fresh.ok) throw fresh.error;
      setCurrent(fresh.data); setNeedsReload(false); setPlace(null); setTargetWarehouse(null);
    } catch (e) { if (frozen.current) setRetry(true); fail(e); }
    finally { pending.current = false; setBusy(false); }
  };

  const scanMode = stage === "package" || isDestination;
  const canQc = current?.allowedActions.includes("QC_RELEASE") === true;
  const canPut = current?.allowedActions.includes("PUTAWAY") === true;
  const canTransfer = current?.canTransfer === true;
  const footer = retry ? <PrimaryButton disabled={!ready || busy} loading={busy} onClick={() => { const f = frozen.current; if (f) void execute(f.action); }}>{t("retry")}</PrimaryButton>
    : needsReload ? <PrimaryButton disabled={!ready || busy} loading={busy} onClick={() => void refresh()}>{t("reload")}</PrimaryButton>
    : stage === "transferWarehouse" ? <PrimaryButton disabled>{t("chooseWarehouse")}</PrimaryButton>
    : stage === "transferConfirm" ? <PrimaryButton disabled={!ready || busy} loading={busy} onClick={() => void execute("TRANSFER")}><ArrowLeftRight className="mr-2 size-6" aria-hidden="true" />{t("confirmTransfer")}</PrimaryButton>
    : stage === "transferDestination" && place ? <PrimaryButton disabled={!ready || busy} onClick={() => setStage("transferConfirm")}>{t("reviewTransfer")}</PrimaryButton>
    : stage === "destination" && place ? <PrimaryButton disabled={!ready || busy} loading={busy} onClick={() => void execute("PUTAWAY")}><Warehouse className="mr-2 size-6" aria-hidden="true" />{t("putHere")}</PrimaryButton>
    : scanMode ? <PrimaryButton disabled={!ready || busy} loading={busy} onClick={scanner.press}><ScanLine className="mr-2 size-6" aria-hidden="true" />{t(isDestination ? "scanLocation" : "scanPackage")}</PrimaryButton>
    : canQc ? <PrimaryButton disabled={!ready || busy} loading={busy} onClick={() => void execute("QC_RELEASE")}><CircleCheck className="mr-2 size-6" aria-hidden="true" />{t("release")}</PrimaryButton>
    : canPut ? <PrimaryButton disabled={!ready || busy} loading={busy} onClick={() => void destination()}><Warehouse className="mr-2 size-6" aria-hidden="true" />{t("chooseLocation")}</PrimaryButton>
    : canTransfer ? <PrimaryButton disabled={!ready || busy} loading={busy} onClick={() => void transferWarehouses()}><ArrowLeftRight className="mr-2 size-6" aria-hidden="true" />{t("transfer")}</PrimaryButton>
    : <PrimaryButton disabled={!ready || busy} onClick={nextPackage}>{t("nextPackage")}</PrimaryButton>;

  const backStage = stage === "transferConfirm" ? "transferDestination" : stage === "transferDestination" ? "transferWarehouse" : "current";
  const phase: 1 | 2 | 3 | 4 = stage === "package" ? 1 : stage === "current" ? (saved && !needsReload ? 4 : 2) : 3;
  return <SahaShell hue="teal" iconD={LICON.koli} phase={phase} title={t(stage === "transferWarehouse" ? "chooseWarehouse" : stage === "transferConfirm" ? "reviewTransfer" : isDestination ? "destinationTitle" : "title")}
    {...(current ? { instruction: `${current.kind} · ${current.packageNo}` } : {})}
    {...(frozen.current ? {} : stage !== "package" && stage !== "current" ? { onBack: () => { if (!pending.current) { setStage(backStage); setError(null); } } } : { backHref: home })}
    navTestIds={{ back: "screen-back", home: "screen-home", homeHref: `/t/${encodeURIComponent(slug)}` }}
    {...(scanMode && !retry && !needsReload ? { main: { label: ts("okut.scanMain"), aria: ts("okut.title"), d: SICON.scan, onClick: scanner.press, disabled: !ready || busy, testId: "package-main" } } : {})}
    footer={footer} scanProxy={scanMode}>
    <div className="grid min-w-0 gap-3" data-testid="package-movement">
      {current && <section className={card} data-testid="package-current">
        <div className="flex items-center gap-2"><Package className="size-7 shrink-0 text-cat-teal-ink" aria-hidden="true" /><h2 className="break-words text-xl font-extrabold">{current.itemName}</h2></div>
        <p className="my-3 text-3xl font-extrabold" data-testid="package-current-quantity">{quantity(current.currentBaseQuantity)} <span className="text-lg">{current.baseUnitCode}</span></p>
        <dl className="grid min-w-0 grid-cols-2 gap-2 text-sm">
          <dt>{t("package")}</dt><dd className="break-words font-bold">{current.kind} · {current.packageNo}</dd>
          <dt>{t("warehouse")}</dt><dd className="break-words font-bold" data-testid="package-current-warehouse">{current.warehouseName}</dd>
          <dt>{t("location")}</dt><dd className="break-words font-bold" data-testid="package-current-location">{current.currentLocation?.code ?? "—"}</dd>
          <dt>{t("status")}</dt><dd className="break-words font-bold">{t(current.currentStockStatus === "AVAILABLE" ? "available" : current.currentStockStatus === "QUARANTINE" ? "quarantine" : "unavailable")}</dd>
          {current.lotCode && <><dt>{t("lot")}</dt><dd className="break-words font-bold">{current.lotCode}</dd></>}
          {current.producedOn && <><dt>{t("produced")}</dt><dd>{current.producedOn}</dd></>}
          {current.expiresOn && <><dt>{t("expiry")}</dt><dd className="font-bold">{current.expiresOn}</dd></>}
        </dl>
        {ready && current.expiresOn && current.expiresOn < new Date().toISOString().slice(0, 10) && <p className="mt-3 flex items-center gap-2 rounded-control bg-warning-bg p-3 font-bold text-warning-ink"><TriangleAlert className="size-6 shrink-0" aria-hidden="true" />{t("expired")}</p>}
        <details className="mt-2"><summary className={`flex min-h-12 cursor-pointer items-center font-bold ${focus}`}>{t("qr")}</summary><p className="break-all text-sm" data-testid="package-qr">{current.qr}</p></details>
      </section>}
      <section className="flex min-w-0 flex-col gap-3">
        {saved && <div role="status" className="flex items-center gap-2 rounded-card border-2 border-cat-green-ink bg-cat-green-bg p-3 font-bold text-cat-green-ink" data-testid="package-saved"><CircleCheck className="size-6 shrink-0" aria-hidden="true" />{t("saved")}</div>}
        {error && <ErrorNotice error={error} context="putaway" />}
        {stage === "transferWarehouse" && <div className={`${card} flex flex-col gap-2`}>
          <h2 className="font-extrabold">{t("targetWarehouse")}</h2>
          {warehouses.map(w => <button key={w.id} type="button" disabled={!ready || busy || retry} onClick={() => void transferLocations(w)} className={`flex min-h-12 items-center gap-2 rounded-control border-2 border-border-strong bg-surface px-3 py-2 text-left font-bold text-ink ${focus}`}><Warehouse className="size-6 shrink-0 text-cat-sky-ink" aria-hidden="true" />{w.code} · {w.name}</button>)}
          {warehouseAfter && <SecondaryButton disabled={!ready || busy || retry} onClick={() => void transferWarehouses(true)}>{t("moreWarehouses")}</SecondaryButton>}
          {error && warehouses.length === 0 && <SecondaryButton disabled={!ready || busy || retry} onClick={() => void transferWarehouses()}>{t("reloadWarehouses")}</SecondaryButton>}
          {!busy && !error && warehouses.length === 0 && !warehouseAfter && <p>{t("noWarehouse")}</p>}
        </div>}
        {scanMode && <fieldset disabled={!ready || busy || retry} className="min-w-0"><ScanPanel variant="kalip" service={ready && !busy && !retry ? service : null} prompt={t(isDestination ? "scanLocation" : "scanPackage")} last={last} ready={ready && scanner.ready && !busy} hue="teal" /></fieldset>}
        {isDestination && <div className={`${card} flex flex-col gap-2`}>
          {stage === "transferDestination" && targetWarehouse && <p className="flex items-center gap-2 rounded-control bg-cat-sky-bg p-3 font-bold text-cat-sky-ink" data-testid="transfer-target-warehouse"><Warehouse className="size-6 shrink-0" aria-hidden="true" />{targetWarehouse.code} · {targetWarehouse.name}</p>}
          <h2 className="font-extrabold">{t("location")}</h2>
          {place && <p className="break-words rounded-control bg-cat-teal-bg p-3 font-bold text-cat-teal-ink" data-testid="package-destination">✓ {place.code} · {place.name}</p>}
          {places.map(p => <button key={p.id} type="button" disabled={!ready || busy || retry} aria-pressed={place?.id === p.id} onClick={() => { setPlace(p); setError(null); }} className={`min-h-12 rounded-control border-2 border-border-strong bg-surface px-3 py-2 text-left font-bold text-ink aria-pressed:border-cat-teal-ink aria-pressed:bg-cat-teal-bg ${focus}`}>{p.code} · {p.name}</button>)}
          {stage === "transferDestination" && targetWarehouse && locationAfter && <SecondaryButton disabled={!ready || busy || retry} onClick={() => void transferLocations(targetWarehouse, true)}>{t("moreLocations")}</SecondaryButton>}
          {stage === "transferDestination" && targetWarehouse && error && places.length === 0 && <SecondaryButton disabled={!ready || busy || retry} onClick={() => void transferLocations(targetWarehouse)}>{t("reloadLocations")}</SecondaryButton>}
        </div>}
        {stage === "transferConfirm" && current && targetWarehouse && place && <div className={`${card} flex flex-col gap-3`} data-testid="package-transfer-confirm">
          <ArrowLeftRight className="size-10 text-cat-sky-ink" aria-hidden="true" />
          <p className="text-2xl font-extrabold">{quantity(current.currentBaseQuantity)} {current.baseUnitCode}</p>
          <p className="break-words font-bold">{current.warehouseName} · {current.currentLocation?.code}</p>
          <p aria-hidden="true" className="text-2xl text-cat-sky-ink">↓</p>
          <p className="break-words rounded-control bg-cat-sky-bg p-3 font-bold text-cat-sky-ink">{targetWarehouse.name} · {place.code}</p>
        </div>}
        {stage === "current" && !needsReload && !retry && current?.blockedReason && !canTransfer && <p className="flex items-center gap-2 rounded-card bg-warning-bg p-3 font-bold text-warning-ink"><Lock className="size-6 shrink-0" aria-hidden="true" />{t(current.blockedReason === "DRAFT" ? "draft" : current.blockedReason === "NO_PERMISSION" ? "locked" : "unsupported")}</p>}
        {stage === "current" && !retry && !needsReload && canTransfer && (canQc || canPut) && <SecondaryButton disabled={!ready || busy} onClick={() => void transferWarehouses()}><ArrowLeftRight className="mr-2 size-6 text-cat-sky-ink" aria-hidden="true" />{t("transfer")}</SecondaryButton>}
        {stage === "current" && !retry && !needsReload && <SecondaryButton disabled={!ready || busy} onClick={nextPackage}>{t("nextPackage")}</SecondaryButton>}
      </section>
    </div>
    {scanner.overlay}
  </SahaShell>;
}
