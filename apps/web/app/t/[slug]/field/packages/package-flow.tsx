"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CircleCheck, Lock, Package, ScanLine, TriangleAlert, Warehouse } from "@wms/ui";
import { FlowShell, PrimaryButton, SecondaryButton, ScanPanel, useScanner, useScanPrimary } from "../receive/receive-flow.tsx";
import { ErrorNotice, type ErrorInfo } from "../../receipts/receipt-form.tsx";
import { getCurrentPackageAction, resolveCurrentPackageQrAction, qualityReleasePackageAction, putawayPackageAction, packageStorageLocationsAction, resolvePackageDestinationAction, type CurrentPackageDto } from "./actions.ts";

type Place = { readonly id: string; readonly code: string; readonly name: string };
type FrozenCommand = { slug: string; clientKey: string; packageId: string; predecessorVersion: number; currentBalanceVersion: string; targetLocationId?: string };
const card = "min-w-0 rounded-card border-2 border-border bg-surface p-4";
const focus = "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus";
// Display strings only: the server is the quantity and permission authority.
const quantity = (q: string): string => q.replace(/\.0+$/, "").replace(".", ",");

export function PackageMovementFlow({ slug, initial }: { slug: string; initial: CurrentPackageDto | null }) {
  const t = useTranslations("packageMovement");
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  const [current, setCurrent] = useState(initial);
  const [stage, setStage] = useState<"package" | "current" | "destination">(initial ? "current" : "package");
  const [place, setPlace] = useState<Place | null>(null);
  const [places, setPlaces] = useState<readonly Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [last, setLast] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [needsReload, setNeedsReload] = useState(false);
  const [retry, setRetry] = useState(false);
  const pending = useRef(false);
  const frozen = useRef<{ action: "QC_RELEASE" | "PUTAWAY"; input: FrozenCommand } | null>(null);
  const uncertain = useRef(false);
  const home = `/t/${encodeURIComponent(slug)}/field`;
  const fail = (e: unknown) => setError(typeof e === "object" && e !== null && "code" in e ? e as ErrorInfo : { code: "NETWORK" });
  const blocked = useCallback(() => pending.current || frozen.current !== null, []);
  const nextPackage = () => {
    if (pending.current || frozen.current) return;
    setCurrent(null); setStage("package"); setLast(""); setError(null); setSaved(null); setPlace(null);
    const url = new URL(globalThis.location.href);
    url.searchParams.delete("package");
    globalThis.history.replaceState(null, "", url);
  };

  const scan = async (code: string) => {
    if (!ready || pending.current || frozen.current) return;
    pending.current = true; setBusy(true); setError(null); setLast(code);
    try {
      if (stage === "destination" && current) {
        const r = await resolvePackageDestinationAction({ slug, packageId: current.id, code });
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
  const { service, camera } = useScanner(v => void scan(v), ready && (stage === "package" || stage === "destination") && !busy, blocked);
  const scanner = useScanPrimary(camera, { busy, name: stage === "destination" ? place?.name : current?.itemName, code: last, alerting: error !== null });

  const refresh = async () => {
    if (!current || pending.current || frozen.current) return;
    pending.current = true; setBusy(true); setError(null);
    try {
      const r = await getCurrentPackageAction({ slug, packageId: current.id });
      if (!r.ok) throw r.error;
      setCurrent(r.data); setNeedsReload(false); setPlace(null); setStage("current");
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

  const execute = async (action: "QC_RELEASE" | "PUTAWAY") => {
    if (!ready || !current || pending.current || needsReload) return;
    if (!frozen.current) {
      if (current.currentBalanceVersion === null || !current.allowedActions.includes(action) || (action === "PUTAWAY" && !place)) return;
      frozen.current = { action, input: { slug, clientKey: crypto.randomUUID(), packageId: current.id,
        predecessorVersion: current.predecessorVersion, currentBalanceVersion: current.currentBalanceVersion,
        ...(action === "PUTAWAY" && place ? { targetLocationId: place.id } : {}) } };
    }
    pending.current = true; setBusy(true); setError(null); setRetry(false);
    try {
      const f = frozen.current;
      let r;
      try { r = f.action === "QC_RELEASE" ? await qualityReleasePackageAction(f.input) : await putawayPackageAction(f.input); }
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
      setCurrent(fresh.data); setNeedsReload(false); setPlace(null);
    } catch (e) { if (frozen.current) setRetry(true); fail(e); }
    finally { pending.current = false; setBusy(false); }
  };

  const scanMode = stage === "package" || stage === "destination";
  const canQc = current?.allowedActions.includes("QC_RELEASE") === true;
  const canPut = current?.allowedActions.includes("PUTAWAY") === true;
  const footer = retry ? <PrimaryButton disabled={!ready || busy} loading={busy} onClick={() => { const f = frozen.current; if (f) void execute(f.action); }}>{t("retry")}</PrimaryButton>
    : needsReload ? <PrimaryButton disabled={!ready || busy} loading={busy} onClick={() => void refresh()}>{t("reload")}</PrimaryButton>
    : stage === "destination" && place ? <PrimaryButton disabled={!ready || busy} loading={busy} onClick={() => void execute("PUTAWAY")}><Warehouse className="mr-2 size-6" aria-hidden="true" />{t("putHere")}</PrimaryButton>
    : scanMode ? <PrimaryButton disabled={!ready || busy} loading={busy} onClick={scanner.press}><ScanLine className="mr-2 size-6" aria-hidden="true" />{t(stage === "destination" ? "scanLocation" : "scanPackage")}</PrimaryButton>
    : canQc ? <PrimaryButton disabled={!ready || busy} loading={busy} onClick={() => void execute("QC_RELEASE")}><CircleCheck className="mr-2 size-6" aria-hidden="true" />{t("release")}</PrimaryButton>
    : canPut ? <PrimaryButton disabled={!ready || busy} loading={busy} onClick={() => void destination()}><Warehouse className="mr-2 size-6" aria-hidden="true" />{t("chooseLocation")}</PrimaryButton>
    : <PrimaryButton disabled={!ready || busy} onClick={nextPackage}>{t("nextPackage")}</PrimaryButton>;

  return <FlowShell hue="teal" icon={<Package className="size-6" />} title={t(stage === "destination" ? "destinationTitle" : "title")}
    {...(frozen.current ? {} : stage === "destination" ? { onBack: () => { setStage("current"); setError(null); } } : { backHref: home })}
    footer={footer} scanProxy={scanMode}>
    <div className="grid min-w-0 gap-3 min-[1200px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" data-testid="package-movement">
      {current && <section className={card} data-testid="package-current">
        <div className="flex items-center gap-2"><Package className="size-7 shrink-0 text-cat-teal-ink" aria-hidden="true" /><h2 className="break-words text-xl font-extrabold">{current.itemName}</h2></div>
        <p className="my-3 text-3xl font-extrabold" data-testid="package-current-quantity">{quantity(current.currentBaseQuantity)} <span className="text-lg">{current.baseUnitCode}</span></p>
        <dl className="grid min-w-0 grid-cols-2 gap-2 text-sm">
          <dt>{t("package")}</dt><dd className="break-words font-bold">{current.kind} · {current.packageNo}</dd>
          <dt>{t("warehouse")}</dt><dd className="break-words font-bold">{current.warehouseName}</dd>
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
        {scanMode && <fieldset disabled={!ready || busy || retry} className="min-w-0"><ScanPanel service={ready && !busy && !retry ? service : null} prompt={t(stage === "destination" ? "scanLocation" : "scanPackage")} last={last} ready={ready && scanner.ready && !busy} hue="teal" /></fieldset>}
        {stage === "destination" && <div className={`${card} flex flex-col gap-2`}>
          <h2 className="font-extrabold">{t("location")}</h2>
          {place && <p className="break-words rounded-control bg-cat-teal-bg p-3 font-bold text-cat-teal-ink" data-testid="package-destination">✓ {place.code} · {place.name}</p>}
          {places.map(p => <button key={p.id} type="button" disabled={!ready || busy || retry} aria-pressed={place?.id === p.id} onClick={() => { setPlace(p); setError(null); }} className={`min-h-12 rounded-control border-2 border-border-strong bg-surface px-3 py-2 text-left font-bold text-ink aria-pressed:border-cat-teal-ink aria-pressed:bg-cat-teal-bg ${focus}`}>{p.code} · {p.name}</button>)}
        </div>}
        {stage === "current" && !needsReload && !retry && current?.blockedReason && <p className="flex items-center gap-2 rounded-card bg-warning-bg p-3 font-bold text-warning-ink"><Lock className="size-6 shrink-0" aria-hidden="true" />{t(current.blockedReason === "DRAFT" ? "draft" : current.blockedReason === "NO_PERMISSION" ? "locked" : "unsupported")}</p>}
        {stage === "current" && !retry && !needsReload && <SecondaryButton disabled={!ready || busy} onClick={nextPackage}>{t("nextPackage")}</SecondaryButton>}
      </section>
    </div>
    {scanner.overlay}
    <style jsx global>{`
      @media (min-width: 1200px) {
        .screen-field .field-screen:has([data-testid="package-movement"]) { max-width: 76rem; }
        .screen-field [data-testid="flow-step"]:has([data-testid="package-movement"]) > [role="group"] > div { max-width: 44rem; }
      }
    `}</style>
  </FlowShell>;
}
