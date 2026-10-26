// İlk kurulum yolculuğu (T-1006, kullanıcı onayı 22 Ekim): sıfırdan üye olan müşteri belge okumadan kurulumu YAPARAK öğrenir.
//
// - Adımın "tamam"ı TIKLAMAYLA değil GERÇEK VERİDEN hesaplanır (ürün, raf, stok defteri, etiket basıldı işareti, reçete, üretim kaydı,
//   saha üyesi, atanmış görev / sayım). Örnek veri (`is_sample`) sayılmaz. T-1054: depo ve raflardan sonra "Cariler" (arşivlenmemiş cari kart;
//   Paraşüt bağlıysa eşitlemeyle kendiliğinden gelir). Tabloda (0056 `setup_journeys`) yalnız seçimler durur.
// - Yalnız hesap sahibi (TENANT_ADMIN) ve depo yöneticisi (WAREHOUSE_MANAGER) görür ve değiştirir; saha/sayım/salt okuma rolleri `FORBIDDEN`.
//   Okuma `stock.view` üyeliğiyle açılır, rol kararı burada verilir (yetki grubu ek izni yolculuğu açmaz).
// - "Üretim yapmıyorum" denince 5 (reçete) ve 6 (üretim emri) hiç görünmez; "Bunu kullanmıyorum" adımı atlar (geri alınabilir).
// - Ayrıca saymayan adım: atlanan adım halkanın paydasından düşer ("3/8 tamam" = görünen ve atlanmamış adımlar).
import { sql } from "drizzle-orm";
import { appendAudit } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { runTenantCommand, runTenantQuery, type AccessTx, type Membership, type TenantAccessParams } from "../identity/access.ts";

export const JOURNEY_STEPS = ["cards", "shelves", "parties", "stock", "labels", "bom", "order", "people", "task"] as const;
export type JourneyStep = (typeof JOURNEY_STEPS)[number];
/** Yalnız üretim yapan firmada görünen adımlar. */
export const PRODUCTION_STEPS: readonly JourneyStep[] = Object.freeze(["bom", "order"]);
export type CardSource = "EXCEL" | "PARASUT";

export type JourneyCallParams = Omit<TenantAccessParams, "permission">;

export interface JourneyStepView {
  readonly key: JourneyStep;
  readonly done: boolean;
  readonly skipped: boolean;
  /** Adımın gerçek veri sayısı (ürün, raf, hareket, …); etikette 0/1. */
  readonly count: number;
}

export interface JourneyView {
  /** Görünen adımlar (üretim yapmayan firmada 5 ve 6 yok), sırayla. */
  readonly steps: readonly JourneyStepView[];
  readonly makesProduction: boolean | null;
  readonly cardSource: CardSource | null;
  readonly openingStockWanted: boolean | null;
  /** Halkanın payı / paydası: görünen ve atlanmamış adımlar. */
  readonly done: number;
  readonly total: number;
  readonly complete: boolean;
  /** Kutlama kapatıldı (Pano kartı artık çizilmez; Destek › Rehberi aç yine açar). */
  readonly dismissed: boolean;
  /**
   * Spotlight tur (asıl deneyim): `null` hiç başlamadı (yeni kiracıda — hiç adımı tamam değilken — ilk girişte başlar; verisi olan kiracıda
   * kendiliğinden başlamaz), `ACTIVE` sürüyor (ekranlar arası), `CLOSED` "Turu kapat" / Esc (Pano halkası, adım listesi ya da Destek › Rehberi aç
   * yeniden başlatır).
   */
  readonly tour: "ACTIVE" | "CLOSED" | null;
  /** Sıradaki (ilk tamamlanmamış ve atlanmamış) adım. */
  readonly next: JourneyStep | null;
  /** Adım ekranlarının hedefi için ipuçları (yalnız kimlik; içerik yok). */
  readonly hints: {
    readonly warehouseId: string | null;
    readonly recipeId: string | null;
    readonly parasut: { readonly connected: boolean; readonly openingEnabled: boolean; readonly openingTakenAt: Date | null };
  };
}

const JOURNEY_ROLES = ["TENANT_ADMIN", "WAREHOUSE_MANAGER"] as const;

/** Yolculuğu görebilen rol mü (hesap sahibi / depo yöneticisi). */
export function canSeeJourney(roles: readonly string[]): boolean {
  return roles.some((r) => (JOURNEY_ROLES as readonly string[]).includes(r));
}

