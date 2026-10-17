// Web sürecinin Better Auth kurulumu (T-116d; A-42). `@wms/auth` `@wms/domain`'i içe aktarmaz: self-servis sıfırlama e-postası
// portu (`createResetMailPort`, T-117b) burada kurulup `getAuthService`'e enjekte edilir. Web'deki TÜM auth erişimi bu modülden
// geçer (tekil örnek ilk kurulandaki portu taşır; porttan habersiz bir çağrı örneği portsuz kurup 503'te bırakırdı).
//
// Fail-closed (sahte başarı yok): geçersiz/izinsiz MAIL_MODE, geçersiz QUEUE_SEAL_KEY → port yok (503 MAIL_DELIVERY_DISABLED);
// kuyruk (gönderen istemci) başlatılamıyorsa `canDeliver` false → aynı 503. Alıcı yalnızca mühürlü yükte yaşar; loga girmez (G-09).
import { isFieldEmail } from "@wms/shared/field-login";
import { getAuthService as getBaseAuthService, type AuthService, type ResetMailPort } from "@wms/auth";
import { createResetMailPort } from "@wms/domain/identity/memberships";
import { AppError } from "@wms/shared/errors";
import { assertMailModeAllowed, loadMailConfig } from "@wms/shared/mailer";
import { createSealer } from "@wms/shared/seal";
import type { JobQueue } from "@wms/shared/queue";
import { getSenderQueue } from "./queue.ts";

type EnvLike = Readonly<Record<string, string | undefined>>;
type EnqueueOnly = Pick<JobQueue, "enqueuePlatform">;

/** Kuyruk tutucusu: `canDeliver` eşzamanlıdır, kuyruk başlatması eşzamansızdır; sıfırlama isteğinde (önbellekli) yenilenir. */
export interface QueueHolder {
  queue: EnqueueOnly | undefined;
}

const logError = (msg: string, error: unknown): void => {
  // Yalnızca sınıf adı (mesaj alıcı/anahtar taşıyabilir, G-09).
  console.error(JSON.stringify({ level: "error", msg, error: error instanceof Error ? error.name : "unknown" }));
};

/**
 * Port kurulumu (saf; testlenebilir). Yapılandırma geçersizse `undefined` (fail-closed). `canDeliver`: kuyruk hazır VE mail kipi
 * alıcıya gönderebiliyor (Resend test kipi/`disabled` → false).
 */
export function buildResetMail(env: EnvLike, holder: QueueHolder): ResetMailPort | undefined {
  let mailConfig: ReturnType<typeof loadMailConfig>;
  let sealer: ReturnType<typeof createSealer>;
  try {
    mailConfig = loadMailConfig(env);
    assertMailModeAllowed(mailConfig, env.WMS_ENV?.trim());
    sealer = createSealer(env.QUEUE_SEAL_KEY);
  } catch (error) {
    logError("password reset mail disabled: invalid configuration", error);
    return undefined;
  }
  const portFor = (queue: EnqueueOnly): ReturnType<typeof createResetMailPort> => createResetMailPort({ mailConfig, queue, sealKey: sealer });
  const probe = portFor({ enqueuePlatform: () => Promise.reject(new AppError("INTERNAL")) });
  return {
    canDeliver: (recipient) => holder.queue !== undefined && probe.canDeliver(recipient),
    // Kuyruk başvurusu gönderim anında YAKALANIR: paylaşılan tutucu sonradan (başka isteğin hazırlığıyla) boşalsa da bu istek
    // kendi kuyruğuyla yazar. Kuyruk yoksa hata (sahte başarı yok).
    sendResetLink: (input) => {
      const queue = holder.queue;
      if (queue === undefined) return Promise.reject(new AppError("INTERNAL"));
      return portFor(queue).sendResetLink(input);
    },
  };
}

const holder: QueueHolder = { queue: undefined };
let resetMail: ResetMailPort | undefined;
let resetMailBuilt = false;

