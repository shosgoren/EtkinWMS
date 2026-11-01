// T-1142 (kullanıcı kararı 31 Ekim: "tüm kullanıcı yetkileri toggle ile"): yetki ekranının sunucu kuralları — kart anahtarları gruba verilir
// (0070 CHECK), aç/kapa küme işlemi idempotent ve audit'li, yalnız hesap sahibi yazar, kısmi anahtar kümesi tam olarak o işlemleri açar
// (T-1141 güvenlik incelemesi MINOR c), cari anahtarı MFA ister (MINOR a), paylaşılan birim adı yalnız Yönetici (MINOR b), saha hesabı MFA
// isteyen yetki alamaz, çapraz tenant NOT_FOUND (I-01/I-02). Gerçek wms_app bağlantısı + RLS; fikstürler sentetik (G-09).
import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { AppError } from "../../../packages/shared/src/errors.ts";
import { FIELD_EMAIL_DOMAIN } from "../../../packages/shared/src/field-login.ts";
import { archiveItem, createItem, createUnit, renameUnit, suggestCode, updateItem } from "../../../packages/domain/src/catalog/index.ts";
import { saveParty } from "../../../packages/domain/src/catalog/parties.ts";
import { archiveWarehouse, createWarehouse, renameWarehouse } from "../../../packages/domain/src/warehouse/index.ts";
import { changeGroupGrants, listGroups, saveGroup, setGroupArchived, setMemberGroup } from "../../../packages/domain/src/identity/groups.ts";
import { changeRole } from "../../../packages/domain/src/identity/memberships.ts";
import { mkMembership, mkUser, newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";

const env = readIntEnv(process.env);
const reg = newRegistry();
let app: DbClient;
let adm: pg.Client;
let A: TenantWorld;
let B: TenantWorld;
let EDITOR: string;
let EDITOR_M: string;
let PARTY: string;
let PARTY_M: string;
let ADMIN2: string;
let FIELD_M: string;
let gEdit: string;
let gParty: string;
let gField: string;
let gB: string;

const recentAuth = async (): Promise<void> => undefined;
const call = (userId: string, w: TenantWorld, mfaVerified = true) => ({ db: app, principal: { userId, mfaVerified }, tenantSlug: w.slug, requestId: randomUUID(), recentAuth });
const plain = (userId: string, w: TenantWorld, mfaVerified = true) => ({ db: app, principal: { userId, mfaVerified }, tenantSlug: w.slug });
const uniq = (p: string): string => `${p}${randomUUID().slice(0, 8)}`.toUpperCase();

async function failure(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return e as AppError;
  }
  throw new Error("expected rejection");
}

async function auditCount(tenantId: string): Promise<number> {
  const r = await adm.query<{ n: string }>("SELECT count(*) AS n FROM public.audit_logs WHERE tenant_id = $1", [tenantId]);
  return Number(r.rows[0]?.n);
}

async function grantsOf(groupId: string): Promise<string[]> {
  const r = await adm.query<{ grants: string[] }>("SELECT grants FROM public.permission_groups WHERE id = $1", [groupId]);
  return r.rows[0]?.grants ?? [];
}

async function rolesVersion(membershipId: string): Promise<number> {
  const r = await adm.query<{ v: number }>("SELECT roles_version AS v FROM public.tenant_memberships WHERE id = $1", [membershipId]);
  return Number(r.rows[0]?.v);
}

async function newGroup(w: TenantWorld, name: string): Promise<string> {
  const g = await saveGroup({ ...call(w.ownerUserId, w), name: `${name} ${randomUUID().slice(0, 6)}`, color: "#2F5DA8", screens: [], grants: [] });
  if (!g.ok) throw new Error("group seed failed");
  return g.id;
}

