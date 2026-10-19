#!/usr/bin/env node
// I-18 (docs/design/DESIGN-PARITY.md §3): Claude Design kaynağındaki <style> bloğunu ve tema paletini uygulamaya ÜRETEREK aktarır.
// Elle yeniden yazma yoktur: kurallar kaynak sırasıyla korunur, yalnızca şu mekanik dönüşümler yapılır:
//   1. Her seçici `.dz` kabına kapsanır (`.wrap` → `.dz .wrap`, `body` → `body:has(.dz)`).
//   2. `.m-mobile/.m-tablet/.m-desktop` önekli seçiciler kaynaktaki detect() eşiklerinin medya sorgusuna taşınır.
//   3. Renk sabitleri (#hex, rgba()) `var(--color-dz-…)` belirtecine çevrilir; belirteç tanımları globals.css işaretli bloğuna yazılır
//      (theme-contrast.test.ts: renk sabiti yalnız globals.css `--color-*` satırlarında).
//   4. Yazı tipi aileleri next/font değişkenlerine çevrilir (`'Bricolage Grotesque'` → `var(--font-bricolage)`).
//   5. Yalnız tasarım aracına ait önizleme kuralları (`.prev*`, `.fr-*`) atlanır (DESIGN-PARITY §5).
// Kullanım: node scripts/design/port.mjs [--check]   (--check: yazmaz, depodakiyle fark varsa çıkış 1)
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Kaynaklar. `scope`: CSS kabı sınıfı (her kaynağın kuralları ayrı kapta; aynı sayfada iki kaynak çakışmaz — `.big` gibi ortak adlar).
 * `palette`: "bakis" = Bakış'a özgü tema okuyucu (c, PAL, A, TXT, başparmak çubuğu); "c" = yalnız `var c = dk ? {…} : {…}` (+ betikteki
 * renk sabitleri `dz()` belirteci olur). Palet belirteçleri `--color-<scope>-<anahtar>` (kebab).
 * `device: "fr"` (19 Ekim kaynakları): cihaz öneki `.fr-mobile/.fr-tablet/.fr-desktop` (önizleme çerçevesi değil, ekran kırılımı) medya
 * sorgusuna taşınır; yalnız çerçeveyi çizen `.app` / `.appzone` kuralları ve `.auto` (Otomatik önizleme) atlanır; `.thd` karanlık tema
 * sınıfı `.<scope>.dz-dark` olur. `palette: "none"`: betikte tema paleti yok (karanlık tema CSS'tedir).
 * @type {ReadonlyArray<{ name: string, file: string, sha256: string, scope: string, palette: "bakis" | "c" | "none", device?: "fr" }>}
 */
export const SOURCES = [
  { name: "bakis", file: "docs/design/source/Bakis.dc.html", sha256: "f38a508b237a99683972698d34fdc639467864b4763f66d48e1c77d357bff457", scope: "dz", palette: "bakis" },
  { name: "giris", file: "docs/design/source/Giris.dc.html", sha256: "a0007e9453c60f8e11bd547101e38a8afe6888289f5490497510924a4296c1e5", scope: "dzg", palette: "c" },
  { name: "yonet", file: "docs/design/source/Yonet.dc.html", sha256: "5135ec250d1dd609b2415d5d834fc73d21b2a79df273d5cc44f21d4c4bfff425", scope: "dzy", palette: "c" },
  // T-423: Pano (19 Ekim kaynakları): cihaz kuralları `.fr-*` önekiyle, karanlık tema `.thd` sınıfıyla (palet betikte değil, CSS'te).
  // T-427: Excel'den aktar (aynı 19 Ekim kaynak biçimi).
  { name: "aktar", file: "docs/design/source/Aktar.dc.html", sha256: "68f488a1e4d81af8da378238f1bebdf10004d4400b7547857800d79f5f1c508b", scope: "dza", palette: "none", device: "fr" },
  // T-430: Ekip (kişiler, onay bekleyenler, davet, katılma QR'ı; aynı 19 Ekim kaynak biçimi).
  { name: "ekip", file: "docs/design/source/Ekip.dc.html", sha256: "3b7ef2e4567e6db32939c3023a3b8d509b0fadfd1182bd16ea0473c232fa56dd", scope: "dze", palette: "none", device: "fr" },
  // T-421: Yetki grupları (aynı 19 Ekim kaynak biçimi).
  { name: "gruplar", file: "docs/design/source/Gruplar.dc.html", sha256: "e7f4c23629c9f7058c47416f9ddced3ac0e5aee89da74b99903344362cef7baa", scope: "dzr", palette: "none", device: "fr" },
  { name: "pano", file: "docs/design/source/Pano.dc.html", sha256: "2305dacb6a48c57a454ec6e84a2940309a83fe55718ececebabe3af73d9d5ce4", scope: "dzp", palette: "none", device: "fr" },
];

// Kaynak detect(): w < 700 mobil; dokunmatik ya da w < 1100 tablet; aksi masaüstü.
export const MEDIA = {
  mobile: "(max-width: 699.98px)",
  tablet: "(min-width: 700px) and (max-width: 1099.98px), (min-width: 700px) and (pointer: coarse)",
  desktop: "(min-width: 1100px) and (pointer: fine), (min-width: 1100px) and (pointer: none)",
};
/** @type {Record<string, string>} */
const FONTS = { "'Bricolage Grotesque'": "var(--font-bricolage)", "'Instrument Sans'": "var(--font-instrument)", "'IBM Plex Mono'": "var(--font-plex-mono)" };
const SKIP = [/^\.prev/, /^\.fr-/];

/** Onaltılık/rgba değerini yalnız harfli belirteç adına çevirir (globals muafiyeti `--color-[a-z-]+`). */
const LETTERS = "abcdefghijklmnop";
/** @param {string} s */
const enc = (s) => s.toLowerCase().replace(/[0-9a-f]/g, (ch) => LETTERS[parseInt(ch, 16)] ?? ch);
/** @param {string | undefined} g @returns {string} */
const req = (g) => {
  if (g === undefined) throw new Error("port: eksik grup");
  return g;
};
/**
 * @param {string} raw
 * @returns {{ name: string, value: string }}
 */
export function colorToken(raw) {
  const v = raw.trim();
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(v);
  if (hex) {
    const g = req(/** @type {string} */ (hex[1]));
    const h = (g.length === 3 ? [...g].map((c) => c + c).join("") : g).toLowerCase();
    return { name: `dz-x-${enc(h)}`, value: `#${h}` };
  }
  const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(0?\.\d+|1|0)\s*\)$/.exec(v);
  if (rgba) {
    const [r, g, b, al] = [1, 2, 3, 4].map((i) => req(/** @type {string} */ (rgba[i])));
    const h = [r, g, b].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
    const a = String(al).replace(/^0?\./, "");
    return { name: `dz-a-${enc(h)}-${enc(a)}`, value: `rgba(${r}, ${g}, ${b}, ${al})` };
  }
  throw new Error(`port: tanınmayan renk ${raw}`);
}
const COLOR_RE = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])|rgba\([^)]*\)/g;

