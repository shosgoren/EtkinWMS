// T-1004: `deploy/vps/ops/reset-tenants.sql` (müşteri sıfırlama ops betiği) gerçek şemada, gerçek psql ile.
//
// Paylaşılan test veritabanı (`wms`) BOZULMASIN diye aynı kümede koşuya özel ayrı bir veritabanı açılır, bütün migration'lar
// + kuyruk şeması kurulur, iki kiracılık tam veri seti (stok, belge, görev, sayım, destek, entegrasyon, audit, saha, panel
// müşteri kaydı, demo talebi, kuyruk işi) ve MFA'lı bir operatör hesabı tohumlanır. Betik konteynerdeki psql ile
// (canlıdaki `docker exec ... psql` ile aynı yol) önce kuru, sonra gerçek koşulur. Ardından: kiracı/yetim satır 0, operatör
// hesabı + MFA + oturum + güvenilir cihaz + panel işlem kaydı aynen, append-only tetikleyiciler yine etkin, operatör panel
// yetkisi çalışıyor ve yeni kiracı açılabiliyor. Şema değişip betik bozulursa bu test düşer.
// Yalnız compose hedefi (neon'da veritabanı açma ve docker exec yoktur). Fikstürler sentetiktir (G-09).
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../../packages/auth/src/password.ts";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { migrateUp } from "../../../packages/db/src/migrate.ts";
import { createWorkspace } from "../../../packages/domain/src/onboarding/workspace.ts";
import { setCustomerSuspended } from "../../../packages/domain/src/platform/customers.ts";
import { listPanelEvents } from "../../../packages/domain/src/platform/events.ts";
import { savePlan } from "../../../packages/domain/src/platform/plans.ts";
import { installQueueSchema } from "../../../packages/queue-adapter/src/index.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";

const env = readIntEnv(process.env);
const SCRIPT = readFileSync(new URL("../../../deploy/vps/ops/reset-tenants.sql", import.meta.url), "utf8");
const OPERATOR_EMAIL = "hosgorens@gmail.com"; // 0038 migration'ının tohumladığı tek operatör (sentetik hesap bu test DB'sinde)
const hex = (n: number) => randomBytes(n).toString("hex");

/** Tohumdan önce dolu olması ŞART olan kiracı tabloları (betik kapsamı bunlarla kanıtlanır). */
const REQUIRED = [
  "public.tenants", "public.tenant_memberships", "public.membership_roles", "public.invitations", "public.tenant_settings",
  "public.warehouses", "public.locations", "public.items", "public.units", "public.lots", "public.serials", "public.handling_units",
  "public.documents", "public.document_lines", "public.document_status_history", "public.stock_dimensions", "public.stock_ledger",
  "public.stock_balances", "public.reservations", "public.inbound_receipts", "public.sales_orders", "public.customer_returns",
  "public.warehouse_tasks", "public.warehouse_task_progress", "public.count_sessions", "public.count_session_lines",
  "public.stock_alerts", "public.field_devices", "public.field_logins", "public.field_enrollments", "public.audit_logs",
  "public.support_tickets", "public.support_ticket_messages", "public.integrations", "public.integration_flows",
  "public.integration_runs", "public.integration_outbox", "public.integration_stock_marks", "public.team_join_links",
  "public.team_join_requests", "public.permission_groups", "public.member_groups", "public.parties", "public.work_priorities",
  "public.problem_reports", "public.admin_reset_grants", "public.processed_events", "public.idempotency_records",
  "wms_platform.subscriptions", "wms_platform.charges", "wms_platform.demo_requests", "public.field_sessions",
  "public.field_device_lockouts", "pgboss.job",
];

let dbName: string;
let resetUrl: string;
let adm: pg.Client;
let c: pg.Client;
let app: DbClient;
let container: string;
const worlds: TenantWorld[] = [];
let operatorId: string;
let operatorPasswordHash: string;
const operatorPassword = `Op-${hex(9)}`;
let migrationsBefore: number;
let triggersBefore: string;
let operatorEventsBefore: number;

