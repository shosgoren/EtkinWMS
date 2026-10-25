// T-1035: ERP/muhasebe programlarının (.NET OpenXML SDK) yazdığı biçimde .xlsx — ad alanı önekli öğeler (`<x:row>`), paylaşılan metinler,
// tarih biçimli sayı hücresi (numFmtId 14) ve sayı hücreleri. Uygulamanın kendi yazıcısı (`lib/sheet/write.ts`) bu biçimi üretmez; okuyucu
// eskiden bu dosyayı "boş" sanıyordu. İçerik sentetiktir (G-09).
import { zip } from "../../../apps/web/lib/sheet/write.ts";

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const esc = (v: string): string => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const col = (i: number): string => String.fromCharCode(65 + i);

/** Hücre: metin (paylaşılan), `{ n }` sayı, `{ date }` Excel tarih seri sayısı. */
export type ErpCell = string | { readonly n: number } | { readonly date: number };

export function erpXlsx(rows: readonly (readonly ErpCell[])[]): { name: string; mimeType: string; buffer: Buffer } {
  const shared: string[] = [];
  const sst = (v: string): number => {
    const i = shared.indexOf(v);
    if (i >= 0) return i;
    shared.push(v);
    return shared.length - 1;
  };
  const sheetRows = rows.map((r, ri) => {
    const cells = r.map((c, ci) => {
      const ref = `${col(ci)}${ri + 1}`;
      if (typeof c === "string") return `<x:c r="${ref}" t="s"><x:v>${sst(c)}</x:v></x:c>`;
      if ("date" in c) return `<x:c r="${ref}" s="1"><x:v>${c.date}</x:v></x:c>`;
      return `<x:c r="${ref}"><x:v>${c.n}</x:v></x:c>`;
    });
    return `<x:row r="${ri + 1}">${cells.join("")}</x:row>`;
  });
  const enc = new TextEncoder();
  const files = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="R1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="utf-8"?><x:workbook xmlns:x="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><x:sheets><x:sheet name="Stok Listesi" sheetId="1" r:id="R2"/></x:sheets></x:workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="R2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml"/><Relationship Id="R3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="/xl/sharedStrings.xml"/><Relationship Id="R4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="/xl/styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: `<?xml version="1.0" encoding="utf-8"?><x:styleSheet xmlns:x="${NS}"><x:cellXfs count="2"><x:xf numFmtId="0"/><x:xf numFmtId="14" applyNumberFormat="1"/></x:cellXfs></x:styleSheet>` },
    { name: "xl/worksheets/sheet1.xml", data: `<?xml version="1.0" encoding="utf-8"?><x:worksheet xmlns:x="${NS}"><x:sheetData>${sheetRows.join("")}</x:sheetData></x:worksheet>` },
    { name: "xl/sharedStrings.xml", data: `<?xml version="1.0" encoding="utf-8"?><x:sst xmlns:x="${NS}">${shared.map((s) => `<x:si><x:t>${esc(s)}</x:t></x:si>`).join("")}</x:sst>` },
  ];
  return {
    name: "erp-stok-listesi.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(zip(files.map((f) => ({ name: f.name, data: enc.encode(f.data) })))),
  };
}
