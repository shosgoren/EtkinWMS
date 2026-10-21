// T-445 `scripts/changes/fold.mjs` testleri: ayrıştırma, STATE/BACKLOG işleme, idempotentlik, hepsi-ya-da-hiçbiri.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyBacklog, applyState, FoldError, fold, parseFragment } from "./fold.mjs";

const STATE = ["# Durum", "", "Son doğrulama: x", "", "- **T-431 (21 Ekim):** eski", "- **T-979b (21 Ekim):** eski 2", ""].join("\n");
const BACKLOG = [
  "# Liste",
  "",
  "## P2 — ürün akışları",
  "| ID | İş | Bağlı |",
  "|---|---|---|",
  "| B-50 | QR akışı | T-900 |",
  "",
  "## Eklemeler (kullanıcı onayı 20 Ekim)",
  "| ID | İş |",
  "|---|---|",
  "| B-102 | WhatsApp yok |",
  "| B-103 | Kart numarası taşması |",
  "",
].join("\n");

/** @type {string[]} */
const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** @param {Record<string, string>} fragments */
function repo(fragments) {
  const root = mkdtempSync(path.join(tmpdir(), "fold-"));
  dirs.push(root);
  mkdirSync(path.join(root, "docs/changes"), { recursive: true });
  writeFileSync(path.join(root, "docs/STATE.md"), STATE);
  writeFileSync(path.join(root, "docs/BACKLOG.md"), BACKLOG);
  writeFileSync(path.join(root, "docs/changes/README.md"), "# biçim\n");
  for (const [name, text] of Object.entries(fragments)) writeFileSync(path.join(root, "docs/changes", name), text);
  return root;
}
const read = (/** @type {string} */ root, /** @type {string} */ rel) => readFileSync(path.join(root, rel), "utf8");
const quiet = () => {};
const resolver = () => ({ pr: "#150", sha: "abc1234" });

const FRAG = [
  "# T-445 — hat hızı",
  "<!-- açıklama",
  "- bu satır yorumdur -->",
  "## STATE",
  "- **T-445 (21 Ekim, PR {PR}):** hat hızlandı",
  "",
  "## BACKLOG",
  "- B-103: BİTTİ {PR} (T-445)",
  "- yeni: | Yeni bulgu |",
  "- yeni [P2 — ürün akışları]: | Yeni akış | B-50 |",
  "",
  "## Not",
  "- serbest metin, işlenmez",
].join("\n");

describe("parseFragment", () => {
  it("STATE, durum ve yeni satırları ayırır; yorum ve diğer bölümleri yok sayar", () => {
    const f = parseFragment(FRAG, "docs/changes/T-445.md");
    expect(f.task).toBe("T-445");
    expect(f.state).toEqual(["- **T-445 (21 Ekim, PR {PR}):** hat hızlandı"]);
    expect(f.status).toEqual([{ id: "B-103", text: "BİTTİ {PR} (T-445)" }]);
    expect(f.rows).toEqual([
      { section: "Eklemeler", cells: ["Yeni bulgu"] },
      { section: "P2 — ürün akışları", cells: ["Yeni akış", "B-50"] },
    ]);
  });

  it("4 haneli ve harfli kart adlarını kabul eder", () => {
    expect(parseFragment("## STATE\n- x\n", "docs/changes/T-1001.md").task).toBe("T-1001");
    expect(parseFragment("## STATE\n- x\n", "docs/changes/T-979b.md").task).toBe("T-979b");
  });

  it.each([
    ["docs/changes/not.md", "## STATE\n- x\n", /dosya adı/],
    ["docs/changes/T-1.md", "## STATE\n- x\n", /dosya adı/],
    ["docs/changes/T-445.md", "# boş\n", /parça boş/],
    ["docs/changes/T-445.md", "## STATE\ndüz metin\n", /tek satırlık/],
    ["docs/changes/T-445.md", "## BACKLOG\n- B-103 bitti\n", /tanınmadı/],
    ["docs/changes/T-445.md", "## BACKLOG\n- yeni: | B-200 | x |\n", /B numarası yazılmaz/],
    ["docs/changes/T-445.md", "## BACKLOG\n- yeni: | x |  |\n", /boş hücre/],
  ])("hatalı parça reddedilir: %s", (file, text, re) => {
    expect(() => parseFragment(text, file)).toThrow(re);
  });
});

