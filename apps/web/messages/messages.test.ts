// T-999c bekçisi: tr.json ve en.json aynı anahtar kümesini taşır (eksik anahtar Türkçe'ye ya da anahtar adına düşmesin), bir dilde boş kalan metin yoktur ve
// her metin aynı `{yer tutucu}` adlarını kullanır (çeviride değişken kaybolmaz).
import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS } from "@wms/db";
import { KAYIT_TURLERI } from "../app/t/[slug]/audit/satirlar.ts";
import en from "./en.json";
import tr from "./tr.json";

type Tree = { readonly [k: string]: string | Tree };

function leaves(tree: Tree, prefix: readonly string[] = []): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(tree)) {
    const path = [...prefix, k];
    if (typeof v === "string") out.set(path.join(" > "), v);
    else for (const [pk, pv] of leaves(v, path)) out.set(pk, pv);
  }
  return out;
}

/** ICU üst düzey argüman adları (`{name}`, `{n, plural, ...}`); iç içe seçenek metinleri de taranır. */
function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\s*([A-Za-z_][\w]*)\s*(?:[,}])/g)].map((m) => m[1]!))].sort();
}

const trLeaves = leaves(tr as unknown as Tree);
const enLeaves = leaves(en as unknown as Tree);

describe("messages tr/en", () => {
  it("anahtar kümeleri aynı", () => {
    expect([...trLeaves.keys()].filter((k) => !enLeaves.has(k))).toEqual([]);
    expect([...enLeaves.keys()].filter((k) => !trLeaves.has(k))).toEqual([]);
  });
  it("bir dilde boş, diğerinde dolu metin yok (bilinçli boş alt başlık iki dilde de boştur)", () => {
    const empty = (v: string | undefined): boolean => (v ?? "").trim() === "";
    expect([...trLeaves].filter(([k, v]) => empty(v) !== empty(enLeaves.get(k))).map(([k]) => k)).toEqual([]);
  });
  it("yer tutucular aynı", () => {
    const diff = [...trLeaves].filter(([k, v]) => enLeaves.has(k) && placeholders(v).join(",") !== placeholders(enLeaves.get(k)!).join(",")).map(([k]) => k);
    expect(diff).toEqual([]);
  });
});

// T-1111: "Kim ne yaptı?" ekranında anahtar adı ("auditLog.actions.integration.synced") görünmesin — her audit eyleminin adı var.
describe("audit eylem adları", () => {
  it("her AUDIT_ACTIONS eyleminin tr/en adı var", () => {
    expect(AUDIT_ACTIONS.filter((a) => !trLeaves.has(["auditLog", "actions", ...a.split(".")].join(" > ")))).toEqual([]);
  });
  it("her kayıt türünün adı var", () => {
    expect([...KAYIT_TURLERI].filter((k) => !trLeaves.has(`auditLog > entities > ${k}`))).toEqual([]);
  });
});
