// T-991 (0055): geri alma sözleşmesi, ayrı scratch veritabanında. Boş şemada 0055 → 0054 → 0055 temiz; bağlantı/akış satırı varsa down veriyi
// silmeden REDDEDER (bağlantı ve gönderim geçmişi kaybolmaz) ve defter 0055'te kalır; 0019 `external_refs` eşlemeleri down'dan etkilenmez.
import { randomBytes } from "node:crypto";
import pg from "pg";
import { expect, it } from "vitest";
import { migrateDown, migrateUp } from "../../../packages/db/src/migrate.ts";
import { newRegistry, seedWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";

const env = readIntEnv(process.env);

async function scratch(run: (url: string, adm: pg.Client) => Promise<void>): Promise<void> {
  const name = `wms_erp_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: env.databaseUrlDirect });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const u = new URL(env.databaseUrlDirect);
  u.pathname = `/${name}`;
  const url = u.toString();
  const adm = new pg.Client({ connectionString: url });
  try {
    await adm.connect();
    await migrateUp({ url });
    await run(url, adm);
  } finally {
    await adm.end();
    await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.end();
  }
}

const top = async (adm: pg.Client): Promise<string | undefined> =>
  (await adm.query<{ version: string }>("SELECT version FROM wms_meta.schema_migrations ORDER BY version DESC LIMIT 1")).rows[0]?.version;

it("0055 boşken geri alınır ve yeniden uygulanır; dolu veride down reddedilir, veri ve defter korunur", async () => {
  await scratch(async (url, adm) => {
    expect((await migrateDown({ url, to: "0054", wmsEnv: "staging" })).reverted).toEqual(["0061", "0060", "0059", "0058", "0057", "0056", "0055"]);
    expect((await adm.query("SELECT to_regclass('public.integrations') AS i, to_regclass('public.integration_outbox') AS o, to_regclass('public.external_refs') AS r")).rows[0]).toEqual({ i: null, o: null, r: "external_refs" });
    expect((await migrateUp({ url })).applied).toEqual(["0055", "0056", "0057","0058", "0059", "0060", "0061"]);

    const w = await seedWorld(adm, newRegistry(), "M991");
    await adm.query("INSERT INTO public.integrations (tenant_id, provider, status) VALUES ($1, 'PARASUT', 'DISCONNECTED')", [w.tenantId]);
    await expect(migrateDown({ url, to: "0054", wmsEnv: "staging" })).rejects.toThrow(/0055_integrations down: public\.integrations tablosunda satır var/);
    expect(await top(adm)).toBe("0055");
    expect((await adm.query("SELECT count(*)::int AS n FROM public.integrations")).rows[0]?.n).toBe(1);
    const forced = await adm.query<{ f: boolean }>("SELECT relforcerowsecurity AS f FROM pg_class WHERE oid = 'public.integrations'::regclass");
    expect(forced.rows[0]?.f).toBe(true);
  });
}, 120_000);

it("0060 kaynak kart bilgisi varken geri alma veri kaybetmeden reddedilir", async () => {
  await scratch(async (url, adm) => {
    const w = await seedWorld(adm, newRegistry(), "M1062");
    await adm.query("UPDATE public.items SET source_product_info='{\"PARASUT\":{\"gtip\":\"400821\"}}'::jsonb WHERE tenant_id=$1 AND id=$2", [w.tenantId, w.itemNoneId]);
    await expect(migrateDown({ url, to: "0059", wmsEnv: "staging" })).rejects.toThrow(/0060 down: product source information is in use/);
    expect(await top(adm)).toBe("0060");
    expect((await adm.query("SELECT source_product_info FROM public.items WHERE tenant_id=$1 AND id=$2", [w.tenantId, w.itemNoneId])).rows[0]?.source_product_info).toEqual({ PARASUT: { gtip: "400821" } });
    expect((await adm.query("SELECT relforcerowsecurity AS f FROM pg_class WHERE oid='public.items'::regclass")).rows[0]?.f).toBe(true);
  });
}, 120_000);

it("0061 refuses rollback with encrypted customer configuration and retains FORCE RLS",async()=>{
 await scratch(async(url,adm)=>{
 const w=await seedWorld(adm,newRegistry(),"M1066");
 await adm.query(`INSERT INTO integration_oauth_apps(tenant_id,credentials) VALUES($1,'{"v":2,"kid":"synthetic","iv":"synthetic","tag":"synthetic","ct":"synthetic"}')`,[w.tenantId]);
 await expect(migrateDown({url,to:"0060",wmsEnv:"staging"})).rejects.toThrow(/0061 down/);
 expect(await top(adm)).toBe("0061");expect((await adm.query("SELECT relforcerowsecurity AS f FROM pg_class WHERE oid='public.integration_oauth_apps'::regclass")).rows[0]?.f).toBe(true);
 });
},120_000);
