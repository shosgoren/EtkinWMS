// ERP'den BİR KEZLİK açılış stoku (T-1006; kullanıcı kararı 22 Ekim, parametrik). İstisna yolu: I-04 gereği ERP'den stok hiçbir senkron
// akışında Etkin'e yazılmaz (0055 yön kuralı STOCK = yalnız PUSH, değişmedi). Tek istisna burasıdır ve yalnız bir kez çalışır:
//
// - Ayar: `integrations.opening_stock_enabled` (Entegrasyon ekranı "Açılış stokunu Paraşüt'ten al", varsayılan KAPALI). Yolculuk adım 1'deki
//   "Mevcut stok miktarlarını da alalım mı?" sorusu bu ayarı açar ("Evet") ya da kapalı bırakır ("Hayır").
// - Çekme: ayar açık ve bu tenant'ta hiç açılış stoku alınmadıysa. Ağ çağrıları (belirteç, ürün sayfaları) transaction DIŞINDA; stok tek
//   `executeStockCommand` transaction'ında domain komutuyla yazılır (G-01: `planFieldPosting` → `acquireStockLocks` (I-15, plan önceden tam)
//   → kilit altında yeniden denetim → `postFieldDocument` STOCK_IN, neden `integration.opening_stock`) ve AYNI transaction'da kilit
//   (`opening_stock_taken_at` + belge) yazılır. Kilit DB'dedir (0056 tetikleyicisi + tenant başına tekil indeks): ikinci çekme, eşzamanlı çekme ve
//   ayar kapalıyken çekme reddedilir; alınmış kayıt geri alınamaz. Her deneme yeni idempotency anahtarı taşır (I-06; import-apply.ts ile aynı
//   gerekçe: kalıcı RED tekrar etmesin), tekillik durum tabanlıdır.
// - Satır kuralı (açılış stoku dosyasıyla aynı): yalnız Paraşüt eşlemesi olan (external_refs ITEM), etkin, izlemesiz (lot/seri yok) ve HİÇ
//   stoğu olmayan ürün; miktar > 0, ürünün ondalık hassasiyetine uyan. Diğerleri sayılır ve raporlanır (sahte başarı yok). Tek belge en çok
//   `SYNC_POST_MAX_LINES` (200) satır; fazlası `TOO_MANY` (Excel açılış stoku şablonu önerilir).
// - Yetki: `settings.manage` (yalnız TENANT_ADMIN) + `document.create` + `document.approve` + `stock.post` (oluştur + onayla + işle tek
//   komutta; import-apply.ts T-421 kuralı). Demo alanında reddedilir. Audit: ayar değişimi ve alındı (belge kimliği + satır sayısı).
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { appendAudit } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { SealConfigError, type Sealer } from "@wms/shared/seal";
import { runTenantCommand, runTenantQuery, type AccessTx, type TenantAccessParams } from "../identity/access.ts";
import { executeStockCommand, SYNC_POST_MAX_LINES, type StockCommandResult } from "../stock/index.ts";
import { DECIMAL_RE, planFieldPosting, postFieldDocument, uuidOf, type FieldLine, type FieldPostSpec } from "../operations/field-posting.ts";
import { pgUuidArray } from "../warehouse/scope.ts";
import { parseProvider } from "./catalog.ts";
import { ParasutClient, ProviderError, type JsonApiResource, type ProviderErrorCode } from "./parasut.ts";
import { integrationSealer } from "./secrets.ts";
import { IntegrationStateError, accessToken, loadIntegration } from "./store.ts";

export const OPENING_STOCK_REASON = "integration.opening_stock";
export const OPENING_STOCK_COMMAND = "integration.opening_stock";
/** Ürün sayfası üst sınırı (25 × 80 = 2000 ürün; hız sınırı 10 istek / 10 sn). */
export const OPENING_PAGES_MAX = 80;
export const OPENING_MAX_LINES = SYNC_POST_MAX_LINES;

type CallParams = Omit<TenantAccessParams, "permission">;

export interface OpeningStockDeps {
  readonly client?: ParasutClient;
  readonly sealer?: Sealer;
}

