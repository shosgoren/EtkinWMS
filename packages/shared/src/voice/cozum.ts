// T-1002 (B-62): Etkin — niyet + kiracı listesi → istemciye giden yanıt. Saf kısım (`resolveWrite`, `unitMatches`, `completePlan`) istemcide
// de çalışır (aday seçilince plan tamamlanır); `answerVoiceCommand` DB okur (yalnız `sorgu.ts` ve mevcut sorgular; yazma YOK).
// Yazma niyetinde dönen `draft` yalnız öneridir: Onayla'da istemci MEVCUT sunucu eylemlerini çağırır (startCountAction, transferStockAction,
// createManualStockAction); onlar yetkiyi, depo kapsamını, kilitleri (I-15) ve idempotency'yi (I-06) kendileri yeniden denetler.
import { decide, decideLocation, type Candidate, type MatchResult } from "./eslestir.ts";
import type { VoiceIntent } from "./niyet.ts";
import { fold } from "./turkce.ts";

export type WriteOp = "count" | "stockIn" | "stockOut" | "transfer";
export type Slot = "item" | "loc" | "from" | "to" | "qty" | "unit" | "wh";

export interface PickOption {
  readonly id: string;
  readonly label: string;
  readonly sub: string;
  readonly warehouseId?: string;
  readonly unitCode?: string;
  readonly unitName?: string;
}

export interface Draft {
  readonly quantity?: string;
  readonly unit?: string;
  readonly itemId?: string;
  readonly itemLabel?: string;
  readonly itemUnitCode?: string;
  readonly itemUnitName?: string;
  readonly locationId?: string;
  readonly locationLabel?: string;
  readonly warehouseId?: string;
  readonly sourceLocationId?: string;
  readonly sourceLabel?: string;
  readonly sourceWarehouseId?: string;
  readonly targetLocationId?: string;
  readonly targetLabel?: string;
  readonly targetWarehouseId?: string;
  readonly toWarehouseLabel?: string;
  readonly code?: string;
}

export type Plan =
  | { readonly op: "count"; readonly warehouseId: string; readonly code: string }
  | { readonly op: "stockIn" | "stockOut"; readonly warehouseId: string; readonly itemId: string; readonly locationId: string; readonly quantity: string }
  | { readonly op: "transfer"; readonly itemId: string; readonly sourceLocationId: string; readonly targetLocationId: string; readonly quantity: string };

export interface ReadRow {
  readonly icon: "item" | "loc" | "task" | "order" | "party";
  readonly title: string;
  readonly meta: string;
  readonly href: string;
}

export type VoiceAnswer =
  | { readonly type: "confirm" }
  | { readonly type: "fix" }
  | {
      readonly type: "write";
      readonly op: WriteOp;
      readonly draft: Draft;
      readonly picks: Partial<Record<"item" | "loc" | "from" | "to", readonly PickOption[]>>;
      readonly missing: readonly Slot[];
      readonly fallback: string;
    }
  | { readonly type: "read"; readonly title: string; readonly icon: ReadRow["icon"]; readonly rows: readonly ReadRow[]; readonly total: number; readonly href: string; readonly empty?: string }
  | { readonly type: "nav"; readonly href: string; readonly what: string }
  | { readonly type: "open"; readonly target: string }
  | { readonly type: "unknown" };

export interface WriteCatalog {
  readonly items: readonly (Candidate & { readonly unitCode: string; readonly unitName: string })[];
  readonly locations: readonly (Candidate & { readonly warehouseId: string; readonly warehouseName: string })[];
  readonly warehouses: readonly Candidate[];
}

const UNIT_SYNONYMS: readonly (readonly string[])[] = [
  ["adet", "tane", "ad", "pcs", "ea"],
  ["kilo", "kg", "kilogram"],
  ["litre", "lt", "l"],
  ["metre", "m", "mt"],
  ["gram", "gr", "g"],
];

/** Söylenen birim ürünün temel birimi mi? Söylenmediyse temel birim varsayılır (true). */
export function unitMatches(spoken: string | undefined, unitCode: string, unitName: string): boolean {
  if (spoken === undefined) return true;
  const s = fold(spoken);
  const forms = new Set([fold(unitCode), fold(unitName)]);
  if (forms.has(s)) return true;
  const group = UNIT_SYNONYMS.find((g) => g.includes(s));
  return group !== undefined && group.some((g) => forms.has(g));
}

function itemOption(c: WriteCatalog["items"][number]): PickOption {
  return { id: c.id, label: c.name, sub: c.code, unitCode: c.unitCode, unitName: c.unitName };
}
function locOption(c: WriteCatalog["locations"][number]): PickOption {
  return { id: c.id, label: c.code, sub: c.warehouseName, warehouseId: c.warehouseId };
}

