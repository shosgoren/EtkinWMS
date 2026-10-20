"use client";
// Saha kabulü (T-313; T-969 Saha kalıbı): okut → doğrula → miktar onayla → bitti. Görünüm KalipSaha.dc.html (a)(b)(c): ortak çerçeve
// (`SahaShell`), 3 adımlı çubuk, ana işlem alt çubuğun ortasında (OKUT / ONAYLA), büyük sayı + sayı tuşları + TÜMÜ, fazla miktarda turuncu
// uyarı, başarı perdesi. Akış mantığı T-313 ile AYNI: yanlış tarama tam ekran uyarı (N-13), koli okutunca koli içi adet (K-1), aynı tikte
// ikinci okuma tek çözüm; yetki, fazla kabul ve durum kuralları domain'dedir (`receiveGoods`), idempotency anahtarı `submitWithKey`.
// OKUT ekranından `?code=` ile gelinirse okutulan kod açılışta bir kez işlenir (aynı yol: `onScanned`).
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { SICON } from "../../../../design/saha-icons.ts";
import { dz } from "../../../../design/saha-tokens.ts";
import { ErrorNotice, LineStatus, errorKeyOf, intOf, scanMismatch, submitWithKey, useKeyHolder, type ErrorInfo, type ReceiptDetail, type ReceiptLineView } from "../../receipts/receipt-form.tsx";
import { receiveGoodsAction, resolveItemScanAction } from "../../receipts/actions.ts";
import { CompoundLine, DroppedNotice, PrimaryButton, PrimaryLink, ScanAlert, ScanPanel, isBaseUnit, scanStepOf, useScanPrimary, useScanner, useStateRef, type AlertState } from "./receive-flow.tsx";
import { Ico, SahaDoneVeil, SahaShell, tone } from "../saha-shell.tsx";
import { SahaQty } from "../saha-qty.tsx";

type Stage = "scan" | "qty" | "done";
interface Picked {
  readonly line: ReceiptLineView;
  /** Satır birimi temel birim mi: öyleyse `received` temel birimdedir ve bileşik gösterim (koli + adet) anlamlıdır. */
  readonly lineIsBase: boolean;
  readonly received: number;
  readonly damaged: number;
  readonly locationId: string;
}
interface Done {
  readonly itemName: string;
  readonly unitName: string;
  readonly received: number;
  readonly damaged: number;
  readonly remaining: number | null;
}

