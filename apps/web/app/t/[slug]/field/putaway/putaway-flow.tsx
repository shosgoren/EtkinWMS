"use client";
// Saha yerleştirme (T-313): [kaynak (KABUL) →] ürün okut → hedef lokasyon okut → onay → bitti. `PUTAWAY` görevinden (miktar ve ürün görevle birebir:
// poka-yoke, A-305-7) ya da serbest başlar. Yetki, sayım kilidi (`LOCATION_LOCKED`), hedef lokasyon türü ve stok kuralları domain'dedir (`putaway`);
// bu dosya yalnızca girdi toplar ve sunucu hatasını (kod + sonraki eylem) gösterir. Ortak saha parçaları `receive-flow.tsx`'tedir.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { KICON } from "../../../../design/kabuk-icons.ts";
import { dz } from "../../../../design/kalip-saha-tokens.ts";
import { SICON } from "../../../../design/saha-icons.ts";
import { ErrorNotice, errorKeyOf, intOf, scanMismatch, submitWithKey, useKeyHolder, type ErrorInfo } from "../../receipts/receipt-form.tsx";
import { availableAtLocationAction, putawayAction, resolveItemScanAction, resolveLocationScanAction } from "../../receipts/actions.ts";
import { CompoundLine, DroppedNotice, PrimaryButton, PrimaryLink, ScanAlert, ScanPanel, scanStepOf, useScanPrimary, useScanner, useStateRef, type AlertState } from "../receive/receive-flow.tsx";
import { Ico, SahaDoneVeil, SahaShell } from "../saha-shell.tsx";
import { SahaQty } from "../saha-qty.tsx";
import { feedback } from "@wms/ui";

export interface PutawayTask {
  readonly id: string;
  readonly itemId: string;
  readonly itemName: string;
  readonly itemCode: string;
  readonly quantity: string;
  readonly sourceId: string;
  readonly sourceCode: string;
  readonly sourceName: string;
}
type Stage = "source" | "item" | "target" | "confirm" | "done";
interface Loc {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}
interface Item {
  readonly id: string;
  readonly name: string;
  readonly code: string;
}

