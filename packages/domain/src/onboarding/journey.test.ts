// T-1006: kurulum yolculuğu saf hesabı — tamamlanma gerçek sayıdan, atlanan adım paydadan düşer, üretim yapmayan firmada 5–6 görünmez.
import { describe, expect, it } from "vitest";
import { JOURNEY_STEPS, canSeeJourney, computeJourney, type JourneyStep } from "./journey.ts";

const zero = (): Record<JourneyStep, number> => Object.fromEntries(JOURNEY_STEPS.map((k) => [k, 0])) as Record<JourneyStep, number>;

describe("computeJourney", () => {
  it("boş kiracı: 0/8, sıradaki kartlar", () => {
    const v = computeJourney({ counts: zero(), skipped: [], makesProduction: null });
    expect(v.steps.map((s) => s.key)).toEqual([...JOURNEY_STEPS]);
    expect({ done: v.done, total: v.total, complete: v.complete, next: v.next }).toEqual({ done: 0, total: 8, complete: false, next: "cards" });
  });

  it("veri oluşunca tamam; sıradaki ilk eksik adım", () => {
    const v = computeJourney({ counts: { ...zero(), cards: 12, shelves: 3, stock: 1 }, skipped: [], makesProduction: null });
    expect(v.done).toBe(3);
    expect(v.next).toBe("labels");
    expect(v.steps.find((s) => s.key === "cards")).toEqual({ key: "cards", count: 12, done: true, skipped: false });
  });

  it("atlanan adım paydadan düşer ve sıradaki olmaz", () => {
    const v = computeJourney({ counts: { ...zero(), cards: 1 }, skipped: ["shelves"], makesProduction: true });
    expect(v.total).toBe(7);
    expect(v.done).toBe(1);
    expect(v.next).toBe("stock");
    expect(v.steps.find((s) => s.key === "shelves")?.skipped).toBe(true);
  });

  it("üretim yapmayan firmada reçete ve üretim emri hiç görünmez", () => {
    const v = computeJourney({ counts: zero(), skipped: [], makesProduction: false });
    expect(v.steps.map((s) => s.key)).toEqual(["cards", "shelves", "stock", "labels", "people", "task"]);
    expect(v.total).toBe(6);
  });

  it("hepsi tamam (atlananlar hariç) → complete", () => {
    const counts = { ...zero(), cards: 1, shelves: 1, stock: 1, labels: 1, people: 1, task: 1 };
    const v = computeJourney({ counts, skipped: ["bom", "order"], makesProduction: null });
    expect({ done: v.done, total: v.total, complete: v.complete, next: v.next }).toEqual({ done: 6, total: 6, complete: true, next: null });
  });

  it("tıklama tamam saymaz: sayı 0 iken atlanmamış adım tamam değil", () => {
    const v = computeJourney({ counts: zero(), skipped: [], makesProduction: true });
    expect(v.steps.every((s) => !s.done)).toBe(true);
  });
});

describe("canSeeJourney", () => {
  it("yalnız hesap sahibi ve depo yöneticisi", () => {
    expect(canSeeJourney(["TENANT_ADMIN"])).toBe(true);
    expect(canSeeJourney(["WAREHOUSE_MANAGER"])).toBe(true);
    expect(canSeeJourney(["PICKER"])).toBe(false);
    expect(canSeeJourney(["COUNTER"])).toBe(false);
    expect(canSeeJourney(["READ_ONLY"])).toBe(false);
    expect(canSeeJourney([])).toBe(false);
  });
});
