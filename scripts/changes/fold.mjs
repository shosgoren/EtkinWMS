#!/usr/bin/env node
// `node scripts/changes/fold.mjs` (T-445, kullanıcı kararı 21 Ekim "süreler çok uzun"): her işin
// `docs/changes/<T-xxx>.md` parça dosyasını `docs/STATE.md` ve `docs/BACKLOG.md`'ye işler ve parçayı siler.
// Paralel PR'lar STATE/BACKLOG'a dokunmadığı için birbirleriyle çakışmaz; koordinatör birleşmeden sonra
// main üzerinde tek komut koşar. Biçim: `docs/changes/README.md`.
//
//   node scripts/changes/fold.mjs            işle + parçaları sil (yazmadan önce hepsi doğrulanır)
//   node scripts/changes/fold.mjs --check    yalnız doğrula (CI verify işinde); {PR}/{SHA} çözülmez
//   node scripts/changes/fold.mjs --dry-run  ne yapılacağını yaz, dosyalara dokunma
//
// İdempotent: aynı STATE satırı, aynı durum metni ya da aynı yeni BACKLOG satırı zaten varsa atlanır;
// parça kalmadıysa hiçbir şey değişmez. Bir parça hatalıysa HİÇBİR dosya yazılmaz (hepsi ya da hiçbiri).
// Yeni npm bağımlılığı yoktur.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CHANGES_DIR = "docs/changes";
export const STATE_FILE = "docs/STATE.md";
export const BACKLOG_FILE = "docs/BACKLOG.md";
/** STATE'te yeni satırların ekleneceği yer (varsa; yoksa ilk `- **T-` satırının önü). */
export const STATE_MARKER = "<!-- changes:state -->";
/** Bölüm adı verilmeyen yeni BACKLOG satırının gideceği bölüm (başlık öneki). */
export const DEFAULT_SECTION = "Eklemeler";

const FRAGMENT_RE = /^(T-\d{3,4}[a-z]?)\.md$/;
const IGNORED = new Set(["README.md"]);
const STATUS_RE = /^-\s+(B-\d+[a-z]?):\s+(\S.*)$/;
const NEW_RE = /^-\s+yeni(?:\s+\[([^\]]+)\])?:\s+(\|.*\|)\s*$/;
const PLACEHOLDER_RE = /\{(PR|SHA)\}/g;
const HAS_PLACEHOLDER = /\{(?:PR|SHA)\}/;

export class FoldError extends Error {
  /** @param {string} file @param {string} message */
  constructor(file, message) {
    super(`${file}: ${message}`);
    this.name = "FoldError";
    this.file = file;
  }
}

/**
 * @typedef {{ id: string, text: string }} StatusOp
 * @typedef {{ section: string, cells: string[] }} NewRowOp
 * @typedef {{ task: string, file: string, state: string[], status: StatusOp[], rows: NewRowOp[] }} Fragment
 * @typedef {(task: string) => { pr: string, sha: string } | null} Resolver
 */

/**
 * Markdown tablo satırını hücrelere böler (baştaki/sondaki `|` atılır, hücreler kırpılır).
 * @param {string} line
 * @returns {string[]}
 */
export function splitRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

/**
 * Parça dosyasını ayrıştırır. `## STATE` altındaki `- ` satırları STATE'e; `## BACKLOG` altındaki
 * `- B-xx: metin` satırları durum, `- yeni [Bölüm]: | hücre | … |` satırları yeni satırdır.
 * Diğer `##` bölümleri (ör. `## Not`) yok sayılır. Tanınmayan liste satırı hatadır (fail-closed).
 * @param {string} text
 * @param {string} file
 * @returns {Fragment}
 */
