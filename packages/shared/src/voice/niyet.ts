// T-1002 (B-62): Etkin sesli komut — kural tabanlı niyet ayrıştırıcı (saf işlev; LLM yok, Q-129). Duyulan cümle → niyet + ham parçalar
// (miktar, birim, ürün/raf/kişi/cari ifadesi). Parçaların kiracının gerçek verisiyle eşleştirilmesi `sorgu.ts`'dedir.
// Yazma niyetleri (stok ya da iş değiştiren) `write: true` taşır: istemci önce "Anladım" kartını gösterir; onaydan sonra MEVCUT sunucu
// eylemleri çağrılır (yeni yazma yolu yok). Sesli onay yalnız kart açıkken ve kapalı gramerde tam "onayla"/"onaylıyorum" ile (A-172).
import { digitize, isNumberWord, ordinal, parseNumberAt, words } from "./turkce.ts";

export type TaskKindHint = "PICK" | "PUTAWAY" | "COUNT";

export type VoiceIntent =
  | { readonly kind: "confirm" }
  | { readonly kind: "fix" }
  | { readonly kind: "receive"; readonly qty?: string; readonly unit?: string; readonly item?: string; readonly to?: string }
  | { readonly kind: "issue"; readonly qty?: string; readonly unit?: string; readonly item?: string; readonly from?: string }
  | {
      readonly kind: "transfer";
      readonly qty?: string;
      readonly unit?: string;
      readonly item?: string;
      readonly from?: string;
      readonly to?: string;
      readonly toWarehouse?: string;
    }
  | { readonly kind: "count"; readonly at?: string }
  | { readonly kind: "label"; readonly qty?: string; readonly unit?: string; readonly item?: string; readonly at?: string }
  | { readonly kind: "whatAt"; readonly at: string }
  | { readonly kind: "howMany"; readonly item: string }
  | { readonly kind: "tasks"; readonly person?: string; readonly taskKind?: TaskKindHint }
  | { readonly kind: "task"; readonly no: string }
  | { readonly kind: "assign"; readonly person?: string; readonly taskKind?: TaskKindHint }
  | { readonly kind: "ship"; readonly orderNo?: string; readonly party?: string }
  | { readonly kind: "open"; readonly target: string }
  | { readonly kind: "unknown" };

export type VoiceIntentKind = VoiceIntent["kind"];

/** Stok ya da iş değiştiren niyetler: önce "Anladım" kartı. */
export const WRITE_INTENTS: ReadonlySet<VoiceIntentKind> = new Set(["receive", "issue", "transfer", "count"]);

const UNITS = new Set([
  "adet", "tane", "koli", "kutu", "paket", "palet", "kilo", "kg", "kilogram", "gram", "gr", "ton", "litre", "lt", "metre", "m", "rulo",
  "varil", "cuval", "torba", "sise", "kasa", "top", "bidon", "teneke",
]);
const STOP = new Set([
  "mal", "kabul", "sarf", "tasi", "aktar", "koy", "koyun", "icin", "et", "yap", "var", "ne", "neler", "kac", "tane", "stokta", "stok",
  "depoda", "depoya", "deposuna", "ve", "lutfen", "simdi", "bugun", "bugunku", "olarak", "ile", "goster", "listele", "ac", "git", "bul",
  "yazdir", "bas", "al", "teslim", "yerlestir", "baslat", "ata", "kadar", "en", "su", "bu",
]);
const STOP_PREFIX = ["giris", "cikis", "cikar", "etiket", "transfer", "yerlestir", "kabul"];
const RAF = /^(raf|goz)(a|i|in|ina|ine|inda|inde|indan|inden|ini|u|una|une|unda|unde|undan|unden|unu)?$/;

function isStop(w: string): boolean {
  return STOP.has(w) || STOP_PREFIX.some((p) => w.startsWith(p)) || RAF.test(w);
}

interface Span {
  readonly start: number;
  readonly end: number;
  readonly role: "to" | "from" | "at";
  readonly text: string;
}

