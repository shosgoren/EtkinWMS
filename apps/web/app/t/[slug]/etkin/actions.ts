"use server";
// T-1002 (B-62): Etkin bas-konuş — ses → yazı → niyet → yanıt. Sınır: Origin + oturum (guard), üyelik + `stock.view` (runTenantQuery;
// üye olmayan/yetkisiz kullanıcı ret), kullanıcı başına dakikada 20 konuşma (`voice` kovası) + genel IP/kullanıcı/kiracı sınırları.
// Ses bu istekte bellekte kalır: diske yazılmaz, loglanmaz, iç `voice` servisine gider (dışarıya değil). Yanıt yalnız okuma ve taslaktır;
// stok/iş değiştiren kayıt ancak "Anladım" kartında Onayla ile MEVCUT eylemlerden yapılır (yeni yazma yolu yok).
import { headers } from "next/headers";
import { z } from "zod";
import { getAppDb } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { answerVoiceCommand, getVoiceReply, type VoiceAnswer } from "@wms/domain/voice";
import { createProductionGuard, limitVerifiedTenant } from "../../../../lib/action-guard.ts";
import { createProductionLimiter } from "../../../../lib/rate-limit.ts";
import { isAcceptedWav, synthesize, transcribe, TTS_MAX_CHARS, WAV_MAX_BYTES } from "../../../../lib/voice.ts";

const guarded = createProductionGuard(() => headers());
const voiceLimiter = createProductionLimiter();
const B64_MAX = Math.ceil(WAV_MAX_BYTES / 3) * 4;
const schema = z
  .object({
    slug: z.string().min(1).max(63),
    audio: z.string().min(64).max(B64_MAX).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();

// T-1109 (B-134): `speak` = firmanın "Etkin sesli yanıt" ayarı (0063, varsayılan kapalı); istemci cevabı yalnız açıksa ve kullanıcı
// "Sessiz" değilse doğal sesle okur.
export type EtkinYanit =
  | { readonly status: "unavailable" | "busy" | "empty"; readonly speak: boolean }
  | { readonly status: "ok"; readonly text: string; readonly confidence: number; readonly answer: VoiceAnswer; readonly speak: boolean };

export async function etkinAnlaAction(raw: unknown) {
  return guarded({ schema }, async (input, ctx): Promise<EtkinYanit> => {
    const principal = ctx.principal;
    if (principal === null) throw new AppError("UNAUTHENTICATED");
    const params = { db: getAppDb(), principal, tenantSlug: input.slug };
    await limitVerifiedTenant({ ...params, permission: "stock.view" }, ctx);
    await voiceLimiter.check("voice", principal.userId);
    const wav = Buffer.from(input.audio, "base64");
    if (!isAcceptedWav(wav)) throw new AppError("VALIDATION_FAILED");
    const heard = await transcribe(wav);
    wav.fill(0);
    const speak = await getVoiceReply(params);
    if (heard.status !== "ok") return { status: heard.status, speak };
    const text = heard.text.trim();
    if (text === "") return { status: "empty", speak };
    const answer = await answerVoiceCommand(params, text);
    return { status: "ok", text, confidence: heard.confidence, answer, speak };
  })(raw);
}

// T-1106 (Q-129): ekrandaki yönerge metnini doğal Türkçe sesle okur. Aynı sınır: Origin + oturum, üyelik + `stock.view`, kullanıcı başına
// dakikada 30 (`tts` kovası). Metin kullanıcının ekranda zaten gördüğü yönergedir; saklanmaz/loglanmaz. Ses servisi yoksa "unavailable"
// döner, istemci cihaz sesine düşer.
const soyleSchema = z
  .object({
    slug: z.string().min(1).max(63),
    text: z.string().trim().min(1).max(TTS_MAX_CHARS),
  })
  .strict();

export type EtkinSes = { readonly status: "unavailable" | "busy" } | { readonly status: "ok"; readonly audio: string };

export async function etkinSoyleAction(raw: unknown) {
  return guarded({ schema: soyleSchema }, async (input, ctx): Promise<EtkinSes> => {
    const principal = ctx.principal;
    if (principal === null) throw new AppError("UNAUTHENTICATED");
    await limitVerifiedTenant({ db: getAppDb(), principal, tenantSlug: input.slug, permission: "stock.view" }, ctx);
    await voiceLimiter.check("tts", principal.userId);
    const spoken = await synthesize(input.text);
    if (spoken.status !== "ok") return { status: spoken.status };
    return { status: "ok", audio: Buffer.from(spoken.wav).toString("base64") };
  })(raw);
}
