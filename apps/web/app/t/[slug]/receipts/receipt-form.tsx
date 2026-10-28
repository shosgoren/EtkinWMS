"use client";
// Mal kabul ortak istemci takımı ve masaüstü teslim formu (T-313).
// - Anahtar yaşam döngüsü (ADR-018 §1-3, Supervisor notu: T-229 gelene kadar yerel): form ilk açılışta `crypto.randomUUID()` üretir; ağ hatasında ve
//   geçici sunucu hatasında AYNI anahtar kullanılır; iş kuralı reddinden sonra içerik değişirse yeni anahtar; başarıdan sonra yenilenir.
// - Hata eşlemesi: sunucu hata kodu (+ayrıntı) → `receiving.errors.<anahtar>` (+ `Action`); kural yeniden yazılmaz, yalnızca ileti seçilir.
// - Masaüstü liste + yeni teslim formu (T-972 kalıp): `receipts-view.tsx`. Saha ekranları `receive-flow.tsx` / `putaway-flow.tsx`.
// - T-1119 (B-123): `ErrorNotice` ve `LineStatus` kalıp görünümünde (`KalipBildirim`, kalıp simgeleri); dışa aktarımlar ve davranış aynı.
import { useRef } from "react";
import { useTranslations } from "next-intl";
import { LICON } from "../../../design/kalip-icons.ts";
import { KalipBildirim } from "../kalip/belge.tsx";
import { Ico } from "../kalip/ico.tsx";

// İstemci dosyaları sunucu paketlerini (tip olarak bile) içe aktaramaz (AC-28 / T-127b): sunucudan gelen veri biçimleri burada yapısal olarak
// tanımlanır; domain tipleriyle birebir uyumludur (sunucu bileşeni `ReceiptView`'ı bu şekle atar, derleyici uyumsuzluğu yakalar).
export interface ReceiptLineView {
  readonly id: string;
  readonly lineNo: number;
  readonly itemId: string;
  readonly itemCode: string;
  readonly itemName: string;
  readonly unitId: string;
  readonly unitCode: string;
  readonly unitName: string;
  readonly expected: string;
  readonly received: string;
  readonly damaged: string;
  readonly open: string;
}
export interface ReceiptView {
  readonly id: string;
  readonly warehouseId: string;
  readonly number: string;
  readonly supplierRef: string | null;
  readonly status: "DRAFT" | "OPEN" | "CLOSED" | "CANCELLED";
  readonly version: number;
  readonly createdKey: string;
  readonly lines: readonly ReceiptLineView[];
}
export interface ReceiptDetail extends ReceiptView {
  readonly receivingLocations: readonly { readonly id: string; readonly code: string; readonly name: string }[];
}
/** Sunucu eylemi sonucu (`ActionResult` ile yapısal olarak aynı). */
export type ActionResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly detail?: string | undefined; readonly requestId: string } };

// ---------------------------------------------------------------------------------------------------------------------
// Anahtar yaşam döngüsü
// ---------------------------------------------------------------------------------------------------------------------
export interface KeyHolder {
  /** Gönderimde kullanılacak anahtar. */
  current(): string;
  /** Başarı: yeni iş için yeni anahtar. */
  success(): void;
  /** İş kuralı reddi: içerik değişene kadar aynı anahtar (sunucu aynı reddi tekrar oynatır). */
  rejected(): void;
  /** Kullanıcı içeriği değiştirdi: red sonrasıysa yeni anahtar. */
  contentChanged(): void;
}

export function createKeyHolder(generate: () => string = () => crypto.randomUUID()): KeyHolder {
  let key = generate();
  let wasRejected = false;
  return {
    current: () => key,
    success: () => {
      key = generate();
      wasRejected = false;
    },
    rejected: () => {
      wasRejected = true;
    },
    contentChanged: () => {
      if (!wasRejected) return;
      key = generate();
      wasRejected = false;
    },
  };
}

export function useKeyHolder(): KeyHolder {
  const ref = useRef<KeyHolder | null>(null);
  if (ref.current === null) ref.current = createKeyHolder();
  return ref.current;
}

/** Geçici hatalar: aynı anahtarla yeniden denemek güvenlidir ve doğrudur (iş kuralı reddi değildir). */
const TRANSIENT_CODES: ReadonlySet<string> = new Set(["INTERNAL", "RATE_LIMITED", "NETWORK", "TENANT_SUSPENDED", "TENANT_CLOSING", "UNAUTHENTICATED"]);

export interface ErrorInfo {
  readonly code: string;
  readonly detail?: string | undefined;
  readonly requestId?: string | undefined;
}
export type Outcome<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: ErrorInfo };

/** Anahtarlı gönderim: ağ hatası `NETWORK` olur ve anahtar korunur; reddedilirse anahtar `rejected` işaretlenir; başarıda yenilenir. */
export async function submitWithKey<T>(holder: KeyHolder, call: (clientKey: string) => Promise<ActionResult<T>>): Promise<Outcome<T>> {
  const key = holder.current();
  let res: ActionResult<T>;
  try {
    res = await call(key);
  } catch {
    return { ok: false, error: { code: "NETWORK" } };
  }
  if (res.ok) {
    holder.success();
    return { ok: true, data: res.data };
  }
  if (!TRANSIENT_CODES.has(res.error.code)) holder.rejected();
  return { ok: false, error: { code: res.error.code, detail: res.error.detail, requestId: res.error.requestId } };
}

