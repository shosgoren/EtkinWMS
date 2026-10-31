// T-1140 (kullanıcı kararı 31 Ekim 2026): bağlı kartlarda (ürün, cari, depo) GERÇEK iki yönlü eşitleme — "son eşitlemeden beri hangi taraf
// değişti" işareti ve çakışma kuralı. Ağ çağrısı yoktur; sync.ts ve webhook.ts burayı transaction İÇİNDE çağırır, Paraşüt'e gönderimi kendileri
// transaction DIŞINDA yapar (I-14).
//
// İŞARET (`integration_card_states`, 0069): bağlı kart başına son başarılı eşitlemedeki iki tarafın KANONİK alan özeti (`local_hash`,
// `remote_hash`; sha256) ve yerel sütun imzası (`local_sig`; md5, yalnız "değişmiş olabilir" aday seçimi — güvenlik özelliği yok).
//   yerel değişti  = kanonik(yerel) ≠ local_hash          uzak değişti = kanonik(Paraşüt) ≠ remote_hash
// Kanonik alanlar iki tarafta da aynı temizlikten geçer (apply.ts `cleanName` / `partyFields`): ürün ve depo = ad; cari = ad, vergi no,
// vergi dairesi, e-posta, telefon, şehir, ilçe, adres, kısa ad. Cari türü kanonik değildir (Etkin'de BOTH olabilir; apply birleştirir).
//
// KARAR (`decideCardSync`, saf; birim testi):
//   PULL (Paraşüt'ten al): her zaman Paraşüt uygulanır; hiçbir şey gönderilmez.
//   PUSH (Etkin'den gönder): yerel değiştiyse (ya da işaret yoksa ve iki taraf farklıysa) gönderilir; Paraşüt'teki değişiklik hiç alınmaz.
//   BOTH (iki yönlü): iki taraf eşitse işaret yazılır. Yalnız biri değiştiyse o taraf diğerine yansır. İkisi de değiştiyse (ya da işaret yoksa
//   ve farklılarsa) ÇAKIŞMA: son değişen kazanır — Paraşüt `attributes.updated_at` ile Etkin'deki son entegrasyon dışı audit kaydının anı
//   (`audit_logs.occurred_at`, son eşitlemeden sonra) milisaniye olarak karşılaştırılır. Eşitlik ya da zamanlardan biri bilinmiyorsa
//   Paraşüt kazanır. Hiçbir değişiklik sessiz düşmez: `integration.conflict_resolved` audit'i kazananı, dayanağı ve iki zamanı yazar (I-12;
//   değer yazılmaz). Paraşüt'ün `updated_at` alanı gerçek hesapta doğrulanmadı (UNKNOWN): yoksa her çakışma "zaman bilinmiyor → Paraşüt".
import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { appendAudit } from "@wms/db";
import type { AccessTx } from "../identity/access.ts";
import { cleanName, partyFields, refEntity, type ApplyContext, type ApplyOutcome } from "./apply.ts";
import type { Direction, Flow } from "./catalog.ts";
import type { JsonApiResource } from "./parasut.ts";

export type CardEntity = "ITEM" | "PARTY" | "WAREHOUSE";
/** Kanonik alanlar sabit sırada (null = boş). */
export type CardCanon = readonly (string | null)[];

const AUDIT_TYPE: Readonly<Record<CardEntity, string>> = Object.freeze({ ITEM: "item", PARTY: "party", WAREHOUSE: "warehouse" });
/** Yerel değişiklik anı en çok bu kadar geriye aranır (işaret yoksa; audit tablosu zaman dizinli). */
const LOCAL_TIME_LOOKBACK_DAYS = 180;

// --- kanonik biçim ve özet -----------------------------------------------------------------------------------------------------------
export interface PartyLike {
  readonly name: string | null;
  readonly taxNumber: string | null;
  readonly taxOffice: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly city: string | null;
  readonly district: string | null;
  readonly address: string | null;
  readonly shortName: string | null;
}

export function partyCanon(p: PartyLike): CardCanon {
  const f = partyFields({ externalId: "0", accountType: null, ...p });
  if (f === null) return [null, null, null, null, null, null, null, null, null];
  return [f.name, f.taxNo, f.taxOffice, f.email, f.phone, f.city, f.district, f.address, f.shortName];
}

