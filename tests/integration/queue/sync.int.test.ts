// T-411: canlı yayın kuyruk eşitlemesi (`syncQueues`). Yalnız eksik kuyrukları oluşturur; migration rolü dışında reddeder; yetki/RLS
// değiştirmez (uygulama rolünün pgboss yetkileri eşitlemeden sonra aynı kalır). Kurulum (`installQueueSchema`) test düzeneğinde yapılmıştır.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { QUEUE_SCHEMA, installQueueSchema, syncQueues } from "../../../packages/queue-adapter/src/index.ts";
import { JOB_TYPES } from "../../../packages/shared/src/queue.ts";
import { readIntEnv } from "../harness/env.ts";

const env = readIntEnv(process.env);
let adm: pg.Client;

async function appGrants(): Promise<string> {
  const r = await adm.query<{ g: string }>(
    `SELECT string_agg(table_name || ':' || privilege_type, ',' ORDER BY table_name, privilege_type) AS g
       FROM information_schema.role_table_grants WHERE table_schema = $1 AND grantee IN ('wms_app', 'wms_worker')`,
    [QUEUE_SCHEMA],
  );
  return r.rows[0]?.g ?? "";
}

beforeAll(async () => {
  await installQueueSchema({ url: env.databaseUrlDirect });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  await adm.connect();
}, 120_000);

afterAll(async () => {
  await installQueueSchema({ url: env.databaseUrlDirect }).catch(() => undefined);
  await adm.end();
}, 120_000);

describe("syncQueues (T-411)", () => {
  it("kurulu şemada yeni kuyruk açmaz (hepsi var), bütün iş türlerinin kuyruğu vardır, yetkiler değişmez", async () => {
    const before = await appGrants();
    expect(await syncQueues({ url: env.databaseUrlDirect })).toEqual([]);
    const q = await adm.query(`SELECT count(*)::int AS n FROM ${QUEUE_SCHEMA}.queue WHERE name = ANY($1::text[])`, [[...JOB_TYPES]]);
    expect((q.rows[0] as { n: number }).n).toBe(JOB_TYPES.length);
    expect(await appGrants()).toBe(before);
  }, 120_000);

  it("uygulama rolüyle reddedilir", async () => {
    await expect(syncQueues({ url: env.databaseUrl })).rejects.toMatchObject({ name: "QueueInstallError" });
  }, 60_000);
});
