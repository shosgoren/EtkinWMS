// Dış referans eşlemesi ve senkron imleçleri (T-252) — `0019_external_refs` ile birebir.
//
// - `external_refs` POLİMORFİKTİR (entity_type + entity_id): bileşik FK kasıtlı olarak yoktur (A-252-1); tenant sınırı RLS ile.
// - SÜTUN DÜZEYİ YETKİ: INSERT listesinde `synced_at`/`version` yoktur (varsayılan + tetikleyici); UPDATE yalnız `external_code`
//   (tetikleyici version+1, synced_at). `sync_cursors` UPDATE yalnız imleç sütunları; tetikleyici geriye gitmeyi reddeder.
// - Tablo nesneleri yalnızca `@wms/db/internal/schema` alt yolundan açılır.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const EXTERNAL_REF_ENTITY_TYPES = ["ITEM", "UNIT", "WAREHOUSE", "LOCATION", "PARTY", "DOCUMENT", "LEDGER_ENTRY"] as const;
export type ExternalRefEntityType = (typeof EXTERNAL_REF_ENTITY_TYPES)[number];

export const externalRefs = pgTable(
  "external_refs",
  {
    tenantId: uuid("tenant_id").notNull(),
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    system: text("system").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    externalId: text("external_id").notNull(),
    externalCode: text("external_code"),
    syncedAt: timestamptz("synced_at").notNull().defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    unique("external_refs_tenant_id_id_key").on(t.tenantId, t.id),
    unique("external_refs_entity_key").on(t.tenantId, t.system, t.entityType, t.entityId),
    unique("external_refs_external_key").on(t.tenantId, t.system, t.entityType, t.externalId),
    check("external_refs_system_chk", sql`${t.system} ~ '^[A-Z][A-Z0-9_]{0,31}$'`),
    check(
      "external_refs_entity_type_chk",
      sql`${t.entityType} IN ('ITEM', 'UNIT', 'WAREHOUSE', 'LOCATION', 'PARTY', 'DOCUMENT', 'LEDGER_ENTRY')`,
    ),
    check("external_refs_external_id_chk", sql`btrim(${t.externalId}) <> '' AND char_length(${t.externalId}) <= 200`),
    check(
      "external_refs_external_code_chk",
      sql`${t.externalCode} IS NULL OR (btrim(${t.externalCode}) <> '' AND char_length(${t.externalCode}) <= 200)`,
    ),
    check("external_refs_version_chk", sql`${t.version} >= 1`),
  ],
);

export const syncCursors = pgTable(
  "sync_cursors",
  {
    tenantId: uuid("tenant_id").notNull(),
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    system: text("system").notNull(),
    stream: text("stream").notNull(),
    cursorXid: bigint("cursor_xid", { mode: "bigint" }).notNull().default(sql`0`),
    cursorId: uuid("cursor_id").notNull().default(sql`'00000000-0000-0000-0000-000000000000'`),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("sync_cursors_tenant_id_id_key").on(t.tenantId, t.id),
    unique("sync_cursors_stream_key").on(t.tenantId, t.system, t.stream),
    check("sync_cursors_system_chk", sql`${t.system} ~ '^[A-Z][A-Z0-9_]{0,31}$'`),
    check("sync_cursors_stream_chk", sql`${t.stream} ~ '^[A-Z][A-Z0-9_]{0,63}$'`),
    check("sync_cursors_xid_chk", sql`${t.cursorXid} >= 0`),
  ],
);

export type ExternalRef = typeof externalRefs.$inferSelect;
export type NewExternalRef = typeof externalRefs.$inferInsert;
export type SyncCursor = typeof syncCursors.$inferSelect;
export type NewSyncCursor = typeof syncCursors.$inferInsert;