export const nameCanon = (name: unknown): CardCanon => [cleanName(name)];

const s = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** Paraşüt kaynağı → kanonik alanlar (eşleyiciler sync.ts toProduct/toContact ile aynı öznitelikleri okur). */
export function remoteCanon(entity: CardEntity, r: JsonApiResource): CardCanon {
  if (entity !== "PARTY") return nameCanon(r.attributes.name);
  const a = r.attributes;
  return partyCanon({ name: s(a.name), taxNumber: s(a.tax_number), taxOffice: s(a.tax_office), email: s(a.email), phone: s(a.phone), city: s(a.city), district: s(a.district), address: s(a.address), shortName: s(a.short_name) });
}

export function cardHash(entity: CardEntity, canon: CardCanon): string {
  return createHash("sha256").update(JSON.stringify(["card-sync-v1", entity, ...canon])).digest("hex");
}

/** Paraşüt `updated_at` (ISO metin) → epoch ms; yok / okunamaz → null. */
export function remoteUpdatedAt(r: JsonApiResource): number | null {
  const v = r.attributes.updated_at;
  if (typeof v !== "string" || v.length > 64) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

// --- karar (saf) ---------------------------------------------------------------------------------------------------------------------
export interface CardMarker {
  readonly localHash: string | null;
  readonly remoteHash: string | null;
  readonly localSig: string | null;
  readonly syncedAt: string | null;
}

export type ConflictBasis = "NEWER_REMOTE" | "NEWER_LOCAL" | "TIE" | "UNKNOWN_TIME";
export type CardDecision =
  | { readonly kind: "IN_SYNC" }
  | { readonly kind: "NONE" }
  | { readonly kind: "PULL" }
  | { readonly kind: "PUSH" }
  | { readonly kind: "CONFLICT"; readonly winner: "PARASUT" | "ETKIN"; readonly basis: ConflictBasis; readonly baseline: boolean; readonly localAt: number | null; readonly remoteAt: number | null };

/** Çakışmada kazanan: yeni olan; eşitlik ya da bilinmeyen zamanda Paraşüt. */
export function resolveConflict(localAt: number | null, remoteAt: number | null): { readonly winner: "PARASUT" | "ETKIN"; readonly basis: ConflictBasis } {
  if (localAt === null || remoteAt === null || !Number.isFinite(localAt) || !Number.isFinite(remoteAt)) return { winner: "PARASUT", basis: "UNKNOWN_TIME" };
  if (localAt > remoteAt) return { winner: "ETKIN", basis: "NEWER_LOCAL" };
  if (remoteAt > localAt) return { winner: "PARASUT", basis: "NEWER_REMOTE" };
  return { winner: "PARASUT", basis: "TIE" };
}

export interface DecideInput {
  readonly direction: Direction;
  readonly localHash: string;
  /** PUSH'ta Paraşüt okunmadıysa null. */
  readonly remoteHash: string | null;
  readonly marker: CardMarker | null;
  /** Çakışmada istenir (yalnız gerekiyorsa okunur). */
  readonly times?: () => { readonly localAt: number | null; readonly remoteAt: number | null };
}

export function decideCardSync(i: DecideInput): CardDecision {
  const m = i.marker !== null && i.marker.localHash !== null && i.marker.remoteHash !== null ? i.marker : null;
  if (i.direction === "PULL") return i.remoteHash !== null && i.remoteHash === i.localHash ? { kind: "IN_SYNC" } : { kind: "PULL" };
  if (i.direction === "PUSH") {
    if (i.remoteHash !== null && i.remoteHash === i.localHash) return { kind: "IN_SYNC" };
    if (m !== null && m.localHash === i.localHash) return { kind: "NONE" };
    return { kind: "PUSH" };
  }
  if (i.remoteHash === null) return { kind: "NONE" };
  if (i.remoteHash === i.localHash) return { kind: "IN_SYNC" };
  const localChanged = m === null || m.localHash !== i.localHash;
  const remoteChanged = m === null || m.remoteHash !== i.remoteHash;
  if (!localChanged && !remoteChanged) return { kind: "NONE" };
  if (localChanged && !remoteChanged) return { kind: "PUSH" };
  if (!localChanged && remoteChanged) return { kind: "PULL" };
  const t = i.times?.() ?? { localAt: null, remoteAt: null };
  return { kind: "CONFLICT", ...resolveConflict(t.localAt, t.remoteAt), baseline: m !== null, localAt: t.localAt, remoteAt: t.remoteAt };
}

/** Kararın yerel karta Paraşüt değerini uygulayıp uygulamadığı. */
export const pullsRemote = (d: CardDecision): boolean => d.kind === "IN_SYNC" || d.kind === "PULL" || (d.kind === "CONFLICT" && d.winner === "PARASUT");
/** Kararın Paraşüt'e gönderim gerektirip gerektirmediği. */
export const pushesLocal = (d: CardDecision): boolean => d.kind === "PUSH" || (d.kind === "CONFLICT" && d.winner === "ETKIN");

// --- yerel kart okuma ----------------------------------------------------------------------------------------------------------------
export interface LocalCard {
  readonly id: string;
  readonly externalId: string;
  readonly name: string | null;
  readonly taxNumber: string | null;
  readonly taxOffice: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly city: string | null;
  readonly district: string | null;
  readonly address: string | null;
  readonly shortName: string | null;
  readonly active: boolean;
  readonly sig: string;
}

type LocalRow = {
  id: string;
  external_id: string;
  name: string | null;
  tax_no: string | null;
  tax_office: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  short_name: string | null;
  active: boolean;
  sig: string;
  local_hash: string | null;
  remote_hash: string | null;
  local_sig: string | null;
  synced_at: string | null;
};

export function localCanon(entity: CardEntity, c: LocalCard): CardCanon {
  return entity === "PARTY" ? partyCanon(c) : nameCanon(c.name);
}

/** Yerel sütun imzası (aday seçimi): kanonik alanların ham değerleri. Takma ad iç sabittir (kullanıcı girdisi değil). */
function localSig(entity: CardEntity): SQL {
  return entity === "PARTY"
    ? sql`md5(jsonb_build_array(x.name, x.tax_no, x.tax_office, x.email, x.phone, x.city, x.district, x.address, x.short_name)::text)`
    : sql`md5(jsonb_build_array(x.name)::text)`;
}

function localFrom(entity: CardEntity): SQL {
  if (entity === "PARTY")
    return sql`SELECT x.id, r.external_id, x.name, x.tax_no, x.tax_office, x.email, x.phone, x.city, x.district, x.address, x.short_name, (x.archived_at IS NULL) AS active, ${localSig(entity)} AS sig,
                      st.local_hash, st.remote_hash, st.local_sig, st.synced_at::text AS synced_at
                 FROM public.parties x`;
  const table = entity === "ITEM" ? sql`public.items` : sql`public.warehouses`;
  return sql`SELECT x.id, r.external_id, x.name, NULL::text AS tax_no, NULL::text AS tax_office, NULL::text AS email, NULL::text AS phone, NULL::text AS city, NULL::text AS district, NULL::text AS address, NULL::text AS short_name,
                    (x.status = 'ACTIVE') AS active, ${localSig(entity)} AS sig, st.local_hash, st.remote_hash, st.local_sig, st.synced_at::text AS synced_at
               FROM ${table} x`;
}

const toLocal = (r: LocalRow): { local: LocalCard; marker: CardMarker | null } => ({
  local: { id: r.id, externalId: r.external_id, name: r.name, taxNumber: r.tax_no, taxOffice: r.tax_office, email: r.email, phone: r.phone, city: r.city, district: r.district, address: r.address, shortName: r.short_name, active: r.active === true, sig: r.sig },
  marker: r.local_hash === null && r.local_sig === null ? null : { localHash: r.local_hash, remoteHash: r.remote_hash, localSig: r.local_sig, syncedAt: r.synced_at },
});

const joins = (c: ApplyContext, entity: CardEntity) => sql`
  JOIN public.external_refs r ON r.tenant_id = x.tenant_id AND r.system = ${c.system} AND r.entity_type = ${entity} AND r.entity_id = x.id
  LEFT JOIN public.integration_card_states st ON st.tenant_id = x.tenant_id AND st.system = ${c.system} AND st.entity_type = ${entity} AND st.entity_id = x.id`;

export async function loadLocalCard(tx: AccessTx, c: ApplyContext, entity: CardEntity, entityId: string): Promise<{ local: LocalCard; marker: CardMarker | null } | null> {
  const rows = await tx.execute<LocalRow>(sql`${localFrom(entity)} ${joins(c, entity)} WHERE x.tenant_id = ${c.tenantId}::uuid AND x.id = ${entityId}::uuid`);
  return rows[0] === undefined ? null : toLocal(rows[0]);
}

/**
 * Gönderim adayları: bağlı, etkin, yerel imzası son işaretten farklı (ya da işaret yok) kartlar. Kalıcı reddedilip bekletilen kart
 * (`integration_outbox` FAILED; T-1135 / T-1137 "Yeniden dene") seçilmez. Sınır `limit` (kalan sonraki koşuda).
 */
export async function editedCardCandidates(tx: AccessTx, c: ApplyContext, entity: CardEntity, integrationId: string, flow: Flow, limit: number): Promise<{ local: LocalCard; marker: CardMarker | null }[]> {
  const active = entity === "PARTY" ? sql`x.archived_at IS NULL` : sql`x.status = 'ACTIVE'`;
  const rows = await tx.execute<LocalRow>(sql`${localFrom(entity)} ${joins(c, entity)}
     WHERE x.tenant_id = ${c.tenantId}::uuid AND ${active} AND r.external_id ~ '^[0-9]{1,18}$'
       AND (st.local_sig IS NULL OR st.local_sig <> ${localSig(entity)})
       AND NOT EXISTS (SELECT 1 FROM public.integration_outbox ob WHERE ob.tenant_id = x.tenant_id AND ob.integration_id = ${integrationId}::uuid
                        AND ob.flow = ${flow} AND ob.entity_id = x.id AND ob.status = 'FAILED')
     ORDER BY st.local_sig NULLS FIRST, x.id
     LIMIT ${limit}`);
  return rows.map(toLocal);
}

// --- işaret yazımı -------------------------------------------------------------------------------------------------------------------
export interface MarkerWrite {
  readonly localHash: string;
  readonly remoteHash: string;
  readonly localSig: string;
  readonly remoteUpdatedAt: number | null;
  readonly via: "PULL" | "PUSH" | "MATCH";
}

export async function saveCardMarker(tx: AccessTx, c: ApplyContext, entity: CardEntity, entityId: string, w: MarkerWrite): Promise<void> {
  const ra = w.remoteUpdatedAt === null ? null : new Date(w.remoteUpdatedAt).toISOString();
  await tx.execute(sql`
    INSERT INTO public.integration_card_states (tenant_id, system, entity_type, entity_id, local_hash, remote_hash, local_sig, synced_at, remote_updated_at, last_pulled_at, last_pushed_at)
    VALUES (${c.tenantId}::uuid, ${c.system}, ${entity}, ${entityId}::uuid, ${w.localHash}, ${w.remoteHash}, ${w.localSig}, clock_timestamp(), ${ra}::timestamptz,
            CASE WHEN ${w.via} = 'PULL' THEN clock_timestamp() END, CASE WHEN ${w.via} = 'PUSH' THEN clock_timestamp() END)
    ON CONFLICT ON CONSTRAINT integration_card_states_pkey DO UPDATE SET
      local_hash = EXCLUDED.local_hash, remote_hash = EXCLUDED.remote_hash, local_sig = EXCLUDED.local_sig, synced_at = EXCLUDED.synced_at,
      remote_updated_at = EXCLUDED.remote_updated_at,
      last_pulled_at = COALESCE(EXCLUDED.last_pulled_at, integration_card_states.last_pulled_at),
      last_pushed_at = COALESCE(EXCLUDED.last_pushed_at, integration_card_states.last_pushed_at)`);
}

/** Kanonik değişiklik yok (yalnız imza): yalnız imza yenilenir — aday bir daha seçilmez. */
export async function touchCardSig(tx: AccessTx, c: ApplyContext, entity: CardEntity, entityId: string, sig: string): Promise<void> {
  await tx.execute(sql`
    INSERT INTO public.integration_card_states (tenant_id, system, entity_type, entity_id, local_sig) VALUES (${c.tenantId}::uuid, ${c.system}, ${entity}, ${entityId}::uuid, ${sig})
    ON CONFLICT ON CONSTRAINT integration_card_states_pkey DO UPDATE SET local_sig = EXCLUDED.local_sig`);
}

/**
 * Etkin'deki son KANONİK alan değişikliğinin anı (audit, I-12): yalnız bu kiracının, entegrasyon dışı ve kanonik alanı değiştiren eylemleri —
 * ürün `item.updated` (ad değiştiyse), depo `warehouse.updated` (ad), cari `party.created` / `party.updated` (kart formu; kanonik olmayan
 * teslimat seçimi de bu eylemdedir — bilinen yaklaşıklık). Arşiv, barkod, kod vb. ilgisiz kayıtlar sayılmaz (inceleme MINOR-2). İşaret
 * varsa yalnız son eşitlemeden sonrası; bulunmazsa null (çakışmada Paraşüt). Toplu içe aktarma (`party.imported`) karta bağlı değildir → null.
 */
export async function localChangedAt(tx: AccessTx, tenantId: string, entity: CardEntity, entityId: string, since: string | null): Promise<number | null> {
  const which =
    entity === "ITEM"
      ? sql`action = 'item.updated' AND (change_summary->>'from_name') IS DISTINCT FROM (change_summary->>'to_name')`
      : entity === "WAREHOUSE"
        ? sql`action = 'warehouse.updated' AND (change_summary->>'to_name') IS NOT NULL`
        : sql`action IN ('party.created', 'party.updated')`;
  const r = await tx.execute<{ t: string | null }>(sql`
    SELECT (extract(epoch FROM max(occurred_at)) * 1000)::bigint::text AS t FROM public.audit_logs
     WHERE tenant_id = ${tenantId}::uuid AND entity_type = ${AUDIT_TYPE[entity]} AND entity_id = ${entityId}
       AND occurred_at > COALESCE(${since}::timestamptz, now() - make_interval(days => ${LOCAL_TIME_LOOKBACK_DAYS}))
       AND COALESCE(change_summary->>'via', '') <> 'integration' AND ${which}`);
  const t = r[0]?.t;
  return t === null || t === undefined ? null : Number(t);
}

export async function auditConflict(tx: AccessTx, c: ApplyContext, entity: CardEntity, entityId: string, flow: Flow, d: Extract<CardDecision, { kind: "CONFLICT" }>): Promise<void> {
  const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());
  await appendAudit(tx, {
    action: "integration.conflict_resolved",
    actorUserId: c.actorUserId,
    entityType: AUDIT_TYPE[entity],
    entityId,
    // Değer ve dış kimlik yazılmaz (G-09): yalnız kim kazandı ve neden.
    changeSummary: { via: "integration", system: c.system, flow, winner: d.winner, basis: d.basis, baseline: d.baseline, localAt: iso(d.localAt), remoteAt: iso(d.remoteAt) },
  });
}

