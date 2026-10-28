// T-1116: pivot gruplama yardımcısı — birleştirme, decimal toplam, gevşek çocuk, sayım, aç/kapat görünürlüğü.
import { describe, expect, it } from "vitest";
import { acilabilirler, altSayilari, gorunurSatirlar, pivotAgaci, pivotSayilari, type PivotAdim, type PivotGirdi } from "./pivot.ts";

const depo = (id: string): PivotAdim => ({ tur: "depo", id, etiket: id });
const raf = (id: string): PivotAdim => ({ tur: "raf", id, etiket: id });
const lot = (id: string, skt: string | null = null): PivotAdim => ({ tur: "lot", id, etiket: id, skt });
const palet = (id: string): PivotAdim => ({ tur: "palet", id, etiket: id });
const koli = (id: string): PivotAdim => ({ tur: "koli", id, etiket: id });
const gevsek = (ust: PivotAdim): PivotAdim => ({ tur: "gevsek", id: `${ust.tur}:${ust.id}`, etiket: "paketsiz" });

const girdiler: PivotGirdi[] = [
  { yol: [depo("ANA"), raf("A-1"), lot("L1", "2028-10-12"), palet("P1"), koli("K1")], miktar: "150.000000", durum: "AVAILABLE" },
  { yol: [depo("ANA"), raf("A-1"), lot("L1", "2028-10-12"), palet("P1"), koli("K2")], miktar: "0.100001", ayrilmis: "0.100000", durum: "AVAILABLE" },
  { yol: [depo("ANA"), raf("A-1"), lot("L1", "2028-10-12"), palet("P1")], miktar: "0.2", durum: "AVAILABLE" },
  { yol: [depo("ANA"), raf("A-2")], miktar: "300", durum: "QUARANTINE" },
  { yol: [depo("ANA"), raf("A-2")], miktar: "1", durum: "AVAILABLE" },
  { yol: [depo("SUBE"), raf("S-1"), lot("L1", "2028-10-12")], miktar: "160", durum: "AVAILABLE" },
  { yol: [], miktar: "999" },
];

describe("pivotAgaci", () => {
  const kokler = pivotAgaci(girdiler, gevsek);

  it("aynı adımları tek düğümde birleştirir; sıra girdinin sırasıdır", () => {
    expect(kokler.map((k) => k.etiket)).toEqual(["ANA", "SUBE"]);
    expect(kokler[0]?.cocuklar.map((c) => c.etiket)).toEqual(["A-1", "A-2"]);
  });

  it("her seviye kayan noktasız decimal toplam taşır", () => {
    expect(kokler[0]?.miktar).toBe("451.300001");
    expect(kokler[1]?.miktar).toBe("160.000000");
    const p1 = kokler[0]?.cocuklar[0]?.cocuklar[0]?.cocuklar[0];
    expect(p1?.etiket).toBe("P1");
    expect(p1?.miktar).toBe("150.300001");
    expect(p1?.ayrilmis).toBe("0.100000");
  });

  it("kendi miktarı da çocuğu da olan düğüme gevşek çocuk ekler; yaprak toplamı çocukların toplamıdır", () => {
    const p1 = kokler[0]?.cocuklar[0]?.cocuklar[0]?.cocuklar[0];
    expect(p1?.cocuklar.map((c) => c.etiket)).toEqual(["K1", "K2", "paketsiz"]);
    expect(p1?.cocuklar[2]).toMatchObject({ tur: "gevsek", miktar: "0.200000", derinlik: 4, durumlar: ["AVAILABLE"] });
    // Yalnız kendi miktarı olan düğüm yapraktır; durumları sıralı birleşir.
    const a2 = kokler[0]?.cocuklar[1];
    expect(a2).toMatchObject({ miktar: "301.000000", cocuklar: [], durumlar: ["AVAILABLE", "QUARANTINE"] });
  });

  it("SKT lot adımından gelir; derinlik kökten sayılır", () => {
    const l1 = kokler[1]?.cocuklar[0]?.cocuklar[0];
    expect(l1).toMatchObject({ tur: "lot", skt: "2028-10-12", derinlik: 2 });
  });

  it("tür başına farklı kayıt sayısı ve alt sayılar", () => {
    const s = pivotSayilari(kokler);
    expect(Object.fromEntries(s)).toEqual({ depo: 2, raf: 3, lot: 1, palet: 1, koli: 2, gevsek: 1 });
    expect(Object.fromEntries(altSayilari(kokler[0]!))).toMatchObject({ raf: 2, lot: 1 });
  });

  it("aç/kapat: kapalı düğümün altı görünmez", () => {
    const hepsi = new Set(acilabilirler(kokler));
    expect(gorunurSatirlar(kokler, hepsi)).toHaveLength(11);
    expect(gorunurSatirlar(kokler, new Set()).map((d) => d.etiket)).toEqual(["ANA", "SUBE"]);
    const yalnizAna = new Set([kokler[0]!.anahtar]);
    expect(gorunurSatirlar(kokler, yalnizAna).map((d) => d.etiket)).toEqual(["ANA", "A-1", "A-2", "SUBE"]);
  });

  it("boş girdi boş ağaç", () => {
    expect(pivotAgaci([], gevsek)).toEqual([]);
  });
});
