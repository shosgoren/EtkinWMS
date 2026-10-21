"use client";
// T-977 (B-52 saha): saha toplama — Okut (raf) → Okut (ürün) → Doğrula → Miktar → Onayla. Kural, kilit (I-15) ve idempotency (I-06) `confirmPick`
// komutundadır (sunucu eylemi `confirmShippingPickAction`); bu dosya yalnız girdi toplar: raf kodu görevdeki rafla, ürün barkodu görevdeki ürünle
// (önizleme `previewShippingPickAction`, salt okuma) eşleşmeden miktar adımı açılmaz. Miktar OKUTULAN BARKODUN birimindedir (A-307-2: koli barkodu →
// koli sayısı); ekran temel birim karşılığını gösterir. Beklenenden azı "eksik" uyarısıdır (sunucu eksik kısmı serbest bırakır, rafı sayıma alır);
// fazlası engellenir. Anahtar yaşam döngüsü `useKeyHolder` (aynı içerik → aynı anahtar; ağ hatasında yeniden deneme önceki sonucu döndürür).
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { KICON } from "../../../../design/kabuk-icons.ts";
import { dz } from "../../../../design/kalip-saha-tokens.ts";
import { SICON } from "../../../../design/saha-icons.ts";
import { ErrorNotice, errorKeyOf, intOf, submitWithKey, useKeyHolder, type ErrorInfo } from "../../receipts/receipt-form.tsx";
import { confirmShippingPickAction, previewShippingPickAction } from "../../shipping/actions.ts";
import { DroppedNotice, PrimaryLink, ScanAlert, ScanPanel, useScanPrimary, useScanner, useStateRef, type AlertState } from "../receive/receive-flow.tsx";
import { Ico, SahaDoneVeil, SahaShell, SahaVerdict, tone } from "../saha-shell.tsx";
import { SahaQty } from "../saha-qty.tsx";

export interface PickFlowWork {
  readonly taskId: string;
  readonly quantity: string;
  readonly itemName: string;
  readonly itemCode: string;
  readonly unitCode: string;
  readonly locationCode: string;
  readonly locationName: string;
  readonly stagingName: string | null;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly customerRef: string | null;
  readonly nextTaskId: string | null;
  readonly remaining: number;
}
type Stage = "location" | "item" | "qty" | "done";
/** Kod karşılaştırması: kırp + NFC + ASCII büyük harf (sunucudaki `normalizeCode` ile aynı; asıl denetim sunucuda). */
const norm = (v: string): string => v.normalize("NFC").trim().replace(/[a-z]/g, (c) => c.toUpperCase());

