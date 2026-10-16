import { describe, expect, it } from "vitest";
import { nearLimit } from "./ozet-rules.ts";

describe("nearLimit", () => {
  it("kullanılmayan küçük sınır uyarmaz; dolu/aşılmış sınır 0; %80 kullanımda kalan; sınırsız hiç uyarmaz", () => {
    expect(nearLimit(1, 0)).toBeNull();
    expect(nearLimit(1, 1)).toBe(0);
    expect(nearLimit(10, 8)).toBe(2);
    expect(nearLimit(10, 7)).toBeNull();
    expect(nearLimit(10, 12)).toBe(0);
    expect(nearLimit(2, 1)).toBe(1);
    expect(nearLimit(0, 50)).toBeNull();
    expect(nearLimit(100, 81)).toBe(19);
  });
});
