// T-1124: rehberlerin ortak durumu — bölüm değişince kapanmaz, başka rehber öncekinin adımını silmez, kapat yalnız etkin rehberi kapatır.
import { describe, expect, it } from "vitest";
import { BOS_DURUM, adimKimlik, adimSayisi, adimaGit, baslat, bitir, durumCoz, eskiDurum, kapat, katla, kimlikCoz, opKimlik, yerKaydet } from "./rehber-durum.ts";

const T = opKimlik("transfer");
const I = opKimlik("issue");
const U = adimKimlik("urun", "EXCEL");

describe("rehber durumu (T-1124)", () => {
  it("başka rehber başlayınca öncekinin adımı kalır; geri dönünce kaldığı yerden sürer", () => {
    let d = baslat(BOS_DURUM, T);
    d = adimaGit(d, T, 1);
    d = katla(d, true);
    d = baslat(d, I);
    expect(d.aktif).toBe(I);
    expect(d.katli).toBe(false);
    expect(d.adimlar[T]).toBe(1);
    expect(d.adimlar[I]).toBe(0);
    d = baslat(d, T);
    expect(d.aktif).toBe(T);
    expect(d.adimlar[T]).toBe(1);
    expect(baslat(d, T, true).adimlar[T]).toBe(0);
  });

  it("kapat yalnız etkin rehberi kapatır (adımı hatırlanır); bitir kaydı siler; aktarma rehberi de aynı depoda", () => {
    let d = adimaGit(baslat(BOS_DURUM, U), U, 3);
    d = baslat(d, T);
    d = kapat(d);
    expect(d.aktif).toBeNull();
    expect(d.adimlar[U]).toBe(3);
    expect(d.adimlar[T]).toBe(0);
    d = bitir(baslat(d, U), U);
    expect(d.aktif).toBeNull();
    expect(d.adimlar[U]).toBeUndefined();
    expect(d.adimlar[T]).toBe(0);
  });

  it("adım sınırlanır; katla etkin rehber yokken değişmez", () => {
    expect(adimaGit(BOS_DURUM, T, 99).adimlar[T]).toBe(adimSayisi(T) - 1);
    expect(adimaGit(BOS_DURUM, T, -2).adimlar[T]).toBe(0);
    expect(katla(BOS_DURUM, true)).toBe(BOS_DURUM);
  });

  it("depodan okunan bozuk / yabancı değerler düşer; yer yalnız uygulama içi yol", () => {
    expect(durumCoz(null)).toEqual(BOS_DURUM);
    expect(durumCoz({ aktif: "op:hack", katli: true, adimlar: { "op:transfer": 2, "op:x": 1, "op:issue": 9, "adim:urun:EXCEL": 1.5 }, yerler: { "op:transfer": "https://evil.example/x", "op:issue": "/t/demo/stock/documents?new=STOCK_OUT" } })).toEqual({
      aktif: null,
      katli: false,
      adimlar: { "op:transfer": 2 },
      yerler: { "op:issue": "/t/demo/stock/documents?new=STOCK_OUT" },
    });
    expect(yerKaydet(BOS_DURUM, T, "//evil.example").yerler[T]).toBeUndefined();
    expect(yerKaydet(BOS_DURUM, T, "/t/demo/stock/documents?new=TRANSFER").yerler[T]).toBe("/t/demo/stock/documents?new=TRANSFER");
    expect(kimlikCoz("adim:depo:PARASUT")).toEqual({ tur: "adim", rehber: "depo", kaynak: "PARASUT" });
    expect(kimlikCoz("adim:depo")).toBeNull();
  });

  it("eski iki kayıttan geçiş: kaldığı adımlar korunur, kapatılmış işlem rehberi etkin olmaz", () => {
    const d = eskiDurum({ guide: "transfer", step: 1, closed: true, path: "/t/demo/stock/documents", query: "new=TRANSFER" }, { rehber: "urun", kaynak: "EXCEL", adim: 2, katli: true });
    expect(d.adimlar).toEqual({ [T]: 1, [U]: 2 });
    expect(d.yerler[T]).toBe("/t/demo/stock/documents?new=TRANSFER");
    expect(d.aktif).toBe(U);
    expect(d.katli).toBe(true);
    expect(eskiDurum({ guide: "count", step: 0 }, null).aktif).toBe(opKimlik("count"));
  });
});
