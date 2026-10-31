// ERP senkron koşusu (T-991) — worker `integration.sync` işi buradan çalışır. Her ağ çağrısı transaction DIŞINDADIR; DB yazımları kısa
// `inTenant` transaction'larıdır (I-14). Tekrar çalışma güvenlidir (idempotent):
// - Kartlar (ürün/cari/depo): `external_refs` iki yönlü tekilliği + apply.ts eşleme sırası → aynı kayıt iki kez gelmez / iki kez gönderilmez.
//   Etkin -> ERP gönderiminden önce ERP'de koda (ürün), vergi no/ada (cari), ada (depo) göre arama yapılır; bulunursa yalnız bağlanır.
// - İrsaliye (SHIPMENTS): `integration_outbox` (tenant + bağlantı + akış + belge TEKİL). Dış çağrıdan önce satır SENDING yazılır; sonuç
//   kesin değilse (ağ kopması, 5xx, okunamayan 2xx) satır CHECK olur ve KÖR YENİDEN GÖNDERİLMEZ (Paraşüt'te tekrar anahtarı yok → çift irsaliye
//   riski). Kesin 4xx red: FAILED; eşleme eksikse (cari/ürün bağlı değil) geri çekilmeli yeniden deneme, 10 denemede FAILED.
//   Olay kaydı fark sorgusudur: akışın İLK açılışından (`first_enabled_at`, kapat/aç sıfırlamaz — T-1135) sonra İŞLENMİŞ (durum geçmişinde
//   POSTED anı), stok toplamına girmemiş (çift başına son başarılı işaretin görüntüsünde görünmeyen), kuyrukta olmayan sevk belgesi.
//   Kapalıyken işlenen belge yeniden açılınca gider; oluşturulup açılıştan sonra işlenen belge de gider. Kesim noktası/imleç yoktur (I-16), kayıp yoktur.
// - Stok (STOCK): mutlak "yeni toplam" gönderilir (tekrar aynı sonuç); yalnız son gönderimden farklı çift. T-1135: STOCK ve SHIPMENTS aynı
//   bağlantıda birlikte açılamaz (stok sahibi Etkin, kullanıcı kararı 30 Ekim; DB tetikleyicisi + domain), STOCK Devir tamamlanmadan çalışmaz;
//   kesin 4xx reddi işarete FAILED yazılır ve aynı toplam yeniden denenmez (401/429 koşuyu durdurur, sonra yeniden denenir).
// - Miktarlar uçtan uca ondalık metindir (I-09); JSON sayısına yalnız istemcinin son serileştirme adımında dönüşür (decimal-json.ts).
// - Koşu günlüğü (T-1135): değişiklik getirmeyen başarılı zamanlı koşu satır bırakmaz (akışın `last_run_at`'i son kontrol anıdır); 40 dk'yı
//   aşan RUNNING satırı FAILED/TIMEOUT olur; 7 günden eski biten satırlar koşu başında budanır (en çok 500).
// Stok değişmez kuralı (I-04): ERP'den hiçbir yol stok tablosuna yazmaz; stok okuması yalnız stock-reads.ts SELECT'idir.
//
// Yetki: koşu başında bağlantıyı kuran kişinin üyeliği ACTIVE + TENANT_ADMIN (settings.manage tek sahibi) olmalı; değilse bağlantı ERROR
// `CONNECTOR_REVOKED` olur ve hiçbir akış çalışmaz (yetkisini kaybeden yöneticinin bağlantısı arka planda yazmaya devam etmez).
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { appendAudit, currentTenantId } from "@wms/db";
import type { Sealer } from "@wms/shared/seal";
import type { AccessTx } from "../identity/access.ts";
import { applyContact, applyProduct, applyWarehouse, link, refExternal, type ApplyContext, type ApplyOutcome } from "./apply.ts";
import { FLOWS, PROVIDER_INFO, flowSupported, pulls, pushes, type Direction, type Flow } from "./catalog.ts";
import { ProviderError, type JsonApiResource, type ParasutClient } from "./parasut.ts";
import { assertLifecycleBinding, lifecycleBinding, lifecycleCandidates, observeProduct, type LifecycleBinding } from "./product-lifecycle.ts";
import { parseProductSource, type ProductSourceWarning } from "./product-info.ts";
import { selectChangedStockLevels, type StockLevelRow } from "./stock-reads.ts";
import { stockPushReady } from "./connections.ts";
import { IntegrationStateError, accessToken, loadIntegration, markIntegrationError, type RunTx } from "./store.ts";

/** Koşu başına üst sınırlar (hız sınırı 10 istek / 10 sn; iş süresi 30 dk). Kalan sonraki koşuda. */
export const SYNC_LIMITS = Object.freeze({ pagesPerRun: 40, pushPerRun: 50, shipmentsPerRun: 20, stockRowsPerRun: 200, stockBatch: 50, outboxMaxAttempts: 10 });
/** Akış sırası: önce eşlemeler (depo, ürün, cari), sonra stok ve irsaliye. */
const ORDER: readonly Flow[] = ["WAREHOUSES", "PRODUCTS", "CONTACTS", "SHIPMENTS", "STOCK"];
const STALE_SENDING_MINUTES = 40;
/** T-1135: RUNNING koşu satırı bu süreyi aşınca FAILED/TIMEOUT (iş süresi 30 dk + pay). */
export const RUN_TIMEOUT_MINUTES = 40;
/** T-1135: biten koşu satırı saklama süresi (DB silme bekçisi 0066 ile aynı) ve koşu başına budama üst sınırı. */
export const RUN_RETENTION_DAYS = 7;
const RUN_PRUNE_BATCH = 500;
const RUN_TOKEN_VALIDITY_MS = 35 * 60_000;

export interface SyncDeps {
  /** `ctx.inTenant` (worker): tenant bağlamı işin zarfından. */
  readonly inTenant: RunTx;
  readonly client: ParasutClient;
  readonly sealer: Sealer;
  readonly now?: () => number;
}

