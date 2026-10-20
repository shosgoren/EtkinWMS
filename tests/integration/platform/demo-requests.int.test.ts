// T-994 (ADR-026 §3, 0038): demo talepleri platform tablosu. Gerçek wms_app bağlantısı; migration rolü yalnız kurulum/temizlik.
// Kanıtlanan: tablolara hiçbir uygulama rolünün doğrudan yetkisi yok; operatör veritabanında zorlanır (kod/ortam değil);
// içe alma idempotent; karar yalnız PENDING'den bir kez; karar security_events'e kişisel veri olmadan yazılır; MFA ve yakın
// zamanda doğrulama domain'de zorunlu. Fikstürler sentetik (G-09).
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { AppError } from "../../../packages/shared/src/errors.ts";
import { loadMailConfig } from "../../../packages/shared/src/mailer.ts";
import {
  decideDemoRequest,
  ingestDemoLeads,
  isPlatformOperator,
  listDemoRequests,
} from "../../../packages/domain/src/platform/demo-requests.ts";
import { readIntEnv, readWorkerDatabaseUrl } from "../harness/env.ts";

const env = readIntEnv(process.env);
let app: DbClient;
let worker: DbClient;
let adm: pg.Client;
let operatorId: string;
let otherId: string;
let operatorEmail: string;
const leadIds: string[] = [];
const ok = async (): Promise<void> => undefined;
/** T-995: onay aktivasyon bağlantısı da verir; posta kapalı → ekranda teslim (kuyruğa iş yazılmaz). */
const deps = { mailConfig: loadMailConfig({ MAIL_MODE: "disabled" }), queue: { enqueuePlatform: async () => ({ jobId: null }) } };

async function mkUser(email: string, verified = true, twoFactor = true): Promise<string> {
  const r = await adm.query<{ id: string }>(
    "INSERT INTO public.users (name, email, email_verified, two_factor_enabled) VALUES ('T994 fixture', $1, $2, $3) RETURNING id",
    [email, verified, twoFactor],
  );
  return (r.rows[0] as { id: string }).id;
}

function lead(over: Partial<Record<string, unknown>> = {}): string {
  const id = randomUUID();
  leadIds.push(id);
  return JSON.stringify({ id, createdAt: new Date().toISOString(), name: "Deneme Kişi", company: "Deneme AŞ", email: `t994-${randomBytes(4).toString("hex")}@example.test`, sector: "", message: "", ...over });
}