export function parseFragment(text, file) {
  const m = FRAGMENT_RE.exec(path.basename(file));
  if (m === null) throw new FoldError(file, "dosya adı `T-xxx.md` (3–4 hane, isteğe bağlı harf) olmalı");
  const task = /** @type {string} */ (m[1]);
  /** @type {Fragment} */
  const frag = { task, file, state: [], status: [], rows: [] };
  /** @type {"none" | "state" | "backlog" | "other"} */
  let section = "none";
  let inComment = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (inComment) {
      if (line.includes("-->")) inComment = false;
      continue;
    }
    if (line.trimStart().startsWith("<!--")) {
      if (!line.includes("-->")) inComment = true;
      continue;
    }
    const h = /^##\s+(.+)$/.exec(line);
    if (h !== null) {
      const name = (h[1] ?? "").trim().toUpperCase();
      section = name === "STATE" ? "state" : name === "BACKLOG" ? "backlog" : "other";
      continue;
    }
    if (section === "state") {
      if (line.trim() === "") continue;
      if (!line.startsWith("- ")) throw new FoldError(file, `STATE bölümünde yalnız tek satırlık "- " maddesi olur: "${line}"`);
      frag.state.push(line);
    } else if (section === "backlog") {
      if (line.trim() === "") continue;
      const s = STATUS_RE.exec(line);
      if (s !== null) {
        if ((s[2] ?? "").includes("|")) throw new FoldError(file, `durum metninde "|" olamaz (tablo hücresini böler): "${line}"`);
        frag.status.push({ id: /** @type {string} */ (s[1]), text: /** @type {string} */ (s[2]).trim() });
        continue;
      }
      const n = NEW_RE.exec(line);
      if (n !== null) {
        const cells = splitRow(/** @type {string} */ (n[2]));
        if (cells.some((c) => c === "")) throw new FoldError(file, `yeni satırda boş hücre: "${line}"`);
        if (/^B-/.test(cells[0] ?? "")) throw new FoldError(file, `yeni satıra B numarası yazılmaz (fold verir): "${line}"`);
        frag.rows.push({ section: (n[1] ?? DEFAULT_SECTION).trim(), cells });
        continue;
      }
      throw new FoldError(file, `BACKLOG satırı tanınmadı ("- B-xx: durum" ya da "- yeni [Bölüm]: | … |"): "${line}"`);
    }
  }
  if (frag.state.length + frag.status.length + frag.rows.length === 0) {
    throw new FoldError(file, "parça boş: `## STATE` ya da `## BACKLOG` altında en az bir madde olmalı");
  }
  return frag;
}

/**
 * Yer tutucuları ({PR}, {SHA}) çözer. Çözülemezse hata.
 * @param {Fragment} frag
 * @param {Resolver} resolve
 * @returns {Fragment}
 */
export function resolvePlaceholders(frag, resolve) {
  const all = [...frag.state, ...frag.status.map((s) => s.text), ...frag.rows.flatMap((r) => r.cells)];
  if (!all.some((t) => HAS_PLACEHOLDER.test(t))) return frag;
  const found = resolve(frag.task);
  if (found === null) throw new FoldError(frag.file, `{PR}/{SHA} çözülemedi: ${frag.task} için birleşme commit'i bulunamadı (önce PR birleşmeli)`);
  /** @param {string} t */
  const sub = (t) => t.replace(PLACEHOLDER_RE, (_, k) => (k === "PR" ? found.pr : found.sha));
  return {
    ...frag,
    state: frag.state.map(sub),
    status: frag.status.map((s) => ({ ...s, text: sub(s.text) })),
    rows: frag.rows.map((r) => ({ ...r, cells: r.cells.map(sub) })),
  };
}

/**
 * STATE'e maddeleri ekler (en yeni üstte; parça sırası korunur). Aynı satır varsa atlanır.
 * @param {string} state
 * @param {string[]} items
 * @returns {{ text: string, added: number }}
 */
export function applyState(state, items) {
  const lines = state.split("\n");
  const existing = new Set(lines.map((l) => l.trimEnd()));
  /** @type {string[]} */
  const fresh = [];
  for (const i of items) if (!existing.has(i) && !fresh.includes(i)) fresh.push(i);
  if (fresh.length === 0) return { text: state, added: 0 };
  let at = lines.findIndex((l) => l.trim() === STATE_MARKER);
  if (at !== -1) at += 1;
  else at = lines.findIndex((l) => /^- \*\*T-\d/.test(l));
  if (at === -1) throw new FoldError(STATE_FILE, `ekleme yeri yok: "${STATE_MARKER}" satırı ya da "- **T-" maddesi bulunamadı`);
  lines.splice(at, 0, ...fresh);
  return { text: lines.join("\n"), added: fresh.length };
}

