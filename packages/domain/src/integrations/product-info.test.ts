import { describe, expect, it } from "vitest";
import { productSourceInfo } from "./product-info.ts";
import type { JsonApiResource } from "./parasut.ts";

const record = (attributes: Record<string, unknown>, relationships: Record<string, unknown> = {}): JsonApiResource => ({ id: "1", type: "products", attributes, relationships });

describe("fiyatsız kaynak ürün bilgisi", () => {
  it("yalnız izinli alanları alır; fiyat/vergi/döviz/stok/ham alan saklamaz", () => {
    expect(productSourceInfo(record({ unit: "KG", gtip: "4008.21", archived: false, inventory_tracking: true,
      list_price: 120, buying_price: 100, currency: "TRY", vat_rate: 20, stock_count: 999, initial_stock_count: 500, secret: "ignored" })))
      .toEqual({ unit: "KG", gtip: "4008.21", archived: false, inventoryTracking: true });
  });
  it("eksik ile açık null ayrıdır", () => {
    expect(productSourceInfo(record({}))).toEqual({});
    expect(productSourceInfo(record({ gtip: null, archived: null }, { category: { data: null } })))
      .toEqual({ gtip: null, archived: null, categoryId: null, categoryName: null });
  });
  it("kategori ilişkisini tür ve kimlikle bulur", () => {
    expect(productSourceInfo(record({}, { category: { data: { id: "4", type: "item_categories" } } }), [
      { id: "4", type: "contacts", attributes: { name: "Yanlış" }, relationships: {} },
      { id: "4", type: "item_categories", attributes: { name: " Granüller ", category_type: "Product" }, relationships: {} },
    ])).toEqual({ categoryId: "4", categoryName: "Granüller" });
  });
  it.each([true, 42, {}, "x".repeat(65), "a\u0000b"])("bozuk GTİP satırı reddedilir: %j", (gtip) => {
    expect(() => productSourceInfo(record({ gtip }))).toThrow();
  });
  it.each(["true", 1, {}])("yanlış bayrak kabul edilmez: %j", (archived) => {
    expect(() => productSourceInfo(record({ archived }))).toThrow();
  });
  it("eksik veya yanlış türde kategori eski kategori adıyla karışmaz", () => {
    const r = record({}, { category: { data: { id: "4", type: "item_categories" } } });
    expect(() => productSourceInfo(r)).toThrow();
    expect(() => productSourceInfo(r, [{ id: "4", type: "item_categories", attributes: { name: "Cariler", category_type: "Contact" }, relationships: {} }])).toThrow();
    expect(() => productSourceInfo(record({}, { category: { data: { id: "4", type: "contacts" } } }))).toThrow();
  });
});