beforeAll(async () => {
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  worker = createDbClient({ url: readWorkerDatabaseUrl(process.env), poolMax: 1, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  await adm.connect();
  operatorEmail = `t994-op-${randomBytes(6).toString("hex")}@example.test`;
  operatorId = await mkUser(operatorEmail);
  otherId = await mkUser(`t994-x-${randomBytes(6).toString("hex")}@example.test`);
  await adm.query("INSERT INTO wms_platform.operators (email_normalized) VALUES ($1)", [operatorEmail]);
}, 60_000);

afterAll(async () => {
  await adm.query("DELETE FROM wms_platform.subscriptions WHERE demo_request_id = ANY($1::uuid[])", [leadIds]).catch(() => undefined);
  await adm.query("DELETE FROM wms_platform.demo_requests WHERE id = ANY($1::uuid[])", [leadIds]).catch(() => undefined);
  await adm.query("DELETE FROM wms_platform.operators WHERE email_normalized = $1", [operatorEmail]).catch(() => undefined);
  await adm.end();
  await app.close();
  await worker.close();
}, 60_000);

describe("0038 yetki sınırı", () => {
  it("uygulama rolleri wms_platform tablolarına doğrudan erişemez", async () => {
    for (const role of ["wms_app", "wms_auth", "wms_worker", "wms_ops"]) {
      const r = await adm.query<{ u: boolean; d: boolean; o: boolean }>(
        `SELECT has_schema_privilege($1, 'wms_platform', 'USAGE') AS u,
                has_table_privilege($1, 'wms_platform.demo_requests', 'SELECT, INSERT, UPDATE, DELETE') AS d,
                has_table_privilege($1, 'wms_platform.operators', 'SELECT, INSERT, UPDATE, DELETE') AS o`,
        [role],
      );
      expect(r.rows[0], role).toEqual({ u: false, d: false, o: false });
    }
  });

  it("wms_app doğrudan SELECT denerse 42501", async () => {
    const c = new pg.Client({ connectionString: env.databaseUrl });
    await c.connect();
    try {
      await expect(c.query("SELECT * FROM wms_platform.demo_requests")).rejects.toMatchObject({ code: "42501" });
    } finally {
      await c.end();
    }
  });

  it("işlevler SECURITY DEFINER, sahibi wms_identity_probe, PUBLIC EXECUTE yok", async () => {
    const r = await adm.query<{ fn: string; owner: string; def: boolean; pub: boolean }>(
      `SELECT p.oid::regprocedure::text AS fn, p.proowner::regrole::text AS owner, p.prosecdef AS def,
              EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) AS pub
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'wms_probe' AND p.proname LIKE 'platform\\_%'`,
    );
    expect(r.rows.length).toBe(39); // 0038: 4, 0039 (T-995): +10, 0041 (T-404): +5, 0042 (T-403): +5, 0043 (T-406): +3, 0046 (T-407): +5, 0047 (T-408): +1, 0054 (T-967): +6
    for (const x of r.rows) expect(x, x.fn).toMatchObject({ owner: "wms_identity_probe", def: true, pub: false });
  });

  it("içe alma yalnız wms_worker: web rolü (wms_app) talep ekleyemez (42501)", async () => {
    const err = await ingestDemoLeads({ db: app, jsonl: `${lead()}\n` }).then(
      () => null,
      (e: unknown) => e,
    );
    const codes: string[] = [];
    for (let cur = err as { code?: unknown; cause?: unknown } | null, i = 0; cur !== null && cur !== undefined && i < 6; cur = cur.cause as typeof cur, i++) {
      if (typeof cur.code === "string") codes.push(cur.code);
    }
    expect(codes).toContain("42501");
    const c = new pg.Client({ connectionString: env.databaseUrl });
    await c.connect();
    try {
      await expect(
        c.query("SELECT wms_probe.platform_ingest_demo_request($1::uuid, now(), 'a', 'b', 'c@d.ef', '', '')", [randomUUID()]),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await c.end();
    }
  });

  it("wms_app platform.* güvenlik olayını doğrudan yazamaz (sahte karar kaydı yok)", async () => {
    const c = new pg.Client({ connectionString: env.databaseUrl });
    await c.connect();
    try {
      await expect(
        c.query("INSERT INTO public.security_events (user_id, event_type, detail) VALUES ($1, 'platform.demo_request.approved', '{}'::jsonb)", [operatorId]),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await c.end();
    }
  });
});

describe("içe alma", () => {
  it("geçerli satırlar eklenir, aynı satır ikinci kez eklenmez, bozuk satır atlanır", async () => {
    const a = lead();
    const b = lead({ sector: "Kauçuk", message: "Üç depo" });
    const jsonl = `${a}\n${b}\n{bozuk\n${JSON.stringify({ id: "x" })}\n`;
    expect(await ingestDemoLeads({ db: worker, jsonl })).toEqual({ inserted: 2, skipped: 2 });
    expect(await ingestDemoLeads({ db: worker, jsonl })).toEqual({ inserted: 0, skipped: 2 });
    const r = await adm.query<{ status: string; email: string }>("SELECT status, email FROM wms_platform.demo_requests WHERE id = $1", [JSON.parse(a).id]);
    expect(r.rows[0]?.status).toBe("PENDING");
  });

  it("kısıt reddeden satır (gelecek tarih) sonrakileri durdurmaz", async () => {
    const future = lead({ createdAt: new Date(Date.now() + 3_600_000).toISOString() });
    const good = lead();
    expect(await ingestDemoLeads({ db: worker, jsonl: `${future}\n${good}\n` })).toEqual({ inserted: 1, skipped: 1 });
  });
});

describe("operatör", () => {
  it("operatör listede; başka kullanıcı, doğrulanmamış e-posta ve iki adımlı doğrulaması kurulu olmayan hesap değil", async () => {
    expect(await isPlatformOperator({ db: app, principal: { userId: operatorId, mfaVerified: true } })).toBe(true);
    expect(await isPlatformOperator({ db: app, principal: { userId: otherId, mfaVerified: true } })).toBe(false);
    const unverified = `t994-u-${randomBytes(6).toString("hex")}@example.test`;
    const uid = await mkUser(unverified, false);
    await adm.query("INSERT INTO wms_platform.operators (email_normalized) VALUES ($1)", [unverified]);
    try {
      expect(await isPlatformOperator({ db: app, principal: { userId: uid, mfaVerified: true } })).toBe(false);
    } finally {
      await adm.query("DELETE FROM wms_platform.operators WHERE email_normalized = $1", [unverified]);
    }
    const no2fa = `t994-n-${randomBytes(6).toString("hex")}@example.test`;
    const nid = await mkUser(no2fa, true, false);
    await adm.query("INSERT INTO wms_platform.operators (email_normalized) VALUES ($1)", [no2fa]);
    try {
      expect(await isPlatformOperator({ db: app, principal: { userId: nid, mfaVerified: true } })).toBe(false);
    } finally {
      await adm.query("DELETE FROM wms_platform.operators WHERE email_normalized = $1", [no2fa]);
    }
  });

  it("listeleme: operatör görür; operatör olmayan NOT_FOUND; MFA'sız FORBIDDEN/MFA_REQUIRED", async () => {
    await ingestDemoLeads({ db: worker, jsonl: `${lead()}\n` });
    const rows = await listDemoRequests({ db: app, principal: { userId: operatorId, mfaVerified: true } });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    await expect(listDemoRequests({ db: app, principal: { userId: otherId, mfaVerified: true } })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(listDemoRequests({ db: app, principal: { userId: operatorId, mfaVerified: false } })).rejects.toMatchObject({ code: "FORBIDDEN", detail: "MFA_REQUIRED" });
  });

  it("wms_app bağlamsız çağrı (kullanıcı yok) operatör sayılmaz", async () => {
    const c = new pg.Client({ connectionString: env.databaseUrl });
    await c.connect();
    try {
      await expect(c.query("SELECT * FROM wms_probe.platform_list_demo_requests(10)")).rejects.toMatchObject({ code: "42501" });
      await expect(c.query("SELECT wms_probe.platform_decide_demo_request($1::uuid, 'APPROVED')", [randomUUID()])).rejects.toMatchObject({ code: "42501" });
    } finally {
      await c.end();
    }
  });
});

describe("karar", () => {
  it("onay bir kez; ikinci karar VERSION_CONFLICT; security_events kişisel veri taşımaz", async () => {
    const l = lead();
    const id = JSON.parse(l).id as string;
    await ingestDemoLeads({ db: worker, jsonl: `${l}\n` });
    const principal = { userId: operatorId, mfaVerified: true };
    const approved = await decideDemoRequest({ db: app, principal, id, decision: "APPROVED", recentAuth: ok }, deps);
    expect(approved.decision).toBe("APPROVED");
    expect(approved.activation).toMatchObject({ delivery: "SCREEN", screenReason: "DELIVERY_UNAVAILABLE" });
    expect(approved.activation?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(decideDemoRequest({ db: app, principal, id, decision: "REJECTED", recentAuth: ok }, deps)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const row = await adm.query<{ status: string; decided_by: string; decided: boolean }>(
      "SELECT status, decided_by, decided_at IS NOT NULL AS decided FROM wms_platform.demo_requests WHERE id = $1",
      [id],
    );
    expect(row.rows[0]).toEqual({ status: "APPROVED", decided_by: operatorId, decided: true });
    const ev = await adm.query<{ detail: Record<string, unknown> }>(
      "SELECT detail FROM public.security_events WHERE event_type = 'platform.demo_request.approved' AND user_id = $1 ORDER BY occurred_at DESC LIMIT 1",
      [operatorId],
    );
    expect(ev.rows[0]?.detail).toEqual({ demo_request_id: id });
  });

  it("operatör olmayan karar veremez (NOT_FOUND); yakın zamanda doğrulama reddi RECENT_AUTH_REQUIRED; geçersiz girdi VALIDATION_FAILED", async () => {
    const l = lead();
    const id = JSON.parse(l).id as string;
    await ingestDemoLeads({ db: worker, jsonl: `${l}\n` });
    await expect(decideDemoRequest({ db: app, principal: { userId: otherId, mfaVerified: true }, id, decision: "APPROVED", recentAuth: ok }, deps)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const reauth = async (): Promise<void> => {
      throw Object.assign(new Error("reauth"), { reason: "REAUTH_REQUIRED" });
    };
    await expect(decideDemoRequest({ db: app, principal: { userId: operatorId, mfaVerified: true }, id, decision: "APPROVED", recentAuth: reauth }, deps)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      detail: "RECENT_AUTH_REQUIRED",
    });
    await expect(decideDemoRequest({ db: app, principal: { userId: operatorId, mfaVerified: true }, id, decision: "DELETE", recentAuth: ok }, deps)).rejects.toBeInstanceOf(AppError);
    await expect(decideDemoRequest({ db: app, principal: { userId: operatorId, mfaVerified: true }, id: "x", decision: "APPROVED", recentAuth: ok }, deps)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    const st = await adm.query<{ status: string }>("SELECT status FROM wms_platform.demo_requests WHERE id = $1", [id]);
    expect(st.rows[0]?.status).toBe("PENDING");
  });

  it("olmayan talep NOT_FOUND", async () => {
    await expect(
      decideDemoRequest({ db: app, principal: { userId: operatorId, mfaVerified: true }, id: randomUUID(), decision: "REJECTED", recentAuth: ok }, deps),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