function withDb(url: string, db: string, user?: { name: string; password: string }): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  if (user !== undefined) {
    u.username = encodeURIComponent(user.name);
    u.password = encodeURIComponent(user.password);
  }
  return u.toString();
}

const n = async (text: string, args: unknown[] = []): Promise<number> => Number((await c.query<{ n: string }>(text, args)).rows[0]!.n);

function runScript(dryRun: string): { status: number | null; out: string } {
  const user = decodeURIComponent(new URL(env.databaseUrlDirect).username);
  const r = spawnSync("docker", ["exec", "-i", container, "psql", "-X", "-U", user, "-d", dbName, "-v", `dry_run=${dryRun}`], {
    input: SCRIPT,
    encoding: "utf8",
    timeout: 120_000,
  });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

async function seedExtras(w: TenantWorld, i: number): Promise<void> {
  const t = w.tenantId;
  const owner = w.ownerMembershipId;
  await c.query("INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id) VALUES ($1, $2, 'tenant.created', 'tenant', $3)", [t, w.ownerUserId, t]);
  const ticket = (await c.query<{ id: string }>(
    "INSERT INTO public.support_tickets (tenant_id, created_by, membership_id, subject_kind, body) VALUES ($1, $2, $3, 'BUG', 'T1004 destek') RETURNING id",
    [t, w.ownerUserId, owner],
  )).rows[0]!.id;
  await c.query("INSERT INTO public.support_ticket_messages (tenant_id, ticket_id, author_kind, author_user_id, body) VALUES ($1, $2, 'CUSTOMER', $3, 'mesaj'), ($1, $2, 'OPERATOR', $4, 'yanıt')", [t, ticket, w.ownerUserId, operatorId]);
  const integ = (await c.query<{ id: string }>("INSERT INTO public.integrations (tenant_id, provider, status) VALUES ($1, 'PARASUT', 'DISCONNECTED') RETURNING id", [t])).rows[0]!.id;
  await c.query("INSERT INTO public.integration_flows (tenant_id, integration_id, flow, direction) VALUES ($1, $2, 'PRODUCTS', 'PULL')", [t, integ]);
  await c.query("INSERT INTO public.integration_runs (tenant_id, integration_id, flow, trigger) VALUES ($1, $2, 'PRODUCTS', 'MANUAL')", [t, integ]);
  await c.query("INSERT INTO public.integration_outbox (tenant_id, integration_id, flow, entity_type, entity_id) VALUES ($1, $2, 'SHIPMENTS', 'DOCUMENT', $3)", [t, integ, w.documentId]);
  await c.query("INSERT INTO public.integration_stock_marks (tenant_id, integration_id, item_id, warehouse_id, quantity) VALUES ($1, $2, $3, $4, 1)", [t, integ, w.itemId, w.warehouseId]);
  const link = (await c.query<{ id: string }>("INSERT INTO public.team_join_links (tenant_id, token_hash, created_by) VALUES ($1, $2, $3) RETURNING id", [t, hex(32), w.ownerUserId])).rows[0]!.id;
  await c.query("INSERT INTO public.team_join_requests (tenant_id, link_id, request_hash, name, username, confirm_code) VALUES ($1, $2, $3, 'Saha', $4, '123456')", [t, link, hex(32), `saha${i}x`]);
  const group = (await c.query<{ id: string }>("INSERT INTO public.permission_groups (tenant_id, name, created_by) VALUES ($1, 'Grup', $2) RETURNING id", [t, owner])).rows[0]!.id;
  await c.query("INSERT INTO public.member_groups (tenant_id, membership_id, group_id, assigned_by) VALUES ($1, $2, $3, $4)", [t, w.memberMembershipId, group, owner]);
  await c.query("INSERT INTO public.parties (tenant_id, code, code_key, name, created_by) VALUES ($1, 'C1', 'C1', 'Cari', $2)", [t, owner]);
  await c.query("INSERT INTO public.work_priorities (tenant_id, subject_kind, subject_id, updated_by) VALUES ($1, 'DOCUMENT', $2, $3)", [t, w.documentId, owner]);
  await c.query("INSERT INTO public.problem_reports (tenant_id, warehouse_id, reason, reported_by) VALUES ($1, $2, 'DAMAGED', $3)", [t, w.warehouseId, owner]);
  // Müşteri kullanıcısının kimlik satırları: parola, MFA, oturum (+ saha oturumu), güvenilir cihaz, sıfırlama izni, güvenlik olayı.
  await c.query("INSERT INTO public.accounts (account_id, provider_id, user_id, password) VALUES ($1::text, 'credential', $1::uuid, 'x')", [w.ownerUserId]);
  await c.query("INSERT INTO public.two_factors (secret, backup_codes, user_id, verified) VALUES ('s', 'b', $1, true)", [w.ownerUserId]);
  const session = (await c.query<{ id: string }>("INSERT INTO public.sessions (expires_at, token, user_id) VALUES (now() + interval '1 day', $1, $2) RETURNING id", [hex(16), w.memberUserId])).rows[0]!.id;
  const device = (await c.query<{ id: string }>("SELECT id FROM public.field_devices WHERE tenant_id = $1 LIMIT 1", [t])).rows[0]!.id;
  await c.query("INSERT INTO public.field_sessions (session_id, device_id) VALUES ($1, $2)", [session, device]);
  await c.query("INSERT INTO public.field_device_lockouts (device_id, user_id) VALUES ($1, $2)", [device, w.memberUserId]);
  await c.query("INSERT INTO public.verifications (identifier, value, expires_at) VALUES ($1, $2, now() + interval '30 days')", [`trust-device:h.${hex(16)}`, w.ownerUserId]);
  const ver = (await c.query<{ id: string }>("INSERT INTO public.verifications (identifier, value, expires_at) VALUES ($1, $2, now() + interval '1 hour') RETURNING id", [hex(32), w.memberUserId])).rows[0]!.id;
  await c.query("BEGIN");
  await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [t]);
  await c.query("INSERT INTO public.admin_reset_grants (user_id, issuing_tenant_id, issuing_membership_id, verification_id, expires_at) VALUES ($1, $2, $3, $4, now() + interval '1 hour')", [w.memberUserId, t, owner, ver]);
  await c.query("COMMIT");
  await c.query("INSERT INTO public.security_events (user_id, event_type, detail) VALUES ($1, 'sign_in', '{}')", [w.ownerUserId]);
  // Panel tarafı müşteri kaydı: demo talebi → abonelik → tahakkuk.
  const demo = randomUUID();
  await c.query("INSERT INTO wms_platform.demo_requests (id, received_at, name, company, email) VALUES ($1, now(), 'Ad', 'Firma', $2)", [demo, `t1004-${hex(4)}@example.test`]);
  await c.query("INSERT INTO wms_platform.subscriptions (tenant_id, plan, trial_ends_at, demo_request_id, number) VALUES ($1, 'TRIAL', now() + interval '14 days', $2, $3)", [t, demo, 900 + i]);
  const plan = (await c.query<{ id: string }>("SELECT id FROM wms_platform.plans LIMIT 1")).rows[0]!.id;
  await c.query("INSERT INTO wms_platform.charges (tenant_id, period, plan_id, plan_version, amount, due_on) VALUES ($1, date_trunc('month', now())::date, $2, 1, 990, now()::date)", [t, plan]);
  // Kuyruk işi (kiracıya ait zarf).
  await c.query("INSERT INTO pgboss.job (name, data) VALUES ('support.notify', $1::jsonb)", [JSON.stringify({ tenantId: t, eventId: randomUUID() })]);
}