export interface SyncPayload {
  readonly integrationId: string;
  readonly flow?: Flow | undefined;
  readonly trigger: "SCHEDULE" | "MANUAL";
}

export interface Counters {
  created: number;
  updated: number;
  linked: number;
  skipped: number;
  failed: number;
  /** T-1135: satırı düşürmeyen uyarı (ör. kategorisi çözülemeyen ürün kategorisiz alındı). Koşu satırına değil audit özetine yazılır. */
  warnings: number;
}

export interface FlowResult {
  readonly flow: Flow;
  readonly status: "SUCCESS" | "PARTIAL" | "FAILED";
  readonly counts: Readonly<Counters>;
  readonly errorCode: string | null;
}

export type SyncResult =
  | { readonly kind: "skipped"; readonly reason: string }
  | { readonly kind: "ran"; readonly flows: readonly FlowResult[] };

type FlowRow = {
  flow: Flow;
  direction: Direction;
  enabled_at: Date | string | null;
  first_enabled_at: Date | string | null;
  cursor: string | null;
};

/** T-1135: akış bu koşuda çalışamaz (kalıcı durum; sağlayıcıya istek gitmez). */
export class FlowBlockedError extends Error {
  override name = "FlowBlockedError";
  readonly code: "INTEGRATION_FLOW_EXCLUSIVE" | "OPENING_STOCK_INCOMPLETE";
  constructor(code: "INTEGRATION_FLOW_EXCLUSIVE" | "OPENING_STOCK_INCOMPLETE") {
    super(`flow blocked (${code})`);
    this.code = code;
  }
}

interface RunCtx {
  readonly deps: SyncDeps;
  readonly tenantId: string;
  readonly integrationId: string;
  readonly companyId: string;
  readonly token: string;
  readonly ac: ApplyContext;
  readonly flow: FlowRow;
  readonly c: Counters;
  readonly productBinding: LifecycleBinding|null;
}

const errCode = (e: unknown): string => {
  if (e instanceof ProviderError) return `PROVIDER_${e.code}`;
  if (e instanceof IntegrationStateError) return e.code;
  if (e instanceof FlowBlockedError) return e.code;
  return "INTERNAL";
};

function count(c: Counters, o: ApplyOutcome): void {
  if (o === "CREATED") c.created++;
  else if (o === "UPDATED") c.updated++;
  else if (o === "LINKED") c.linked++;
  else if (o === "SKIPPED") c.skipped++;
}

/** Bağlantıyı kuran kişi hâlâ ACTIVE üye ve TENANT_ADMIN mi. */
async function connectorAllowed(tx: AccessTx, tenantId: string, membershipId: string, userId: string): Promise<boolean> {
  const r = await tx.execute<{ ok: boolean }>(
    sql`SELECT EXISTS (
          SELECT 1 FROM public.tenant_memberships m JOIN public.membership_roles r ON r.tenant_id = m.tenant_id AND r.membership_id = m.id
           WHERE m.tenant_id = ${tenantId}::uuid AND m.id = ${membershipId}::uuid AND m.user_id = ${userId}::uuid AND m.status = 'ACTIVE' AND r.role_key = 'TENANT_ADMIN'
        ) AS ok`,
  );
  return r[0]?.ok === true;
}

// --- eşleme dönüştürücüleri (sağlayıcı kaynağı → apply girdisi) --------------------------------------------------------------------
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const toProduct = (r: JsonApiResource, included: readonly JsonApiResource[] = [], warn: (w: ProductSourceWarning) => void = () => undefined) => {
  // T-1135: kategori çözülemezse ürün kategorisiz alınır, satır düşmez; uyarı sayılır.
  const src = parseProductSource(r, included);
  for (const w of src.warnings) warn(w);
  return { externalId: r.id, code: s(r.attributes.code), name: s(r.attributes.name), unit: s(r.attributes.unit), barcode: s(r.attributes.barcode), sourceInfo: src.info };
};
const toContact = (r: JsonApiResource) => ({
  externalId: r.id,
  name: s(r.attributes.name),
  accountType: r.attributes.account_type === "supplier" ? ("supplier" as const) : r.attributes.account_type === "customer" ? ("customer" as const) : null,
  taxNumber: s(r.attributes.tax_number),
  taxOffice: s(r.attributes.tax_office),
  email: s(r.attributes.email),
  phone: s(r.attributes.phone),
  city: s(r.attributes.city),
  address: s(r.attributes.address),
  // T-1117 (`0064_party_details`): Paraşüt kısa ad ve ilçe.
  shortName: s(r.attributes.short_name),
  district: s(r.attributes.district),
});
const toWarehouse = (r: JsonApiResource) => ({ externalId: r.id, name: s(r.attributes.name), archived: r.attributes.archived === true });