// ---------------------------------------------------------------------------------------------------------------------
// Hata eşlemesi
// ---------------------------------------------------------------------------------------------------------------------
export type ErrorContext = "receive" | "putaway" | "create" | "approve" | "scan";

/**
 * Sunucu hatası → ileti anahtarı. `OVER_RECEIPT` ayrı bir sunucu kodu DEĞİLDİR (A-305-3): kabulde ayrıntısız `VALIDATION_FAILED` olarak gelir ve
 * sade dille "Beklenenden fazla okuttun. Kalan: n" gösterilir. `SCAN_MISMATCH` istemci tarafı tarama kontrolüdür (`scanMismatch`).
 */
export function errorKeyOf(error: Pick<ErrorInfo, "code" | "detail">, context: ErrorContext): string {
  const { code, detail } = error;
  switch (code) {
    case "NETWORK":
      return "network";
    case "FORBIDDEN":
      // T-414/T-416: taslağın sahibi değil / görev ayrılığı — kullanıcıya nedeni söylenir.
      if (detail === "NOT_CREATOR") return "forbidden_not_creator";
      if (detail === "SEPARATION_OF_DUTIES") return "forbidden_sod";
      return detail === "WAREHOUSE_OUT_OF_SCOPE" ? "forbidden_scope" : "forbidden";
    case "LOCATION_LOCKED":
      return "location_locked";
    case "INSUFFICIENT_STOCK":
      return "insufficient_stock";
    case "TRACKING_VIOLATION":
      return "tracking_violation";
    case "VERSION_CONFLICT":
      return "version_conflict";
    case "IDEMPOTENCY_MISMATCH":
      return "idempotency_mismatch";
    case "NOT_FOUND":
      return context === "scan" ? "scan_unknown" : "not_found";
    case "UNAUTHENTICATED":
      return "unauthenticated";
    case "RATE_LIMITED":
      return "rate_limited";
    case "TENANT_SUSPENDED":
      return "tenant_suspended";
    case "TENANT_CLOSING":
      return "tenant_closing";
    case "VALIDATION_FAILED":
      if (detail === "BARCODE_AMBIGUOUS") return "barcode_ambiguous";
      if (detail === "DOCUMENT_STATE") return "document_state";
      if (detail === "QUANTITY_SCALE") return "quantity_scale";
      if (detail === undefined && context === "receive") return "over_receipt";
      if (detail === undefined && context === "putaway") return "putaway_invalid";
      return "validation_failed";
    default:
      return "internal";
  }
}

/** Taranan ürün bu işin ürünlerinden biri değilse true (istemci tarafı yanlış tarama engeli; alan kuralı değildir). */
export function scanMismatch(resolvedItemId: string, allowedItemIds: readonly string[]): boolean {
  return !allowedItemIds.includes(resolvedItemId);
}

/** `"6.000000"` → 6; kesirli ya da sayı olmayan dizgi → null (adım düğmesi sınırsız kalır, değer olduğu gibi gider). Yalnızca gösterim/varsayılan. */
export function intOf(s: string | null | undefined): number | null {
  if (s === undefined || s === null) return null;
  const m = /^(\d{1,9})(?:\.0+)?$/.exec(s.trim());
  return m === null ? null : Number(m[1]);
}

export function ErrorNotice({ error, context, remaining }: { error: ErrorInfo; context: ErrorContext; remaining?: string }) {
  const t = useTranslations("receiving");
  const key = errorKeyOf(error, context);
  return (
    <KalipBildirim tur="hata" title={<span data-testid="error-reason">{t(`errors.${key}`, { remaining: remaining ?? "-" })}</span>}>
      <p>{t(`errors.${key}Action`)}</p>
      <details className="kbil-ay">
        <summary>{t("detail")}</summary>
        <small data-testid="error-code">{t("errorCode", { code: error.detail === undefined ? error.code : `${error.code}/${error.detail}` })}</small>
        {error.requestId === undefined ? null : <small>{error.requestId}</small>}
      </details>
    </KalipBildirim>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Satır durumu (ikon + metin + renk)
// ---------------------------------------------------------------------------------------------------------------------
export function LineStatus({ expected, received, damaged, open }: { expected: string; received: string; damaged: string; open: string }) {
  const t = useTranslations("receiving");
  const done = intOf(open) === 0;
  const hasDamage = (intOf(damaged) ?? 0) > 0;
  return (
    <div className="kdurum">
      <span className={`kdurum-a ${done ? "ok" : "acik"}`}>
        <Ico d={done ? LICON.check : LICON.clock} size={16} />
        {done ? t("line.complete") : t("line.open", { open: String(intOf(open) ?? open) })}
      </span>
      <span>{t("line.expected", { n: String(intOf(expected) ?? expected) })}</span>
      <span>{t("line.received", { n: String(intOf(received) ?? received) })}</span>
      {hasDamage ? (
        <span className="kdurum-a hasar">
          <Ico d={LICON.warn} size={16} />
          {t("line.damaged", { n: String(intOf(damaged) ?? damaged) })}
        </span>
      ) : null}
    </div>
  );
}
