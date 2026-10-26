// T-1046: ayar sekmeleri — sıra, adresler ve renklerin kalıp paletinde olması (paletsiz renk ekranı düşürür).
import { describe, expect, it } from "vitest";
import { kdzOrtak } from "../kalip/tokens.ts";
import { ayarSekmeleri, ayarSekmesi, ayniTaslakSekmesi } from "./sekmeler.ts";

describe("ayar sekmeleri", () => {
  const items = ayarSekmeleri("/t/demo", (k) => k);
  it("Firma · Kullanıcılar ve yetki · Entegrasyonlar · Görünüm", () => {
    expect(items.map((x) => x.id)).toEqual(["firma", "kullanici", "entegrasyon", "gorunum"]);
    expect(items.map((x) => x.href)).toEqual(["/t/demo/settings", "/t/demo/settings?sekme=kullanici", "/t/demo/settings/baglantilar", "/t/demo/settings?sekme=gorunum"]);
  });
  it("her sekme rengi kalıp paletinde", () => {
    for (const x of items) expect(() => kdzOrtak(x.color ?? "")).not.toThrow();
  });
  it("bilinmeyen sekme Firma'ya düşer", () => {
    expect(ayarSekmesi(null)).toBe("firma");
    expect(ayarSekmesi("x")).toBe("firma");
    expect(ayarSekmesi("gorunum")).toBe("gorunum");
  });
  it("Firma / Kullanıcılar / Görünüm aynı taslak; Entegrasyonlar ayrı ekran (çıkış koruması sorar)", () => {
    const [firma, kullanici, entegrasyon, gorunum] = items;
    expect(ayniTaslakSekmesi(firma!.href, "/t/demo")).toBe(true);
    expect(ayniTaslakSekmesi(kullanici!.href, "/t/demo")).toBe(true);
    expect(ayniTaslakSekmesi(gorunum!.href, "/t/demo")).toBe(true);
    expect(ayniTaslakSekmesi(entegrasyon!.href, "/t/demo")).toBe(false);
  });
});
