import { describe, expect, it } from "vitest";
import { autoMap, buildCsv, colLetter, detectHeader, fold, headerSignature, isGtin, setColumn, waiting } from "./mapping.ts";
import { colIndex, excelDate, excelNumber, isDateFormat, parseCsv, trimRows } from "./read.ts";

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

  it("T-1035: stok miktarı sütunu koli içi adete eşlenmez; ürün adı ve kodu bulunur", () => {
    const rows = [["Stok Kodu", "Ürün Adı", "Birim", "Barkod", "Miktar", "Son Kullanma"], ["URN-001", "Kırmızı Conta", "ADET", "8690000000011", "120", "46508"], ["URN-002", "Şeffaf Hortum", "METRE", "8690000000028", "45,5", "46539"]];
    const m = autoMap(rows, 0, "stok");
    expect(m.col).toMatchObject({ kod: 0, ad: 1, birim: 2, barkod: 3, koli: null });
    expect(m.state.koli).toBe("none");
    expect(waiting(m, "stok")).toEqual([]);
    const lines = buildCsv(rows, 0, m, "stok").text.replace(/^\uFEFF/, "").trim().split("\r\n");
    expect(lines[0]).toBe("kod;ad;temel birim;adet barkodu");
  });

  it("T-1035: yaygın muhasebe programı başlıkları (Logo, Mikro, Paraşüt)", () => {
    const cases: [string[], Record<string, number | null>][] = [
      [["Malzeme Kodu", "Malzeme Açıklaması", "Birim Seti", "Barkodu"], { kod: 0, ad: 1, barkod: 3 }],
      [["Stok Kodu", "Stok İsmi", "Birimi", "Stok Miktarı"], { kod: 0, ad: 1, birim: 2, koli: null }],
      [["Ürün/Hizmet Kodu", "Ürün/Hizmet Adı", "Barkod Numarası", "Birim", "Stok Miktarı", "Satış Fiyatı"], { kod: 0, ad: 1, barkod: 2, birim: 3, koli: null }],
      [["Kod", "Ad", "Koli", "Koli Barkodu"], { kod: 0, ad: 1, koli: 2, kbarkod: 3 }],
    ];
    for (const [head, want] of cases) {
      const m = autoMap([head, head.map(() => "")], 0, "stok");
      expect(m.col, head.join(" | ")).toMatchObject(want);
    }
  });

  it("T-1035: Excel tarih hücreleri tarih olarak okunur", () => {
    expect(excelDate(46508)).toBe("01.05.2027");
    expect(excelDate(45658)).toBe("01.01.2025");
    expect(excelDate(61)).toBe("01.03.1900");
    expect(excelDate(45658.5)).toBe("01.01.2025 12:00");
    expect(excelDate(44197, true)).toBe("02.01.2025");
    expect(isDateFormat(14, undefined)).toBe(true);
    expect(isDateFormat(0, undefined)).toBe(false);
    expect(isDateFormat(164, "dd/mm/yyyy")).toBe(true);
    expect(isDateFormat(165, '#,##0.00 "TL"')).toBe(false);
    expect(isDateFormat(166, "[Red]0.00")).toBe(false);
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
