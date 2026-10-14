#!/usr/bin/env node
// Etkin WMS satış sitesi üreticisi (T-941).
// Kaynak: marketing/src/landing.dc.html (Claude Design .dc.html dışa aktarımı + üretim düzeltmeleri),
//         marketing/src/runtime.js, marketing/src/boot.js.
// Çıktı:  marketing/public/index.html (ön-çizilmiş), styles.css, site.js.
// Kullanım: node marketing/build.mjs   (Chromium gerekir: @playwright/test)
// Yazı tipleri ve görseller public/fonts ile public/img altında tutulur; bu betik onları üretmez.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { transformComponent } from "./src/transform.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const src = (p) => resolve(here, "src", p);
const pub = (p) => resolve(here, "public", p);

const SITE = "https://etkinyazilim.com";
const TITLE = "Etkin WMS — Girişten sevkiyata kesintisiz kontrolün en kolay hali";
const DESCRIPTION =
  "Etkin WMS: kabulde her koli, paket, varil ve palete anında tekil QR etiket; girişten üretime ve sevkiyata uçtan uca izlenebilirlik. Web tabanlı, kurulum gerektirmez, aylık kiralanır. Pilot demo isteyin.";

// T-944: arama motorları ve yapay zekâ aramaları için tek varlık tanımı (Schema.org JSON-LD).
// Çalıştırılmayan veri bloğudur; CSP script-src 'self' bunu engellemez. Fiyat/puan gibi doğrulanmamış iddia içermez.
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE}/#organization`,
      name: "Etkin Yazılım",
      alternateName: ["Etkin WMS", "etkinyazilim.com.tr"],
      url: `${SITE}/`,
      logo: { "@type": "ImageObject", url: `${SITE}/img/logo-512.png`, width: 512, height: 512 },
    },
    {
      "@type": "WebSite",
      "@id": `${SITE}/#website`,
      name: "Etkin WMS",
      url: `${SITE}/`,
      inLanguage: ["tr-TR", "en"],
      publisher: { "@id": `${SITE}/#organization` },
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE}/#software`,
      name: "Etkin WMS",
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Depo yönetim sistemi (WMS)",
      operatingSystem: "Web tarayıcısı (telefon, tablet, el terminali, bilgisayar)",
      description: DESCRIPTION,
      url: `${SITE}/`,
      image: `${SITE}/img/og-etkin-wms.jpg`,
      publisher: { "@id": `${SITE}/#organization` },
      featureList: [
        "Kabulde koli, paket, varil ve palete tekil QR etiket",
        "Girişten üretime ve sevkiyata uçtan uca izlenebilirlik",
        "Lot, üretim ve son kullanma tarihi takibi",
        "Rotalı toplama ve kör sayım",
        "İnternet kesintisinde çalışmaya devam",
      ],
    },
  ],
};

const FONT_FACES = [
  ["Bricolage Grotesque", "bricolage-grotesque.woff", "400 800"],
  ["Instrument Sans", "instrument-sans.woff", "400 600"],
  ["IBM Plex Mono", "ibm-plex-mono-400.woff", "400"],
  ["IBM Plex Mono", "ibm-plex-mono-500.woff", "500"],
  ["IBM Plex Mono", "ibm-plex-mono-600.woff", "600"],
]
  .map(([family, file, weight]) => `@font-face{font-family:'${family}';src:url(/fonts/${file}) format('woff');font-weight:${weight};font-style:normal;font-display:swap}`)
  .join("\n");

/** @param {string} html @param {RegExp} re @param {string} what */
function must(html, re, what) {
  const m = re.exec(html);
  if (!m) throw new Error(`landing.dc.html: ${what} bulunamadı`);
  return m;
}

