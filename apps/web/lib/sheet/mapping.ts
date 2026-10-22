// T-427: şablonsuz sütun eşleştirme (SAF; DOM yok, sunucu yok). Kullanıcının Excel başlıkları ne olursa olsun alanları bulur:
// - BULDUM (`auto`): katlanmış başlık eş anlamlı sözlükte birebir.
// - DOĞRU MU? (`sug`): başlık eş anlamlıyı içeriyor ya da sütun içeriği alana benziyor (GTIN denetim haneli barkod, tam sayı sütunu).
// - SEÇMEN GEREK (`miss`): zorunlu alan bulunamadı; kullanıcı önizlemede seçer. Bir sütun yalnız bir alana gider.
// Başlık satırı: ilk 10 satırda en çok alanla eşleşen satır (üstte firma adı / boş satır olan Excel'ler).
// Sunucuya gidecek dosya mevcut içe aktarma biçimindeki düz CSV'dir (sabit Türkçe başlıklar); sunucu her şeyi yeniden doğrular.

import { kucukHarf } from "@wms/ui";

export type ImportKindKey = "stok" | "cari" | "acilis" | "depo" | "raf";
export type MapState = "auto" | "sug" | "user" | "none";

export interface FieldDef {
  readonly id: string;
  /** Sunucudaki sabit başlık (PRODUCT_HEADERS / STOCK_HEADERS). */
  readonly header: string;
  readonly required: boolean;
  readonly synonyms: readonly string[];
  readonly content?: "gtin" | "gtin14" | "int" | "taxno" | "email" | "phone";
}

