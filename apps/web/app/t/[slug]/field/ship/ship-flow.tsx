"use client";
// T-977 (B-63 saha): saha sevk — sevk alanında toplanmış satırı seç → miktar → yükleme onayı → sevk. Kural (yalnız STAGING'deki sipariş rezervasyonu
// tüketilir, AC-08/AC-10), kilit (I-15) ve idempotency (I-06) `shipOrder` komutundadır (`postShipmentAction`). Ekran yalnız girdi toplar; ağ hatasında
// aynı anahtarla yeniden gönderim önceki sonucu döndürür (çift sevk yok). Başarıdan sonra sunucu verisi yenilenir (kalan satırlar).
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { KICON } from "../../../../design/kabuk-icons.ts";
import { dz } from "../../../../design/kalip-saha-tokens.ts";
import { SICON } from "../../../../design/saha-icons.ts";
import { ErrorNotice, intOf, submitWithKey, useKeyHolder, type ErrorInfo } from "../../receipts/receipt-form.tsx";
import { postShipmentAction } from "../../shipping/actions.ts";
import { PrimaryLink } from "../receive/receive-flow.tsx";
import { Ico, SahaDoneVeil, SahaShell, SahaVerdict } from "../saha-shell.tsx";
import { SahaQty } from "../saha-qty.tsx";
import { feedback } from "@wms/ui";

export interface ShipRow {
  readonly lineId: string;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly itemName: string;
  readonly unitCode: string;
  readonly quantity: string;
}
type Stage = "list" | "qty" | "confirm";

export function ShipFlow({ slug, orderId, orderNumber, customerRef, rows, openPicks }: { slug: string; orderId: string; orderNumber: string; customerRef: string | null; rows: readonly ShipRow[]; openPicks: number }) {
  const t = useTranslations("sahaIs");
  const ts = useTranslations("saha");
  const router = useRouter();
  const holder = useKeyHolder();
  const base = `/t/${encodeURIComponent(slug)}/field`;
  const [stage, setStage] = useState<Stage>("list");
  const [row, setRow] = useState<ShipRow | null>(null);
  const [qty, setQty] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [done, setDone] = useState<{ n: number; item: string } | null>(null);
  const [veil, setVeil] = useState(false);
  useEffect(() => {
    if (!veil) return undefined;
    const id = window.setTimeout(() => setVeil(false), 2400);
    return () => window.clearTimeout(id);
  }, [veil]);
  const shell = { hue: "blue" as const, iconD: KICON.mSatis };
  const max = row === null ? null : intOf(row.quantity);

  async function ship() {
    if (busyRef.current || row === null || max === null || qty < 1 || qty > max) {
      feedback.error();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const out = await submitWithKey(holder, (clientKey) => postShipmentAction({ slug, clientKey, orderId, warehouseId: row.warehouseId, lineId: row.lineId, quantity: String(qty) }));
    busyRef.current = false;
    setBusy(false);
    if (!out.ok) {
      feedback.error();
      setError(out.error);
      return;
    }
    feedback.ok();
    setDone({ n: qty, item: row.itemName });
    setVeil(true);
    setRow(null);
    setStage("list");
    router.refresh();
  }

  if (stage === "confirm" && row !== null) {
    return (
      <SahaShell
        {...shell}
        phase={3}
        title={t("ship.confirmTitle")}
        instruction={orderNumber}
        onBack={() => setStage("qty")}
        main={{ label: ts("qty.confirm"), aria: t("ship.confirm"), d: SICON.check, onClick: () => void ship(), disabled: busy, testId: "flow-primary" }}
      >
        <div className="job" data-testid="ship-confirm-card">
          <span className="uic" style={{ background: dz("2F5DA8") }}>
            <Ico d={SICON.urun} size={22} />
          </span>
          <span style={{ minWidth: 0 }}>
            <b>{row.itemName}</b>
            <small>{row.warehouseName}</small>
          </span>
        </div>
        <SahaVerdict ok title={t("ship.loadQuestion", { n: qty, unit: row.unitCode, customer: customerRef ?? orderNumber })} sound={t("ship.loadHint")} />
        {error === null ? null : <ErrorNotice error={error} context="approve" />}
      </SahaShell>
    );
  }

  if (stage === "qty" && row !== null && max !== null) {
    return (
      <SahaShell
        {...shell}
        phase={2}
        title={t("ship.qtyTitle")}
        instruction={orderNumber}
        onBack={() => setStage("list")}
        main={{ label: t("ship.next"), aria: t("ship.nextAria"), d: SICON.next, onClick: () => (qty >= 1 && qty <= max ? setStage("confirm") : feedback.error()), disabled: qty < 1 || qty > max, testId: "flow-primary" }}
      >
        <SahaQty
          itemName={row.itemName}
          itemSub={row.warehouseName}
          main={{
            label: t("ship.qtyLabel"),
            unit: row.unitCode,
            value: qty,
            testId: "ship-qty",
            onChange: (n) => {
              holder.contentChanged();
              setQty(n);
            },
          }}
          max={max}
          line={t("ship.ready", { n: max, unit: row.unitCode })}
          overText={t("ship.over", { n: max })}
        />
      </SahaShell>
    );
  }

  return (
    <SahaShell
      {...shell}
      phase={1}
      title={t("ship.title")}
      instruction={[orderNumber, customerRef].filter((x) => x !== null && x !== "").join(" · ")}
      backHref={`${base}/tasks`}
      overlay={veil && done !== null ? <SahaDoneVeil title={t("ship.doneVeil", { n: done.n })} sub={done.item} /> : null}
      {...(rows.length === 0 ? { footer: <PrimaryLink href={`${base}/tasks`}>{t("toTasks")}</PrimaryLink> } : {})}
    >
      {done === null ? null : <SahaVerdict ok title={t("ship.done", { n: done.n, item: done.item })} sound={ts("qty.sound")} />}
      {openPicks > 0 ? (
        <div className="vres bad" role="status" data-testid="ship-open-picks">
          <span className="vic">
            <Ico d={SICON.warn} size={34} />
          </span>
          <span>
            <b>{t("ship.openPicks", { n: openPicks })}</b>
          </span>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <p className="break-words text-lg text-ink" data-testid="ship-empty">
          {t("ship.empty")}
        </p>
      ) : (
        <ul className="m-0 flex min-w-0 list-none flex-col gap-2 p-0" aria-label={t("ship.listLabel")}>
          {rows.map((r) => {
            const n = intOf(r.quantity);
            return (
              <li key={`${r.lineId}:${r.warehouseId}`} className="flex min-w-0">
                <button
                  type="button"
                  className="job w-full"
                  data-testid="ship-row"
                  disabled={n === null || n < 1}
                  onClick={() => {
                    if (n === null || n < 1) return;
                    feedback.minor();
                    holder.contentChanged();
                    setError(null);
                    setRow(r);
                    setQty(n);
                    setStage("qty");
                  }}
                >
                  <span className="uic" style={{ background: dz("2F5DA8") }}>
                    <Ico d={SICON.urun} size={22} />
                  </span>
                  <span style={{ minWidth: 0, textAlign: "left" }}>
                    <b>{r.itemName}</b>
                    <small>{n === null ? t("ship.decimal") : `${r.warehouseName} · ${t("ship.ready", { n, unit: r.unitCode })}`}</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </SahaShell>
  );
}
