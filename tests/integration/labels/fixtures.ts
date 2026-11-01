// Synthetic isolated label rows for DB/AC04 tests. No production identity or real printer.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { TenantWorld } from "../fixtures/tenants.ts";
import { defaultLabelDesign } from "../../../packages/domain/src/labels/editor/model.ts";

export const LABEL_TABLES = ["label_templates", "label_template_versions", "label_assets", "label_printers", "label_preferences", "label_defaults", "label_print_jobs"] as const;
export async function seedLabels(c: pg.Client, w: TenantWorld) {
  const template = randomUUID(), version = randomUUID(), asset = randomUUID(), printer = randomUUID(), preference = randomUUID(), job = randomUUID();
  const design = JSON.stringify(defaultLabelDesign("PRODUCT"));
  await c.query("INSERT INTO public.label_templates (tenant_id,id,name,context,draft,created_by) VALUES ($1,$2,'Synthetic','PRODUCT',$3,$4)", [w.tenantId,template,design,w.ownerMembershipId]);
  await c.query("INSERT INTO public.label_template_versions (tenant_id,id,template_id,context,revision,design,created_by) VALUES ($1,$2,$3,'PRODUCT',1,$4,$5)", [w.tenantId,version,template,design,w.ownerMembershipId]);
  await c.query("UPDATE public.label_templates SET published_version_id=$1 WHERE tenant_id=$2 AND id=$3", [version,w.tenantId,template]);
  // Schema constraint fixture; PNG content validation is the domain upload boundary, not this SQL fixture.
  await c.query("INSERT INTO public.label_assets (tenant_id,id,png,sha256,width,height,created_by) VALUES ($1,$2,$3,$4,1,1,$5)", [w.tenantId,asset,Buffer.alloc(67),"a".repeat(64),w.ownerMembershipId]);
  await c.query("INSERT INTO public.label_printers (tenant_id,id,name,created_by) VALUES ($1,$2,'Browser test',$3)", [w.tenantId,printer,w.ownerMembershipId]);
  await c.query("INSERT INTO public.label_preferences (tenant_id,id,template_id,printer_id) VALUES ($1,$2,$3,$4)", [w.tenantId,preference,template,printer]);
  await c.query("INSERT INTO public.label_defaults (tenant_id,context,template_id,version_id) VALUES ($1,'PRODUCT',$2,$3)", [w.tenantId,template,version]);
  await c.query("INSERT INTO public.label_print_jobs (tenant_id,id,template_id,version_id,context,snapshot,copies,printer_id,created_by) VALUES ($1,$2,$3,$4,'PRODUCT','[{\"code\":\"SYNTHETIC\"}]',1,$5,$6)", [w.tenantId,job,template,version,printer,w.ownerMembershipId]);
  return { template,version,asset,printer,preference,job };
}
