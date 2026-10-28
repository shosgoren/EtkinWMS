// T-1006: yolculuk adım ekranları — anahtar listesi domain ile aynı; adım gerçek ekranı `?yol=` ile açar; seçime göre yol değişir.
import { describe, expect, it } from "vitest";
import { JOURNEY_STEPS } from "@wms/domain/onboarding/journey";
import { delikKirp } from "../kalip/perde.tsx";
import { dz } from "../../../design/yolculuk-tokens.ts";
import { STEP_KEYS, STEP_UI, firstOpen, isStepKey, ringDash, stepPlan, stopFor, stripState, type JourneyData } from "./steps.ts";

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

  it("kartlar: Excel → Excel'den aktar (ürün türü seçili, Dosya seç; T-1092 listelerde Excel düğmesi yok); Paraşüt → Entegrasyon", () => {
    const p = stepPlan(base, "cards", j(), "EXCEL");
    expect(p.href).toBe("/t/acme/import?tur=urun");
    expect(stopFor(p, "/t/acme/items")).toBeNull();
    expect(stopFor(p, "/t/acme/import")).toMatchObject({ target: "main", hint: "cardsExcel" });
    expect(stopFor(p, "/t/acme")).toBeNull();
    expect(stepPlan(base, "cards", j(), "PARASUT")).toEqual({ href: "/t/acme/integrations", stops: [{ path: "/t/acme/integrations", target: "main", hint: "cardsParasut" }] });
  });

  it("her adım rengi yolculuk paletinde (kaynakta olmayan renk ekranı düşürür; T-1054)", () => {
    for (const k of STEP_KEYS) expect(() => dz(STEP_UI[k].color), k).not.toThrow();
  });

  it("cariler (T-1054): depo ve raflardan sonra; Paraşüt → Entegrasyon, aksi Excel'den cari aktarımı (ya da Cariler ekranı)", () => {
    expect(STEP_KEYS.indexOf("parties")).toBe(STEP_KEYS.indexOf("shelves") + 1);
    expect(stepPlan(base, "parties", j(), "PARASUT")).toEqual({ href: "/t/acme/integrations", stops: [{ path: "/t/acme/integrations", target: "main", hint: "partiesParasut" }] });
    const p = stepPlan(base, "parties", j(), "EXCEL");
    expect(p.href).toBe("/t/acme/import?tur=cari");
    expect(stopFor(p, "/t/acme/import")).toMatchObject({ hint: "partiesExcel" });
    expect(stopFor(p, "/t/acme/parties")).toMatchObject({ hint: "parties" });
    expect(stepPlan(base, "parties", j(), null).href).toBe("/t/acme/import?tur=cari");
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
    // T-1111: köşeler yuvarlatılmış (en çok 18 px, kısa kenarın yarısı).
    expect(delikKirp({ x: 10.4, y: -3, w: 50, h: 40 })).toBe('path(evenodd, "M0 0H100000V100000H0Z M28 0H42A18 18 0 0 1 60 18V19A18 18 0 0 1 42 37H28A18 18 0 0 1 10 19V18A18 18 0 0 1 28 0Z")');
    // T-1100: birden çok delik (iş formu + KAYDET) — her halka köşeden ayrı açılır.
    expect(delikKirp([{ x: 10, y: 10, w: 10, h: 10 }, { x: 50, y: 60, w: 5, h: 5 }])).toBe(
      'path(evenodd, "M0 0H100000V100000H0Z M15 10H15A5 5 0 0 1 20 15V15A5 5 0 0 1 15 20H15A5 5 0 0 1 10 15V15A5 5 0 0 1 15 10Z M52 60H53A2 2 0 0 1 55 62V63A2 2 0 0 1 53 65H52A2 2 0 0 1 50 63V62A2 2 0 0 1 52 60Z")',
    );
  });
});

describe("T-1036 sıra ve adım şeridi", () => {
  const st = (key: JourneyData["steps"][number]["key"], done = false, skipped = false) => ({ key, done, skipped, count: done ? 1 : 0 });
  const steps = [st("cards"), st("shelves", true), st("stock"), st("labels", false, true), st("people")];
  it("geride kalan açık adım önce: depo bitti, kartlar yapılmadı → kartlar", () => {
    expect(firstOpen(steps)).toBe("cards");
    expect(firstOpen([st("cards", true), st("shelves", true), st("stock")])).toBe("stock");
  });
  it("kısa tur yalnız üç adımda arar; üçü de bitince null (tur kapanır), atlanan sayılmaz", () => {
    expect(firstOpen(steps, ["cards", "shelves", "stock"])).toBe("cards");
    expect(firstOpen([st("cards", true), st("shelves", true), st("stock", true), st("people")], ["cards", "shelves", "stock"])).toBeNull();
    expect(firstOpen([st("labels", false, true)])).toBeNull();
  });
  it("şerit: biten tamam, atlanan atlandı, şu anki şimdi, kalan bekliyor", () => {
    expect(steps.map((s) => stripState(s, "stock"))).toEqual(["todo", "done", "now", "skip", "todo"]);
  });
});