/** Port süreç başına bir kez kurulur (ortam sabit). */
function webResetMail(): ResetMailPort | undefined {
  if (!resetMailBuilt) {
    resetMail = buildResetMail(process.env, holder);
    resetMailBuilt = true;
  }
  return resetMail;
}

/** Web'in tekil Better Auth örneği (port enjekte). Kuyruk hazırlığı `authRouteHandlers` içinde yapılır. */
export function getAuthService(): AuthService {
  const port = webResetMail();
  return getBaseAuthService(process.env, port === undefined ? {} : { resetMail: port });
}

/** Better Auth 1.7.7 kurulu yolu (`dist/api/routes/password.mjs`: createAuthEndpoint("/request-password-reset")). */
const RESET_REQUEST_SUFFIX = "/request-password-reset";
export const QUEUE_PREPARE_TIMEOUT_MS = 2_000;
export const QUEUE_NEGATIVE_CACHE_MS = 30_000;

export interface RouteDeps {
  readonly hasPort: () => boolean;
  readonly getQueue: () => Promise<EnqueueOnly | undefined>;
  readonly holder: QueueHolder;
  readonly handler: (request: Request) => Promise<Response>;
  readonly now?: () => number;
  /** T-999b: e-posta başına başarısız giriş sayacı (yazmaz). Verilmezse ek başlık yok. */
  readonly attempts?: (email: string) => Promise<{ readonly remaining: number; readonly retryAfterSec: number | null }>;
}

const SIGN_IN_SUFFIX = "/sign-in/email";
const MAX_SIGN_IN_BODY = 4096;

/**
 * T-999b: başarısız e-posta girişinin yanıtına kullanıcıya gösterilecek sayaç bilgisi eklenir — 401'de `x-attempts-left` (kalan deneme),
 * 429'da eksikse `x-retry-after` (bekleme). Sayaç e-posta başınadır ve kayıtlı/kayıtsız ayrımı yapmaz (hesap varlığı sızmaz). Sayaç
 * okunamazsa yanıt değişmeden döner. Gövde ve diğer başlıklar korunur.
 */
/**
 * Güvenlik incelemesi m1: Better Auth `EMAIL_NOT_VERIFIED`'ı (403) yalnız parola DOĞRUYSA döner → "hesap var ve parola doğru" bilgisi.
 * Yanıt yanlış parolayla aynı biçime (401 INVALID_EMAIL_OR_PASSWORD) çevrilir; hesap varlığı API'den de sızmaz. Başka 403 dokunulmaz.
 */
async function maskUnverified(res: Response): Promise<Response> {
  if (res.status !== 403) return res;
  const code = await res
    .clone()
    .json()
    .then((b: unknown) => (b as { code?: unknown } | null)?.code)
    .catch(() => undefined);
  if (code !== "EMAIL_NOT_VERIFIED") return res;
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  headers.delete("set-cookie");
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }), { status: 401, headers });
}

