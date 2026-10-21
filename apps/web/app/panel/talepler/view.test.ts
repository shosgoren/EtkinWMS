import { describe, expect, it } from "vitest";
import { rowState, whenLabel, type DemoRequestRow } from "./view.tsx";

const now = new Date("2026-10-16T10:00:00+03:00");
const base: DemoRequestRow = {
  id: "00000000-0000-0000-0000-000000000001",
  receivedAt: now,
  name: "A",
  company: "B",
  email: "a@b.invalid",
  sector: "",
  message: "",
  status: "APPROVED",
  decidedAt: now,
  activation: { delivery: "EMAIL", expiresAt: new Date(now.getTime() + 3_600_000) },
  activatedAt: null,
};

describe("T-995 talep durumu (Yonet.dc.html RST)", () => {
  it("bekleyen, reddedilen, açılan, süresi dolan ve teslim yoluna göre onaylanan", () => {
    expect(rowState({ ...base, status: "PENDING", decidedAt: null, activation: null }, now)).toBe("open");
    expect(rowState({ ...base, status: "REJECTED", activation: null }, now)).toBe("rejected");
    expect(rowState({ ...base, activatedAt: now }, now)).toBe("activated");
    expect(rowState(base, now)).toBe("email");
    expect(rowState({ ...base, activation: { delivery: "SCREEN", expiresAt: new Date(now.getTime() + 1) } }, now)).toBe("screen");
    expect(rowState({ ...base, activation: { delivery: "EMAIL", expiresAt: now } }, now)).toBe("expired");
    expect(rowState({ ...base, activation: null }, now)).toBe("expired");
  });
  it("zaman etiketi İstanbul saatiyle", () => {
    expect(whenLabel(new Date("2026-10-16T08:05:00+03:00"), now, "BUGÜN", "DÜN", "tr")).toBe("BUGÜN 08:05");
    expect(whenLabel(new Date("2026-10-15T23:59:00+03:00"), now, "BUGÜN", "DÜN", "tr")).toBe("DÜN 23:59");
    expect(whenLabel(new Date("2026-10-12T16:45:00+03:00"), now, "BUGÜN", "DÜN", "tr")).toBe("12.10 16:45");
  });
});
