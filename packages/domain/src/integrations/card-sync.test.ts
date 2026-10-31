// T-1140: iki yönlü kart eşitleme — kanonik özet ve karar kuralı (saf). Entegrasyon davranışı tests/integration/integrations/two-way-sync.int.test.ts.
import { describe, expect, it } from "vitest";
import { cardHash, decideCardSync, nameCanon, partyCanon, pullsRemote, pushesLocal, remoteCanon, remoteUpdatedAt, resolveConflict, type CardMarker } from "./card-sync.ts";
import type { JsonApiResource } from "./parasut.ts";

const res = (type: string, attributes: Record<string, unknown>): JsonApiResource => ({ id: "7", type, attributes, relationships: {} });
const party = { name: "Acme  Ltd", taxNumber: "123-456", taxOffice: null, email: "INFO@ACME.TEST", phone: "0532 111 22 33", city: "İzmir", district: null, address: null, shortName: null };

describe("kanonik özet", () => {
  it("iki tarafta aynı temizlik: boşluk, büyük/küçük e-posta, vergi no ayırıcıları özeti değiştirmez", () => {
    const local = cardHash("PARTY", partyCanon(party));
    const remote = cardHash("PARTY", remoteCanon("PARTY", res("contacts", { name: "Acme Ltd", tax_number: "123456", email: "info@acme.test", phone: "0532 111 22 33", city: "İzmir", account_type: "supplier" })));
    expect(remote).toBe(local);
  });
  it("kanonik alan değişince özet değişir; kanonik olmayan alan (cari türü, stok) değiştirmez", () => {
    const base = cardHash("PARTY", remoteCanon("PARTY", res("contacts", { name: "Acme" })));
    expect(cardHash("PARTY", remoteCanon("PARTY", res("contacts", { name: "Acme", account_type: "customer", balance: "9" })))).toBe(base);
    expect(cardHash("PARTY", remoteCanon("PARTY", res("contacts", { name: "Acme", district: "Bornova" })))).not.toBe(base);
    expect(cardHash("ITEM", nameCanon("Vida"))).not.toBe(cardHash("ITEM", nameCanon("Somun")));
    expect(cardHash("ITEM", remoteCanon("ITEM", res("products", { name: "Vida", stock_count: 5, unit: "adet" })))).toBe(cardHash("ITEM", nameCanon(" Vida ")));
  });
  it("varlık türü özete girer (aynı ad ürün ve depo için farklı özet); biçim 64 onaltılık", () => {
    expect(cardHash("ITEM", nameCanon("Ana"))).not.toBe(cardHash("WAREHOUSE", nameCanon("Ana")));
    expect(cardHash("WAREHOUSE", nameCanon("Ana"))).toMatch(/^[0-9a-f]{64}$/);
  });
  it("Paraşüt updated_at okunur; yoksa ya da bozuksa null (zaman bilinmiyor)", () => {
    expect(remoteUpdatedAt(res("products", { updated_at: "2026-10-31T10:00:00.000+03:00" }))).toBe(Date.parse("2026-10-31T07:00:00Z"));
    expect(remoteUpdatedAt(res("products", {}))).toBeNull();
    expect(remoteUpdatedAt(res("products", { updated_at: "dün" }))).toBeNull();
    expect(remoteUpdatedAt(res("products", { updated_at: 12 }))).toBeNull();
  });
});

describe("çakışma kuralı", () => {
  it("son değişen kazanır; eşitlik ve bilinmeyen zamanda Paraşüt", () => {
    expect(resolveConflict(2000, 1000)).toEqual({ winner: "ETKIN", basis: "NEWER_LOCAL" });
    expect(resolveConflict(1000, 2000)).toEqual({ winner: "PARASUT", basis: "NEWER_REMOTE" });
    expect(resolveConflict(1000, 1000)).toEqual({ winner: "PARASUT", basis: "TIE" });
    expect(resolveConflict(null, 1000)).toEqual({ winner: "PARASUT", basis: "UNKNOWN_TIME" });
    expect(resolveConflict(1000, null)).toEqual({ winner: "PARASUT", basis: "UNKNOWN_TIME" });
    expect(resolveConflict(Number.NaN, 1)).toEqual({ winner: "PARASUT", basis: "UNKNOWN_TIME" });
  });
});