function assertJourneyRole(m: Membership): void {
  if (!canSeeJourney(m.roles)) throw new AppError("FORBIDDEN");
}

type Row = {
  makes_production: boolean | null;
  card_source: CardSource | null;
  opening_stock_wanted: boolean | null;
  skipped: string[] | null;
  labels_printed_at: Date | string | null;
  dismissed_at: Date | string | null;
  tour_state: "ACTIVE" | "CLOSED" | null;
};

async function loadRow(tx: AccessTx, tenantId: string): Promise<Row | null> {
  const r = await tx.execute<Row>(
    sql`SELECT makes_production, card_source, opening_stock_wanted, skipped, labels_printed_at, dismissed_at, tour_state FROM public.setup_journeys WHERE tenant_id = ${tenantId}::uuid`,
  );
  return r[0] ?? null;
}

/** Saf hesap (birim testi): seçimler + sayılar → görünüm. */
export function computeJourney(input: {
  readonly counts: Readonly<Record<JourneyStep, number>>;
  readonly skipped: readonly string[];
  readonly makesProduction: boolean | null;
}): Pick<JourneyView, "steps" | "done" | "total" | "complete" | "next"> {
  const steps = JOURNEY_STEPS.filter((k) => input.makesProduction !== false || !PRODUCTION_STEPS.includes(k)).map(
    (key): JourneyStepView => ({ key, count: input.counts[key], done: input.counts[key] > 0, skipped: input.skipped.includes(key) }),
  );
  const active = steps.filter((s) => !s.skipped);
  const done = active.filter((s) => s.done).length;
  const next = active.find((s) => !s.done)?.key ?? null;
  return { steps, done, total: active.length, complete: active.length > 0 && done === active.length, next };
}

async function readCounts(tx: AccessTx, tenantId: string, labelsPrinted: boolean): Promise<Record<JourneyStep, number>> {
  const r = await tx.execute<{ items: number; shelves: number; parties: number; moves: number; recipes: number; batches: number; field: number; tasks: number }>(sql`
    SELECT
      (SELECT count(*)::int FROM public.items i WHERE i.tenant_id = ${tenantId}::uuid AND i.status = 'ACTIVE' AND NOT i.is_sample) AS items,
      (SELECT count(*)::int FROM public.locations l WHERE l.tenant_id = ${tenantId}::uuid AND l.status = 'ACTIVE' AND NOT l.is_sample) AS shelves,
      (SELECT count(*)::int FROM public.parties pa WHERE pa.tenant_id = ${tenantId}::uuid AND pa.archived_at IS NULL) AS parties,
      (SELECT count(*)::int FROM (SELECT 1 FROM public.stock_ledger s JOIN public.items i ON i.tenant_id = s.tenant_id AND i.id = s.item_id
                                   WHERE s.tenant_id = ${tenantId}::uuid AND NOT i.is_sample LIMIT 1000) x) AS moves,
      (SELECT count(*)::int FROM public.production_recipes p WHERE p.tenant_id = ${tenantId}::uuid) AS recipes,
      (SELECT count(*)::int FROM public.production_batches b WHERE b.tenant_id = ${tenantId}::uuid) AS batches,
      (SELECT count(DISTINCT m.id)::int FROM public.tenant_memberships m JOIN public.membership_roles r ON r.tenant_id = m.tenant_id AND r.membership_id = m.id
        WHERE m.tenant_id = ${tenantId}::uuid AND m.status = 'ACTIVE' AND r.role_key IN ('PICKER', 'COUNTER')) AS field,
      ((SELECT count(*)::int FROM public.warehouse_tasks t WHERE t.tenant_id = ${tenantId}::uuid AND t.assigned_membership_id IS NOT NULL AND t.kind IN ('PICK', 'COUNT'))
       + (SELECT count(*)::int FROM public.count_sessions c WHERE c.tenant_id = ${tenantId}::uuid)) AS tasks`);
  const c = r[0];
  return {
    cards: Number(c?.items ?? 0),
    shelves: Number(c?.shelves ?? 0),
    parties: Number(c?.parties ?? 0),
    stock: Number(c?.moves ?? 0),
    labels: labelsPrinted ? 1 : 0,
    bom: Number(c?.recipes ?? 0),
    order: Number(c?.batches ?? 0),
    people: Number(c?.field ?? 0),
    task: Number(c?.tasks ?? 0),
  };
}

