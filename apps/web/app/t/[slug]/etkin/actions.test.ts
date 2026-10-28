import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// T-1002 (B-62): Etkin eylem sınırı — Origin/oturum korunur, üye olmayan reddedilir (ses servisine hiç gitmez), kullanıcı başına hız sınırı,
// yalnız sabit biçimli WAV kabul, ses servisi yoksa "unavailable" (uygulama çalışır), girdi strict (tenant/kimlik enjekte edilemez).
const mocks = vi.hoisted(() => ({
  principal: vi.fn(),
  member: vi.fn(),
  limit: vi.fn(),
  transcribe: vi.fn(),
  synthesize: vi.fn(),
  voiceReply: vi.fn(),
  answer: vi.fn(),
  origin: "https://app.example.test",
}));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers({ origin: mocks.origin })) }));
vi.mock("../../../../lib/auth-service.ts", () => ({ getAuthService: () => ({ getPrincipal: mocks.principal }) }));
vi.mock("@wms/db", () => ({ getAppDb: () => ({}) }));
vi.mock("../../../../lib/rate-limit.ts", async (original) => ({ ...(await original<object>()), createProductionLimiter: () => ({ check: mocks.limit }) }));
vi.mock("@wms/domain/identity/access", () => ({ runTenantQuery: (access: { permission: string }) => mocks.member(access.permission) }));
vi.mock("@wms/domain/voice", () => ({ answerVoiceCommand: mocks.answer, getVoiceReply: mocks.voiceReply }));
vi.mock("../../../../lib/voice.ts", async (original) => ({ ...(await original<object>()), transcribe: mocks.transcribe, synthesize: mocks.synthesize }));
import { AppError } from "@wms/shared/errors";
import { RateLimitedError } from "../../../../lib/rate-limit.ts";
import { etkinAnlaAction, etkinSoyleAction } from "./actions.ts";

function wav(seconds = 1): string {
  const n = Math.floor(seconds * 16000);
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write("WAVE", 8);
  b.write("fmt ", 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 2, 40);
  return b.toString("base64");
}

let original: string | undefined;
beforeEach(() => {
  original = process.env.BETTER_AUTH_URL;
  process.env.BETTER_AUTH_URL = "https://app.example.test";
  mocks.origin = "https://app.example.test";
  mocks.principal.mockResolvedValue({ userId: "user-1", mfaVerified: true });
  mocks.member.mockResolvedValue("tenant-1");
  mocks.limit.mockResolvedValue(undefined);
  mocks.transcribe.mockResolvedValue({ status: "ok", text: "C bir rafında ne var", confidence: 0.8 });
  mocks.voiceReply.mockResolvedValue(false);
  mocks.synthesize.mockResolvedValue({ status: "ok", wav: new Uint8Array([82, 73, 70, 70, 1, 2]) });
  mocks.answer.mockResolvedValue({ type: "read", title: "C-01", icon: "loc", rows: [], total: 0, href: "/stock" });
});
afterEach(() => {
  if (original === undefined) delete process.env.BETTER_AUTH_URL;
  else process.env.BETTER_AUTH_URL = original;
  vi.clearAllMocks();
});