/** Taslak + eksikler → tam plan (eksik/çakışma varsa null). İstemci aday seçince yeniden çağırır. */
export function completePlan(op: WriteOp, d: Draft): { plan: Plan | null; missing: Slot[] } {
  const missing: Slot[] = [];
  const needQty = op !== "count";
  if (needQty && (d.quantity === undefined || !/^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?$/.test(d.quantity) || Number(d.quantity) <= 0)) missing.push("qty");
  if (op !== "count" && d.itemId === undefined) missing.push("item");
  if (op !== "count" && d.itemId !== undefined && !unitMatches(d.unit, d.itemUnitCode ?? "", d.itemUnitName ?? "")) missing.push("unit");
  if (op === "count" || op === "stockIn" || op === "stockOut") {
    if (d.locationId === undefined || d.warehouseId === undefined) missing.push("loc");
  } else {
    if (d.sourceLocationId === undefined) missing.push("from");
    if (d.targetLocationId === undefined) missing.push("to");
  }
  if (missing.length > 0) return { plan: null, missing };
  if (op === "count") return { plan: { op, warehouseId: d.warehouseId!, code: d.code ?? d.locationLabel! }, missing };
  if (op === "transfer") {
    return { plan: { op, itemId: d.itemId!, sourceLocationId: d.sourceLocationId!, targetLocationId: d.targetLocationId!, quantity: d.quantity! }, missing };
  }
  return { plan: { op, warehouseId: d.warehouseId!, itemId: d.itemId!, locationId: d.locationId!, quantity: d.quantity! }, missing };
}

function applyLoc(m: MatchResult<WriteCatalog["locations"][number]>, slot: "loc" | "from" | "to", picks: Record<string, PickOption[]>): Partial<Draft> {
  if (m.kind === "many") picks[slot] = m.list.map(locOption);
  if (m.kind !== "one") return {};
  const c = m.c;
  if (slot === "loc") return { locationId: c.id, locationLabel: c.code, warehouseId: c.warehouseId, code: c.code };
  if (slot === "from") return { sourceLocationId: c.id, sourceLabel: c.code, sourceWarehouseId: c.warehouseId };
  return { targetLocationId: c.id, targetLabel: c.code, targetWarehouseId: c.warehouseId };
}

/** Yazma niyeti → taslak, aday listeleri ve eksikler (saf; DB yok). */
export function resolveWrite(intent: Extract<VoiceIntent, { kind: "receive" | "issue" | "transfer" | "count" }>, cat: WriteCatalog): Extract<VoiceAnswer, { type: "write" }> {
  const picks: Record<string, PickOption[]> = {};
  let d: Draft = {};
  const op: WriteOp = intent.kind === "count" ? "count" : intent.kind === "receive" ? "stockIn" : intent.kind === "issue" ? "stockOut" : "transfer";
  if (intent.kind !== "count") {
    d = { ...d, ...(intent.qty === undefined ? {} : { quantity: intent.qty }), ...(intent.unit === undefined ? {} : { unit: intent.unit }) };
    if (intent.item !== undefined) {
      const m = decide(intent.item, cat.items);
      if (m.kind === "one") d = { ...d, itemId: m.c.id, itemLabel: m.c.name, itemUnitCode: m.c.unitCode, itemUnitName: m.c.unitName };
      else if (m.kind === "many") picks.item = m.list.map(itemOption);
    }
  }
  if (intent.kind === "count" && intent.at !== undefined) d = { ...d, ...applyLoc(decideLocation(intent.at, cat.locations), "loc", picks) };
  if (intent.kind === "receive" && intent.to !== undefined) d = { ...d, ...applyLoc(decideLocation(intent.to, cat.locations), "loc", picks) };
  if (intent.kind === "issue" && intent.from !== undefined) d = { ...d, ...applyLoc(decideLocation(intent.from, cat.locations), "loc", picks) };
  if (intent.kind === "transfer") {
    if (intent.from !== undefined) d = { ...d, ...applyLoc(decideLocation(intent.from, cat.locations), "from", picks) };
    if (intent.to !== undefined) d = { ...d, ...applyLoc(decideLocation(intent.to, cat.locations), "to", picks) };
    if (intent.toWarehouse !== undefined) {
      const ord = /^#(\d+)$/.exec(intent.toWarehouse);
      const sorted = [...cat.warehouses].sort((a, b) => a.code.localeCompare(b.code));
      const byName = ord === null ? decide(intent.toWarehouse, cat.warehouses) : null;
      const wh = ord !== null ? sorted[Number(ord[1]) - 1] : byName?.kind === "one" ? byName.c : undefined;
      if (wh !== undefined) d = { ...d, toWarehouseLabel: wh.name };
    }
  }
  const missing = completePlan(op, d).missing;
  const fallback = op === "count" ? "/counts?new=1" : op === "transfer" ? "/stock/documents?new=TRANSFER" : op === "stockIn" ? "/receipts?new=1" : "/stock/documents?new=1";
  return { type: "write", op, draft: d, picks, missing, fallback };
}