describe("applyState / applyBacklog", () => {
  it("STATE maddesi ilk `- **T-` maddesinin önüne, işaret varsa onun altına eklenir; aynısı tekrar eklenmez", () => {
    const once = applyState(STATE, ["- **T-445:** yeni"]);
    expect(once.added).toBe(1);
    expect(once.text.split("\n")[4]).toBe("- **T-445:** yeni");
    expect(applyState(once.text, ["- **T-445:** yeni"]).added).toBe(0);
    const marked = applyState("# D\n<!-- changes:state -->\nx\n", ["- a"]);
    expect(marked.text).toBe("# D\n<!-- changes:state -->\n- a\nx\n");
    expect(() => applyState("# D\n", ["- a"])).toThrow(FoldError);
  });

  it("durum öneki ve yeni B numarası; ikinci koşuda değişiklik yok", () => {
    const r = applyBacklog(BACKLOG, [{ id: "B-103", text: "BİTTİ #150" }], [{ section: "Eklemeler", cells: ["Yeni"] }], "f");
    expect(r.updated).toBe(1);
    expect(r.added).toEqual(["B-104"]);
    expect(r.text).toContain("| B-103 | **BİTTİ #150** — Kart numarası taşması |");
    expect(r.text).toContain("| B-103 | **BİTTİ #150** — Kart numarası taşması |\n| B-104 | Yeni |\n");
    const again = applyBacklog(r.text, [{ id: "B-103", text: "BİTTİ #150" }], [{ section: "Eklemeler", cells: ["Yeni"] }], "f");
    expect(again.updated).toBe(0);
    expect(again.added).toEqual([]);
    expect(again.text).toBe(r.text);
  });

  it("olmayan B satırı, olmayan bölüm ve yanlış sütun sayısı hatadır", () => {
    expect(() => applyBacklog(BACKLOG, [{ id: "B-999", text: "x" }], [], "f")).toThrow(/B-999 BACKLOG'da yok/);
    expect(() => applyBacklog(BACKLOG, [], [{ section: "Yok", cells: ["x"] }], "f")).toThrow(/bölümü yok/);
    expect(() => applyBacklog(BACKLOG, [], [{ section: "P2", cells: ["x"] }], "f")).toThrow(/3 sütun/);
  });
});

describe("fold", () => {
  it("parçaları işler, yer tutucuları çözer, parçaları siler; ikinci koşu hiçbir şey değiştirmez", () => {
    const root = repo({ "T-445.md": FRAG, "T-1001.md": "## STATE\n- **T-1001:** dört hane\n" });
    const r = fold({ root, mode: "fold", resolve: resolver, log: quiet });
    expect(r).toEqual({ fragments: 2, stateAdded: 2, backlogUpdated: 1, backlogAdded: ["B-104", "B-105"] });
    const state = read(root, "docs/STATE.md");
    expect(state).toContain("- **T-445 (21 Ekim, PR #150):** hat hızlandı");
    expect(state).toContain("- **T-1001:** dört hane");
    const backlog = read(root, "docs/BACKLOG.md");
    expect(backlog).toContain("| B-103 | **BİTTİ #150 (T-445)** — Kart numarası taşması |");
    expect(backlog).toContain("| B-50 | QR akışı | T-900 |\n| B-105 | Yeni akış | B-50 |");
    expect(existsSync(path.join(root, "docs/changes/T-445.md"))).toBe(false);
    expect(existsSync(path.join(root, "docs/changes/README.md"))).toBe(true);
    const again = fold({ root, mode: "fold", resolve: resolver, log: quiet });
    expect(again.fragments).toBe(0);
    expect(read(root, "docs/STATE.md")).toBe(state);
    expect(read(root, "docs/BACKLOG.md")).toBe(backlog);
  });

  it("aynı parça yeniden gelirse (silinmemiş/yeniden eklenmiş) çift kayıt olmaz", () => {
    const root = repo({ "T-445.md": FRAG });
    fold({ root, mode: "fold", resolve: resolver, log: quiet });
    const state = read(root, "docs/STATE.md");
    const backlog = read(root, "docs/BACKLOG.md");
    writeFileSync(path.join(root, "docs/changes/T-445.md"), FRAG);
    fold({ root, mode: "fold", resolve: resolver, log: quiet });
    expect(read(root, "docs/STATE.md")).toBe(state);
    expect(read(root, "docs/BACKLOG.md")).toBe(backlog);
  });

  it("bir parça hatalıysa hiçbir dosya yazılmaz ve parça silinmez", () => {
    const root = repo({ "T-445.md": FRAG, "T-446.md": "## BACKLOG\n- B-999: BİTTİ\n" });
    expect(() => fold({ root, mode: "fold", resolve: resolver, log: quiet })).toThrow(/B-999/);
    expect(read(root, "docs/STATE.md")).toBe(STATE);
    expect(read(root, "docs/BACKLOG.md")).toBe(BACKLOG);
    expect(existsSync(path.join(root, "docs/changes/T-445.md"))).toBe(true);
  });

  it("birleşmemiş parçada {PR} çözülemezse durur; --check çözmeden doğrular ve yazmaz", () => {
    const root = repo({ "T-445.md": FRAG });
    expect(() => fold({ root, mode: "fold", resolve: () => null, log: quiet })).toThrow(/çözülemedi/);
    const r = fold({ root, mode: "check", resolve: () => null, log: quiet });
    expect(r.fragments).toBe(1);
    expect(read(root, "docs/STATE.md")).toBe(STATE);
    expect(existsSync(path.join(root, "docs/changes/T-445.md"))).toBe(true);
    fold({ root, mode: "dry-run", resolve: resolver, log: quiet });
    expect(read(root, "docs/BACKLOG.md")).toBe(BACKLOG);
  });

  it("dizinde parça adına uymayan dosya hatadır", () => {
    const root = repo({ "notlar.md": "x" });
    expect(() => fold({ root, mode: "check", log: quiet })).toThrow(/dosya adı/);
  });
});
