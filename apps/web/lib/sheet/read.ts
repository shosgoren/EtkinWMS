// T-427: kullanıcının kendi Excel/CSV dosyasını TARAYICIDA tabloya (string[][]) çevirir. Yeni bağımlılık yoktur: .xlsx bir ZIP içindeki XML'dir;
// ZIP'i tarayıcının `DecompressionStream("deflate-raw")` ile, XML'i `DOMParser` ile okuruz. Yalnız hücre DEĞERLERİ okunur (formül sonucu `<v>`;
// formül çalıştırılmaz). Eski ikili .xls (BIFF) okunmaz: kullanıcıya "Excel'de .xlsx olarak kaydet" denir.
// Sınırlar (sıkıştırma bombasına karşı): dosya ≤ 10 MB, açılmış her parça ≤ 40 MB, satır ≤ IMPORT_MAX_ROWS + 10, sütun ≤ 40, hücre ≤ 1.000 karakter.
// Sunucu her şeyi yeniden doğrular; buradaki tablo yalnız eşleştirme önizlemesi ve sunucuya gidecek düz CSV'nin kaynağıdır.

export const SHEET_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const SHEET_MAX_PART_BYTES = 40 * 1024 * 1024;
export const SHEET_MAX_COLS = 40;
export const SHEET_MAX_CELL = 1000;

export type SheetErrorCode = "TOO_BIG" | "XLS_OLD" | "UNREADABLE" | "EMPTY" | "TOO_MANY_ROWS" | "TOO_MANY_COLS";
export class SheetError extends Error {
  readonly code: SheetErrorCode;
  constructor(code: SheetErrorCode) {
    super(code);
    this.code = code;
  }
}

export interface Sheet {
  readonly name: string;
  readonly rows: readonly (readonly string[])[];
}
export interface Workbook {
  readonly sheets: readonly Sheet[];
}

/** Dosyayı türüne göre okur (.xlsx / .csv / .txt). `maxRows`: başlık dahil okunacak en çok satır (fazlası hata). */
export async function readWorkbook(file: File, maxRows: number): Promise<Workbook> {
  if (file.size > SHEET_MAX_FILE_BYTES) throw new SheetError("TOO_BIG");
  if (file.size === 0) throw new SheetError("EMPTY");
  const buf = new Uint8Array(await file.arrayBuffer());
  // ZIP imzası "PK\x03\x04" → xlsx; OLE imzası D0 CF 11 E0 → eski .xls.
  if (buf[0] === 0x50 && buf[1] === 0x4b) return readXlsx(buf, maxRows);
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) throw new SheetError("XLS_OLD");
  const text = decodeText(buf);
  return { sheets: [{ name: file.name.replace(/\.[^.]+$/, "").toLocaleUpperCase("tr"), rows: limitRows(parseCsv(text), maxRows) }] };
}

function decodeText(buf: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, "");
  } catch {
    // Türkçe Excel'in eski "CSV (virgülle ayrılmış)" çıktısı Windows-1254'tür.
    return new TextDecoder("windows-1254").decode(buf);
  }
}

function limitRows(rows: string[][], maxRows: number): string[][] {
  const out = trimRows(rows);
  if (out.length === 0) throw new SheetError("EMPTY");
  if (out.length > maxRows) throw new SheetError("TOO_MANY_ROWS");
  if (out.some((r) => r.length > SHEET_MAX_COLS)) throw new SheetError("TOO_MANY_COLS");
  return out;
}

/** Sondaki boş satırları ve her satırın sonundaki boş hücreleri atar; hücreleri kırpar ve 1.000 karakterle sınırlar. */
export function trimRows(rows: readonly (readonly string[])[]): string[][] {
  const out = rows.map((r) => {
    const cells = r.map((c) => c.trim().slice(0, SHEET_MAX_CELL));
    while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
    return cells;
  });
  while (out.length > 0 && (out[out.length - 1]?.length ?? 0) === 0) out.pop();
  return out;
}

/** CSV: ayırıcı (`;` `,` sekme) ilk dolu satırdan seçilir; çift tırnak ve tırnak içi satır sonu desteklenir. */
export function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  const count = (ch: string): number => first.split(ch).length - 1;
  const sep = [";", "\t", ","].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ";");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// --- xlsx ------------------------------------------------------------------------------------------------------------

interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly compSize: number;
  readonly size: number;
  readonly offset: number;
}