beforeAll(async () => {
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  await adm.connect();
  A = await seedWorld(adm, reg, "A1142");
  B = await seedWorld(adm, reg, "B1142");
  EDITOR = await mkUser(adm, reg, "A1142 editor");
  EDITOR_M = await mkMembership(adm, A.tenantId, EDITOR, { roles: ["PICKER"] });
  PARTY = await mkUser(adm, reg, "A1142 party");
  PARTY_M = await mkMembership(adm, A.tenantId, PARTY, { roles: ["READ_ONLY"] });
  ADMIN2 = await mkUser(adm, reg, "A1142 admin2");
  await mkMembership(adm, A.tenantId, ADMIN2, { roles: ["TENANT_ADMIN"] });
  const fieldUser = await mkUser(adm, reg, "A1142 field");
  await adm.query("UPDATE public.users SET email = $2 WHERE id = $1", [fieldUser, `t1142-${randomUUID().slice(0, 8)}@${FIELD_EMAIL_DOMAIN}`]);
  FIELD_M = await mkMembership(adm, A.tenantId, fieldUser, { roles: ["PICKER"] });
  gEdit = await newGroup(A, "Düzenleyici");
  gParty = await newGroup(A, "Cari");
  gField = await newGroup(A, "Saha");
  gB = await newGroup(B, "B grubu");
  for (const [m, g] of [[EDITOR_M, gEdit], [PARTY_M, gParty], [FIELD_M, gField]] as const) {
    expect(await setMemberGroup({ ...call(A.ownerUserId, A), memberId: m, groupId: g })).toEqual({ ok: true, changed: true });
  }
}, 120_000);

afterAll(async () => {
  await adm.end();
  await app.close();
}, 60_000);

// Her test kendi başlangıcından koşar (sıra bağımsız): gruplar boş yetkiye, üyeler kendi gruplarına döner.
beforeEach(async () => {
  await adm.query("UPDATE public.permission_groups SET grants = '{}' WHERE id = ANY($1::uuid[]) AND grants <> '{}'", [[gEdit, gParty, gField]]);
  for (const [m, g] of [[EDITOR_M, gEdit], [PARTY_M, gParty], [FIELD_M, gField]] as const) {
    await adm.query(
      "INSERT INTO public.member_groups (tenant_id, membership_id, group_id, assigned_by) VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id, membership_id) DO UPDATE SET group_id = EXCLUDED.group_id",
      [A.tenantId, m, g, A.ownerMembershipId],
    );
  }
});