// --- ERP -> Etkin -------------------------------------------------------------------------------------------------------------------
async function pull(rc: RunCtx, kind: "products" | "contacts" | "warehouses"): Promise<void> {
  const started=(rc.deps.now??Date.now)();
  const binding=kind==='products'?rc.productBinding:null;
  if(binding&&(binding.companyId!==rc.companyId||binding.userId!==rc.ac.actorUserId||binding.membershipId!==rc.ac.membershipId))throw new IntegrationStateError("NOT_CONNECTED");
  let page = rc.flow.cursor === null ? 1 : Math.max(1, Number(rc.flow.cursor));
  for (let n = 0; n < SYNC_LIMITS.pagesPerRun; n++) {
    const p = await rc.deps.client.list(rc.token, rc.companyId, kind, page);
    const next = p.items.length === 0 || page >= p.totalPages ? null : page + 1;
    await rc.deps.inTenant(async (tx) => {
      if(binding&&!(await assertLifecycleBinding(tx,binding)))throw new IntegrationStateError("NOT_CONNECTED");
      const barcodeSetting = kind === "products" ? await tx.execute<{ enabled: boolean }>(sql`SELECT pull_product_barcodes AS enabled FROM public.integrations WHERE tenant_id=${rc.tenantId}::uuid AND id=${rc.integrationId}::uuid`) : [];
      const ac = { ...rc.ac, pullProductBarcodes: barcodeSetting[0]?.enabled === true };
      for (const item of p.items) {
        if(kind==="products"&&item.type!=="products"){rc.c.failed++;continue;}
        try {
          // Satır başına kayıt noktası: bir kartın reddi sayfanın kalanını düşürmez.
          let warned = 0;
          const o = await tx.transaction((sp) =>
            kind === "products" ? applyProduct(sp, ac, toProduct(item, p.included, () => void (warned += 1))) : kind === "contacts" ? applyContact(sp, rc.ac, toContact(item)) : applyWarehouse(sp, rc.ac, toWarehouse(item)),
          );
          count(rc.c, o);
          rc.c.warnings += warned;
        } catch {
          rc.c.failed++;
        }
        // Safety state is independent of optional name/unit/barcode parsing failures.
        if(binding)await tx.transaction(sp=>observeProduct(sp,binding,rc.ac,item.id,{exists:true,archived:item.attributes.archived},(rc.deps.now??Date.now)()));
      }
      await tx.execute(sql`UPDATE public.integration_flows SET cursor = ${next === null ? null : String(next)} WHERE tenant_id = ${rc.tenantId}::uuid AND integration_id = ${rc.integrationId}::uuid AND flow = ${rc.flow.flow}`);
    });
    if (next === null) break;
    page = next;
  }
  if(binding){
    // A successful product page alone cannot prove deletion. Verify current company access, then exact identities twice over time.
    const companies=await rc.deps.client.companies(rc.token);
    if(!companies.some(c=>c.id===binding.companyId))throw new IntegrationStateError("NOT_CONNECTED");
    const candidates=await rc.deps.inTenant(tx=>lifecycleCandidates(tx,binding,started));
    for(const candidate of candidates){
      const product=await rc.deps.client.product(rc.token,rc.companyId,candidate.external_id);
      await rc.deps.inTenant(async tx=>{
        if(!(await assertLifecycleBinding(tx,binding)))throw new IntegrationStateError("NOT_CONNECTED");
        if(await observeProduct(tx,binding,rc.ac,candidate.external_id,product===null?{exists:false}:{exists:true,archived:product.attributes.archived},(rc.deps.now??Date.now)()))rc.c.updated++;
      });
    }
  }
}

// --- Etkin -> ERP (kartlar) ---------------------------------------------------------------------------------------------------------
type PushRow = { id: string; code: string; name: string; extra: string | null; tax_no: string | null; tax_office: string | null; email: string | null; phone: string | null; city: string | null; address: string | null; kind: string | null; short_name: string | null; district: string | null };

const CARD_FLOW: Readonly<Record<"ITEM" | "PARTY" | "WAREHOUSE", Flow>> = Object.freeze({ ITEM: "PRODUCTS", PARTY: "CONTACTS", WAREHOUSE: "WAREHOUSES" });

async function unlinked(rc: RunCtx, entity: "ITEM" | "PARTY" | "WAREHOUSE"): Promise<PushRow[]> {
  const sys = rc.ac.system;
  const lim = SYNC_LIMITS.pushPerRun;
  // T-1135: dış kaydı başka Etkin kaydına bağlı olduğu için bir kez FAILED yazılan kart her koşuda yeniden denenmez (sonsuz "atlandı" yok).
  const parked = (alias: string) =>
    sql`NOT EXISTS (SELECT 1 FROM public.integration_outbox ob WHERE ob.tenant_id = ${rc.tenantId}::uuid AND ob.integration_id = ${rc.integrationId}::uuid
                    AND ob.flow = ${CARD_FLOW[entity]} AND ob.entity_id = ${sql.raw(alias)}.id)`;
  return rc.deps.inTenant((tx) => {
    if (entity === "ITEM") {
      return tx.execute<PushRow>(sql`
        SELECT i.id, i.code, i.name, u.name AS extra, NULL AS tax_no, NULL AS tax_office, NULL AS email, NULL AS phone, NULL AS city, NULL AS address, NULL AS kind, NULL AS short_name, NULL AS district
          FROM public.items i JOIN public.units u ON u.tenant_id = i.tenant_id AND u.id = i.base_unit_id
         WHERE i.tenant_id = ${rc.tenantId}::uuid AND i.status = 'ACTIVE'
           AND NOT EXISTS (SELECT 1 FROM public.external_refs r WHERE r.tenant_id = i.tenant_id AND r.system = ${sys} AND r.entity_type = 'ITEM' AND r.entity_id = i.id)
           AND ${parked("i")}
         ORDER BY i.code LIMIT ${lim}`);
    }
    if (entity === "PARTY") {
      return tx.execute<PushRow>(sql`
        SELECT p.id, p.code, p.name, NULL AS extra, p.tax_no, p.tax_office, p.email, p.phone, p.city, p.address, p.kind, p.short_name, p.district
          FROM public.parties p
         WHERE p.tenant_id = ${rc.tenantId}::uuid AND p.archived_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM public.external_refs r WHERE r.tenant_id = p.tenant_id AND r.system = ${sys} AND r.entity_type = 'PARTY' AND r.entity_id = p.id)
           AND ${parked("p")}
         ORDER BY p.code_key LIMIT ${lim}`);
    }
    return tx.execute<PushRow>(sql`
      SELECT w.id, w.code, w.name, NULL AS extra, NULL AS tax_no, NULL AS tax_office, NULL AS email, NULL AS phone, NULL AS city, NULL AS address, NULL AS kind, NULL AS short_name, NULL AS district
        FROM public.warehouses w
       WHERE w.tenant_id = ${rc.tenantId}::uuid AND w.status = 'ACTIVE'
         AND NOT EXISTS (SELECT 1 FROM public.external_refs r WHERE r.tenant_id = w.tenant_id AND r.system = ${sys} AND r.entity_type = 'WAREHOUSE' AND r.entity_id = w.id)
         AND ${parked("w")}
       ORDER BY w.code LIMIT ${lim}`);
  });
}

