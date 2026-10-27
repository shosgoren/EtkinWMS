// Katalog ve izlenebilirlik tabloları (T-204) — `0011_catalog_traceability` ile birebir.
//
// - RLS'li tenant tabloları (ENABLE+FORCE, USING+WITH CHECK); politikalar, CHECK'ler, bileşik FK'ler, tetikleyiciler
//   (taşıma birimi döngü reddi, temel birim dönüşüm reddi) ve yetkiler migration'dadır (şema yalnızca tip kaynağıdır).
// - SAPMA (drift testi): migration `numeric(20,6)` kullanır; information_schema.data_type yalnızca `numeric` döner ve
//   drift testinin TYPE_ALIAS tablosu boştur, bu yüzden Drizzle tanımı duyarlılıksız `numeric`tir (miktar/katsayı string,
//   float yok — I-09). Kesinlik kaynağı migration'dır.
// - `item_barcodes` tekilliği `UNIQUE NULLS NOT DISTINCT (tenant_id, item_id, unit_id, barcode)`; (tenant_id, barcode)
//   indeksi bilerek benzersiz değildir (A-69).
// - Tablo nesneleri yalnızca `@wms/db/internal/schema` alt yolundan açılır, genel yüzeye yalnızca tipler çıkar.
import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, numeric, pgTable, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const CATALOG_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];
export const TRACKING_MODES = ["NONE", "LOT", "SERIAL", "LOT_AND_SERIAL"] as const;
export type TrackingMode = (typeof TRACKING_MODES)[number];
export const PICK_POLICIES = ["FIFO", "FEFO"] as const;
export type PickPolicy = (typeof PICK_POLICIES)[number];
/** Ürün kartı türü (0031, T-911): HM hammadde, YM yarı mamul, MM mamul, TM ticari mal. Sıra ekrandaki sıradır. */
export const ITEM_CARD_TYPES = ["HM", "YM", "MM", "TM"] as const;
export type ItemCardType = (typeof ITEM_CARD_TYPES)[number];
export const HANDLING_UNIT_KINDS = ["KOLI", "PALET", "VARIL"] as const;
export type HandlingUnitKind = (typeof HANDLING_UNIT_KINDS)[number];
export const HANDLING_UNIT_STATUSES = ["OPEN", "CLOSED", "EMPTIED"] as const;
export type HandlingUnitStatus = (typeof HANDLING_UNIT_STATUSES)[number];