/** Raf/göz sözcüğünden geriye doğru kod parçaları (tek harf, sayı, kısa harf+rakam). En çok 6 sözcük. */
function locationSpans(ws: readonly string[]): Span[] {
  const out: Span[] = [];
  for (let j = 0; j < ws.length; j++) {
    const m = RAF.exec(ws[j]!);
    if (m === null) continue;
    let s = j;
    while (s > 0 && j - s < 6) {
      const w = ws[s - 1]!;
      if (/^\p{L}$/u.test(w) || isNumberWord(w) || /^[a-z]{1,2}\d{1,4}$/.test(w)) s--;
      else break;
    }
    // Raf kodu harfle başlar: önündeki sayı sözcükleri (miktar ya da ürün adının parçası) koda katılmaz ("ürün üç Z bir rafına").
    const firstLetter = ws.slice(s, j).findIndex((w) => /^\p{L}$/u.test(w) || /^[a-z]{1,2}\d{1,4}$/.test(w));
    if (firstLetter > 0) s += firstLetter;
    const suffix = m[2] ?? "";
    const role = /^(a|ina|ine|una|une)$/.test(suffix) ? "to" : /(dan|den)$/.test(suffix) ? "from" : "at";
    if (s < j) out.push({ start: s, end: j + 1, role, text: ws.slice(s, j).join(" ") });
  }
  return out;
}

interface Qty {
  readonly value: string;
  readonly unit?: string;
  readonly start: number;
  readonly end: number;
}

function firstQty(ws: readonly string[], taken: ReadonlySet<number>): Qty | null {
  for (let i = 0; i < ws.length; i++) {
    if (taken.has(i)) continue;
    const n = parseNumberAt(ws, i);
    if (n === null) continue;
    const next = ws[n.end];
    if (next === "numarali" || next === "nolu" || next === "no") continue;
    let end = n.end;
    for (let k = i; k < n.end; k++) if (taken.has(k)) end = Math.min(end, k);
    if (end <= i) continue;
    const unit = ws[end] !== undefined && UNITS.has(ws[end]!) && !taken.has(end) ? ws[end] : undefined;
    return { value: n.value, ...(unit === undefined ? {} : { unit }), start: i, end: unit === undefined ? end : end + 1 };
  }
  return null;
}

/** Kalan anlamlı sözcüklerin en uzun bitişik dizisi (ürün ifadesi). */
function phrase(ws: readonly string[], taken: ReadonlySet<number>, extraStop: (w: string) => boolean = () => false): string | undefined {
  let best: string[] = [];
  let cur: string[] = [];
  for (let i = 0; i <= ws.length; i++) {
    const w = ws[i];
    if (w === undefined || taken.has(i) || isStop(w) || extraStop(w)) {
      if (cur.length > best.length) best = cur;
      cur = [];
    } else cur.push(w);
  }
  const s = best.join(" ").trim();
  return s === "" ? undefined : s;
}

function mark(taken: Set<number>, start: number, end: number): void {
  for (let k = start; k < end; k++) taken.add(k);
}

function taskKindOf(ws: readonly string[]): TaskKindHint | undefined {
  if (ws.some((w) => w.startsWith("toplama"))) return "PICK";
  if (ws.some((w) => w.startsWith("yerlestirme"))) return "PUTAWAY";
  if (ws.some((w) => w.startsWith("sayim"))) return "COUNT";
  return undefined;
}

