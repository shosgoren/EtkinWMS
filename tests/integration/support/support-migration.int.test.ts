// T-967 (0054): geri alma sözleşmesi, ayrı scratch veritabanında. Boş şemada 0054 → 0053 → 0054 temiz; talep/yazışma varsa down veriyi
// silmeden REDDEDER (müşteri yazışması kaybolmaz) ve defter 0054'te kalır.
import { randomBytes } from "node:crypto";
import pg from "pg";
import { expect, it } from "vitest";
import { migrateDown, migrateUp } from "../../../packages/db/src/migrate.ts";
import { newRegistry, seedWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";

const env = readIntEnv(process.env);

async function scratch(run: (url: string, adm: pg.Client) => Promise<void>): Promise<void> {
  const name = `wms_support_${randomBytes(6).toString("hex")}`;
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

it("0054 boşken geri alınır ve yeniden uygulanır; dolu veride down reddedilir, veri ve defter korunur", async () => {
  await scratch(async (url, adm) => {
    expect((await migrateDown({ url, to: "0053", wmsEnv: "staging" })).reverted).toEqual(["0066", "0065", "0064", "0063", "0062", "0061", "0060", "0059", "0058", "0057", "0056", "0055", "0054"]);
    expect((await adm.query("SELECT to_regclass('public.support_tickets') AS t, to_regclass('public.support_ticket_messages') AS m")).rows[0]).toEqual({ t: null, m: null });
    expect((await adm.query("SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'wms_probe' AND p.proname LIKE 'platform_support_%'")).rows[0]?.n).toBe(0);
    expect((await migrateUp({ url })).applied).toEqual(["0054", "0055", "0056", "0057","0058", "0059", "0060", "0061", "0062", "0063", "0064", "0065", "0066"]);

    const w = await seedWorld(adm, newRegistry(), "M967");
    await adm.query("BEGIN");
    await adm.query("SELECT set_config('app.current_tenant_id', $1, true), set_config('app.current_user_id', $2, true)", [w.tenantId, w.ownerUserId]);
    const t = await adm.query<{ id: string }>("INSERT INTO public.support_tickets (tenant_id, created_by, membership_id, subject_kind, body) VALUES ($1, $2, $3, 'BUG', 'korunmalı') RETURNING id", [w.tenantId, w.ownerUserId, w.ownerMembershipId]);
    await adm.query("INSERT INTO public.support_ticket_messages (tenant_id, ticket_id, author_kind, author_user_id, body) VALUES ($1, $2, 'CUSTOMER', $3, 'ek')", [w.tenantId, t.rows[0]?.id, w.ownerUserId]);
    await adm.query("COMMIT");

    await expect(migrateDown({ url, to: "0053", wmsEnv: "staging" })).rejects.toThrow(/0054_support_tickets down: public\.support_ticket_messages tablosunda satır var/);
    expect(await top(adm)).toBe("0054");
    expect((await adm.query("SELECT count(*)::int AS n FROM public.support_tickets")).rows[0]?.n).toBe(1);
    expect((await adm.query("SELECT count(*)::int AS n FROM public.support_ticket_messages")).rows[0]?.n).toBe(1);
    const forced = await adm.query<{ f: boolean }>("SELECT relforcerowsecurity AS f FROM pg_class WHERE oid = 'public.support_tickets'::regclass");
    expect(forced.rows[0]?.f).toBe(true);
  });
}, 120_000);