export function ReceiveFlow({ slug, receipt, initialCode }: { slug: string; receipt: ReceiptDetail; initialCode?: string }) {
  const t = useTranslations("receiving");
  const ts = useTranslations("saha");
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const holder = useKeyHolder();
  // `stage`/`picked` ref'le de okunur: aynı tikte ardışık okumalar eski kapanıştan değil güncel durumdan hesaplanır (koli artışı kaybolmaz).
  const [stage, setStage, stageRef] = useStateRef<Stage>("scan");
  const [picked, setPicked, pickedRef] = useStateRef<Picked | null>(null);
  const busyRef = useRef(false);
  const [showDamaged, setShowDamaged] = useState(false);
  const [last, setLast] = useState("");
  const [lastName, setLastName] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert, alertRef] = useStateRef<AlertState | null>(null);
  // Akış kapısı (ref'ten, eşzamanlı): `onScanned` ile tarama servisi/kamera aynı işlevi kullanır.
  const blocked = useCallback(() => busyRef.current || alertRef.current !== null || stageRef.current === "done", [alertRef, stageRef]);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [veil, setVeil] = useState(false);

  const base = `/t/${encodeURIComponent(slug)}/field/receive`;
  const open = receipt.lines.filter((l) => intOf(l.open) !== 0);
  const warn = useCallback(
    (a: AlertState) => {
      tone("err");
      setAlert(a);
    },
    [setAlert],
  );

  const onScanned = useCallback(
    async (code: string) => {
      // Eşzamanlı tek çözüm: bayrak ref'tedir (yeniden çizim beklemez); aynı tikteki ikinci okuma kapıda düşer ve bildirilir (`useScanner`).
      if (blocked()) return;
      busyRef.current = true;
      setLast(code);
      setLastName(undefined);
      setBusy(true);
      setError(null);
      try {
        let res: Awaited<ReturnType<typeof resolveItemScanAction>>;
        try {
          res = await resolveItemScanAction({ slug, code });
        } catch {
          warn({ titleKey: "alert.networkTitle", reasonKey: "network", code: "NETWORK" });
          return;
        }
        if (!res.ok) {
          const key = errorKeyOf(res.error, "scan");
          warn({ titleKey: "alert.scanTitle", reasonKey: key, code: res.error.detail === undefined ? res.error.code : `${res.error.code}/${res.error.detail}` });
          return;
        }
        const itemId = res.data.itemId;
        const lines = receipt.lines;
        if (scanMismatch(itemId, lines.map((l) => l.itemId))) {
          warn({ titleKey: "alert.mismatchTitle", reasonKey: "scan_mismatch", code: "SCAN_MISMATCH" });
          return;
        }
        const line = lines.filter((l) => intOf(l.open) !== 0).find((l) => l.itemId === itemId);
        if (line === undefined) {
          warn({ titleKey: "alert.mismatchTitle", reasonKey: "line_done", code: "LINE_COMPLETE" });
          return;
        }
        setLastName(line.itemName);
        const max = intOf(line.open);
        // Okutma başına adım (K-1): satır temel birimdeyse `baseQuantity` (koli okutunca koli içi adet), satır birimi barkod birimiyse okutma başına miktar; kesirli ise uyarı.
        const stepRes = scanStepOf(res.data, line.unitId);
        if (!stepRes.ok) {
          warn(stepRes.reason === "unit" ? { titleKey: "alert.unitTitle", reasonKey: "unit_mismatch", code: "UNIT_MISMATCH" } : { titleKey: "alert.unitTitle", reasonKey: "qty_fractional", code: "QUANTITY_NOT_WHOLE" });
          return;
        }
        const step = stepRes.step;
        const cur = pickedRef.current;
        if (stageRef.current === "qty" && cur !== null && cur.line.id === line.id) {
          // Aynı ürünün koli barkodu yeniden okutuldu: adet eklenir (iki koli = iki katı).
          holder.contentChanged();
          tone("ok");
          setPicked({ ...cur, received: Math.min(max ?? Infinity, cur.received + step) });
          return;
        }
        if (stageRef.current === "qty" && cur !== null) {
          warn({ titleKey: "alert.mismatchTitle", reasonKey: "finish_first", code: "SCAN_MISMATCH" });
          return;
        }
        holder.contentChanged();
        setShowDamaged(false);
        tone("ok");
        setPicked({ line, lineIsBase: isBaseUnit(line.unitId, res.data.baseUnitId), received: Math.max(1, Math.min(max ?? Infinity, step)), damaged: 0, locationId: receipt.receivingLocations[0]?.id ?? "" });
        setStage("qty");
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [slug, receipt, holder, setPicked, setStage, warn, pickedRef, stageRef, blocked],
  );
  const { service: scanner, camera, dropped, clearDropped } = useScanner((v) => void onScanned(v), stage !== "done" && alert === null && !busy, blocked);
  const scanPrimary = useScanPrimary(camera, { busy, name: lastName, code: last, alerting: alert !== null });

  // OKUT ekranından gelen kod: açılışta bir kez, aynı okuma yolundan işlenir; adres temizlenir (yenileme aynı kodu ikinci kez saymaz).
  const initialDone = useRef(false);
  useEffect(() => {
    if (initialDone.current || initialCode === undefined || initialCode === "" || receipt.receivingLocations.length === 0) return;
    initialDone.current = true;
    window.history.replaceState(null, "", `${base}?receipt=${encodeURIComponent(receipt.id)}`);
    void onScanned(initialCode);
  }, [initialCode, onScanned, base, receipt.id, receipt.receivingLocations.length]);

  useEffect(() => {
    if (!veil) return undefined;
    const id = window.setTimeout(() => setVeil(false), 2400);
    return () => window.clearTimeout(id);
  }, [veil]);

  async function confirm() {
    if (picked === null || busyRef.current) return;
    const max = intOf(picked.line.open);
    if (picked.received < 1 || (max !== null && picked.received > max)) {
      tone("err");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const out = await submitWithKey(holder, (clientKey) =>
      receiveGoodsAction({
        slug,
        clientKey,
        receiptId: receipt.id,
        lines: [
          {
            lineId: picked.line.id,
            received: String(picked.received),
            ...(picked.damaged > 0 ? { damaged: String(picked.damaged) } : {}),
            locationId: picked.locationId,
          },
        ],
      }),
    );
    busyRef.current = false;
    setBusy(false);
    if (!out.ok) {
      tone("err");
      setError(out.error);
      return;
    }
    const open0 = intOf(picked.line.open);
    tone("ok");
    setDone({
      itemName: picked.line.itemName,
      unitName: picked.line.unitName,
      received: picked.received,
      damaged: picked.damaged,
      remaining: open0 === null ? null : Math.max(open0 - picked.received, 0),
    });
    setVeil(true);
    setStage("done");
    startTransition(() => router.refresh());
  }

  const alertView = (
    <>
      <DroppedNotice show={dropped} alerting={alert !== null} onClose={clearDropped} />
      {alert === null ? null : (
        <ScanAlert
          title={t(alert.titleKey)}
          reason={t(`errors.${alert.reasonKey}`, { remaining: "-" })}
          action={t(`errors.${alert.reasonKey}Action`)}
          {...(alert.code === undefined ? {} : { code: alert.code })}
          onClose={() => {
            setAlert(null);
            clearDropped();
          }}
        />
      )}
    </>
  );

  const sub = `${receipt.number}${receipt.supplierRef === null ? "" : ` · ${receipt.supplierRef}`}`;
  const shell = { hue: "green" as const, iconD: SICON.kabul };
  // Kamera katmanı aşama değişse de aynı konumda (kök parça, 2. çocuk) kalır: okunan ürün adı katmanda görünür, kamera yeniden açılmaz.
  const withOverlay = (node: React.ReactNode): React.ReactElement => (
    <>
      {node}
      {scanPrimary.overlay}
    </>
  );
  if (receipt.receivingLocations.length === 0) {
    return (
      <SahaShell {...shell} step={2} total={4} title={t("flow.noLocationTitle")} instruction={sub} backHref={base} footer={<PrimaryLink href={base}>{t("flow.otherReceipt")}</PrimaryLink>}>
        <p className="sflowmsg" role="alert">
          {t("flow.noLocation")} {t("flow.noLocationAction")}
        </p>
      </SahaShell>
    );
  }

  if (stage === "done" && done !== null) {
    const finished = open.length === 0 || (done.remaining === 0 && open.length <= 1);
    return withOverlay(
      <>
        <SahaShell
          {...shell}
          step={4}
          total={4}
          phase={4}
          title={t("flow.savedTitle")}
          instruction={sub}
          backHref={base}
          overlay={veil ? <SahaDoneVeil title={ts("qty.done", { n: done.received, unit: done.unitName })} sub={ts("qty.doneNext")} /> : null}
          footer={finished ? <PrimaryLink href={base}>{t("flow.otherReceipt")}</PrimaryLink> : <PrimaryButton loading={refreshing} onClick={() => setStage("scan")}>{t("flow.nextItem")}</PrimaryButton>}
        >
          <div className="pcard" data-testid="saved-card">
            <div className="cmp">
              <div className="cm ok">
                <small>{t("flow.savedTitle")}</small>
                <b data-testid="saved-summary">{t("flow.saved", { name: done.itemName, received: done.received })}</b>
                {done.damaged > 0 ? <em>{t("flow.savedDamaged", { n: done.damaged })}</em> : null}
                {done.remaining === null || done.remaining === 0 ? null : <em>{t("flow.savedRemaining", { n: done.remaining })}</em>}
              </div>
            </div>
          </div>
          {finished ? (
            <div className="vres ok" role="status">
              <span className="vic">
                <Ico d={SICON.check} size={34} />
              </span>
              <span>
                <b>{t("flow.receiptDone")}</b>
              </span>
            </div>
          ) : (
            <p className="okgo">{t("flow.openStays")}</p>
          )}
        </SahaShell>
        {alertView}
      </>
    );
  }

  if (stage === "qty" && picked !== null) {
    const max = intOf(picked.line.open);
    const over = max !== null && picked.received > max;
    const rack =
      receipt.receivingLocations.length > 1 ? (
        <fieldset className="rack m-0 border-0 p-0" data-testid="rack-choice">
          <legend className="sr">{t("flow.rackLabel")}</legend>
          <p>{t("flow.rackLabel")}</p>
          <div className="chips" data-testid="rack-chips">
            {receipt.receivingLocations.map((l) => (
              <button
                key={l.id}
                type="button"
                aria-pressed={picked.locationId === l.id}
                onClick={() => {
                  tone("tap");
                  holder.contentChanged();
                  setPicked({ ...picked, locationId: l.id });
                }}
              >
                {l.name}
              </button>
            ))}
          </div>
        </fieldset>
      ) : (
        <p className="rackauto" data-testid="rack-auto">
          {t("flow.rackAuto", { name: receipt.receivingLocations[0]?.name ?? "" })}
        </p>
      );
    return withOverlay(
      <>
        <SahaShell
          {...shell}
          step={3}
          total={4}
          phase={3}
          title={t("flow.qtyTitle")}
          instruction={sub}
          onBack={() => {
            setPicked(null);
            setStage("scan");
            setError(null);
          }}
          main={{ label: ts("qty.confirm"), aria: t("flow.confirm"), d: SICON.check, onClick: () => void confirm(), disabled: busy || picked.received < 1, wait: over, testId: "flow-primary" }}
        >
          <SahaQty
            itemName={picked.line.itemName}
            itemSub={`${picked.line.itemCode} · ${receipt.number}`}
            verified={ts("qty.okProduct")}
            main={{
              label: t("flow.received", { unit: picked.line.unitName }),
              unit: picked.line.unitName,
              value: picked.received,
              onChange: (n) => {
                holder.contentChanged();
                setPicked({ ...picked, received: n, damaged: Math.min(picked.damaged, n) });
              },
            }}
            second={
              showDamaged
                ? {
                    label: t("flow.damagedLabel"),
                    value: picked.damaged,
                    onChange: (n) => {
                      holder.contentChanged();
                      setPicked({ ...picked, damaged: Math.min(n, picked.received) });
                    },
                  }
                : null
            }
            max={max}
            line={ts("qty.expected", { e: String(intOf(picked.line.expected) ?? picked.line.expected), k: String(max ?? picked.line.open) })}
            overText={ts("qty.over", { n: String(max ?? picked.line.open) })}
            compound={picked.lineIsBase ? <CompoundLine slug={slug} itemId={picked.line.itemId} baseQty={picked.received} /> : null}
            side={
              <>
                <button type="button" className="qbtn" aria-label={t("flow.scanMore")} title={t("flow.scanMore")} data-testid="scan-more" onClick={scanPrimary.press}>
                  <Ico d={SICON.scan} size={22} />
                </button>
                <button
                  type="button"
                  className="qbtn"
                  aria-label={t("flow.hasDamaged")}
                  aria-pressed={showDamaged}
                  onClick={() => {
                    tone("tap");
                    holder.contentChanged();
                    setShowDamaged(true);
                  }}
                >
                  <Ico d={SICON.warn} size={22} />
                </button>
              </>
            }
            between={rack}
            hint={ts("qty.hint")}
          />
          {error === null ? null : <ErrorNotice error={error} context="receive" remaining={String(max ?? picked.line.open)} />}
        </SahaShell>
        {alertView}
      </>
    );
  }

  // Tarama adımı (ya da tüm satırlar tamamsa bitiş).
  if (open.length === 0) {
    return withOverlay(
      <SahaShell {...shell} step={4} total={4} phase={4} title={t("flow.receiptDone")} instruction={sub} backHref={base} footer={<PrimaryLink href={base}>{t("flow.otherReceipt")}</PrimaryLink>}>
        <p className="sflowmsg">{t("flow.allDone")}</p>
      </SahaShell>,
    );
  }
  return withOverlay(
    <>
      <SahaShell
        {...shell}
        step={2}
        total={4}
        phase={1}
        title={t("flow.scanTitle")}
        instruction={sub}
        backHref={base}
        scanProxy
        main={{ label: ts("okut.scanMain"), aria: t("flow.scanNow"), d: SICON.scan, onClick: scanPrimary.press, testId: "flow-primary" }}
      >
        <ScanPanel service={scanner} prompt={busy ? t("flow.checking") : t("flow.scanPrompt")} last={last} {...(lastName === undefined ? {} : { lastName })} ready={scanPrimary.ready && last === ""} hue="green" />
        <section aria-label={t("flow.expectedItems")} className="flex min-w-0 flex-col gap-2">
          <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="expected-lines">
            {receipt.lines.map((l) => (
              <li key={l.id} className="job">
                <span className="uic" style={{ background: dz("8A5A12") }}>
                  <Ico d={SICON.urun} size={22} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <b>{l.itemName}</b>
                  <LineStatus expected={l.expected} received={l.received} damaged={l.damaged} open={l.open} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      </SahaShell>
      {alertView}
    </>
  );
}