export const FIELDS: Readonly<Record<ImportKindKey, readonly FieldDef[]>> = {
  stok: [
    { id: "kod", header: "kod", required: true, synonyms: ["kod", "kodu", "stok kodu", "stokkod", "urun kodu", "malzeme kodu", "mal kodu", "stok no", "urun no", "sku", "item code", "code", "stok kod"] },
    { id: "ad", header: "ad", required: true, synonyms: ["ad", "adi", "stok adi", "urun adi", "malzeme adi", "mal adi", "aciklama", "malzeme aciklamasi", "stok aciklamasi", "urun aciklamasi", "tanim", "name", "description", "urun"] },
    { id: "birim", header: "temel birim", required: false, synonyms: ["birim", "birimi", "temel birim", "olcu birimi", "olcu", "unit", "br", "stok birimi"] },
    { id: "koli", header: "koli içi adet", required: false, synonyms: ["koli ici adet", "koli ici", "koli mik", "koli miktari", "koli adedi", "kolideki adet", "paket ici adet", "koli icerigi", "koli"], content: "int" },
    { id: "barkod", header: "adet barkodu", required: false, synonyms: ["barkod", "adet barkodu", "barcode", "ean", "gtin", "urun barkodu", "barkodu", "barkod no"], content: "gtin" },
    { id: "kbarkod", header: "koli barkodu", required: false, synonyms: ["koli barkodu", "koli barkod", "koli ean", "paket barkodu", "koli gtin"], content: "gtin14" },
  ],
  // T-428: cari kartlar (sunucuya alan adlarıyla kayıt gider; `header` yalnız etiket anahtarıdır).
  cari: [
    { id: "kod", header: "code", required: true, synonyms: ["cari kod", "cari kodu", "hesap kodu", "musteri kodu", "firma kodu", "cari no", "kod", "kodu", "code", "hesap no"] },
    { id: "unvan", header: "name", required: true, synonyms: ["unvan", "unvani", "cari adi", "cari unvan", "cari unvani", "hesap adi", "firma adi", "firma unvani", "musteri adi", "firma", "ad soyad", "adi soyadi", "adi", "ad", "isim", "name", "company"] },
    { id: "vkn", header: "taxNo", required: false, synonyms: ["vkn", "tckn", "vkn tckn", "tckn vkn", "vergi no", "vergi numarasi", "vergi kimlik no", "tc no", "tc kimlik no", "tc kimlik", "tax no", "vergi tc no"], content: "taxno" },
    { id: "vd", header: "taxOffice", required: false, synonyms: ["vd", "v d", "vergi dairesi", "vergi d", "vergi dairesi adi", "tax office"] },
    { id: "tel", header: "phone", required: false, synonyms: ["tel", "telefon", "gsm", "cep", "cep telefonu", "telefon no", "tel no", "phone", "mobile"], content: "phone" },
    { id: "mail", header: "email", required: false, synonyms: ["mail", "e posta", "eposta", "email", "e mail", "e posta adresi"], content: "email" },
    { id: "il", header: "city", required: false, synonyms: ["il", "sehir", "city", "il adi"] },
    { id: "adres", header: "address", required: false, synonyms: ["adres", "acik adres", "adresi", "address", "fatura adresi"] },
    { id: "tur", header: "kind", required: false, synonyms: ["tur", "cari turu", "cari tipi", "tip", "hesap turu", "type", "musteri tedarikci"] },
  ],
  acilis: [
    { id: "urun", header: "ürün kodu", required: true, synonyms: ["urun kodu", "stok kodu", "kod", "kodu", "malzeme kodu", "mal kodu", "sku", "item code"] },
    { id: "raf", header: "raf kodu", required: true, synonyms: ["raf", "raf kodu", "lokasyon", "lokasyon kodu", "konum", "adres", "location", "yer", "goz", "raf adresi"] },
    { id: "miktar", header: "miktar", required: true, synonyms: ["miktar", "miktari", "adet", "mevcut", "sayim", "sayilan", "stok", "stok miktari", "quantity", "qty", "eldeki"], content: "int" },
  ],
  // T-981b: depolar ve raflar (sunucuya alan adlarıyla kayıt gider; `header` sunucu alan adıdır). Dışa aktarma başlıkları ("depo kodu", "raf adı"…) birebir bulunur.
  depo: [
    { id: "kod", header: "code", required: true, synonyms: ["depo kodu", "depo kod", "kod", "kodu", "code", "warehouse code"] },
    { id: "ad", header: "name", required: false, synonyms: ["depo adi", "depo ad", "ad", "adi", "isim", "name", "warehouse"] },
  ],
  raf: [
    { id: "depo", header: "warehouseCode", required: true, synonyms: ["depo kodu", "depo", "depo kod", "warehouse", "warehouse code"] },
    { id: "kod", header: "code", required: true, synonyms: ["raf kodu", "raf kod", "lokasyon kodu", "lokasyon", "konum kodu", "adres kodu", "kod", "kodu", "code", "location code"] },
    { id: "ad", header: "name", required: false, synonyms: ["raf adi", "raf ad", "lokasyon adi", "ad", "adi", "isim", "name"] },
    { id: "ust", header: "parentCode", required: false, synonyms: ["ust raf kodu", "ust raf", "ust lokasyon", "ust kod", "parent", "parent code", "bagli oldugu"] },
    { id: "tur", header: "kind", required: false, synonyms: ["tur", "raf turu", "lokasyon turu", "tip", "kind", "type"] },
  ],
};

// T-436 (ALTIN-KURAL 16): başlık eşleştirmesi Türkçe eş anlamlı sözlükle yapılır (veri eşleştirme, görüntü değildir);
// bu yüzden katlama dili kullanıcının dili değil, sözlüğün dilidir.
const ESLESTIRME_DILI = "tr";

const TR: Readonly<Record<string, string>> = { ı: "i", İ: "i", ş: "s", ğ: "g", ü: "u", ö: "o", ç: "c", â: "a", î: "i", û: "u" };