/** Duyulan cümleyi niyete çevirir. */
export function parseCommand(text: string): VoiceIntent {
  const ws = words(text);
  const f = ws.join(" ");
  if (ws.length === 0) return { kind: "unknown" };
  // A-172: kapalı gramer — yalnız tam sözcük.
  if (/^(onayla|onayliyorum)$/.test(f)) return { kind: "confirm" };
  if (/^(duzelt|vazgec|iptal)$/.test(f)) return { kind: "fix" };

  const spans = locationSpans(ws);
  const taken = new Set<number>();
  for (const s of spans) mark(taken, s.start, s.end);
  const at = spans.find((s) => s.role === "at") ?? spans[0];
  const from = spans.find((s) => s.role === "from");
  const to = spans.find((s) => s.role === "to");

  if (ws.some((w) => w.startsWith("sayim")) && /\b(baslat|ac|yap|basla|olustur)\b/.test(f) && !/\bgorev/.test(f)) {
    return at === undefined ? { kind: "count" } : { kind: "count", at: at.text };
  }
  if (at !== undefined && /\bne(ler)? (var|bulunuyor|duruyor)\b/.test(f)) return { kind: "whatAt", at: at.text };

  if (/\b(kac|ne kadar)\b/.test(f) && /\bvar\b/.test(f)) {
    const item = phrase(ws, taken, (w) => UNITS.has(w));
    if (item !== undefined) return { kind: "howMany", item };
  }

  const taskNo = /\bgorev\w* (numarasi |no |nolu )?(.+)$/.exec(f) ?? /^(.+?) (numarali|nolu) gorev/.exec(f);
  if (taskNo !== null && /\bgorev/.test(f)) {
    const nws = words(taskNo[2] ?? taskNo[1] ?? "");
    const n = parseNumberAt(nws, 0);
    if (n !== null && n.end === nws.length) return { kind: "task", no: n.value };
  }

  const gi = ws.findIndex((w) => w.startsWith("gorev"));
  if (gi >= 0 && /\bata\b|\bver\b/.test(f)) {
    const person = gi > 0 ? ws.slice(0, gi).filter((w) => !w.startsWith("toplama") && !w.startsWith("yerlestirme") && !w.startsWith("sayim")).join(" ") : "";
    const tk = taskKindOf(ws);
    return { kind: "assign", ...(person === "" ? {} : { person }), ...(tk === undefined ? {} : { taskKind: tk }) };
  }
  if (gi >= 0 && (/\b(goster|listele|ac|neler|ne)\b/.test(f) || /^gorevlerim/.test(ws[gi]!))) {
    const mine = /^gorevlerim/.test(ws[gi]!) || ws.slice(0, gi).includes("benim");
    const before = ws.slice(0, gi).filter((w) => w !== "benim" && !w.startsWith("toplama") && !w.startsWith("yerlestirme") && !w.startsWith("sayim") && !isStop(w));
    const tk = taskKindOf(ws);
    return { kind: "tasks", ...(mine || before.length === 0 ? {} : { person: before.join(" ") }), ...(tk === undefined ? {} : { taskKind: tk }) };
  }

  if (/\b(sevk et|sevket|sevk)\b/.test(f) && !/sevkiyat/.test(f)) {
    const m = /^(.+?) (numarali|nolu) siparis/.exec(f) ?? /siparis\w* (no |numarasi |numara )?(.+?) (sevk|sevket)/.exec(f);
    if (m !== null) {
      const nws = words(m[1] !== undefined && /numarali|nolu/.test(m[2] ?? "") ? m[1] : (m[2] ?? ""));
      const n = parseNumberAt(nws, 0);
      if (n !== null) return { kind: "ship", orderNo: n.value };
    }
    const si = ws.findIndex((w) => w.startsWith("siparis"));
    const party = si > 0 ? ws.slice(0, si).join(" ") : undefined;
    return party === undefined ? { kind: "ship" } : { kind: "ship", party };
  }

  const isTransfer = /\b(transfer|tasi|aktar|nakil)\w*/.test(f);
  const isIssue = /\b(cikis|sarf|cikar)\w*/.test(f);
  const isLabel = /\betiket\w*/.test(f) && /\b(yazdir|bas|cikar|olustur)\w*/.test(f);
  const isReceive = /\b(mal kabul|kabul et|giris|teslim al|yerlestir|koy|koyun|ekle)\w*/.test(f);
  if (isTransfer || isIssue || isLabel || isReceive) {
    const di = ws.findIndex((w) => /^depo(ya|suna)$/.test(w));
    let toWarehouse: string | undefined;
    if (di > 0) {
      const ord = ordinal(ws[di - 1]!);
      toWarehouse = ord !== null ? `#${ord}` : ws[di - 1];
      mark(taken, di - 1, di + 1);
    }
    const q = firstQty(ws, taken);
    if (q !== null) mark(taken, q.start, q.end);
    const item = phrase(ws, taken);
    const base = {
      ...(q === null ? {} : { qty: q.value }),
      ...(q?.unit === undefined ? {} : { unit: q.unit }),
      ...(item === undefined ? {} : { item }),
    };
    if (isLabel) return { kind: "label", ...base, ...(at === undefined ? {} : { at: at.text }) };
    if (isTransfer) {
      return {
        kind: "transfer",
        ...base,
        ...(from === undefined ? {} : { from: from.text }),
        ...(to === undefined ? {} : { to: to.text }),
        ...(toWarehouse === undefined ? {} : { toWarehouse }),
      };
    }
    if (isIssue) {
      const src = from ?? at;
      return { kind: "issue", ...base, ...(src === undefined ? {} : { from: src.text }) };
    }
    const dst = to ?? at;
    return { kind: "receive", ...base, ...(dst === undefined ? {} : { to: dst.text }) };
  }

  const verb = /^(.+?) (ac|acar misin|git|goster|listele|getir|bul)$/.exec(f);
  if (verb !== null) {
    const target = words(verb[1]!)
      .filter((w) => !/^(ekran|sayfa|modul|liste)\w*$/.test(w) && w !== "bugunku" && w !== "bugun" && w !== "tum" && w !== "butun")
      .join(" ");
    if (target !== "") return { kind: "open", target };
  }
  return { kind: "unknown" };
}

/** Eşleştirme için ifadenin rakamlı biçimi ("koli bandı kırk beş" → "koli bandi 45"). */
export function matchForm(phraseText: string): string {
  return digitize(words(phraseText)).join(" ");
}
