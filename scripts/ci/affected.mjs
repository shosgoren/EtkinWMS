// T-1022 (kullanıcı kararı 22 Ekim): PR'da yalnız etkilenen int/e2e testleri. KORUNAN DOSYA (scripts/ci/**).
//
// Güven modeli: `ci.yml` `changes` işi bu betiği PR'ın değil TABANIN kopyasından koşturur (`base/scripts/ci/affected.mjs`);
// PR ağacı yalnız VERİ olarak okunur (dosya listesi + içe aktarma satırları), PR kodu çalıştırılmaz. Tabanda betik yoksa iş tam takım.
// main/int push'unda betik hiç kullanılmaz: her zaman tam takım (yayın kapısı main'in tam sonucunu ister).
//
// Kural: şüphede TAM takım. Bir dosya için aşağıdakilerden biri kesin değilse sonuç `full`:
//   1. Belge (`docs/**`, `*.md`)                         → etkisiz (testler belge okumaz; T-925 kuralı).
//   2. Ortak/altyapı dosyası (FULL_RULES)                  → tam takım (iki takım da).
//   3. Değişen spec / int testi                            → kendisi seçilir.
//   4. Kaynak dosya                                         → içe aktarma grafiğinde onu (dolaylı) kullanan dosyalar bulunur:
//      - int: onu kullanan `*.int.test.ts` + dinamik/dosya okuyan "joker" int testleri (grafiği kesin değil, her kaynak değişikliğinde koşar);
//      - e2e: onu kullanan web rota dosyalarının bölümü (`app/t/[slug]/<bölüm>/…`, `app/<bölüm>/…`) → o bölümün yolunu (`/<bölüm>`) anan
//        spec'ler. Paylaşılan yere (layout, kalip, kabuk, ana ekran, api, worker) ulaşan ya da hiçbir spec'in anmadığı bölüm → tam e2e.
//      - Hiçbir test/rota/worker dosyasının ulaşmadığı kaynak → tam takım (eşlemesi yok).
//   5. Başka her dosya → tam takım.
// Testsiz birim test dosyası (`*.test.*`, int değil) grafikte başka dosyaca içe aktarılmıyorsa etkisizdir (verify zaten koşar).
import { execFileSync } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const CODE_EXT = [".ts", ".tsx", ".mts", ".cts", ".mjs", ".js", ".cjs", ".jsx"];
const RESOLVE_EXT = [...CODE_EXT, ".json", ".css"];
const SCAN_DIRS = ["apps", "packages", "tests", "scripts", "marketing"];
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", ".artifacts", ".turbo", "coverage"]);

/**
 * Değişince tam koşan takım: "both" (kullanıcı listesi + altyapı: iki takım), "e2e" (yalnız web/e2e ortamı; int grafikle seçilir),
 * "int" (yalnız int ortamı; e2e grafikle). Glob değil: düzenli ifade. Değişen dosyayı (dolaylı) kullanan ortak dosya yalnız e2e'yi tam yapar
 * (int testleri içe aktarma grafiğiyle zaten bulunur).
 */