export interface OpeningLocation {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly warehouse: string;
}

export interface OpeningStockState {
  readonly enabled: boolean;
  readonly takenAt: Date | null;
  /** Stokun yazılabileceği raflar (etkin depoda kabul/depolama rafı; en çok `OPENING_LOCATIONS_MAX`, koda göre). */
  readonly locations: readonly OpeningLocation[];
}

export const OPENING_LOCATIONS_MAX = 200;

export type OpeningSettingResult =
  | { readonly ok: true; readonly enabled: boolean; readonly changed: boolean }
  | { readonly ok: false; readonly reason: "NOT_CONNECTED" | "ALREADY_TAKEN" | "DEMO" };

async function isDemo(tx: AccessTx, tenantId: string): Promise<boolean> {
  const r = await tx.execute<{ is_demo: boolean }>(sql`SELECT is_demo FROM public.tenants WHERE id = ${tenantId}::uuid`);
  return r[0]?.is_demo === true;
}

/** Ekran okuması (`settings.manage`): ayar + alındı zamanı. Bağlantı yoksa `null`. */
export async function getOpeningStockState(params: CallParams, input: { readonly provider: string }): Promise<OpeningStockState | null> {
  const provider = parseProvider(input.provider);
  return runTenantQuery({ ...params, permission: "settings.manage" }, async (tx, m) => {
    const r = await tx.execute<{ status: string; opening_stock_enabled: boolean; opening_stock_taken_at: Date | string | null }>(
      sql`SELECT status, opening_stock_enabled, opening_stock_taken_at FROM public.integrations WHERE tenant_id = ${m.tenantId}::uuid AND provider = ${provider}`,
    );
    const row = r[0];
    if (row === undefined || row.status === "DISCONNECTED") return null;
    const locs = await tx.execute<{ id: string; code: string; name: string; warehouse: string }>(sql`
      SELECT l.id, l.code, l.name, w.name AS warehouse FROM public.locations l JOIN public.warehouses w ON w.tenant_id = l.tenant_id AND w.id = l.warehouse_id
       WHERE l.tenant_id = ${m.tenantId}::uuid AND l.status = 'ACTIVE' AND w.status = 'ACTIVE' AND l.kind IN ('RECEIVING', 'STORAGE') AND NOT l.is_sample
       ORDER BY l.kind = 'RECEIVING' DESC, w.code, l.code LIMIT ${OPENING_LOCATIONS_MAX}`);
    return {
      enabled: row.opening_stock_enabled,
      takenAt: row.opening_stock_taken_at === null ? null : new Date(row.opening_stock_taken_at),
      locations: locs.map((x) => ({ id: x.id, code: x.code, name: x.name, warehouse: x.warehouse })),
    };
  });
}

/** "Açılış stokunu Paraşüt'ten al" ayarı. Alındıktan sonra değiştirilemez (`ALREADY_TAKEN`). */
export async function setOpeningStockSetting(
  params: CallParams,
  input: { readonly provider: string; readonly enabled: boolean; readonly requestId?: string | null; /** Ayar kurulum yolculuğu cevabından mı (audit). */ readonly via?: "journey" },
): Promise<OpeningSettingResult> {
  const provider = parseProvider(input.provider);
  if (typeof input.enabled !== "boolean") throw new AppError("VALIDATION_FAILED");
  if (input.via !== undefined && input.via !== "journey") throw new AppError("VALIDATION_FAILED");
  return runTenantCommand({ ...params, permission: "settings.manage" }, async (tx, m) => {
    if (await isDemo(tx, m.tenantId)) return { ok: false, reason: "DEMO" } as const;
    const row = await loadIntegration(tx, m.tenantId, { provider }, true);
    if (row === null || row.status === "DISCONNECTED") return { ok: false, reason: "NOT_CONNECTED" } as const;
    const cur = await tx.execute<{ opening_stock_enabled: boolean; opening_stock_taken_at: Date | string | null }>(
      sql`SELECT opening_stock_enabled, opening_stock_taken_at FROM public.integrations WHERE tenant_id = ${m.tenantId}::uuid AND id = ${row.id}::uuid`,
    );
    const before = cur[0];
    if (before === undefined) return { ok: false, reason: "NOT_CONNECTED" } as const;
    if (before.opening_stock_taken_at !== null) return { ok: false, reason: "ALREADY_TAKEN" } as const;
    if (before.opening_stock_enabled === input.enabled) return { ok: true, enabled: input.enabled, changed: false } as const;
    await tx.execute(sql`UPDATE public.integrations SET opening_stock_enabled = ${input.enabled} WHERE tenant_id = ${m.tenantId}::uuid AND id = ${row.id}::uuid`);
    await appendAudit(tx, {
      action: "integration.opening_stock_setting",
      actorUserId: m.userId,
      entityType: "integration",
      entityId: row.id,
      requestId: input.requestId ?? null,
      changeSummary: { provider, enabled: input.enabled, ...(input.via === undefined ? {} : { via: input.via }) },
    });
    return { ok: true, enabled: input.enabled, changed: true } as const;
  });
}

