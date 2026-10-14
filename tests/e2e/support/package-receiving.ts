// T-938: synthetic local fixtures; all stock effects use the real UI/actions/domain.
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { localClient, loginEmptyTenant, packageActor, type PackageWorkflow } from "./empty-tenant.ts";
type Row = Record<string, string>;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
function lit(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return `'${String(v).replaceAll("'", "''")}'`;
}
function pgEnv(url: string): NodeJS.ProcessEnv {
  const u = new URL(url);
  if (!LOOPBACK.has(u.hostname)) throw new Error("e2e: fikstür veritabanı loopback değil; yerel olmayan sunucuya yazılmaz");
  return {
    PATH: process.env.PATH,
    PGHOST: u.hostname.replace(/^\[|\]$/g, ""),
    PGPORT: u.port === "" ? "5432" : u.port,
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, "")),
  };
}
/** Sterilize hata: yalnızca çıkış durumu; argv, ortam, URL ve psql çıktısı iletiye girmez. */
function sanitized(e: unknown): Error {
  const err = e as { code?: string; status?: number | null };
  if (err.code === "ENOENT") return new Error("e2e: psql bulunamadı (PostgreSQL istemcisi kurulu olmalı: postgresql-client)");
  return new Error(`e2e: fikstür SQL başarısız (psql çıkış durumu ${err.status ?? "?"})`);
}
export async function db<T = Row>(text: string, params: unknown[] = [], url: string | undefined = process.env.DATABASE_URL_DIRECT): Promise<T[]> {
  if (url === undefined || url === "") throw new Error("e2e: DATABASE_URL_DIRECT yok (globalSetup .env yükler)");
  const env = pgEnv(url);
  const sql = text.replace(/\$(\d+)/g, (_m, i: string) => lit(params[Number(i) - 1]));
  const isSelect = /^\s*SELECT/i.test(sql);
  const wrapped = isSelect ? `SELECT COALESCE(json_agg(t), '[]'::json) FROM (${sql}) t` : sql;
  try {
    const out = execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-X", "-q", "-A", "-t"], { input: wrapped, encoding: "utf8", env, stdio: ["pipe", "pipe", "pipe"] });
    return isSelect ? (JSON.parse(out.trim() || "[]") as T[]) : [];
  } catch (e) {
    throw sanitized(e);
  }
}

