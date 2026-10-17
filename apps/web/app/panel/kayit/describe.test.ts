import { describe as group, expect, it } from "vitest";
import tr from "../../../messages/tr.json" with { type: "json" };
import { describe, stamp, type KayitMsgs } from "./describe.ts";

// T-408: işlem kaydı satır metni (tasarım: "Operatör · …"). Bilinmeyen tür gizlenmez.
const t = (tr as unknown as { panel: { kayit: KayitMsgs } }).panel.kayit;
const ev = (kind: string, over: Record<string, unknown> = {}) => ({ at: new Date("2026-10-15T18:04:00Z"), kind, byOperator: true, company: "Motive Rubber", plan: "Profesyonel", info: {}, ...over });

group("işlem kaydı satırı", () => {
  it("operatör/sistem öneki, firma, paket, sürüm, dönem ve yöntem", () => {
    expect(describe(ev("platform.site.published", { info: { version: 4 } }), t)).toBe("Operatör · Satış sayfası yayınlandı · sürüm 4");
    expect(describe(ev("platform.tenant.suspended", { info: { reason: "2 dönem ödeme yok" } }), t)).toBe("Operatör · Motive Rubber askıya alındı · gerekçe: 2 dönem ödeme yok");
    expect(describe(ev("platform.charge.paid", { info: { period: "2026-10-01", method: "HAVALE" } }), t)).toBe("Operatör · Motive Rubber · Ekim 2026 ödemesi kaydedildi (havale)");
    expect(describe(ev("platform.demo_request.activated", { byOperator: false }), t)).toBe("Sistem · Deneme alanı açıldı · Motive Rubber");
    expect(describe(ev("platform.plan.saved", { info: { version: 2, published: true } }), t)).toBe("Operatör · Profesyonel paketi kaydedildi · sürüm 2 · yayında");
    expect(describe(ev("platform.yeni.tur"), t)).toBe("Operatör · platform.yeni.tur");
    expect(describe(ev("platform.tenant.resumed", { company: null }), t)).toBe("Operatör · [bilinmiyor] devam ettirildi");
  });
  it("zaman İstanbul saatiyle gg.aa ss:dd", () => {
    expect(stamp(new Date("2026-10-15T18:04:00Z"))).toBe("15.10 21:04");
  });
});
