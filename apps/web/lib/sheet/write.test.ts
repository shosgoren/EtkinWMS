// T-981b: .xlsx yazıcı — ZIP yapısı geçerli (CRC, boyut), hücreler metin (formül yok), XML kaçışı, denetim karakteri atılır; dışa aktarma
// başlıkları Aktar eşleştirmesinde birebir (BULDUM) bulunur — indirilen dosya şablonsuz geri yüklenebilir.
import { crc32, inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { EXPORT_HEADERS } from "@wms/domain/onboarding/data-export";
import { autoMap, waiting, type ImportKindKey } from "./mapping.ts";
import { buildXlsx, sheetName, xmlText } from "./write.ts";

/** Yerel dosya başlıklarından ZIP içeriği (yalnız test). */
function unzip(b: Uint8Array): Map<string, string> {
  const buf = Buffer.from(b);
  const out = new Map<string, string>();
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const crc = buf.readUInt32LE(p + 14);
    const csize = buf.readUInt32LE(p + 18);
    const usize = buf.readUInt32LE(p + 22);
    const nlen = buf.readUInt16LE(p + 26);
    const xlen = buf.readUInt16LE(p + 28);
    const name = buf.subarray(p + 30, p + 30 + nlen).toString("utf8");
    const data = inflateRawSync(buf.subarray(p + 30 + nlen + xlen, p + 30 + nlen + xlen + csize));
    expect(data.length).toBe(usize);
    expect(crc32(data) >>> 0).toBe(crc);
    out.set(name, data.toString("utf8"));
    p += 30 + nlen + xlen + csize;
  }
  expect(buf.readUInt32LE(buf.length - 22)).toBe(0x06054b50);
  return out;
}

describe("T-981b xlsx yazıcı", () => {
  it("geçerli ZIP; zorunlu parçalar; başlık kalın, hücreler metin; formül yazılmaz; kaçış ve denetim karakteri", () => {
    const x = buildXlsx("Ürünler", ["kod", "ad"], [["=HYPERLINK(\"x\")", "A & B <c>"], ["0012", "satır\u0001sonu"]]);
    const files = unzip(x);
    expect([...files.keys()]).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml"]);
    const sheet = files.get("xl/worksheets/sheet1.xml") ?? "";
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain('<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">kod</t></is></c>');
    expect(sheet).toContain("=HYPERLINK(&quot;x&quot;)");
    expect(sheet).toContain("A &amp; B &lt;c&gt;");
    expect(sheet).toContain(">0012<");
    expect(sheet).toContain("satırsonu");
    expect(files.get("xl/workbook.xml")).toContain('name="Ürünler"');
  });

  it("aynı içerik aynı bayt; boş sayfa adı ve yasak karakter", () => {
    expect(Buffer.from(buildXlsx("A", ["x"], [["1"]])).equals(Buffer.from(buildXlsx("A", ["x"], [["1"]])))).toBe(true);
    expect(sheetName("a/b:c*d?e[f]")).toBe("a b c d e f");
    expect(sheetName("")).toBe("Sayfa1");
    expect(sheetName("x".repeat(40))).toHaveLength(31);
    expect(xmlText('"<&>')).toBe("&quot;&lt;&amp;&gt;");
  });

  it("dışa aktarma başlıkları Aktar'da eksiksiz otomatik eşlenir (geri yükleme şablonsuz)", () => {
    const pairs: [keyof typeof EXPORT_HEADERS, ImportKindKey][] = [
      ["items", "stok"],
      ["parties", "cari"],
      ["warehouses", "depo"],
      ["locations", "raf"],
      ["stock", "acilis"],
    ];
    for (const [exp, kind] of pairs) {
      const head = [...EXPORT_HEADERS[exp]];
      const m = autoMap([head, head.map(() => "x")], 0, kind);
      // Her başlık bir alana BULDUM (auto) ile gider; bekleyen zorunlu alan yok.
      expect(Object.values(m.state).filter((s) => s === "auto")).toHaveLength(head.length);
      expect(waiting(m, kind)).toEqual([]);
    }
  });
});
