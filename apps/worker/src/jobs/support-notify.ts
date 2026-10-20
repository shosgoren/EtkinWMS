// `support.notify` (T-967, B-84): yeni destek talebinde operatöre WhatsApp kısa bildirimi (CallMeBot; kullanıcı kararı 20 Ekim, resmi olmayan
// ücretsiz yol). Metin YALNIZ "Etkin: yeni destek talebi #<no> <panel bağlantısı>": müşteri adı/içeriği yok. `CALLMEBOT_PHONE` ve
// `CALLMEBOT_APIKEY` yoksa iş sessizce atlanır (asıl kayıt panel rozetidir). Çağrı `deliverExternalOnce` ile en çok bir kez başarıyla yapılır
// (tekrar teslimde ikinci mesaj yok); hata yeniden deneme/geri çekilme ile kuyruğa döner. Adres (API anahtarı içerir), telefon ve yanıt
// gövdesi hiçbir loga/hataya yazılmaz (G-09).
import { deliverExternalOnce } from "@wms/queue-adapter";
import type { JobHandler } from "@wms/shared/queue";
import type { Logger } from "../lifecycle.js";

export const CALLMEBOT_ENDPOINT = "https://api.callmebot.com/whatsapp.php";
export const DEFAULT_PANEL_URL = "https://yonet.etkinyazilim.com";
const TIMEOUT_MS = 15_000;

export class SupportNotifyError extends Error {
  override name = "SupportNotifyError";
  readonly code: string;
  constructor(code: string) {
    super(`support notify failed (${code})`);
    this.code = code;
  }
}

export interface SupportNotifyDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly logger: Logger;
  readonly fetch?: (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; status: number }>;
}

/** Bildirim metni: yalnız numara + panel bağlantısı. */
export function supportNotifyText(ticketNo: number, ticketId: string, panelUrl: string = DEFAULT_PANEL_URL): string {
  const base = panelUrl.trim().replace(/\/+$/, "") || DEFAULT_PANEL_URL;
  return `Etkin: yeni destek talebi #${ticketNo} ${base}/support?t=${ticketId}`;
}

export function supportNotifyUrl(phone: string, apiKey: string, text: string): string {
  const q = new URLSearchParams({ phone, text, apikey: apiKey });
  return `${CALLMEBOT_ENDPOINT}?${q.toString()}`;
}

export function createSupportNotifyHandler(deps: SupportNotifyDeps): JobHandler<"support.notify"> {
  const doFetch = deps.fetch ?? ((url, init) => fetch(url, init));
  return async (ctx) => {
    const phone = deps.env.CALLMEBOT_PHONE?.trim() ?? "";
    const apiKey = deps.env.CALLMEBOT_APIKEY?.trim() ?? "";
    if (phone === "" || apiKey === "") {
      deps.logger.info("support.notify skipped", { jobId: ctx.jobId, reason: "not_configured" });
      return;
    }
    const { ticketId, ticketNo } = ctx.payload;
    try {
      await deliverExternalOnce(ctx, "support.notify", async () => {
        const url = supportNotifyUrl(phone, apiKey, supportNotifyText(ticketNo, ticketId, deps.env.PANEL_URL ?? DEFAULT_PANEL_URL));
        let res: { ok: boolean; status: number };
        try {
          res = await doFetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        } catch {
          // Kök hata adresi (anahtarı) taşıyabilir: yalnız sabit kod yayılır.
          throw new SupportNotifyError("NETWORK");
        }
        if (!res.ok) throw new SupportNotifyError(`HTTP_${res.status}`);
        deps.logger.info("support.notify sent", { jobId: ctx.jobId });
      });
    } catch (err) {
      deps.logger.error("support.notify failed", {
        jobId: ctx.jobId,
        error: err instanceof Error ? err.name : "unknown",
        ...(err instanceof SupportNotifyError ? { code: err.code } : {}),
      });
      throw err instanceof SupportNotifyError ? err : new SupportNotifyError("INTERNAL");
    }
  };
}
