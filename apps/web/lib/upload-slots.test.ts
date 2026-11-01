// T-1200 (güvenlik incelemesi MINOR-C): anahtarlı yuvalar — toplam, çalışma alanı ve kullanıcı payı; bırakma bir kez sayılır.
import { describe, expect, it } from "vitest";
import { createKeyedSlots } from "./upload-slots.ts";

describe("createKeyedSlots", () => {
  it("kullanıcı payı: aynı kullanıcı ikinci yuvayı alamaz, başka kullanıcı alır", () => {
    const s = createKeyedSlots({ total: 6, perTenant: 2, perUser: 1 });
    const a = s.acquire("t1", "u1");
    expect(a).not.toBeNull();
    expect(s.acquire("t1", "u1")).toBeNull();
    expect(s.acquire("t2", "u1")).toBeNull();
    expect(s.acquire("t1", "u2")).not.toBeNull();
  });

  it("çalışma alanı payı: bir alan 2'yi doldurunca üçüncü kullanıcısı alamaz, başka alan alır", () => {
    const s = createKeyedSlots({ total: 6, perTenant: 2, perUser: 1 });
    expect(s.acquire("t1", "u1")).not.toBeNull();
    expect(s.acquire("t1", "u2")).not.toBeNull();
    expect(s.acquire("t1", "u3")).toBeNull();
    expect(s.acquire("t2", "u3")).not.toBeNull();
  });

  it("toplam sınır ve bırakma: bırakma bir kez sayılır, paylar boşalınca anahtar silinir", () => {
    const s = createKeyedSlots({ total: 2, perTenant: 1, perUser: 1 });
    const a = s.acquire("t1", "u1")!;
    const b = s.acquire("t2", "u2")!;
    expect(s.acquire("t3", "u3")).toBeNull();
    a();
    a();
    expect(s.usage()).toEqual({ total: 1, tenants: 1, users: 1 });
    const c = s.acquire("t3", "u3");
    expect(c).not.toBeNull();
    expect(s.acquire("t4", "u4")).toBeNull();
    b();
    c!();
    expect(s.usage()).toEqual({ total: 0, tenants: 0, users: 0 });
  });
});
