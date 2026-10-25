import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  compareVersions,
  findUnpinnedImages,
  nodeSecurityGap,
  parseNodeImage,
  parsePostgresImage,
  postgresGap,
  run,
} from "./security-scan.mjs";

const DOCKERFILE =
  "# yorum node:1.0.0-x\nARG NODE_IMAGE=mirror.gcr.io/library/node:24.21.0-trixie-slim@sha256:abc\nFROM ${NODE_IMAGE}\n";
const DB_COMPOSE = "services:\n  postgres:\n    image: postgres:18.6-trixie@sha256:def\n";
const APP_COMPOSE =
  "services:\n  web:\n    image: etkinwms:${WMS_RELEASE:?required}\n  proxy:\n    image: caddy:2\n  x:\n    image: redis:7.4.1\n";

describe("sürüm okuma", () => {
  it("Dockerfile NODE_IMAGE sürümünü okur, yorumu değil", () => {
    expect(parseNodeImage(DOCKERFILE)).toBe("24.21.0");
    expect(parseNodeImage("FROM node:24\n")).toBeNull();
  });
  it("PostgreSQL imaj sürümünü okur", () => {
    expect(parsePostgresImage(DB_COMPOSE)).toBe("18.6");
    expect(parsePostgresImage("    image: postgres:18.10\n")).toBe("18.10");
    expect(parsePostgresImage("image: mysql:8.0\n")).toBeNull();
  });
  it("yalnız sabitlenmemiş dış imajları bulur", () => {
    expect(findUnpinnedImages(APP_COMPOSE)).toEqual(["caddy:2"]);
    expect(findUnpinnedImages("  image: nginx\n  image: a:latest\n  image: b:2@sha256:x\n")).toEqual(["nginx", "a:latest"]);
  });
  it("sürümleri sayısal karşılaştırır", () => {
    expect(compareVersions("24.22.1", "24.9.0")).toBeGreaterThan(0);
    expect(compareVersions("v18.10", "18.6")).toBeGreaterThan(0);
    expect(compareVersions("24.21.0", "24.21.0")).toBe(0);
  });
});

describe("nodeSecurityGap", () => {
  const index = [
    { version: "v26.12.1", security: true },
    { version: "v24.22.1", security: true },
    { version: "v24.22.0", security: false },
    { version: "v24.21.0", security: false },
    { version: "v24.9.0", security: true },
  ];
  it("aynı ana sürümde yeni güvenlik yayınını bulur, başka ana sürümü saymaz", () => {
    expect(nodeSecurityGap(index, "24.21.0")).toEqual({ latestSecurity: "24.22.1", latest: "24.22.1" });
  });
  it("güncelse boş döner; eski güvenlik yayınını saymaz", () => {
    expect(nodeSecurityGap(index, "24.22.1")).toEqual({ latestSecurity: null, latest: null });
  });
  it("yalnız güvenlik dışı yeni yayın varsa FAIL üretmez", () => {
    expect(nodeSecurityGap(index.slice(2), "24.21.0")).toEqual({ latestSecurity: null, latest: "24.22.0" });
  });
});

describe("postgresGap", () => {
  const tags = [{ name: "18.6-trixie" }, { name: "18.6" }, { name: "18.10" }, { name: "18.2" }, { name: "19.0" }];
  it("aynı ana sürümün en yeni ara sürümünü (sayısal) bulur", () => {
    expect(postgresGap(tags, "18.6")).toBe("18.10");
  });
  it("güncelse null", () => {
    expect(postgresGap(tags, "18.10")).toBeNull();
    expect(postgresGap([], "18.6")).toBeNull();
  });
});

describe("run", () => {
  function fixture() {
    const root = mkdtempSync(path.join(tmpdir(), "secscan-"));
    mkdirSync(path.join(root, "deploy/vps/database"), { recursive: true });
    mkdirSync(path.join(root, "deploy/vps/automation"), { recursive: true });
    writeFileSync(path.join(root, "Dockerfile"), DOCKERFILE);
    writeFileSync(path.join(root, "deploy/vps/database/compose.yml"), DB_COMPOSE);
    writeFileSync(path.join(root, "deploy/vps/automation/compose.yml"), APP_COMPOSE);
    return root;
  }
  /** @param {any} nodeIndex @param {any} pgTags */
  const fetchFor = (nodeIndex, pgTags) => async (/** @type {string} */ url) =>
    url.includes("nodejs.org") ? nodeIndex : { results: pgTags };

  it("güvenlik açığı varsa 1 döner ve nedeni yazar", async () => {
    const lines = /** @type {string[]} */ ([]);
    const code = await run({
      root: fixture(),
      fetchJson: fetchFor([{ version: "v24.22.1", security: true }], [{ name: "18.6" }]),
      log: (l) => lines.push(l),
    });
    expect(code).toBe(1);
    expect(lines).toContain(
      "FAIL node: 24.21.0 kullanılıyor, güvenlik yayını 24.22.1 çıktı (Dockerfile NODE_IMAGE güncellenmeli)",
    );
    expect(lines).toContain("OK   postgres: 18.6 güncel");
    expect(lines).toContain("WARN imaj sürümü sabit değil: caddy:2 (B-32)");
  });
  it("her şey güncelse 0 döner; uyarı tek başına kırmızı yapmaz", async () => {
    const code = await run({
      root: fixture(),
      fetchJson: fetchFor([{ version: "v24.21.0", security: false }], [{ name: "18.6" }]),
      log: () => {},
    });
    expect(code).toBe(0);
  });
  it("yeni PostgreSQL ara sürümü 1 döner", async () => {
    const code = await run({
      root: fixture(),
      fetchJson: fetchFor([], [{ name: "18.7" }]),
      log: () => {},
    });
    expect(code).toBe(1);
  });
});
