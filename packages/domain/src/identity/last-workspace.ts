// T-999 (ADR-026 §6, 0048): girişten sonraki yönlendirme ve son kullanılan çalışma alanı. Kayıt sunucuda, üyelik satırında
// (`tenant_memberships.last_used_at`); tarayıcıda alan bilgisi tutulmaz. Girişten önce kiracı keşfi yoktur: karar yalnız oturumlu
// kullanıcının kendi AKTİF üyeliklerinden (`getMembershipSummary`) verilir; `/t/<alan>` girişi üyeliği her istekte yeniden doğrular.
import { sql } from "drizzle-orm";
import type { AccessTx, Membership } from "./access.ts";
import type { MembershipSummary } from "./member-queries.ts";

export type Landing =
  | { readonly kind: "onboarding" }
  | { readonly kind: "workspace"; readonly slug: string }
  | { readonly kind: "pick" };

/**
 * Oturumlu kullanıcının açılış hedefi: üyelik yok → kurulum; tek üyelik → o alan; birden çok → son kullanılan (listede, yani hâlâ aktif
 * ve erişilebilir) alan, yoksa seçici.
 */
export function landingFor(summary: Pick<MembershipSummary, "memberships" | "lastSlug">): Landing {
  const list = summary.memberships;
  const only = list.length === 1 ? list[0] : undefined;
  if (only !== undefined) return { kind: "workspace", slug: only.slug };
  if (list.length === 0) return { kind: "onboarding" };
  const last = summary.lastSlug === null ? undefined : list.find((m) => m.slug === summary.lastSlug);
  return last === undefined ? { kind: "pick" } : { kind: "workspace", slug: last.slug };
}

const FRESH_MS = 5 * 60_000;

/**
 * Kabuğun yazma kararı (özetten, ek sorgu yok): alan "son" değilse her zaman, "son" ise kaydı 5 dakikadan eskiyse yazılır. Böylece her
 * sayfa isteğinde satır güncellenmez; alan değişimi hemen "son" olur.
 */
export function needsMark(summary: Pick<MembershipSummary, "memberships" | "lastSlug">, slug: string, now: Date): boolean {
  const current = summary.memberships.find((m) => m.slug === slug);
  if (current === undefined) return false;
  if (summary.lastSlug !== slug || current.lastUsedAt === null) return true;
  return now.getTime() - current.lastUsedAt.getTime() >= FRESH_MS;
}

/**
 * Tenant bağlamında (üyelik + izin doğrulanmış transaction; RLS `tenant_memberships_isolation`) yalnız çağıranın kendi AKTİF satırı.
 * Bilgi amaçlıdır: kimlik/yetki kararına girmez.
 */
export async function markWorkspaceUsed(tx: AccessTx, membership: Membership): Promise<void> {
  await tx.execute(sql`
    UPDATE public.tenant_memberships SET last_used_at = now()
     WHERE id = ${membership.membershipId}::uuid AND user_id = ${membership.userId}::uuid AND status = 'ACTIVE'`);
}