async function pushCards(rc: RunCtx, entity: "ITEM" | "PARTY" | "WAREHOUSE"): Promise<void> {
  const { client } = rc.deps;
  for (const row of await unlinked(rc, entity)) {
    try {
      let ext: string;
      let found: JsonApiResource | null;
      if (entity === "ITEM") {
        found = await client.findProductByCode(rc.token, rc.companyId, row.code);
        ext = found?.id ?? (await client.createProduct(rc.token, rc.companyId, { code: row.code, name: row.name, unit: row.extra }));
      } else if (entity === "PARTY") {
        found = await client.findContact(rc.token, rc.companyId, { taxNumber: row.tax_no, name: row.name });
        ext =
          found?.id ??
          (await client.createContact(rc.token, rc.companyId, {
            name: row.name,
            accountType: row.kind === "SUPPLIER" ? "supplier" : "customer",
            taxNumber: row.tax_no,
            taxOffice: row.tax_office,
            email: row.email,
            phone: row.phone,
            city: row.city,
            address: row.address,
            shortName: row.short_name,
            district: row.district,
          }));
      } else {
        found = await client.findWarehouse(rc.token, rc.companyId, row.name);
        ext = found?.id ?? (await client.createWarehouse(rc.token, rc.companyId, { name: row.name }));
      }
      const linked = await rc.deps.inTenant(async (tx) => {
        if (await link(tx, rc.ac, entity, row.id, ext, entity === "PARTY" ? null : row.code)) return true;
        // T-1135: dış kayıt başka bir Etkin kaydına bağlı (ya da yarış): bir kez FAILED yazılır, sonraki koşular bu kartı seçmez.
        await parkCard(tx, rc, entity, row.id, "EXTERNAL_ALREADY_LINKED");
        return false;
      });
      if (!linked) rc.c.failed++;
      else if (found === null) rc.c.created++;
      else rc.c.linked++;
    } catch (e) {
      if (e instanceof ProviderError && e.retryable) throw e; // geçici: koşu durur, iş yeniden dener
      if (e instanceof ProviderError && e.code === "AUTH_FAILED") throw e;
      rc.c.failed++;
    }
  }
}

async function parkCard(tx: AccessTx, rc: RunCtx, entity: "ITEM" | "PARTY" | "WAREHOUSE", entityId: string, code: string): Promise<void> {
  const ins = await tx.execute<{ id: string }>(sql`
    INSERT INTO public.integration_outbox (tenant_id, id, integration_id, flow, entity_type, entity_id)
    VALUES (${rc.tenantId}::uuid, gen_random_uuid(), ${rc.integrationId}::uuid, ${CARD_FLOW[entity]}, ${entity}, ${entityId}::uuid)
    ON CONFLICT ON CONSTRAINT integration_outbox_entity_key DO NOTHING RETURNING id`);
  if (ins[0] === undefined) return;
  await tx.execute(sql`UPDATE public.integration_outbox SET status = 'FAILED', attempts = 1, last_error_code = ${code}
                        WHERE tenant_id = ${rc.tenantId}::uuid AND id = ${ins[0].id}::uuid`);
}

// --- Etkin -> ERP (stok seviyesi) ---------------------------------------------------------------------------------------------------
/** T-1135: sağlayıcı isteği kesin reddetti (4xx; 401 ve 429 hariç — onlar koşuyu durdurur, sonra yeniden denenir). */
export const definiteRejection = (e: unknown): e is ProviderError =>
  e instanceof ProviderError && !e.retryable && e.code !== "AUTH_FAILED" && e.status !== null && e.status >= 400 && e.status < 500;

async function markStock(rc: RunCtx, rows: readonly StockLevelRow[], failure: string | null): Promise<void> {
  await rc.deps.inTenant(async (tx) => {
    for (const r of rows) {
      if (failure === null) {
        // Mutlak toplam gönderildi: işaret güncellenir (tekrar gönderim aynı sonucu verir; çift sayım olmaz); önceki red kaydı temizlenir.
        // `as_of_snapshot`: toplamın okunduğu görüntü — bu görüntüde işlenmiş sevk belgesi Paraşüt toplamına girmiştir (irsaliye keşfi).
        await tx.execute(sql`
          INSERT INTO public.integration_stock_marks (tenant_id, integration_id, item_id, warehouse_id, quantity, as_of_snapshot)
          VALUES (${rc.tenantId}::uuid, ${rc.integrationId}::uuid, ${r.item_id}::uuid, ${r.warehouse_id}::uuid, ${r.quantity}::numeric, ${r.snap}::pg_snapshot)
          ON CONFLICT ON CONSTRAINT integration_stock_marks_pkey DO UPDATE SET quantity = EXCLUDED.quantity, as_of_snapshot = EXCLUDED.as_of_snapshot, failed_quantity = NULL, last_error_code = NULL`);
      } else {
        // Kesin red: aynı toplam yeniden denenmez (30 sn'de bir sonsuz tekrar yok); toplam değişince yeniden gider.
        await tx.execute(sql`
          INSERT INTO public.integration_stock_marks (tenant_id, integration_id, item_id, warehouse_id, failed_quantity, last_error_code)
          VALUES (${rc.tenantId}::uuid, ${rc.integrationId}::uuid, ${r.item_id}::uuid, ${r.warehouse_id}::uuid, ${r.quantity}::numeric, ${failure})
          ON CONFLICT ON CONSTRAINT integration_stock_marks_pkey DO UPDATE SET failed_quantity = EXCLUDED.failed_quantity, last_error_code = EXCLUDED.last_error_code`);
      }
    }
  });
}

