// T-445 `scripts/prepush.mjs` karar işlevleri: yalnız açıklanmış yerel ortam istisnaları UYARI olur, başka her kırmızı KIRMIZI kalır.
import { describe, expect, it } from "vitest";
import { changedE2eSpecs, guardsOnlyUnverifiableApproval, verifyOnlyKnownEnv } from "./prepush.mjs";

const IO = "[unit] scripts/initial-owner.test.mjs:13 initial owner …: Error: PRIVATE_DIRECTORY_REQUIRED";

describe("verifyOnlyKnownEnv", () => {
  it("yalnız initial-owner PRIVATE_DIRECTORY_REQUIRED → istisna", () => {
    expect(verifyOnlyKnownEnv(`${IO}\nverify: lint OK · typecheck OK · unit FAIL (10 test)`)).toBe(true);
  });
  it("başka bir unit hatası, typecheck/lint hatası ya da özet yoksa istisna değil", () => {
    expect(verifyOnlyKnownEnv(`${IO}\n[unit] a.test.ts:1 x: Error\nverify: lint OK · typecheck OK · unit FAIL (10 test)`)).toBe(false);
    expect(verifyOnlyKnownEnv(`${IO}\n[typecheck] a.mjs:1 TS7005\nverify: lint OK · typecheck FAIL · unit FAIL (10 test)`)).toBe(false);
    expect(verifyOnlyKnownEnv("[unit] scripts/initial-owner.test.mjs:13 x: Error: başka\nverify: lint OK · typecheck OK · unit FAIL (1 test)")).toBe(false);
    expect(verifyOnlyKnownEnv(IO)).toBe(false);
    expect(verifyOnlyKnownEnv("verify: lint OK · typecheck OK · unit FAIL (0 test)")).toBe(false);
  });
});

describe("guardsOnlyUnverifiableApproval", () => {
  const sum = (p) => `check:all → scope OK | tests OK | ac-ratchet OK | protected ${p} | assertions OK | docs OK`;
  it("yalnız APPROVAL_UNVERIFIABLE → istisna", () => {
    expect(guardsOnlyUnverifiableApproval(`[check:protected] FAIL APPROVAL_UNVERIFIABLE .github/x.yml — PR bağlamı yok\n${sum("FAIL")}`)).toBe(true);
  });
  it("başka bekçi ya da başka protected nedeni kırmızı kalır", () => {
    expect(guardsOnlyUnverifiableApproval(`[check:protected] FAIL PROTECTED_NO_APPROVAL x\n${sum("FAIL")}`)).toBe(false);
    expect(
      guardsOnlyUnverifiableApproval(
        "[check:protected] FAIL APPROVAL_UNVERIFIABLE x\n[check:scope] FAIL OUT_OF_SCOPE y\ncheck:all → scope FAIL | protected FAIL",
      ),
    ).toBe(false);
    expect(guardsOnlyUnverifiableApproval(sum("FAIL"))).toBe(false);
  });
});

describe("changedE2eSpecs", () => {
  it("yalnız tests/e2e altındaki .spec.ts", () => {
    expect(changedE2eSpecs("tests/e2e/a.spec.ts\ntests/e2e/global-setup.ts\napps/web/x.tsx\ntests/e2e/support/b.spec.ts\n")).toEqual([
      "tests/e2e/a.spec.ts",
      "tests/e2e/support/b.spec.ts",
    ]);
  });
});
