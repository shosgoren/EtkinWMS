// B-166 shared contract. Integer micrometres describe layout, never inventory quantities.
import { AppError } from "../errors.ts";
export const LABEL_CONTEXTS = ["PRODUCT", "RECEIPT", "LOCATION", "SHIPMENT"] as const;
export type LabelContext = (typeof LABEL_CONTEXTS)[number];
export const CONTEXT_FIELDS = {
  PRODUCT: ["name", "code", "unit", "barcode"],
  RECEIPT: ["name", "code", "unit", "barcode", "packageQr", "quantity", "lot", "productionDate", "expiryDate", "documentNo"],
  LOCATION: ["locationCode", "locationName", "warehouseName"],
  SHIPMENT: ["name", "code", "unit", "barcode", "packageQr", "quantity", "lot", "expiryDate", "documentNo", "customerName"],
} as const satisfies Record<LabelContext, readonly string[]>;
export type LabelField = (typeof CONTEXT_FIELDS)[LabelContext][number];
const CODE_FIELDS: Readonly<Record<LabelContext, readonly string[]>> = {
  PRODUCT: ["barcode"], RECEIPT: ["packageQr"], LOCATION: ["locationCode"], SHIPMENT: ["packageQr", "documentNo"],
};
export const DESIGN_LIMITS = Object.freeze({ elements: 60, codes: 6, minWidth: 10_000, maxWidth: 500_000, minHeight: 10_000, maxHeight: 1_000_000 });
interface Box { readonly id: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly rotation: 0 | 90 | 180 | 270; readonly locked: boolean }
export type LabelElement = Box & (
  | { readonly kind: "text"; readonly field: LabelField | null; readonly text: string | null; readonly fontSize: number; readonly bold: boolean; readonly align: "start" | "middle" | "end" }
  | { readonly kind: "qr"; readonly field: LabelField }
  | { readonly kind: "barcode"; readonly field: LabelField; readonly format: "CODE128" | "EAN13" }
  | { readonly kind: "logo"; readonly assetId: string }
  | { readonly kind: "line" | "frame"; readonly stroke: number }
);
export interface LabelDesign { readonly schema: 1; readonly context: LabelContext; readonly width: number; readonly height: number; readonly margin: number; readonly elements: readonly LabelElement[] }
export type DesignReason = "BAD_DOCUMENT" | "BAD_SIZE" | "BAD_ELEMENT" | "UNSUPPORTED_FIELD" | "OUTSIDE_LABEL" | "TOO_MANY_ELEMENTS" | "CODE_GEOMETRY";
export class LabelDesignError extends AppError {
  constructor(readonly reason: DesignReason, readonly elementId?: string) { super("VALIDATION_FAILED"); }
}
const fail = (r: DesignReason, id?: string): never => { throw new LabelDesignError(r, id); };
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail("BAD_DOCUMENT");
  return value as Record<string, unknown>;
}
function keys(r: Record<string, unknown>, allowed: readonly string[]): void { if (Object.keys(r).some(k => !allowed.includes(k))) fail("BAD_DOCUMENT"); }
function integer(v: unknown, lo: number, hi: number, reason: DesignReason = "BAD_SIZE"): number { if (typeof v !== "number" || !Number.isSafeInteger(v) || v < lo || v > hi) return fail(reason); return v; }
function bool(v: unknown): boolean { if (typeof v !== "boolean") return fail("BAD_ELEMENT"); return v; }
function text(v: unknown, max: number): string { if (typeof v !== "string" || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)) return fail("BAD_ELEMENT"); return v; }
function field(v: unknown, context: LabelContext, allowed: readonly string[] = CONTEXT_FIELDS[context]): LabelField { if (typeof v !== "string" || !allowed.includes(v)) return fail("UNSUPPORTED_FIELD"); return v as LabelField; }

