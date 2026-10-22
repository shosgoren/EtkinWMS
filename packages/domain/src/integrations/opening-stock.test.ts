// T-1006: Paraşüt açılış stoku miktar okuma (saf): yalnız ≥ 0 ondalık, en çok 6 hane; izlemesiz ürün ve okunamayan değer `null`.
import { describe, expect, it } from "vitest";
import { providerQuantity, sqlstateIn } from "./opening-stock.ts";

const r = (attributes: Record<string, unknown>) => ({ id: "1", type: "products", attributes, relationships: {} });

describe("providerQuantity", () => {
  it.each([
    [12, "12"],
    ["12.0", "12"],
    ["7.250", "7.25"],
    [0, "0"],
    ["0003", "3"],
  ])("%s → %s", (raw, want) => {
    expect(providerQuantity(r({ stock_count: raw }))).toBe(want);
  });

  it.each([[-1], ["-2"], ["1e3"], ["abc"], [null], [undefined], [Number.NaN], ["1.1234567"]])("okunamayan %s → null", (raw) => {
    expect(providerQuantity(r({ stock_count: raw }))).toBeNull();
  });

  it("stok takibi kapalı ürün sayılmaz", () => {
    expect(providerQuantity(r({ stock_count: 5, inventory_tracking: false }))).toBeNull();
  });
});

describe("sqlstateIn", () => {
  it("postgres.js (constraint_name) ve node-postgres (constraint) zincirinden kodu ve kısıtı okur", () => {
    expect(sqlstateIn({ message: "x", cause: { code: "23505", constraint_name: "integrations_opening_stock_once" } })).toEqual({ code: "23505", constraint: "integrations_opening_stock_once" });
    expect(sqlstateIn({ code: "23505", constraint: "integrations_opening_stock_once" })).toEqual({ code: "23505", constraint: "integrations_opening_stock_once" });
    expect(sqlstateIn({ code: "INTERNAL", cause: { code: "55000" } })).toEqual({ code: "55000", constraint: null });
    expect(sqlstateIn(new Error("x"))).toBeNull();
  });
});