export function PickFlow({ slug, work, initialCode }: { slug: string; work: PickFlowWork; initialCode?: string }) {
  const t = useTranslations("sahaIs");
  const tr = useTranslations("receiving");
  const ts = useTranslations("saha");
  const holder = useKeyHolder();
  const base = `/t/${encodeURIComponent(slug)}/field`;
  const expected = intOf(work.quantity);
  const [stage, setStage, stageRef] = useStateRef<Stage>("location");
  const [locCode, setLocCode] = useState("");
  const [barcode, setBarcode, barcodeRef] = useStateRef("");
  const [perScan, setPerScan, perScanRef] = useStateRef<number | null>(null);
  const [qty, setQty, qtyRef] = useStateRef(0);
  const [last, setLast] = useState("");
  const [lastName, setLastName] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [alert, setAlert, alertRef] = useStateRef<AlertState | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [result, setResult] = useState<{ base: number; short: string | null } | null>(null);
  const [veil, setVeil] = useState(false);
  const blocked = useCallback(() => busyRef.current || alertRef.current !== null || stageRef.current === "done", [alertRef, stageRef]);
  const alertOf = (titleKey: string, reasonKey: string, code: string): void => setAlert({ titleKey, reasonKey, code });

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
        holder.contentChanged();
        setLocCode(code);
        setLastName(work.locationName || work.locationCode);
        setStage("item");
        return;
      }
      // Miktar adımında aynı barkod yeniden okutulursa adet artar (başka barkod: yeniden doğrulama).
      if (at === "qty" && code === barcodeRef.current) {
        const max = expected === null || perScanRef.current === null ? null : Math.floor(expected / perScanRef.current);
        holder.contentChanged();
        setQty(max === null ? qtyRef.current + 1 : Math.min(max, qtyRef.current + 1));
        setLastName(work.itemName);
        return;
      }
      busyRef.current = true;
      setBusy(true);
      try {
        const res = await previewShippingPickAction({ slug, taskId: work.taskId, barcode: code, quantity: "1" });
        if (!res.ok) {
          const mismatch = res.error.detail === "SCAN_MISMATCH" || res.error.code === "NOT_FOUND";
          alertOf(mismatch ? "alert.mismatchTitle" : "alert.scanTitle", mismatch ? "wrong_item" : errorKeyOf(res.error, "scan"), res.error.detail === undefined ? res.error.code : `${res.error.code}/${res.error.detail}`);
          return;
        }
        const step = intOf(res.data.baseQuantity);
        const max = expected === null || step === null || step < 1 ? null : Math.floor(expected / step);
        if (step === null || step < 1 || max === null || max < 1) {
          alertOf("alert.unitTitle", "pack_too_big", "QUANTITY_SCALE");
          return;
        }
        holder.contentChanged();
        setBarcode(code);
        setPerScan(step);
        setQty(max);
        setLastName(work.itemName);
        tone("ok");
        setStage("qty");
      } catch {
        alertOf("alert.networkTitle", "network", "NETWORK");
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [blocked, stageRef, barcodeRef, perScanRef, qtyRef, expected, holder, setStage, setBarcode, setPerScan, setQty, slug, work],
  );
  const scanning = stage === "location" || stage === "item" || stage === "qty";
  const { service: scanner, camera, dropped, clearDropped } = useScanner((v) => void onScanned(v), scanning && alert === null && !busy, blocked);
  const scanPrimary = useScanPrimary(camera, { busy, name: lastName, code: last, alerting: alert !== null });

  // OKUT ekranından gelen raf kodu açılışta bir kez aynı okuma yolundan işlenir; adres temizlenir.
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

  const maxScans = expected === null || perScan === null ? null : Math.floor(expected / perScan);
  const baseQty = perScan === null ? 0 : qty * perScan;
  const short = expected === null ? 0 : expected - baseQty;

  async function confirm() {
    if (busyRef.current || stage !== "qty" || maxScans === null || qty > maxScans || qty < 0) {
      tone("err");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const out = await submitWithKey(holder, (clientKey) =>
      confirmShippingPickAction({ slug, clientKey, taskId: work.taskId, foundQuantity: String(qty), scannedLocationCode: locCode, scannedItemBarcode: barcode }),
    );
    busyRef.current = false;
    setBusy(false);
    if (!out.ok) {
      tone("err");
      if (out.error.detail === "SCAN_MISMATCH") {
        alertOf("alert.mismatchTitle", "wrong_item", "SCAN_MISMATCH");
        setStage("location");
        return;
      }
      setError(out.error);
      return;
    }
    tone(out.data.notFound === undefined ? "ok" : "err");
    setResult({ base: baseQty, short: out.data.notFound?.shortQuantity ?? null });
    setVeil(true);
    setStage("done");
  }

  const shell = { hue: "orange" as const, iconD: KICON.mTopla };
  // Ondalık görev miktarı (ör. 2,5 kg): sayı tuşları tam sayıdır → sahada sessizce yuvarlanmaz, masaüstü Sevkiyat ekranına yönlendirilir.
  if (expected === null) {
    return (
      <SahaShell {...shell} title={t("pick.decimalTitle")} instruction={work.orderNumber} backHref={`${base}/tasks`} footer={<PrimaryLink href={`/t/${encodeURIComponent(slug)}/shipping?${new URLSearchParams({ id: work.orderId })}`}>{t("pick.toDesk")}</PrimaryLink>}>
        <p className="break-words text-lg text-ink" data-testid="pick-message">
          {t("pick.decimal", { qty: work.quantity, unit: work.unitCode })}
        </p>
      </SahaShell>
    );
  }
  const taskCard = (verified: boolean) => (
    <div className="job" data-testid="pick-card">
      <span className="uic" style={{ background: dz("B85A14") }}>
        <Ico d={SICON.urun} size={22} />
      </span>
      <span style={{ minWidth: 0 }}>
        <b>{work.itemName}</b>
        <small>{t("pick.line", { qty: work.quantity.replace(/\.0+$/, ""), unit: work.unitCode, from: work.locationCode })}</small>
      </span>
      {verified ? <span className="autosel">{ts("qty.okProduct")}</span> : null}
    </div>
  );
  const alertView = (
    <>
      <DroppedNotice show={dropped} alerting={alert !== null} onClose={clearDropped} />
      {alert === null ? null : (
        <ScanAlert
          title={tr(alert.titleKey)}
          reason={alert.reasonKey === "wrong_location" || alert.reasonKey === "wrong_item" || alert.reasonKey === "pack_too_big" ? t(`pick.${alert.reasonKey}`, { code: work.locationCode }) : tr(`errors.${alert.reasonKey}`, { remaining: "-" })}
          action={alert.reasonKey === "wrong_location" || alert.reasonKey === "wrong_item" || alert.reasonKey === "pack_too_big" ? t(`pick.${alert.reasonKey}Action`) : tr(`errors.${alert.reasonKey}Action`)}
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

  if (stage === "done" && result !== null) {
    const nextHref = work.nextTaskId === null ? `${base}/ship?${new URLSearchParams({ order: work.orderId })}` : `${base}/pick?${new URLSearchParams({ task: work.nextTaskId })}`;
    return withOverlay(
      <>
        <SahaShell
          {...shell}
          phase={4}
          title={t("pick.doneTitle")}
          instruction={work.orderNumber}
          overlay={veil ? <SahaDoneVeil title={t("pick.doneVeil", { n: result.base })} sub={work.stagingName ?? ""} /> : null}
          footer={<PrimaryLink href={nextHref}>{work.nextTaskId === null ? t("pick.toShip") : t("pick.next", { n: work.remaining })}</PrimaryLink>}
        >
          {taskCard(true)}
          {result.base === 0 ? null : <SahaVerdict ok title={t("pick.moved", { n: result.base, unit: work.unitCode, to: work.stagingName ?? "-" })} sound={ts("qty.sound")} />}
          {result.short === null ? null : (
            <div className="vres bad" role="alert" data-testid="pick-short">
              <span className="vic">
                <Ico d={SICON.warn} size={34} />
              </span>
              <span>
                <b>{t("pick.shortDone", { n: result.short.replace(/\.0+$/, "") })}</b>
                <span className="snd">{t("pick.shortHint")}</span>
              </span>
            </div>
          )}
          <a className="more" href={`${base}/tasks`}>
            {t("toTasks")}
          </a>
        </SahaShell>
        {alertView}
      </>,
    );
  }

  if (stage === "qty" && perScan !== null && maxScans !== null) {
    return withOverlay(
      <>
        <SahaShell
          {...shell}
          phase={3}
          title={t("pick.qtyTitle")}
          instruction={work.orderNumber}
          onBack={() => {
            holder.contentChanged();
            setStage("item");
          }}
          main={{ label: ts("qty.confirm"), aria: t("pick.confirm"), d: SICON.check, onClick: () => void confirm(), disabled: busy || qty > maxScans, wait: short > 0, testId: "flow-primary" }}
        >
          <SahaQty
            itemName={work.itemName}
            itemSub={t("pick.route", { from: work.locationCode, to: work.stagingName ?? "-" })}
            verified={ts("qty.okProduct")}
            main={{
              label: t("pick.qtyLabel"),
              unit: perScan === 1 ? work.unitCode : t("pick.packUnit", { n: perScan, unit: work.unitCode }),
              value: qty,
              testId: "pick-qty",
              onChange: (n) => {
                holder.contentChanged();
                setQty(n);
              },
            }}
            max={maxScans}
            line={t("pick.expected", { n: expected ?? 0, unit: work.unitCode, base: baseQty })}
            overText={t("pick.over", { n: maxScans })}
            hint={t("pick.hint")}
          />
          {short > 0 && qty <= maxScans ? (
            <div className="vres bad" role="status" data-testid="pick-short-warn">
              <span className="vic">
                <Ico d={SICON.warn} size={34} />
              </span>
              <span>
                <b>{t("pick.shortWarn", { n: short, unit: work.unitCode })}</b>
                <span className="snd">{t("pick.shortHint")}</span>
              </span>
            </div>
          ) : null}
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
        phase={stage === "location" ? 1 : 2}
        title={t(stage === "location" ? "pick.locationTitle" : "pick.itemTitle")}
        instruction={work.orderNumber}
        {...(stage === "location" ? { backHref: `${base}/tasks` } : { onBack: () => setStage("location") })}
        scanProxy
        main={{ label: ts("okut.scanMain"), aria: tr("flow.scanNow"), d: SICON.scan, onClick: scanPrimary.press, testId: "flow-primary" }}
      >
        {taskCard(false)}
        {stage === "item" ? <SahaVerdict ok title={t("pick.locationOk", { code: work.locationCode })} sound={ts("qty.sound")} /> : null}
        <ScanPanel
          service={scanner}
          prompt={busy ? tr("flow.checking") : t(stage === "location" ? "pick.locationPrompt" : "pick.itemPrompt", { code: work.locationCode })}
          last={last}
          {...(lastName === undefined ? {} : { lastName })}
          ready={scanPrimary.ready && last === ""}
          hue="teal"
        />
      </SahaShell>
      {alertView}
    </>,
  );
}