/** Fresh whitelisted output; no arbitrary code, URL, HTML or source identity override. */
export function parseLabelDesign(value: unknown, stage: "DRAFT" | "PUBLISH" = "PUBLISH"): LabelDesign {
  if (stage !== "DRAFT" && stage !== "PUBLISH") return fail("BAD_DOCUMENT");
  const r = record(value); keys(r, ["schema", "context", "width", "height", "margin", "elements"]);
  if (r.schema !== 1 || typeof r.context !== "string" || !(LABEL_CONTEXTS as readonly string[]).includes(r.context)) return fail("BAD_DOCUMENT");
  const context = r.context as LabelContext, width = integer(r.width, DESIGN_LIMITS.minWidth, DESIGN_LIMITS.maxWidth), height = integer(r.height, DESIGN_LIMITS.minHeight, DESIGN_LIMITS.maxHeight);
  const margin = integer(r.margin, 0, Math.min(width, height) / 4);
  if (!Array.isArray(r.elements) || (stage === "PUBLISH" && r.elements.length === 0) || r.elements.length > DESIGN_LIMITS.elements) return fail("TOO_MANY_ELEMENTS");
  const ids = new Set<string>(); let codes = 0;
  const elements = r.elements.map((raw): LabelElement => {
    const e = record(raw), id = text(e.id, 48);
    if (!/^[A-Za-z0-9_-]+$/.test(id) || ["__proto__", "constructor", "prototype"].includes(id) || ids.has(id)) return fail("BAD_ELEMENT"); ids.add(id);
    const box: Box = { id, x: integer(e.x, margin, width), y: integer(e.y, margin, height), width: integer(e.width, 100, width), height: integer(e.height, 100, height), rotation: integer(e.rotation, 0, 270) as Box["rotation"], locked: bool(e.locked) };
    if (![0, 90, 180, 270].includes(box.rotation)) return fail("BAD_ELEMENT", id);
    if (box.x + box.width > width - margin || box.y + box.height > height - margin) return fail("OUTSIDE_LABEL", id);
    // Width/height are the axis-aligned bounds AFTER rotation, shared by editor and renderers.
    const base = ["id", "kind", "x", "y", "width", "height", "rotation", "locked"];
    switch (e.kind) {
      case "text": {
        keys(e, [...base, "field", "text", "fontSize", "bold", "align"]);
        if ((e.field === null) === (e.text === null) || (typeof e.align !== "string" || !["start", "middle", "end"].includes(e.align))) return fail("BAD_ELEMENT", id);
        return { ...box, kind: "text", field: e.field === null ? null : field(e.field, context), text: e.text === null ? null : text(e.text, 1000), fontSize: integer(e.fontSize, 1000, 50_000), bold: bool(e.bold), align: e.align as "start" | "middle" | "end" };
      }
      case "qr":
        keys(e, [...base, "field"]); codes++;
        if (box.width !== box.height || box.width < 10_000) return fail("CODE_GEOMETRY", id);
        return { ...box, kind: "qr", field: field(e.field, context, CODE_FIELDS[context]) };
      case "barcode":
        keys(e, [...base, "field", "format"]); codes++;
        if (typeof e.format !== "string" || !["CODE128", "EAN13"].includes(e.format)) return fail("UNSUPPORTED_FIELD", id);
        if (e.format === "EAN13" && (context !== "PRODUCT" || e.field !== "barcode")) return fail("UNSUPPORTED_FIELD", id);
        return { ...box, kind: "barcode", field: field(e.field, context, CODE_FIELDS[context]), format: e.format as "CODE128" | "EAN13" };
      case "logo":
        keys(e, [...base, "assetId"]);
        if (typeof e.assetId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(e.assetId)) return fail("BAD_ELEMENT", id);
        return { ...box, kind: "logo", assetId: e.assetId.toLowerCase() };
      case "line": case "frame":
        keys(e, [...base, "stroke"]); return { ...box, kind: e.kind, stroke: integer(e.stroke, 100, Math.min(2000, Math.floor(Math.min(box.width, box.height) / (e.kind === "frame" ? 2 : 1)))) };
      default: return fail("BAD_ELEMENT", id);
    }
  });
  if (codes > DESIGN_LIMITS.codes) return fail("TOO_MANY_ELEMENTS");
  if (stage === "PUBLISH" && context === "RECEIPT" && !elements.some(e => (e.kind === "qr" || e.kind === "barcode") && e.field === "packageQr")) return fail("UNSUPPORTED_FIELD");
  // Codes own their full box including quiet zone; other elements may not obscure it, regardless of layer order.
  if (stage === "PUBLISH") for (const c of elements.filter(e => e.kind === "qr" || e.kind === "barcode")) for (const e of elements) {
    if (e.id === c.id) continue;
    const boxes = e.kind === "frame" ? [
      { x: e.x, y: e.y, width: e.width, height: e.stroke },
      { x: e.x, y: e.y + e.height - e.stroke, width: e.width, height: e.stroke },
      { x: e.x, y: e.y, width: e.stroke, height: e.height },
      { x: e.x + e.width - e.stroke, y: e.y, width: e.stroke, height: e.height },
    ] : [e];
    if (boxes.some(b => c.x < b.x + b.width && c.x + c.width > b.x && c.y < b.y + b.height && c.y + c.height > b.y)) return fail("CODE_GEOMETRY", c.id);
  }
  return { schema: 1, context, width, height, margin, elements };
}

/** mm input to exact micrometres; UI zoom never changes this value. */
export function millimetresToMicrometres(raw: string): number {
  if (!/^\d{1,4}(?:[.,]\d{1,3})?$/.test(raw)) return fail("BAD_SIZE");
  const [whole = "0", fraction = ""] = raw.replace(",", ".").split(".");
  return integer(Number(whole) * 1000 + Number(fraction.padEnd(3, "0")), 1, 1_000_000);
}
export function defaultLabelDesign(context: LabelContext): LabelDesign {
  const codeField = CODE_FIELDS[context]?.[0]; if (!codeField) return fail("BAD_DOCUMENT");
  return parseLabelDesign({ schema: 1, context, width: 100_000, height: 50_000, margin: 2000, elements: [
    { id: "title", kind: "text", x: 5000, y: 8000, width: 55_000, height: 12_000, rotation: 0, locked: false, field: context === "LOCATION" ? "locationCode" : "name", text: null, fontSize: 5000, bold: true, align: "start" },
    { id: "code", kind: "qr", x: 68_000, y: 10_000, width: 28_000, height: 28_000, rotation: 0, locked: true, field: codeField },
  ] });
}

/** Server supplies tracking-policy fields; static text cannot impersonate a required real lot/date. */
export function prepareLabelForPrint(value: unknown, requiredFields: readonly LabelField[]): LabelDesign {
  const design = parseLabelDesign(value, "PUBLISH");
  const bound = new Set(design.elements.flatMap(e => (e.kind === "text" || e.kind === "barcode" || e.kind === "qr") && e.field !== null ? [e.field] : []));
  for (const required of requiredFields) {
    field(required, design.context);
    if (!bound.has(required)) return fail("UNSUPPORTED_FIELD");
  }
  return design;
}