if (env.target === "compose") {
  describe("deploy/vps/ops/reset-tenants.sql — müşteri sıfırlama (T-1004)", () => {
    beforeAll(async () => {
      const port = new URL(env.databaseUrlDirect).port;
      const ids = execFileSync("docker", ["ps", "--filter", `publish=${port}`, "--format", "{{.ID}}"], { encoding: "utf8" })
        .split("\n")
        .filter((l) => l.trim() !== "");
      if (ids.length !== 1) throw new Error(`postgres container lookup by published port found ${ids.length} containers (expected 1)`);
      container = ids[0]!;

      dbName = `wms_reset_${hex(4)}`;
      adm = new pg.Client({ connectionString: env.databaseUrlDirect });
      adm.on("error", () => undefined);
      await adm.connect();
      await adm.query(`CREATE DATABASE ${dbName}`);
      resetUrl = withDb(env.databaseUrlDirect, dbName);
      await migrateUp({ url: resetUrl });
      await installQueueSchema({ url: resetUrl });

      c = new pg.Client({ connectionString: resetUrl });
      c.on("error", () => undefined);
      await c.connect();
      const appUser = new URL(env.databaseUrl);
      app = createDbClient({
        url: withDb(env.databaseUrlDirect, dbName, { name: decodeURIComponent(appUser.username), password: decodeURIComponent(appUser.password) }),
        poolMax: DB_CLIENT_SETTINGS.poolMax,
        prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare,
      });

      // MFA'lı operatör: parola, doğrulanmış TOTP, MFA'lı oturum, güvenilir cihaz.
      operatorId = (await c.query<{ id: string }>(
        "INSERT INTO public.users (name, email, email_verified, two_factor_enabled) VALUES ('T1004 operatör', $1, true, true) RETURNING id",
        [OPERATOR_EMAIL],
      )).rows[0]!.id;
      operatorPasswordHash = await hashPassword(operatorPassword);
      await c.query("INSERT INTO public.accounts (account_id, provider_id, user_id, password) VALUES ($1::text, 'credential', $1::uuid, $2)", [operatorId, operatorPasswordHash]);
      await c.query("INSERT INTO public.two_factors (secret, backup_codes, user_id, verified) VALUES ('enc-secret', 'enc-codes', $1, true)", [operatorId]);
      await c.query("INSERT INTO public.sessions (expires_at, token, user_id, mfa_verified_at) VALUES (now() + interval '7 days', $1, $2, now())", [hex(16), operatorId]);
      await c.query("INSERT INTO public.verifications (identifier, value, expires_at) VALUES ($1, $2, now() + interval '30 days')", [`trust-device:h.${hex(16)}`, operatorId]);

      const reg = newRegistry();
      for (const label of ["R1004A", "R1004B"]) worlds.push(await seedWorld(c, reg, label));
      // Operatör aynı zamanda A kiracısının üyesi: üyeliği silinmeli, hesabı kalmalı.
      await c.query("INSERT INTO public.tenant_memberships (tenant_id, user_id, status) VALUES ($1, $2, 'ACTIVE')", [worlds[0]!.tenantId, operatorId]);
      // Panel tanımı ve operatör işlem kaydı gerçek domain yoluyla (platform.* güvenlik olayları).
      const op = { db: app, principal: { userId: operatorId, mfaVerified: true }, recentAuth: async () => undefined };
      await savePlan({ ...op, plan: { name: "T1004 Paket", price: "990", limits: { admins: 1, field: 1, warehouses: 1, items: 10 }, features: { qr: true, ship: false, prod: false, api: false }, published: false, recommended: false } });
      await setCustomerSuspended({ ...op, tenantId: worlds[1]!.tenantId, suspend: true, reason: "T1004 deneme" });
      for (const [i, w] of worlds.entries()) await seedExtras(w, i);

      migrationsBefore = await n("SELECT count(*) AS n FROM wms_meta.schema_migrations");
      triggersBefore = (await c.query<{ s: string }>("SELECT string_agg(tgrelid::regclass || '.' || tgname || '=' || tgenabled::text, ',' ORDER BY tgrelid::regclass::text, tgname) AS s FROM pg_trigger WHERE NOT tgisinternal")).rows[0]!.s;
      operatorEventsBefore = await n("SELECT count(*) AS n FROM public.security_events WHERE user_id = $1 AND event_type LIKE 'platform.%'", [operatorId]);
    }, 240_000);

    afterAll(async () => {
      await app?.close().catch(() => undefined);
      await c?.end().catch(() => undefined);
      if (dbName !== undefined) await adm.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => undefined);
      await adm?.end().catch(() => undefined);
    }, 120_000);

    it("tohum kapsamı: gerekli her kiracı tablosu dolu, operatör olayı var", async () => {
      const empty: string[] = [];
      for (const t of REQUIRED) if ((await n(`SELECT count(*) AS n FROM ${t}`)) === 0) empty.push(t);
      expect(empty).toEqual([]);
      expect(operatorEventsBefore).toBeGreaterThan(0);
    });

    it("geçersiz dry_run reddedilir; kuru koşu sayıları gösterir, doğrular ve hiçbir şeyi değiştirmez", async () => {
      const bad = runScript("evet");
      expect(bad.status).not.toBe(0);
      expect(bad.out).toContain("RESET_ABORT");
      const dry = runScript("1");
      expect(dry.status, dry.out).toBe(0);
      expect(dry.out).toContain("silinecek kiracı (tenant): 2");
      expect(dry.out).toContain("doğrulama TAMAM");
      expect(dry.out).toContain("KURU KOŞU");
      expect(await n("SELECT count(*) AS n FROM public.tenants")).toBe(2);
      expect(await n("SELECT count(*) AS n FROM public.stock_ledger")).toBeGreaterThan(0);
      expect(await n("SELECT count(*) AS n FROM wms_platform.demo_requests")).toBe(2);
    });

    it("gerçek koşu: kiracı ve yetim satır 0, müşteri kullanıcıları gitti; operatör, paket, şema ve tetikleyiciler aynen", async () => {
      const real = runScript("0");
      expect(real.status, real.out).toBe(0);
      expect(real.out).toContain("TAMAMLANDI");

      expect(await n("SELECT count(*) AS n FROM public.tenants")).toBe(0);
      const cols = await c.query<{ s: string; t: string; col: string }>(
        `SELECT c.table_schema AS s, c.table_name AS t, c.column_name AS col FROM information_schema.columns c
           JOIN information_schema.tables x USING (table_schema, table_name)
          WHERE x.table_type = 'BASE TABLE' AND (c.column_name = 'tenant_id' OR c.column_name LIKE '%\\_tenant\\_id')`,
      );
      expect(cols.rows.length).toBeGreaterThan(60);
      for (const r of cols.rows) expect(await n(`SELECT count(*) AS n FROM "${r.s}"."${r.t}" WHERE "${r.col}" IS NOT NULL`), `${r.s}.${r.t}`).toBe(0);
      for (const t of ["wms_platform.demo_requests", "public.field_sessions", "public.field_device_lockouts", "pgboss.job"]) {
        expect(await n(`SELECT count(*) AS n FROM ${t}`), t).toBe(0);
      }
      expect(await n("SELECT count(*) AS n FROM public.users")).toBe(1);
      expect(await n("SELECT count(*) AS n FROM public.users WHERE id = ANY($1::uuid[])", [worlds.flatMap((w) => [w.ownerUserId, w.memberUserId])])).toBe(0);
      expect(await n("SELECT count(*) AS n FROM public.security_events WHERE user_id IS DISTINCT FROM $1 AND user_id IS NOT NULL", [operatorId])).toBe(0);
      expect(await n("SELECT count(*) AS n FROM public.verifications WHERE value <> $1", [operatorId])).toBe(0);

      // Operatör: hesap, parola, MFA, oturum, güvenilir cihaz, panel işlem kaydı.
      const u = (await c.query<{ email_verified: boolean; two_factor_enabled: boolean }>("SELECT email_verified, two_factor_enabled FROM public.users WHERE id = $1", [operatorId])).rows[0]!;
      expect(u).toEqual({ email_verified: true, two_factor_enabled: true });
      const pw = (await c.query<{ password: string }>("SELECT password FROM public.accounts WHERE user_id = $1 AND provider_id = 'credential'", [operatorId])).rows[0]!.password;
      expect(pw).toBe(operatorPasswordHash);
      expect(await verifyPassword({ hash: pw, password: operatorPassword })).toBe(true);
      expect(await n("SELECT count(*) AS n FROM public.two_factors WHERE user_id = $1 AND verified", [operatorId])).toBe(1);
      expect(await n("SELECT count(*) AS n FROM public.sessions WHERE user_id = $1 AND mfa_verified_at IS NOT NULL", [operatorId])).toBe(1);
      expect(await n("SELECT count(*) AS n FROM public.verifications WHERE value = $1 AND identifier LIKE 'trust-device:h.%'", [operatorId])).toBe(1);
      expect(await n("SELECT count(*) AS n FROM public.security_events WHERE user_id = $1 AND event_type LIKE 'platform.%'", [operatorId])).toBe(operatorEventsBefore);
      expect(await n("SELECT count(*) AS n FROM wms_platform.operators")).toBe(1);
      expect(await n("SELECT count(*) AS n FROM wms_platform.plans")).toBe(1);
      expect(await n("SELECT count(*) AS n FROM wms_platform.plan_versions")).toBe(1);
      expect(await n("SELECT count(*) AS n FROM pgboss.queue")).toBeGreaterThan(0);

      // Şema, migration defteri ve tetikleyici kipleri aynı; append-only kuralı yine işliyor.
      expect(await n("SELECT count(*) AS n FROM wms_meta.schema_migrations")).toBe(migrationsBefore);
      const triggersAfter = (await c.query<{ s: string }>("SELECT string_agg(tgrelid::regclass || '.' || tgname || '=' || tgenabled::text, ',' ORDER BY tgrelid::regclass::text, tgname) AS s FROM pg_trigger WHERE NOT tgisinternal")).rows[0]!.s;
      expect(triggersAfter).toBe(triggersBefore);
      await expect(c.query("DELETE FROM public.security_events WHERE user_id = $1", [operatorId])).rejects.toThrow();
    });

    it("operatör panelde yetkili (MFA'lı) ve işlem kaydını okuyabiliyor", async () => {
      const events = await listPanelEvents({ db: app, principal: { userId: operatorId, mfaVerified: true } });
      expect(events.length).toBe(operatorEventsBefore);
    });

    it("sıfırlamadan sonra yeni kiracı açılabiliyor (onboarding domain'i, wms_app + RLS)", async () => {
      const user = (await c.query<{ id: string }>("INSERT INTO public.users (name, email) VALUES ('T1004 yeni', $1) RETURNING id", [`t1004-${hex(5)}@example.test`])).rows[0]!.id;
      const r = await createWorkspace({
        db: app,
        env: { WMS_ENV: "ci", SIGNUP_ENABLED: "true", DEMO_EMAIL_DOMAIN: "demo.example.test" },
        principal: { userId: user, mfaVerified: true },
        name: `Yeni Firma ${hex(3)}`,
        templateKey: "PACKAGING_SUPPLIES",
        requestId: randomUUID(),
      });
      expect(r.created).toBe(true);
      expect(await n("SELECT count(*) AS n FROM public.tenants")).toBe(1);
      expect(await n("SELECT count(*) AS n FROM public.tenant_memberships WHERE user_id = $1 AND is_owner", [user])).toBe(1);
    });
  });
}
