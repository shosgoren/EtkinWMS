// T-428: cari kartlar — kaydet / arşivle / Excel'den aktar (dryRun ve yazma), tekrar yüklemede 0 yeni, boş hücre mevcut değeri silmez,
// başka alanın carisi görünmez (RLS + uygulama), yetkisiz rol yazamaz. GERÇEK roller (wms_app, pooler); fikstür yalnızca DATABASE_URL_DIRECT ile.
import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { importParties, listParties, saveParty, setPartyArchived } from "../../../packages/domain/src/catalog/parties.ts";
import { mkMembership, mkUser, newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";

const env = readIntEnv(process.env);
const reg = newRegistry();
let app: DbClient;
let adm: pg.Client;
let A: TenantWorld;
let B: TenantWorld;
let PICKER: string;

const call = (userId: string, w: TenantWorld) => ({ db: app, principal: { userId, mfaVerified: true }, tenantSlug: w.slug, requestId: randomUUID() });

beforeAll(async () => {
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  await adm.connect();
  A = await seedWorld(adm, reg, "A428");
  B = await seedWorld(adm, reg, "B428");
  PICKER = await mkUser(adm, reg, "A428 picker");
  await mkMembership(adm, A.tenantId, PICKER, { roles: ["PICKER"] });
}, 120_000);

afterAll(async () => {
  await adm.end();
  await app.close();
}, 60_000);

describe("T-428 cari kartlar", () => {
  it("Excel aktarımı: kontrol yazmaz; yazma yeni ekler; aynı dosya ikinci kez 0 yeni; boş hücre değeri silmez; tekrarlayan kod sorunlu", async () => {
    const p = `C${Date.now()}`;
    const rows = [
      { row: 2, code: `${p}-1`, name: "Kaya Otomotiv", taxNo: "5230012345", phone: "0532 111 22 33", email: "satis@kaya.com", city: "İstanbul" },
      { row: 3, code: `${p}-2`, name: "Demir Lastik", kind: "tedarikçi" },
      { row: 4, code: `${p}-1`, name: "Tekrar" },
      { row: 5, code: "", name: "Kodsuz" },
    ];
    const dry = await importParties(call(A.ownerUserId, A), { rows, dryRun: true });
    expect(dry).toMatchObject({ created: 2, updated: 0, invalid: 2 });
    expect(dry.rows.find((r) => r.row === 4)?.issue).toBe("CODE_DUPLICATE_FILE");
    expect(dry.rows.find((r) => r.row === 5)?.issue).toBe("CODE_MISSING");
    expect((await listParties(call(A.ownerUserId, A), { q: p })).total).toBe(0);

    const valid = rows.slice(0, 2);
    expect(await importParties(call(A.ownerUserId, A), { rows: valid, dryRun: false })).toMatchObject({ created: 2, updated: 0, unchanged: 0 });
    expect(await importParties(call(A.ownerUserId, A), { rows: valid, dryRun: false })).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
    // Boş hücre mevcut değeri silmez; dolu hücre günceller.
    expect(await importParties(call(A.ownerUserId, A), { rows: [{ row: 2, code: `${p.toLowerCase()}-1`, city: "Ankara" }], dryRun: false })).toMatchObject({ updated: 1 });
    const list = await listParties(call(A.ownerUserId, A), { q: p });
    expect(list.total).toBe(2);
    const kaya = list.items.find((x) => x.code === `${p}-1`);
    expect(kaya).toMatchObject({ name: "Kaya Otomotiv", city: "Ankara", taxNo: "5230012345", kind: "CUSTOMER" });
    expect(list.items.find((x) => x.code === `${p}-2`)?.kind).toBe("SUPPLIER");

    // Başka alan göremez.
    expect((await listParties(call(B.ownerUserId, B), { q: p })).total).toBe(0);
    // Toplayıcı okuyabilir, yazamaz.
    expect((await listParties(call(PICKER, A), { q: p })).total).toBe(2);
    await expect(importParties(call(PICKER, A), { rows: valid, dryRun: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Audit: aktarım parça başına bir kayıt.
    const audits = await adm.query<{ n: string }>("SELECT count(*)::text AS n FROM public.audit_logs WHERE tenant_id = $1 AND action = 'party.imported'", [A.tenantId]);
    expect(Number(audits.rows[0]?.n)).toBeGreaterThanOrEqual(2);
  });

  it("tek kart: ekle, kod çakışması sonuç döner, sürüm denetimli güncelleme, arşivle / geri al", async () => {
    const code = `S${Date.now()}`;
    const created = await saveParty(call(A.ownerUserId, A), { code, name: "Yıldız Makina", phone: "0212 555 00 11" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(await saveParty(call(A.ownerUserId, A), { code: code.toLowerCase(), name: "Başka" })).toEqual({ ok: false, issue: "CODE_TAKEN" });
    expect(await saveParty(call(A.ownerUserId, A), { code: "X", name: "Y", email: "bozuk" })).toEqual({ ok: false, issue: "EMAIL_INVALID" });
    const upd = await saveParty(call(A.ownerUserId, A), { id: created.id, expectedVersion: created.version, code, name: "Yıldız Makina A.Ş.", kind: "BOTH" });
    expect(upd).toMatchObject({ ok: true, version: created.version + 1 });
    await expect(saveParty(call(A.ownerUserId, A), { id: created.id, expectedVersion: created.version, code, name: "Eski sürüm" })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const v = upd.ok ? upd.version : 0;
    const arch = await setPartyArchived(call(A.ownerUserId, A), { id: created.id, expectedVersion: v, archived: true });
    expect((await listParties(call(A.ownerUserId, A), { q: code })).total).toBe(0);
    expect((await listParties(call(A.ownerUserId, A), { q: code, archived: true })).items[0]?.archived).toBe(true);
    // T-1037: arşiv görünümü yalnız arşivdekileri getirir; etkin cari orada görünmez.
    const live = await saveParty(call(A.ownerUserId, A), { code: `${code}-E`, name: "Etkin Cari" });
    expect(live.ok).toBe(true);
    const arsiv = await listParties(call(A.ownerUserId, A), { q: code, archived: true });
    expect(arsiv.items.every((x) => x.archived)).toBe(true);
    expect(arsiv.total).toBe(1);
    await setPartyArchived(call(A.ownerUserId, A), { id: created.id, expectedVersion: arch.version, archived: false });
    expect((await listParties(call(A.ownerUserId, A), { q: code })).total).toBe(2);
    expect((await listParties(call(A.ownerUserId, A), { q: code, archived: true })).total).toBe(0);
  });

  it("T-1058 sayfalama: keyset imleçle tekrarsız ve eksiksiz; toplam yalnız ilk sayfada; bozuk imleç reddedilir; başka alan imleci veri sızdırmaz", async () => {
    const p = `S${Date.now()}`;
    // Aynı adlı iki cari: sıra (ad, kod, kimlik) olduğundan ikisi de kaybolmadan gelir.
    const rows = Array.from({ length: 7 }, (_, i) => ({ row: i + 2, code: `${p}-${i}`, name: i < 2 ? "Aynı Ad" : `Cari ${String(i).padStart(2, "0")}` }));
    expect(await importParties(call(A.ownerUserId, A), { rows, dryRun: false })).toMatchObject({ created: 7 });
    const seen: string[] = [];
    let after: string | undefined;
    let pages = 0;
    for (;;) {
      const page = await listParties(call(A.ownerUserId, A), { q: p, limit: 3, ...(after === undefined ? {} : { after }) });
      if (pages === 0) expect(page.total).toBe(7);
      else expect(page.total).toBeUndefined();
      seen.push(...page.items.map((x) => x.code));
      pages += 1;
      if (page.nextCursor === null) break;
      after = page.nextCursor;
    }
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(7);
    expect([...seen].sort()).toEqual(rows.map((r) => r.code).sort());
    // Bozuk / sahte imleç: doğrulama hatası (sorguya gitmez).
    await expect(listParties(call(A.ownerUserId, A), { after: "!!" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(listParties(call(A.ownerUserId, A), { after: Buffer.from(JSON.stringify(["a", "b"])).toString("base64url") })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    // A'nın imleci B'de yalnız B'nin satırlarını sürdürür (imleç kimlik değil konumdur; tenant sınırı sorguda).
    const first = await listParties(call(A.ownerUserId, A), { q: p, limit: 3 });
    const inB = await listParties(call(B.ownerUserId, B), { q: p, ...(first.nextCursor === null ? {} : { after: first.nextCursor }) });
    expect(inB.items).toHaveLength(0);
  });

  it("veritabanı: silme yetkisi yok, kimlik alanı değiştirilemez", async () => {
    const r = await adm.query<{ del: boolean }>("SELECT has_table_privilege('wms_app', 'public.parties', 'DELETE') AS del");
    expect(r.rows[0]?.del).toBe(false);
    const id = (await adm.query<{ id: string }>("INSERT INTO public.parties (tenant_id, code, code_key, name, created_by) VALUES ($1, $2, $2, 'Z', $3) RETURNING id", [A.tenantId, `D${Date.now()}`, A.ownerMembershipId])).rows[0]?.id;
    await expect(adm.query("UPDATE public.parties SET created_by = created_by, created_at = now() - interval '1 day' WHERE id = $1", [id])).rejects.toThrow();
  });
});