/**
 * @param {string} html @param {string} open @param {string} close @param {number} [from]
 * @returns {{ text: string, end: number }}
 */
function extract(html, open, close, from = 0) {
  const a = html.indexOf(open, from);
  const b = html.indexOf(close, a + open.length);
  if (a < 0 || b < 0) throw new Error(`port: ${open} bulunamadı`);
  return { text: html.slice(a + open.length, b), end: b };
}

/** @typedef {{ kind: "rule" | "at", head: string, body: string }} CssItem */
/**
 * Üst düzey CSS öğeleri. Yorumlar atılır.
 * @param {string} css
 * @returns {CssItem[]}
 */
export function parseCss(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  /** @type {CssItem[]} */
  const out = [];
  let i = 0;
  while (i < src.length) {
    while (i < src.length && /\s/.test(src.charAt(i))) i++;
    if (i >= src.length) break;
    const brace = src.indexOf("{", i);
    if (brace < 0) throw new Error("port: kapanmamış kural");
    const head = src.slice(i, brace).trim();
    let depth = 1;
    let j = brace + 1;
    while (depth > 0 && j < src.length) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") depth--;
      j++;
    }
    out.push({ kind: head.startsWith("@") ? "at" : "rule", head, body: src.slice(brace + 1, j - 1).trim() });
    i = j;
  }
  return out;
}

/** @param {string} head @returns {string[]} */
function splitSelectors(head) {
  /** @type {string[]} */
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of head) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** @typedef {{ mode: "mobile" | "tablet" | "desktop" | null, sel: string }} Scoped */
/**
 * Tek seçiciyi kapsar; mod öneki varsa { mode, sel } döner.
 * @param {string} sel @param {string} [scope] @param {"fr"} [device]
 * @returns {Scoped | null}
 */
