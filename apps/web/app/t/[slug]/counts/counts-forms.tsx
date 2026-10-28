"use client";
// T-977 (B-51 yönetici): sayım başlat formu ve oturum komutları (onayla / fişi işle / iptal). Anahtarlı gönderim (`useKeyHolder`): ağ hatasında aynı
// anahtarla yeniden deneme önceki sonucu döndürür. Yetki, görev ayrılığı ve durum kuralları sunucu komutundadır; düğmeler yalnız görünürlüktür.
// T-990 (B-97): depo seçimi yerel açılır liste değil, ortak `KalipSecim` (depo sayısı büyüyecek veri: aramalı seçim sayfası, okutma dahil).
// T-1119 (B-123): raf kodları `KalipAlan` (çok satır), kör sayım `KalipAnahtar`, eksik raf `KalipBildirim`, düğmeler `KalipDugme`; ayrıntıdaki
// komutlar `KalipFormKap` içinde. Seçimler React durumunda → `data-dirty` (çıkış koruması).
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { LICON } from "../../../design/kalip-icons.ts";
import { KalipAlan, KalipAnahtar, KalipGrup } from "../kalip/form.tsx";
import { KalipSecim } from "../kalip/secim.tsx";
import { KalipBildirim, KalipDugme, KalipFormKap } from "../kalip/belge.tsx";
import { OperationError } from "../production/production-form.tsx";
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
  const dirty = warehouseId !== (warehouses[0]?.id ?? "") || !blind;
  function changed() {
    key.contentChanged();
    setError(null);
    setMissing([]);
  }
  return (
    <form
      className="workflow-form kform-ic"
      data-testid="count-new-form"
      data-dirty={dirty ? "true" : "false"}
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
      <small className="khint">{t("newHelp")}</small>
      <fieldset disabled={pending} className="kform-alan" onChange={changed}>
        <KalipGrup title={`1. ${t("warehouse")}`} d={LICON.depo} color="30475A">
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
        </KalipGrup>
        <KalipGrup title={`2. ${t("racks")}`} sub={String(list.length)} d={LICON.raf} color="6C4BD8">
          <KalipAlan multiline label={t("racksLabel")} hint={t("racksHint")} name="codes" value={codes} onChange={(e) => setCodes(e.target.value)} required maxLength={4000} data-testid="count-racks" />
          <KalipAnahtar
            title={t("blind")}
            d={LICON.lock}
            color="6C4BD8"
            on={blind}
            aria={t("blind")}
            onToggle={() => {
              setBlind((b) => !b);
              changed();
            }}
            testId="count-blind"
          />
        </KalipGrup>
      </fieldset>
      {missing.length > 0 ? (
        <KalipBildirim tur="hata" title={t("missingRacks", { codes: missing.join(", ") })} testId="count-missing-racks" />
      ) : null}
      {error ? <OperationError error={error} /> : null}
      <KalipDugme tur="ana" type="submit" className="workflow-primary" d={LICON.check} busy={pending} disabled={pending || list.length === 0 || warehouseId === ""}>
        {t("start")}
      </KalipDugme>
    </form>
  );
}

type Op = "approve" | "post" | "cancel";
const COMMAND_ICON: Record<Op, string> = { approve: LICON.check, post: LICON.box, cancel: LICON.close };
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
    <KalipFormKap>
      <div className="kgovde">
        {confirming ? <KalipBildirim tur={operation === "cancel" ? "uyari" : "bilgi"} title={t(`${operation}Help`)} /> : null}
        {confirming && operation === "cancel" ? (
          <KalipAlan
            label={t("reason")}
            maxLength={500}
            value={reason}
            onChange={(e) => {
              key.contentChanged();
              setReason(e.target.value);
            }}
          />
        ) : null}
        {error ? <OperationError error={error} /> : null}
        <KalipDugme tur={operation === "cancel" ? "tehlike" : "ana"} d={COMMAND_ICON[operation]} busy={pending} disabled={pending} onClick={run} data-testid={`count-${operation}`}>
          {t(confirming ? `${operation}Confirm` : operation)}
        </KalipDugme>
      </div>
    </KalipFormKap>
  );
}
