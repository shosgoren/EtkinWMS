// T-1112: Entegrasyonlar alt bölümü (adres sorgusu, varsayılan), sorun rozeti ve son eşitleme zamanı.
import { describe, expect, it } from "vitest";
import { ENTEGRASYON_BOLUMLERI, entegrasyonBolumu, entegrasyonSorunSayisi, sonEsitleme } from "./bolum.ts";

describe("entegrasyon alt bölümü", () => {
  it("tuvaldeki sıra: bağlantı · akış · alan sahipliği · pasif/arşiv · bekleyenler ve hatalar", () => {
    expect(ENTEGRASYON_BOLUMLERI).toEqual(["baglanti", "akis", "sahiplik", "arsiv", "hatalar"]);
  });
  it("adresteki geçerli bölüm seçilir (dizi gelirse ilki)", () => {
    for (const b of ENTEGRASYON_BOLUMLERI) {
      expect(entegrasyonBolumu(b, true)).toBe(b);
      expect(entegrasyonBolumu(b, false)).toBe(b);
    }
    expect(entegrasyonBolumu(["hatalar", "akis"], false)).toBe("hatalar");
  });
  it("yok / bilinmeyen: bağlıyken akış, bağlı değilken bağlantı", () => {
    for (const raw of [undefined, null, "", "x", "AKIS", []]) {
      expect(entegrasyonBolumu(raw, true)).toBe("akis");
      expect(entegrasyonBolumu(raw, false)).toBe("baglanti");
    }
  });
});

describe("sorun rozeti", () => {
  it("CHECK + FAILED + hatalı akış sayısı; bekleyen (PENDING) sayılmaz", () => {
    expect(entegrasyonSorunSayisi({ outbox: { check: 0, failed: 0 }, flows: [] })).toBe(0);
    expect(entegrasyonSorunSayisi({ outbox: { check: 2, failed: 1 }, flows: [{ errorCount: 0 }, { errorCount: 5 }, { errorCount: 1 }] })).toBe(5);
  });
});

describe("son eşitleme", () => {
  it("akış ve koşuların en yenisi; hiç yoksa null", () => {
    expect(sonEsitleme([], [])).toBeNull();
    expect(sonEsitleme([{ lastRunAt: null }], [])).toBeNull();
    expect(sonEsitleme([{ lastRunAt: "2026-10-28T08:00:00.000Z" }, { lastRunAt: null }], [{ startedAt: "2026-10-28T09:30:00.000Z" }])).toBe("2026-10-28T09:30:00.000Z");
    expect(sonEsitleme([{ lastRunAt: "2026-10-28T10:00:00.000Z" }], [{ startedAt: "2026-10-28T09:30:00.000Z" }])).toBe("2026-10-28T10:00:00.000Z");
  });
});