export function scopeSelector(sel, scope = "dz", device = undefined) {
  /** @type {Scoped["mode"]} */
  let mode = null;
  let s = sel;
  if (device === "fr") {
    if (/^\.auto(?=[\s.:]|$)/.test(s)) return null;
    const f = /^\.fr-(mobile|tablet|desktop)(?=[\s.:]|$)\s*/.exec(s);
    if (f) {
      mode = /** @type {Scoped["mode"]} */ (f[1] ?? null);
      s = s.slice(f[0].length);
    }
    // Önizleme çerçevesi: `.app` / `.appzone` öğesinin kendisi (boyut, kenarlık, köşe); uygulamada tam ekran uyarlaması (pano-frame.css).
    if (/^\.app(zone)?$/.test(s)) return null;
    // Kaynakta cihaz öneki seçiciye bir sınıf ekler (özgüllük); medya sorgusuna taşınırken kap sınıfı iki kez yazılarak korunur
    // (aksi hâlde sonra gelen temel kural telefonda kazanır).
    const root = mode ? `.${scope}.${scope}` : `.${scope}`;
    // Satır içi renge göre seçici (`[style*="#172E42"]`): uygulamada satır içi renk belirteçtir (`dz("172E42")`), seçici de belirteci arar.
    s = s.replace(/\[style\*="(#[0-9a-fA-F]{6})"\]/g, (_, h) => `[style*="var(--color-${colorToken(h).name})"]`);
    if (s === ".wrap.thd") return { mode, sel: `${root}.dz-dark .wrap` };
    const d = /^\.thd\s+/.exec(s);
    if (d) {
      const rest = s.slice(d[0].length);
      if (SKIP.some((re) => re.test(rest))) return null;
      return { mode, sel: `${root}.dz-dark ${rest}` };
    }
    if (SKIP.some((re) => re.test(s))) return null;
    if (s === "body") return { mode, sel: `body:has(.${scope})` };
    return { mode, sel: `${root} ${s}` };
  }
  const m = /^\.m-(mobile|tablet|desktop)(?=[\s.:]|$)\s*/.exec(s);
  if (m) {
    mode = /** @type {Scoped["mode"]} */ (m[1] ?? null);
    s = s.slice(m[0].length);
    if (s === "") throw new Error(`port: yalnız mod seçicisi ${sel}`);
  }
  if (SKIP.some((re) => re.test(s))) return null;
  if (s === "body") return { mode, sel: `body:has(.${scope})` };
  return { mode, sel: `.${scope} ${s}` };
}

/** @param {string} body @param {Map<string, string>} tokens */
function convertValues(body, tokens) {
  let b = body;
  for (const [from, to] of Object.entries(FONTS)) b = b.split(from).join(to);
  return b.replace(COLOR_RE, (raw) => {
    const t = colorToken(raw);
    tokens.set(t.name, t.value);
    return `var(--color-${t.name})`;
  });
}

/** @param {string} body */
const fmtDecls = (body) =>
  body
    .split(/;(?![^(]*\))/)
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => `  ${d};`)
    .join("\n");

/**
 * Kaynak CSS → { css, tokens }.
 * @param {string} css @param {string} [scope] @param {"fr"} [device]
 * @returns {{ css: string, tokens: Map<string, string> }}
 */