/** @typedef {"both" | "e2e" | "int"} Scope */
/** @type {ReadonlyArray<readonly [RegExp, string, Scope]>} */
const FULL_RULES = [
  [/^\.github\//, "workflow", "both"],
  [/(^|\/)package\.json$/, "package.json", "both"],
  [/^pnpm-lock\.yaml$/, "lockfile", "both"],
  [/^pnpm-workspace\.ya?ml$/, "pnpm-workspace", "both"],
  [/(^|\/)\.npmrc$/, ".npmrc", "both"],
  [/(^|\/)\.pnpmfile\./, "pnpmfile", "both"],
  [/(^|\/)tsconfig[^/]*\.json$/, "tsconfig", "both"],
  [/(^|\/)playwright\.config\./, "playwright.config", "both"],
  [/(^|\/)vitest[^/]*\.config\./, "vitest config", "both"],
  [/(^|\/)vitest\.workspace\./, "vitest workspace", "both"],
  [/^docker-compose[^/]*\.ya?ml$/, "compose", "both"],
  [/^\.env\.example$/, ".env.example", "both"],
  [/^infra\//, "infra", "both"],
  [/^Dockerfile$/, "Dockerfile", "both"],
  [/(^|\/)migrations\//, "migrations", "both"],
  [/^packages\/db\//, "packages/db", "both"],
  [/^packages\/auth\//, "packages/auth", "both"],
  [/^packages\/shared\//, "packages/shared", "both"],
  [/^packages\/ui\//, "packages/ui", "both"],
  [/^packages\/queue-adapter\//, "packages/queue-adapter", "both"],
  [/^packages\/storage\//, "packages/storage", "both"],
  [/^packages\/domain\/src\/identity\//, "domain ortak (identity: yetki/üyelik)", "both"],
  [/^packages\/domain\/src\/[^/]+$/, "domain kökü", "both"],
  [/^packages\/[^/]+\/[^/]+$/, "paket kök dosyası", "both"],
  [/^apps\/web\/app\/globals\.css$/, "globals.css", "both"],
  [/(^|\/)layout\.tsx?$/, "layout", "both"],
  [/^apps\/web\/app\/t\/\[slug\]\/(kalip|kabuk)\//, "kalip/kabuk", "both"],
  [/^apps\/web\/app\/[^/]+$/, "web app kök dosyası", "e2e"],
  [/^apps\/web\/app\/t\/\[slug\]\/[^/]+$/, "ana ekran / ortak tenant dosyası", "e2e"],
  [/^apps\/web\/app\/api\//, "api", "e2e"],
  [/^apps\/web\/(proxy|middleware|next\.config|postcss\.config|instrumentation)[^/]*$/, "web yapılandırması", "e2e"],
  [/^apps\/web\/(i18n|messages)\//, "i18n/messages", "e2e"],
  [/^apps\/web\/[^/]+$/, "web kök dosyası", "e2e"],
  [/^tests\/e2e\/(global-setup|global-teardown)\./, "e2e global-setup", "e2e"],
  [/^tests\/e2e\/support\//, "e2e support", "e2e"],
  [/^tests\/integration\/(harness|fixtures|support)\//, "int harness/fixtures", "int"],
  [/^tests\/[^/]+$/, "tests kök dosyası", "both"],
  [/^scripts\/ci\//, "seçici betik", "both"],
  [/^marketing\//, "satış sitesi (e2e)", "e2e"],
  [/^deploy\//, "deploy", "both"],
];

const DOC_RE = /^docs\/|\.md$/;
const E2E_SPEC_RE = /^tests\/e2e\/[A-Za-z0-9._-]+\.spec\.ts$/;
const INT_TEST_RE = /^tests\/integration\/[A-Za-z0-9._/-]+\.int\.test\.ts$/;
const UNIT_TEST_RE = /\.test\.(ts|tsx|mts|mjs|js)$/;
/** Ses servisi kendi `voice` işinde (her kod değişikliğinde) test edilir; int/e2e onu sahte sunucuyla kullanır. */
const VOICE_RE = /^services\/voice\//;
/** Grafiği kesin olmayan test: hesaplanmış yolla dinamik içe aktarım, kaynak/dosya okuma. Her kaynak değişikliğinde seçilir. */
const WILDCARD_RE = /import\(\s*[^"'`\s)]|import\(\s*`|require\(\s*[^"'\s)]|readFileSync|readdirSync|createRequire|new URL\(/;

const IMPORT_RES = [
  /(?:^|[^.\w$])(?:import|export)\s+(?:type\s+)?(?:[^"'`;]*?\s+from\s+)?["']([^"'\n]+)["']/g,
  /(?:^|[^.\w$])import\(\s*["']([^"'\n]+)["']\s*[,)]/g,
  /(?:^|[^.\w$])require\(\s*["']([^"'\n]+)["']\s*\)/g,
  /@import\s+(?:url\()?["']([^"'\n]+)["']/g,
];

const MAX_INT_SHARDS = 3;
export const FULL_E2E_MATRIX = { include: ["desktop", "mobile"].flatMap((group) => [1, 2].map((part) => ({ group, part, of: 2 }))) };
export const FULL_INT_MATRIX = { include: [1, 2, 3].map((shard) => ({ shard, of: 3 })) };

/** Depo dosyaları (git ls-files yerine dizin taraması: birleşme ağacında izlenmeyen derleme çıktıları SKIP_DIRS ile dışarıda). */
/** @param {string} root @returns {string[]} */
export function listRepoFiles(root) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} rel */
  const walk = (rel) => {
    let entries;
    try {
      entries = readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name) || e.name === ".git") continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.isFile()) out.push(r);
    }
  };
  for (const d of SCAN_DIRS) walk(d);
  try {
    for (const e of readdirSync(root, { withFileTypes: true })) if (e.isFile()) out.push(e.name);
  } catch {
    // kök okunamazsa değişen kök dosyaları "silinen/izlenmeyen" sayılır → tam takım
  }
  return out;
}

/**
 * @param {string} root @param {string[]} files
 * @returns {Map<string, { dir: string, exports: unknown }>}
 */
function workspacePackages(root, files) {
  /** @type {Map<string, { dir: string, exports: unknown }>} */
  const pkgs = new Map();
  for (const f of files) {
    if (!/^(apps|packages)\/[^/]+\/package\.json$/.test(f)) continue;
    try {
      const j = JSON.parse(readFileSync(path.join(root, f), "utf8"));
      if (typeof j.name === "string") pkgs.set(j.name, { dir: path.posix.dirname(f), exports: j.exports ?? j.main ?? null });
    } catch {
      // okunamayan package.json zaten FULL kuralına girer
    }
  }
  return pkgs;
}

/** İçe aktarma grafiği: dosya → içe aktardığı depo dosyaları. Çözülemeyen `@wms/*` → paketin bütün dosyaları (temkinli). */
/**
 * @typedef {{ deps: Map<string, Set<string>>, rdeps: Map<string, Set<string>>, wildcard: Set<string> }} Graph
 * @param {string} root @param {string[]} files @returns {Graph}
 */
export function buildGraph(root, files) {
  const fileSet = new Set(files);
  const pkgs = workspacePackages(root, files);
  /** @type {Map<string, string[]>} */
  const byDir = new Map();
  for (const f of files) {
    for (let d = path.posix.dirname(f); d !== "."; d = path.posix.dirname(d)) {
      const list = byDir.get(d) ?? [];
      list.push(f);
      byDir.set(d, list);
    }
  }
  /** @param {string} p @returns {string[] | null} */
  const tryFile = (p) => {
    const n = path.posix.normalize(p);
    if (fileSet.has(n)) return [n];
    const stripped = n.replace(/\.(m|c)?jsx?$/, "");
    for (const base of stripped === n ? [n] : [n, stripped]) {
      for (const ext of RESOLVE_EXT) if (fileSet.has(base + ext)) return [base + ext];
      for (const ext of RESOLVE_EXT) if (fileSet.has(`${base}/index${ext}`)) return [`${base}/index${ext}`];
    }
    return null;
  };
  /** @param {string} from @param {string} spec @returns {string[] | "unresolved"} */
  const resolve = (from, spec) => {
    if (spec.startsWith(".")) return tryFile(path.posix.join(path.posix.dirname(from), spec)) ?? "unresolved";
    const m = /^(@wms\/[^/]+)(\/.*)?$/.exec(spec);
    if (m === null) return []; // dış paket
    const pkg = pkgs.get(m[1] ?? "");
    if (pkg === undefined) return "unresolved";
    const sub = m[2] ? `.${m[2]}` : ".";
    const ex = pkg.exports;
    const target = typeof ex === "string" ? (sub === "." ? ex : null) : ex !== null && typeof ex === "object" ? /** @type {Record<string, unknown>} */ (ex)[sub] : null;
    const hit = typeof target === "string" ? tryFile(path.posix.join(pkg.dir, target)) : null;
    return hit ?? (byDir.get(pkg.dir) ?? []);
  };
  /** @type {Map<string, Set<string>>} */
  const deps = new Map();
  /** @type {Set<string>} */
  const wildcard = new Set();
  for (const f of files) {
    if (!CODE_EXT.includes(path.posix.extname(f)) && path.posix.extname(f) !== ".css") continue;
    if (f.endsWith(".d.ts")) continue; // yalnız tür bildirimi (next-env.d.ts vb.): çalışma zamanı bağımlılığı değil
    let text;
    try {
      text = readFileSync(path.join(root, f), "utf8");
    } catch {
      continue;
    }
    if (WILDCARD_RE.test(text)) wildcard.add(f);
    /** @type {Set<string>} */
    const out = new Set();
    for (const re of IMPORT_RES) {
      for (const m of text.matchAll(re)) {
        const spec = m[1];
        if (spec === undefined) continue;
        const r = resolve(f, spec);
        // Çözülemeyen göreli içe aktarım: hedef depoda yok (derleme/typecheck zaten kırmızı) ya da üretilen dosya (.next/types). Hesaplanmış
        // yollu içe aktarımlar burada değil, WILDCARD_RE ile (joker test) ele alınır.
        if (r !== "unresolved") for (const g of r) out.add(g);
      }
    }
    out.delete(f);
    deps.set(f, out);
  }
  /** @type {Map<string, Set<string>>} */
  const rdeps = new Map();
  for (const [f, ds] of deps) for (const d of ds) {
    const set = rdeps.get(d) ?? new Set();
    set.add(f);
    rdeps.set(d, set);
  }
  return { deps, rdeps, wildcard };
}

/** `f`'yi doğrudan ya da dolaylı içe aktaran bütün dosyalar (f dahil). */
/** @param {Graph} graph @param {string} f @returns {Set<string>} */
function dependents(graph, f) {
  const seen = new Set([f]);
  const queue = [f];
  for (let cur = queue.pop(); cur !== undefined; cur = queue.pop()) {
    for (const p of graph.rdeps.get(cur) ?? []) if (!seen.has(p)) {
      seen.add(p);
      queue.push(p);
    }
  }
  return seen;
}

/** Web rota dosyasının e2e bölümü; paylaşılan yerse `null` (tam e2e). Rota dışı web dosyası (lib/…) `undefined`. */
/** @param {string} f @returns {string | null | undefined} */
export function webSection(f) {
  if (!f.startsWith("apps/web/app/")) return undefined;
  const rest = f.slice("apps/web/app/".length).split("/");
  if (rest.length === 1) return null; // app kökü
  if (rest[0] === "api") return null;
  if (rest[0] === "design") return undefined; // tasarım CSS/belirteçleri rota değil: kullanan sayfalar grafikle bulunur
  if (rest[0] === "t") {
    if (rest[1] !== "[slug]" || rest.length <= 3) return null; // ana ekran / ortak tenant dosyası
    if (rest[2] === "kalip" || rest[2] === "kabuk") return null;
    return rest[2];
  }
  return rest[0];
}

/** @param {string} section @param {Map<string, string>} specTexts @returns {string[]} */
export function specsForSection(section, specTexts) {
  const re = new RegExp(`/${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_-])`);
  return [...specTexts].filter(([, text]) => re.test(text)).map(([spec]) => spec);
}

/**
 * @param {{ root: string, changed: string[], files?: string[] }} args
 * @returns {{ full: boolean, fullE2e: boolean, fullInt: boolean, reasons: string[], e2e: string[], int: string[], code: boolean }}
 */
export function selectTests({ root, changed, files = listRepoFiles(root) }) {
  /** @type {string[]} */
  const reasons = [];
  let fullE2e = false;
  let fullInt = false;
  /** @type {Set<string>} */
  const e2e = new Set();
  /** @type {Set<string>} */
  const int = new Set();
  const code = changed.some((f) => !DOC_RE.test(f));
  if (changed.length === 0) return { full: true, fullE2e: true, fullInt: true, reasons: ["boş fark"], e2e: [], int: [], code: true };

  const fileSet = new Set(files);
  const specs = files.filter((f) => E2E_SPEC_RE.test(f));
  const intTests = files.filter((f) => INT_TEST_RE.test(f));
  const specTexts = new Map(specs.map((s) => [s, readFileSync(path.join(root, s), "utf8")]));
  /** @type {Graph | null} */
  let graph = null;
  const g = () => (graph ??= buildGraph(root, files));
  let sourceChanged = false;

  for (const f of changed) {
    if (DOC_RE.test(f)) continue;
    if (!/^[A-Za-z0-9._@/[\] -]+$/.test(f)) {
      reasons.push(`${f}: beklenmeyen karakter`);
      fullE2e = fullInt = true;
      continue;
    }
    // Yalnız birim testi (başka dosya içe aktarmıyorsa): verify koşar, int/e2e etkisi yok.
    if (UNIT_TEST_RE.test(f) && !INT_TEST_RE.test(f) && fileSet.has(f) && dependents(g(), f).size === 1) continue;
    const rules = FULL_RULES.filter(([re]) => re.test(f));
    if (rules.some(([, , scope]) => scope === "both") || (rules.some(([, , sc]) => sc === "e2e") && rules.some(([, , sc]) => sc === "int"))) {
      reasons.push(`${f}: ${rules.map(([, why]) => why).join(", ")}`);
      fullE2e = fullInt = true;
      continue;
    }
    const first = rules[0];
    if (first !== undefined) {
      // Tek takımlık ortak dosya: o takım tam, diğeri aşağıda grafikle.
      reasons.push(`${f}: ${first[1]} (${first[2]})`);
      if (first[2] === "e2e") fullE2e = true;
      else fullInt = true;
    }
    if (VOICE_RE.test(f)) continue;
    if (E2E_SPEC_RE.test(f)) {
      if (fileSet.has(f)) e2e.add(f); // silinen spec: seçilecek bir şey yok
      continue;
    }
    if (INT_TEST_RE.test(f)) {
      if (fileSet.has(f)) int.add(f);
      continue;
    }
    if (!fileSet.has(f)) {
      // Silinen kaynak: artık kim kullandığını grafik söyleyemez.
      reasons.push(`${f}: silinen/izlenmeyen dosya`);
      fullE2e = fullInt = true;
      continue;
    }
    const users = dependents(g(), f);
    sourceChanged = true;
    let mapped = false;
    for (const u of users) {
      if (INT_TEST_RE.test(u)) {
        int.add(u);
        mapped = true;
      }
      if (E2E_SPEC_RE.test(u)) {
        e2e.add(u);
        mapped = true;
      }
      if (u.startsWith("apps/worker/")) {
        if (!fullE2e) reasons.push(`${f}: worker kullanıyor (e2e)`);
        fullE2e = true;
        mapped = true;
      }
      if (u !== f && FULL_RULES.some(([re]) => re.test(u))) {
        if (!fullE2e) reasons.push(`${f}: ortak dosya kullanıyor (${u}) — e2e`);
        fullE2e = true;
        mapped = true;
      }
      const section = webSection(u);
      if (section === null) {
        reasons.push(`${f}: paylaşılan web dosyası kullanıyor (${u})`);
        fullE2e = true;
        mapped = true;
      } else if (section !== undefined) {
        const hit = specsForSection(section, specTexts);
        if (hit.length === 0) {
          reasons.push(`${f}: '/${section}' bölümünü anan spec yok`);
          fullE2e = true;
        } else for (const s of hit) e2e.add(s);
        mapped = true;
      }
    }
    if (rules.length > 0) mapped = true;
    if (!mapped) {
      reasons.push(`${f}: eşlemesi yok`);
      fullE2e = fullInt = true;
    }
  }
  if (sourceChanged) for (const t of intTests) if (g().wildcard.has(t)) int.add(t);
  return {
    full: fullE2e && fullInt,
    fullE2e,
    fullInt,
    reasons,
    e2e: fullE2e ? [] : [...e2e].sort(),
    int: fullInt ? [] : [...int].sort(),
    code,
  };
}

/** GitHub Actions çıktıları: `*_run`, `*_files`, `*_matrix` (parça sayısı seçime göre; işçi sayısı artmaz). */
/**
 * @param {{ code: boolean, full: boolean, fullE2e: boolean, fullInt: boolean, reasons: string[], e2e: string[], int: string[] }} sel
 * @returns {{ code: string, full: string, e2e_run: string, int_run: string, e2e_files: string, int_files: string, e2e_matrix: string, int_matrix: string }}
 */
export function toOutputs(sel) {
  const e2eRun = sel.code && (sel.fullE2e || sel.e2e.length > 0);
  const intRun = sel.code && (sel.fullInt || sel.int.length > 0);
  // e2e: grup başına 4+ spec dosyasında iki dilim, aksi hâlde bir (Playwright dosyaları bölmez; boş dilim açılmaz).
  const parts = sel.e2e.length >= 4 ? 2 : 1;
  // int: ~15 dosyaya kadar tek parça (her parça kendi veritabanını kurar; küçük seçimde parça açmak süre kazandırmaz).
  const shards = sel.fullInt ? MAX_INT_SHARDS : sel.int.length >= 40 ? 3 : sel.int.length >= 15 ? 2 : 1;
  return {
    code: String(sel.code),
    full: String(sel.full),
    e2e_run: String(e2eRun),
    int_run: String(intRun),
    e2e_files: sel.fullE2e ? "" : sel.e2e.join(" "),
    int_files: sel.fullInt ? "" : sel.int.join(" "),
    e2e_matrix: JSON.stringify(sel.fullE2e ? FULL_E2E_MATRIX : { include: ["desktop", "mobile"].flatMap((group) => Array.from({ length: parts }, (_, i) => ({ group, part: i + 1, of: parts }))) }),
    int_matrix: JSON.stringify(sel.fullInt ? FULL_INT_MATRIX : { include: Array.from({ length: shards }, (_, i) => ({ shard: i + 1, of: shards })) }),
  };
}

export const FULL_OUTPUTS = Object.freeze(toOutputs({ code: true, full: true, fullE2e: true, fullInt: true, reasons: [], e2e: [], int: [] }));

/** @param {string[]} argv */
function main(argv) {
  /** @param {string} name */
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const root = path.resolve(arg("--root") ?? ".");
  const base = arg("--base");
  const head = arg("--head");
  let outputs;
  let sel;
  try {
    if (!/^[0-9a-f]{40}$/.test(base ?? "") || !/^[0-9a-f]{40}$/.test(head ?? "")) throw new Error("base/head SHA geçersiz");
    const diff = execFileSync("git", ["-C", root, "diff", "--no-renames", "--name-only", "-z", `${base}...${head}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const changed = diff.split("\0").filter(Boolean);
    sel = selectTests({ root, changed });
    outputs = toOutputs(sel);
  } catch (e) {
    console.log(`::warning::etkilenen test seçimi yapılamadı (${e instanceof Error ? e.message : String(e)}) — tam takım`);
    outputs = { ...FULL_OUTPUTS };
  }
  if (sel !== undefined) {
    console.log(`kod: ${sel.code} · tam e2e: ${sel.fullE2e} · tam int: ${sel.fullInt}`);
    for (const r of [...new Set(sel.reasons)].slice(0, 40)) console.log(`  tam takım nedeni: ${r}`);
    if (!sel.fullE2e) console.log(`e2e (${sel.e2e.length}): ${sel.e2e.join(" ") || "—"}`);
    if (!sel.fullInt) console.log(`int (${sel.int.length}): ${sel.int.join(" ") || "—"}`);
  }
  const out = process.env.GITHUB_OUTPUT;
  const lines = Object.entries(outputs).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
  if (out) appendFileSync(out, lines);
  else process.stdout.write(lines);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main(process.argv.slice(2));
}