/**
 * BACKLOG'a durum ve yeni satırları işler.
 * Durum: `| B-xx | <iş> | …` satırının iş hücresine `**<metin>** — ` öneki (metin hücrede zaten varsa atlanır).
 * Yeni satır: bölüm başlığı (`## <ön ek>…`) altındaki tablonun sonuna, sıradaki boş B numarasıyla;
 * hücre sayısı tablo başlığıyla aynı olmalı; aynı iş metni o tabloda varsa atlanır.
 * @param {string} backlog
 * @param {StatusOp[]} status
 * @param {NewRowOp[]} rows
 * @param {string} file hata iletisi için parça yolu
 * @returns {{ text: string, updated: number, added: string[] }}
 */
export function applyBacklog(backlog, status, rows, file) {
  const lines = backlog.split("\n");
  let updated = 0;
  for (const op of status) {
    const idx = lines.findIndex((l) => splitRow(l)[0] === op.id && l.trimStart().startsWith("|"));
    if (idx === -1) throw new FoldError(file, `${op.id} BACKLOG'da yok`);
    const line = /** @type {string} */ (lines[idx]);
    if (line.includes(op.text)) continue;
    const cells = splitRow(line);
    if (cells.length < 2) throw new FoldError(file, `${op.id} satırında iş hücresi yok`);
    cells[1] = `**${op.text}** — ${cells[1]}`;
    lines[idx] = `| ${cells.join(" | ")} |`;
    updated += 1;
  }
  let max = 0;
  for (const l of lines) {
    const m = /^\|\s*B-(\d+)[a-z]?\s*\|/.exec(l);
    if (m !== null) max = Math.max(max, Number(m[1]));
  }
  /** @type {string[]} */
  const added = [];
  for (const op of rows) {
    const h = lines.findIndex((l) => /^##\s/.test(l) && l.replace(/^##\s+/, "").startsWith(op.section));
    if (h === -1) throw new FoldError(file, `BACKLOG'da "## ${op.section}" bölümü yok`);
    let i = h + 1;
    while (i < lines.length && !(lines[i] ?? "").trimStart().startsWith("|") && !/^##\s/.test(lines[i] ?? "")) i++;
    if (i >= lines.length || !(lines[i] ?? "").trimStart().startsWith("|")) {
      throw new FoldError(file, `"## ${op.section}" bölümünde tablo yok`);
    }
    const width = splitRow(lines[i] ?? "").length;
    if (op.cells.length + 1 !== width) {
      throw new FoldError(file, `"## ${op.section}" tablosu ${width} sütun; yeni satır ${op.cells.length} hücre (ID hariç ${width - 1} olmalı)`);
    }
    let end = i;
    while (end < lines.length && (lines[end] ?? "").trimStart().startsWith("|")) end++;
    const body = lines.slice(i + 2, end).map(splitRow);
    if (body.some((c) => c[1] === op.cells[0])) continue;
    max += 1;
    const id = `B-${max}`;
    lines.splice(end, 0, `| ${[id, ...op.cells].join(" | ")} |`);
    added.push(id);
  }
  return { text: lines.join("\n"), updated, added };
}

/**
 * Birleşme commit'inden PR numarası ve kısa SHA. `Merge pull request #N from <sahip>/<feat|fix>/<T-id>-…`
 * ya da squash konusu `… (#N)` (parçayı ekleyen commit). Bulunamazsa `null`.
 * @param {string} root
 * @returns {Resolver}
 */
export function gitResolver(root) {
  /** @param {string[]} args */
  const git = (args) => {
    try {
      return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return "";
    }
  };
  return (task) => {
    const rel = `${CHANGES_DIR}/${task}.md`;
    // Parçayı (en son) ekleyen commit: aynı kart numarası birden çok PR'da kullanıldıysa doğru PR bu commit'i getiren birleşmedir.
    const added = git(["log", "--diff-filter=A", "--format=%H%x09%s", "-n", "1", "--", rel]).trim();
    const [addSha, addSubject] = added.split("\t");
    const esc = task.replace(/[-]/g, "\\-");
    const re = new RegExp(`^Merge pull request #(\\d+) from \\S+/(?:feat|fix)/${esc}-`);
    // Parçayı getiren birleşme: ekleyen commitin soyundan gelen (ancestry-path) ve konusu bu kartın dalını anan en eski PR birleşmesi; ara "main into dal" birleşmeleri konu kalıbına uymaz, atlanır.
    const range = addSha ? ["--ancestry-path", `${addSha}..HEAD`] : [];
    const merges = git(["log", "--merges", "--reverse", "--topo-order", "--format=%h%x09%s", ...range]).split("\n");
    for (const l of merges) {
      const [sha, subject] = l.split("\t");
      const m = re.exec(subject ?? "");
      if (m !== null && sha) return { pr: `#${m[1]}`, sha };
    }
    // Squash birleşmesi: parçayı ekleyen commit'in konusu `… (#N)`.
    const sq = /\(#(\d+)\)\s*$/.exec(addSubject ?? "");
    if (sq !== null && addSha) return { pr: `#${sq[1]}`, sha: addSha.slice(0, 7) };
    return null;
  };
}

/**
 * Dizindeki parça dosyaları (ad sırasıyla). `README.md` atlanır; başka ad hatadır.
 * @param {string} root
 * @returns {string[]} depo köküne göre yollar
 */
export function listFragments(root) {
  const dir = path.join(root, CHANGES_DIR);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (IGNORED.has(name) || name.startsWith(".")) continue;
    if (!FRAGMENT_RE.test(name)) throw new FoldError(`${CHANGES_DIR}/${name}`, "dosya adı `T-xxx.md` olmalı (ya da README.md)");
    out.push(`${CHANGES_DIR}/${name}`);
  }
  return out;
}

/**
 * @param {{ root: string, mode: "fold" | "check" | "dry-run", resolve?: Resolver, log?: (s: string) => void }} opts
 * @returns {{ fragments: number, stateAdded: number, backlogUpdated: number, backlogAdded: string[] }}
 */
export function fold({ root, mode, resolve = gitResolver(root), log = console.log }) {
  const files = listFragments(root);
  const read = (/** @type {string} */ rel) => readFileSync(path.join(root, rel), "utf8");
  let state = read(STATE_FILE);
  let backlog = read(BACKLOG_FILE);
  let stateAdded = 0;
  let backlogUpdated = 0;
  /** @type {string[]} */
  const backlogAdded = [];
  for (const rel of files) {
    let frag = parseFragment(read(rel), rel);
    if (mode !== "check") frag = resolvePlaceholders(frag, resolve);
    const s = applyState(state, frag.state);
    const b = applyBacklog(backlog, frag.status, frag.rows, rel);
    state = s.text;
    backlog = b.text;
    stateAdded += s.added;
    backlogUpdated += b.updated;
    backlogAdded.push(...b.added);
    log(`${rel}: STATE +${s.added} · BACKLOG durum ${b.updated} · yeni ${b.added.join(", ") || "0"}`);
  }
  if (mode === "fold" && files.length > 0) {
    writeFileSync(path.join(root, STATE_FILE), state);
    writeFileSync(path.join(root, BACKLOG_FILE), backlog);
    for (const rel of files) rmSync(path.join(root, rel));
  }
  const verb = mode === "fold" ? "işlendi ve silindi" : mode === "check" ? "doğrulandı" : "işlenecek (yazılmadı)";
  log(`[changes:fold] ${mode === "check" ? "OK" : "DONE"} — ${files.length} parça ${verb}; STATE +${stateAdded}, BACKLOG durum ${backlogUpdated}, yeni ${backlogAdded.length}`);
  return { fragments: files.length, stateAdded, backlogUpdated, backlogAdded };
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== "--check" && a !== "--dry-run");
  if (unknown.length > 0) {
    console.error(`[changes:fold] bilinmeyen argüman: ${unknown.join(" ")} (yalnız --check, --dry-run)`);
    process.exit(2);
  }
  const mode = args.includes("--check") ? "check" : args.includes("--dry-run") ? "dry-run" : "fold";
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  try {
    fold({ root, mode });
  } catch (e) {
    if (e instanceof FoldError) {
      console.error(`[changes:fold] FAIL ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}
