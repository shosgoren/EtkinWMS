// T-1201 (kullanıcı kararı 1 Kasım 2026): "Paraşüt'ten al" seçili bölümde (ürün kartları / cariler / depolar) kaynak Paraşüt'tür, Etkin ona
// uyar; buradan gitmez. Bu dosya kuralın TEK domain uygulamasıdır; katalog/depo komutları ve aktarım yolları buradan çağırır:
//   - Bölüm "yönetilir" (managed) = bağlantı kesilmemiş (status <> DISCONNECTED) bir sağlayıcıda bu bölümün akışı AÇIK ve yönü PULL.
//     PUSH / BOTH / kapalı akış (Yalnız Etkin WMS) → kural yok, bugünkü gibi her şey açık.
//   - Yönetilen bölümde: yeni kart AÇILMAZ (`SOURCE_MANAGED_CREATE`); sağlayıcıya bağlı (`external_refs`) kartta sağlayıcının yazdığı alanlar
//     değişmez (`SOURCE_MANAGED_FIELD`) ve kart arşivlenmez / geri açılmaz (`SOURCE_MANAGED_ARCHIVE`). Bağsız yerel kart ve Etkin'e özgü
//     alanlar (raf yerleri, görsel, min/maks, barkod, birim dönüşümü, toplama kuralı, takip modu, hassasiyet, kart türü, teslimat) açık kalır.
//   - Entegrasyonun kendi yazımı (apply.ts / card-lifecycle.ts, `via: integration`) bu komutları ÇAĞIRMAZ, doğrudan SQL yazar: PULL'da
//     doğruluk kaynağı odur ve engellenmez.
// Yarış: komut transaction'ında akış satırları `FOR SHARE` kilitlenir (T-1140 `guardFlow` / `webhookWriteAllowed` ile aynı kilit). Eşzamanlı yön
// değişikliği (`setIntegrationFlow` satırı FOR UPDATE alır) bu transaction bitene kadar bekler; ya da önce o commit olur ve biz yeni yönü okuruz
// (READ COMMITTED). Kart satırı kilidi bundan SONRA alınır (sıra: üyelik → akış → kart; eşitleme de akış → kart sırasındadır).
// Bağımlılığı yalnız SQL + saf katalog verisidir (source-archive.ts gibi): katalog/depo komutları entegrasyon modül zincirini içe aktarmaz.
import { sql } from "drizzle-orm";
import { AppError } from "@wms/shared/errors";
import { runTenantQuery, type AccessTx, type TenantAccessParams } from "../identity/access.ts";
import { PROVIDER_INFO, PROVIDERS, type Flow, type Provider } from "./catalog.ts";
import { hasPermission } from "../identity/permissions.ts";

export type SourceCard = "ITEM" | "PARTY" | "WAREHOUSE";
export const SOURCE_FLOW: Readonly<Record<SourceCard, Flow>> = Object.freeze({ ITEM: "PRODUCTS", PARTY: "CONTACTS", WAREHOUSE: "WAREHOUSES" });

/**
 * Sağlayıcının bağlı kartta yazdığı alanlar (apply.ts `applyProduct` / `applyContact` / `applyWarehouse` ile birebir; card-sync.ts kanonik alanları
 * + kod). Ürün kodu ve depo kodu kart açılırken Paraşüt'ten gelir; cari kodu Paraşüt kimliğinden türetilir (`PRS-…`) ve eşleme anahtarıdır.
 * Cari türü eşitlemede birleştirilir (müşteri + tedarikçi → ikisi). Ürünün temel birimi her yönde kilitlidir (T-1129, `updateItem`).
 */
export const SOURCE_OWNED_FIELDS = Object.freeze({
  ITEM: ["code", "name"],
  PARTY: ["code", "name", "kind", "taxNo", "taxOffice", "phone", "email", "city", "district", "address", "shortName"],
  WAREHOUSE: ["code", "name"],
} as const satisfies Record<SourceCard, readonly string[]>);
export type SourceOwnedField<C extends SourceCard> = (typeof SOURCE_OWNED_FIELDS)[C][number];

export interface SourceRule {
  /** Bölüm sağlayıcıdan yönetiliyor (akış açık + PULL + bağlantı kesilmemiş). */
  readonly managed: boolean;
  /** Yöneten sağlayıcı (yoksa null). */
  readonly provider: Provider | null;
  /** Yöneten sağlayıcıların `external_refs.system` değerleri. */
  readonly systems: readonly string[];
}

const UNMANAGED: SourceRule = Object.freeze({ managed: false, provider: null, systems: Object.freeze([]) });

const isProvider = (p: string): p is Provider => (PROVIDERS as readonly string[]).includes(p);

/**
 * Bölümün kuralı. `lock: true` → akış satırları `FOR SHARE` (yazan komutlar bunu kullanır; okuyan ekranlar kilitsiz okur). Kiracı süzgeci açık
 * + RLS (I-01, I-02).
 */