describe("karar", () => {
  const L0 = "a".repeat(64), R0 = "b".repeat(64), L1 = "c".repeat(64), R1 = "d".repeat(64);
  const marker: CardMarker = { localHash: L0, remoteHash: R0, localSig: "e".repeat(32), syncedAt: "2026-10-31 10:00:00+00" };
  const times = (localAt: number | null, remoteAt: number | null) => () => ({ localAt, remoteAt });

  it("iki yönlü: yalnız yerel değişti → gönder; yalnız Paraşüt değişti → al; ikisi de değişmedi → hiçbir şey; eşit → eşit", () => {
    expect(decideCardSync({ direction: "BOTH", localHash: L1, remoteHash: R0, marker })).toEqual({ kind: "PUSH" });
    expect(decideCardSync({ direction: "BOTH", localHash: L0, remoteHash: R1, marker })).toEqual({ kind: "PULL" });
    expect(decideCardSync({ direction: "BOTH", localHash: L0, remoteHash: R0, marker })).toEqual({ kind: "NONE" });
    expect(decideCardSync({ direction: "BOTH", localHash: L1, remoteHash: L1, marker })).toEqual({ kind: "IN_SYNC" });
  });
  it("iki yönlü: ikisi de değişti → çakışma, yeni olan kazanır; zaman bilinmezse Paraşüt (taban var)", () => {
    expect(decideCardSync({ direction: "BOTH", localHash: L1, remoteHash: R1, marker, times: times(5, 3) })).toMatchObject({ kind: "CONFLICT", winner: "ETKIN", basis: "NEWER_LOCAL", baseline: true });
    expect(decideCardSync({ direction: "BOTH", localHash: L1, remoteHash: R1, marker, times: times(3, 5) })).toMatchObject({ kind: "CONFLICT", winner: "PARASUT", basis: "NEWER_REMOTE" });
    expect(decideCardSync({ direction: "BOTH", localHash: L1, remoteHash: R1, marker, times: times(null, 5) })).toMatchObject({ kind: "CONFLICT", winner: "PARASUT", basis: "UNKNOWN_TIME" });
    expect(decideCardSync({ direction: "BOTH", localHash: L1, remoteHash: R1, marker })).toMatchObject({ kind: "CONFLICT", winner: "PARASUT", basis: "UNKNOWN_TIME" });
  });
  it("iki yönlü: işaret yoksa (ya da yalnız imza varsa) ve farklıysa tabansız çakışma", () => {
    expect(decideCardSync({ direction: "BOTH", localHash: L1, remoteHash: R1, marker: null, times: times(9, 1) })).toMatchObject({ kind: "CONFLICT", winner: "ETKIN", baseline: false });
    expect(decideCardSync({ direction: "BOTH", localHash: L1, remoteHash: R1, marker: { localHash: null, remoteHash: null, localSig: "f".repeat(32), syncedAt: null } })).toMatchObject({ kind: "CONFLICT", winner: "PARASUT", baseline: false });
  });
  it("Paraşüt'ten al: her zaman alır, asla göndermez (yerel değişse de)", () => {
    for (const [l, r] of [[L1, R0], [L0, R1], [L1, R1]] as const) {
      const d = decideCardSync({ direction: "PULL", localHash: l, remoteHash: r, marker });
      expect(d).toEqual({ kind: "PULL" });
      expect(pushesLocal(d)).toBe(false);
    }
    expect(decideCardSync({ direction: "PULL", localHash: L1, remoteHash: L1, marker })).toEqual({ kind: "IN_SYNC" });
  });
  it("Etkin'den gönder: yerel değiştiyse gönderir, Paraşüt değişikliğini asla almaz", () => {
    expect(decideCardSync({ direction: "PUSH", localHash: L1, remoteHash: null, marker })).toEqual({ kind: "PUSH" });
    expect(decideCardSync({ direction: "PUSH", localHash: L0, remoteHash: null, marker })).toEqual({ kind: "NONE" });
    expect(decideCardSync({ direction: "PUSH", localHash: L0, remoteHash: R1, marker })).toEqual({ kind: "NONE" });
    expect(decideCardSync({ direction: "PUSH", localHash: L1, remoteHash: R1, marker: null })).toEqual({ kind: "PUSH" });
    expect(decideCardSync({ direction: "PUSH", localHash: L1, remoteHash: L1, marker: null })).toEqual({ kind: "IN_SYNC" });
    for (const r of [null, R0, R1]) expect(pullsRemote(decideCardSync({ direction: "PUSH", localHash: L1, remoteHash: r, marker }))).toBe(false);
  });
  it("çakışma zamanları yalnız gerekince okunur", () => {
    let calls = 0;
    const t = () => ((calls += 1), { localAt: 1, remoteAt: 2 });
    decideCardSync({ direction: "BOTH", localHash: L1, remoteHash: R0, marker, times: t });
    decideCardSync({ direction: "BOTH", localHash: L0, remoteHash: R1, marker, times: t });
    expect(calls).toBe(0);
    decideCardSync({ direction: "BOTH", localHash: L1, remoteHash: R1, marker, times: t });
    expect(calls).toBe(1);
  });
});