export type OpeningPullReason =
  | "NOT_CONNECTED"
  | "DEMO"
  | "DISABLED"
  | "ALREADY_TAKEN"
  | "LOCATION_INVALID"
  | "NOTHING"
  | "TOO_MANY"
  | "PAIR_HAS_STOCK"
  | ProviderErrorCode
  | IntegrationStateError["code"];

export interface OpeningSkipCounts {
  /** Etkin'de eşlemesi olmayan Paraşüt ürünü (önce "Ürün kartları" akışı). */
  readonly unlinked: number;
  /** Etkin'de zaten stoğu olan ürün (iki kez sayılmaz). */
  readonly hasStock: number;
  /** Lot/seri izlemeli, arşivlenmiş ya da örnek ürün. */
  readonly unsupported: number;
  /** Okunamayan ya da hassasiyete uymayan miktar. */
  readonly invalid: number;
}

export type OpeningPullResult =
  | { readonly ok: true; readonly documentId: string; readonly documentNumber: string | null; readonly lines: number; readonly skipped: OpeningSkipCounts; readonly takenAt: Date }
  | { readonly ok: false; readonly reason: OpeningPullReason; readonly skipped?: OpeningSkipCounts };

/** Sağlayıcının stok miktarı (Paraşüt v4 ürün `stock_count`; sayı ya da sayı dizgisi). Negatif / okunamayan → `null`. */
export function providerQuantity(r: JsonApiResource): string | null {
  if (r.attributes.inventory_tracking === false) return null;
  const raw = r.attributes.stock_count;
  const s = typeof raw === "number" && Number.isFinite(raw) ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!/^\d{1,14}(\.\d{1,12})?$/.test(s)) return null;
  const [int = "0", frac = ""] = s.split(".");
  const f = frac.replace(/0+$/, "");
  if (f.length > 6) return null;
  const v = f === "" ? String(BigInt(int)) : `${BigInt(int)}.${f}`;
  return DECIMAL_RE.test(v) ? v : null;
}

/** Kilit altında yeniden denetimde koşul bozuldu: hiçbir şey yazılmaz (transaction geri alınır). */
class OpeningConflictError extends AppError {
  override name = "OpeningConflictError";
  readonly reason: OpeningPullReason;
  constructor(reason: OpeningPullReason) {
    super("VALIDATION_FAILED");
    this.reason = reason;
  }
}