async function sendStock(rc: RunCtx, rows: readonly StockLevelRow[]): Promise<void> {
  try {
    // I-09: toplam ondalık metin olarak gider; JSON sayısına istemcinin son adımında dönüşür.
    await rc.deps.client.createStockUpdate(rc.token, rc.companyId, rows.map((r) => ({ productId: r.product_ext, warehouseId: r.warehouse_ext, total: r.quantity })));
  } catch (e) {
    if (e instanceof ProviderError && (e.retryable || e.code === "AUTH_FAILED")) throw e;
    if (!definiteRejection(e)) {
      // Belirsiz (okunamayan yanıt vb.): mutlak toplam olduğundan sonraki koşu güvenle yeniden gönderir.
      rc.c.failed += rows.length;
      return;
    }
    if (rows.length > 1) {
      // Tek bozuk satır bütün grubu kalıcı düşürmesin: satır satır yeniden gönderilir, yalnız reddedilen işaretlenir.
      for (const r of rows) await sendStock(rc, [r]);
      return;
    }
    await markStock(rc, rows, errCode(e));
    rc.c.failed += rows.length;
    return;
  }
  await markStock(rc, rows, null);
  rc.c.updated += rows.length;
}

async function pushStock(rc: RunCtx): Promise<void> {
  // T-1135: stok sahibi Etkin; irsaliye akışı açıkken mutlak toplam gönderilmez; Devir tamamlanmadan stok gönderimi yok (tek tanım DB'de).
  const gate = await rc.deps.inTenant(async (tx) => {
    const ship = await tx.execute<{ on: boolean }>(sql`SELECT enabled AS on FROM public.integration_flows WHERE tenant_id = ${rc.tenantId}::uuid AND integration_id = ${rc.integrationId}::uuid AND flow = 'SHIPMENTS'`);
    if (ship[0]?.on === true) return "INTEGRATION_FLOW_EXCLUSIVE" as const;
    return (await stockPushReady(tx, rc.tenantId, rc.integrationId)) ? null : ("OPENING_STOCK_INCOMPLETE" as const);
  });
  if (gate !== null) throw new FlowBlockedError(gate);
  const rows = await rc.deps.inTenant((tx) => selectChangedStockLevels(tx, rc.tenantId, rc.integrationId, rc.ac.system, SYNC_LIMITS.stockRowsPerRun));
  for (let i = 0; i < rows.length; i += SYNC_LIMITS.stockBatch) await sendStock(rc, rows.slice(i, i + SYNC_LIMITS.stockBatch));
}

// --- Etkin -> ERP (irsaliye) --------------------------------------------------------------------------------------------------------
interface ShipmentPayload {
  readonly outboxId: string;
  readonly attempts: number;
  readonly documentId: string;
  readonly number: string;
  readonly issueDate: string;
  readonly shipmentDate: string;
  readonly contactId: string;
  /** Ondalık metin (I-09). */
  readonly lines: readonly { readonly productId: string; readonly quantity: string }[];
}

const backoffMinutes = (attempts: number): number => Math.min(24 * 60, 5 * 2 ** Math.max(0, attempts - 1));

async function claimShipment(rc: RunCtx): Promise<ShipmentPayload | "none" | "deferred"> {
  return rc.deps.inTenant(async (tx) => {
    const r = await tx.execute<{ id: string; entity_id: string; attempts: number }>(sql`
      SELECT id, entity_id, attempts FROM public.integration_outbox
       WHERE tenant_id = ${rc.tenantId}::uuid AND integration_id = ${rc.integrationId}::uuid AND flow = 'SHIPMENTS' AND status = 'PENDING' AND next_attempt_at <= now()
       ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`);
    const row = r[0];
    if (row === undefined) return "none";
    const attempts = Number(row.attempts) + 1;
    const defer = async (code: string): Promise<"deferred"> => {
      const failed = attempts >= SYNC_LIMITS.outboxMaxAttempts;
      await tx.execute(sql`
        UPDATE public.integration_outbox SET status = ${failed ? "FAILED" : "PENDING"}, attempts = ${attempts}, last_error_code = ${code},
               next_attempt_at = now() + make_interval(mins => ${backoffMinutes(attempts)})
         WHERE tenant_id = ${rc.tenantId}::uuid AND id = ${row.id}::uuid`);
      rc.c.skipped++;
      return "deferred";
    };
    const doc = await tx.execute<{ number: string; business_date: string; created_at: Date | string; customer_ref: string | null }>(sql`
      SELECT d.number, d.business_date::text AS business_date, d.created_at, o.customer_ref
        FROM public.documents d LEFT JOIN public.sales_orders o ON o.tenant_id = d.tenant_id AND o.id = d.source_id
       WHERE d.tenant_id = ${rc.tenantId}::uuid AND d.id = ${row.entity_id}::uuid AND d.status = 'POSTED'`);
    const h = doc[0];
    if (h === undefined) return defer("DOCUMENT_NOT_POSTED");
    const party = h.customer_ref === null
      ? []
      : await tx.execute<{ id: string }>(sql`SELECT id FROM public.parties WHERE tenant_id = ${rc.tenantId}::uuid AND code_key = upper(btrim(${h.customer_ref}))`);
    const contactExt = party[0] === undefined ? null : await refExternal(tx, rc.ac, "PARTY", party[0].id);
    if (contactExt === null) return defer("CONTACT_NOT_LINKED");
    const lines = await tx.execute<{ item_id: string; qty: string; ext: string | null }>(sql`
      SELECT l.item_id, SUM(l.base_quantity)::text AS qty, r.external_id AS ext
        FROM public.document_lines l
        LEFT JOIN public.external_refs r ON r.tenant_id = l.tenant_id AND r.system = ${rc.ac.system} AND r.entity_type = 'ITEM' AND r.entity_id = l.item_id
       WHERE l.tenant_id = ${rc.tenantId}::uuid AND l.document_id = ${row.entity_id}::uuid
       GROUP BY l.item_id, r.external_id ORDER BY l.item_id`);
    if (lines.length === 0) return defer("DOCUMENT_EMPTY");
    if (lines.some((l) => l.ext === null)) return defer("ITEM_NOT_LINKED");
    // Dış çağrıdan önce kalıcı işaret (SENDING): kopma olursa satır CHECK'e düşer, kör yeniden gönderim yoktur.
    await tx.execute(sql`UPDATE public.integration_outbox SET status = 'SENDING', attempts = ${attempts}, last_error_code = NULL WHERE tenant_id = ${rc.tenantId}::uuid AND id = ${row.id}::uuid`);
    return {
      outboxId: row.id,
      attempts,
      documentId: row.entity_id,
      number: h.number,
      issueDate: h.business_date,
      shipmentDate: new Date(h.created_at).toISOString(),
      contactId: contactExt,
      lines: lines.map((l) => ({ productId: l.ext as string, quantity: l.qty })),
    };
  });
}

