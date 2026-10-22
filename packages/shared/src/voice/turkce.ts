// T-1002 (B-62): Etkin sesli komut — Türkçe metin yardımcıları. Saf işlevler (DB yok); niyet ayrıştırıcı ve eşleştirici bunları kullanır.
// Karşılaştırma "katlanmış" biçimde yapılır: Türkçe küçük harf + ç/ğ/ı/ö/ş/ü → c/g/i/o/s/u; böylece konuşma tanıma yazımı ("kac", "kaç")
// ve katalog yazımı ("KAUÇUK") aynı biçime iner. Miktar ondalık metindir (I-09: float yok; yalnız tam sayı ve ".5" buçuk).

const FOLD: Readonly<Record<string, string>> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };

/** Türkçe küçük harf (İ→i, I→ı) — `toLocaleLowerCase("tr")` ile aynı, ortam yerelinden bağımsız. */
export function trLower(s: string): string {
  return s.replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
}

/** Türkçe küçük harf + aksan katlama. */
export function fold(s: string): string {
  return trLower(s).replace(/[çğıöşüâîû]/g, (c) => FOLD[c] ?? c);
}

/**
 * Komut metnini sözcüklere ayırır: kesme işaretinden sonraki ek atılır ("Ahmet'in" → "ahmet", "A-3'e" → "a 3"), noktalama boşluk olur,
 * harf/rakam sınırı ayrılır ("45mm" → "45 mm", "a3" → "a 3"). Ondalık "7,5" / "7.5" tek sözcük kalır.
 */
export function words(text: string): string[] {
  const t = fold(text.normalize("NFC"))
    .replace(/[’'`´]\p{L}*/gu, " ")
    .replace(/(\d)[.,](\d)/g, "$1\u0000$2")
    .replace(/[^\p{L}\p{N}\u0000]+/gu, " ")
    .replace(/(\p{L})(\p{N})/gu, "$1 $2")
    .replace(/(\p{N})(\p{L})/gu, "$1 $2")
    .replace(/\u0000/g, ".");
  return t.split(/\s+/).filter((w) => w !== "");
}

const ONES: Readonly<Record<string, number>> = { sifir: 0, bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9 };
const TENS: Readonly<Record<string, number>> = { on: 10, yirmi: 20, otuz: 30, kirk: 40, elli: 50, altmis: 60, yetmis: 70, seksen: 80, doksan: 90 };
const ORDINALS: Readonly<Record<string, number>> = { birinci: 1, ikinci: 2, ucuncu: 3, dorduncu: 4, besinci: 5, altinci: 6, yedinci: 7, sekizinci: 8, dokuzuncu: 9, onuncu: 10 };

export interface ParsedNumber {
  /** Ondalık metin: "245", "7.5". */
  readonly value: string;
  /** Sayının bittiği sözcükten sonraki dizin. */
  readonly end: number;
}

/** Sözcük bir sayının parçası mı (rakam ya da Türkçe sayı sözcüğü)? */
export function isNumberWord(w: string): boolean {
  return /^\d+(\.\d+)?$/.test(w) || w in ONES || w in TENS || w === "yuz" || w === "bin" || w === "bucuk" || w === "yarim";
}

export function ordinal(w: string): number | null {
  return ORDINALS[w] ?? null;
}

/**
 * `i` dizinindeki sözcükten başlayan sayıyı okur ("yirmi" → 20, "iki yüz kırk beş" → 245, "yedi buçuk" → 7.5, "yarım" → 0.5, "12" → 12,
 * "7.5" → 7.5). Türkçe dizilim kuralı: birler birlerin, onlar onların ardından gelmez (iki ayrı sayıdır: "otuz yirmi" → 30 | 20).
 * Sayı yoksa `null`.
 */
export function parseNumberAt(ws: readonly string[], i: number): ParsedNumber | null {
  const first = ws[i];
  if (first === undefined) return null;
  if (/^\d+(\.\d+)?$/.test(first)) {
    if (first.length > 12) return null;
    const value = first.replace(/^0+(?=\d)/, "");
    if (ws[i + 1] === "bucuk" && !value.includes(".")) return { value: `${value}.5`, end: i + 2 };
    return { value, end: i + 1 };
  }
  if (first === "yarim") return { value: "0.5", end: i + 1 };
  let total = 0;
  let current = 0;
  let last: "none" | "ones" | "tens" | "hundred" | "thousand" = "none";
  let j = i;
  for (; j < ws.length; j++) {
    const w = ws[j]!;
    if (w in ONES) {
      if (last === "ones") break;
      current += ONES[w]!;
      last = "ones";
    } else if (w in TENS) {
      if (last === "ones" || last === "tens") break;
      current += TENS[w]!;
      last = "tens";
    } else if (w === "yuz") {
      if (last === "tens" || last === "hundred" || current >= 10) break;
      current = (current === 0 ? 1 : current) * 100;
      last = "hundred";
    } else if (w === "bin") {
      if (last === "thousand") break;
      total += (current === 0 ? 1 : current) * 1000;
      current = 0;
      last = "thousand";
    } else break;
  }
  if (j === i) return null;
  const n = total + current;
  if (ws[j] === "bucuk") return { value: `${n}.5`, end: j + 1 };
  return { value: String(n), end: j };
}

/** Metindeki sayı sözcüklerini rakama çevirir ("koli bandı kırk beş" → "koli bandi 45"); eşleştirmede kullanılır. */
export function digitize(ws: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < ws.length; ) {
    const n = parseNumberAt(ws, i);
    if (n === null) {
      out.push(ws[i]!);
      i++;
    } else {
      out.push(n.value);
      i = n.end;
    }
  }
  return out;
}

/** Levenshtein uzaklığı (kısa dizgiler; O(n·m)). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, k) => k);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let k = 1; k <= b.length; k++) {
      cur[k] = Math.min(prev[k]! + 1, cur[k - 1]! + 1, prev[k - 1]! + (a[i - 1] === b[k - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** 0…1 benzerlik (1 = aynı). */
export function ratio(a: string, b: string): number {
  const m = Math.max(a.length, b.length);
  return m === 0 ? 1 : 1 - levenshtein(a, b) / m;
}
