#!/usr/bin/env node
// Haftalık taban imaj güvenlik denetimi (T-1030). `.github/workflows/security-scan.yml` her hafta koşar:
//   node scripts/security-scan.mjs
// 1) Node.js: Dockerfile `NODE_IMAGE` sürümünden yeni, aynı ana sürümde `security: true` işaretli bir
//    nodejs.org yayını varsa FAIL (T-1029'daki 24.21.0 → 24.22.1 gibi).
// 2) PostgreSQL: deploy/vps/database/compose.yml imajından yeni bir ara sürüm (aynı ana sürüm) Docker Hub'da
//    varsa FAIL. Etiketler son güncellenen önce istenir; en yeni ara sürüm ilk 100 etikettedir. PostgreSQL ara sürümleri güvenlik düzeltmesi taşır; ayrımı yapılmaz.
// 3) Sürümü sabitlenmemiş imaj (ör. `caddy:2`) yalnız UYARI (B-32).
// Herhangi bir FAIL → çıkış kodu 1 (iş kırmızı → GitHub zamanlanmış iş hatası e-postası).
// Sır görmez; ağdan yalnız iki herkese açık JSON okur.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SOURCES = Object.freeze({
  nodeIndex: "https://nodejs.org/dist/index.json",
  postgresTags: (/** @type {number} */ major) =>
    `https://hub.docker.com/v2/repositories/library/postgres/tags?page_size=100&ordering=last_updated&name=${major}.`,
});

/** @param {string} v */
function parts(v) {
  return v.replace(/^v/, "").split(".").map(Number);
}

/**
 * a > b ise pozitif.
 * @param {string} a
 * @param {string} b
 */
export function compareVersions(a, b) {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Dockerfile'daki `ARG NODE_IMAGE=…node:<sürüm>-…` sürümü.
 * @param {string} dockerfile
 * @returns {string | null}
 */
export function parseNodeImage(dockerfile) {
  const m = /^ARG NODE_IMAGE=\S*\/node:(\d+\.\d+\.\d+)-/m.exec(dockerfile);
  return m?.[1] ?? null;
}

/**
 * Compose dosyasındaki `image: postgres:<ana>.<ara>-…` sürümü.
 * @param {string} compose
 * @returns {string | null}
 */
export function parsePostgresImage(compose) {
  const m = /^\s*image:\s*postgres:(\d+\.\d+)[-@\s]/m.exec(compose);
  return m?.[1] ?? null;
}

/**
 * Sürümü sabitlenmemiş imajlar (etiket yalnız ana sürüm ya da yok, digest yok). Kendi imajlarımız hariç.
 * @param {string} compose
 * @returns {string[]}
 */
export function findUnpinnedImages(compose) {
  const out = [];
  for (const m of compose.matchAll(/^\s*image:\s*(\S+)\s*$/gm)) {
    const ref = m[1];
    if (ref === undefined) continue;
    if (ref.startsWith("etkinwms") || ref.includes("@sha256:")) continue;
    const tag = ref.split(":")[1];
    if (tag === undefined || /^\d+$/.test(tag) || tag === "latest") out.push(ref);
  }
  return out;
}

/**
 * Aynı ana sürümde, mevcut sürümden yeni ve güvenlik yayını olan en yeni Node sürümü.
 * @param {{ version: string, security?: boolean, date?: string }[]} index
 * @param {string} current
 * @returns {{ latestSecurity: string | null, latest: string | null }}
 */
export function nodeSecurityGap(index, current) {
  const major = parts(current)[0];
  const newer = index.filter(
    (r) => parts(r.version)[0] === major && compareVersions(r.version, current) > 0,
  );
  const pick = (/** @type {typeof newer} */ list) =>
    list.length ? list.map((r) => r.version.replace(/^v/, "")).sort(compareVersions).at(-1) ?? null : null;
  return { latestSecurity: pick(newer.filter((r) => r.security === true)), latest: pick(newer) };
}

/**
 * Docker Hub etiketlerinden aynı ana sürümün en yeni ara sürümü (yalnız `<ana>.<ara>` biçimli etiketler).
 * @param {{ name: string }[]} tags
 * @param {string} current
 * @returns {string | null} mevcut sürümden yeniyse o sürüm, değilse null
 */
export function postgresGap(tags, current) {
  const major = parts(current)[0];
  const minors = tags
    .map((t) => t.name)
    .filter((n) => new RegExp(`^${major}\\.\\d+$`).test(n))
    .sort(compareVersions);
  const latest = minors.at(-1);
  return latest && compareVersions(latest, current) > 0 ? latest : null;
}

/**
 * @param {{ root: string, fetchJson: (url: string) => Promise<any>, log: (line: string) => void }} opts
 * @returns {Promise<number>} çıkış kodu
 */
export async function run({ root, fetchJson, log }) {
  let fail = 0;
  const read = (/** @type {string} */ p) => readFileSync(path.join(root, p), "utf8");

  const node = parseNodeImage(read("Dockerfile"));
  if (!node) {
    log("FAIL node: Dockerfile NODE_IMAGE sürümü okunamadı");
    fail = 1;
  } else {
    const gap = nodeSecurityGap(await fetchJson(SOURCES.nodeIndex), node);
    if (gap.latestSecurity) {
      log(`FAIL node: ${node} kullanılıyor, güvenlik yayını ${gap.latestSecurity} çıktı (Dockerfile NODE_IMAGE güncellenmeli)`);
      fail = 1;
    } else {
      log(`OK   node: ${node}${gap.latest ? ` (daha yeni ${gap.latest} var, güvenlik yayını değil)` : " güncel"}`);
    }
  }

  const dbCompose = read("deploy/vps/database/compose.yml");
  const pg = parsePostgresImage(dbCompose);
  if (!pg) {
    log("FAIL postgres: deploy/vps/database/compose.yml imaj sürümü okunamadı");
    fail = 1;
  } else {
    const body = await fetchJson(SOURCES.postgresTags(parts(pg)[0] ?? 0));
    const newer = postgresGap(body.results ?? [], pg);
    if (newer) {
      log(`FAIL postgres: ${pg} kullanılıyor, ${newer} çıktı (ara sürümler güvenlik düzeltmesi taşır)`);
      fail = 1;
    } else {
      log(`OK   postgres: ${pg} güncel`);
    }
  }

  for (const ref of findUnpinnedImages(read("deploy/vps/automation/compose.yml"))) {
    log(`WARN imaj sürümü sabit değil: ${ref} (B-32)`);
  }
  return fail;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const fetchJson = async (/** @type {string} */ url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    return res.json();
  };
  run({ root, fetchJson, log: (line) => console.log(line) }).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`FAIL denetim çalışamadı: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    },
  );
}