export function portCss(css, scope = "dz", device = undefined) {
  /** @type {Map<string, string>} */
  const tokens = new Map();
  /** @type {string[]} */
  const blocks = [];
  const items = parseCss(css);
  // Kare adları genel ad alanındadır (Tailwind `pulse` vb.); çakışmasın diye `dz-` öneki alır, yalnız animation bildirimlerinde.
  const frames = items.filter((x) => x.head.startsWith("@keyframes")).map((x) => x.head.split(/\s+/)[1]);
  /** @param {string} body */
  const anim = (body) =>
    body.replace(/(animation(?:-name)?\s*:)([^;]*)/g, (/** @type {string} */ _m, /** @type {string} */ p, /** @type {string} */ v) => p + v.replace(new RegExp(`(?<![\\w-])(${frames.join("|")})(?![\\w-])`, "g"), `${scope}-$1`));
  /** @param {string} body */
  const conv = (body) => anim(convertValues(body, tokens));
  for (const item of items) {
    if (item.kind === "at") {
      if (item.head.startsWith("@keyframes")) {
        blocks.push(`@keyframes ${scope}-${item.head.split(/\s+/)[1]} {\n${conv(item.body).replace(/\s*\n\s*/g, " ")}\n}`);
      } else if (item.head.startsWith("@media")) {
        const inner = parseCss(item.body)
          .map((r) => {
            const sels = splitSelectors(r.head).map((x) => scopeSelector(x, scope, device)).filter(/** @returns {x is Scoped} */ (x) => x !== null);
            if (sels.some((x) => x.mode)) throw new Error("port: @media içinde mod seçicisi");
            return `  ${sels.map((x) => x.sel).join(", ")} { ${conv(r.body)} }`;
          })
          .join("\n");
        blocks.push(`${item.head} {\n${inner}\n}`);
      } else throw new Error(`port: desteklenmeyen ${item.head}`);
      continue;
    }
    const scoped = splitSelectors(item.head).map((x) => scopeSelector(x, scope, device)).filter(/** @returns {x is Scoped} */ (x) => x !== null);
    if (scoped.length === 0) continue;
    const decls = fmtDecls(conv(item.body));
    // Kaynak sırası korunur: aynı moddaki ardışık seçiciler tek bloğa, modsuzlar düz kurala.
    /** @type {string[]} */
    let group = [];
    /** @type {Scoped["mode"]} */
    let groupMode = null;
    const flush = () => {
      if (group.length === 0) return;
      const rule = `${group.join(",\n")} {\n${decls}\n}`;
      blocks.push(groupMode ? `@media ${MEDIA[groupMode]} {\n${rule.replace(/^/gm, "  ")}\n}` : rule);
      group = [];
    };
    for (const x of scoped) {
      if (group.length > 0 && x.mode !== groupMode) flush();
      groupMode = x.mode;
      group.push(x.sel);
    }
    flush();
  }
  return { css: blocks.join("\n"), tokens };
}

/**
 * Kaynak betiğindeki tema paletini okur (renderVals: `c`, `PAL`, `A`, `TXT`, başparmak çubuğu).
 * @param {string} html
 * @returns {{ light: Record<string, string>, dark: Record<string, string> }}
 */