function build() {
  const dc = readFileSync(src("landing.dc.html"), "utf8");
  const helmet = must(dc, /<helmet>([\s\S]*?)<\/helmet>/, "<helmet>")[1] ?? "";
  const css = [...helmet.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
  const body = must(dc, /<\/helmet>([\s\S]*?)<\/x-dc>/, "şablon gövdesi")[1]?.trim() ?? "";
  const scriptTag = must(dc, /<script type="text\/x-dc" data-dc-script data-props='([^']*)'>([\s\S]*?)<\/script>/, "bileşen betiği");
  /** @type {Record<string, { default?: unknown }>} */
  const propSpec = JSON.parse(scriptTag[1] ?? "{}");
  /** @type {Record<string, unknown>} */
  const props = {};
  for (const [k, v] of Object.entries(propSpec)) if (!k.startsWith("$")) props[k] = v.default;
  const component = transformComponent(scriptTag[2] ?? "");

  writeFileSync(pub("styles.css"), `/* Etkin WMS — üretilmiş dosya (marketing/build.mjs). Elle düzenlemeyin. */\n${FONT_FACES}\n${css.trim()}\n`);
  const site = [
    "/* Etkin WMS — üretilmiş dosya (marketing/build.mjs). Elle düzenlemeyin. */",
    `(function () {\n"use strict";\n${readFileSync(src("runtime.js"), "utf8")}\n})();`,
    `window.EtkinDCProps = ${JSON.stringify(props)};`,
    `(function () {\n"use strict";\nconst DCLogic = window.EtkinDC.DCLogic;\n${component.trim()}\nwindow.EtkinDCComponent = Component;\n})();`,
    readFileSync(src("boot.js"), "utf8"),
  ].join("\n");
  writeFileSync(pub("site.js"), site);
  return { body };
}

/** @param {string} prerendered @param {string} template */
function page(prerendered, template) {
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${TITLE}</title>
<meta name="description" content="${DESCRIPTION}">
<link rel="canonical" href="${SITE}/">
<meta name="theme-color" content="#172e42">
<meta property="og:type" content="website">
<meta property="og:locale" content="tr_TR">
<meta property="og:site_name" content="Etkin WMS">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${DESCRIPTION}">
<meta property="og:url" content="${SITE}/">
<meta property="og:image" content="${SITE}/img/og-etkin-wms.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Etkin WMS — saha filminden bir kare">
<meta name="twitter:card" content="summary_large_image">
<link rel="alternate" hreflang="tr" href="${SITE}/">
<link rel="alternate" hreflang="x-default" href="${SITE}/">
<script type="application/ld+json">${JSON.stringify(STRUCTURED_DATA)}</script>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preload" href="/fonts/bricolage-grotesque.woff" as="font" type="font/woff" crossorigin>
<link rel="preload" href="/fonts/instrument-sans.woff" as="font" type="font/woff" crossorigin>
<link rel="stylesheet" href="/styles.css">
<script src="/site.js" defer></script>
</head>
<body>
<div id="dc-root">${prerendered}</div>
<template id="dc-tpl">${template}</template>
</body>
</html>
`;
}

const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".webp": "image/webp", ".woff": "font/woff", ".svg": "image/svg+xml" };

async function prerender(template) {
  writeFileSync(pub("index.html"), page("", template));
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await p.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== "http://prerender.local") return route.abort();
      const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      try {
        return route.fulfill({ body: readFileSync(pub(file)), contentType: TYPES[extname(file)] || "application/octet-stream" });
      } catch {
        return route.fulfill({ status: 404, body: "" });
      }
    });
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto("http://prerender.local/");
    await p.waitForFunction(() => document.getElementById("dc-root")?.childElementCount);
    const html = await p.evaluate(() => document.getElementById("dc-root")?.innerHTML ?? "");
    if (errors.length) throw new Error("ön-çizim hatası: " + errors.join("; "));
    if (!html.includes("ETKİN WMS")) throw new Error("ön-çizim boş görünüyor");
    return html;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { body } = build();
  const html = await prerender(body);
  writeFileSync(pub("index.html"), page(html, body));
  console.log(`marketing: index.html ${Math.round(readFileSync(pub("index.html")).length / 1024)} KB, site.js ${Math.round(readFileSync(pub("site.js")).length / 1024)} KB`);
}
