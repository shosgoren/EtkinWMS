// T-1109 (B-134): Etkin sesli yanıt firma ayarı (0063). Gerçek DB: varsayılan kapalı; yalnız `settings.manage` yazar (toplayıcı FORBIDDEN);
// her üye okur (yalnız bayrak); başka firmanın adıyla ne okunur ne yazılır; değişiklik `tenant.settings_changed` kaydına düşer, aynı değer
// yazılmaz; wms_auth / wms_worker sütunu yazamaz.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { getVoiceReply, setVoiceReply } from "../../../packages/domain/src/voice/ayar.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";

const env = readIntEnv(process.env);
let app: DbClient, adm: pg.Client, A: TenantWorld, B: TenantWorld;
const as = (w: TenantWorld, userId: string, slug = w.slug) => ({ db: app, principal: { userId, mfaVerified: true }, tenantSlug: slug });
const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return "OK";
  } catch (e) {
    return (e as { code?: string }).code ?? "THROWN";
  }
};
const flag = async (w: TenantWorld): Promise<boolean | undefined> =>
  (await adm.query<{ v: boolean }>("SELECT voice_reply AS v FROM public.tenant_settings WHERE tenant_id = $1", [w.tenantId])).rows[0]?.v;

beforeAll(async () => {
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  await adm.connect();
  const reg = newRegistry();
  A = await seedWorld(adm, reg, "VREPLY1109A");
  B = await seedWorld(adm, reg, "VREPLY1109B");
}, 120000);
afterAll(async () => {
  await adm.end();
  await app.close();
});

describe("Etkin sesli yanıt ayarı", () => {
  it("varsayılan kapalı; her üye okur", async () => {
    expect(await flag(A)).toBe(false);
    expect(await getVoiceReply(as(A, A.ownerUserId))).toBe(false);
    expect(await getVoiceReply(as(A, A.memberUserId))).toBe(false);
  });

  it("yalnız settings.manage yazar; denetim kaydı; aynı değer yazılmaz", async () => {
    expect(await code(setVoiceReply({ ...as(A, A.memberUserId), enabled: true }))).toBe("FORBIDDEN");
    expect(await flag(A)).toBe(false);
    expect(await setVoiceReply({ ...as(A, A.ownerUserId), enabled: true, requestId: "req-1109" })).toEqual({ changed: true });
    expect(await getVoiceReply(as(A, A.memberUserId))).toBe(true);
    expect(await setVoiceReply({ ...as(A, A.ownerUserId), enabled: true })).toEqual({ changed: false });
    const audit = await adm.query<{ change_summary: unknown; actor_user_id: string }>(
      "SELECT change_summary, actor_user_id FROM public.audit_logs WHERE tenant_id = $1 AND action = 'tenant.settings_changed' AND change_summary ? 'voiceReply'",
      [A.tenantId],
    );
    expect(audit.rows).toEqual([{ change_summary: { voiceReply: { from: false, to: true } }, actor_user_id: A.ownerUserId }]);
    expect(await setVoiceReply({ ...as(A, A.ownerUserId), enabled: false })).toEqual({ changed: true });
    expect(await flag(A)).toBe(false);
  });

  it("başka firmanın adıyla okunmaz / yazılmaz (I-01); B değişmez", async () => {
    const before = await flag(B);
    expect(await code(getVoiceReply(as(A, A.ownerUserId, B.slug)))).toMatch(/^(FORBIDDEN|NOT_FOUND)$/);
    expect(await code(setVoiceReply({ ...as(A, A.ownerUserId, B.slug), enabled: true }))).toMatch(/^(FORBIDDEN|NOT_FOUND)$/);
    expect(await flag(B)).toBe(before);
  });

  it("yalnız wms_app sütunu yazabilir", async () => {
    const r = await adm.query<{ app: boolean; auth: boolean | null; worker: boolean | null }>(
      `SELECT has_column_privilege('wms_app','public.tenant_settings','voice_reply','UPDATE') AS app,
              CASE WHEN to_regrole('wms_auth') IS NULL THEN NULL ELSE has_column_privilege('wms_auth','public.tenant_settings','voice_reply','UPDATE') END AS auth,
              CASE WHEN to_regrole('wms_worker') IS NULL THEN NULL ELSE has_column_privilege('wms_worker','public.tenant_settings','voice_reply','UPDATE') END AS worker`,
    );
    expect(r.rows[0]?.app).toBe(true);
    expect(r.rows[0]?.auth).not.toBe(true);
    expect(r.rows[0]?.worker).not.toBe(true);
  });
});
