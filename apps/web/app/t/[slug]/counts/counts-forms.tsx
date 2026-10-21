"use client";
// T-977 (B-51 yönetici): sayım başlat formu ve oturum komutları (onayla / fişi işle / iptal). Anahtarlı gönderim (`useKeyHolder`): ağ hatasında aynı
// anahtarla yeniden deneme önceki sonucu döndürür. Yetki, görev ayrılığı ve durum kuralları sunucu komutundadır; düğmeler yalnız görünürlüktür.
// T-990 (B-97): depo seçimi yerel açılır liste değil, ortak `KalipSecim` (depo sayısı büyüyecek veri: aramalı seçim sayfası, okutma dahil).
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { LICON } from "../../../design/kalip-icons.ts";
import { KalipGrup } from "../kalip/form.tsx";
import { KalipSecim } from "../kalip/secim.tsx";
import { OperationError } from "../production/production-form.tsx";
import { control } from "../stock/documents/document-form.tsx";
import { submitWithKey, useKeyHolder, type ErrorInfo } from "../receipts/receipt-form.tsx";
import { approveCountAction, cancelCountAction, postCountAction, startCountAction } from "./actions.ts";

export function NewCountForm({ slug, warehouses }: { slug: string; warehouses: readonly { readonly id: string; readonly name: string; readonly code: string }[] }) {
  const t = useTranslations("counts");
  const router = useRouter();
  const key = useKeyHolder();
  const flight = useRef(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [missing, setMissing] = useState<readonly string[]>([]);
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [codes, setCodes] = useState("");
  const [blind, setBlind] = useState(true);
  const list = [...new Set(codes.split(/[\s,;]+/).map((c) => c.trim()).filter((c) => c !== ""))];
  function changed() {
    key.contentChanged();
    setError(null);
    setMissing([]);
  }
  return (
    <form
      className="workflow-form flex flex-col gap-4"
      data-testid="count-new-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (flight.current || list.length === 0 || warehouseId === "") return;
        flight.current = true;
        start(async () => {
          try {
            const r = await submitWithKey(key, (clientKey) => startCountAction({ slug, clientKey, warehouseId, codes: list.slice(0, 200), blind }));
            if (!r.ok) {
              setError(r.error);
              return;
            }
            if (r.data.sessionId === null) {
              setMissing(r.data.missing);
              key.contentChanged();
              return;
            }
            router.push(`/t/${encodeURIComponent(slug)}/counts?id=${r.data.sessionId}`);
            router.refresh();
          } finally {
            flight.current = false;
          }
        });
      }}
    >
      <p className="text-ink-muted">{t("newHelp")}</p>
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4" onChange={changed}>
        <KalipGrup title={`1. ${t("warehouse")}`} d={LICON.depo} color="30475A">
          <div className="flex min-w-0 flex-col gap-3 p-3">
            <KalipSecim
              list
              name="warehouseId"
              label={t("warehouse")}
              value={warehouseId}
              color="30475A"
              icon={{ d: LICON.depo, color: "30475A" }}
              disabled={pending}
              onPick={(id) => {
                setWarehouseId(id);
                changed();
              }}
              options={warehouses.map((w) => ({ id: w.id, label: w.name, sub: w.code, keys: [w.code], d: LICON.depo, color: "30475A" }))}
              testId="count-warehouse"
            />
          </div>
        </KalipGrup>
        <KalipGrup title={`2. ${t("racks")}`} sub={String(list.length)} d={LICON.raf} color="6C4BD8">
          <div className="flex min-w-0 flex-col gap-3 p-3">
            <label>
              {t("racksLabel")}
              <textarea className={`${control} block min-h-32 w-full`} value={codes} onChange={(e) => setCodes(e.target.value)} required maxLength={4000} data-testid="count-racks" />
            </label>
            <small>{t("racksHint")}</small>
            <label className="flex min-h-12 items-center gap-3">
              <input type="checkbox" className="size-6" checked={blind} onChange={(e) => setBlind(e.target.checked)} />
              {t("blind")}
            </label>
          </div>
        </KalipGrup>
      </fieldset>
      {missing.length > 0 ? (
        <p role="alert" className="rounded-card bg-danger-bg px-4 py-3 font-semibold text-danger-ink" data-testid="count-missing-racks">
          {t("missingRacks", { codes: missing.join(", ") })}
        </p>
      ) : null}
      {error ? <OperationError error={error} /> : null}
      <button className={`workflow-primary ${control} bg-accent text-on-accent`} disabled={pending || list.length === 0 || warehouseId === ""}>
        {t("start")}
      </button>
    </form>
  );
}

type Op = "approve" | "post" | "cancel";
export function CountCommand({ slug, sessionId, operation }: { slug: string; sessionId: string; operation: Op }) {
  const t = useTranslations("counts");
  const router = useRouter();
  const key = useKeyHolder();
  const flight = useRef(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const run = () => {
    if (flight.current) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    if (operation === "cancel" && reason.trim() === "") return;
    flight.current = true;
    start(async () => {
      try {
        const r = await submitWithKey<unknown>(key, async (clientKey) =>
          operation === "approve"
            ? await approveCountAction({ slug, clientKey, sessionId })
            : operation === "post"
              ? await postCountAction({ slug, clientKey, sessionId })
              : await cancelCountAction({ slug, clientKey, sessionId, reason: reason.trim() }),
        );
        if (r.ok) {
          setError(null);
          setConfirming(false);
          router.refresh();
        } else setError(r.error);
      } finally {
        flight.current = false;
      }
    });
  };
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {confirming ? <p>{t(`${operation}Help`)}</p> : null}
      {confirming && operation === "cancel" ? (
        <label>
          {t("reason")}
          <input
            className={`${control} block w-full`}
            maxLength={500}
            value={reason}
            onChange={(e) => {
              key.contentChanged();
              setReason(e.target.value);
            }}
          />
        </label>
      ) : null}
      {error ? <OperationError error={error} /> : null}
      <button type="button" className={`${control} ${operation === "cancel" ? "" : "bg-accent text-on-accent"}`} disabled={pending} onClick={run} data-testid={`count-${operation}`}>
        {t(confirming ? `${operation}Confirm` : operation)}
      </button>
    </div>
  );
}