export function PutawayFlow({ slug, warehouseId, task, initialCode }: { slug: string; warehouseId: string; task: PutawayTask | null; initialCode?: string }) {
  const t = useTranslations("receiving");
  const ts = useTranslations("saha");
  const [veil, setVeil] = useState(false);
  const holder = useKeyHolder();
  const fieldHome = `/t/${encodeURIComponent(slug)}/field`;
  const tasksHref = `${fieldHome}/tasks`;
  const total = task === null ? 5 : 4;
  const first: Stage = task === null ? "source" : "item";
  // Okumayla değişen durum ref'le de okunur: aynı tikte ardışık okumalar eski kapanıştan değil güncel durumdan hesaplanır (koli artışı kaybolmaz).
  const [stage, setStage, stageRef] = useStateRef<Stage>(first);
  const [source, setSource, sourceRef] = useStateRef<Loc | null>(task === null ? null : { id: task.sourceId, code: task.sourceCode, name: task.sourceName });
  const [item, setItem, itemRef] = useStateRef<Item | null>(task === null ? null : { id: task.itemId, name: task.itemName, code: task.itemCode });
  const [target, setTarget] = useState<Loc | null>(null);
  const [qty, setQty, qtyRef] = useStateRef(intOf(task?.quantity) ?? 1);
  const [avail, setAvail, availRef] = useStateRef<number | null>(null);
  const busyRef = useRef(false);
  const [last, setLast] = useState("");
  const [lastName, setLastName] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert, alertRef] = useStateRef<(AlertState & { back?: Stage }) | null>(null);
  // Akış kapısı (ref'ten, eşzamanlı): `onScanned` ile tarama servisi/kamera aynı işlevi kullanır; onay ekranında okuma yalnız görevsiz yerleştirmede açıktır.
  const blocked = useCallback(() => {
    const at = stageRef.current;
    const open = at === "source" || at === "item" || at === "target" || (at === "confirm" && task === null);
    return busyRef.current || alertRef.current !== null || !open;
  }, [alertRef, stageRef, task]);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [donePair, setDonePair] = useState<{ item: string; qty: number; to: string } | null>(null);

  const stepOf = (s: Stage): number => {
    const order: Stage[] = task === null ? ["source", "item", "target", "confirm", "done"] : ["item", "target", "confirm", "done"];
    return order.indexOf(s) + 1;
  };
  // Ses/titreşim: okuma anında kamera katmanı (cameraFeedback), uyarıda tam ekran uyarı (ScanAlert titreşimi) — T-313 sözleşmesi; ek ton yok.
  const showAlert = (titleKey: string, reasonKey: string, code: string, back?: Stage): void => {
    setAlert({ titleKey, reasonKey, code, ...(back === undefined ? {} : { back }) });
  };

  const onScanned = useCallback(
    async (code: string) => {
      // Eşzamanlı tek çözüm: bayrak ref'tedir; aynı tikteki ikinci okuma kapıda düşer ve bildirilir (`useScanner`).
      // Kapı ref'ten okunur (finally → commit penceresinde uyarı/bitiş durumu henüz render'a düşmemiş olabilir).
      if (blocked()) return;
      busyRef.current = true;
      setLast(code);
      setLastName(undefined);
      setBusy(true);
      setError(null);
      try {
        const at = stageRef.current;
        if (at === "source" || at === "target") {
          const res = await resolveLocationScanAction({ slug, warehouseId, code });
          if (!res.ok) {
            showAlert("alert.scanTitle", errorKeyOf(res.error, "scan"), res.error.detail === undefined ? res.error.code : `${res.error.code}/${res.error.detail}`);
            return;
          }
          const loc = { id: res.data.id, code: res.data.code, name: res.data.name };
          holder.contentChanged();
          setLastName(loc.name);
          if (at === "source") {
            setSource(loc);
            setStage("item");
          } else {
            setTarget(loc);
            setStage("confirm");
          }
        } else if (at === "item" || at === "confirm") {
          const res = await resolveItemScanAction({ slug, code });
          if (!res.ok) {
            showAlert("alert.scanTitle", errorKeyOf(res.error, "scan"), res.error.detail === undefined ? res.error.code : `${res.error.code}/${res.error.detail}`);
            return;
          }
          // Yerleştirme stokta (temel birim) çalışır: koli okutunca adım koli içi adettir (`baseQuantity`, K-1); kesirli ise uyarı, sessizce 1 değil.
          // Adım yalnız adedi okutmadan alan yollarda istenir: görevli yerleştirmede miktar görevle sabittir, ondalık ölçekli ürün engellenmez.
          const stepOf1 = (): number | null => {
            const r = scanStepOf(res.data, res.data.baseUnitId);
            if (r.ok) return r.step;
            showAlert("alert.unitTitle", r.reason === "unit" ? "unit_mismatch" : "qty_fractional", r.reason === "unit" ? "UNIT_MISMATCH" : "QUANTITY_NOT_WHOLE");
            return null;
          };
          const current = itemRef.current;
          if (at === "confirm") {
            // Onay ekranında (serbest yerleştirme) aynı ürün yeniden okutulursa adet eklenir (iki koli = iki katı); başka ürün engellenir.
            if (current === null || current.id !== res.data.itemId) {
              showAlert("alert.mismatchTitle", "scan_mismatch", "SCAN_MISMATCH");
              return;
            }
            const step = stepOf1();
            if (step === null) return;
            holder.contentChanged();
            setLastName(res.data.itemName);
            setQty(Math.min(availRef.current ?? Infinity, qtyRef.current + step));
            return;
          }
          let nextQty = intOf(task?.quantity) ?? 1;
          if (task !== null) {
            if (scanMismatch(res.data.itemId, [task.itemId])) {
              showAlert("alert.mismatchTitle", "scan_mismatch", "SCAN_MISMATCH");
              return;
            }
          } else if (sourceRef.current !== null) {
            const a = await availableAtLocationAction({ slug, locationId: sourceRef.current.id, itemId: res.data.itemId });
            if (!a.ok) {
              showAlert("alert.scanTitle", errorKeyOf(a.error, "scan"), a.error.code);
              return;
            }
            const have = intOf(a.data.quantity);
            if (have === 0) {
              showAlert("alert.mismatchTitle", "no_stock_here", "NO_STOCK_HERE");
              return;
            }
            const step = stepOf1();
            if (step === null) return;
            setAvail(have);
            // Aynı ürün geri dönüp yeniden okutulduysa adet eklenir; başka ürünse bu okutmanın adedi ile başlar.
            const sameItem = current !== null && current.id === res.data.itemId;
            nextQty = Math.max(1, Math.min(have ?? Infinity, (sameItem ? qtyRef.current : 0) + step));
            setQty(nextQty);
          }
          holder.contentChanged();
          setLastName(res.data.itemName);
          setItem({ id: res.data.itemId, name: res.data.itemName, code: res.data.itemCode });
          setStage("target");
        }
      } catch {
        showAlert("alert.networkTitle", "network", "NETWORK");
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [slug, warehouseId, task, holder, setStage, blocked, setSource, setItem, setQty, setAvail, stageRef, sourceRef, itemRef, qtyRef, availRef],
  );
  // Görevsiz yerleştirmede onay ekranında da okuma açıktır (aynı ürün yeniden okutulunca adet artar); görevde adet sabittir.
  const scanning = stage === "source" || stage === "item" || stage === "target" || (stage === "confirm" && task === null);
  const { service: scanner, camera, dropped, clearDropped } = useScanner((v) => void onScanned(v), scanning && alert === null && !busy, blocked);
  const scanPrimary = useScanPrimary(camera, { busy, name: lastName, code: last, alerting: alert !== null });

  // T-969: OKUT ekranından gelen kod (raf ya da ürün) açılışta bir kez, aynı okuma yolundan işlenir; adres temizlenir.
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

  async function confirm() {
    if (busyRef.current || source === null || item === null || target === null) return;
    if (qty < 1 || (task === null && avail !== null && qty > avail)) {
      feedback.error();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const out = await submitWithKey(holder, (clientKey) =>
      putawayAction({
        slug,
        clientKey,
        ...(task === null ? {} : { taskId: task.id }),
        sourceLocationId: source.id,
        targetLocationId: target.id,
        itemId: item.id,
        quantity: String(qty),
      }),
    );
    busyRef.current = false;
    setBusy(false);
    if (!out.ok) {
      const key = errorKeyOf(out.error, "putaway");
      // Engelleyici sonuçlar (sayım kilidi, uygun olmayan raf, stok yok) tam ekran uyarıdır; kullanıcı başka raf okutur.
      if (key === "location_locked" || key === "putaway_invalid" || key === "insufficient_stock") {
        showAlert("alert.putawayTitle", key, out.error.detail === undefined ? out.error.code : `${out.error.code}/${out.error.detail}`, "target");
      } else {
        feedback.error();
        setError(out.error);
      }
      return;
    }
    feedback.ok();
    setDonePair({ item: item.name, qty, to: target.name || target.code });
    setVeil(true);
    setStage("done");
  }

  const shell = { hue: "teal" as const, iconD: KICON.mDepo };
  const phaseOf = (s: Stage): 1 | 2 | 3 | 4 => (s === "done" ? 4 : s === "confirm" ? 3 : s === "target" ? 2 : 1);
  const closeAlert = (): void => {
    if (alert?.back !== undefined) {
      holder.contentChanged();
      setTarget(null);
      setStage(alert.back);
    }
    setAlert(null);
    clearDropped();
  };
  const alertView = (
    <>
      <DroppedNotice show={dropped} alerting={alert !== null} onClose={clearDropped} />
      {alert === null ? null : (
        <ScanAlert
          title={t(alert.titleKey)}
          reason={t(`errors.${alert.reasonKey}`, { remaining: "-" })}
          action={t(`errors.${alert.reasonKey}Action`)}
          {...(alert.code === undefined ? {} : { code: alert.code })}
          onClose={closeAlert}
        />
      )}
    </>
  );

  const prev: Partial<Record<Stage, Stage>> = task === null ? { item: "source", target: "item", confirm: "target" } : { target: "item", confirm: "target" };
  const back = (): void => {
    const p = prev[stage];
    if (p !== undefined) {
      setError(null);
      setStage(p);
    }
  };
  const backProps = prev[stage] === undefined ? { backHref: task === null ? fieldHome : tasksHref } : { onBack: back };

  // Kamera katmanı aşama değişse de aynı konumda (kök parça, 2. çocuk) kalır: okunan ürün adı katmanda görünür, kamera yeniden açılmaz.
  const withOverlay = (node: React.ReactNode): React.ReactElement => (
    <>
      {node}
      {scanPrimary.overlay}
    </>
  );
  if (stage === "done" && donePair !== null) {
    return withOverlay(
      <>
        <SahaShell
          {...shell}
          step={stepOf("done")}
          total={total}
          phase={4}
          title={t("putaway.savedTitle")}
          overlay={veil ? <SahaDoneVeil title={ts("qty.putDone", { n: donePair.qty })} sub={donePair.to} /> : null}
          footer={
            task === null ? (
              <PrimaryButton
                onClick={() => {
                  holder.contentChanged();
                  setItem(null);
                  setTarget(null);
                  setStage("item");
                }}
              >
                {t("flow.nextItem")}
              </PrimaryButton>
            ) : (
              <PrimaryLink href={tasksHref}>{t("putaway.backToTasks")}</PrimaryLink>
            )
          }
        >
          <div className="pcard">
            <div className="cmp">
              <div className="cm ok">
                <small>{t("putaway.savedTitle")}</small>
                <b data-testid="saved-summary">{t("putaway.saved", { name: donePair.item, qty: donePair.qty, to: donePair.to })}</b>
              </div>
            </div>
          </div>
          <div className="vres ok" role="status">
            <span className="vic">
              <Ico d={SICON.check} size={34} />
            </span>
            <span>
              <b>{t("putaway.noNewStock")}</b>
            </span>
          </div>
        </SahaShell>
        {alertView}
      </>
    );
  }

  if (stage === "confirm" && source !== null && item !== null && target !== null) {
    const route = t("putaway.fromTo", { from: source.name || source.code, to: target.name || target.code });
    const over = task === null && avail !== null && qty > avail;
    return withOverlay(
      <>
        <SahaShell
          {...shell}
          step={stepOf("confirm")}
          total={total}
          phase={3}
          title={t("putaway.confirmTitle")}
          instruction={t("putaway.confirmInstruction")}
          {...backProps}
          main={{ label: ts("qty.confirm"), aria: t("putaway.confirm"), d: SICON.check, onClick: () => void confirm(), disabled: busy || qty < 1, wait: over, testId: "flow-primary" }}
        >
          {task !== null ? (
            <>
              <div className="job" data-testid="verify-card">
                <span className="uic" style={{ background: dz("8A5A12") }}>
                  <Ico d={SICON.urun} size={22} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <b data-testid="verified-item">{item.name}</b>
                  <small>{route}</small>
                </span>
                <span className="autosel">{ts("qty.okProduct")}</span>
              </div>
              <div className="qdisp" data-testid="fixed-qty">
                <span className="qv">
                  <b>{qty}</b>
                </span>
                <small>{t("putaway.taskQty", { n: qty })}</small>
                <CompoundLine slug={slug} itemId={item.id} baseQty={qty} />
              </div>
            </>
          ) : (
            <SahaQty
              itemName={item.name}
              itemSub={route}
              verified={ts("qty.okProduct")}
              main={{
                label: t("putaway.qtyLabel"),
                unit: "",
                value: qty,
                onChange: (n) => {
                  holder.contentChanged();
                  setQty(n);
                },
              }}
              max={avail}
              line={avail === null ? route : ts("qty.available", { n: String(avail) })}
              overText={ts("qty.over", { n: String(avail ?? "") })}
              compound={<CompoundLine slug={slug} itemId={item.id} baseQty={qty} />}
              side={
                <button type="button" className="qbtn" aria-label={t("flow.scanMore")} title={t("flow.scanMore")} data-testid="scan-more" onClick={scanPrimary.press}>
                  <Ico d={SICON.scan} size={22} />
                </button>
              }
            />
          )}
          {error === null ? null : <ErrorNotice error={error} context="putaway" />}
        </SahaShell>
        {alertView}
      </>
    );
  }

  const titleKey = stage === "source" ? "putaway.sourceTitle" : stage === "item" ? "putaway.itemTitle" : "putaway.targetTitle";
  return withOverlay(
    <>
      <SahaShell
        {...shell}
        step={stepOf(stage)}
        total={total}
        phase={phaseOf(stage)}
        title={t(titleKey)}
        {...backProps}
        scanProxy
        main={{ label: ts("okut.scanMain"), aria: t("flow.scanNow"), d: SICON.scan, onClick: scanPrimary.press, testId: "flow-primary" }}
      >
        {task !== null && stage === "item" ? (
          <div className="job" data-testid="task-card">
            <span className="uic" style={{ background: dz("8A5A12") }}>
              <Ico d={SICON.urun} size={22} />
            </span>
            <span style={{ minWidth: 0 }}>
              <b>{task.itemName}</b>
              <small>{t("putaway.taskLine", { qty: intOf(task.quantity) ?? task.quantity, from: task.sourceName || task.sourceCode })}</small>
            </span>
          </div>
        ) : null}
        {stage === "target" && item !== null ? (
          <div className="job">
            <span className="uic" style={{ background: dz("8A5A12") }}>
              <Ico d={SICON.urun} size={22} />
            </span>
            <span style={{ minWidth: 0 }}>
              <b>{item.name}</b>
              {source === null ? null : <small>{t("putaway.takenFrom", { from: source.name || source.code })}</small>}
            </span>
            <span className="autosel">{ts("qty.okProduct")}</span>
          </div>
        ) : null}
        <ScanPanel variant="kalip" service={scanner} prompt={busy ? t("flow.checking") : t(stage === "item" ? "putaway.itemPrompt" : stage === "source" ? "putaway.sourcePrompt" : "putaway.targetPrompt")} last={last} {...(lastName === undefined ? {} : { lastName })} ready={scanPrimary.ready && last === ""} hue="teal" />
      </SahaShell>
      {alertView}
    </>
  );
}
