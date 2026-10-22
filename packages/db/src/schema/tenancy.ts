// Tenant/üyelik tabloları (T-103, ADR-016 §2-3, §9) — `0003_tenancy` ile birebir.
//
// - RLS'li tenant tabloları: tenants (id tenant kimliğidir; tenant_id sütunu yok), tenant_memberships,
//   membership_roles, invitations, tenant_settings (PK tenant_id). Politikalar ve yetkiler migration'dadır.
// - `admin_reset_grants` platform (RLS'siz) tablosudur; `wms_app` yalnızca INSERT yapabilir.
// - Tablo nesneleri yalnızca `@wms/db/internal/schema` alt yolundan açılır, genel yüzeye yalnızca tipler çıkar.
import { sql } from "drizzle-orm";
import { boolean, customType, index, integer, jsonb, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** `time` (saat:dakika); sapma testi information_schema `time without time zone` ile karşılaştırır. */
export const timeOfDay = customType<{ data: string }>({ dataType: () => "time without time zone" });

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const TENANT_STATUSES = ["ACTIVE", "SUSPENDED", "CLOSING"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const MEMBERSHIP_STATUSES = ["ACTIVE", "REMOVED"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/** Hazır roller (ADR-016 §4). İzin matrisi `packages/domain`'dedir (T-113); db yalnızca anahtarları bilir. */
export const ROLE_KEYS = ["TENANT_ADMIN", "WAREHOUSE_MANAGER", "PICKER", "COUNTER", "READ_ONLY"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const INVITATION_DELIVERIES = ["EMAIL", "SCREEN"] as const;
export type InvitationDelivery = (typeof INVITATION_DELIVERIES)[number];

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  slug: text("slug").notNull().unique("tenants_slug_key"),
  name: text("name").notNull(),
  status: text("status").$type<TenantStatus>().notNull().default("ACTIVE"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdByUserId: uuid("created_by_user_id"),
  creationRequestId: uuid("creation_request_id"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export const tenantMemberships = pgTable(
  "tenant_memberships",
  {
    tenantId: uuid("tenant_id").notNull(),
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").notNull(),
    status: text("status").$type<MembershipStatus>().notNull().default("ACTIVE"),
    isOwner: boolean("is_owner").notNull().default(false),
    joinedAt: timestamptz("joined_at").notNull().defaultNow(),
    removedAt: timestamptz("removed_at"),
    rolesVersion: integer("roles_version").notNull().default(0),
    /** T-999 (0048): son kullanım; yalnız girişten sonraki yönlendirme ve seçicideki "SON" işareti. */
    lastUsedAt: timestamptz("last_used_at"),
  },
  (t) => [index("tenant_memberships_user_id_idx").on(t.userId)],
);

export const membershipRoles = pgTable("membership_roles", {
  tenantId: uuid("tenant_id").notNull(),
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  membershipId: uuid("membership_id").notNull(),
  roleKey: text("role_key").$type<RoleKey>().notNull(),
});

export const invitations = pgTable("invitations", {
  tenantId: uuid("tenant_id").notNull(),
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  emailNormalized: text("email_normalized").notNull(),
  roleKey: text("role_key").$type<RoleKey>().notNull(),
  tokenHash: text("token_hash").notNull().unique("invitations_token_hash_key"),
  deliveredVia: text("delivered_via").$type<InvitationDelivery>().notNull(),
  expiresAt: timestamptz("expires_at").notNull(),
  acceptedAt: timestamptz("accepted_at"),
  revokedAt: timestamptz("revoked_at"),
  invitedByMembershipId: uuid("invited_by_membership_id").notNull(),
  claimId: uuid("claim_id"),
  claimExpiresAt: timestamptz("claim_expires_at"),
});

export const tenantSettings = pgTable("tenant_settings", {
  tenantId: uuid("tenant_id").primaryKey(),
  locale: text("locale").notNull(),
  timeZone: text("time_zone").notNull(),
  sectorTemplateKey: text("sector_template_key"),
  sectorTemplateVersion: integer("sector_template_version"),
  terminology: jsonb("terminology").notNull().default(sql`'{}'::jsonb`),
  onboardingStatus: text("onboarding_status").notNull(),
  onboardingSteps: jsonb("onboarding_steps").notNull().default(sql`'[]'::jsonb`),
  // T-301 (A-06): mal kabulde kalite kontrol varsayılan açık; wms_app yalnızca bu sütunu ek olarak UPDATE eder.
  receivingQcEnabled: boolean("receiving_qc_enabled").notNull().default(true),
  // T-302 (A-136): terk edilmiş sayım süresi (saat, 1-168); wms_app yalnızca bu sütunu ek olarak UPDATE eder.
  countAbandonHours: smallint("count_abandon_hours").notNull().default(8),
  // T-989 (I-18): çalışma vardiyası (Görevlerim "VARDİYA 08:00–17:00"); wms_app yalnızca bu iki sütunu ek olarak UPDATE eder.
  shiftStart: timeOfDay("shift_start").notNull().default("08:00"),
  shiftEnd: timeOfDay("shift_end").notNull().default("17:00"),
  // T-416 (A-03): görev ayrılığı (varsayılan kapalı); wms_app yalnızca bu sütunu ek olarak UPDATE eder.
  separationOfDuties: boolean("separation_of_duties").notNull().default(false),
});

export const adminResetGrants = pgTable(
  "admin_reset_grants",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").notNull(),
    issuingTenantId: uuid("issuing_tenant_id").notNull(),
    issuingMembershipId: uuid("issuing_membership_id").notNull(),
    verificationId: uuid("verification_id").notNull().unique("admin_reset_grants_verification_id_key"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    expiresAt: timestamptz("expires_at").notNull(),
  },
  (t) => [index("admin_reset_grants_user_id_idx").on(t.userId)],
);

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type TenantMembership = typeof tenantMemberships.$inferSelect;
export type NewTenantMembership = typeof tenantMemberships.$inferInsert;
export type MembershipRole = typeof membershipRoles.$inferSelect;
export type NewMembershipRole = typeof membershipRoles.$inferInsert;
export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;
export type TenantSettings = typeof tenantSettings.$inferSelect;
export type NewTenantSettings = typeof tenantSettings.$inferInsert;
export type AdminResetGrant = typeof adminResetGrants.$inferSelect;
export type NewAdminResetGrant = typeof adminResetGrants.$inferInsert;

// T-997 (0044, ADR-026 §7): e-postasız saha girişi. Özet sütunları (pin_hash, activation_hash, token_hash) uygulama rolüne kapalıdır;
// erişim `wms_probe.field_*` işlevleriyle. Tanım drift testine (sütun/tip/NULL) karşı birebir.
export const fieldLogins = pgTable("field_logins", {
  tenantId: uuid("tenant_id").notNull(),
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull(),
  membershipId: uuid("membership_id").notNull(),
  username: text("username").notNull(),
  pinHash: text("pin_hash"),
  pinSetAt: timestamptz("pin_set_at"),
  activationHash: text("activation_hash"),
  activationExpiresAt: timestamptz("activation_expires_at"),
  failedCount: integer("failed_count").notNull().default(0),
  activationFailedCount: integer("activation_failed_count").notNull().default(0),
  lockCount: integer("lock_count").notNull().default(0),
  lockedUntil: timestamptz("locked_until"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  createdBy: uuid("created_by"),
});

export const FIELD_DEVICE_KINDS = ["PERSONAL", "SHARED"] as const;
export type FieldDeviceKind = (typeof FIELD_DEVICE_KINDS)[number];

export const fieldDevices = pgTable("field_devices", {
  tenantId: uuid("tenant_id").notNull(),
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tokenHash: text("token_hash").notNull(),
  kind: text("kind").$type<FieldDeviceKind>().notNull(),
  userId: uuid("user_id"),
  name: text("name").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  createdBy: uuid("created_by"),
  lastUsedAt: timestamptz("last_used_at").notNull().defaultNow(),
  expiresAt: timestamptz("expires_at").notNull(),
  revokedAt: timestamptz("revoked_at"),
  revokedBy: uuid("revoked_by"),
  /** T-998 (0045): MANUAL | LOCK_SPREE. */
  revokeReason: text("revoke_reason"),
});

// T-998 (0045): ortak cihaz kaydı (5 dk belirteç → terminal talebi → yönetici onayı). Özet sütunları uygulama rolüne kapalı.
export const fieldEnrollments = pgTable("field_enrollments", {
  tenantId: uuid("tenant_id").notNull(),
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tokenHash: text("token_hash").notNull(),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  expiresAt: timestamptz("expires_at").notNull(),
  claimTokenHash: text("claim_token_hash"),
  claimedAt: timestamptz("claimed_at"),
  deviceName: text("device_name"),
  approvedAt: timestamptz("approved_at"),
  deviceId: uuid("device_id"),
  cancelledAt: timestamptz("cancelled_at"),
  confirmCode: text("confirm_code"),
  confirmFailed: integer("confirm_failed").notNull().default(0),
});

// T-998 (0045): ortak cihazda kilitlenen hesaplar (toplu kilitleme koruması; platform tablosu, yalnız probe işlevi).
export const fieldDeviceLockouts = pgTable("field_device_lockouts", {
  deviceId: uuid("device_id").notNull(),
  userId: uuid("user_id").notNull(),
  lockedAt: timestamptz("locked_at").notNull().defaultNow(),
});

// T-998 (0045): saha oturumu ↔ cihaz (platform tablosu; yalnız kimlik rolü). Cihaz iptalinde oturumlar bu bağla kapanır.
export const fieldSessions = pgTable("field_sessions", {
  sessionId: uuid("session_id").primaryKey(),
  deviceId: uuid("device_id").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

// T-421 (`0051_permission_groups`): hesap sahibinin özel yetki grupları. Rol izinlerine EK yetki ve görünür ekran listesi; RLS, CHECK'ler
// (kapalı yetki/ekran listeleri) ve tetikleyiciler migration'dadır.
export const permissionGroups = pgTable("permission_groups", {
  tenantId: uuid("tenant_id").notNull(),
  id: uuid("id").notNull().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  color: text("color").notNull().default("#2F7D5B"),
  screens: text("screens").array().notNull().default(sql`'{}'`),
  grants: text("grants").array().notNull().default(sql`'{}'`),
  archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});
export const memberGroups = pgTable("member_groups", {
  tenantId: uuid("tenant_id").notNull(),
  membershipId: uuid("membership_id").notNull(),
  groupId: uuid("group_id").notNull(),
  assignedBy: uuid("assigned_by").notNull(),
  assignedAt: timestamp("assigned_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

// T-429 (`0052_team_join`): saha personelinin kendi telefonuyla katılması. Bağlantı (QR, 7 gün, alan başına bir geçerli) ve cihaz talebi
// (6 haneli kod, yönetici onayı). Özet ve kod sütunları uygulama rolüne kapalı; RLS ve probe işlevleri migration'dadır.
export const teamJoinLinks = pgTable("team_join_links", {
  tenantId: uuid("tenant_id").notNull(),
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tokenHash: text("token_hash").notNull(),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  expiresAt: timestamptz("expires_at").notNull(),
  revokedAt: timestamptz("revoked_at"),
});
export const teamJoinRequests = pgTable("team_join_requests", {
  tenantId: uuid("tenant_id").notNull(),
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  linkId: uuid("link_id").notNull(),
  requestHash: text("request_hash").notNull(),
  name: text("name").notNull(),
  username: text("username").notNull(),
  deviceHint: text("device_hint"),
  confirmCode: text("confirm_code").notNull(),
  confirmFailed: integer("confirm_failed").notNull().default(0),
  status: text("status").notNull().default("PENDING"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  expiresAt: timestamptz("expires_at").notNull(),
  decidedBy: uuid("decided_by"),
  decidedAt: timestamptz("decided_at"),
  membershipId: uuid("membership_id"),
  claimedAt: timestamptz("claimed_at"),
  // T-919 (0053): onay kodu doğrulama damgası; yalnız wms_probe.field_join_verify yazar, onay tetikleyicisi okur.
  codeVerifiedBy: uuid("code_verified_by"),
  codeVerifiedAt: timestamptz("code_verified_at"),
});

// T-1006 (0056): ilk kurulum yolculuğu — tenant başına tek satır; yalnız kullanıcı seçimleri (atlanan adımlar, üretim yapıyor mu, kartların
// kaynağı, Excel'de açılış stoku isteği, etiket basıldı işareti, kutlamanın kapatılması). Adımın "tamam"ı gerçek veriden hesaplanır (domain).
export const setupJourneys = pgTable("setup_journeys", {
  tenantId: uuid("tenant_id").primaryKey(),
  makesProduction: boolean("makes_production"),
  cardSource: text("card_source"),
  openingStockWanted: boolean("opening_stock_wanted"),
  skipped: text("skipped").array().notNull().default(sql`'{}'::text[]`),
  labelsPrintedAt: timestamptz("labels_printed_at"),
  dismissedAt: timestamptz("dismissed_at"),
  tourState: text("tour_state"),
  updatedBy: uuid("updated_by"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});