export function readPalette(html) {
  const js = extract(html, "data-dc-script", "</script>").text;
  /** @param {string | undefined} src @returns {any} */
  const obj = (src) => JSON.parse(req(/** @type {string} */ (src)).replace(/'/g, '"').replace(/([{,]\s*)([A-Za-z_][\w]*)\s*:/g, '$1"$2":'));
  const cm = /var c = dk \? (\{[^}]*\})\s*:\s*(\{[^}]*\});/.exec(js);
  const pm = /var PAL = (\{.*?\});/.exec(js);
  const am = /var A = \{ kalan: dk \? '(#\w+)' : '(#\w+)', biten: GA, sorun: dk \? '(#\w+)' : '(#\w+)' \};/.exec(js);
  const gm = /var GS = dk \? '(#\w+)' : '(#\w+)', GA = dk \? '(#\w+)' : '(#\w+)', OUTS = dk \? '(#\w+)' : '(#\w+)', TXT = dk \? '(#\w+)' : '(#\w+)';/.exec(js);
  const tl = /tb\.left = \{[^}]*bg: dk \? '(#\w+)' : '(#\w+)'/.exec(js);
  const tr = /tb\.right = \{[^}]*bg: dk \? '(#\w+)' : '(#\w+)'/.exec(js);
  const pd = /if \(dk\) \{ tb\.prim\.bg = '(#\w+)'; tb\.prim\.fg = '(#\w+)'; \}/.exec(js);
  const pl = /prim: \{ l: '', d: D\.scan, bg: '(#\w+)', fg: '(#\w+)'/.exec(js);
  const st = /track: dk \? '(rgba\([^)]*\))' : '(rgba\([^)]*\))', d: se\.d/.exec(js);
  if (!cm || !pm || !am || !gm || !tl || !tr || !pd || !pl || !st) throw new Error("port: tema paleti kaynakta bulunamadı (kaynak değişti mi?)");
  /** @type {Record<string, string>} */
  const dark = obj(cm[1]);
  /** @type {Record<string, string>} */
  const light = obj(cm[2]);
  /** @type {Record<string, string[]>} */
  const PAL = obj(pm[1]);
  /** @param {RegExpExecArray} m @param {number} i */
  const g = (m, i) => req(/** @type {string} */ (m[i]));
  /** @param {boolean} dk @returns {Record<string, string>} */
  const theme = (dk) => {
    const c = dk ? dark : light;
    /** @type {Record<string, string>} */
    const t = { ...c, kalan: g(am, dk ? 1 : 2), biten: g(gm, dk ? 3 : 4), sorun: g(am, dk ? 3 : 4), gs: g(gm, dk ? 1 : 2), outs: g(gm, dk ? 5 : 6), txt: g(gm, dk ? 7 : 8) };
    t["tin-bg"] = g(tl, dk ? 1 : 2);
    t["tout-bg"] = g(tr, dk ? 1 : 2);
    t["prim-bg"] = dk ? g(pd, 1) : g(pl, 1);
    t["prim-fg"] = dk ? g(pd, 2) : g(pl, 2);
    t["sec-track"] = g(st, dk ? 1 : 2);
    for (const [k, q] of Object.entries(PAL)) {
      // Kaynak K(): açıkta { s: q0, t: q1, ink: q2, a: q0 }, koyuda { s: q3, t: q4, ink: q5, a: q5 }
      /** @param {number} i */
      const qi = (i) => req(/** @type {string} */ (q[i]));
      t[`${k}-s`] = qi(dk ? 3 : 0);
      t[`${k}-t`] = qi(dk ? 4 : 1);
      t[`${k}-ink`] = qi(dk ? 5 : 2);
      t[`${k}-a`] = qi(dk ? 5 : 0);
    }
    return t;
  };
  return { light: theme(false), dark: theme(true) };
}

/**
 * Yalın tema paleti: `var c = dk ? {koyu} : {açık};` (camelCase anahtar → kebab).
 * @param {string} html
 * @returns {{ light: Record<string, string>, dark: Record<string, string> }}
 */
export function readPaletteC(html) {
  const js = extract(html, "data-dc-script", "</script>").text;
  const cm = /var c = dk \? (\{[^}]*\})\s*:\s*(\{[^}]*\});/.exec(js);
  if (!cm) throw new Error("port: tema paleti (var c = dk ? …) kaynakta bulunamadı");
  /** @param {string | undefined} src @returns {Record<string, string>} */
  const obj = (src) => {
    /** @type {Record<string, string>} */
    const raw = JSON.parse(req(src).replace(/'/g, '"').replace(/([{,]\s*)([A-Za-z_][\w]*)\s*:/g, '$1"$2":'));
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`), v]));
  };
  return { dark: obj(cm[1]), light: obj(cm[2]) };
}

/** @param {string} n */
const BEGIN = (n) => `/* design:${n}:begin — scripts/design/port.mjs üretir; ELLE DÜZENLEMEYİN (I-18) */`;
/** @param {string} n */
const END = (n) => `/* design:${n}:end */`;

/**
 * @param {string} name @param {string} html @param {string} [scope] @param {"bakis" | "c" | "none"} [palette] @param {"fr"} [device]
 * @returns {{ css: string, tokenBlock: string, ts: string }}
 */
export function build(name, html, scope = "dz", palette = "bakis", device = undefined) {
  const style = extract(extract(html, "<helmet>", "</helmet>").text, "<style>", "</style>").text;
  const { css, tokens } = portCss(style, scope, device);
  // İşaretlemedeki satır içi renkler (fill, stroke, style) da belirteç olur; TSX bunlara `dz("17804F")` ile başvurur.
  const markup = extract(html, "</helmet>", "</x-dc>").text;
  for (const raw of markup.match(COLOR_RE) ?? []) {
    const t = colorToken(raw);
    tokens.set(t.name, t.value);
  }
  if (palette === "c" || palette === "none") {
    // Yalın kaynakta renkler betikte de geçer (renderVals); TSX bunlara da `dz("…")` ile başvurur.
    for (const raw of extract(html, "data-dc-script", "</script>").text.match(COLOR_RE) ?? []) {
      const t = colorToken(raw);
      tokens.set(t.name, t.value);
    }
  }
  /** @type {{ light: Record<string, string>, dark: Record<string, string> }} */
  const none = { light: {}, dark: {} };
  const pal = palette === "none" ? none : palette === "c" ? readPaletteC(html) : readPalette(html);
  const keys = Object.keys(pal.light);
  /** @param {string} k @param {string | undefined} v */
  const line = (k, v) => `  --color-dz-${k}: ${req(/** @type {string} */ (v)).toLowerCase()};`;
  /** @param {string} k @param {string | undefined} v */
  const pline = (k, v) => (scope === "dz" ? line(k, v) : `  --color-${scope}-${k}: ${req(/** @type {string} */ (v)).toLowerCase()};`);
  if (keys.some((k) => !/^[a-z-]+$/.test(k))) throw new Error("port: palet anahtarı harf dışı");
  const tokenBlock = [
    BEGIN(name),
    `.${scope} {`,
    ...[...tokens.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => line(k.replace(/^dz-/, ""), v)),
    ...keys.map((k) => pline(k, pal.light[k])),
    "}",
    `.${scope}.dz-dark {`,
    ...keys.map((k) => pline(k, pal.dark[k])),
    "}",
    END(name),
  ].join("\n");
  /** @type {Array<[string, string]>} */
  const hexKeys = [...tokens.entries()].map(([k, v]) => /** @type {[string, string]} */ ([k.startsWith("dz-x-") ? v.slice(1).toUpperCase() : v.replace(/^rgba\((.*)\)$/, "$1").replace(/\s+/g, ""), k]));
  const ts = [
    `// ${name}-tokens.ts — scripts/design/port.mjs ile ÜRETİLDİ; elle düzenlemeyin (I-18). Kaynaktaki onaltılık renk → belirteç.`,
    `const T: Readonly<Record<string, string>> = {`,
    ...hexKeys.sort(([a], [b]) => a.localeCompare(b)).map(([h, k]) => `  "${h}": "var(--color-${k})",`),
    `};`,
    `/** Kaynaktaki onaltılık rengin (\`#\` olmadan, büyük harf) belirteci; kaynakta olmayan renk hata verir. */`,
    `export function dz(hex: string): string {`,
    `  const v = T[hex];`,
    `  if (v === undefined) throw new Error(\`dz: kaynakta olmayan renk \${hex}\`);`,
    `  return v;`,
    `}`,
    `/** Tema paleti (açık/koyu \`.dz.dz-dark\` ile değişir): kaynaktaki c.*, bölüm K(), A, TXT, başparmak çubuğu. */`,
    `export const C = {`,
    ...keys.map((k) => `  ${/^[a-z]+$/.test(k) ? k : JSON.stringify(k)}: "var(--color-${scope === "dz" ? "dz" : scope}-${k})",`),
    `} as const;`,
    ``,
  ].join("\n");
  const header = `/* ${name}.css — docs/design/source dosyasından scripts/design/port.mjs ile ÜRETİLDİ. Elle düzenlemeyin (I-18, DESIGN-PARITY §3). */\n`;
  return { css: `${header}${css}\n`, tokenBlock, ts };
}

/** @param {string} globals @param {string} name @param {string} block */
export function spliceGlobals(globals, name, block) {
  const a = globals.indexOf(BEGIN(name));
  const b = globals.indexOf(END(name));
  if (a < 0 || b < 0) return `${globals.trimEnd()}\n\n${block}\n`;
  return `${globals.slice(0, a)}${block}${globals.slice(b + END(name).length)}`;
}

async function main() {
  const check = process.argv.includes("--check");
  const { createHash } = await import("node:crypto");
  const gPath = path.join(root, "apps/web/app/globals.css");
  let globals = readFileSync(gPath, "utf8");
  let bad = false;
  for (const s of SOURCES) {
    const html = readFileSync(path.join(root, s.file), "utf8");
    const sum = createHash("sha256").update(html).digest("hex");
    if (sum !== s.sha256) throw new Error(`port: ${s.file} sha256 ${sum} ≠ kayıtlı ${s.sha256} (SOURCE.md ve SOURCES birlikte güncellenir)`);
    const out = build(s.name, html, s.scope, s.palette, s.device);
    const cssPath = path.join(root, `apps/web/app/design/${s.name}.css`);
    const tsPath = path.join(root, `apps/web/app/design/${s.name}-tokens.ts`);
    const next = spliceGlobals(globals, s.name, out.tokenBlock);
    if (check) {
      /** @param {string} f */
      const readOr = (f) => {
        try {
          return readFileSync(f, "utf8");
        } catch {
          return "";
        }
      };
      const cur = readOr(cssPath);
      const curTs = readOr(tsPath);
      if (cur !== out.css || next !== globals || curTs !== out.ts) {
        console.error(`FAIL design:${s.name} üretilmiş dosya kaynakla aynı değil — node scripts/design/port.mjs`);
        bad = true;
      }
    } else {
      writeFileSync(cssPath, out.css);
      writeFileSync(tsPath, out.ts);
      globals = next;
    }
  }
  if (!check) writeFileSync(gPath, globals);
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
