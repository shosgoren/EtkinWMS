// T-421: özel yetki grupları — yalnız hesap sahibi yazar; grup rol izinlerine EK yetki verir (birleşim), arşivde uygulanmaz;
// hassas yetki MFA ister; hesap sahibi gruba konamaz; ekip yönetimi grupla verilemez; başka alan göremez (RLS + uygulama).
// GERÇEK roller (wms_app, pooler); fikstür yalnızca DATABASE_URL_DIRECT ile.
import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { runTenantQuery } from "../../../packages/domain/src/identity/access.ts";
import { listGroups, saveGroup, setGroupArchived, setMemberGroup } from "../../../packages/domain/src/identity/groups.ts";
import { mkMembership, mkUser, newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";

const env = readIntEnv(process.env);
const reg = newRegistry();
let app: DbClient;
let adm: pg.Client;
let A: TenantWorld;
let B: TenantWorld;
let PICKER: string;
let PICKER_M: string;
let ADMIN2: string;

const recentAuth = async (): Promise<void> => undefined;
const call = (userId: string, w: TenantWorld, mfaVerified = true) => ({ db: app, principal: { userId, mfaVerified }, tenantSlug: w.slug, requestId: randomUUID(), recentAuth });
const can = (userId: string, w: TenantWorld, permission: "document.create" | "data.import", mfaVerified = true) =>
  runTenantQuery({ db: app, principal: { userId, mfaVerified }, tenantSlug: w.slug, permission }, async () => true).catch((e: unknown) => e);

beforeAll(async () => {
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  await adm.connect();
  A = await seedWorld(adm, reg, "A421");
  B = await seedWorld(adm, reg, "B421");
  PICKER = await mkUser(adm, reg, "A421 picker");
  PICKER_M = await mkMembership(adm, A.tenantId, PICKER, { roles: ["PICKER"] });
  ADMIN2 = await mkUser(adm, reg, "A421 admin2");
  await mkMembership(adm, A.tenantId, ADMIN2, { roles: ["TENANT_ADMIN"] });
}, 120_000);

afterAll(async () => {
  await adm.end();
  await app.close();
}, 60_000);

describe("T-421 yetki grupları", () => {
  it("grup ek yetki verir; hassas yetki MFA ister; arşivlenince ve gruptan çıkınca yetki düşer", async () => {
    expect(await can(PICKER, A, "document.create")).toMatchObject({ code: "FORBIDDEN" });
    const g = await saveGroup({ ...call(A.ownerUserId, A), name: "Satın alma", color: "#2F5DA8", screens: ["receive", "count"], grants: ["document.create", "data.import"] });
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(await setMemberGroup({ ...call(A.ownerUserId, A), memberId: PICKER_M, groupId: g.id })).toEqual({ ok: true, changed: true });
    expect(await can(PICKER, A, "document.create")).toBe(true);
    expect(await can(PICKER, A, "data.import")).toBe(true);
    // Hassas yetki taşıyan üye MFA'sız giremez (rolü PICKER olsa bile).
    expect(await can(PICKER, A, "document.create", false)).toMatchObject({ code: "FORBIDDEN", detail: "MFA_REQUIRED" });

    const overview = await listGroups(call(A.ownerUserId, A));
    expect(overview.canEdit).toBe(true);
    expect(overview.groups.find((x) => x.id === g.id)).toMatchObject({ memberCount: 1, grants: ["document.create", "data.import"], screens: ["receive", "count"] });
    expect(overview.members.find((m) => m.membershipId === PICKER_M)?.groupId).toBe(g.id);
    expect(JSON.stringify(overview.members)).not.toContain("@example.test"); // e-posta yanıta girmez

    // Yetki azaltılınca hemen düşer; hassas yetki kalmayınca MFA istenmez.
    const upd = await saveGroup({ ...call(A.ownerUserId, A), id: g.id, expectedVersion: g.version, name: "Satın alma", color: "#2F5DA8", screens: ["receive"], grants: ["document.create"] });
    expect(upd).toMatchObject({ ok: true, version: g.version + 1 });
    expect(await can(PICKER, A, "data.import")).toMatchObject({ code: "FORBIDDEN" });
    expect(await can(PICKER, A, "document.create", false)).toBe(true);
    await expect(saveGroup({ ...call(A.ownerUserId, A), id: g.id, expectedVersion: g.version, name: "Eski" })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });

    const arch = await setGroupArchived({ ...call(A.ownerUserId, A), id: g.id, expectedVersion: upd.ok ? upd.version : 0, archived: true });
    expect(arch.ok).toBe(true);
    expect(await can(PICKER, A, "document.create")).toMatchObject({ code: "FORBIDDEN" });
    expect(await setMemberGroup({ ...call(A.ownerUserId, A), memberId: PICKER_M, groupId: g.id })).toEqual({ ok: true, changed: false });
    const back = await setGroupArchived({ ...call(A.ownerUserId, A), id: g.id, expectedVersion: arch.ok ? arch.version : 0, archived: false });
    expect(back.ok).toBe(true);
    expect(await can(PICKER, A, "document.create")).toBe(true);
    expect(await setMemberGroup({ ...call(A.ownerUserId, A), memberId: PICKER_M, groupId: null })).toEqual({ ok: true, changed: true });
    expect(await can(PICKER, A, "document.create")).toMatchObject({ code: "FORBIDDEN" });

    const audits = await adm.query<{ action: string }>(
      "SELECT action FROM public.audit_logs WHERE tenant_id = $1 AND action IN ('group.created','group.updated','group.archived','group.restored','member.group_changed') ORDER BY created_xid::text::bigint",
      [A.tenantId],
    );
    expect(audits.rows.map((r) => r.action)).toEqual(["group.created", "member.group_changed", "group.updated", "group.archived", "group.restored", "member.group_changed"]);
  });

  it("yalnız hesap sahibi yazar; sahip gruba konamaz; ad çakışması sonuç döner; yeniden doğrulama zorunlu", async () => {
    const name = `Ekip ${Date.now()}`;
    await expect(saveGroup({ ...call(ADMIN2, A), name })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(saveGroup({ ...call(PICKER, A), name })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { recentAuth: _ra, ...noReauth } = call(A.ownerUserId, A);
    void _ra;
    await expect(saveGroup({ ...noReauth, name })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const g = await saveGroup({ ...call(A.ownerUserId, A), name });
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(await saveGroup({ ...call(A.ownerUserId, A), name: name.toUpperCase() })).toEqual({ ok: false, issue: "NAME_TAKEN" });
    expect(await setMemberGroup({ ...call(A.ownerUserId, A), memberId: A.ownerMembershipId, groupId: g.id })).toEqual({ ok: false, issue: "OWNER" });
    await expect(setMemberGroup({ ...call(ADMIN2, A), memberId: PICKER_M, groupId: g.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Ekip yönetimi grupla verilemez (domain + DB CHECK).
    await expect(saveGroup({ ...call(A.ownerUserId, A), name: "Kaçak", grants: ["users.manage"] })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      adm.query("INSERT INTO public.permission_groups (tenant_id, name, grants, created_by) VALUES ($1, 'Kaçak', ARRAY['users.manage'], $2)", [A.tenantId, A.ownerMembershipId]),
    ).rejects.toThrow();
    // Yönetici (sahip olmayan) okuyabilir ama düzenleyemez.
    expect((await listGroups(call(ADMIN2, A))).canEdit).toBe(false);
    await expect(listGroups(call(PICKER, A))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("başka alan: grubu göremez, kendi üyesini başka alanın grubuna koyamaz; DB'de grup silme yetkisi yok", async () => {
    const g = await saveGroup({ ...call(A.ownerUserId, A), name: `Gizli ${Date.now()}`, grants: ["stock.post"] });
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect((await listGroups(call(B.ownerUserId, B))).groups.some((x) => x.id === g.id)).toBe(false);
    await expect(setMemberGroup({ ...call(B.ownerUserId, B), memberId: B.memberMembershipId, groupId: g.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setMemberGroup({ ...call(B.ownerUserId, B), memberId: PICKER_M, groupId: null })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const r = await adm.query<{ del: boolean; mdel: boolean }>(
      "SELECT has_table_privilege('wms_app', 'public.permission_groups', 'DELETE') AS del, has_table_privilege('wms_app', 'public.member_groups', 'DELETE') AS mdel",
    );
    expect(r.rows[0]).toEqual({ del: false, mdel: true });
  });
});