export interface PackageFixture { slug: string; tenantId: string; warehouseId: string; locationId: string; itemId: string; kg: string; gr: string; name: string; lot: boolean }
const fixtures: PackageFixture[] = [];
export async function cleanupPackages(): Promise<void> {
 for (const f of fixtures.splice(0)) {
  await db("UPDATE public.items SET status='ARCHIVED',archived_at=now() WHERE tenant_id=$1 AND id=$2",[f.tenantId,f.itemId]);
  await db("UPDATE public.locations SET status='ARCHIVED',archived_at=now() WHERE tenant_id=$1 AND id=$2",[f.tenantId,f.locationId]);
  await db("UPDATE public.warehouses SET status='ARCHIVED',archived_at=now() WHERE tenant_id=$1 AND id=$2",[f.tenantId,f.warehouseId]);
 }
}
export async function seedPackage(page: Page, mobile: boolean, lot = false, workflow: PackageWorkflow = "receiving"): Promise<PackageFixture> {
 if (process.env.E2E_BASE_URL?.trim()) throw new Error("e2e: package fixtures require a local target; remote stock writes prohibited");
 const actor = packageActor(workflow,mobile), client = localClient(actor.clientIp);
 if (client.extraHTTPHeaders !== undefined) await page.setExtraHTTPHeaders(client.extraHTTPHeaders);
 const {slug}=await loginEmptyTenant(page,actor.fixture);
 const tenantId=(await db<{id:string}>("SELECT id FROM public.tenants WHERE slug=$1",[slug]))[0]?.id;
 if(!tenantId)throw new Error("e2e: package tenant missing");
 const units=await db<{id:string;code:string}>("SELECT id,code FROM public.units WHERE tenant_id=$1 AND code IN ('KG','GR') AND status='ACTIVE'",[tenantId]);
 const kg=units.find(u=>u.code==="KG")?.id,gr=units.find(u=>u.code==="GR")?.id;
 if(!kg||!gr)throw new Error("e2e: real KG/GR catalog units missing");
 const f={slug,tenantId,kg,gr,warehouseId:randomUUID(),locationId:randomUUID(),itemId:randomUUID(),name:`Pkg ${randomUUID().slice(0,8)} <img src=x onerror=alert(1)>`,lot};
 fixtures.push(f);
 await db("INSERT INTO public.warehouses(tenant_id,id,code,name) VALUES($1,$2,$3,'Package QA')",[tenantId,f.warehouseId,f.warehouseId]);
 await db("INSERT INTO public.locations(tenant_id,id,warehouse_id,code,name,depth,kind) VALUES($1,$2,$3,'PACKAGE-QA','Package receiving',0,'RECEIVING')",[tenantId,f.locationId,f.warehouseId]);
 await db("INSERT INTO public.items(tenant_id,id,code,name,base_unit_id,tracking_mode,quantity_scale) VALUES($1,$2,$3,$4,$5,$6,3)",[tenantId,f.itemId,f.itemId,f.name,kg,lot?"LOT":"NONE"]);
 await db("INSERT INTO public.unit_conversions(tenant_id,item_id,unit_id,to_base_factor) VALUES($1,$2,$3,0.001)",[tenantId,f.itemId,gr]);
 return f;
}
export async function fillPackage(page:Page,f:PackageFixture,unit=f.kg,count="5",quantity="200") {
 await page.goto(`/t/${f.slug}/receipts/packages`);
 await page.getByLabel("Ürün ara").fill(f.name);
 await page.getByRole("button",{name:`${f.itemId} · ${f.name}`,exact:true}).click();
 await page.getByRole("button",{name:"Paketlere geç",exact:true}).click();
 await page.getByRole("combobox",{name:"Depo",exact:true}).selectOption(f.warehouseId);
 await page.getByLabel("Kabul lokasyonu").selectOption(f.locationId);
 await page.getByLabel("Miktar birimi").selectOption(unit);
 await page.getByLabel("Paket adedi (1–200)",{exact:true}).fill(count);
 await page.getByRole("textbox",{name:"Her paket Paket miktarı",exact:true}).fill(quantity);
}
export async function documentId(page:Page):Promise<string> {
 await expect(page).toHaveURL(/\?document=[0-9a-f-]{36}/);
 const id=new URL(page.url()).searchParams.get("document");if(!id)throw new Error("e2e: prepared document missing");return id;
}
export async function identities(f:PackageFixture,document:string):Promise<string[]> {
 return (await db<{id:string}>("SELECT p.id FROM public.receipt_packages p JOIN public.inbound_receipts r ON r.tenant_id=p.tenant_id AND r.id=p.receipt_id WHERE p.tenant_id=$1 AND r.package_document_id=$2 ORDER BY p.package_no",[f.tenantId,document])).map(p=>p.id);
}
export async function assertStock(f:PackageFixture,document:string,n:number,total:string) {
 const rows=await db<{rp:number;hu:number;lines:number;receiptlines:number;ledger:number;total:string}>("SELECT count(DISTINCT p.id)::int rp,count(DISTINCT h.id)::int hu,count(DISTINCT l.id)::int lines,count(DISTINCT rl.id)::int receiptlines,count(DISTINCT sl.id)::int ledger,sum(sl.quantity)::text total FROM public.receipt_packages p JOIN public.inbound_receipts r ON r.tenant_id=p.tenant_id AND r.id=p.receipt_id JOIN public.handling_units h ON h.tenant_id=p.tenant_id AND h.id=p.id JOIN public.document_lines l ON l.tenant_id=p.tenant_id AND l.id=p.document_line_id JOIN public.inbound_receipt_lines rl ON rl.tenant_id=p.tenant_id AND rl.id=p.receipt_line_id JOIN public.documents d ON d.tenant_id=p.tenant_id AND d.id=p.document_id AND d.kind='STOCK_IN' AND d.status='POSTED' JOIN public.stock_ledger sl ON sl.tenant_id=l.tenant_id AND sl.document_line_id=l.id AND sl.document_id=r.package_document_id WHERE p.tenant_id=$1 AND r.package_document_id=$2",[f.tenantId,document]);
 expect(rows).toEqual([{rp:n,hu:n,lines:n,receiptlines:n,ledger:n,total}]);
}
export async function posted(page:Page) {await expect(page.getByRole("heading",{name:"✓ Kabul edildi",exact:true})).toBeVisible();}
