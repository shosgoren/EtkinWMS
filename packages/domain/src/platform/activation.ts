// Deneme aktivasyonu (T-995, ADR-026 §3.3–3.5; migration 0039). Onaylı demo talebinin tek kullanımlık bağlantısıyla müşteri kendi
// çalışma alanını açar: firma adı + çalışma alanı adı + örnek veri seçimi + parola. Sahip hesabı, tenant ve 3 aylık deneme kaydı;
// ardından (web tarafında) giriş ve zorunlu MFA kurulumu.
//
// - Belirteç: 32 bayt rastgele base64url; DB'de yalnız SHA-256 özeti (davet deseni). Önizleme ve ad yoklaması yalnız geçerli bağlantıyla.
// - Sıra (davet m8 deseni, iki bağlantı): (1) talep (`platform_activation_claim`), (2) wms_auth hesap (`createActivatedAccount`; e-posta ve ad
//   talepten), (3) `withNewTenant` transaction'ında tenant + ayarlar + `platform_activation_consume` (deneme DB saatinden). (3) başarısızsa talep
//   bırakılır (kimlik korunur): aynı bağlantıyla yeniden deneme aynı hesabı kullanır.
// - Hoş geldiniz e-postası (`trial.welcome`) aynı transaction'da kuyruğa girer; sır taşımaz (parola, MFA, belirteç yok). Posta kapalıysa iş
//   yazılmaz ve sonuç bunu söyler (sahte "gönderildi" yok).
// - Hatalar sözleşme kodlarıdır: geçersiz/süresi dolmuş/kullanılmış bağlantı tek tip `NOT_FOUND`; alınmış/ayrılmış çalışma alanı adı
//   `VALIDATION_FAILED` + `CODE_TAKEN`. Kişisel veri günlüğe yazılmaz.
import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { MembershipError, appendAudit, withNewTenant, withUser } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { canDeliver, type MailConfig } from "@wms/shared/mailer";
import { PLATFORM_NO_USER_ID, type JobQueue } from "@wms/shared/queue";
import type { AccessDbClient, AccessTx } from "../identity/access.ts";
import { getTemplate } from "../onboarding/templates.ts";
import { RESERVED_SLUGS, initializeNewTenant, slugBaseFromName } from "../onboarding/workspace.ts";

/** Bağlantı geçerliliği (ADR-026 §3.3): DB'de `now() + 72 saat` (0039); burada yalnız gösterim için. */
export const ACTIVATION_TTL_HOURS = 72;
/** Çalışma alanı adı (ADR-026 §2): 3–30 karakter, küçük harf/rakam/tire, uçlarda tire yok. */
export const WORKSPACE_NAME_MIN = 3;
export const WORKSPACE_NAME_MAX = 30;
/** Aktivasyonla açılan alanın sektör şablonu: sektör bağımsız genel şablon (müşteri sonra ayarlardan değiştirir). */
export const ACTIVATION_TEMPLATE_KEY = "GENERIC";

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORKSPACE_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;
const COMPANY_MAX = 120;
const PASSWORD_MIN = 12;
const PASSWORD_MAX = 128;

export function generateActivationToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isWellFormedActivationToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_RE.test(token);
}

export function hashActivationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** E-postayla teslimde DB'ye yazılan yer tutucu: kimsenin bilmediği rastgele değerin özeti (worker gerçeğini yazar). */
export function placeholderActivationHash(): string {
  return hashActivationToken(generateActivationToken());
}

/**
 * Girilen çalışma alanı adının adres biçimi: Türkçe harfler sadeleşir, boşluk/işaret tireye döner (`slugBaseFromName`); boş kalırsa
 * boş dize (otomatik "workspace" önerilmez — kullanıcı kendi adını yazar).
 */
export function normalizeWorkspaceName(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "") return "";
  const base = slugBaseFromName(raw.slice(0, 80));
  return base === "workspace" && !/workspace/i.test(raw) ? "" : base.slice(0, WORKSPACE_NAME_MAX).replace(/-+$/g, "");
}

/** Biçim ve ayrılmış ad denetimi (DB'ye gitmeden). Ayrılmış ve biçimsiz ad aynı yanıtı verir. */
export function isAllowedWorkspaceName(slug: string): boolean {
  return slug.length >= WORKSPACE_NAME_MIN && slug.length <= WORKSPACE_NAME_MAX && WORKSPACE_RE.test(slug) && !RESERVED_SLUGS.has(slug);
}

