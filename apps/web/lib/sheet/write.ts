// T-981b: dışa aktarma için en küçük .xlsx yazıcısı (SUNUCU; Node). Yeni bağımlılık yoktur — okuyucu (`read.ts`) gibi: .xlsx bir ZIP içindeki
// XML'dir; ZIP `node:zlib` (deflate-raw + crc32) ile, XML elle yazılır. Tek sayfa, ilk satır kalın başlık, sütun genişlikleri içerikten.
// Her hücre METİN (`inlineStr`): barkodun baştaki sıfırı, uzun kodlar ve "12,5" gibi Türkçe miktarlar Excel'de bozulmaz; formül (`<f>`)
// hiç yazılmaz, bu yüzden "=..." ile başlayan değer formül olarak çalışmaz (CSV formül enjeksiyonu riski yok). XML'de geçersiz denetim
// karakterleri atılır. Dosya `read.ts` ile geri okunur (Aktar), sütun başlıkları içe aktarma şablonuyla aynıdır.
import { crc32, deflateRawSync } from "node:zlib";

const XML_BAD = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

export function xmlText(v: string): string {
  return v.replace(XML_BAD, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function colRef(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Excel sayfa adı: en çok 31 karakter, `[]:*?/\` yok. */
export function sheetName(raw: string): string {
  const v = raw.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31);
  return v === "" ? "Sayfa1" : v;
}

function sheetXml(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = headers.map((h, i) => Math.min(60, Math.max(10, h.length + 2, ...rows.slice(0, 200).map((r) => (r[i] ?? "").length + 2))));
  const cell = (v: string, r: number, c: number, s: number): string =>
    v === "" ? "" : `<c r="${colRef(c)}${r}" t="inlineStr"${s === 0 ? "" : ` s="${s}"`}><is><t xml:space="preserve">${xmlText(v)}</t></is></c>`;
  const lines = [
    `<row r="1">${headers.map((h, c) => cell(h, 1, c, 1)).join("")}</row>`,
    ...rows.map((row, i) => `<row r="${i + 2}">${row.map((v, c) => cell(v, i + 2, c, 0)).join("")}</row>`),
  ];
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` +
    `<sheetData>${lines.join("")}</sheetData></worksheet>`
  );
}

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
  `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
  `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
  `</Types>`;
const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
  `</Relationships>`;
const WORKBOOK_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  `</Relationships>`;
const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="2"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/></cellXfs>` +
  `</styleSheet>`;

function workbookXml(name: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${xmlText(sheetName(name))}" sheetId="1" r:id="rId1"/></sheets></workbook>`
  );
}

/** ZIP (deflate) arşivi; dosya adları UTF-8 bayrağıyla. Sabit tarih (1 Ocak 2026): aynı içerik aynı bayt. */
export function zip(files: readonly { readonly name: string; readonly data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const time = 0;
  const date = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const f of files) {
    const name = Buffer.from(enc.encode(f.name));
    const raw = Buffer.from(f.data);
    const data = deflateRawSync(raw);
    const crc = crc32(raw) >>> 0;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x0800, 6);
    h.writeUInt16LE(8, 8);
    h.writeUInt16LE(time, 10);
    h.writeUInt16LE(date, 12);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(data.length, 18);
    h.writeUInt32LE(raw.length, 22);
    h.writeUInt16LE(name.length, 26);
    h.writeUInt16LE(0, 28);
    local.push(h, name, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(time, 12);
    c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += h.length + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, cd, end]));
}

/** Tek sayfalık .xlsx (başlık + satırlar; tüm hücreler metin). */
export function buildXlsx(name: string, headers: readonly string[], rows: readonly (readonly string[])[]): Uint8Array {
  const enc = new TextEncoder();
  return zip([
    { name: "[Content_Types].xml", data: enc.encode(CONTENT_TYPES) },
    { name: "_rels/.rels", data: enc.encode(ROOT_RELS) },
    { name: "xl/workbook.xml", data: enc.encode(workbookXml(name)) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(WORKBOOK_RELS) },
    { name: "xl/styles.xml", data: enc.encode(STYLES) },
    { name: "xl/worksheets/sheet1.xml", data: enc.encode(sheetXml(headers, rows)) },
  ]);
}
