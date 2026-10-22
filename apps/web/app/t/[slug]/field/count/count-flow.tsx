"use client";
// T-977 (B-51 saha): saha sayım — rafı okut → ürünü okut (ya da listeden seç) → sayıyı gir → kaydet; fark varsa uyarı. Yazma `recordCount` / `submitCount`
// (document.create; I-06 idempotency anahtarı, oturum başlığı kilidi domain'de). Fark KARARI burada verilmez: kör sayımda (A-136, varsayılan) referans
// miktar istemciye hiç gelmez, ekran yalnız sayılmayan ürünü uyarır; kör olmayan oturumda sistem miktarıyla fark gösterilir. Fark onayı ve fişi yönetici
// ekranındadır (`count_diff.approve`; görev ayrılığı açıksa sayımı yapan onaylayamaz — domain `assertSeparated`).
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { KICON } from "../../../../design/kabuk-icons.ts";
import { dz } from "../../../../design/kalip-saha-tokens.ts";
import { SICON } from "../../../../design/saha-icons.ts";
import { resolveItemScanAction } from "../../receipts/actions.ts";
import { ErrorNotice, errorKeyOf, intOf, submitWithKey, useKeyHolder, type ErrorInfo } from "../../receipts/receipt-form.tsx";
import { recordCountAction, submitCountAction } from "../../counts/actions.ts";
import { DroppedNotice, PrimaryButton, PrimaryLink, ScanAlert, ScanPanel, scanStepOf, useScanPrimary, useScanner, useStateRef, type AlertState } from "../receive/receive-flow.tsx";
import { Ico, SahaDoneVeil, SahaShell, SahaVerdict } from "../saha-shell.tsx";
import { SahaQty } from "../saha-qty.tsx";
import { feedback } from "@wms/ui";

export interface CountFlowLine {
  readonly lineId: string;
  readonly itemId: string;
  readonly itemCode: string;
  readonly itemName: string;
  readonly unitCode: string;
  readonly scale: number;
  readonly stockStatus: string;
  readonly counted: string | null;
  readonly reference: string | null;
}
export interface CountFlowWork {
  readonly taskId: string;
  readonly sessionId: string;
  readonly sessionStatus: string;
  readonly blind: boolean;
  readonly warehouseName: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly locationName: string;
  readonly lines: readonly CountFlowLine[];
  readonly progress: { readonly total: number; readonly counted: number };
}
type Stage = "location" | "list" | "qty";
interface Target {
  readonly itemId: string;
  readonly itemName: string;
  readonly unitCode: string;
  readonly stockStatus: string;
  readonly reference: string | null;
  /** Rafta kayıtlı satırı yok: sistemde olmayan bulgu (A-309-4, yalnız AVAILABLE). */
  readonly finding: boolean;
  readonly barcode: string | null;
  readonly step: number;
  /** Ondalık ölçekli ürün (kg, m…): sayı tuşları yerine ondalık alan; değer dizge olarak gider, ölçek denetimi sunucuda (`QUANTITY_SCALE`). */
  readonly scale: number;
  readonly counted: string | null;
}
const norm = (v: string): string => v.normalize("NFC").trim().replace(/[a-z]/g, (c) => c.toUpperCase());

