"use server";
// T-1002 (B-62): Etkin bas-konuş — ses → yazı → niyet → yanıt. Sınır: Origin + oturum (guard), üyelik + `stock.view` (runTenantQuery;
// üye olmayan/yetkisiz kullanıcı ret), kullanıcı başına dakikada 20 konuşma (`voice` kovası) + genel IP/kullanıcı/kiracı sınırları.
// Ses bu istekte bellekte kalır: diske yazılmaz, loglanmaz, iç `voice` servisine gider (dışarıya değil). Yanıt yalnız okuma ve taslaktır;
// stok/iş değiştiren kayıt ancak "Anladım" kartında Onayla ile MEVCUT eylemlerden yapılır (yeni yazma yolu yok).
import { headers } from "next/headers";
import { z } from "zod";
import { getAppDb } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { answerVoiceCommand, type VoiceAnswer } from "@wms/domain/voice";
import { createProductionGuard, limitVerifiedTenant } from "../../../../lib/action-guard.ts";
import { createProductionLimiter } from "../../../../lib/rate-limit.ts";
import { isAcceptedWav, transcribe, WAV_MAX_BYTES } from "../../../../lib/voice.ts";

const guarded = createProductionGuard(() => headers());
const voiceLimiter = createProductionLimiter();
const B64_MAX = Math.ceil(WAV_MAX_BYTES / 3) * 4;
const schema = z
  .object({
    slug: z.string().min(1).max(63),
    audio: z.string().min(64).max(B64_MAX).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();

export type EtkinYanit =
  | { readonly status: "unavailable" | "busy" | "empty" }
  | { readonly status: "ok"; readonly text: string; readonly confidence: number; readonly answer: VoiceAnswer };

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
    if (heard.status !== "ok") return { status: heard.status };
    const text = heard.text.trim();
    if (text === "") return { status: "empty" };
    const answer = await answerVoiceCommand(params, text);
    return { status: "ok", text, confidence: heard.confidence, answer };
  })(raw);
}
