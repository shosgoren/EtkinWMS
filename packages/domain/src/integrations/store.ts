// ERP bağlantı satırı ve erişim belirteci (T-991). Web (bağlantıyı sına) ve worker (senkron) aynı yolu kullanır; çağıran transaction
// sarmalayıcısını verir (`runTx`: web'de yetkili üyelik transaction'ı, worker'da `withSystemTenant`).
//
// Belirteç yenileme TEK YAZARLIDIR: yenileme belirteci her kullanımda değişir (Paraşüt belgesi). Erişim belirtecinin süresi dolduysa satır
// `FOR UPDATE` ile kilitlenir, kilit altında yeniden okunur (başkası yenilediyse yeni belirteç kullanılır) ve yalnız gerekiyorsa sağlayıcıya
// gidilir; yeni kutu aynı transaction'da yazılır. Kilit en çok bir HTTP çağrısı sürer: yenileme isteği pencere beklemesi ve 429 yeniden denemesi
// yapmaz (`lockSafe`), zaman aşımı 15 sn; iki saatte bir gerekir. Commit yenilemeden sonra düşerse dönmüş belirteç kaybolur → REAUTH_REQUIRED
// (nadir; müşteri yeniden bağlanır, veri kaybı yok).
// Sağlayıcı yenilemeyi reddederse bağlantı ERROR + `REAUTH_REQUIRED` olur (müşteri yeniden bağlanır); sır loga/hataya girmez.
import { sql } from "drizzle-orm";
import { SealOpenError, type Sealer } from "@wms/shared/seal";
import type { AccessTx } from "../identity/access.ts";
import type { Provider } from "./catalog.ts";
import { ProviderError, type ParasutClient } from "./parasut.ts";
import { openSecrets, sealSecrets, SecretsShapeError } from "./secrets.ts";

export type IntegrationStatus = "CONNECTED" | "ERROR" | "DISCONNECTED";

export interface IntegrationRow {
  readonly id: string;
  readonly provider: Provider;
  readonly status: IntegrationStatus;
  readonly accountLabel: string | null;
  readonly accountRef: string | null;
  readonly credentials: unknown;
  readonly connectedBy: string | null;
  readonly connectedMembershipId: string | null;
  readonly connectedAt: Date | null;
  readonly lastCheckedAt: Date | null;
  readonly lastErrorCode: string | null;
}

type Raw = {
  id: string;
  provider: Provider;
  status: IntegrationStatus;
  account_label: string | null;
  account_ref: string | null;
  credentials: unknown;
  connected_by: string | null;
  connected_membership_id: string | null;
  connected_at: Date | string | null;
  last_checked_at: Date | string | null;
  last_error_code: string | null;
};
const COLS = sql`id, provider, status, account_label, account_ref, credentials, connected_by, connected_membership_id, connected_at, last_checked_at, last_error_code`;
const d = (v: Date | string | null): Date | null => (v === null ? null : new Date(v));
const toRow = (r: Raw): IntegrationRow => ({
  id: r.id,
  provider: r.provider,
  status: r.status,
  accountLabel: r.account_label,
  accountRef: r.account_ref,
  credentials: r.credentials,
  connectedBy: r.connected_by,
  connectedMembershipId: r.connected_membership_id,
  connectedAt: d(r.connected_at),
  lastCheckedAt: d(r.last_checked_at),
  lastErrorCode: r.last_error_code,
});

export async function loadIntegration(tx: AccessTx, tenantId: string, by: { readonly provider: Provider } | { readonly id: string }, lock = false): Promise<IntegrationRow | null> {
  const where = "provider" in by ? sql`provider = ${by.provider}` : sql`id = ${by.id}::uuid`;
  const r = await tx.execute<Raw>(
    sql`SELECT ${COLS} FROM public.integrations WHERE tenant_id = ${tenantId}::uuid AND ${where} ${lock ? sql`FOR UPDATE` : sql``}`,
  );
  return r[0] === undefined ? null : toRow(r[0]);
}

export async function markIntegrationError(tx: AccessTx, tenantId: string, integrationId: string, code: string): Promise<void> {
  await tx.execute(
    sql`UPDATE public.integrations SET status = 'ERROR', last_error_code = ${code} WHERE tenant_id = ${tenantId}::uuid AND id = ${integrationId}::uuid AND status <> 'DISCONNECTED'`,
  );
}