export function CountFlow({ slug, work, initialCode }: { slug: string; work: CountFlowWork; initialCode?: string }) {
  const t = useTranslations("sahaIs");
  const tr = useTranslations("receiving");
  const ts = useTranslations("saha");
  const router = useRouter();
  const holder = useKeyHolder();
  const base = `/t/${encodeURIComponent(slug)}/field`;
  const [stage, setStage, stageRef] = useStateRef<Stage>("location");
  const [target, setTarget, targetRef] = useStateRef<Target | null>(null);
  const [qty, setQty, qtyRef] = useStateRef(0);
  const [qtyText, setQtyText] = useState("");
  const [last, setLast] = useState("");
  const [lastName, setLastName] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [alert, setAlert, alertRef] = useStateRef<AlertState | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [saved, setSaved] = useState<{ item: string; n: number; diff: number | null } | null>(null);
  const [submitted, setSubmitted] = useState(work.sessionStatus === "SUBMITTED");
  const [veil, setVeil] = useState(false);
  const blocked = useCallback(() => busyRef.current || alertRef.current !== null, [alertRef]);
  const alertOf = (titleKey: string, reasonKey: string, code: string): void => setAlert({ titleKey, reasonKey, code });
  const lines = work.lines;
  const counted = lines.filter((l) => l.counted !== null).length;
  const missing = lines.length - counted;

  const begin = useCallback(
    (tgt: Target): void => {
      holder.contentChanged();
      setError(null);
      setTarget(tgt);
      setQty(tgt.barcode === null ? (intOf(tgt.counted) ?? 0) : tgt.step);
      setQtyText(tgt.barcode === null ? (tgt.counted ?? "") : String(tgt.step));
      setStage("qty");
    },
    [holder, lines, setQty, setStage, setTarget],
  );

  const onScanned = useCallback(
    async (raw: string) => {
      if (blocked()) return;
      const code = raw.trim();
      if (code === "") return;
      setLast(code);
      setLastName(undefined);
      setError(null);
      const at = stageRef.current;
      if (at === "location") {
        if (norm(code) !== norm(work.locationCode)) {
          alertOf("alert.mismatchTitle", "wrong_location", "SCAN_MISMATCH");
          return;
        }
        setLastName(work.locationName || work.locationCode);
        feedback.ok();
        setStage("list");
        return;
      }
      const cur = targetRef.current;
      if (at === "qty" && cur !== null && cur.barcode === code) {
        holder.contentChanged();
        setQty(qtyRef.current + cur.step);
        if (cur.scale > 0) setQtyText((prev) => String(Math.round(((Number(prev.replace(",", ".")) || 0) + cur.step) * 1e6) / 1e6));
        setLastName(cur.itemName);
        return;
      }
      busyRef.current = true;
      setBusy(true);
      try {
        const res = await resolveItemScanAction({ slug, code });
        if (!res.ok) {
          alertOf("alert.scanTitle", errorKeyOf(res.error, "scan"), res.error.detail === undefined ? res.error.code : `${res.error.code}/${res.error.detail}`);
          return;
        }
        const r = scanStepOf(res.data, res.data.baseUnitId);
        if (!r.ok) {
          alertOf("alert.unitTitle", "qty_fractional", "QUANTITY_NOT_WHOLE");
          return;
        }
        const mine = lines.filter((l) => l.itemId.toLowerCase() === res.data.itemId.toLowerCase());
        // Aynı ürün rafta birden çok stok durumunda (ör. kullanılabilir + hasarlı): sayı tek duruma sessizce yazılmaz, kullanıcı listeden seçer.
        if (mine.length > 1) {
          alertOf("alert.scanTitle", "multi_status", "MULTI_STATUS");
          return;
        }
        const line = mine[0];
        setLastName(res.data.itemName);
        feedback.ok();
        begin({
          itemId: res.data.itemId,
          itemName: res.data.itemName,
          unitCode: line?.unitCode ?? "",
          stockStatus: line?.stockStatus ?? "AVAILABLE",
          reference: line?.reference ?? null,
          finding: line === undefined,
          barcode: code,
          step: r.step,
          // Rafta satırı olmayan bulguda ürün ölçeği istemcide bilinmez: ondalık alan açılır, ölçek denetimi sunucuda (`QUANTITY_SCALE`; tam sayı ürüne kesir yazılamaz).
          scale: line === undefined ? 6 : line.scale,
          counted: line?.counted ?? null,
        });
      } catch {
        alertOf("alert.networkTitle", "network", "NETWORK");
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [blocked, stageRef, targetRef, qtyRef, holder, setQty, setStage, slug, lines, begin, work.locationCode, work.locationName],
  );
  const scanning = !submitted && (stage === "location" || stage === "list" || stage === "qty");
  const { service: scanner, camera, dropped, clearDropped } = useScanner((v) => void onScanned(v), scanning && alert === null && !busy, blocked);
  const scanPrimary = useScanPrimary(camera, { busy, name: lastName, code: last, alerting: alert !== null });

  const initialDone = useRef(false);
  useEffect(() => {
    if (initialDone.current || initialCode === undefined || initialCode === "") return;
    initialDone.current = true;
    const u = new URL(window.location.href);
    u.searchParams.delete("code");
    window.history.replaceState(null, "", `${u.pathname}${u.search}`);
    void onScanned(initialCode);
  }, [initialCode, onScanned]);
  useEffect(() => {
    if (!veil) return undefined;
    const id = window.setTimeout(() => setVeil(false), 2400);
    return () => window.clearTimeout(id);
  }, [veil]);

  async function save() {
    const tgt = target;
    const decimal = tgt !== null && tgt.scale > 0;
    const value = decimal ? qtyText.trim().replace(",", ".") : String(qty);
    if (busyRef.current || tgt === null || qty < 0 || (decimal && !/^\d{1,12}(?:\.\d{1,6})?$/.test(value))) {
      feedback.error();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const out = await submitWithKey(holder, (clientKey) =>
      recordCountAction({ slug, clientKey, sessionId: work.sessionId, locationId: work.locationId, itemId: tgt.itemId, countedQuantity: value, stockStatus: tgt.stockStatus }),
    );
    busyRef.current = false;
    setBusy(false);
    if (!out.ok) {
      feedback.error();
      setError(out.error);
      return;
    }
    const n = Number(value);
    const ref = tgt.reference === null ? null : Number(tgt.reference);
    const diff = tgt.finding ? n : ref === null ? null : Math.round((n - ref) * 1e6) / 1e6;
    (diff !== null && diff !== 0 ? feedback.warn : feedback.ok)();
    setSaved({ item: tgt.itemName, n, diff });
    setVeil(true);
    setTarget(null);
    setStage("list");
    router.refresh();
  }

  async function submit() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const out = await submitWithKey(holder, (clientKey) => submitCountAction({ slug, clientKey, sessionId: work.sessionId }));
    busyRef.current = false;
    setBusy(false);
    if (!out.ok) {
      feedback.error();
      setError(out.error);
      return;
    }
    feedback.ok();
    setSubmitted(true);
    router.refresh();
  }

  const shell = { hue: "purple" as const, iconD: KICON.mSayim };
  const alertView = (
    <>
      <DroppedNotice show={dropped} alerting={alert !== null} onClose={clearDropped} />
      {alert === null ? null : (
        <ScanAlert
          title={tr(alert.titleKey)}
          reason={alert.reasonKey === "wrong_location" || alert.reasonKey === "multi_status" ? t(`count.${alert.reasonKey}`, { code: work.locationCode }) : tr(`errors.${alert.reasonKey}`, { remaining: "-" })}
          action={alert.reasonKey === "wrong_location" || alert.reasonKey === "multi_status" ? t(`count.${alert.reasonKey}Action`) : tr(`errors.${alert.reasonKey}Action`)}
          {...(alert.code === undefined ? {} : { code: alert.code })}
          onClose={() => {
            setAlert(null);
            clearDropped();
          }}
        />
      )}
    </>
  );
  const withOverlay = (node: React.ReactNode): React.ReactElement => (
    <>
      {node}
      {scanPrimary.overlay}
    </>
  );

  if (stage === "qty" && target !== null) {
    const decimal = target.scale > 0;
    const shown = decimal ? Number(qtyText.trim().replace(",", ".")) : qty;
    const ref = target.reference === null ? null : Number(target.reference);
    const diff = Number.isFinite(shown) ? (target.finding ? shown : ref === null ? null : Math.round((shown - ref) * 1e6) / 1e6) : null;
    return withOverlay(
      <>
        <SahaShell
          {...shell}
          phase={3}
          title={t("count.qtyTitle")}
          instruction={work.locationCode}
          onBack={() => {
            setTarget(null);
            setStage("list");
          }}
          main={{ label: t("count.save"), aria: t("count.saveAria"), d: SICON.check, onClick: () => void save(), disabled: busy, wait: diff !== null && diff !== 0, testId: "flow-primary" }}
        >
          {decimal ? (
            <>
              <div className="job" data-testid="verify-card">
                <span className="uic" style={{ background: dz("8A5A12") }}>
                  <Ico d={SICON.urun} size={22} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <b>{target.itemName}</b>
                  <small>{work.locationCode}</small>
                </span>
              </div>
              <div className="qdisp" data-testid="qty-display">
                <span className="qv">
                  <input
                    aria-label={t("count.qtyLabel")}
                    inputMode="decimal"
                    autoComplete="off"
                    maxLength={20}
                    value={qtyText}
                    data-testid="count-qty-decimal"
                    onChange={(e) => {
                      holder.contentChanged();
                      setQtyText(e.target.value.replace(/[^0-9.,]/g, ""));
                    }}
                    style={{ width: `${Math.max(2, qtyText.length) + 0.4}ch` }}
                  />
                  <span>{target.unitCode}</span>
                </span>
                <small>{work.blind ? t("count.blindLine") : t("count.refLine", { n: target.reference ?? "0", unit: target.unitCode })}</small>
              </div>
            </>
          ) : (
          <SahaQty
            itemName={target.itemName}
            itemSub={work.locationCode}
            {...(target.barcode === null ? {} : { verified: ts("qty.okProduct") })}
            main={{
              label: t("count.qtyLabel"),
              unit: target.unitCode,
              value: qty,
              testId: "count-qty",
              onChange: (n) => {
                holder.contentChanged();
                setQty(n);
              },
            }}
            max={null}
            line={work.blind ? t("count.blindLine") : t("count.refLine", { n: target.reference ?? "0", unit: target.unitCode })}
            overText=""
            hint={t("count.hint")}
          />
          )}
          {target.finding ? <SahaVerdict ok={false} title={t("count.finding")} sound={t("count.findingHint")} /> : null}
          {!target.finding && diff !== null && diff !== 0 ? (
            <div className="vres bad" role="status" data-testid="count-diff-warn">
              <span className="vic">
                <Ico d={SICON.warn} size={34} />
              </span>
              <span>
                <b>{t("count.diffWarn", { n: diff > 0 ? `+${diff}` : String(diff), unit: target.unitCode })}</b>
                <span className="snd">{t("count.diffHint")}</span>
              </span>
            </div>
          ) : null}
          {error === null ? null : <ErrorNotice error={error} context="approve" />}
        </SahaShell>
        {alertView}
      </>,
    );
  }

  if (stage === "list") {
    const allDone = work.progress.total > 0 && work.progress.counted >= work.progress.total;
    const footer = submitted ? (
      <PrimaryLink href={`${base}/tasks`}>{t("toTasks")}</PrimaryLink>
    ) : allDone && work.sessionStatus === "COUNTING" ? (
      <PrimaryButton onClick={() => void submit()} loading={busy}>
        {t("count.submit")}
      </PrimaryButton>
    ) : undefined;
    return withOverlay(
      <>
        <SahaShell
          {...shell}
          phase={2}
          title={t("count.listTitle", { code: work.locationCode })}
          instruction={work.warehouseName}
          onBack={() => setStage("location")}
          scanProxy
          overlay={veil && saved !== null ? <SahaDoneVeil title={t("count.savedVeil", { n: saved.n })} sub={saved.item} /> : null}
          {...(footer === undefined ? { main: { label: ts("okut.scanMain"), aria: tr("flow.scanNow"), d: SICON.scan, onClick: scanPrimary.press, testId: "flow-primary" } } : { footer })}
        >
          {saved === null ? null : saved.diff !== null && saved.diff !== 0 ? (
            <div className="vres bad" role="alert" data-testid="count-saved-diff">
              <span className="vic">
                <Ico d={SICON.warn} size={34} />
              </span>
              <span>
                <b>{t("count.savedDiff", { item: saved.item, n: saved.diff > 0 ? `+${saved.diff}` : String(saved.diff) })}</b>
                <span className="snd">{t("count.diffHint")}</span>
              </span>
            </div>
          ) : (
            <SahaVerdict ok title={t("count.saved", { item: saved.item, n: saved.n })} sound={ts("qty.sound")} />
          )}
          {submitted ? <SahaVerdict ok title={t("count.submitted")} sound={t("count.submittedHint")} /> : null}
          {missing > 0 ? (
            <div className="vres bad" role="status" data-testid="count-missing">
              <span className="vic">
                <Ico d={SICON.warn} size={34} />
              </span>
              <span>
                <b>{t("count.missing", { n: missing })}</b>
                <span className="snd">{t("count.missingHint")}</span>
              </span>
            </div>
          ) : lines.length > 0 ? (
            <SahaVerdict ok title={t("count.rackDone")} sound={t("count.progress", { c: work.progress.counted, n: work.progress.total })} />
          ) : null}
          <ul className="m-0 flex min-w-0 list-none flex-col gap-2 p-0" aria-label={t("count.listLabel")}>
            {lines.map((l) => (
              <li key={l.lineId} className="flex min-w-0">
                <button
                  type="button"
                  className="job w-full"
                  data-testid="count-line"
                  data-counted={l.counted === null ? "false" : "true"}
                  disabled={submitted || busy}
                  onClick={() => {
                    feedback.minor();
                    begin({ itemId: l.itemId, itemName: l.itemName, unitCode: l.unitCode, stockStatus: l.stockStatus, reference: l.reference, finding: false, barcode: null, step: 1, scale: l.scale, counted: l.counted });
                  }}
                >
                  <span className="uic" style={{ background: dz(l.counted === null ? "8A5A12" : "2F7D5B") }}>
                    <Ico d={l.counted === null ? SICON.urun : SICON.check} size={22} />
                  </span>
                  <span style={{ minWidth: 0, textAlign: "left" }}>
                    <b>{l.itemName}</b>
                    <small>
                      {l.itemCode}
                      {l.stockStatus === "AVAILABLE" ? "" : ` · ${t(`count.status.${l.stockStatus}`)}`}
                    </small>
                  </span>
                  <span className="autosel">{l.counted === null ? t("count.notCounted") : `${l.counted} ${l.unitCode}`}</span>
                </button>
              </li>
            ))}
          </ul>
          {submitted ? null : (
            <ScanPanel service={scanner} prompt={busy ? tr("flow.checking") : t("count.itemPrompt")} last={last} {...(lastName === undefined ? {} : { lastName })} ready={scanPrimary.ready && last === ""} hue="teal" />
          )}
          {error === null ? null : <ErrorNotice error={error} context="approve" />}
        </SahaShell>
        {alertView}
      </>,
    );
  }

  return withOverlay(
    <>
      <SahaShell
        {...shell}
        phase={1}
        title={t("count.locationTitle")}
        instruction={work.warehouseName}
        backHref={`${base}/tasks`}
        scanProxy
        main={{ label: ts("okut.scanMain"), aria: tr("flow.scanNow"), d: SICON.scan, onClick: scanPrimary.press, testId: "flow-primary" }}
      >
        <div className="job" data-testid="count-card">
          <span className="uic" style={{ background: dz("6C4BD8") }}>
            <Ico d={KICON.mSayim} size={22} />
          </span>
          <span style={{ minWidth: 0 }}>
            <b>{work.locationName || work.locationCode}</b>
            <small>{t("count.cardLine", { code: work.locationCode, n: lines.length })}</small>
          </span>
          {work.blind ? <span className="autosel">{t("count.blind")}</span> : null}
        </div>
        <ScanPanel service={scanner} prompt={busy ? tr("flow.checking") : t("count.locationPrompt", { code: work.locationCode })} last={last} {...(lastName === undefined ? {} : { lastName })} ready={scanPrimary.ready && last === ""} hue="teal" />
      </SahaShell>
      {alertView}
    </>,
  );
}