/**
 * T-1135: irsaliye keşfinin akış alt sınırı = İLK açılış anı (kapat/aç sıfırlamaz). 0066 öncesi satırda `first_enabled_at` boşsa `enabled_at`.
 * Hiç açılmamışsa null (keşif yok). Stok toplamına girmiş belge ayrıca SQL'de çift başına görüntü görünürlüğüyle ayıklanır.
 */
export function shipmentDiscoveryFloor(flow: { readonly first_enabled_at: Date | string | null; readonly enabled_at: Date | string | null }): Date | null {
  const v = flow.first_enabled_at ?? flow.enabled_at;
  if (v === null) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function pushShipments(rc: RunCtx): Promise<void> {
  const enabledAt = shipmentDiscoveryFloor(rc.flow);
  if (enabledAt === null) return;
  await rc.deps.inTenant(async (tx) => {
    // Kopma sonrası belirsiz kalan gönderim: insan kontrolü (Paraşüt'te tekrar anahtarı yok).
    await tx.execute(sql`
      UPDATE public.integration_outbox SET status = 'CHECK', last_error_code = 'UNCERTAIN'
       WHERE tenant_id = ${rc.tenantId}::uuid AND integration_id = ${rc.integrationId}::uuid AND flow = 'SHIPMENTS' AND status = 'SENDING'
         AND updated_at < now() - make_interval(mins => ${STALE_SENDING_MINUTES})`);
    // Fark sorgusu (T-1135): akışın ilk açılışından sonra İŞLENMİŞ sevk belgeleri — işlenme anı durum geçmişinden (tetikleyici yazar, sunucu
    // saati). Oluşturma anı ölçüt değildir. Stok toplamına girmiş belge irsaliye olarak gönderilmez (çift düşüm yok): belge yalnız BÜTÜN
    // (ürün, belge deposu) çiftlerinin son BAŞARILI stok işaretinin okuma görüntüsünde işlenmişse (POSTED xid görünür) atlanır. Görünürlük
    // zamana değil işlem kimliğine dayanır (I-16); reddedilen ya da sınır yüzünden gönderilmeyen çiftin belgesi gider. Görüntüsü olmayan 0066
    // öncesi işarette o çiftin `sent_at`'i ölçüttür (reviewer n-1: çift düşüm olmasın). Her koşu bütün farkı tarar.
    await tx.execute(sql`
      INSERT INTO public.integration_outbox (tenant_id, id, integration_id, flow, entity_type, entity_id)
      SELECT d.tenant_id, gen_random_uuid(), ${rc.integrationId}::uuid, 'SHIPMENTS', 'DOCUMENT', d.id
        FROM public.documents d
        JOIN public.document_status_history h ON h.tenant_id = d.tenant_id AND h.document_id = d.id AND h.to_status = 'POSTED'
       WHERE d.tenant_id = ${rc.tenantId}::uuid AND d.kind = 'STOCK_OUT' AND d.source_kind = 'SALES_ORDER' AND d.status = 'POSTED'
         AND h.occurred_at >= ${enabledAt.toISOString()}::timestamptz
         AND NOT (
           EXISTS (SELECT 1 FROM public.document_lines l0 WHERE l0.tenant_id = d.tenant_id AND l0.document_id = d.id)
           AND NOT EXISTS (
             SELECT 1 FROM public.document_lines l
               LEFT JOIN public.integration_stock_marks m
                      ON m.tenant_id = l.tenant_id AND m.integration_id = ${rc.integrationId}::uuid AND m.item_id = l.item_id AND m.warehouse_id = d.warehouse_id
              WHERE l.tenant_id = d.tenant_id AND l.document_id = d.id
                AND CASE WHEN m.as_of_snapshot IS NOT NULL THEN NOT pg_visible_in_snapshot(h.created_xid, m.as_of_snapshot)
                         -- 0066 öncesi işaret (görüntü yok): eski zaman kuralı çift başına — gönderimden (sent_at) önce işlenen belge toplama girmiştir.
                         ELSE (m.sent_at IS NULL OR h.occurred_at > m.sent_at) END))
         AND NOT EXISTS (SELECT 1 FROM public.integration_outbox o WHERE o.tenant_id = d.tenant_id AND o.integration_id = ${rc.integrationId}::uuid AND o.flow = 'SHIPMENTS' AND o.entity_id = d.id)
       ORDER BY d.created_at, d.id
       LIMIT 500
      ON CONFLICT ON CONSTRAINT integration_outbox_entity_key DO NOTHING`);
  });
  for (let n = 0; n < SYNC_LIMITS.shipmentsPerRun; n++) {
    const claim = await claimShipment(rc);
    if (claim === "none") return;
    if (claim === "deferred") continue;
    let ext: string;
    try {
      ext = await rc.deps.client.createShipmentDocument(rc.token, rc.companyId, {
        issueDate: claim.issueDate,
        shipmentDate: claim.shipmentDate,
        description: `Etkin WMS · ${claim.number}`.slice(0, 200),
        procurementNumber: claim.number.slice(0, 60),
        contactId: claim.contactId,
        lines: claim.lines,
      });
    } catch (e) {
      // Kesin 4xx red → oluşmadı; diğer her şey (ağ, 5xx, okunamayan başarı) belirsiz → CHECK.
      const definite = e instanceof ProviderError && e.status !== null && e.status >= 400 && e.status < 500;
      const retry = definite && ((e as ProviderError).code === "RATE_LIMITED" || (e as ProviderError).code === "AUTH_FAILED");
      const code = errCode(e);
      await rc.deps.inTenant((tx) =>
        tx.execute(sql`
          UPDATE public.integration_outbox SET status = ${!definite ? "CHECK" : retry && claim.attempts < SYNC_LIMITS.outboxMaxAttempts ? "PENDING" : "FAILED"}, last_error_code = ${code},
                 next_attempt_at = now() + make_interval(mins => ${backoffMinutes(claim.attempts)})
           WHERE tenant_id = ${rc.tenantId}::uuid AND id = ${claim.outboxId}::uuid`),
      );
      rc.c.failed++;
      if (e instanceof ProviderError && (e.code === "AUTH_FAILED" || e.code === "RATE_LIMITED")) throw e;
      continue;
    }
    await rc.deps.inTenant(async (tx) => {
      await tx.execute(sql`UPDATE public.integration_outbox SET status = 'SENT', external_id = ${ext} WHERE tenant_id = ${rc.tenantId}::uuid AND id = ${claim.outboxId}::uuid`);
      await link(tx, rc.ac, "DOCUMENT", claim.documentId, ext, claim.number.slice(0, 200));
    });
    rc.c.created++;
  }
}

async function runFlow(rc: RunCtx): Promise<void> {
  const dir = rc.flow.direction;
  switch (rc.flow.flow) {
    case "PRODUCTS":
      if (pulls(dir)) await pull(rc, "products");
      if (pushes(dir)) await pushCards(rc, "ITEM");
      return;
    case "CONTACTS":
      if (pulls(dir)) await pull(rc, "contacts");
      if (pushes(dir)) await pushCards(rc, "PARTY");
      return;
    case "WAREHOUSES":
      if (pulls(dir)) await pull(rc, "warehouses");
      if (pushes(dir)) await pushCards(rc, "WAREHOUSE");
      return;
    case "STOCK":
      await pushStock(rc);
      return;
    case "SHIPMENTS":
      await pushShipments(rc);
      return;
    case "SALES_ORDERS":
      return; // hiçbir sağlayıcıda yok (catalog); kapalı akış buraya gelmez
  }
}

/**
 * T-1135 koşu günlüğü bakımı (worker `integration.sync` işinin başında, kısa transaction): 40 dk'yı aşan RUNNING satırı FAILED/TIMEOUT
 * (çöken iş), 7 günden eski biten satırlar en çok 500'er budanır. Silme yetkisi yalnız bu tabloda; DB bekçisi yakın geçmişi korur.
 */
export async function maintainRuns(tx: AccessTx, tenantId: string, integrationId: string): Promise<{ readonly timedOut: number; readonly pruned: number }> {
  const t = await tx.execute<{ id: string }>(sql`
    UPDATE public.integration_runs SET status = 'FAILED', error_code = 'TIMEOUT'
     WHERE tenant_id = ${tenantId}::uuid AND integration_id = ${integrationId}::uuid AND status = 'RUNNING'
       AND started_at < now() - make_interval(mins => ${RUN_TIMEOUT_MINUTES}) RETURNING id`);
  const p = await tx.execute<{ id: string }>(sql`
    DELETE FROM public.integration_runs
     WHERE tenant_id = ${tenantId}::uuid AND id IN (
       SELECT id FROM public.integration_runs
        WHERE tenant_id = ${tenantId}::uuid AND integration_id = ${integrationId}::uuid AND status <> 'RUNNING'
          AND started_at < now() - make_interval(days => ${RUN_RETENTION_DAYS})
        ORDER BY started_at LIMIT ${RUN_PRUNE_BATCH})
    RETURNING id`);
  return { timedOut: t.length, pruned: p.length };
}

/** Tek bağlantının açık akışlarını (ya da istenen tek akışı) sırayla çalıştırır. */
export async function runIntegrationSync(deps: SyncDeps, payload: SyncPayload, actorUserId: string | null): Promise<SyncResult> {
  const head = await deps.inTenant(async (tx) => {
    const tenantId = (await currentTenantId(tx)) ?? null;
    if (tenantId === null) return { kind: "skip" as const, reason: "NO_TENANT" };
    const row = await loadIntegration(tx, tenantId, { id: payload.integrationId });
    if (row === null || row.status === "DISCONNECTED" || row.connectedBy === null || row.connectedMembershipId === null) return { kind: "skip" as const, reason: "NOT_CONNECTED" };
    if (!PROVIDER_INFO[row.provider].available) return { kind: "skip" as const, reason: "PROVIDER_UNAVAILABLE" };
    if (!(await connectorAllowed(tx, tenantId, row.connectedMembershipId, row.connectedBy))) {
      await markIntegrationError(tx, tenantId, row.id, "CONNECTOR_REVOKED");
      return { kind: "skip" as const, reason: "CONNECTOR_REVOKED" };
    }
    const flows = await tx.execute<FlowRow>(sql`
      SELECT flow, direction, enabled_at, first_enabled_at, cursor FROM public.integration_flows
       WHERE tenant_id = ${tenantId}::uuid AND integration_id = ${row.id}::uuid AND enabled
         AND (${payload.flow ?? null}::text IS NULL OR flow = ${payload.flow ?? null})`);
    return { kind: "go" as const, tenantId, row, flows: flows.filter((f) => (FLOWS as readonly string[]).includes(f.flow) && flowSupported(row.provider, f.flow)) };
  });
  if (head.kind === "skip") return { kind: "skipped", reason: head.reason };
  if (head.flows.length === 0) return { kind: "skipped", reason: "NO_ENABLED_FLOW" };
  const { tenantId, row } = head;
  // Freeze the connection generation BEFORE selecting/refreshing its token. Never rebind old responses to a new OAuth generation.
  const productBinding=head.flows.some(f=>f.flow==='PRODUCTS'&&pulls(f.direction))
    ?await deps.inTenant(tx=>lifecycleBinding(tx,tenantId,row.id)):null;
  let token: { token: string; accountRef: string };
  try {
    // Belirteç koşunun en uzun süresi boyunca geçerli olmalı (iş süresi 30 dk): koşu ortasında 401 ile kalıcı hata / sahte yeniden giriş olmasın.
    token = await accessToken({ runTx: deps.inTenant, tenantId, integrationId: row.id, client: deps.client, sealer: deps.sealer, minValidityMs: RUN_TOKEN_VALIDITY_MS, ...(deps.now === undefined ? {} : { now: deps.now }) });
  } catch (e) {
    if (e instanceof IntegrationStateError) return { kind: "skipped", reason: e.code };
    if (e instanceof ProviderError && !e.retryable) {
      await deps.inTenant((tx) => markIntegrationError(tx, tenantId, row.id, errCode(e)));
      return { kind: "skipped", reason: errCode(e) };
    }
    throw e;
  }
  if(productBinding&&!(await deps.inTenant(tx=>assertLifecycleBinding(tx,productBinding))))return {kind:"skipped",reason:"NOT_CONNECTED"};
  const ac: ApplyContext = { tenantId, system: PROVIDER_INFO[row.provider].system, actorUserId: row.connectedBy as string, membershipId: row.connectedMembershipId as string };
  await deps.inTenant((tx) => maintainRuns(tx, tenantId, row.id));
  const results: FlowResult[] = [];
  const ordered = [...head.flows].sort((a, b) => ORDER.indexOf(a.flow) - ORDER.indexOf(b.flow));
  for (const flow of ordered) {
    // Koşu sürerken bağlantı kesildiyse / bağlayanın yetkisi kalktıysa sonraki akış çalışmaz (inceleme MINOR-2).
    const still = await deps.inTenant(async (tx) => {
      const cur = await loadIntegration(tx, tenantId, { id: row.id });
      return cur !== null && cur.status === "CONNECTED" && (await connectorAllowed(tx, tenantId, row.connectedMembershipId as string, row.connectedBy as string));
    });
    if (!still) break;
    const runId = randomUUID();
    const requestedBy = payload.trigger === "MANUAL" ? actorUserId : null;
    await deps.inTenant((tx) =>
      tx.execute(sql`INSERT INTO public.integration_runs (tenant_id, id, integration_id, flow, trigger, requested_by)
                     VALUES (${tenantId}::uuid, ${runId}::uuid, ${row.id}::uuid, ${flow.flow}, ${payload.trigger}, ${requestedBy}::uuid)`),
    );
    const c: Counters = { created: 0, updated: 0, linked: 0, skipped: 0, failed: 0, warnings: 0 };
    let errorCode: string | null = null;
    let fatal: unknown = null;
    try {
      await runFlow({ deps, tenantId, integrationId: row.id, companyId: token.accountRef, token: token.token, ac, flow, c, productBinding });
    } catch (e) {
      errorCode = errCode(e);
      fatal = e;
    }
    const status: FlowResult["status"] = errorCode !== null ? "FAILED" : c.failed > 0 ? "PARTIAL" : "SUCCESS";
    // T-1111: zamanlayıcı 30 saniyede bir koşar; değişiklik getirmeyen başarılı zamanlı koşu "Kim ne yaptı?"yı doldurmasın diye audit'e
    // yazılmaz. T-1135: böyle koşu koşu günlüğünde de satır bırakmaz (kendi RUNNING satırı silinir; son kontrol anı akışın `last_run_at`'idir).
    const bos = payload.trigger === "SCHEDULE" && status === "SUCCESS" && c.created + c.updated + c.linked + c.skipped + c.failed + c.warnings === 0;
    await deps.inTenant(async (tx) => {
      if (bos) {
        await tx.execute(sql`DELETE FROM public.integration_runs WHERE tenant_id = ${tenantId}::uuid AND id = ${runId}::uuid AND status = 'RUNNING'`);
      } else {
        await tx.execute(sql`
          UPDATE public.integration_runs SET status = ${status}, created_count = ${c.created}, updated_count = ${c.updated}, linked_count = ${c.linked},
                 skipped_count = ${c.skipped}, failed_count = ${c.failed}, error_code = ${errorCode}
           WHERE tenant_id = ${tenantId}::uuid AND id = ${runId}::uuid AND status = 'RUNNING'`);
      }
      await tx.execute(sql`
        UPDATE public.integration_flows SET last_run_at = now(), last_status = ${status},
               last_success_at = CASE WHEN ${status} = 'FAILED' THEN last_success_at ELSE now() END,
               error_count = CASE WHEN ${status} = 'SUCCESS' THEN 0 ELSE error_count + 1 END,
               last_error_code = ${errorCode ?? (c.failed > 0 ? "ROWS_FAILED" : null)}
         WHERE tenant_id = ${tenantId}::uuid AND integration_id = ${row.id}::uuid AND flow = ${flow.flow}`);
      // Elle başlatılan, değişiklik getiren, uyarı ya da hata veren her koşu audit'e yazılır.
      if (!bos) await appendAudit(tx, {
        action: "integration.synced",
        actorUserId: requestedBy ?? ac.actorUserId,
        entityType: "integration_run",
        entityId: runId,
        changeSummary: { provider: row.provider, flow: flow.flow, direction: flow.direction, trigger: payload.trigger, status, ...c, error: errorCode },
      });
    });
    results.push({ flow: flow.flow, status, counts: { ...c }, errorCode });
    // Geçici sağlayıcı hatası (ağ/5xx/429): sonraki akışlar da büyük olasılıkla düşer; iş yeniden denenir.
    if (fatal instanceof ProviderError && fatal.retryable) throw fatal;
    if (fatal instanceof ProviderError && fatal.code === "AUTH_FAILED") break;
  }
  return { kind: "ran", flows: results };
}