/** Bağlantı kullanılamıyor (kesilmiş, mühür açılmıyor, yeniden bağlanma gerekiyor). Yalnız sabit kod. */
export class IntegrationStateError extends Error {
  override name = "IntegrationStateError";
  readonly code: "NOT_CONNECTED" | "REAUTH_REQUIRED" | "SECRET_UNREADABLE";
  constructor(code: "NOT_CONNECTED" | "REAUTH_REQUIRED" | "SECRET_UNREADABLE") {
    super(`integration unavailable (${code})`);
    this.code = code;
  }
}

export type RunTx = <T>(fn: (tx: AccessTx) => Promise<T>) => Promise<T>;

export interface TokenDeps {
  readonly runTx: RunTx;
  readonly tenantId: string;
  readonly integrationId: string;
  readonly client: ParasutClient;
  readonly sealer: Sealer;
  readonly now?: () => number;
  /** Belirtecin en az bu kadar daha geçerli olması istenir; değilse yenilenir (senkron: işin en uzun süresi). Varsayılan 30 sn. */
  readonly minValidityMs?: number;
}

function open(deps: TokenDeps, row: IntegrationRow) {
  try {
    return openSecrets(deps.sealer, deps.tenantId, row.provider, row.credentials);
  } catch (e) {
    if (e instanceof SealOpenError || e instanceof SecretsShapeError) return null;
    throw e;
  }
}

/** Geçerli erişim belirteci + şirket numarası. Gerekirse kilit altında yeniler (tek yazar). */
export async function accessToken(deps: TokenDeps): Promise<{ readonly token: string; readonly accountRef: string }> {
  const now = deps.now ?? (() => Date.now());
  const fresh = (exp: string): boolean => Number(exp) > now() + (deps.minValidityMs ?? 30_000);
  const row = await deps.runTx((tx) => loadIntegration(tx, deps.tenantId, { id: deps.integrationId }));
  if (row === null || row.status === "DISCONNECTED" || row.accountRef === null) throw new IntegrationStateError("NOT_CONNECTED");
  const s = open(deps, row);
  if (s === null) {
    await deps.runTx((tx) => markIntegrationError(tx, deps.tenantId, row.id, "SECRET_UNREADABLE"));
    throw new IntegrationStateError("SECRET_UNREADABLE");
  }
  if (fresh(s.accessExpiresAt)) return { token: s.accessToken, accountRef: row.accountRef };
  const result = await deps.runTx(async (tx) => {
    const cur = await loadIntegration(tx, deps.tenantId, { id: deps.integrationId }, true);
    if (cur === null || cur.status === "DISCONNECTED" || cur.accountRef === null) return { kind: "state" as const, code: "NOT_CONNECTED" as const };
    const s2 = open(deps, cur);
    if (s2 === null) {
      await markIntegrationError(tx, deps.tenantId, cur.id, "SECRET_UNREADABLE");
      return { kind: "state" as const, code: "SECRET_UNREADABLE" as const };
    }
    if (fresh(s2.accessExpiresAt)) return { kind: "ok" as const, token: s2.accessToken, accountRef: cur.accountRef };
    try {
      const t = await deps.client.refreshGrant({ clientId: s2.clientId, clientSecret: s2.clientSecret, refreshToken: s2.refreshToken });
      const box = sealSecrets(deps.sealer, deps.tenantId, cur.provider, { ...s2, refreshToken: t.refreshToken, accessToken: t.accessToken, accessExpiresAt: String(t.expiresAt) });
      await tx.execute(sql`UPDATE public.integrations SET credentials = ${JSON.stringify(box)}::jsonb WHERE tenant_id = ${deps.tenantId}::uuid AND id = ${cur.id}::uuid`);
      return { kind: "ok" as const, token: t.accessToken, accountRef: cur.accountRef };
    } catch (e) {
      if (e instanceof ProviderError && e.code === "AUTH_FAILED") {
        await markIntegrationError(tx, deps.tenantId, cur.id, "REAUTH_REQUIRED");
        return { kind: "state" as const, code: "REAUTH_REQUIRED" as const };
      }
      throw e;
    }
  });
  if (result.kind === "state") throw new IntegrationStateError(result.code);
  return { token: result.token, accountRef: result.accountRef };
}
