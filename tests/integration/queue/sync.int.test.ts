// T-411: canlı yayın kuyruk eşitlemesi (`syncQueues`). Yalnız eksik kuyrukları oluşturur; migration rolü dışında reddeder; yetki/RLS
// değiştirmez (uygulama rolünün pgboss yetkileri eşitlemeden sonra aynı kalır). Kurulum (`installQueueSchema`) test düzeneğinde yapılmıştır.
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { QUEUE_SCHEMA, installQueueSchema, syncQueues } from "../../../packages/queue-adapter/src/index.ts";
import { JOB_TYPES } from "../../../packages/shared/src/queue.ts";
import { readIntEnv, readWorkerDatabaseUrl } from "../harness/env.ts";

// `pg-boss` yalnızca kuyruk bağdaştırıcısının bağımlılığıdır; kökten çözülemez → packages/queue-adapter çözümleyicisi.
const qaRequire = createRequire(path.resolve(import.meta.dirname, "../../../packages/queue-adapter/package.json"));
interface Boss {
  start(): Promise<unknown>;
  stop(o: { graceful: boolean; close: boolean }): Promise<void>;
  deleteQueue(name: string): Promise<void>;
  getQueue(name: string): Promise<unknown>;
  send(name: string, data: object): Promise<string | null>;
  fetch<T>(name: string, o: { batchSize: number }): Promise<{ id: string; data: T }[]>;
  complete(name: string, id: string): Promise<unknown>;
}
const { PgBoss } = (await import(pathToFileURL(qaRequire.resolve("pg-boss")).href)) as { PgBoss: new (o: Record<string, unknown>) => Boss };

const env = readIntEnv(process.env);
const workerUrl = readWorkerDatabaseUrl(process.env);
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

  it("eksik kuyruğu oluşturur; oluşan kuyruğa uygulama rolü gönderir, worker rolü alır (yetki/RLS ek işlem gerektirmez)", async () => {
    // Platform işi (tenantId null): wms_app tenant bağlamı olmadan gönderir (job RLS), wms_worker tüm işleri alır.
    const type = "platform.activation.deliver";
    const owner = new PgBoss({ connectionString: env.databaseUrlDirect, schema: QUEUE_SCHEMA, migrate: false, supervise: false, registerInstance: false, schedule: false, useListenNotify: false, max: 1 });
    await owner.start();
    try {
      await owner.deleteQueue(type);
      expect(await owner.getQueue(type)).toBeNull();
    } finally {
      await owner.stop({ graceful: false, close: true });
    }
    const before = await appGrants();
    expect(await syncQueues({ url: env.databaseUrlDirect })).toEqual([type]);
    expect(await syncQueues({ url: env.databaseUrlDirect })).toEqual([]);
    expect(await appGrants()).toBe(before);

    // Üretimdeki `createJobQueue` ayarları: uygulama/worker rolleri yönetim tablolarına (instance, bam, ...) erişemez.
    const opts = {
      schema: QUEUE_SCHEMA,
      migrate: false,
      createSchema: false,
      supervise: false,
      registerInstance: false,
      schedule: false,
      reindex: false,
      useListenNotify: false,
      max: 1,
    } as const;
    const sender = new PgBoss({ ...opts, connectionString: env.databaseUrl });
    const consumer = new PgBoss({ ...opts, connectionString: workerUrl });
    await sender.start();
    await consumer.start();
    try {
      const marker = randomUUID();
      const id = await sender.send(type, { v: 1, tenantId: null, payload: { demoRequestId: marker } });
      expect(typeof id).toBe("string");
      const jobs = await consumer.fetch<{ payload: { demoRequestId: string } }>(type, { batchSize: 10 });
      const mine = jobs.find((j) => j.id === id);
      expect(mine?.data.payload.demoRequestId).toBe(marker);
      await consumer.complete(type, id as string);
    } finally {
      await sender.stop({ graceful: false, close: true });
      await consumer.stop({ graceful: false, close: true });
    }
  }, 120_000);

  it("uygulama rolüyle reddedilir", async () => {
    await expect(syncQueues({ url: env.databaseUrl })).rejects.toMatchObject({ name: "QueueInstallError" });
  }, 60_000);
});