/** Başlık katlama: Türkçe küçük harf, aksansız, harf/rakam dışı tek boşluk. "Koli Mik." → "koli mik". */
export function fold(h: string): string {
  return kucukHarf(h, ESLESTIRME_DILI)
    .replace(/[ışğüöçâîûİ]/g, (c) => TR[c] ?? c)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** GTIN-8/12/13/14 denetim hanesi doğru mu. */
export function isGtin(v: string): boolean {
  const s = v.replace(/\s/g, "");
  if (!/^\d+$/.test(s) || ![8, 12, 13, 14].includes(s.length)) return false;
  const digits = [...s].map(Number);
  const check = digits.pop() as number;
  let sum = 0;
  digits.reverse().forEach((d, i) => {
    sum += d * (i % 2 === 0 ? 3 : 1);
  });
  return (10 - (sum % 10)) % 10 === check;
}

function contentOk(kind: NonNullable<FieldDef["content"]>, x: string): boolean {
  const d = x.replace(/\s/g, "");
  switch (kind) {
    case "int":
      return /^\d{1,7}$/.test(x.replace(/\./g, ""));
    case "gtin":
      return isGtin(d) && d.length !== 14;
    case "gtin14":
      return isGtin(d) && d.length === 14;
    case "taxno":
      return /^\d{10,11}$/.test(d);
    case "email":
      return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x);
    case "phone":
      return /^[0-9+() .\/-]{7,20}$/.test(x) && (x.match(/\d/g) ?? []).length >= 7;
  }
}

function contentScore(kind: NonNullable<FieldDef["content"]>, values: readonly string[]): boolean {
  const v = values.filter((x) => x !== "");
  if (v.length === 0) return false;
  return v.filter((x) => contentOk(kind, x)).length / v.length >= 0.8;
}

function headerMatch(f: FieldDef, h: string): "auto" | "sug" | null {
  const k = fold(h);
  if (k === "") return null;
  const flat = k.replace(/ /g, "");
  if (f.synonyms.some((s) => s === k || s.replace(/ /g, "") === flat)) return "auto";
  if (f.synonyms.some((s) => s.length >= 4 && (k.includes(s) || (k.length >= 4 && s.includes(k))))) return "sug";
  return null;
}

/** İlk 10 satırdan başlık satırını seçer (en çok alanla eşleşen; eşitlikte üstteki). */
export function detectHeader(rows: readonly (readonly string[])[], kind: ImportKindKey): number {
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const r = rows[i] ?? [];
    let score = 0;
    for (const f of FIELDS[kind]) if (r.some((h) => headerMatch(f, h) !== null)) score += 1;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}

export interface Mapping {
  /** Alan → sütun dizini (yoksa null). */
  readonly col: Readonly<Record<string, number | null>>;
  readonly state: Readonly<Record<string, MapState>>;
}

/** Sütunun başlıktan sonraki ilk `n` dolu değeri. */
export function samples(rows: readonly (readonly string[])[], headerRow: number, col: number, n = 3): string[] {
  const out: string[] = [];
  for (let i = headerRow + 1; i < rows.length && out.length < n; i++) {
    const v = rows[i]?.[col] ?? "";
    if (v !== "") out.push(v);
  }
  return out;
}

/** Otomatik eşleştirme: önce başlık (BULDUM), sonra benzer başlık, sonra içerik (DOĞRU MU?). Bir sütun bir alana gider. */
export function autoMap(rows: readonly (readonly string[])[], headerRow: number, kind: ImportKindKey): Mapping {
  const head = rows[headerRow] ?? [];
  const col: Record<string, number | null> = {};
  const state: Record<string, MapState> = {};
  const used = new Set<number>();
  const fields = FIELDS[kind];
  for (const pass of ["auto", "sug"] as const) {
    for (const f of fields) {
      if (col[f.id] !== undefined && col[f.id] !== null) continue;
      const i = head.findIndex((h, j) => !used.has(j) && headerMatch(f, h) === pass);
      if (i >= 0) {
        col[f.id] = i;
        state[f.id] = pass;
        used.add(i);
      }
    }
  }
  for (const f of fields) {
    if (col[f.id] !== undefined && col[f.id] !== null) continue;
    const kindC = f.content;
    if (kindC !== undefined) {
      const tail = rows.slice(headerRow + 1, headerRow + 41);
      const i = head.findIndex((_, j) => !used.has(j) && contentScore(kindC, tail.map((r) => r[j] ?? "")));
      if (i >= 0) {
        col[f.id] = i;
        state[f.id] = "sug";
        used.add(i);
        continue;
      }
    }
    col[f.id] = null;
    state[f.id] = "none";
  }
  return { col, state };
}

