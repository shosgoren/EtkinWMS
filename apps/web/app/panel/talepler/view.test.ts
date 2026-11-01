import { describe, expect, it } from "vitest";
import tr from "../../../messages/tr.json" with { type: "json" };
import { canReopen, doneText, fill, rowState, whenLabel, type DemoRequestRow, type TaleplerLabels } from "./view.tsx";

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

describe("T-1144 onay pencereleri ve geri açma", () => {
  const t = (tr as unknown as { panel: { talepler: TaleplerLabels } }).panel.talepler;
  it("yalnız reddedilmiş talep geri açılabilir", () => {
    expect(canReopen(rowState({ ...base, status: "REJECTED", activation: null }, now))).toBe(true);
    expect(canReopen(rowState({ ...base, status: "PENDING", decidedAt: null, activation: null }, now))).toBe(false);
    for (const r of [base, { ...base, activatedAt: now }, { ...base, activation: null }]) expect(canReopen(rowState(r, now))).toBe(false);
  });
  it("onay sorusu kişi ve e-postayla; reddet ve geri aç tek soru", () => {
    expect(fill(t.approveAsk, { name: "Ayşe Kaya", email: "ayse@ornek.invalid" })).toBe("Ayşe Kaya (ayse@ornek.invalid) adresine giriş bağlantısı gönderilsin mi?");
    expect(t.approveSend).toBe("Gönder");
    expect(t.cancel).toBe("Vazgeç");
    expect(t.rejectAsk).toBe("Talep reddedilsin mi?");
    expect(t.reject).toBe("Reddet");
    expect(t.reopen).toBe("Geri aç");
    expect(t.emailTaken).toBe("Bu e-posta için açık ya da onaylı bir talep zaten var");
    expect(fill(t.reopenAskBody, { name: "A", company: "B" })).not.toMatch(/\{/);
    expect(fill("{x} {y}", { x: "1" })).toBe("1 {y}");
  });
  it("sonuç balonu metni işleme ve teslim yoluna göre", () => {
    expect(doneText({ intent: "APPROVED", delivery: "EMAIL", seq: 1 }, t)).toBe(t.doneEmail);
    expect(doneText({ intent: "APPROVED", delivery: "SCREEN", seq: 1 }, t)).toBe(t.doneScreen);
    expect(doneText({ intent: "REJECTED", seq: 1 }, t)).toBe(t.doneRejected);
    expect(doneText({ intent: "REOPEN", seq: 1 }, t)).toBe(t.doneReopened);
    expect(doneText({ intent: "REISSUE", delivery: "SCREEN", seq: 1 }, t)).toBe(t.doneAgain);
  });
});