function sqlstateOf(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 6 && cur !== undefined && cur !== null; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

function wrap(code: "NOT_FOUND" | "VERSION_CONFLICT" | "VALIDATION_FAILED" | "FORBIDDEN" | "INTERNAL", cause: unknown, retryable = false): AppError {
  const err = new AppError(code, retryable ? { retryable: true } : {});
  err.cause = cause;
  return err;
}

function nameTaken(cause?: unknown): AppError {
  const err = new AppError("VALIDATION_FAILED", { detail: "CODE_TAKEN" });
  if (cause !== undefined) err.cause = cause;
  return err;
}

function mapActivationError(e: unknown): unknown {
  if (e instanceof AppError) return e;
  if (e instanceof MembershipError && (e.code === "SLUG_TAKEN" || e.code === "IDEMPOTENCY_MISMATCH")) return nameTaken(e);
  const named = e as { name?: unknown; code?: unknown } | null;
  if (named?.name === "InvitedAccountError") {
    // Aynı e-postayla başka yoldan açılmış hesap: bağlantı bu hesaba bağlanamaz (hesap/e-posta keşfi vermeden tek tip ret).
    if (named.code === "FORBIDDEN") return wrap("FORBIDDEN", e);
    if (named.code === "NOT_FOUND") return wrap("NOT_FOUND", e);
    if (named.code === "VALIDATION_FAILED") return wrap("VALIDATION_FAILED", e);
  }
  const state = sqlstateOf(e);
  if (state === "P0002") return wrap("NOT_FOUND", e);
  if (state === "55000") return wrap("VERSION_CONFLICT", e, true);
  if (state === "42501") return wrap("NOT_FOUND", e);
  if (state === "22023") return wrap("VALIDATION_FAILED", e);
  if (state === "23505") return wrap("VERSION_CONFLICT", e, true);
  return wrap("INTERNAL", e);
}

// ---------------------------------------------------------------------------------------------
// Önizleme ve ad yoklaması (oturumsuz, yalnız geçerli bağlantıyla)
// ---------------------------------------------------------------------------------------------

export interface ActivationPreview {
  readonly company: string;
  readonly email: string;
  readonly expiresAt: Date;
  /** Bağlantı e-postayla gittiyse adres bu tıklamayla doğrulanmış sayılır (ADR-026 §3.3). */
  readonly emailVerifiedByLink: boolean;
}

export async function previewActivation(params: { readonly db: AccessDbClient; readonly token: unknown }): Promise<ActivationPreview | null> {
  if (!isWellFormedActivationToken(params.token)) return null;
  const hash = hashActivationToken(params.token);
  const rows = await withUser(params.db, PLATFORM_NO_USER_ID, (tx) =>
    tx.execute<{ company: string; email: string; expires_at: Date | string; delivery: string }>(
      sql`SELECT company, email, expires_at, delivery FROM wms_probe.platform_activation_preview(${hash})`,
    ),
  );
  const r = rows[0];
  if (r === undefined) return null;
  return { company: r.company, email: r.email, expiresAt: new Date(r.expires_at), emailVerifiedByLink: r.delivery === "EMAIL" };
}

export type WorkspaceNameState = "ok" | "short" | "taken";

/**
 * Canlı uygunluk (tasarım `slugState`): kısa/biçimsiz → `short`; ayrılmış ya da alınmış → aynı `taken` (hangisi olduğu söylenmez).
 * Bağlantı geçersizse `NOT_FOUND`.
 */
export async function checkWorkspaceName(params: {
  readonly db: AccessDbClient;
  readonly token: unknown;
  readonly name: unknown;
}): Promise<{ readonly slug: string; readonly state: WorkspaceNameState }> {
  if (!isWellFormedActivationToken(params.token)) throw new AppError("NOT_FOUND");
  const slug = normalizeWorkspaceName(params.name);
  if (slug.length < WORKSPACE_NAME_MIN) return { slug, state: "short" };
  const hash = hashActivationToken(params.token);
  try {
    const rows = await withUser(params.db, PLATFORM_NO_USER_ID, (tx) =>
      tx.execute<{ taken: boolean }>(sql`SELECT wms_probe.platform_workspace_name_taken(${hash}, ${slug}) AS taken`),
    );
    // Ayrılmış ad da DB'ye sorulur: iki yol aynı yanıtı ve aynı sorgu sayısını verir.
    const taken = rows[0]?.taken === true || !isAllowedWorkspaceName(slug);
    return { slug, state: taken ? "taken" : "ok" };
  } catch (e) {
    throw mapActivationError(e);
  }
}

// ---------------------------------------------------------------------------------------------
// Aktivasyon
// ---------------------------------------------------------------------------------------------

export interface ActivateTrialDeps {
  /** `@wms/auth` `createActivatedAccount` (domain Better Auth import etmez). */
  readonly createActivatedAccount: (input: { activationTokenHash: string; claimId: string; password: string }) => Promise<{ userId: string; reused: boolean }>;
  readonly mailConfig: MailConfig;
  /** Hoş geldiniz işi aynı tenant transaction'ında yazılır. */
  readonly queue: Pick<JobQueue<AccessTx>, "enqueue">;
  readonly log?: (entry: Readonly<Record<string, unknown>>) => void;
}

export interface ActivateTrialParams {
  readonly db: AccessDbClient;
  readonly token: unknown;
  readonly company: unknown;
  readonly workspaceName: unknown;
  readonly sample: unknown;
  readonly password: unknown;
}

export interface ActivateTrialResult {
  readonly tenantId: string;
  readonly tenantSlug: string;
  /** Giriş e-postası (talepten; istemci girişi bununla yapar). */
  readonly email: string;
  readonly trialEndsAt: Date;
  /** Hoş geldiniz e-postası kuyruğa girdi mi (posta kapalı/uygun değilse `false`; ekranda bu söylenir). */
  readonly welcomeQueued: boolean;
}

export async function activateTrial(params: ActivateTrialParams, deps: ActivateTrialDeps): Promise<ActivateTrialResult> {
  const { db } = params;
  if (!isWellFormedActivationToken(params.token)) throw new AppError("NOT_FOUND");
  const company = typeof params.company === "string" ? params.company.trim() : "";
  if (company === "" || company.length > COMPANY_MAX || /[\u0000-\u001f\u007f]/.test(company)) throw new AppError("VALIDATION_FAILED");
  if (typeof params.workspaceName !== "string") throw new AppError("VALIDATION_FAILED");
  const slug = params.workspaceName.trim().toLowerCase();
  if (!WORKSPACE_RE.test(slug) || slug.length < WORKSPACE_NAME_MIN || slug.length > WORKSPACE_NAME_MAX) throw new AppError("VALIDATION_FAILED");
  if (RESERVED_SLUGS.has(slug)) throw nameTaken();
  if (typeof params.sample !== "boolean") throw new AppError("VALIDATION_FAILED");
  const sample = params.sample;
  const password = params.password;
  if (typeof password !== "string" || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) throw new AppError("VALIDATION_FAILED");
  const template = getTemplate(ACTIVATION_TEMPLATE_KEY);
  if (template === undefined) throw new AppError("INTERNAL");
  const hash = hashActivationToken(params.token);

  // Hesap açmadan önce ad (yaygın hata; yarış yine (3)'te yakalanır). Geçersiz bağlantı burada NOT_FOUND olur.
  const pre = await checkWorkspaceName({ db, token: params.token, name: slug });
  if (pre.slug !== slug) throw new AppError("VALIDATION_FAILED");
  if (pre.state !== "ok") throw nameTaken();

  // (1) Talep.
  let claimId: string;
  try {
    const rows = await withUser(db, PLATFORM_NO_USER_ID, (tx) =>
      tx.execute<{ claim: string }>(sql`SELECT wms_probe.platform_activation_claim(${hash}) AS claim`),
    );
    const c = rows[0]?.claim;
    if (typeof c !== "string" || !UUID_RE.test(c)) throw new AppError("INTERNAL");
    claimId = c;
  } catch (e) {
    throw mapActivationError(e);
  }

  try {
    // (2) Sahip hesabı (wms_auth). E-posta ve ad talepten okunur.
    const created = await deps.createActivatedAccount({ activationTokenHash: hash, claimId, password });
    if (!UUID_RE.test(created.userId)) throw new AppError("INTERNAL");
    const userId = created.userId;

    // (3) Tenant + ayarlar + deneme kaydı + hoş geldiniz işi: TEK transaction.
    return await withNewTenant(db, { userId, slug, name: company, creationRequestId: claimId }, async (tx, m) => {
      if (!m.created) throw new AppError("VERSION_CONFLICT", { retryable: true }); // tüketilmiş talep tekrar gelemez; tutarsız durum
      await initializeNewTenant(tx, m.tenantId, userId, slug, template, claimId, { source: "trial_activation", sample });
      const consumed = await tx.execute<{ trial_ends_at: Date | string }>(
        sql`SELECT wms_probe.platform_activation_consume(${hash}, ${claimId}::uuid, ${m.tenantId}::uuid, ${sample}) AS trial_ends_at`,
      );
      const rawEnd = consumed[0]?.trial_ends_at;
      if (rawEnd === undefined || rawEnd === null) throw new AppError("INTERNAL");
      const trialEndsAt = new Date(rawEnd);
      await appendAudit(tx, {
        action: "trial.started",
        actorUserId: userId,
        entityType: "tenant",
        entityId: m.tenantId,
        requestId: claimId,
        changeSummary: { plan: "TRIAL", trial_ends_at: trialEndsAt.toISOString(), sample },
      });
      const email = await tx.execute<{ email: string }>(sql`SELECT email FROM public.users WHERE id = ${userId}::uuid`);
      const ownerEmail = email[0]?.email;
      if (ownerEmail === undefined) throw new AppError("INTERNAL");
      let welcomeQueued = false;
      if (canDeliver(deps.mailConfig, ownerEmail)) {
        try {
          // Savepoint: kuyruk yazımı başarısız olursa aktivasyon bozulmaz; sonuç "gönderilmedi" der (sahte başarı yok).
          await tx.transaction((sp) => deps.queue.enqueue(sp, { type: "trial.welcome", actorUserId: userId, payload: {} }));
          welcomeQueued = true;
        } catch (cause) {
          const c = cause as { name?: unknown; code?: unknown } | null;
          deps.log?.({
            level: "error",
            msg: "trial.welcome enqueue failed",
            error: typeof c?.name === "string" ? c.name : "unknown",
            ...(typeof c?.code === "string" ? { code: c.code } : {}),
          });
        }
      }
      return { tenantId: m.tenantId, tenantSlug: slug, email: ownerEmail, trialEndsAt, welcomeQueued };
    });
  } catch (e) {
    // Talep bırakılır (kimlik korunur): kullanıcı adı düzeltip aynı bağlantıyla hemen yeniden deneyebilir.
    await withUser(db, PLATFORM_NO_USER_ID, (tx) => tx.execute(sql`SELECT wms_probe.platform_activation_release(${hash}, ${claimId}::uuid)`)).catch(
      () => undefined,
    );
    throw mapActivationError(e);
  }
}

// ---------------------------------------------------------------------------------------------
// Deneme bilgisi (tenant içi okuma) ve worker yardımcıları
// ---------------------------------------------------------------------------------------------

export interface TenantSubscription {
  readonly plan: "TRIAL";
  readonly trialEndsAt: Date;
}

/** Tenant transaction'ında (bağlam kurulmuş) çağrılır; kayıt yoksa `null`. */
export async function readTenantSubscription(tx: AccessTx): Promise<TenantSubscription | null> {
  const rows = await tx.execute<{ plan: string; trial_ends_at: Date | string | null }>(
    sql`SELECT plan, trial_ends_at FROM wms_probe.platform_tenant_subscription()`,
  );
  const r = rows[0];
  if (r === undefined || r.plan !== "TRIAL" || r.trial_ends_at === null) return null;
  return { plan: "TRIAL", trialEndsAt: new Date(r.trial_ends_at) };
}

export interface WelcomeMailData {
  readonly email: string;
  readonly company: string;
  readonly slug: string;
  readonly locale: "tr" | "en";
  readonly trialEndsAt: Date | null;
}

/** `trial.welcome` işi için (worker `ctx.inTenant`): sahibin e-postası, firma, adres, dil ve deneme bitişi. Sır yok. */
export async function readWelcomeMailData(tx: AccessTx): Promise<WelcomeMailData | null> {
  const rows = await tx.execute<{ email: string; name: string; slug: string; locale: string | null }>(
    sql`SELECT u.email, t.name, t.slug, s.locale
          FROM public.tenants t
          JOIN public.tenant_memberships m ON m.tenant_id = t.id AND m.is_owner AND m.status = 'ACTIVE'
          JOIN public.users u ON u.id = m.user_id
          LEFT JOIN public.tenant_settings s ON s.tenant_id = t.id
         WHERE t.id = NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid
         ORDER BY m.joined_at
         LIMIT 1`,
  );
  const r = rows[0];
  if (r === undefined) return null;
  const sub = await readTenantSubscription(tx);
  return { email: r.email, company: r.name, slug: r.slug, locale: r.locale === "en" ? "en" : "tr", trialEndsAt: sub?.trialEndsAt ?? null };
}

/** Worker (`wms_worker` bağlantısı): e-postayla teslim bekleyen bağlantıya yeni belirteç; geçerli değilse `null`. */
export async function prepareActivationDelivery(
  workerDb: AccessDbClient,
  demoRequestId: string,
): Promise<{ readonly email: string; readonly company: string; readonly token: string; readonly tokenHash: string } | null> {
  if (!UUID_RE.test(demoRequestId)) throw new AppError("VALIDATION_FAILED");
  const token = generateActivationToken();
  const tokenHash = hashActivationToken(token);
  const rows = await withUser(workerDb, PLATFORM_NO_USER_ID, (tx) =>
    tx.execute<{ email: string; company: string }>(
      sql`SELECT email, company FROM wms_probe.platform_prepare_activation_delivery(${demoRequestId}::uuid, ${tokenHash})`,
    ),
  );
  const r = rows[0];
  if (r === undefined) return null;
  return { email: r.email, company: r.company, token, tokenHash };
}
