// Panel işlem kaydı (T-408, ADR-027 §9; 0047). Kaynak `security_events` içindeki `platform.*` olayları (silinemez); okuma yalnız operatör
// (veritabanı listesi + MFA) `wms_probe.platform_list_events` ile. Dönen bilgi sınırlıdır: kullanıcı kimliği yerine yalnız "operatör mü
// sistem mi", ilgili firma ve paket adı, ayrıntının izinli anahtarları.
import { sql } from "drizzle-orm";
import { withUser } from "@wms/db";
import type { AccessDbClient, AccessPrincipal } from "../identity/access.ts";
import { mapPlatformError, principalOrThrow } from "./demo-requests.ts";

export interface PanelEvent {
  readonly at: Date;
  /** `platform.` önekli olay türü, ör. `platform.site.published`. */
  readonly kind: string;
  readonly byOperator: boolean;
  readonly company: string | null;
  readonly plan: string | null;
  readonly info: {
    readonly version?: number;
    readonly published?: boolean;
    readonly period?: string;
    readonly count?: number;
    readonly method?: string;
    readonly reason?: string;
    readonly trialEndsAt?: string;
    readonly delivery?: string;
  };
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export async function listPanelEvents(params: { readonly db: AccessDbClient; readonly principal: AccessPrincipal | null; readonly limit?: number }): Promise<readonly PanelEvent[]> {
  const principal = principalOrThrow(params.principal);
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? 100), 1), 200);
  try {
    const rows = await withUser(params.db, principal.userId, (tx) =>
      tx.execute<{ at: Date | string; kind: string; by_operator: boolean; company: string | null; plan: string | null; info: unknown }>(
        sql`SELECT * FROM wms_probe.platform_list_events(${limit}::int)`,
      ),
    );
    return rows.map((r) => {
      const i = (typeof r.info === "string" ? (JSON.parse(r.info) as unknown) : r.info) as Record<string, unknown> | null;
      const o = i ?? {};
      const info: Record<string, unknown> = {};
      const put = (k: string, v: unknown): void => {
        if (v !== undefined) info[k] = v;
      };
      put("version", num(o.version));
      put("published", typeof o.published === "boolean" ? o.published : undefined);
      put("period", str(o.period));
      put("count", num(o.count));
      put("method", str(o.method));
      put("reason", str(o.reason));
      put("trialEndsAt", str(o.trial_ends_at));
      put("delivery", str(o.delivery));
      return {
        at: r.at instanceof Date ? r.at : new Date(r.at),
        kind: r.kind,
        byOperator: r.by_operator === true,
        company: r.company,
        plan: r.plan,
        info: info as PanelEvent["info"],
      };
    });
  } catch (e) {
    throw mapPlatformError(e);
  }
}