// T-991 (0055): sağlayıcıdan bağımsız ERP bağlantısı. Ayrıntı ve CHECK/tetikleyici kuralları migration'dadır; burada sütun adı/tipi/NULL'luk
// (drift testi). `credentials` yalnız mühürlü kutu ({v, kid, iv, tag, ct}); düz sır DB'ye yazılamaz.
export const INTEGRATION_PROVIDERS = ["PARASUT", "LOGO"] as const;
export const INTEGRATION_FLOWS = ["PRODUCTS", "CONTACTS", "WAREHOUSES", "SALES_ORDERS", "SHIPMENTS", "STOCK"] as const;
export const INTEGRATION_DIRECTIONS = ["PULL", "PUSH", "BOTH"] as const;

export const integrations = pgTable(
  "integrations",
  {
    tenantId: uuid("tenant_id").notNull(),
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    provider: text("provider").notNull(),
    status: text("status").notNull().default("CONNECTED"),
    accountLabel: text("account_label"),
    accountRef: text("account_ref"),
    credentials: jsonb("credentials"),
    connectedBy: uuid("connected_by"),
    connectedMembershipId: uuid("connected_membership_id"),
    connectedAt: timestamptz("connected_at"),
    lastCheckedAt: timestamptz("last_checked_at"),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
    version: integer("version").notNull().default(1),
    // T-1006 (0056): ERP'den BİR KEZLİK açılış stoku — ayar (varsayılan kapalı) + kilit (alındı zamanı + belge; bir kez dolar, değişmez).
    openingStockEnabled: boolean("opening_stock_enabled").notNull().default(false),
    openingStockTakenAt: timestamptz("opening_stock_taken_at"),
    openingStockDocumentId: uuid("opening_stock_document_id"),
  },
  (t) => [unique("integrations_tenant_id_id_key").on(t.tenantId, t.id), unique("integrations_tenant_provider_key").on(t.tenantId, t.provider)],
);

export const integrationFlows = pgTable(
  "integration_flows",
  {
    tenantId: uuid("tenant_id").notNull(),
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    integrationId: uuid("integration_id").notNull(),
    flow: text("flow").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    direction: text("direction").notNull(),
    enabledAt: timestamptz("enabled_at"),
    cursor: text("cursor"),
    lastRunAt: timestamptz("last_run_at"),
    lastSuccessAt: timestamptz("last_success_at"),
    lastStatus: text("last_status"),
    errorCount: integer("error_count").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (t) => [unique("integration_flows_tenant_id_id_key").on(t.tenantId, t.id), unique("integration_flows_flow_key").on(t.tenantId, t.integrationId, t.flow)],
);

export const integrationRuns = pgTable(
  "integration_runs",
  {
    tenantId: uuid("tenant_id").notNull(),
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    integrationId: uuid("integration_id").notNull(),
    flow: text("flow").notNull(),
    trigger: text("trigger").notNull(),
    status: text("status").notNull().default("RUNNING"),
    requestedBy: uuid("requested_by"),
    startedAt: timestamptz("started_at").notNull().defaultNow(),
    finishedAt: timestamptz("finished_at"),
    createdCount: integer("created_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    linkedCount: integer("linked_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    errorCode: text("error_code"),
  },
  (t) => [unique("integration_runs_tenant_id_id_key").on(t.tenantId, t.id)],
);

export const integrationOutbox = pgTable(
  "integration_outbox",
  {
    tenantId: uuid("tenant_id").notNull(),
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    integrationId: uuid("integration_id").notNull(),
    flow: text("flow").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    status: text("status").notNull().default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamptz("next_attempt_at").notNull().defaultNow(),
    lastErrorCode: text("last_error_code"),
    externalId: text("external_id"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
    sentAt: timestamptz("sent_at"),
  },
  (t) => [unique("integration_outbox_tenant_id_id_key").on(t.tenantId, t.id), unique("integration_outbox_entity_key").on(t.tenantId, t.integrationId, t.flow, t.entityId)],
);

export const integrationStockMarks = pgTable(
  "integration_stock_marks",
  {
    tenantId: uuid("tenant_id").notNull(),
    integrationId: uuid("integration_id").notNull(),
    itemId: uuid("item_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    quantity: numeric("quantity").notNull(),
    sentAt: timestamptz("sent_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: "integration_stock_marks_pkey", columns: [t.tenantId, t.integrationId, t.itemId, t.warehouseId] })],
);