/** Bir alana sütun atar (sütun başka alandaysa oradan alınır). `null`: alanı boş bırak. */
export function setColumn(m: Mapping, field: string, column: number | null): Mapping {
  const col: Record<string, number | null> = { ...m.col };
  const state: Record<string, MapState> = { ...m.state };
  if (column !== null) {
    for (const k of Object.keys(col)) {
      if (k !== field && col[k] === column) {
        col[k] = null;
        state[k] = "none";
      }
    }
  }
  col[field] = column;
  state[field] = column === null ? "none" : "user";
  return { col, state };
}

/** Kontrol etmeden önce bekleyen alanlar: zorunlu ve seçilmemiş ya da zorunlu ve "doğru mu?" onayı bekleyen. */
export function waiting(m: Mapping, kind: ImportKindKey): string[] {
  return FIELDS[kind].filter((f) => f.required && (m.col[f.id] === null || m.col[f.id] === undefined || m.state[f.id] === "sug")).map((f) => f.id);
}

/** Başlık imzası: katlanmış başlıkların sıralı özeti (eşleştirme hafızası anahtarı). */
export function headerSignature(head: readonly string[]): string {
  return head.map(fold).join("|");
}

const csvCell = (v: string): string => (/[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export interface BuiltCsv {
  readonly text: string;
  /** CSV satır no (başlık 1) → dosyadaki satır no (1 tabanlı). */
  readonly rowMap: readonly number[];
}

/** Sunucunun beklediği düz CSV: sabit Türkçe başlıklar + eşleşen sütunlar. `skip`: atlanacak dosya satırları (1 tabanlı). */
export function buildCsv(rows: readonly (readonly string[])[], headerRow: number, m: Mapping, kind: ImportKindKey, skip: ReadonlySet<number> = new Set()): BuiltCsv {
  const fields = FIELDS[kind].filter((f) => m.col[f.id] !== null && m.col[f.id] !== undefined);
  const lines = [fields.map((f) => f.header).join(";")];
  const rowMap: number[] = [0, headerRow + 1];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (skip.has(i + 1)) continue;
    const cells = fields.map((f) => r[m.col[f.id] as number] ?? "");
    if (cells.every((c) => c === "")) continue;
    lines.push(cells.map(csvCell).join(";"));
    rowMap.push(i + 1);
  }
  return { text: `﻿${lines.join("\r\n")}\r\n`, rowMap };
}

/** "A", "B", … "AA" (0 tabanlı sütun dizininden). */
export function colLetter(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Cari kartlar (T-428): eşleşen alanlarla satır kayıtları (sunucu alan adları). `row`: dosyadaki satır no (1 tabanlı). */
export type SheetRecord = { readonly row: number; readonly [field: string]: string | number };
export function buildRecords(rows: readonly (readonly string[])[], headerRow: number, m: Mapping, kind: ImportKindKey, skip: ReadonlySet<number> = new Set()): SheetRecord[] {
  const fields = FIELDS[kind].filter((f) => m.col[f.id] !== null && m.col[f.id] !== undefined);
  const out: SheetRecord[] = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    if (skip.has(i + 1)) continue;
    const r = rows[i] ?? [];
    const rec: Record<string, string> = {};
    let any = false;
    for (const f of fields) {
      const v = r[m.col[f.id] as number] ?? "";
      if (v !== "") any = true;
      rec[f.header] = v;
    }
    if (any) out.push({ ...rec, row: i + 1 });
  }
  return out;
}