export const units = pgTable(
  "units",
  {
    tenantId: uuid("tenant_id").notNull(),
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    code: text("code").notNull(),
    name: text("name").notNull(),
    status: text("status").$type<CatalogStatus>().notNull().default("ACTIVE"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    archivedAt: timestamptz("archived_at"),
  },
  (t) => [
    unique("units_tenant_id_id_key").on(t.tenantId, t.id),
    unique("units_tenant_code_key").on(t.tenantId, t.code),
  ],
);

export const items = pgTable(
  "items",
  {
    tenantId: uuid("tenant_id").notNull(),
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    code: text("code").notNull(),
    name: text("name").notNull(),
    baseUnitId: uuid("base_unit_id").notNull(),
    trackingMode: text("tracking_mode").$type<TrackingMode>().notNull().default("NONE"),
    quantityScale: smallint("quantity_scale").notNull().default(0),
    pickPolicy: text("pick_policy").$type<PickPolicy>().notNull().default("FIFO"),
    status: text("status").$type<CatalogStatus>().notNull().default("ACTIVE"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    archivedAt: timestamptz("archived_at"),
    /** 0060: izinli kaynak kart alanları; fiyat ve miktar içermez. */
    sourceProductInfo: jsonb("source_product_info").notNull().default(sql`'{}'::jsonb`),
    sourceState: text("source_state").notNull().default("ACTIVE"),
    sourceDisposition: text("source_disposition").notNull().default("NONE"),
    sourceManagedArchive: boolean("source_managed_archive").notNull().default(false),
    sourceCheckedAt: timestamptz("source_checked_at"),
    sourceMissingSince: timestamptz("source_missing_since"),
    sourceMissingContext: text("source_missing_context"),
    /** Kart türü (0031, T-911): HM hammadde, YM yarı mamul, MM mamul, TM ticari mal. */
    cardType: text("card_type").$type<ItemCardType>().notNull().default("TM"),
    /** Örnek veri işareti (0040, T-996). */
    isSample: boolean("is_sample").notNull().default(false),
  },
  (t) => [
    unique("items_tenant_id_id_key").on(t.tenantId, t.id),
    unique("items_tenant_code_key").on(t.tenantId, t.code),
    index("items_tenant_base_unit_idx").on(t.tenantId, t.baseUnitId),
    index("items_tenant_card_type_idx").on(t.tenantId, t.cardType),
    index("items_source_check_idx").on(t.tenantId, t.sourceCheckedAt, t.id),
    check("items_quantity_scale_chk", sql`${t.quantityScale} BETWEEN 0 AND 6`),
    check("items_card_type_chk", sql`${t.cardType} IN ('HM', 'YM', 'MM', 'TM')`),
  ],
);

export const unitConversions = pgTable(
  "unit_conversions",
  {
    tenantId: uuid("tenant_id").notNull(),
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    itemId: uuid("item_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    toBaseFactor: numeric("to_base_factor").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("unit_conversions_tenant_id_id_key").on(t.tenantId, t.id),
    unique("unit_conversions_tenant_item_unit_key").on(t.tenantId, t.itemId, t.unitId),
    index("unit_conversions_tenant_unit_idx").on(t.tenantId, t.unitId),
  ],
);

export const itemBarcodes = pgTable(
  "item_barcodes",
  {
    tenantId: uuid("tenant_id").notNull(),
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    itemId: uuid("item_id").notNull(),
    unitId: uuid("unit_id"),
    barcode: text("barcode").notNull(),
    quantity: numeric("quantity"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("item_barcodes_tenant_id_id_key").on(t.tenantId, t.id),
    unique("item_barcodes_tenant_item_unit_barcode_key").on(t.tenantId, t.itemId, t.unitId, t.barcode).nullsNotDistinct(),
    index("item_barcodes_tenant_barcode_idx").on(t.tenantId, t.barcode),
    index("item_barcodes_tenant_unit_idx").on(t.tenantId, t.unitId),
  ],
);

export const inventoryOwners = pgTable(
  "inventory_owners",
  {
    tenantId: uuid("tenant_id").notNull(),
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    code: text("code").notNull(),
    name: text("name").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("inventory_owners_tenant_id_id_key").on(t.tenantId, t.id),
    unique("inventory_owners_tenant_code_key").on(t.tenantId, t.code),
  ],
);

export const lots = pgTable(
  "lots",
  {
    tenantId: uuid("tenant_id").notNull(),
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    itemId: uuid("item_id").notNull(),
    lotCode: text("lot_code").notNull(),
    productionDate: date("production_date", { mode: "string" }),
    expiryDate: date("expiry_date", { mode: "string" }),
    packageDates: date("package_dates", { mode: "string" }).array().notNull().generatedAlwaysAs(sql`ARRAY[production_date,expiry_date]`),
    supplierLot: text("supplier_lot"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("lots_package_snapshot_key").on(t.tenantId,t.id,t.lotCode,t.packageDates),
    unique("lots_tenant_id_id_key").on(t.tenantId, t.id),
    unique("lots_tenant_item_id_key").on(t.tenantId, t.itemId, t.id),
    unique("lots_tenant_item_lot_code_key").on(t.tenantId, t.itemId, t.lotCode),
  ],
);

export const serials = pgTable(
  "serials",
  {
    tenantId: uuid("tenant_id").notNull(),
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    itemId: uuid("item_id").notNull(),
    serialNo: text("serial_no").notNull(),
    lotId: uuid("lot_id"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("serials_tenant_id_id_key").on(t.tenantId, t.id),
    unique("serials_tenant_item_id_key").on(t.tenantId, t.itemId, t.id),
    unique("serials_tenant_item_serial_no_key").on(t.tenantId, t.itemId, t.serialNo),
    index("serials_tenant_lot_idx").on(t.tenantId, t.lotId),
  ],
);

export const handlingUnits = pgTable(
  "handling_units",
  {
    tenantId: uuid("tenant_id").notNull(),
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    kind: text("kind").$type<HandlingUnitKind>().notNull(),
    code: text("code").notNull(),
    parentId: uuid("parent_id"),
    packageReceiptId: uuid("package_receipt_id"),
    packageProductionId: uuid("package_production_id"),
    locationId: uuid("location_id"),
    status: text("status").$type<HandlingUnitStatus>().notNull().default("OPEN"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("handling_units_package_receipt_key").on(t.tenantId,t.id,t.packageReceiptId),
    unique("handling_units_tenant_id_id_key").on(t.tenantId, t.id),
    unique("handling_units_tenant_code_key").on(t.tenantId, t.code),
    index("handling_units_tenant_parent_idx").on(t.tenantId, t.parentId),
    index("handling_units_tenant_location_idx").on(t.tenantId, t.locationId),
  ],
);

export type Unit = typeof units.$inferSelect;
export type NewUnit = typeof units.$inferInsert;
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type UnitConversion = typeof unitConversions.$inferSelect;
export type NewUnitConversion = typeof unitConversions.$inferInsert;
export type ItemBarcode = typeof itemBarcodes.$inferSelect;
export type NewItemBarcode = typeof itemBarcodes.$inferInsert;
export type InventoryOwner = typeof inventoryOwners.$inferSelect;
export type NewInventoryOwner = typeof inventoryOwners.$inferInsert;
export type Lot = typeof lots.$inferSelect;
export type NewLot = typeof lots.$inferInsert;
export type Serial = typeof serials.$inferSelect;
export type NewSerial = typeof serials.$inferInsert;
export type HandlingUnit = typeof handlingUnits.$inferSelect;
export type NewHandlingUnit = typeof handlingUnits.$inferInsert;

/**
 * Kod geçmişi (T-251, `0018_code_history`): ürün/depo/lokasyon kodu değişimlerinin ekle-yalnız kaydı. POLİMORFİKTİR
 * (`entity_type` + `entity_id`): bileşik FK kasıtlı olarak yoktur (tenant sınırı RLS ile). `wms_app` yalnızca SELECT/INSERT.
 */
export const CODE_HISTORY_ENTITY_TYPES = ["item", "warehouse", "location"] as const;
export type CodeHistoryEntityType = (typeof CODE_HISTORY_ENTITY_TYPES)[number];

export const codeHistory = pgTable(
  "code_history",
  {
    tenantId: uuid("tenant_id").notNull(),
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    oldCode: text("old_code").notNull(),
    newCode: text("new_code").notNull(),
    changedAt: timestamptz("changed_at").notNull().defaultNow(),
    changedBy: uuid("changed_by").notNull(),
  },
  (t) => [
    unique("code_history_tenant_id_id_key").on(t.tenantId, t.id),
    index("code_history_tenant_old_code_idx").on(t.tenantId, t.entityType, t.oldCode, t.changedAt.desc()),
    index("code_history_tenant_entity_idx").on(t.tenantId, t.entityType, t.entityId, t.changedAt.desc()),
    check("code_history_entity_type_chk", sql`${t.entityType} IN ('item', 'warehouse', 'location')`),
    check("code_history_codes_chk", sql`btrim(${t.oldCode}) <> '' AND btrim(${t.newCode}) <> '' AND ${t.oldCode} <> ${t.newCode}`),
  ],
);

// T-428 (`0050_parties`): cari kartlar (müşteri / tedarikçi). Fiziksel silme yok (arşiv); `updated_at`/`version` tetikleyicide.
export const PARTY_KINDS = ["CUSTOMER", "SUPPLIER", "BOTH"] as const;
export type PartyKind = (typeof PARTY_KINDS)[number];
export const parties = pgTable(
  "parties",
  {
    tenantId: uuid("tenant_id").notNull(),
    id: uuid("id").notNull().default(sql`gen_random_uuid()`),
    code: text("code").notNull(),
    codeKey: text("code_key").notNull(),
    name: text("name").notNull(),
    kind: text("kind").$type<PartyKind>().notNull().default("CUSTOMER"),
    taxNo: text("tax_no"),
    taxOffice: text("tax_office"),
    phone: text("phone"),
    email: text("email"),
    city: text("city"),
    address: text("address"),
    archivedAt: timestamptz("archived_at"),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (t) => [unique("parties_tenant_code_key").on(t.tenantId, t.codeKey), index("parties_tenant_name_idx").on(t.tenantId, t.name)],
);
