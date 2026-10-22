// T-1006: yolculuk adım ekranları — anahtar listesi domain ile aynı; adım gerçek ekranı `?yol=` ile açar; seçime göre yol değişir.
import { describe, expect, it } from "vitest";
import { JOURNEY_STEPS } from "@wms/domain/onboarding/journey";
import { delikKirp } from "../kalip/perde.tsx";
import { STEP_KEYS, isStepKey, ringDash, stepPlan, stopFor, type JourneyData } from "./steps.ts";

const base = "/t/acme";
const j = (over: Partial<JourneyData> = {}): JourneyData => ({
  steps: [],
  makesProduction: null,
  cardSource: null,
  openingStockWanted: null,
  done: 0,
  total: 8,
  complete: false,
  dismissed: false,
  tour: null,
  next: "cards",
  hints: { warehouseId: null, recipeId: null, parasut: { connected: false, openingEnabled: false, openingTakenAt: null } },
  ...over,
});

describe("yolculuk adımları", () => {
  it("anahtarlar domain JOURNEY_STEPS ile aynı sırada", () => {
    expect([...STEP_KEYS]).toEqual([...JOURNEY_STEPS]);
    expect(isStepKey("labels")).toBe(true);
    expect(isStepKey("evil")).toBe(false);
    expect(isStepKey(null)).toBe(false);
  });

  it("kartlar: Excel → Ürünler (Excel düğmesi) → Excel'den aktar (Dosya seç); Paraşüt → Entegrasyon", () => {
    const p = stepPlan(base, "cards", j(), "EXCEL");
    expect(p.href).toBe("/t/acme/items");
    expect(stopFor(p, "/t/acme/items")).toMatchObject({ target: "excel", hint: "cardsItems" });
    expect(stopFor(p, "/t/acme/import")).toMatchObject({ target: "main", hint: "cardsExcel" });
    expect(stopFor(p, "/t/acme")).toBeNull();
    expect(stepPlan(base, "cards", j(), "PARASUT")).toEqual({ href: "/t/acme/integrations", stops: [{ path: "/t/acme/integrations", target: "main", hint: "cardsParasut" }] });
  });

  it("stok: Paraşüt açılış stoku açık ve alınmadıysa Şimdi al düğmesi hedeflenir", () => {
    const d = j({ hints: { warehouseId: "w", recipeId: null, parasut: { connected: true, openingEnabled: true, openingTakenAt: null } } });
    expect(stepPlan(base, "stock", d)).toEqual({ href: "/t/acme/integrations", stops: [{ path: "/t/acme/integrations", target: "opening-pull", hint: "stockParasut" }] });
    const taken = j({ hints: { warehouseId: "w", recipeId: null, parasut: { connected: true, openingEnabled: true, openingTakenAt: "2026-10-22T10:00:00.000Z" } } });
    expect(stepPlan(base, "stock", taken).href).toBe("/t/acme/stock/documents?new=STOCK_IN");
    expect(stepPlan(base, "stock", j({ cardSource: "EXCEL", openingStockWanted: true })).href).toBe("/t/acme/import?tur=acilis");
  });

  it("raflar, etiket, üretim: depo/reçete varsa o ekran; depo ayrıntısı önek eşleşir", () => {
    const d = j({ hints: { warehouseId: "a b", recipeId: "r", parasut: { connected: false, openingEnabled: false, openingTakenAt: null } } });
    const sh = stepPlan(base, "shelves", d);
    expect(sh.href).toBe("/t/acme/warehouses/a%20b");
    expect(stopFor(sh, "/t/acme/warehouses/a%20b")).toMatchObject({ hint: "shelves" });
    expect(stopFor(sh, "/t/acme/warehouses")).toMatchObject({ hint: "warehouse" });
    expect(stepPlan(base, "labels", d).href).toBe("/t/acme/labels?warehouse=a%20b&subtree=1");
    expect(stepPlan(base, "order", d).href).toBe("/t/acme/production?id=r");
    expect(stepPlan(base, "shelves", j()).href).toBe("/t/acme/warehouses");
  });

  it("halka: pay/payda çevreye oranlanır", () => {
    expect(ringDash(3, 8)).toBe("35.34 94.25");
    expect(ringDash(0, 0)).toBe("0.00 94.25");
    expect(ringDash(9, 8)).toBe("94.25 94.25");
  });

  it("delikli perde: çift-tek kırpma, hedef koordinatı", () => {
    expect(delikKirp({ x: 10.4, y: -3, w: 50, h: 40 })).toBe("polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, 10px 0px, 60px 0px, 60px 37px, 10px 37px, 10px 0px)");
  });
});