describe("etkinAnlaAction", () => {
  it("üye + stock.view: ses → metin → yanıt; kullanıcı kovası sayılır", async () => {
    const res = await etkinAnlaAction({ slug: "pilot", audio: wav() });
    expect(res).toMatchObject({ ok: true, data: { status: "ok", text: "C bir rafında ne var", answer: { type: "read" } } });
    expect(mocks.member).toHaveBeenCalledWith("stock.view");
    expect(mocks.limit).toHaveBeenCalledWith("voice", "user-1");
    expect(mocks.answer).toHaveBeenCalledWith(expect.objectContaining({ tenantSlug: "pilot", principal: { userId: "user-1", mfaVerified: true } }), "C bir rafında ne var");
  });

  it("T-1109: firma sesli yanıtı açıksa yanıt `speak: true` taşır (üyelikle okunur)", async () => {
    mocks.voiceReply.mockResolvedValueOnce(true);
    const res = await etkinAnlaAction({ slug: "pilot", audio: wav() });
    expect(res).toMatchObject({ ok: true, data: { status: "ok", speak: true } });
    expect(mocks.voiceReply).toHaveBeenCalledWith(expect.objectContaining({ tenantSlug: "pilot", principal: { userId: "user-1", mfaVerified: true } }));
  });

  it("oturum yok / yanlış köken: ses servisine gidilmez", async () => {
    mocks.principal.mockResolvedValue(null);
    expect(await etkinAnlaAction({ slug: "pilot", audio: wav() })).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    mocks.principal.mockResolvedValue({ userId: "user-1", mfaVerified: true });
    mocks.origin = "https://evil.example";
    expect(await etkinAnlaAction({ slug: "pilot", audio: wav() })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("üye olmayan (başka kiracı) reddedilir; hız kovası tüketilmez, ses gönderilmez", async () => {
    mocks.member.mockRejectedValue(new AppError("FORBIDDEN"));
    expect(await etkinAnlaAction({ slug: "baska", audio: wav() })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(mocks.limit).not.toHaveBeenCalledWith("voice", expect.anything());
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("kullanıcı başına hız sınırı aşılınca RATE_LIMITED; ses servisine gidilmez", async () => {
    mocks.limit.mockImplementation((kind: string) => (kind === "voice" ? Promise.reject(new RateLimitedError(30)) : Promise.resolve()));
    expect(await etkinAnlaAction({ slug: "pilot", audio: wav() })).toMatchObject({ ok: false, error: { code: "RATE_LIMITED", retryAfterSeconds: 30 } });
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("yalnız 16 kHz mono 16 bit PCM ≤ 8,5 sn; strict girdi", async () => {
    const stereo = Buffer.from(wav(), "base64");
    stereo.writeUInt16LE(2, 22);
    expect(await etkinAnlaAction({ slug: "pilot", audio: stereo.toString("base64") })).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(await etkinAnlaAction({ slug: "pilot", audio: wav(9) })).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(await etkinAnlaAction({ slug: "pilot", audio: wav(), tenantId: "x" })).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("ses servisi yok/meşgul/boş: uygulama hata vermez, yalnız durum döner", async () => {
    for (const status of ["unavailable", "busy"] as const) {
      mocks.transcribe.mockResolvedValueOnce({ status });
      expect(await etkinAnlaAction({ slug: "pilot", audio: wav() })).toEqual({ ok: true, data: { status, speak: false } });
    }
    mocks.transcribe.mockResolvedValueOnce({ status: "ok", text: "  ", confidence: 0 });
    expect(await etkinAnlaAction({ slug: "pilot", audio: wav() })).toEqual({ ok: true, data: { status: "empty", speak: false } });
    expect(mocks.answer).not.toHaveBeenCalled();
  });
});

// T-1106: doğal sesle okuma — aynı sınır (köken, oturum, üyelik + stock.view), kullanıcı başına `tts` kovası, metin sınırı, servis yoksa durum.
describe("etkinSoyleAction", () => {
  it("üye + stock.view: metin → WAV (base64); kullanıcı kovası sayılır", async () => {
    const res = await etkinSoyleAction({ slug: "pilot", text: "  Raf A-3 boş.  " });
    expect(res).toEqual({ ok: true, data: { status: "ok", audio: Buffer.from([82, 73, 70, 70, 1, 2]).toString("base64") } });
    expect(mocks.member).toHaveBeenCalledWith("stock.view");
    expect(mocks.limit).toHaveBeenCalledWith("tts", "user-1");
    expect(mocks.synthesize).toHaveBeenCalledWith("Raf A-3 boş.");
  });

  it("oturum yok / yanlış köken / üye değil / hız sınırı: ses servisine gidilmez", async () => {
    mocks.principal.mockResolvedValueOnce(null);
    expect(await etkinSoyleAction({ slug: "pilot", text: "merhaba" })).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    mocks.origin = "https://evil.example";
    expect(await etkinSoyleAction({ slug: "pilot", text: "merhaba" })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    mocks.origin = "https://app.example.test";
    mocks.member.mockRejectedValueOnce(new AppError("FORBIDDEN"));
    expect(await etkinSoyleAction({ slug: "baska", text: "merhaba" })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(mocks.limit).not.toHaveBeenCalledWith("tts", expect.anything());
    mocks.limit.mockImplementation((kind: string) => (kind === "tts" ? Promise.reject(new RateLimitedError(20)) : Promise.resolve()));
    expect(await etkinSoyleAction({ slug: "pilot", text: "merhaba" })).toMatchObject({ ok: false, error: { code: "RATE_LIMITED", retryAfterSeconds: 20 } });
    expect(mocks.synthesize).not.toHaveBeenCalled();
  });

  it("boş, 400 karakterden uzun ya da fazladan alanlı girdi reddedilir", async () => {
    for (const raw of [{ slug: "pilot", text: "   " }, { slug: "pilot", text: "a".repeat(401) }, { slug: "pilot", text: "x", tenantId: "t" }]) {
      expect(await etkinSoyleAction(raw)).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    }
    expect(mocks.synthesize).not.toHaveBeenCalled();
  });

  it("ses servisi yok/meşgul: hata değil, yalnız durum (istemci cihaz sesine düşer)", async () => {
    for (const status of ["unavailable", "busy"] as const) {
      mocks.synthesize.mockResolvedValueOnce({ status });
      expect(await etkinSoyleAction({ slug: "pilot", text: "merhaba" })).toEqual({ ok: true, data: { status } });
    }
  });
});
