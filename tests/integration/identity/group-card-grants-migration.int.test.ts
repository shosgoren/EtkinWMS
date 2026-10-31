// T-1142 (0070): kart anahtarlarını gruba verdiren CHECK genişlemesinin geri alma sözleşmesi, ayrı scratch veritabanında. Boşken 0070 → 0069 →
// 0070 temiz; kart anahtarı taşıyan grup varsa down izinsiz ortamda REDDEDER (üye yetkisi sessizce düşmez) ve defter 0070'te kalır; izinli
// ortamda yalnız kart anahtarları silinir, eski anahtarlar korunur ve eski kısıt geri gelir.
import { randomBytes } from "node:crypto";
import pg from "pg";
import { expect, it } from "vitest";
import { migrateDown, migrateUp } from "../../../packages/db/src/migrate.ts";
import { newRegistry, seedWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";

const env = readIntEnv(process.env);

async function scratch(run: (url: string, adm: pg.Client) => Promise<void>): Promise<void> {
  const name = `wms_grp_${randomBytes(6).toString("hex")}`;
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

it("0070 boşken geri alınır ve yeniden uygulanır; kart anahtarlı grup varken down reddedilir; izinli ortamda yalnız kart anahtarları silinir", async () => {
  await scratch(async (url, adm) => {
    expect(await top(adm)).toBe("0070");
    expect((await migrateDown({ url, to: "0069", wmsEnv: "staging" })).reverted).toEqual(["0070"]);
    expect((await migrateUp({ url })).applied).toEqual(["0070"]);

    const w = await seedWorld(adm, newRegistry(), "M1142");
    const g = await adm.query<{ id: string }>("INSERT INTO public.permission_groups (tenant_id, name, grants, created_by) VALUES ($1, 'Kart', ARRAY['stock.post','items.edit','parties.create'], $2) RETURNING id", [
      w.tenantId,
      w.ownerMembershipId,
    ]);
    const plain = await adm.query<{ id: string }>("INSERT INTO public.permission_groups (tenant_id, name, grants, created_by) VALUES ($1, 'Eski', ARRAY['data.import'], $2) RETURNING id", [
      w.tenantId,
      w.ownerMembershipId,
    ]);
    await expect(migrateDown({ url, to: "0069", wmsEnv: "staging" })).rejects.toThrow(/0070_group_card_grants down: kart yetkisi taşıyan 1 grup/);
    expect(await top(adm)).toBe("0070");
    const kept = await adm.query<{ grants: string[] }>("SELECT grants FROM public.permission_groups WHERE id = $1", [g.rows[0]?.id]);
    expect(kept.rows[0]?.grants).toEqual(["stock.post", "items.edit", "parties.create"]);

    expect((await migrateDown({ url, to: "0069", wmsEnv: "ci" })).reverted).toEqual(["0070"]);
    const after = await adm.query<{ id: string; grants: string[] }>("SELECT id, grants FROM public.permission_groups WHERE tenant_id = $1 ORDER BY name", [w.tenantId]);
    expect(after.rows).toEqual([
      { id: plain.rows[0]?.id, grants: ["data.import"] },
      { id: g.rows[0]?.id, grants: ["stock.post"] },
    ]);
    await expect(
      adm.query("INSERT INTO public.permission_groups (tenant_id, name, grants, created_by) VALUES ($1, 'Kaçak', ARRAY['items.edit'], $2)", [w.tenantId, w.ownerMembershipId]),
    ).rejects.toThrow(/permission_groups_grants_chk/);
    const force = await adm.query<{ f: boolean }>("SELECT relforcerowsecurity AS f FROM pg_class WHERE oid = 'public.permission_groups'::regclass");
    expect(force.rows[0]?.f).toBe(true);
    expect((await migrateUp({ url })).applied).toEqual(["0070"]);
  });
});
