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
    expect((await migrateDown({ url, to: "0054", wmsEnv: "staging" })).reverted).toEqual(["0056", "0055"]);
    expect((await adm.query("SELECT to_regclass('public.integrations') AS i, to_regclass('public.integration_outbox') AS o, to_regclass('public.external_refs') AS r")).rows[0]).toEqual({ i: null, o: null, r: "external_refs" });
    expect((await migrateUp({ url })).applied).toEqual(["0055", "0056"]);

    const w = await seedWorld(adm, newRegistry(), "M991");
    await adm.query("INSERT INTO public.integrations (tenant_id, provider, status) VALUES ($1, 'PARASUT', 'DISCONNECTED')", [w.tenantId]);
    await expect(migrateDown({ url, to: "0054", wmsEnv: "staging" })).rejects.toThrow(/0055_integrations down: public\.integrations tablosunda satır var/);
    expect(await top(adm)).toBe("0055");
    expect((await adm.query("SELECT count(*)::int AS n FROM public.integrations")).rows[0]?.n).toBe(1);
    const forced = await adm.query<{ f: boolean }>("SELECT relforcerowsecurity AS f FROM pg_class WHERE oid = 'public.integrations'::regclass");
    expect(forced.rows[0]?.f).toBe(true);
  });
}, 120_000);