async function readView(tx: AccessTx, tenantId: string): Promise<JourneyView> {
  const row = await loadRow(tx, tenantId);
  const counts = await readCounts(tx, tenantId, row?.labels_printed_at != null);
  const hint = await tx.execute<{ warehouse_id: string | null; recipe_id: string | null }>(sql`
    SELECT
      (SELECT w.id FROM public.warehouses w WHERE w.tenant_id = ${tenantId}::uuid AND w.status = 'ACTIVE' AND NOT w.is_sample ORDER BY w.created_at, w.id LIMIT 1) AS warehouse_id,
      (SELECT p.id FROM public.production_recipes p WHERE p.tenant_id = ${tenantId}::uuid ORDER BY p.created_at, p.id LIMIT 1) AS recipe_id`);
  const integ = await tx.execute<{ status: string; opening_stock_enabled: boolean; opening_stock_taken_at: Date | string | null }>(
    sql`SELECT status, opening_stock_enabled, opening_stock_taken_at FROM public.integrations WHERE tenant_id = ${tenantId}::uuid AND provider = 'PARASUT'`,
  );
  const p = integ[0];
  const skipped = (row?.skipped ?? []).filter((k) => (JOURNEY_STEPS as readonly string[]).includes(k));
  const makesProduction = row?.makes_production ?? null;
  return {
    ...computeJourney({ counts, skipped, makesProduction }),
    makesProduction,
    cardSource: row?.card_source ?? null,
    openingStockWanted: row?.opening_stock_wanted ?? null,
    dismissed: row?.dismissed_at != null,
    tour: row?.tour_state ?? null,
    hints: {
      warehouseId: hint[0]?.warehouse_id ?? null,
      recipeId: hint[0]?.recipe_id ?? null,
      parasut: {
        connected: p !== undefined && p.status !== "DISCONNECTED",
        openingEnabled: p?.opening_stock_enabled === true,
        openingTakenAt: p?.opening_stock_taken_at == null ? null : new Date(p.opening_stock_taken_at),
      },
    },
  };
}

/** Yolculuk görünümü (hesap sahibi / depo yöneticisi). */
export async function getSetupJourney(params: JourneyCallParams): Promise<JourneyView> {
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, m) => {
    assertJourneyRole(m);
    return readView(tx, m.tenantId);
  });
}

export interface JourneyChoice {
  /** Adımı atla ("Bunu kullanmıyorum"). */
  readonly skip?: string;
  /** Atlamayı geri al. */
  readonly unskip?: string;
  readonly makesProduction?: boolean;
  readonly cardSource?: string;
  readonly openingStockWanted?: boolean;
  /** Kutlamayı kapat. */
  readonly dismiss?: boolean;
  /** Spotlight tur: başlat / sürdür ya da kapat. */
  readonly tour?: string;
  readonly requestId?: string | null;
}

function stepOf(raw: unknown): JourneyStep {
  if (typeof raw !== "string" || !(JOURNEY_STEPS as readonly string[]).includes(raw)) throw new AppError("VALIDATION_FAILED");
  return raw as JourneyStep;
}

