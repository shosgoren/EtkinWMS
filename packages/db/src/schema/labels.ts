// T-1154: 0072 column/type/null parity. SQL migration owns composite FKs, bounded CHECKs, FORCE RLS and column grants.
// Published-version back-reference is DEFERRABLE INITIALLY IMMEDIATE in SQL (ORM cannot express its maintenance timing).
import { boolean, customType, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
const stamp=(name:string)=>timestamp(name,{withTimezone:true,mode:"date"});
const bytea=customType<{data:Buffer}>({dataType:()=>"bytea"});
export const labelTemplates=pgTable("label_templates",{
 tenantId:uuid("tenant_id").notNull(),id:uuid("id").notNull().defaultRandom(),name:text("name").notNull(),context:text("context").notNull(),draft:jsonb("draft").notNull(),version:integer("version").notNull().default(1),publishedVersionId:uuid("published_version_id"),archivedAt:stamp("archived_at"),createdBy:uuid("created_by").notNull(),createdAt:stamp("created_at").notNull().defaultNow(),updatedAt:stamp("updated_at").notNull().defaultNow(),
},t=>[primaryKey({columns:[t.tenantId,t.id]}),unique().on(t.tenantId,t.id,t.context)]);
export const labelTemplateVersions=pgTable("label_template_versions",{
 tenantId:uuid("tenant_id").notNull(),id:uuid("id").notNull().defaultRandom(),templateId:uuid("template_id").notNull(),context:text("context").notNull(),revision:integer("revision").notNull(),design:jsonb("design").notNull(),createdBy:uuid("created_by").notNull(),createdAt:stamp("created_at").notNull().defaultNow(),
},t=>[primaryKey({columns:[t.tenantId,t.id]}),unique().on(t.tenantId,t.templateId,t.revision),unique().on(t.tenantId,t.id,t.templateId,t.context)]);
export const labelAssets=pgTable("label_assets",{
 tenantId:uuid("tenant_id").notNull(),id:uuid("id").notNull().defaultRandom(),png:bytea("png").notNull(),sha256:text("sha256").notNull(),width:integer("width").notNull(),height:integer("height").notNull(),createdBy:uuid("created_by").notNull(),createdAt:stamp("created_at").notNull().defaultNow(),
},t=>[primaryKey({columns:[t.tenantId,t.id]}),unique().on(t.tenantId,t.sha256)]);
export const labelPrinters=pgTable("label_printers",{
 tenantId:uuid("tenant_id").notNull(),id:uuid("id").notNull().defaultRandom(),name:text("name").notNull(),mode:text("mode").notNull().default("SYSTEM_DIALOG"),dpi:integer("dpi").notNull().default(203),offsetX:integer("offset_x").notNull().default(0),offsetY:integer("offset_y").notNull().default(0),active:boolean("active").notNull().default(true),version:integer("version").notNull().default(1),createdBy:uuid("created_by").notNull(),createdAt:stamp("created_at").notNull().defaultNow(),
},t=>[primaryKey({columns:[t.tenantId,t.id]})]);
export const labelPreferences=pgTable("label_preferences",{
 tenantId:uuid("tenant_id").notNull(),id:uuid("id").notNull().defaultRandom(),templateId:uuid("template_id"),membershipId:uuid("membership_id"),deviceId:uuid("device_id"),printerId:uuid("printer_id"),version:integer("version").notNull().default(1),updatedAt:stamp("updated_at").notNull().defaultNow(),
},t=>[primaryKey({columns:[t.tenantId,t.id]}),unique().on(t.tenantId,t.templateId,t.membershipId,t.deviceId).nullsNotDistinct()]);
export const labelDefaults=pgTable("label_defaults",{
 tenantId:uuid("tenant_id").notNull(),context:text("context").notNull(),templateId:uuid("template_id").notNull(),versionId:uuid("version_id").notNull(),version:integer("version").notNull().default(1),updatedAt:stamp("updated_at").notNull().defaultNow(),
},t=>[primaryKey({columns:[t.tenantId,t.context]})]);
export const labelPrintJobs=pgTable("label_print_jobs",{
 tenantId:uuid("tenant_id").notNull(),id:uuid("id").notNull().defaultRandom(),templateId:uuid("template_id").notNull(),versionId:uuid("version_id").notNull(),context:text("context").notNull(),snapshot:jsonb("snapshot").notNull(),copies:integer("copies").notNull(),printerId:uuid("printer_id"),createdBy:uuid("created_by").notNull(),reprintOf:uuid("reprint_of"),reason:text("reason"),createdAt:stamp("created_at").notNull().defaultNow(),
},t=>[primaryKey({columns:[t.tenantId,t.id]})]);
