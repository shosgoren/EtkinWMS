// T-1002 (B-62): Etkin — duyulan ifadeyi kiracının gerçek listesiyle (ürün, raf, cari, kişi, depo) bulanık eşleştirme. Saf işlevler.
// Konuşma tanıma hatası beklenir (ölçüm: small modelde WER ~%27; "kauçuk conta" → "kağıtçup konta"): ad sözcük sözcük benzerlikle,
// kod harf/rakam dizisiyle karşılaştırılır. Tek açık kazanan yoksa 2–3 aday döner (istemci seçtirir); zayıf eşleşme hiç dönmez.
import { fold, isNumberWord, parseNumberAt, ratio, words } from "./turkce.ts";
import { matchForm } from "./niyet.ts";

export type Candidate = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
};

export interface Scored<T extends Candidate> {
  readonly c: T;
  readonly score: number;
}

export type MatchResult<T extends Candidate> =
  | { readonly kind: "one"; readonly c: T }
  | { readonly kind: "many"; readonly list: readonly T[] }
  | { readonly kind: "none" };

export const UNIQUE_MIN = 0.74;
export const UNIQUE_GAP = 0.1;
export const AMBIGUOUS_MIN = 0.45;

/** Kod anahtarı: harf ve sayı parçaları, sayıların baştaki sıfırı atılır ("A1-G01" → "a-1-g-1", "C-01" → "c-1"). */
export function codeKey(code: string): string {
  const parts = fold(code).match(/[a-z]+|\d+/g) ?? [];
  return parts.map((p) => (/^\d+$/.test(p) ? String(Number(p)) : p)).join("-");
}

/** Söylenen raf kodu ("c bir", "a üç", "a bir g sıfır bir", "b12") → aynı anahtar ("c-1", "a-3", "a-1-g-1", "b-12"). */
export function spokenCodeKey(spoken: string): string {
  const ws = words(spoken);
  const seg: string[] = [];
  for (let i = 0; i < ws.length; ) {
    const w = ws[i]!;
    if (isNumberWord(w)) {
      // "sıfır bir" = "01": sıfır kendinden sonraki sayıya katılır (baştaki sıfır anahtarda zaten atılır).
      if (w === "sifir" && ws[i + 1] !== undefined && isNumberWord(ws[i + 1]!)) {
        i++;
        continue;
      }
      const n = parseNumberAt(ws, i);
      if (n === null) {
        i++;
        continue;
      }
      seg.push(n.value.replace(/\.5$/, ""));
      i = n.end;
    } else {
      seg.push(...(w.match(/[a-z]+|\d+/g) ?? []).map((p) => (/^\d+$/.test(p) ? String(Number(p)) : p)));
      i++;
    }
  }
  return seg.join("-");
}

function tokenScore(heard: readonly string[], cand: readonly string[]): number {
  if (heard.length === 0 || cand.length === 0) return 0;
  let sum = 0;
  for (const h of heard) {
    let best = 0;
    for (const c of cand) {
      const r = h === c ? 1 : /^\d/.test(h) || /^\d/.test(c) ? 0 : c.startsWith(h) && h.length >= 3 ? 0.9 : ratio(h, c);
      if (r > best) best = r;
    }
    sum += best >= 0.5 ? best : 0;
  }
  const coverage = sum / heard.length;
  const precision = Math.min(1, heard.length / cand.length);
  return 0.8 * coverage + 0.2 * precision;
}

/** 0…1 benzerlik: kod tam eşleşmesi 1; aksi ad (sözcük + bütün dizgi) benzerliği. */
export function scoreCandidate(heard: string, c: Candidate): number {
  const h = matchForm(heard);
  if (h === "") return 0;
  const hk = spokenCodeKey(heard);
  const ck = codeKey(c.code);
  if (hk !== "" && hk === ck) return 1;
  const compact = h.replace(/\s+/g, "");
  if (compact.length >= 2 && compact === fold(c.code).replace(/[^a-z0-9]/g, "")) return 1;
  const name = matchForm(c.name);
  const whole = ratio(compact, name.replace(/\s+/g, ""));
  const tok = tokenScore(h.split(" "), name.split(" "));
  const codeSim = ck === "" || hk === "" ? 0 : ratio(hk, ck) * 0.85;
  return Math.max(tok, whole * 0.9, codeSim);
}

export function rank<T extends Candidate>(heard: string, list: readonly T[], limit = 3): Scored<T>[] {
  return list
    .map((c) => ({ c, score: scoreCandidate(heard, c) }))
    .filter((s) => s.score >= AMBIGUOUS_MIN)
    .sort((a, b) => b.score - a.score || a.c.code.localeCompare(b.c.code))
    .slice(0, limit);
}

/** Karar: tek açık kazanan → "one"; yakın adaylar → "many" (en çok 3); hiçbiri → "none". */
export function decide<T extends Candidate>(heard: string, list: readonly T[]): MatchResult<T> {
  const top = rank(heard, list, 3);
  const first = top[0];
  if (first === undefined) return { kind: "none" };
  const second = top[1];
  if (first.score >= UNIQUE_MIN && (second === undefined || second.score <= first.score - UNIQUE_GAP)) return { kind: "one", c: first.c };
  if (first.score === 1 && second !== undefined && second.score < 1) return { kind: "one", c: first.c };
  return { kind: "many", list: top.filter((s) => s.score >= first.score - 0.25).map((s) => s.c) };
}

/** Raf eşleştirme: önce kod anahtarı birebir; yoksa anahtar önekleri/benzerlik (kod adından önemli). */
export function decideLocation<T extends Candidate>(spoken: string, list: readonly T[]): MatchResult<T> {
  const key = spokenCodeKey(spoken);
  if (key === "") return { kind: "none" };
  const exact = list.filter((c) => codeKey(c.code) === key);
  if (exact.length === 1) return { kind: "one", c: exact[0]! };
  if (exact.length > 1) return { kind: "many", list: exact.slice(0, 3) };
  const scored = list
    .map((c) => {
      const ck = codeKey(c.code);
      const s = ck.startsWith(`${key}-`) ? 0.7 : ratio(key, ck);
      return { c, s };
    })
    .filter((x) => x.s >= 0.6)
    .sort((a, b) => b.s - a.s || a.c.code.localeCompare(b.c.code))
    .slice(0, 3);
  return scored.length === 0 ? { kind: "none" } : { kind: "many", list: scored.map((x) => x.c) };
}
