#!/usr/bin/env node
// `pnpm prepush` (T-445, kullanıcı kararı 21 Ekim: GitHub'dan sürekli "failed" bildirimi): push'tan önce tek komutla yerel ön kontrol.
// CI hata bulma aracı değil, son doğrulamadır. Sırayla (ilk kırmızıda durmaz; hepsini koşar, sonunda özet):
//   1. verify            `node scripts/verify.mjs` (lint + typecheck + unit)
//   2. check:all         `node scripts/guards/cli.mjs all`
//   3. test:ac -- AC-04  (test:ac'nin "hızlı kipi" yok; AC-04 duman)
//   4. e2e               dalın origin/main'e göre değiştirdiği `tests/e2e/*.spec.ts` dosyaları (`git diff origin/main...HEAD`; yoksa atlanır)
//
// Yerelde açıklanmış iki ortam istisnası (CI'da ikisi de yoktur; bekçi/test gevşetilmez, yalnız bu yerel özetin kararı):
//   - `scripts/initial-owner.test.mjs` PRIVATE_DIRECTORY_REQUIRED: macOS `/var` → `/private/var` sembolik bağı. Önce TMPDIR gerçek yola
//     çevrilir; yine de yalnız bu test bu hatayla düşerse UYARI sayılır.
//   - `check:protected` APPROVAL_UNVERIFIABLE: PR gövdesi (onay satırları) yerelde yoktur; yalnız bu nedenle düşerse UYARI (CI guards doğrular).
// Bayraklar: --skip-e2e (Docker yoksa; özet bunu UYARI olarak yazar). Çıkış: herhangi bir adım kırmızıysa 1.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Yalnız bu (dosya, hata) çifti verify'da yerel ortam istisnasıdır. */
export const KNOWN_UNIT_ENV = [{ file: "scripts/initial-owner.test.mjs", error: "PRIVATE_DIRECTORY_REQUIRED" }];

/**
 * verify çıktısı: kırmızı yalnız bilinen ortam istisnasından mı?
 * @param {string} out
 * @returns {boolean}
 */
export function verifyOnlyKnownEnv(out) {
  const lines = out.split(/\r?\n/);
  const summary = lines.find((l) => /^verify: /.test(l)) ?? "";
  // lint ve typecheck OK olmalı; yalnız unit FAIL kabul edilebilir.
  if (!/lint OK/.test(summary) || !/typecheck OK/.test(summary) || !/unit FAIL/.test(summary)) return false;
  const errors = lines.filter((l) => /^\[(unit|lint|typecheck|[a-z-]+)\] /.test(l));
  if (errors.length === 0) return false;
  return errors.every((l) => KNOWN_UNIT_ENV.some((k) => l.startsWith(`[unit] ${k.file}:`) && l.includes(k.error)));
}

/**
 * check:all çıktısı: kırmızı yalnız yerelde doğrulanamayan onaydan mı?
 * @param {string} out
 * @returns {boolean}
 */
export function guardsOnlyUnverifiableApproval(out) {
  const lines = out.split(/\r?\n/);
  const summary = lines.find((l) => l.startsWith("check:all →")) ?? "";
  const parts = summary.replace("check:all →", "").split("|").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return false;
  if (!parts.every((p) => p.endsWith(" OK") || p === "protected FAIL")) return false;
  const fails = lines.filter((l) => /^\[check:[a-z-]+\] FAIL /.test(l));
  return fails.length > 0 && fails.every((l) => l.startsWith("[check:protected] FAIL APPROVAL_UNVERIFIABLE "));
}

/**
 * Dalın değiştirdiği (silinmemiş) e2e spec dosyaları.
 * @param {string} diffNames `git diff --name-only --diff-filter=d origin/main...HEAD`
 * @returns {string[]}
 */
export function changedE2eSpecs(diffNames) {
  return diffNames
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^tests\/e2e\/.+\.spec\.ts$/.test(l));
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const skipE2e = process.argv.includes("--skip-e2e");
  let realTmp = tmpdir();
  try {
    realTmp = realpathSync(realTmp);
  } catch {
    // TMPDIR çözülemezse olduğu gibi kalır.
  }
  const env = { ...process.env, TMPDIR: realTmp };
  /** @type {{ name: string, status: "OK" | "FAIL" | "WARN" | "SKIP", note?: string }[]} */
  const results = [];
  /** @param {string} cmd @param {string[]} args */
  const run = (cmd, args) => {
    console.log(`\n[prepush] → ${cmd} ${args.join(" ")}`);
    const r = spawnSync(cmd, args, { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    process.stdout.write(out.split("\n").slice(-40).join("\n"));
    return { ok: r.status === 0, out };
  };

  const v = run(process.execPath, ["scripts/verify.mjs"]);
  if (v.ok) results.push({ name: "verify", status: "OK" });
  else if (verifyOnlyKnownEnv(v.out)) results.push({ name: "verify", status: "WARN", note: "yalnız bilinen yerel ortam hatası (initial-owner, macOS /var); CI'da geçer" });
  else results.push({ name: "verify", status: "FAIL" });

  const g = run(process.execPath, ["scripts/guards/cli.mjs", "all"]);
  if (g.ok) results.push({ name: "check:all", status: "OK" });
  else if (guardsOnlyUnverifiableApproval(g.out)) results.push({ name: "check:all", status: "WARN", note: "korunan dosya onayı yerelde doğrulanamaz (PR gövdesi); CI guards doğrular" });
  else results.push({ name: "check:all", status: "FAIL" });

  const a = run(process.execPath, ["scripts/test-ac/cli.mjs", "--", "AC-04"]);
  results.push({ name: "test:ac AC-04", status: a.ok ? "OK" : "FAIL" });

  const diff = spawnSync("git", ["diff", "--name-only", "--diff-filter=d", "origin/main...HEAD"], { cwd: root, encoding: "utf8" });
  if (diff.status !== 0) {
    results.push({ name: "e2e (değişen spec)", status: "FAIL", note: "git diff origin/main...HEAD çalışmadı (origin/main çekildi mi?)" });
  } else {
    const specs = changedE2eSpecs(diff.stdout);
    if (specs.length === 0) results.push({ name: "e2e (değişen spec)", status: "SKIP", note: "dalda değişen e2e spec yok" });
    else if (skipE2e) results.push({ name: "e2e (değişen spec)", status: "WARN", note: `--skip-e2e: ${specs.length} spec koşulmadı (${specs.join(", ")})` });
    else {
      const e = run("pnpm", ["exec", "playwright", "test", ...specs]);
      results.push({ name: `e2e (${specs.length} spec)`, status: e.ok ? "OK" : "FAIL" });
    }
  }

  console.log("\n[prepush] özet");
  for (const r of results) console.log(`  ${r.status.padEnd(4)} ${r.name}${r.note ? ` — ${r.note}` : ""}`);
  const failed = results.some((r) => r.status === "FAIL");
  console.log(failed ? "[prepush] KIRMIZI — push etmeyin; CI son doğrulamadır, hata bulma aracı değil." : "[prepush] YEŞİL — push edilebilir.");
  process.exit(failed ? 1 : 0);
}