export async function readSourceRule(tx: AccessTx, tenantId: string, card: SourceCard, opts: { readonly lock: boolean }): Promise<SourceRule> {
  const flow = SOURCE_FLOW[card];
  const rows = await tx.execute<{ provider: string; pull: boolean }>(sql`
    SELECT i.provider, (f.enabled AND f.direction = 'PULL' AND i.status <> 'DISCONNECTED') AS pull
      FROM public.integration_flows f
      JOIN public.integrations i ON i.tenant_id = f.tenant_id AND i.id = f.integration_id
     WHERE f.tenant_id = ${tenantId}::uuid AND f.flow = ${flow}
     ORDER BY f.id ${opts.lock ? sql`FOR SHARE OF f` : sql``}`);
  const providers = rows.filter((r) => r.pull === true && isProvider(r.provider)).map((r) => r.provider as Provider);
  if (providers.length === 0) return UNMANAGED;
  return { managed: true, provider: providers[0] ?? null, systems: providers.map((p) => PROVIDER_INFO[p].system) };
}

/** Kart yöneten sağlayıcıya bağlı mı (kural yönetilmiyorsa her zaman false). */
export async function sourceLinked(tx: AccessTx, tenantId: string, card: SourceCard, entityId: string, rule: SourceRule): Promise<boolean> {
  if (!rule.managed || rule.systems.length === 0) return false;
  const r = await tx.execute<{ one: number }>(sql`
    SELECT 1 AS one FROM public.external_refs
     WHERE tenant_id = ${tenantId}::uuid AND entity_type = ${card} AND entity_id = ${entityId}::uuid
       AND system IN (${sql.join(rule.systems.map((s) => sql`${s}`), sql`, `)})
     LIMIT 1`);
  return r.length > 0;
}

/** Verilen kartlardan yöneten sağlayıcıya bağlı olanlar (liste/aktarım için tek sorgu; küçük harf kimlik). */
export async function sourceLinkedIds(tx: AccessTx, tenantId: string, card: SourceCard, rule: SourceRule, ids?: readonly string[]): Promise<ReadonlySet<string>> {
  if (!rule.managed || rule.systems.length === 0 || (ids !== undefined && ids.length === 0)) return new Set();
  const only = ids === undefined ? sql`` : sql`AND entity_id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`;
  const r = await tx.execute<{ entity_id: string }>(sql`
    SELECT entity_id FROM public.external_refs
     WHERE tenant_id = ${tenantId}::uuid AND entity_type = ${card} AND system IN (${sql.join(rule.systems.map((s) => sql`${s}`), sql`, `)}) ${only}`);
  return new Set(r.map((x) => String(x.entity_id).toLowerCase()));
}

export type SourceManagedCase = "CREATE" | "FIELD" | "ARCHIVE";

export function sourceManagedError(what: SourceManagedCase): AppError {
  return new AppError("VALIDATION_FAILED", { detail: `SOURCE_MANAGED_${what}` as const });
}

export function isSourceManaged(e: unknown): boolean {
  return e instanceof AppError && typeof e.detail === "string" && e.detail.startsWith("SOURCE_MANAGED_");
}

/** Yeni kart komutu: yönetilen bölümde reddedilir. Kilitli okuma (komut transaction'ında çağrılır). */
export async function assertSourceCreateAllowed(tx: AccessTx, tenantId: string, card: SourceCard): Promise<void> {
  const rule = await readSourceRule(tx, tenantId, card, { lock: true });
  if (rule.managed) throw sourceManagedError("CREATE");
}

/** Ekran gösterimi (yalnız okuma; karar yine komutta): bölüm kuralı + istenirse tek kartın bağlılığı. */
export interface SourceLockView {
  readonly managed: boolean;
  readonly provider: Provider | null;
  readonly linked: boolean;
}

export async function readSourceLockView(tx: AccessTx, tenantId: string, card: SourceCard, entityId?: string): Promise<SourceLockView> {
  const rule = await readSourceRule(tx, tenantId, card, { lock: false });
  const linked = entityId === undefined ? false : await sourceLinked(tx, tenantId, card, entityId, rule);
  return { managed: rule.managed, provider: rule.provider, linked };
}

type QueryParams = Omit<TenantAccessParams, "permission" | "recentAuth">;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ekran kilidi + "Şimdi eşitle" düğmesi gösterilsin mi (eşitlemeyi başlatma `settings.manage`; karar yine `requestIntegrationRun`'da). */
export interface SourceLockScreen extends SourceLockView {
  readonly canSync: boolean;
}

/** Ekran: bölüm kuralı ve (verilirse) kartın bağlılığı. Okuma `stock.view` (kartı görebilen görür); geçersiz kimlik `VALIDATION_FAILED`. */
export async function getSourceLock(params: QueryParams, card: SourceCard, entityId?: string): Promise<SourceLockScreen> {
  if (entityId !== undefined && !UUID_RE.test(entityId)) throw new AppError("VALIDATION_FAILED");
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, m) => ({
    ...(await readSourceLockView(tx, m.tenantId, card, entityId)),
    canSync: hasPermission(m.roles, "settings.manage", m.grants),
  }));
}

/** Ekran listesi: verilen kartlardan yöneten sağlayıcıya bağlı olanlar (bölüm yönetilmiyorsa boş). En çok 500 kimlik. */
export async function getSourceLinkedIds(params: QueryParams, card: SourceCard, ids: readonly string[]): Promise<readonly string[]> {
  if (ids.length > 500 || ids.some((id) => !UUID_RE.test(id))) throw new AppError("VALIDATION_FAILED");
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, m) => {
    const rule = await readSourceRule(tx, m.tenantId, card, { lock: false });
    return [...(await sourceLinkedIds(tx, m.tenantId, card, rule, ids))];
  });
}