/** Seçimi kaydet (tek satır upsert + audit) ve güncel görünümü döndür. Boş seçim reddedilir. */
export async function setJourneyChoice(params: JourneyCallParams, input: JourneyChoice): Promise<JourneyView> {
  const skip = input.skip === undefined ? undefined : stepOf(input.skip);
  const unskip = input.unskip === undefined ? undefined : stepOf(input.unskip);
  if (input.makesProduction !== undefined && typeof input.makesProduction !== "boolean") throw new AppError("VALIDATION_FAILED");
  if (input.openingStockWanted !== undefined && typeof input.openingStockWanted !== "boolean") throw new AppError("VALIDATION_FAILED");
  if (input.dismiss !== undefined && input.dismiss !== true) throw new AppError("VALIDATION_FAILED");
  const tour = input.tour === undefined ? undefined : input.tour === "start" ? "ACTIVE" : input.tour === "close" ? "CLOSED" : null;
  if (tour === null) throw new AppError("VALIDATION_FAILED");
  const source = input.cardSource === undefined ? undefined : input.cardSource === "EXCEL" || input.cardSource === "PARASUT" ? input.cardSource : null;
  if (source === null) throw new AppError("VALIDATION_FAILED");
  if (skip === undefined && unskip === undefined && input.makesProduction === undefined && source === undefined && input.openingStockWanted === undefined && input.dismiss === undefined && tour === undefined) {
    throw new AppError("VALIDATION_FAILED");
  }
  return runTenantCommand({ ...params, permission: "stock.view" }, async (tx, m) => {
    assertJourneyRole(m);
    await tx.execute(sql`INSERT INTO public.setup_journeys (tenant_id, updated_by) VALUES (${m.tenantId}::uuid, ${m.userId}::uuid) ON CONFLICT (tenant_id) DO NOTHING`);
    const cur = await tx.execute<{ skipped: string[] }>(sql`SELECT skipped FROM public.setup_journeys WHERE tenant_id = ${m.tenantId}::uuid FOR UPDATE`);
    let skipped = (cur[0]?.skipped ?? []).filter((k) => (JOURNEY_STEPS as readonly string[]).includes(k));
    if (skip !== undefined && !skipped.includes(skip)) skipped = [...skipped, skip];
    if (unskip !== undefined) skipped = skipped.filter((k) => k !== unskip);
    await tx.execute(sql`
      UPDATE public.setup_journeys SET
        skipped = ${`{${skipped.join(",")}}`}::text[],
        makes_production = ${input.makesProduction === undefined ? sql`makes_production` : sql`${input.makesProduction}`},
        card_source = ${source === undefined ? sql`card_source` : sql`${source}`},
        opening_stock_wanted = ${input.openingStockWanted === undefined ? sql`opening_stock_wanted` : sql`${input.openingStockWanted}`},
        dismissed_at = ${input.dismiss === true ? sql`COALESCE(dismissed_at, now())` : sql`dismissed_at`},
        tour_state = ${tour === undefined ? (input.dismiss === true ? sql`'CLOSED'` : sql`tour_state`) : sql`${tour}`},
        updated_by = ${m.userId}::uuid
      WHERE tenant_id = ${m.tenantId}::uuid`);
    await appendAudit(tx, {
      action: "setup_journey.updated",
      actorUserId: m.userId,
      entityType: "tenant",
      entityId: m.tenantId,
      requestId: input.requestId ?? null,
      changeSummary: {
        ...(skip === undefined ? {} : { skipped: skip }),
        ...(unskip === undefined ? {} : { unskipped: unskip }),
        ...(input.makesProduction === undefined ? {} : { makes_production: input.makesProduction }),
        ...(source === undefined ? {} : { card_source: source }),
        ...(input.openingStockWanted === undefined ? {} : { opening_stock_wanted: input.openingStockWanted }),
        ...(input.dismiss === true ? { dismissed: true } : {}),
        ...(tour === undefined ? {} : { tour }),
      },
    });
    return readView(tx, m.tenantId);
  });
}

/**
 * Etiket yazdırıldı işareti (yolculuk adım 4). Yazdırma tarayıcıdadır; kaydı yoktu. Etiket ekranını açabilen her üye (`stock.view`) işaretler;
 * yalnız ilk kez yazılır (tetikleyici zamanı sunucudan koyar, sonra değişmez). Dönüş: ilk kez mi yazıldı.
 */
export async function markLabelsPrinted(params: JourneyCallParams): Promise<{ readonly first: boolean }> {
  return runTenantCommand({ ...params, permission: "stock.view" }, async (tx, m) => {
    const r = await tx.execute<{ tenant_id: string }>(sql`
      INSERT INTO public.setup_journeys (tenant_id, labels_printed_at, updated_by) VALUES (${m.tenantId}::uuid, now(), ${m.userId}::uuid)
      ON CONFLICT (tenant_id) DO UPDATE SET labels_printed_at = now(), updated_by = EXCLUDED.updated_by
        WHERE public.setup_journeys.labels_printed_at IS NULL
      RETURNING tenant_id`);
    const first = r[0] !== undefined;
    if (first) await appendAudit(tx, { action: "setup_journey.labels_printed", actorUserId: m.userId, entityType: "tenant", entityId: m.tenantId, changeSummary: {} });
    return { first };
  });
}
