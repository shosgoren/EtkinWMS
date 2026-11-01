// T-1144: reddedilen demo talebini geri açma — veritabanına gitmeden önceki kapılar ve hata eşlemesi (davranışın kendisi int testinde:
// tests/integration/platform/demo-requests.int.test.ts "geri açma").
import { describe, expect, it } from "vitest";
import type { AccessDbClient } from "../identity/access.ts";
import { mapPlatformError, reopenDemoRequest } from "./demo-requests.ts";

/** Kullanılırsa testi düşüren veritabanı: kapıdan geçemeyen çağrı veritabanına hiç gitmemeli. */
const untouchable = new Proxy({}, {
  get() {
    throw new Error("veritabanına gidilmemeli");
  },
}) as unknown as AccessDbClient;
const ok = async (): Promise<void> => undefined;
const ID = "00000000-0000-4000-8000-000000000001";

describe("T-1144 reopenDemoRequest kapıları", () => {
  it("oturum yoksa UNAUTHENTICATED; MFA'sız oturum FORBIDDEN/MFA_REQUIRED (veritabanına gitmeden)", async () => {
    await expect(reopenDemoRequest({ db: untouchable, principal: null, id: ID, recentAuth: ok })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(reopenDemoRequest({ db: untouchable, principal: { userId: ID, mfaVerified: false }, id: ID, recentAuth: ok })).rejects.toMatchObject({
      code: "FORBIDDEN",
      detail: "MFA_REQUIRED",
    });
  });

  it("geçersiz kimlik VALIDATION_FAILED (veritabanına gitmeden)", async () => {
    for (const id of ["", "x", 42, null, `${ID}0`]) {
      await expect(reopenDemoRequest({ db: untouchable, principal: { userId: ID, mfaVerified: true }, id, recentAuth: ok })).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
    }
  });
});

describe("T-1144 veritabanı reddi → sözleşme kodu", () => {
  it("operatör değil NOT_FOUND, talep yok NOT_FOUND, reddedilmemiş talep VERSION_CONFLICT; ham SQLSTATE yalnız cause'da", () => {
    const pg = (code: string) => Object.assign(new Error("db"), { code });
    expect(mapPlatformError(pg("42501"))).toMatchObject({ code: "NOT_FOUND" });
    expect(mapPlatformError(pg("P0002"))).toMatchObject({ code: "NOT_FOUND" });
    const conflict = mapPlatformError({ cause: pg("55000") }) as { code: string; message: string; cause: unknown };
    expect(conflict.code).toBe("VERSION_CONFLICT");
    expect(conflict.message).not.toContain("55000");
    expect(mapPlatformError(new Error("bilinmeyen"))).toMatchObject({ code: "INTERNAL" });
  });
});
