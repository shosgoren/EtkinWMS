// T-428: cari kartlar — kaydet / arşivle / Excel'den aktar (dryRun ve yazma), tekrar yüklemede 0 yeni, boş hücre mevcut değeri silmez,
// başka alanın carisi görünmez (RLS + uygulama), yetkisiz rol yazamaz. T-1117: kısa ad / ilçe / varsayılan teslimat (`0064_party_details`). GERÇEK roller (wms_app, pooler); fikstür yalnızca DATABASE_URL_DIRECT ile.
import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { getParty, importParties, listParties, saveParty, setPartyArchived } from "../../../packages/domain/src/catalog/parties.ts";
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

  it("T-1090 tek cari okuma: kendi tenant'ında okunur; başka tenant / bilinmeyen kimlik NOT_FOUND, bozuk kimlik VALIDATION_FAILED; arşivli de okunur", async () => {
    const code = `G${Date.now()}`;
    const made = await saveParty(call(A.ownerUserId, A), { code, name: "Kart Cari", phone: "0212 555 00 22", city: "İstanbul" });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(await getParty(call(A.ownerUserId, A), made.id)).toMatchObject({ id: made.id, code, name: "Kart Cari", phone: "0212 555 00 22", city: "İstanbul", archived: false });
    expect(await getParty(call(PICKER, A), made.id)).toMatchObject({ id: made.id });
    await expect(getParty(call(B.ownerUserId, B), made.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getParty(call(B.ownerUserId, A), made.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getParty(call(A.ownerUserId, A), randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const bad of ["", "bozuk", "' OR 1=1 --"]) await expect(getParty(call(A.ownerUserId, A), bad)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await setPartyArchived(call(A.ownerUserId, A), { id: made.id, expectedVersion: made.version, archived: true });
    expect((await getParty(call(A.ownerUserId, A), made.id)).archived).toBe(true);
  });

  it("T-1117 kısa ad, ilçe, teslimat: kaydet → oku gidiş-dönüş, varsayılan OWN, teslimat verilmezse korunur, audit, kısa adla arama", async () => {
    const code = `K${Date.now()}`;
    const made = await saveParty(call(A.ownerUserId, A), { code, name: "Kaya Otomotiv San. Tic. A.Ş.", shortName: "  Kaya  Oto ", city: "İstanbul", district: "Kadıköy", deliveryMode: "CARRIER" });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(await getParty(call(A.ownerUserId, A), made.id)).toMatchObject({ shortName: "Kaya Oto", city: "İstanbul", district: "Kadıköy", deliveryMode: "CARRIER" });
    const audit = await adm.query<{ s: Record<string, unknown> }>("SELECT change_summary AS s FROM public.audit_logs WHERE tenant_id = $1 AND action = 'party.created' AND entity_id = $2", [A.tenantId, made.id]);
    expect(audit.rows[0]?.s).toMatchObject({ ref: code, short_name: "Kaya Oto", delivery_mode: "CARRIER" });
    // Kısa ad ve ilçeyle aranır.
    expect((await listParties(call(A.ownerUserId, A), { q: "Kaya Oto" })).items.map((x) => x.id)).toContain(made.id);
    expect((await listParties(call(A.ownerUserId, A), { q: code })).items[0]).toMatchObject({ shortName: "Kaya Oto", district: "Kadıköy", deliveryMode: "CARRIER" });
    // Güncelleme: teslimat verilmezse (eski istemci) korunur; boş kısa ad temizlenir.
    const u1 = await saveParty(call(A.ownerUserId, A), { id: made.id, expectedVersion: made.version, code, name: "Kaya Otomotiv", shortName: "", district: "Üsküdar" });
    expect(u1).toMatchObject({ ok: true, version: made.version + 1 });
    expect(await getParty(call(A.ownerUserId, A), made.id)).toMatchObject({ shortName: null, district: "Üsküdar", deliveryMode: "CARRIER" });
    if (!u1.ok) return;
    const u2 = await saveParty(call(A.ownerUserId, A), { id: made.id, expectedVersion: u1.version, code, name: "Kaya Otomotiv", shortName: "Kaya", deliveryMode: "OWN" });
    expect(u2.ok).toBe(true);
    expect(await getParty(call(A.ownerUserId, A), made.id)).toMatchObject({ shortName: "Kaya", district: null, deliveryMode: "OWN" });
    const upd = await adm.query<{ s: Record<string, unknown> }>("SELECT change_summary AS s FROM public.audit_logs WHERE tenant_id = $1 AND action = 'party.updated' AND entity_id = $2 ORDER BY occurred_at DESC LIMIT 1", [A.tenantId, made.id]);
    expect(upd.rows[0]?.s).toMatchObject({ short_name: "Kaya", delivery_mode: "OWN" });
    // Varsayılan: teslimat seçilmeden eklenen cari "Kendi personelim".
    const plain = await saveParty(call(A.ownerUserId, A), { code: `${code}-D`, name: "Varsayılan Cari" });
    expect(plain.ok && (await getParty(call(A.ownerUserId, A), plain.id)).deliveryMode).toBe("OWN");
    // Doğrulama: uzun kısa ad / ilçe ve tanınmayan teslimat sonuç olarak döner, yazılmaz.
    expect(await saveParty(call(A.ownerUserId, A), { code: `${code}-X`, name: "X", shortName: "k".repeat(101) })).toEqual({ ok: false, issue: "TEXT_TOO_LONG" });
    expect(await saveParty(call(A.ownerUserId, A), { code: `${code}-X`, name: "X", district: "i".repeat(101) })).toEqual({ ok: false, issue: "TEXT_TOO_LONG" });
    expect(await saveParty(call(A.ownerUserId, A), { code: `${code}-X`, name: "X", deliveryMode: "uçak" })).toEqual({ ok: false, issue: "DELIVERY_UNKNOWN" });
    expect((await listParties(call(A.ownerUserId, A), { q: `${code}-X` })).total).toBe(0);
  });

  it("T-1117 çapraz tenant: B, A carisinin yeni alanlarını ne okur ne arar ne yazar; toplayıcı yazamaz", async () => {
    const code = `T${Date.now()}`;
    const made = await saveParty(call(A.ownerUserId, A), { code, name: "Gizli Cari", shortName: `KISA${code}`, district: "Çankaya", deliveryMode: "CARRIER" });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect((await listParties(call(B.ownerUserId, B), { q: `KISA${code}` })).total).toBe(0);
    expect((await listParties(call(B.ownerUserId, B), { q: "Çankaya" })).items.every((x) => x.id !== made.id)).toBe(true);
    await expect(getParty(call(B.ownerUserId, B), made.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // B'nin sahibi A'nın kimliğiyle güncelleyemez (kendi tenant'ında yok → NOT_FOUND); A'daki değerler değişmez.
    await expect(saveParty(call(B.ownerUserId, B), { id: made.id, expectedVersion: made.version, code, name: "Ele geçir", shortName: "B", deliveryMode: "OWN" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(saveParty(call(PICKER, A), { id: made.id, expectedVersion: made.version, code, name: "Toplayıcı", deliveryMode: "OWN" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await getParty(call(A.ownerUserId, A), made.id)).toMatchObject({ name: "Gizli Cari", shortName: `KISA${code}`, district: "Çankaya", deliveryMode: "CARRIER", version: made.version });
  });

  it("T-1117 Excel aktarımı: kısa ad / ilçe / teslimat metni okunur; boş hücre silmez; tanınmayan teslimat sorunlu", async () => {
    const p = `X${Date.now()}`;
    const rows = [
      { row: 2, code: `${p}-1`, name: "Demir Lastik", shortName: "Demir", district: "Bornova", deliveryMode: "Kargo firması" },
      { row: 3, code: `${p}-2`, name: "Yıldız", deliveryMode: "at arabası" },
    ];
    const r = await importParties(call(A.ownerUserId, A), { rows, dryRun: false });
    expect(r).toMatchObject({ created: 1, invalid: 1 });
    expect(r.rows.find((x) => x.row === 3)?.issue).toBe("DELIVERY_UNKNOWN");
    expect((await listParties(call(A.ownerUserId, A), { q: p })).items[0]).toMatchObject({ shortName: "Demir", district: "Bornova", deliveryMode: "CARRIER" });
    expect(await importParties(call(A.ownerUserId, A), { rows: [{ row: 2, code: `${p}-1`, deliveryMode: "kendi personelim" }], dryRun: false })).toMatchObject({ updated: 1 });
    expect((await listParties(call(A.ownerUserId, A), { q: p })).items[0]).toMatchObject({ shortName: "Demir", district: "Bornova", deliveryMode: "OWN" });
  });

  it("T-1117 veritabanı (0064): CHECK'ler geçersiz değeri reddeder; yeni sütunları yalnız wms_app yazar", async () => {
    const ins = (cols: string, vals: unknown[]) =>
      adm.query(`INSERT INTO public.parties (tenant_id, code, code_key, name, created_by, ${cols}) VALUES ($1, $2, $2, 'C', $3, ${vals.map((_, i) => `$${i + 4}`).join(", ")})`, [A.tenantId, `Q${Date.now()}${Math.random().toString(36).slice(2, 6)}`.toUpperCase(), A.ownerMembershipId, ...vals]);
    for (const [cols, vals] of [
      ["delivery_mode", ["TRUCK"]],
      ["short_name", [""]],
      ["short_name", ["a\u0007b"]],
      ["short_name", ["k".repeat(101)]],
      ["district", [""]],
      ["district", ["i".repeat(101)]],
    ] as const) {
      await expect(ins(cols, [...vals])).rejects.toMatchObject({ code: "23514" });
    }
    await expect(adm.query("INSERT INTO public.parties (tenant_id, code, code_key, name, created_by, delivery_mode) VALUES ($1, $2, $2, 'C', $3, NULL)", [A.tenantId, `N${Date.now()}`, A.ownerMembershipId])).rejects.toMatchObject({ code: "23502" });
    const priv = await adm.query<{ role: string; col: string; ins: boolean; upd: boolean }>(
      `SELECT r AS role, c AS col, has_column_privilege(r, 'public.parties', c, 'INSERT') AS ins, has_column_privilege(r, 'public.parties', c, 'UPDATE') AS upd
         FROM unnest(ARRAY['wms_app', 'wms_worker', 'wms_auth']) r CROSS JOIN unnest(ARRAY['short_name', 'district', 'delivery_mode']) c
        WHERE to_regrole(r) IS NOT NULL ORDER BY r, c`,
    );
    for (const x of priv.rows) expect({ ...x, ok: x.role === "wms_app" ? x.ins && x.upd : !x.ins && !x.upd }).toMatchObject({ ok: true });
    expect(priv.rows.filter((x) => x.role === "wms_app")).toHaveLength(3);
  });

  it("veritabanı: silme yetkisi yok, kimlik alanı değiştirilemez", async () => {
    const r = await adm.query<{ del: boolean }>("SELECT has_table_privilege('wms_app', 'public.parties', 'DELETE') AS del");
    expect(r.rows[0]?.del).toBe(false);
    const id = (await adm.query<{ id: string }>("INSERT INTO public.parties (tenant_id, code, code_key, name, created_by) VALUES ($1, $2, $2, 'Z', $3) RETURNING id", [A.tenantId, `D${Date.now()}`, A.ownerMembershipId])).rows[0]?.id;
    await expect(adm.query("UPDATE public.parties SET created_by = created_by, created_at = now() - interval '1 day' WHERE id = $1", [id])).rejects.toThrow();
  });
});
