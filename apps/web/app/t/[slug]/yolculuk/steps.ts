// T-1006: spotlight turun adım planı (istemci; domain kodu yok). Anahtar listesi domain `JOURNEY_STEPS` ile aynıdır (birim testi).
// Her adım GERÇEK ekranı açar; ekranda ortak buzlu perde + delikte parlayan `[data-tour]` hedefi + ipucu balonu çizilir (`yolculuk.tsx`).
import { JICON } from "../../../design/yolculuk-icons.ts";

export const STEP_KEYS = ["cards", "shelves", "stock", "labels", "bom", "order", "people", "task"] as const;
export type StepKey = (typeof STEP_KEYS)[number];

export interface JourneyData {
  readonly steps: readonly { readonly key: StepKey; readonly done: boolean; readonly skipped: boolean; readonly count: number }[];
  readonly makesProduction: boolean | null;
  readonly cardSource: "EXCEL" | "PARASUT" | null;
  readonly openingStockWanted: boolean | null;
  readonly done: number;
  readonly total: number;
  readonly complete: boolean;
  readonly dismissed: boolean;
  readonly tour: "ACTIVE" | "CLOSED" | null;
  readonly next: StepKey | null;
  readonly hints: {
    readonly warehouseId: string | null;
    readonly recipeId: string | null;
    readonly parasut: { readonly connected: boolean; readonly openingEnabled: boolean; readonly openingTakenAt: string | null };
  };
}

/** Kaynak (Yolculuk.dc.html) adım ikonu + rengi. */
export const STEP_UI: Readonly<Record<StepKey, { readonly d: string; readonly color: string }>> = {
  cards: { d: JICON.cards, color: "2F5DA8" },
  shelves: { d: JICON.shelves, color: "30475A" },
  stock: { d: JICON.stock, color: "2F7D5B" },
  labels: { d: JICON.labels, color: "B23A3A" },
  bom: { d: JICON.bom, color: "8A5A12" },
  order: { d: JICON.order, color: "C25A00" },
  people: { d: JICON.people, color: "7A4BC2" },
  task: { d: JICON.task, color: "0E7C7B" },
};

/** Turun hedefi: `[data-tour="<hedef>"]` öğesi (`main` = KabukBar ana işlemi, mevcut `spot` kancası) ya da yalnız balon (`null`). */
export type TourTarget = "main" | "excel" | "opening-pull" | null;

export interface TourStop {
  /** Ekran yolu (`/t/<alan>/…`, sorgu yok); `prefix`: alt yollar da (ör. depo ayrıntısı). */
  readonly path: string;
  readonly prefix?: boolean;
  readonly target: TourTarget;
  /** İpucu metni anahtarı (`yolculuk.hint.<k>`). */
  readonly hint: string;
}

export interface StepPlan {
  /** Adımın açacağı gerçek ekran. */
  readonly href: string;
  /** Adımın geçtiği ekranlar ve her birinde vurgulanan öğe (ör. Ürünler › Excel düğmesi → Excel'den aktar › Dosya seç). */
  readonly stops: readonly TourStop[];
}

/**
 * Adımın planı. Kaynak seçimi (adım 1) ve açılış stoku yolu (adım 3) seçimlere göre değişir:
 * - Kartlar: Excel → Ürünler (Excel düğmesi) → Excel'den aktar (Dosya seç); Paraşüt → Entegrasyon (BAĞLAN / EŞİTLE).
 * - Stok: Paraşüt açılış stoku açık ve alınmadıysa Entegrasyon "Şimdi al"; Excel'de açılış stoku istendiyse açılış stoku şablonu; aksi elle giriş.
 */
export function stepPlan(base: string, key: StepKey, j: JourneyData, source: "EXCEL" | "PARASUT" | null = j.cardSource): StepPlan {
  const m = (path: string, hint: string, extra: Partial<TourStop> = {}): TourStop => ({ path: `${base}${path}`, target: "main", hint, ...extra });
  switch (key) {
    case "cards":
      return source === "PARASUT"
        ? { href: `${base}/integrations`, stops: [m("/integrations", j.hints.parasut.connected ? "cardsSync" : "cardsParasut")] }
        : { href: `${base}/items`, stops: [m("/items", "cardsItems", { target: "excel" }), m("/import", "cardsExcel")] };
    case "shelves":
      return { href: j.hints.warehouseId === null ? `${base}/warehouses` : `${base}/warehouses/${encodeURIComponent(j.hints.warehouseId)}`, stops: [m("/warehouses", "warehouse"), m("/warehouses/", "shelves", { prefix: true })] };
    case "stock":
      if (j.hints.parasut.openingEnabled && j.hints.parasut.openingTakenAt === null) return { href: `${base}/integrations`, stops: [m("/integrations", "stockParasut", { target: "opening-pull" })] };
      if (j.openingStockWanted === true && j.cardSource === "EXCEL") return { href: `${base}/import?tur=acilis`, stops: [m("/import", "stockExcel")] };
      return { href: `${base}/stock/documents?new=STOCK_IN`, stops: [m("/stock/documents", "stockManual")] };
    case "labels":
      return j.hints.warehouseId === null
        ? { href: `${base}/items`, stops: [m("/items", "labelsItems", { target: null }), m("/labels", "labels")] }
        : { href: `${base}/labels?warehouse=${encodeURIComponent(j.hints.warehouseId)}&subtree=1`, stops: [m("/labels", "labels")] };
    case "bom":
      return { href: `${base}/production?new=1`, stops: [m("/production", "bom")] };
    case "order":
      return { href: j.hints.recipeId === null ? `${base}/production` : `${base}/production?id=${encodeURIComponent(j.hints.recipeId)}`, stops: [m("/production", j.hints.recipeId === null ? "orderList" : "order")] };
    case "people":
      return { href: `${base}/team`, stops: [m("/team", "people")] };
    case "task":
      return { href: `${base}/tasks`, stops: [m("/tasks", "task")] };
  }
}

/** Bulunulan ekranın durağı (yoksa `null`: balon "Ekranı aç" der). */
export function stopFor(plan: StepPlan, pathname: string): TourStop | null {
  return plan.stops.find((s) => (s.prefix === true ? pathname.startsWith(s.path) : pathname === s.path)) ?? null;
}

export function isStepKey(v: string | null): v is StepKey {
  return v !== null && (STEP_KEYS as readonly string[]).includes(v);
}

/** Pano halkası: payı / paydası ile çevre uzunluğu (r = 15 → 94.25). */
export const RING_C = 94.25;
export function ringDash(done: number, total: number): string {
  const v = total === 0 ? 0 : Math.min(1, done / total) * RING_C;
  return `${v.toFixed(2)} ${RING_C}`;
}

/** Turu / adım listesini açan pencere olayı (Pano halkası, Destek › Rehberi aç). İptal edilirse (dinleyen var) eski rehber açılmaz. */
export const JOURNEY_OPEN_EVENT = "etkinwms:yolculuk-open";