function u16(b: Uint8Array, o: number): number {
  return (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
}
function u32(b: Uint8Array, o: number): number {
  return ((b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16)) + (b[o + 3] ?? 0) * 0x1000000;
}

function zipEntries(b: Uint8Array): Map<string, ZipEntry> {
  // Merkez dizin sonu kaydı (EOCD) dosyanın son 64 KB'ındadır.
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (u32(b, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new SheetError("UNREADABLE");
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const out = new Map<string, ZipEntry>();
  const dec = new TextDecoder("utf-8");
  for (let n = 0; n < count && n < 2000; n++) {
    if (u32(b, p) !== 0x02014b50) throw new SheetError("UNREADABLE");
    const method = u16(b, p + 10);
    const compSize = u32(b, p + 20);
    const size = u32(b, p + 24);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    const offset = u32(b, p + 42);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    out.set(name, { name, method, compSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflate(b: Uint8Array, e: ZipEntry): Promise<string> {
  if (e.size > SHEET_MAX_PART_BYTES) throw new SheetError("TOO_BIG");
  if (u32(b, e.offset) !== 0x04034b50) throw new SheetError("UNREADABLE");
  const start = e.offset + 30 + u16(b, e.offset + 26) + u16(b, e.offset + 28);
  const data = b.subarray(start, start + e.compSize);
  if (e.method === 0) return new TextDecoder("utf-8").decode(data);
  if (e.method !== 8) throw new SheetError("UNREADABLE");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    // Bildirilen boyuta güvenilmez: açılan bayt sınırı aşarsa durulur (sıkıştırma bombası).
    if (total > SHEET_MAX_PART_BYTES) {
      await reader.cancel();
      throw new SheetError("TOO_BIG");
    }
    parts.push(value);
  }
  const all = new Uint8Array(total);
  let o = 0;
  for (const part of parts) {
    all.set(part, o);
    o += part.length;
  }
  return new TextDecoder("utf-8").decode(all);
}

function xml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) throw new SheetError("UNREADABLE");
  return doc;
}

/** "BC12" → 54 (0 tabanlı sütun). */
export function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.toUpperCase()) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/** Excel sayısını Türkçe görünüme çevirir: tam sayı aynen, ondalık virgülle (kayan nokta gürültüsü 10 haneye yuvarlanır). */
export function excelNumber(v: string): string {
  if (!/^-?\d+(\.\d+)?(E[+-]?\d+)?$/i.test(v)) return v;
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  return String(Number(n.toPrecision(12))).replace(".", ",");
}

async function readXlsx(b: Uint8Array, maxRows: number): Promise<Workbook> {
  const entries = zipEntries(b);
  const get = async (name: string): Promise<string | null> => {
    const e = entries.get(name);
    return e === undefined ? null : inflate(b, e);
  };
  const wbText = await get("xl/workbook.xml");
  if (wbText === null) throw new SheetError("UNREADABLE");
  const wb = xml(wbText);
  const relsText = await get("xl/_rels/workbook.xml.rels");
  const rels = new Map<string, string>();
  if (relsText !== null) {
    for (const r of Array.from(xml(relsText).getElementsByTagName("Relationship"))) {
      const target = r.getAttribute("Target") ?? "";
      rels.set(r.getAttribute("Id") ?? "", target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
    }
  }
  const sstText = await get("xl/sharedStrings.xml");
  const shared: string[] = [];
  if (sstText !== null) {
    for (const si of Array.from(xml(sstText).getElementsByTagName("si"))) {
      // Zengin metin: tüm <t> parçaları birleşir; fonetik (<rPh>) okunuş eklenmez.
      shared.push(
        Array.from(si.getElementsByTagName("t"))
          .filter((t) => t.parentElement?.nodeName !== "rPh")
          .map((t) => t.textContent ?? "")
          .join(""),
      );
    }
  }
  const sheets: Sheet[] = [];
  const list = Array.from(wb.getElementsByTagName("sheet"));
  for (const [i, s] of list.entries()) {
    const rid = s.getAttribute("r:id") ?? s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? "";
    const path = rels.get(rid) ?? `xl/worksheets/sheet${i + 1}.xml`;
    const text = await get(path);
    if (text === null) continue;
    const doc = xml(text);
    const rows: string[][] = [];
    for (const r of Array.from(doc.getElementsByTagName("row"))) {
      const ri = Number(r.getAttribute("r") ?? rows.length + 1) - 1;
      if (ri >= maxRows + 50) throw new SheetError("TOO_MANY_ROWS");
      const cells: string[] = [];
      for (const c of Array.from(r.getElementsByTagName("c"))) {
        const ref = c.getAttribute("r");
        const ci = ref === null ? cells.length : colIndex(ref);
        if (ci >= SHEET_MAX_COLS) continue;
        const type = c.getAttribute("t");
        const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
        let value = "";
        if (type === "s") value = shared[Number(v)] ?? "";
        else if (type === "inlineStr") value = Array.from(c.getElementsByTagName("t")).map((t) => t.textContent ?? "").join("");
        else if (type === "b") value = v === "1" ? "DOĞRU" : "YANLIŞ";
        else if (type === "e") value = "";
        else if (type === "str") value = v;
        else value = excelNumber(v);
        while (cells.length < ci) cells.push("");
        cells[ci] = value;
      }
      while (rows.length < ri) rows.push([]);
      rows[ri] = cells;
    }
    const trimmed = trimRows(rows);
    if (trimmed.length === 0) continue;
    if (trimmed.length > maxRows) throw new SheetError("TOO_MANY_ROWS");
    sheets.push({ name: (s.getAttribute("name") ?? `SAYFA${i + 1}`).toLocaleUpperCase("tr"), rows: trimmed });
  }
  if (sheets.length === 0) throw new SheetError("EMPTY");
  return { sheets };
}
