// T-967: `support.notify` — CALLMEBOT yokken sessiz atlama, yalnız numara + panel bağlantısı içeren metin, tek başarılı gönderim
// (tekrar teslimde ikinci istek yok), HTTP/ağ hatasında yeniden deneme için hata ve logda sır (adres/anahtar/telefon) olmaması.
import { describe, expect, it, vi } from "vitest";

const processed = new Set<string>();
vi.mock("@wms/queue-adapter", () => ({
  // Gerçek sözleşme: önceden işlenmişse çağrı yok; çağrı başarılıysa işlenmiş sayılır; hata yayılır (satır yazılmaz).
  deliverExternalOnce: async (ctx: { jobId: string }, consumer: string, call: (k: string) => Promise<void>) => {
    const key = `${consumer}:${ctx.jobId}`;
    if (processed.has(key)) return false;
    await call(ctx.jobId);
    processed.add(key);
    return true;
  },
}));

const { createSupportNotifyHandler, supportNotifyText, CALLMEBOT_ENDPOINT, SupportNotifyError } = await import("./support-notify.ts");

const TICKET = "0b7f6a52-2d0e-4b8e-9d55-3f2a1c9e7a10";
const PHONE = "+905550000000";
const KEY = "1234567";

function logger() {
  const lines: { level: string; msg: string; fields?: Record<string, unknown> }[] = [];
  const log = (level: string) => (msg: string, fields?: Record<string, unknown>) => {
    lines.push({ level, msg, ...(fields === undefined ? {} : { fields }) });
  };
  return { lines, logger: { debug: log("debug"), info: log("info"), warn: log("warn"), error: log("error") } };
}

function ctx(jobId: string) {
  return {
    jobId,
    type: "support.notify" as const,
    hasTenant: true,
    actorUserId: null,
    payload: { ticketId: TICKET, ticketNo: 42 },
    inTenant: () => Promise.reject(new Error("not used")),
    inPlatform: () => Promise.reject(new Error("not used")),
  };
}

describe("support.notify", () => {
  it("metin yalnız numara ve panel bağlantısı (müşteri verisi yok)", () => {
    expect(supportNotifyText(42, TICKET)).toBe(`Etkin: yeni destek talebi #42 https://yonet.etkinyazilim.com/support?t=${TICKET}`);
    expect(supportNotifyText(7, TICKET, "https://panel.example/")).toBe(`Etkin: yeni destek talebi #7 https://panel.example/support?t=${TICKET}`);
    expect(supportNotifyText(7, TICKET, "  ")).toContain("https://yonet.etkinyazilim.com/support?t=");
  });

  it("CALLMEBOT_PHONE / CALLMEBOT_APIKEY yoksa sessizce atlar (istek yok, hata yok)", async () => {
    for (const env of [{}, { CALLMEBOT_PHONE: PHONE }, { CALLMEBOT_APIKEY: KEY }, { CALLMEBOT_PHONE: " ", CALLMEBOT_APIKEY: " " }]) {
      const fetch = vi.fn();
      const l = logger();
      await createSupportNotifyHandler({ env, logger: l.logger, fetch })(ctx("11111111-1111-4111-8111-111111111111") as never);
      expect(fetch).not.toHaveBeenCalled();
      expect(l.lines).toEqual([{ level: "info", msg: "support.notify skipped", fields: { jobId: "11111111-1111-4111-8111-111111111111", reason: "not_configured" } }]);
    }
  });

  it("yapılandırılmışsa tek GET; tekrar teslimde ikinci istek yok; logda sır yok", async () => {
    const urls: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200 };
    });
    const l = logger();
    const handler = createSupportNotifyHandler({ env: { CALLMEBOT_PHONE: PHONE, CALLMEBOT_APIKEY: KEY }, logger: l.logger, fetch });
    await handler(ctx("22222222-2222-4222-8222-222222222222") as never);
    await handler(ctx("22222222-2222-4222-8222-222222222222") as never);
    expect(fetch).toHaveBeenCalledTimes(1);
    const u = new URL(urls[0] ?? "");
    expect(`${u.origin}${u.pathname}`).toBe(CALLMEBOT_ENDPOINT);
    expect(u.searchParams.get("phone")).toBe(PHONE);
    expect(u.searchParams.get("apikey")).toBe(KEY);
    expect(u.searchParams.get("text")).toBe(supportNotifyText(42, TICKET));
    expect(JSON.stringify(l.lines)).not.toMatch(new RegExp(`${KEY}|5550000000|callmebot`));
    expect(l.lines.map((x) => x.msg)).toEqual(["support.notify sent"]);
  });

  it("HTTP hatası ve ağ hatası yeniden denenir (hata yayılır), sonraki başarılı denemede bir kez gönderilir; sır loga/hataya girmez", async () => {
    const l = logger();
    const responses: Array<() => Promise<{ ok: boolean; status: number }>> = [
      () => Promise.resolve({ ok: false, status: 503 }),
      () => Promise.reject(new TypeError(`fetch failed ${CALLMEBOT_ENDPOINT}?apikey=${KEY}`)),
      () => Promise.resolve({ ok: true, status: 200 }),
    ];
    const fetch = vi.fn(() => (responses.shift() ?? (() => Promise.resolve({ ok: true, status: 200 })))());
    const handler = createSupportNotifyHandler({ env: { CALLMEBOT_PHONE: PHONE, CALLMEBOT_APIKEY: KEY }, logger: l.logger, fetch });
    const job = ctx("33333333-3333-4333-8333-333333333333") as never;
    const e1 = await handler(job).catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(SupportNotifyError);
    expect((e1 as InstanceType<typeof SupportNotifyError>).code).toBe("HTTP_503");
    const e2 = await handler(job).catch((e: unknown) => e);
    expect((e2 as InstanceType<typeof SupportNotifyError>).code).toBe("NETWORK");
    expect(String((e2 as Error).message)).not.toContain(KEY);
    await handler(job);
    await handler(job);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(l.lines)).not.toContain(KEY);
    expect(l.lines.map((x) => x.msg)).toEqual(["support.notify failed", "support.notify failed", "support.notify sent"]);
  });
});
