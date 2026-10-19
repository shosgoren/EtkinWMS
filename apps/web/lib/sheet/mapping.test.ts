import { describe, expect, it } from "vitest";
import { autoMap, buildCsv, colLetter, detectHeader, fold, headerSignature, isGtin, setColumn, waiting } from "./mapping.ts";
import { colIndex, excelNumber, parseCsv, trimRows } from "./read.ts";

const stok = [
  ["ÖRNEK FİRMA A.Ş. MALZEME LİSTESİ"],
  [],
  ["Stok Kodu", "Malzeme Açıklaması", "Birimi", "Barkod", "Koli Mik.", "Koli Barkod", "Fiyat"],
  ["C-040", "Conta 40 mm NBR", "ADET", "8690001000401", "50", "18690001000408", "4,20"],
  ["O-2203", "O-ring", "ADET", "8690001022031", "200", "", "1,15"],
  ["", "", "", "", "", "", ""],
];

describe("T-427 şablonsuz eşleştirme", () => {
  it("Türkçe başlık katlama", () => {
    expect(fold("Koli Mik.")).toBe("koli mik");
    expect(fold("  ÜRÜN  KODU ")).toBe("urun kodu");
    expect(fold("Işık Ağırlığı")).toBe("isik agirligi");
  });

  it("GTIN denetim hanesi", () => {
    expect(isGtin("4006381333931")).toBe(true);
    expect(isGtin("4006381333932")).toBe(false);
    expect(isGtin("12345")).toBe(false);
  });

  it("üstte firma adı olan dosyada başlık satırını bulur ve alanları eşler", () => {
    const h = detectHeader(stok, "stok");
    expect(h).toBe(2);
    const m = autoMap(stok, h, "stok");
    expect(m.col).toMatchObject({ kod: 0, ad: 1, birim: 2, barkod: 3, koli: 4, kbarkod: 5 });
    expect(m.state.kod).toBe("auto");
    expect(waiting(m, "stok")).toEqual([]);
  });

  it("bulunamayan zorunlu alan bekler; seçilince bir sütun tek alana gider", () => {
    const rows = [["CARİ", "Tanımsız", "Sayı"], ["A-1", "x", "3"]];
    const m = autoMap(rows, 0, "acilis");
    expect(waiting(m, "acilis").length).toBeGreaterThan(0);
    const m2 = setColumn(setColumn(m, "urun", 0), "raf", 0);
    expect(m2.col.urun).toBeNull();
    expect(m2.col.raf).toBe(0);
    expect(m2.state.raf).toBe("user");
  });

  it("içerikten miktar sütununu önerir (DOĞRU MU?)", () => {
    const rows = [["Ürün Kodu", "Lokasyon", "Sütun3"], ["C-040", "A-03", "120"], ["O-22", "A-04", "300"]];
    const m = autoMap(rows, 0, "acilis");
    expect(m.col.miktar).toBe(2);
    expect(m.state.miktar).toBe("sug");
    expect(waiting(m, "acilis")).toEqual(["miktar"]);
  });

  it("sunucu biçiminde CSV üretir; boş satırı ve atlananları çıkarır, satır eşlemesini tutar", () => {
    const m = autoMap(stok, 2, "stok");
    const out = buildCsv(trimRows(stok), 2, m, "stok", new Set([5]));
    const lines = out.text.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("kod;ad;temel birim;koli içi adet;adet barkodu;koli barkodu");
    expect(lines[1]).toBe("C-040;Conta 40 mm NBR;ADET;50;8690001000401;18690001000408");
    expect(lines).toHaveLength(2);
    expect(out.rowMap[2]).toBe(4);
  });

  it("başlık imzası ve sütun harfi", () => {
    expect(headerSignature(["Stok Kodu", "Ad"])).toBe("stok kodu|ad");
    expect(colLetter(0)).toBe("A");
    expect(colLetter(26)).toBe("AA");
    expect(colIndex("AA12")).toBe(26);
  });

  it("CSV ayrıştırma: noktalı virgül, tırnak, satır sonu", () => {
    expect(parseCsv('kod;ad\r\nA;"x;y"\r\nB;"a""b"\n')).toEqual([["kod", "ad"], ["A", "x;y"], ["B", 'a"b']]);
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("Excel sayıları Türkçe görünüme", () => {
    expect(excelNumber("50")).toBe("50");
    expect(excelNumber("4.2")).toBe("4,2");
    expect(excelNumber("0.30000000000000004")).toBe("0,3");
    expect(excelNumber("8690001000401")).toBe("8690001000401");
  });
});