// --- Paraşüt'ten gelen tek kart (tarama, düzeltme turu ve webhook ortak yolu) ---------------------------------------------------------
export interface RemoteCardInput {
  readonly entity: CardEntity;
  readonly direction: Direction;
  readonly flow: Flow;
  readonly resource: JsonApiResource;
  /** apply.ts yazımı (çağıranın kayıt noktasında). */
  readonly apply: (tx: AccessTx) => Promise<ApplyOutcome>;
}

export type RemoteCardOutcome = ApplyOutcome | "DEFERRED";

/**
 * Paraşüt kartını yerel karta karar kuralıyla uygular ve işareti yazar. "DEFERRED": yerel taraf kazandı (yalnız yerel değişti ya da
 * çakışmada Etkin daha yeni) — uygulanmaz, gönderim düzeltme turunda (sync.ts) yapılır; çakışma audit'i gönderimle birlikte yazılır.
 * PULL'da her zaman uygulanır (eski davranış) ve işaret tutulur (sonradan iki yönlüye geçişte taban hazır olsun).
 */
export async function syncRemoteCard(tx: AccessTx, c: ApplyContext, i: RemoteCardInput): Promise<{ readonly outcome: RemoteCardOutcome; readonly decision: CardDecision }> {
  const remoteHash = cardHash(i.entity, remoteCanon(i.entity, i.resource));
  const remoteAt = remoteUpdatedAt(i.resource);
  const linked = await refEntity(tx, c, i.entity, i.resource.id);
  const mark = async (id: string, via: MarkerWrite["via"]) => {
    const after = await loadLocalCard(tx, c, i.entity, id);
    if (after !== null && after.local.active) await saveCardMarker(tx, c, i.entity, id, { localHash: cardHash(i.entity, localCanon(i.entity, after.local)), remoteHash, localSig: after.local.sig, remoteUpdatedAt: remoteAt, via });
  };
  const decideLinked = async (linked: string): Promise<{ readonly outcome: RemoteCardOutcome; readonly decision: CardDecision }> => {
    const cur = await loadLocalCard(tx, c, i.entity, linked);
    if (cur === null || !cur.local.active || i.direction === "PUSH") {
      // Arşivli / bulunamayan yerel kart: eski davranış (apply arşivli kartı değiştirmez). PUSH'ta bu yol çağrılmaz; çağrılırsa hiçbir şey alınmaz.
      return { outcome: i.direction === "PUSH" ? "UNCHANGED" : await i.apply(tx), decision: { kind: "NONE" } };
    }
    const localHash = cardHash(i.entity, localCanon(i.entity, cur.local));
    let localAt: number | null = null;
    if (i.direction === "BOTH" && localHash !== remoteHash) localAt = await localChangedAt(tx, c.tenantId, i.entity, linked, cur.marker?.syncedAt ?? null);
    const decision = decideCardSync({ direction: i.direction, localHash, remoteHash, marker: cur.marker, times: () => ({ localAt, remoteAt }) });
    if (pushesLocal(decision)) return { outcome: "DEFERRED", decision };
    if (decision.kind === "NONE") return { outcome: "UNCHANGED", decision };
    const outcome = await i.apply(tx);
    await mark(linked, decision.kind === "IN_SYNC" ? "MATCH" : "PULL");
    // Paraşüt kazandı: gerçek çakışmada (iki taraf da değişti) her zaman; tabansız farkta yalnız yerel kart gerçekten değiştiyse yazılır.
    if (decision.kind === "CONFLICT" && (decision.baseline || outcome === "UPDATED")) await auditConflict(tx, c, i.entity, linked, i.flow, decision);
    return { outcome, decision };
  };
  if (linked === null) {
    const outcome = await i.apply(tx);
    const now = await refEntity(tx, c, i.entity, i.resource.id);
    if (now === null) return { outcome, decision: { kind: "PULL" } };
    // İlk bağlama (yeni kart ya da koda / vergi numarasına göre VAR OLAN karta bağlanma): apply bağlanan kartın alanlarını değiştirmez
    // (LINKED). İki taraf farklıyken taban YAZILMAZ — aynı transaction'da bağlı kart kuralı işletilir: işaret yok + fark = çakışma
    // (zaman bilinmezse Paraşüt; Etkin daha yeniyse uygulanmaz, düzeltme turunda gider). Eşitse taban yazılır. (PR 278 inceleme P2)
    if (outcome !== "CREATED") {
      const r = await decideLinked(now);
      return { outcome, decision: r.decision };
    }
    // Paraşüt'ten yeni açılan kart: taban yalnız iki taraf gerçekten eşitse yazılır (değilse işaretsiz kalır, sonraki koşu karar verir).
    const after = await loadLocalCard(tx, c, i.entity, now);
    if (after !== null && cardHash(i.entity, localCanon(i.entity, after.local)) === remoteHash) await mark(now, "PULL");
    return { outcome, decision: { kind: "PULL" } };
  }
  return decideLinked(linked);
}