describe("T-1142 aç/kapa (changeGroupGrants)", () => {
  it("hesap sahibi kart anahtarı açar; tekrar aynı istek yazmaz (idempotent); audit önceki/sonraki yetkiyi taşır; üye sürümü artar", async () => {
    const v0 = await rolesVersion(EDITOR_M);
    const a0 = await auditCount(A.tenantId);
    const first = call(A.ownerUserId, A);
    const r = await changeGroupGrants({ ...first, id: gEdit, add: ["items.edit", "warehouses.archive"], remove: [] });
    expect(r).toMatchObject({ ok: true, changed: true, grants: ["items.edit", "warehouses.archive"] });
    expect(await grantsOf(gEdit)).toEqual(["items.edit", "warehouses.archive"]);
    expect(await rolesVersion(EDITOR_M)).toBe(v0 + 1);
    expect(await auditCount(A.tenantId)).toBe(a0 + 1);
    const audit = await adm.query<{ action: string; actor: string; s: { from_grants: string[]; grants: string[]; via: string } }>(
      "SELECT action, actor_user_id AS actor, change_summary AS s FROM public.audit_logs WHERE tenant_id = $1 AND entity_id = $2 AND request_id = $3 AND change_summary->>'via' = 'permission_screen'",
      [A.tenantId, gEdit, first.requestId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ action: "group.updated", actor: A.ownerUserId, s: { from_grants: [], grants: ["items.edit", "warehouses.archive"], via: "permission_screen" } });

    const again = await changeGroupGrants({ ...call(A.ownerUserId, A), id: gEdit, add: ["items.edit"], remove: [] });
    expect(again).toMatchObject({ ok: true, changed: false, grants: ["items.edit", "warehouses.archive"] });
    expect(await auditCount(A.tenantId)).toBe(a0 + 1);
    expect(await rolesVersion(EDITOR_M)).toBe(v0 + 1);
    const off = await changeGroupGrants({ ...call(A.ownerUserId, A), id: gEdit, add: [], remove: ["locations.create"] });
    expect(off).toMatchObject({ ok: true, changed: false });

    const overview = await listGroups(call(A.ownerUserId, A));
    expect(overview.groups.find((g) => g.id === gEdit)?.grants).toEqual(["items.edit", "warehouses.archive"]);
  });

  it("kısmi küme (MINOR c): items.edit var, items.archive yok → değiştirir ama arşivleyemez / ekleyemez; depoda arşiv var, kod değiştirme yok", async () => {
    await changeGroupGrants({ ...call(A.ownerUserId, A), id: gEdit, add: ["items.edit", "warehouses.archive"], remove: [] });
    expect((await updateItem(plain(EDITOR, A), { itemId: A.itemId, name: `T1142 ${randomUUID().slice(0, 4)}` })).changed).toBe(true);
    expect((await failure(archiveItem(plain(EDITOR, A), { itemId: A.itemTwoId }))).code).toBe("FORBIDDEN");
    expect((await failure(createItem(plain(EDITOR, A), { code: uniq("I-"), name: "x", baseUnitId: A.unitId }))).code).toBe("FORBIDDEN");
    const wh = (await createWarehouse(plain(A.ownerUserId, A), { code: uniq("W-"), name: "T1142 boş depo" })).warehouseId;
    expect((await failure(renameWarehouse(plain(EDITOR, A), { warehouseId: wh, code: uniq("W-") }))).code).toBe("FORBIDDEN");
    expect((await archiveWarehouse(plain(EDITOR, A), { warehouseId: wh })).archived).toBe(true);
    // Kapatınca hemen düşer.
    await changeGroupGrants({ ...call(A.ownerUserId, A), id: gEdit, add: [], remove: ["items.edit"] });
    expect((await failure(updateItem(plain(EDITOR, A), { itemId: A.itemId, name: "kapalı" }))).code).toBe("FORBIDDEN");
  });

  it("paylaşılan birim (MINOR b): items.edit birim adını değiştiremez (yalnız Yönetici); items.create yeni birim ekleyebilir", async () => {
    await changeGroupGrants({ ...call(A.ownerUserId, A), id: gEdit, add: ["items.edit", "items.create"], remove: [] });
    expect((await failure(renameUnit(plain(EDITOR, A), { unitId: A.unitId, name: "değişti" }))).code).toBe("FORBIDDEN");
    const u = await createUnit(plain(EDITOR, A), { code: uniq("U"), name: "T1142 birim" });
    expect(u.unitId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await renameUnit(plain(A.ownerUserId, A), { unitId: u.unitId, name: "T1142 birim 2" })).changed).toBe(true);
  });

  it("ürün anahtarı da iki adımlı doğrulama ister (dış sisteme giden kart); raf yeri anahtarı istemez", async () => {
    await changeGroupGrants({ ...call(A.ownerUserId, A), id: gEdit, add: ["items.edit"], remove: [] });
    expect(await failure(updateItem(plain(EDITOR, A, false), { itemId: A.itemId, name: "mfa yok" }))).toMatchObject({ code: "FORBIDDEN", detail: "MFA_REQUIRED" });
    await changeGroupGrants({ ...call(A.ownerUserId, A), id: gEdit, add: ["locations.create"], remove: ["items.edit"] });
    const s = await suggestCode(plain(EDITOR, A, false), { kind: "location", warehouseId: A.warehouseId });
    expect(typeof s).toBe("object");
  });

  it("cari anahtarı (MINOR a) iki adımlı doğrulama ister; parties.create yalnız ekler, değiştiremez", async () => {
    await changeGroupGrants({ ...call(A.ownerUserId, A), id: gParty, add: ["parties.create"], remove: [] });
    const noMfa = await failure(saveParty(plain(PARTY, A, false), { code: uniq("C-"), name: "x", kind: "CUSTOMER" }));
    expect(noMfa).toMatchObject({ code: "FORBIDDEN", detail: "MFA_REQUIRED" });
    const p = await saveParty(plain(PARTY, A, true), { code: uniq("C-"), name: "T1142 cari", kind: "CUSTOMER" });
    if (!p.ok) throw new Error("party create");
    expect((await failure(saveParty(plain(PARTY, A, true), { id: p.id, expectedVersion: p.version, code: uniq("C-"), name: "değişti", kind: "CUSTOMER" }))).code).toBe("FORBIDDEN");
  });

  it("saha hesabı olan gruba MFA isteyen yetki (cari, ürün, depo, onay, Excel) açılamaz; raf yeri açılır; kapatma serbest", async () => {
    const a0 = await auditCount(A.tenantId);
    for (const k of ["parties.edit", "items.edit", "items.create", "warehouses.edit", "warehouses.archive"]) {
      expect(await changeGroupGrants({ ...call(A.ownerUserId, A), id: gField, add: [k], remove: [] }), k).toEqual({ ok: false, issue: "FIELD_MEMBER_MFA" });
    }
    expect(await changeGroupGrants({ ...call(A.ownerUserId, A), id: gField, add: ["data.import", "stock.post"], remove: [] })).toEqual({ ok: false, issue: "FIELD_MEMBER_MFA" });
    expect(await grantsOf(gField)).toEqual([]);
    expect(await auditCount(A.tenantId)).toBe(a0);
    expect(await changeGroupGrants({ ...call(A.ownerUserId, A), id: gField, add: ["locations.edit", "locations.create", "stock.post"], remove: [] })).toMatchObject({ ok: true, changed: true });
    expect(await changeGroupGrants({ ...call(A.ownerUserId, A), id: gField, add: [], remove: ["locations.edit"] })).toMatchObject({ ok: true, changed: true, grants: ["stock.post", "locations.create"] });
  });

  it("yalnız hesap sahibi: ikinci yönetici, grup üyesi (kendi grubunu büyütme) ve toplayıcı FORBIDDEN; yazım ve audit yok", async () => {
    const before = await grantsOf(gEdit);
    const a0 = await auditCount(A.tenantId);
    for (const who of [ADMIN2, EDITOR, A.memberUserId]) {
      const e = await failure(changeGroupGrants({ ...call(who, A), id: gEdit, add: ["items.archive"], remove: [] }));
      expect(e.code, who).toBe("FORBIDDEN");
    }
    expect(await grantsOf(gEdit)).toEqual(before);
    expect(await auditCount(A.tenantId)).toBe(a0);
    // Yakın zamanda kimlik doğrulama zorunlu (fail-closed).
    await changeGroupGrants({ ...call(A.ownerUserId, A), id: gEdit, add: ["items.edit"], remove: [] });
    const noReauth = await failure(changeGroupGrants({ ...plain(A.ownerUserId, A), id: gEdit, add: ["items.archive"], remove: [] }));
    expect(noReauth).toMatchObject({ code: "UNAUTHENTICATED", detail: "RECENT_AUTH_REQUIRED" });
  });

  it("kendini yükseltme ve son yönetici: üye kendi rolünü büyütemez; hesap sahibi kendi yönetici rolünü bırakamaz; hesap sahibi gruba konmaz", async () => {
    const deps = { demoEmailDomain: null };
    expect((await failure(changeRole({ ...call(EDITOR, A), memberId: EDITOR_M, roleKey: "TENANT_ADMIN" }, deps))).code).toBe("FORBIDDEN");
    expect((await failure(changeRole({ ...call(A.ownerUserId, A), memberId: A.ownerMembershipId, roleKey: "READ_ONLY" }, deps))).code).toBe("FORBIDDEN");
    expect(await setMemberGroup({ ...call(A.ownerUserId, A), memberId: A.ownerMembershipId, groupId: gEdit })).toEqual({ ok: false, issue: "OWNER" });
    const roles = await adm.query<{ role_key: string }>("SELECT role_key FROM public.membership_roles WHERE membership_id = $1", [A.ownerMembershipId]);
    expect(roles.rows.map((r) => r.role_key)).toEqual(["TENANT_ADMIN"]);
  });

  it("girdi: kapalı liste dışı (settings.manage, users.manage), boş ya da çakışan istek ve arşivdeki grup VALIDATION_FAILED", async () => {
    for (const add of [["settings.manage"], ["users.manage"], ["audit.view"]]) {
      expect((await failure(changeGroupGrants({ ...call(A.ownerUserId, A), id: gEdit, add, remove: [] }))).code).toBe("VALIDATION_FAILED");
    }
    expect((await failure(changeGroupGrants({ ...call(A.ownerUserId, A), id: gEdit, add: [], remove: [] }))).code).toBe("VALIDATION_FAILED");
    expect((await failure(changeGroupGrants({ ...call(A.ownerUserId, A), id: gEdit, add: ["items.edit"], remove: ["items.edit"] }))).code).toBe("VALIDATION_FAILED");
    const tmp = await newGroup(A, "Arşiv");
    const v = (await listGroups(call(A.ownerUserId, A))).groups.find((g) => g.id === tmp)?.version ?? 1;
    await setGroupArchived({ ...call(A.ownerUserId, A), id: tmp, expectedVersion: v, archived: true });
    expect((await failure(changeGroupGrants({ ...call(A.ownerUserId, A), id: tmp, add: ["items.edit"], remove: [] }))).code).toBe("VALIDATION_FAILED");
  });

  it("çapraz tenant: A'nın hesap sahibi B'nin grubunu ve üyesini değiştiremez (NOT_FOUND); B değişmez (I-01/I-02)", async () => {
    const before = await grantsOf(gB);
    const bAudit = await auditCount(B.tenantId);
    expect((await failure(changeGroupGrants({ ...call(A.ownerUserId, A), id: gB, add: ["items.edit"], remove: [] }))).code).toBe("NOT_FOUND");
    expect((await failure(setMemberGroup({ ...call(A.ownerUserId, A), memberId: B.memberMembershipId, groupId: gEdit }))).code).toBe("NOT_FOUND");
    expect((await failure(setMemberGroup({ ...call(A.ownerUserId, A), memberId: EDITOR_M, groupId: gB }))).code).toBe("NOT_FOUND");
    // B'nin hesap sahibi A'nın slug'ıyla çağıramaz (üye değil).
    expect((await failure(changeGroupGrants({ ...call(B.ownerUserId, A), id: gEdit, add: ["items.edit"], remove: [] }))).code).toBe("NOT_FOUND");
    expect(await grantsOf(gB)).toEqual(before);
    expect(await auditCount(B.tenantId)).toBe(bAudit);
  });

  it("veritabanı (0073 CHECK): kart anahtarları kabul; yönetici anahtarları, bilinmeyen ve 23'ten uzun dizi ret", async () => {
    const ok = await adm.query<{ id: string }>("INSERT INTO public.permission_groups (tenant_id, name, grants, created_by) VALUES ($1, $2, ARRAY['items.create','parties.archive','locations.edit'], $3) RETURNING id", [
      A.tenantId,
      `DB ${randomUUID().slice(0, 6)}`,
      A.ownerMembershipId,
    ]);
    expect(ok.rows).toHaveLength(1);
    for (const bad of [["settings.manage"], ["users.manage"], ["stock.view"], ["items.delete"], Array.from({ length: 24 }, () => "items.edit")]) {
      await expect(
        adm.query("INSERT INTO public.permission_groups (tenant_id, name, grants, created_by) VALUES ($1, $2, $3::text[], $4)", [A.tenantId, `Kaçak ${randomUUID().slice(0, 6)}`, bad, A.ownerMembershipId]),
      ).rejects.toThrow(/permission_groups_grants_chk/);
    }
  });
});