/** Hata zincirindeki ilk SQLSTATE ve kısıt adı (sürücü hatası `cause` içinde olabilir). */
export function sqlstateIn(e: unknown): { readonly code: string; readonly constraint: string | null } | null {
  let cur: unknown = e;
  for (let i = 0; i < 6 && cur !== null && typeof cur === "object"; i++) {
    const c = (cur as { code?: unknown }).code;
    if (typeof c === "string" && /^[0-9A-Z]{5}$/.test(c)) {
      // postgres.js `constraint_name`; node-postgres `constraint` (with-membership.ts ile aynı).
      const o = cur as { constraint_name?: unknown; constraint?: unknown };
      const k = o.constraint_name ?? o.constraint;
      return { code: c, constraint: typeof k === "string" ? k : null };
    }
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}

function sealerOf(deps: OpeningStockDeps): Sealer | null {
  try {
    return deps.sealer ?? integrationSealer();
  } catch (e) {
    if (e instanceof SealConfigError) return null;
    throw e;
  }
}

/**
 * Açılış stokunu ERP'den BİR KEZ al. `locationId`: stokun yazılacağı raf (kabul/depolama rafı). Başarıda belge numarası ve atlanan satır
 * sayıları döner; ikinci çağrı `ALREADY_TAKEN`.
 */
export async function pullOpeningStock(params: CallParams, input: { readonly provider: string; readonly locationId: string; readonly requestId?: string | null }, deps: OpeningStockDeps = {}): Promise<OpeningPullResult> {
  const provider = parseProvider(input.provider);
  const locationId = uuidOf(input.locationId);
  if (provider !== "PARASUT") return { ok: false, reason: "NOT_CONNECTED" };
  // Yetki: ayar sahibi + belge oluştur/onayla/işle (tek komut). Her biri ayrı denetlenir (rol + grup).
  for (const permission of ["settings.manage", "document.create", "document.approve", "stock.post"] as const) await runTenantQuery({ ...params, permission }, () => Promise.resolve(null));
  const access = { ...params, permission: "settings.manage" as const };
  const pre = await runTenantQuery(access, async (tx, m) => {
    const demo = await isDemo(tx, m.tenantId);
    const row = await loadIntegration(tx, m.tenantId, { provider });
    const st = await tx.execute<{ opening_stock_enabled: boolean; opening_stock_taken_at: Date | string | null }>(
      sql`SELECT opening_stock_enabled, opening_stock_taken_at FROM public.integrations WHERE tenant_id = ${m.tenantId}::uuid AND provider = ${provider}`,
    );
    const once = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM public.integrations WHERE tenant_id = ${m.tenantId}::uuid AND opening_stock_taken_at IS NOT NULL`);
    const loc = await tx.execute<{ warehouse_id: string }>(sql`
      SELECT l.warehouse_id FROM public.locations l JOIN public.warehouses w ON w.tenant_id = l.tenant_id AND w.id = l.warehouse_id
       WHERE l.tenant_id = ${m.tenantId}::uuid AND l.id = ${locationId}::uuid AND l.status = 'ACTIVE' AND w.status = 'ACTIVE' AND l.kind IN ('RECEIVING', 'STORAGE')`);
    return { tenantId: m.tenantId, demo, row, state: st[0], takenAny: Number(once[0]?.n ?? 0) > 0, warehouseId: loc[0]?.warehouse_id ?? null };
  });
  if (pre.demo) return { ok: false, reason: "DEMO" };
  if (pre.row === null || pre.row.status !== "CONNECTED" || pre.state === undefined) return { ok: false, reason: "NOT_CONNECTED" };
  if (pre.takenAny || pre.state.opening_stock_taken_at !== null) return { ok: false, reason: "ALREADY_TAKEN" };
  if (!pre.state.opening_stock_enabled) return { ok: false, reason: "DISABLED" };
  if (pre.warehouseId === null) return { ok: false, reason: "LOCATION_INVALID" };
  const warehouseId = pre.warehouseId;
  const integrationId = pre.row.id;
  const sealer = sealerOf(deps);
  if (sealer === null) return { ok: false, reason: "CONFIG" };
  const client = deps.client ?? new ParasutClient();

  // 1) Ağ (transaction dışı): belirteç + ürün sayfaları → (dış kimlik, miktar).
  const remote: { readonly externalId: string; readonly quantity: string | null }[] = [];
  const seen = new Set<string>();
  try {
    const t = await accessToken({ runTx: (fn) => runTenantCommand(access, (tx) => fn(tx)), tenantId: pre.tenantId, integrationId, client, sealer, minValidityMs: 5 * 60_000 });
    let page = 1;
    for (;;) {
      if (page > OPENING_PAGES_MAX) return { ok: false, reason: "TOO_MANY" };
      const p = await client.list(t.token, t.accountRef, "products", page);
      for (const r of p.items) {
        // Aynı ürün iki kez gelirse (sayfalama tutarsızlığı) açılış iki kez yazılmasın: bütün çekme reddedilir (bir kezlik kilit kalıcı).
        if (seen.has(r.id)) return { ok: false, reason: "BAD_RESPONSE" };
        seen.add(r.id);
        remote.push({ externalId: r.id, quantity: providerQuantity(r) });
      }
      if (p.items.length === 0 || page >= p.totalPages) break;
      page++;
    }
  } catch (e) {
    if (e instanceof ProviderError) return { ok: false, reason: e.code };
    if (e instanceof IntegrationStateError) return { ok: false, reason: e.code };
    throw e;
  }

  // 2) Eşleme (okuma): yalnız Paraşüt eşlemesi olan ürünler; stoğu olan / izlemeli / arşivli / örnek atlanır.
  const positive = remote.filter((r) => r.quantity !== null && r.quantity !== "0");
  const invalidRemote = remote.filter((r) => r.quantity === null).length;
  type Mapped = { external_id: string; id: string; status: string; tracking_mode: string; quantity_scale: number; base_unit_id: string; is_sample: boolean; has_stock: boolean };
  const mapped = positive.length === 0
    ? []
    : await runTenantQuery(access, (tx, m) =>
        tx.execute<Mapped>(sql`
          SELECT r.external_id, i.id, i.status, i.tracking_mode, i.quantity_scale, i.base_unit_id, i.is_sample,
                 EXISTS (SELECT 1 FROM public.stock_dimensions d JOIN public.stock_balances b ON b.tenant_id = d.tenant_id AND b.stock_dimension_id = d.id
                          WHERE d.tenant_id = i.tenant_id AND d.item_id = i.id AND b.quantity <> 0) AS has_stock
            FROM public.external_refs r JOIN public.items i ON i.tenant_id = r.tenant_id AND i.id = r.entity_id
           WHERE r.tenant_id = ${m.tenantId}::uuid AND r.system = 'PARASUT' AND r.entity_type = 'ITEM'
             AND r.external_id = ANY(${`{${positive.map((p) => `"${p.externalId}"`).join(",")}}`}::text[])`),
      );
  const byExt = new Map(mapped.map((x) => [x.external_id, x] as const));
  const counts = { unlinked: 0, hasStock: 0, unsupported: 0, invalid: invalidRemote };
  const lines: FieldLine[] = [];
  for (const p of positive) {
    const it = byExt.get(p.externalId);
    if (it === undefined) {
      counts.unlinked++;
      continue;
    }
    if (it.status !== "ACTIVE" || it.tracking_mode !== "NONE" || it.is_sample) {
      counts.unsupported++;
      continue;
    }
    if (it.has_stock) {
      counts.hasStock++;
      continue;
    }
    const q = p.quantity as string;
    if ((q.split(".")[1] ?? "").length > Number(it.quantity_scale)) {
      counts.invalid++;
      continue;
    }
    lines.push({ itemId: it.id, unitId: it.base_unit_id, quantity: q, conversionFactor: "1", baseQuantity: q, sourceLocationId: null, targetLocationId: locationId, stockStatus: "AVAILABLE", targetStockStatus: null, sourceLineId: null });
  }
  const skipped: OpeningSkipCounts = counts;
  if (lines.length === 0) return { ok: false, reason: "NOTHING", skipped };
  if (lines.length > OPENING_MAX_LINES) return { ok: false, reason: "TOO_MANY", skipped };
  if (new Set(lines.map((l) => l.itemId)).size !== lines.length) throw new AppError("INTERNAL"); // eşleme tekil (external_refs); savunma

  // 3) Tek stok komutu: kilitler → yeniden denetim (kilit altında) → belge oluştur + onayla + işle → bir kezlik kilit (aynı transaction).
  const spec: FieldPostSpec = { kind: "STOCK_IN", warehouseId, sourceKind: null, sourceId: null, reason: OPENING_STOCK_REASON, lines };
  const itemIds = lines.map((l) => l.itemId);
  try {
    const outcome = await executeStockCommand<{ integrationId: string; locationId: string; lines: string }, StockCommandResult>({
      db: params.db,
      principal: params.principal,
      tenantSlug: params.tenantSlug,
      clientKey: randomUUID(),
      commandType: OPENING_STOCK_COMMAND,
      permission: "stock.post",
      input: { integrationId, locationId, lines: lines.map((l) => `${l.itemId}:${l.quantity}`).join(",") },
      plan: (tx, _i, m) => planFieldPosting(tx, m.tenantId, spec),
      apply: async (tx, locked, c) => {
        const cur = await tx.execute<{ status: string; opening_stock_enabled: boolean; opening_stock_taken_at: Date | string | null }>(
          sql`SELECT status, opening_stock_enabled, opening_stock_taken_at FROM public.integrations WHERE tenant_id = ${c.tenantId}::uuid AND id = ${integrationId}::uuid FOR UPDATE`,
        );
        const row = cur[0];
        if (row === undefined || row.status !== "CONNECTED") throw new OpeningConflictError("NOT_CONNECTED");
        if (row.opening_stock_taken_at !== null) throw new OpeningConflictError("ALREADY_TAKEN");
        if (!row.opening_stock_enabled) throw new OpeningConflictError("DISABLED");
        const again = await tx.execute<{ n: number }>(sql`
          SELECT count(*)::int AS n FROM public.stock_dimensions d JOIN public.stock_balances b ON b.tenant_id = d.tenant_id AND b.stock_dimension_id = d.id
           WHERE d.tenant_id = ${c.tenantId}::uuid AND d.item_id = ANY(${pgUuidArray(itemIds)}::uuid[]) AND b.quantity <> 0`);
        if (Number(again[0]?.n ?? 0) > 0) throw new OpeningConflictError("PAIR_HAS_STOCK");
        const applied = await postFieldDocument(tx, locked, c, spec, input.requestId ?? null);
        const documentId = applied.result.documentId;
        if (documentId === undefined) throw new AppError("INTERNAL");
        const mark = await tx.execute<{ id: string }>(sql`
          UPDATE public.integrations SET opening_stock_taken_at = now(), opening_stock_document_id = ${documentId}::uuid
           WHERE tenant_id = ${c.tenantId}::uuid AND id = ${integrationId}::uuid AND opening_stock_taken_at IS NULL AND opening_stock_enabled
           RETURNING id`);
        if (mark[0] === undefined) throw new OpeningConflictError("ALREADY_TAKEN");
        await appendAudit(tx, {
          action: "integration.opening_stock_taken",
          actorUserId: c.userId,
          entityType: "integration",
          entityId: integrationId,
          requestId: input.requestId ?? null,
          changeSummary: { provider, document_id: documentId, lines: lines.length, skipped: { ...counts } },
        });
        return applied;
      },
    });
    if (outcome.status !== "COMPLETED" || outcome.result.documentId === undefined) throw new AppError("INTERNAL");
    const taken = await runTenantQuery(access, (tx, m) =>
      tx.execute<{ at: Date | string }>(sql`SELECT opening_stock_taken_at AS at FROM public.integrations WHERE tenant_id = ${m.tenantId}::uuid AND id = ${integrationId}::uuid`),
    );
    return { ok: true, documentId: outcome.result.documentId, documentNumber: outcome.result.documentNumber ?? null, lines: lines.length, skipped, takenAt: new Date(taken[0]?.at ?? Date.now()) };
  } catch (e) {
    if (e instanceof OpeningConflictError) return { ok: false, reason: e.reason, skipped };
    // DB kilidi (tetikleyici 55000 / tekil indeks 23505): eşzamanlı ikinci çekme.
    const st = sqlstateIn(e);
    if (st !== null && (st.code === "55000" || (st.code === "23505" && st.constraint === "integrations_opening_stock_once"))) return { ok: false, reason: "ALREADY_TAKEN", skipped };
    throw e;
  }
}
