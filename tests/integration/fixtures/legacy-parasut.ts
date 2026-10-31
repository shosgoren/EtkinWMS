// T-1139: "eski yöntem" (e-posta + parola) biçimli Paraşüt bağlantısı — YALNIZ migration 0068 ve geri uyum testleri için. Kod artık böyle bir
// bağlantı kuramaz (parola yolu kaldırıldı); canlıdaki eski satırın biçimi doğrudan DB'ye yazılır: CONNECTED + mühürlü kimlik kutusu
// (OAuth bağlantısıyla aynı şekil), bağlayan sahip, `connected_at` ve bağlanma anına denk gelen TAMAMLANMIŞ OAuth denemesi YOK. İsteğe bağlı
// açık akışlar ve ACTIVE webhook satırları (mühürlü anahtar). Tablo sahibi FORCE RLS altında olduğu için yazım tenant bağlamında yapılır.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { Sealer } from "../../../packages/shared/src/seal.ts";
import { FLOWS, defaultDirection, type Flow } from "../../../packages/domain/src/integrations/catalog.ts";
import { sealSecrets } from "../../../packages/domain/src/integrations/secrets.ts";
import { newWebhookKey, sealWebhookKey } from "../../../packages/domain/src/integrations/webhook.ts";
import type { TenantWorld } from "./tenants.ts";

export interface LegacySeed {
  readonly companyId?: string;
  readonly label?: string;
  /** Açık akışlar (varsayılan yönle). */
  readonly flowsOn?: readonly Flow[];
  /** ACTIVE webhook satırları (ürün × create/update) ve bağlantıda webhook_status ACTIVE. */
  readonly webhooks?: boolean;
  /** Bağlantı ERROR (ör. yenileme reddi) — eski yöntem bağlantısı hata durumunda da kesilir. */
  readonly status?: "CONNECTED" | "ERROR";
}

async function inTenant<T>(adm: pg.Client, tenantId: string, fn: () => Promise<T>): Promise<T> {
  await adm.query("BEGIN");
  try {
    await adm.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
    const r = await fn();
    await adm.query("COMMIT");
    return r;
  } catch (e) {
    await adm.query("ROLLBACK");
    throw e;
  }
}

/** Eski yöntem biçimli bağlantıyı yazar; bağlantı kimliğini döndürür. */
export async function seedLegacyParasutConnection(adm: pg.Client, w: TenantWorld, sealer: Sealer, seed: LegacySeed = {}): Promise<string> {
  const id = randomUUID();
  const box = sealSecrets(sealer, w.tenantId, "PARASUT", { clientId: "legacy-client", clientSecret: "legacy-client-secret", refreshToken: "legacy-refresh", accessToken: "legacy-access", accessExpiresAt: String(Date.now() + 3_600_000) });
  await inTenant(adm, w.tenantId, async () => {
    await adm.query(
      `INSERT INTO public.integrations (tenant_id, id, provider, status, account_label, account_ref, credentials, connected_by, connected_membership_id, connected_at, last_checked_at, last_error_code)
       VALUES ($1, $2, 'PARASUT', $3, $4, $5, $6::jsonb, $7, $8, now() - interval '3 days', now(), $9)`,
      [w.tenantId, id, seed.status ?? "CONNECTED", seed.label ?? "Eski Muhasebe", seed.companyId ?? "115", JSON.stringify(box), w.ownerUserId, w.ownerMembershipId, seed.status === "ERROR" ? "REAUTH_REQUIRED" : null],
    );
    for (const flow of FLOWS) {
      await adm.query("INSERT INTO public.integration_flows (tenant_id, integration_id, flow, enabled, direction) VALUES ($1, $2, $3, $4, $5)", [
        w.tenantId,
        id,
        flow,
        (seed.flowsOn ?? []).includes(flow),
        defaultDirection("PARASUT", flow),
      ]);
    }
    if (seed.webhooks === true) {
      const key = newWebhookKey();
      for (const action of ["create", "update"]) {
        await adm.query("INSERT INTO public.integration_webhooks (tenant_id, integration_id, model, action, external_id, key_box, status) VALUES ($1, $2, 'product', $3, $4, $5::jsonb, 'ACTIVE')", [
          w.tenantId,
          id,
          action,
          `${9000 + (action === "create" ? 1 : 2)}`,
          JSON.stringify(sealWebhookKey(sealer, w.tenantId, key)),
        ]);
      }
      await adm.query("UPDATE public.integrations SET webhook_status = 'ACTIVE', webhook_checked_at = now() WHERE tenant_id = $1 AND id = $2", [w.tenantId, id]);
    }
  });
  return id;
}