async function withAttempts(res: Response, copy: Request, attempts: NonNullable<RouteDeps["attempts"]>): Promise<Response> {
  if (res.status !== 401 && res.status !== 429) return res;
  let email: unknown;
  try {
    email = ((await copy.json()) as { email?: unknown } | null)?.email;
  } catch {
    console.warn("[auth] sign-in attempts: gövde okunamadı");
    return res;
  }
  // Saha hesaplarının iç adresleri e-posta girişinde sayaçtan önce reddedilir; sayaç anlamsızdır (inceleme n3).
  if (typeof email !== "string" || email === "" || email.length > 320 || isFieldEmail(email)) return res;
  let v: { readonly remaining: number; readonly retryAfterSec: number | null };
  try {
    v = await attempts(email);
  } catch {
    console.warn("[auth] sign-in attempts: sayaç okunamadı"); // e-posta günlüğe yazılmaz
    return res;
  }
  const headers = new Headers(res.headers);
  if (res.status === 401) headers.set("x-attempts-left", String(v.remaining));
  if (res.status === 429 && !headers.has("x-retry-after") && v.retryAfterSec !== null) headers.set("x-retry-after", String(v.retryAfterSec));
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/**
 * `/api/auth/*` işleyicisi. Kuyruk hazırlığı YALNIZCA `POST …/request-password-reset` için yapılır (diğer uçlar kuyruğa hiç
 * dokunmaz; kuyruk asılsa da giriş etkilenmez). Hazırlık süre sınırlıdır; başarısızlık/aşım `canDeliver`'ı false yapar (503) ve
 * `QUEUE_NEGATIVE_CACHE_MS` boyunca yeniden denenmez.
 */
export function createRouteHandler(deps: RouteDeps): (request: Request) => Promise<Response> {
  const now = deps.now ?? Date.now;
  let retryAfter = 0;
  return async (request) => {
    if (request.method === "POST" && new URL(request.url).pathname.endsWith(RESET_REQUEST_SUFFIX) && deps.hasPort()) {
      if (now() < retryAfter) {
        deps.holder.queue = undefined;
      } else {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), QUEUE_PREPARE_TIMEOUT_MS);
        });
        try {
          deps.holder.queue = await Promise.race([deps.getQueue().catch(() => undefined), timeout]);
        } finally {
          clearTimeout(timer);
        }
        if (deps.holder.queue === undefined) retryAfter = now() + QUEUE_NEGATIVE_CACHE_MS;
      }
    }
    if (request.method !== "POST" || !new URL(request.url).pathname.endsWith(SIGN_IN_SUFFIX)) return deps.handler(request);
    // Gövde kopyası yalnız küçük ve boyutu bildirilmiş istekte (inceleme n1: sınırsız gövdenin iki kopyası tutulmaz). Kopya yoksa kalan
    // deneme başlığı eklenmez; doğrulanmamış e-posta dönüşümü (m1) gövde boyutundan bağımsız HER sign-in yanıtında yapılır.
    const length = Number(request.headers.get("content-length"));
    const small = Number.isFinite(length) && length > 0 && length <= MAX_SIGN_IN_BODY;
    const copy = small && deps.attempts !== undefined ? request.clone() : undefined;
    const res = await maskUnverified(await deps.handler(request));
    return res.ok || copy === undefined || deps.attempts === undefined ? res : withAttempts(res, copy, deps.attempts);
  };
}

const handle = createRouteHandler({
  hasPort: () => webResetMail() !== undefined,
  getQueue: getSenderQueue,
  holder,
  handler: (request) => getAuthService().handler(request),
  attempts: (email) => getAuthService().signInAttempts(email),
});

export const authRouteHandlers = Object.freeze({
  GET: handle,
  POST: handle,
});

/** Kimlik doğrulama yardımcıları (eskiden `@wms/auth` düz işlevleri); aynı tekil örnek üzerinden. */
export const ensureRecentAuth = (headers: Headers): Promise<void> => getAuthService().ensureRecentAuth(headers);
export const createPasswordResetToken: AuthService["createPasswordResetToken"] = (userId, tenantId) =>
  getAuthService().createPasswordResetToken(userId, tenantId);
export const discardPasswordResetToken: AuthService["discardPasswordResetToken"] = (id) => getAuthService().discardPasswordResetToken(id);
export const recordPasswordResetLinkIssued: AuthService["recordPasswordResetLinkIssued"] = (input) =>
  getAuthService().recordPasswordResetLinkIssued(input);
export const createInvitedAccount: AuthService["createInvitedAccount"] = (input) => getAuthService().createInvitedAccount(input);
export const createActivatedAccount: AuthService["createActivatedAccount"] = (input) => getAuthService().createActivatedAccount(input);
export const createFieldAccount: AuthService["createFieldAccount"] = (input) => getAuthService().createFieldAccount(input);
export const revokeUserSessions: AuthService["revokeUserSessions"] = (userId) => getAuthService().revokeUserSessions(userId);
export const revokeDeviceSessions: AuthService["revokeDeviceSessions"] = (deviceId) => getAuthService().revokeDeviceSessions(deviceId);
