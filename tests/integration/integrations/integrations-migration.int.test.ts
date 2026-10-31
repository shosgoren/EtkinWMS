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
    expect((await migrateDown({ url, to: "0054", wmsEnv: "staging" })).reverted).toEqual(["0067", "0066", "0065", "0064", "0063", "0062", "0061", "0060", "0059", "0058", "0057", "0056", "0055"]);
    expect((await adm.query("SELECT to_regclass('public.integrations') AS i, to_regclass('public.integration_outbox') AS o, to_regclass('public.external_refs') AS r")).rows[0]).toEqual({ i: null, o: null, r: "external_refs" });
    expect((await migrateUp({ url })).applied).toEqual(["0055", "0056", "0057","0058", "0059", "0060", "0061", "0062", "0063", "0064", "0065", "0066", "0067"]);

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


it("0062 retains lifecycle data on rollback and preserves the real-card delete guard",async()=>{
 await scratch(async(url,adm)=>{
  const w=await seedWorld(adm,newRegistry(),"M1067");
  expect((await adm.query("SELECT has_column_privilege('wms_app','public.items','source_state','UPDATE') AS u, EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.items'::regclass AND tgname='items_sample_delete_guard' AND tgenabled='A') AS guarded")).rows[0]).toEqual({u:true,guarded:true});
  await adm.query("BEGIN");
  try {
    await adm.query("SET LOCAL ROLE wms_app");
    await adm.query("SELECT set_config('app.current_tenant_id',$1,true)",[w.tenantId]);
    expect((await adm.query("SELECT id FROM items WHERE tenant_id=$1 AND id=$2",[w.tenantId,w.itemId])).rowCount).toBe(1);
    expect((await adm.query("DELETE FROM items WHERE tenant_id=$1 AND id=$2",[w.tenantId,w.itemId])).rowCount).toBe(0);
  } finally { await adm.query("ROLLBACK"); }

  await adm.query("UPDATE items SET source_state='ARCHIVED',source_disposition='ARCHIVED',source_managed_archive=true,status='ARCHIVED',archived_at=now(),source_checked_at=now() WHERE tenant_id=$1 AND id=$2",[w.tenantId,w.itemId]);
  await expect(migrateDown({url,to:"0061",wmsEnv:"staging"})).rejects.toThrow("product lifecycle data exists; rollback refused");
  expect(await top(adm)).toBe("0062");
  expect((await adm.query("SELECT source_state,status FROM items WHERE tenant_id=$1 AND id=$2",[w.tenantId,w.itemId])).rows[0]).toEqual({source_state:"ARCHIVED",status:"ARCHIVED"});
 });
},120_000);

it("T-1135 0066: ikisi de açık bağlantıda STOCK kapanır + audit; ilk açılış anı doldurulur; kart kuyruğu ya da ilk açılış geçmişi varken down reddedilir", async () => {
  await scratch(async (url, adm) => {
    expect((await migrateDown({ url, to: "0065", wmsEnv: "staging" })).reverted).toEqual(["0067", "0066"]);
    const w = await seedWorld(adm, newRegistry(), "M1135");
    const other = await seedWorld(adm, newRegistry(), "M1135B");
    const mk = async (tenant: string, stock: boolean) => {
      const id = (await adm.query<{ id: string }>("INSERT INTO public.integrations (tenant_id, provider, status) VALUES ($1, 'PARASUT', 'DISCONNECTED') RETURNING id", [tenant])).rows[0]?.id as string;
      await adm.query("INSERT INTO public.integration_flows (tenant_id, integration_id, flow, enabled, direction) VALUES ($1, $2, 'STOCK', $3, 'PUSH'), ($1, $2, 'SHIPMENTS', true, 'PUSH')", [tenant, id, stock]);
      return id;
    };
    const both = await mk(w.tenantId, true);
    const onlyShip = await mk(other.tenantId, false);
    expect((await migrateUp({ url })).applied).toEqual(["0066", "0067"]);
    const flows = async (id: string) => (await adm.query("SELECT flow, enabled, first_enabled_at IS NOT NULL AS first FROM public.integration_flows WHERE integration_id = $1 ORDER BY flow", [id])).rows;
    expect(await flows(both)).toEqual([{ flow: "SHIPMENTS", enabled: true, first: true }, { flow: "STOCK", enabled: false, first: true }]);
    expect(await flows(onlyShip)).toEqual([{ flow: "SHIPMENTS", enabled: true, first: true }, { flow: "STOCK", enabled: false, first: false }]);
    const audit = (await adm.query("SELECT tenant_id, entity_id, change_summary->>'via' AS via, change_summary->>'flow' AS flow, change_summary->>'enabled' AS enabled FROM public.audit_logs WHERE action = 'integration.flow_changed' AND change_summary->>'via' = 'migration_0066'")).rows;
    expect(audit).toEqual([{ tenant_id: w.tenantId, entity_id: both, via: "migration_0066", flow: "STOCK", enabled: "false" }]);
    await adm.query("INSERT INTO public.integration_outbox (tenant_id, integration_id, flow, entity_type, entity_id, status) VALUES ($1, $2, 'CONTACTS', 'PARTY', gen_random_uuid(), 'FAILED')", [w.tenantId, both]);
    // T-1138: her geri alma ayrı transaction'dır; 0067 (webhook verisi yok) önce geri alınır, 0066 bekçisi reddeder.
    await expect(migrateDown({ url, to: "0065", wmsEnv: "staging" })).rejects.toThrow(/0066_integration_guards down/);
    expect(await top(adm)).toBe("0066");
    await adm.query("DELETE FROM public.integration_outbox WHERE flow = 'CONTACTS'");
    // Kapatılan STOCK'un ilk açılış anı enabled_at'ten farklı (kapat/aç geçmişi): veri kaybettiren down yine reddedilir; yalnız izinli ortamda iner.
    await expect(migrateDown({ url, to: "0065", wmsEnv: "staging" })).rejects.toThrow(/ilk açılış geçmişi \(1\)/);
    expect(await top(adm)).toBe("0066");
    expect((await migrateDown({ url, to: "0065", wmsEnv: "ci" })).reverted).toEqual(["0066"]);
    expect((await adm.query("SELECT has_table_privilege('wms_app', 'public.integration_runs', 'DELETE') AS d")).rows[0]).toEqual({ d: false });
    expect((await migrateUp({ url })).applied).toEqual(["0066", "0067"]);
    expect((await adm.query("SELECT has_table_privilege('wms_app', 'public.integration_runs', 'DELETE') AS d")).rows[0]).toEqual({ d: true });
  });
}, 120_000);
