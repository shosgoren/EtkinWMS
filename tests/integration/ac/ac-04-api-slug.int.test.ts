// katman: API (sayfa/eylem)
// AC-04 — bağımsız kabul testi (T-124, qa-verifier): "Tenant A, B'nin ID'sini kullanır -> API, DB, dosya, cache, export reddeder".
// Bu dosya YALNIZCA sayfa yükleyicileri (`/t/<slug>` layout + sayfalar) ve Server Action katmanını kanıtlar; route handler/export/
// dosya/cache T-128, DB T-104'tür.
//
// Mock'lar YALNIZCA Next çalışma zamanı ve kimlik çözümüdür: `next/headers` (istek başlıkları), `next/navigation`
// (redirect/notFound -> ayırt edilebilir fırlatma), `next-intl/server` (çeviri anahtarı geri verir), `lib/auth-service`
// (`x-test-user` başlığı = oturumdaki kullanıcı) ve `lib/queue`. Eylem sarmalayıcısı (Origin, hız sınırı, hata maskeleme),
// domain komutları (withMembership), RLS ve `wms_app` rolü GERÇEKTİR. Veriler sentetik (G-09).
//
// Kapsam kuralı: `apps/web/app/t/[slug]` altındaki her sayfa/layout ve `members/actions.ts` / `settings/actions.ts` dışa aktarımları
// dosya sisteminden DİNAMİK listelenir; tabloda karşılığı olmayan yeni bir yükleyici/eylem testi KIRMIZI yapar.
import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ db: undefined as unknown, headers: new Headers() }));

// `next` / `next-intl` yalnızca apps/web bağımlılığıdır: kökten çözülemez; uygulamanın kopyaları dosya yoluyla hedeflenir.
vi.mock("../../../apps/web/node_modules/next/headers.js", () => ({
  headers: () => Promise.resolve(h.headers),
  cookies: () => Promise.resolve({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("../../../apps/web/node_modules/next/navigation.js", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${to}`), { kind: "redirect", to });
  },
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { kind: "notFound" });
  },
}));
vi.mock("../../../packages/db/src/index.ts", async (orig) => ({ ...(await orig<Record<string, unknown>>()), getAppDb: () => h.db }));
vi.mock("../../../apps/web/lib/auth-service.ts", () => ({
  ensureRecentAuth: () => Promise.resolve(),
  createPasswordResetToken: () => Promise.reject(new Error("not used")),
  discardPasswordResetToken: () => Promise.resolve(),
  recordPasswordResetLinkIssued: () => Promise.resolve(),
  createInvitedAccount: () => Promise.reject(new Error("account creation must not be reached")),
  // T-997: saha hesabı açma ve oturum kapatma çapraz tenant denemesinde hiç çağrılmamalı (ön denetim önce reddeder).
  createFieldAccount: () => Promise.reject(new Error("field account creation must not be reached")),
  revokeUserSessions: () => Promise.reject(new Error("session revocation must not be reached")),
  revokeDeviceSessions: () => Promise.reject(new Error("device session revocation must not be reached")),
  getAuthService: () => ({
    getPrincipal: (headers: Headers) => {
      const u = headers.get("x-test-user");
      return Promise.resolve(u === null ? null : { userId: u, mfaVerified: headers.get("x-test-mfa") !== "false" });
    },
  }),
}));
vi.mock("../../../apps/web/lib/queue.ts", () => ({ getSenderQueue: () => Promise.resolve(undefined) }));

import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { preparePackageReceipt, postPackageReceipt } from "../../../packages/domain/src/operations/index.ts";
import { readIntEnv, redactErrorChain } from "../harness/env.ts";

const env = readIntEnv(process.env);
const ORIGIN = "https://app.example.test";
const WEB = path.resolve(import.meta.dirname, "../../../apps/web");
const SLUG_DIR = path.join(WEB, "app/t/[slug]");
const rnd = (): string => randomBytes(6).toString("hex");

// next-intl: paket koşula göre farklı dosyalara çözülür; hepsi aynı sahte modüle bağlanır (yalnızca çeviri anahtarı döner).
const intlMock = () => ({
  getTranslations: () => Promise.resolve((key: string) => key),
  getFormatter: () => Promise.resolve({ dateTime: () => "" }),
  getLocale: () => Promise.resolve("tr"),
});
const intlRoot = path.join(WEB, "node_modules/next-intl");
for (const variant of ["development/server.react-server.js", "production/server.react-server.js", "development/server.react-client.js", "production/server.react-client.js"]) {
  vi.doMock(path.join(intlRoot, "dist/esm", variant), intlMock);
}
vi.doMock("next-intl/server", intlMock);

let app: DbClient;
let adm: pg.Client;

interface Fx {
  label: string;
  tenant: string;
  slug: string;
  name: string;
  admin: string;
  manager: string;
  picker: string;
  adminMembership: string;
  managerMembership: string;
  pickerMembership: string;
  /** T-207: tenant'a ait sentetik depo (depo sayfası yükleyicileri için). */
  warehouse: string;
  warehouseName: string;
}

async function mkUser(label: string): Promise<{ id: string; email: string }> {
  const email = `t124-${label}-${rnd()}@example.test`.toLowerCase();
  const r = await adm.query<{ id: string }>("INSERT INTO public.users (name, email, email_verified) VALUES ($1, $2, true) RETURNING id", [`T124 ${label}`, email]);
  return { id: (r.rows[0] as { id: string }).id, email };
}
async function mkMember(tenant: string, role: string, label: string, owner = false): Promise<{ user: string; membership: string }> {
  const u = await mkUser(label);
  const m = await adm.query<{ id: string }>("INSERT INTO public.tenant_memberships (tenant_id, user_id, status, is_owner) VALUES ($1, $2, 'ACTIVE', $3) RETURNING id", [tenant, u.id, owner]);
  const membership = (m.rows[0] as { id: string }).id;
  await adm.query("INSERT INTO public.membership_roles (tenant_id, membership_id, role_key) VALUES ($1, $2, $3)", [tenant, membership, role]);
  return { user: u.id, membership };
}
async function mkTenant(label: string): Promise<Fx> {
  const tenant = randomUUID();
  const slug = `t124-${label.toLowerCase()}-${rnd()}`;
  const name = `T124 ${label} ${rnd()}`;
  await adm.query("INSERT INTO public.tenants (id, slug, name) VALUES ($1, $2, $3)", [tenant, slug, name]);
  await adm.query("INSERT INTO public.tenant_settings (tenant_id, locale, time_zone, onboarding_status) VALUES ($1, 'tr', 'Europe/Istanbul', 'COMPLETED')", [tenant]);
  const a = await mkMember(tenant, "TENANT_ADMIN", `${label}-admin`, true);
  const m = await mkMember(tenant, "WAREHOUSE_MANAGER", `${label}-manager`);
  const p = await mkMember(tenant, "PICKER", `${label}-picker`);
  const warehouse = randomUUID();
  const warehouseName = `T207 Depo ${label} ${rnd()}`;
  await adm.query("INSERT INTO public.warehouses (tenant_id, id, code, name) VALUES ($1, $2, $3, $4)", [tenant, warehouse, `W-${label}`, warehouseName]);
  return { label, tenant, slug, name, warehouse, warehouseName, admin: a.user, manager: m.user, picker: p.user, adminMembership: a.membership, managerMembership: m.membership, pickerMembership: p.membership };
}

/** Tenant'ın gözlemlenebilir tüm durumu (etki yok kanıtı için önce/sonra karşılaştırılır). */
async function snapshot(t: Fx): Promise<unknown> {
  const q = async (text: string): Promise<unknown[]> => (await adm.query(text, [t.tenant])).rows;
  return {
    tenant: await q("SELECT name, status FROM public.tenants WHERE id = $1"),
    settings: await q("SELECT locale, time_zone, onboarding_status, terminology FROM public.tenant_settings WHERE tenant_id = $1"),
    memberships: await q("SELECT id, user_id, status, is_owner, roles_version FROM public.tenant_memberships WHERE tenant_id = $1 ORDER BY id"),
    roles: await q("SELECT membership_id, role_key FROM public.membership_roles WHERE tenant_id = $1 ORDER BY membership_id, role_key"),
    invitations: await q("SELECT id, revoked_at, accepted_at FROM public.invitations WHERE tenant_id = $1 ORDER BY id"),
    audit: await q("SELECT count(*)::int AS n FROM public.audit_logs WHERE tenant_id = $1"),
    // T-313: kabul/yerleştirme eylemleri B'de belge, satır, görev, idempotency kaydı, defter ve bakiye bırakmamalı.
    receipts: await q("SELECT id, status, version FROM public.inbound_receipts WHERE tenant_id = $1 ORDER BY id"),
    receiptLines: await q("SELECT id, received_quantity::text AS r, damaged_quantity::text AS d FROM public.inbound_receipt_lines WHERE tenant_id = $1 ORDER BY id"),
    documents: await q("SELECT count(*)::int AS n FROM public.documents WHERE tenant_id = $1"),
    tasks: await q("SELECT count(*)::int AS n, count(*) FILTER (WHERE status = 'OPEN')::int AS open FROM public.warehouse_tasks WHERE tenant_id = $1"),
    idempotency: await q("SELECT count(*)::int AS n FROM public.idempotency_records WHERE tenant_id = $1"),
    ledger: await q("SELECT count(*)::int AS n, COALESCE(sum(quantity), 0)::text AS q FROM public.stock_ledger WHERE tenant_id = $1"),
    packageSteps: await q("SELECT document_line_id, handling_unit_id, sequence_no FROM public.package_movement_steps WHERE tenant_id = $1 ORDER BY document_line_id"),
    packageOrigins: await q("SELECT id, document_id, lot_code, produced_on::text, expires_on::text FROM public.receipt_packages WHERE tenant_id = $1 ORDER BY id"),
    balances: await q("SELECT count(*)::int AS n, COALESCE(sum(quantity), 0)::text AS q, COALESCE(sum(reserved_quantity), 0)::text AS r FROM public.stock_balances WHERE tenant_id = $1"),
  };
}

let ipN = 0;
const nextIp = (): string => `198.51.100.${((parseInt(rnd().slice(0, 2), 16) + ++ipN) % 250) + 1}`;
function as(user: string | null, origin: string | null = ORIGIN): void {
  const hd = new Headers({ "fly-client-ip": nextIp(), "user-agent": "t124-qa" });
  if (origin !== null) hd.set("origin", origin);
  if (user !== null) hd.set("x-test-user", user);
  h.headers = hd;
}

const saved: Record<string, string | undefined> = {};
const ENV_KEYS = ["BETTER_AUTH_URL", "BETTER_AUTH_SECRET", "WMS_ENV", "MAIL_MODE", "MAILPIT_URL", "MAIL_FROM", "DEMO_EMAIL_DOMAIN", "SIGNUP_ENABLED", "PACKAGE_RECEIVING_ENABLED"] as const;

let A: Fx;
let B: Fx;
let outsider: { id: string; email: string };
let bInvite: { invitationId: string; token: string; email: string };

type ActionResult = { ok: true; data: Record<string, unknown> } | { ok: false; error: { code: string; messageKey?: string; requestId?: string; [k: string]: unknown } };
type Actions = Record<string, (arg: unknown) => Promise<ActionResult>>;
let members: Actions;
let settings: { saveSettingsAction: (f: FormData) => Promise<void> };
let sodActions: { setSeparationAction: (form: FormData) => Promise<void> };
let inviteAccept: Actions;
let itemActions: Actions;
let taskActions: Actions;
let receiptActions: Actions;
let countActions: Actions;
/** T-313: B tenant'ının GERÇEK kabul belgesi/satırı ve lokasyonları (yazma eylemleri bu kimliklerle çağrılır; rastgele kimlik "yok" olduğundan tek başına yalıtımı kanıtlamaz). */
let bRcpt: { receipt: string; line: string; kabul: string; raf: string };
let packageDocs: { draftA: string; postedA: string; postedB: string; deniedUser: string };
/** T-304: B tenant'ının sentetik görevi (eylem tablosu bu kimlikle çağırır). */
let bTask: string;
/** T-216: her tenant için sentetik birim/ürün/barkod kimlikleri (eylem tablosu B'nin kimlikleriyle çağırır). */
let fx: { A: ItemFx; B: ItemFx };
interface ItemFx {
  unit: string;
  item: string;
  barcode: string;
}

/** Yanıtın karşılaştırılabilir yüzü (requestId çıkarılır). */
function face(r: ActionResult): unknown {
  if (r.ok) return r;
  const error: Record<string, unknown> = { ...r.error };
  delete error.requestId;
  return { ok: false, error };
}

beforeAll(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  Object.assign(process.env, {
    BETTER_AUTH_URL: ORIGIN,
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), // sentetik, koşu başına (gitleaks: literal sır yok)
    WMS_ENV: "ci",
    MAIL_MODE: "mailpit",
    MAILPIT_URL: "http://localhost:8025",
    MAIL_FROM: "noreply@example.test",
    PACKAGE_RECEIVING_ENABLED: "true",
  });
  delete process.env.DEMO_EMAIL_DOMAIN;
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  try {
    await adm.connect();
  } catch (e) {
    throw new Error(`connect failed: ${redactErrorChain(e, [env.databaseUrl, env.databaseUrlDirect])}`);
  }
  h.db = app;
  A = await mkTenant("A");
  B = await mkTenant("B");
  outsider = await mkUser("outsider"); // hiçbir tenant'ın üyesi değil
  // Dinamik yol: kök tsc `next` tiplerini (yalnızca apps/web bağımlılığı) çözemez; çalışma zamanında vitest modülü çözer ve mock'lar geçerlidir.
  const load = (rel: string): Promise<unknown> => import(/* @vite-ignore */ path.join(WEB, rel));
  members = (await load("app/t/[slug]/members/actions.ts")) as Actions;
  settings = (await load("app/t/[slug]/settings/actions.ts")) as typeof settings;
  sodActions = (await load("app/t/[slug]/settings/sod-actions.ts")) as typeof sodActions;
  inviteAccept = (await load("app/invite/[token]/actions.ts")) as Actions;
  itemActions = (await load("app/t/[slug]/items/actions.ts")) as Actions;
  taskActions = (await load("app/t/[slug]/tasks/actions.ts")) as Actions;
  receiptActions = (await load("app/t/[slug]/receipts/actions.ts")) as Actions;
  countActions = (await load("app/t/[slug]/counts/actions.ts")) as Actions;
  bTask = (await adm.query<{ id: string }>("INSERT INTO public.warehouse_tasks (tenant_id, warehouse_id, kind) VALUES ($1, $2, 'PICK') RETURNING id", [B.tenant, B.warehouse])).rows[0]!.id;
  const mkFx = async (t: Fx): Promise<ItemFx> => {
    const unit = (await adm.query<{ id: string }>("INSERT INTO public.units (tenant_id, id, code, name) VALUES ($1, gen_random_uuid(), $2, 'Birim') RETURNING id", [t.tenant, `U${rnd()}`])).rows[0]!.id;
    const item = (await adm.query<{ id: string }>("INSERT INTO public.items (tenant_id, id, code, name, base_unit_id) VALUES ($1, gen_random_uuid(), $2, 'Fx urun', $3) RETURNING id", [t.tenant, `FX-${rnd()}`, unit])).rows[0]!.id;
    const barcode = (await adm.query<{ id: string }>("INSERT INTO public.item_barcodes (tenant_id, id, item_id, barcode) VALUES ($1, gen_random_uuid(), $2, $3) RETURNING id", [t.tenant, item, `8${rnd()}`])).rows[0]!.id;
    return { unit, item, barcode };
  };
  fx = { A: await mkFx(A), B: await mkFx(B) };
  {
    const mkLoc = async (code: string, kind: string): Promise<string> =>
      (await adm.query<{ id: string }>("INSERT INTO public.locations (tenant_id, id, warehouse_id, parent_id, code, name, depth, kind) VALUES ($1, gen_random_uuid(), $2, NULL, $3, 'B lok', 0, $4) RETURNING id", [B.tenant, B.warehouse, `${code}${rnd()}`.toUpperCase(), kind])).rows[0]!.id;
    const kabul = await mkLoc("BK", "RECEIVING");
    const raf = await mkLoc("BR", "STORAGE");
    const receipt = (await adm.query<{ id: string }>(
      "INSERT INTO public.inbound_receipts (tenant_id, id, warehouse_id, number, created_by, status) VALUES ($1, gen_random_uuid(), $2, $3, (SELECT user_id FROM public.tenant_memberships WHERE id = $4), 'OPEN') RETURNING id",
      [B.tenant, B.warehouse, `KBL-B-${rnd()}`, B.adminMembership],
    )).rows[0]!.id;
    const line = (await adm.query<{ id: string }>(
      "INSERT INTO public.inbound_receipt_lines (tenant_id, id, receipt_id, line_no, item_id, unit_id, conversion_factor, expected_quantity) VALUES ($1, gen_random_uuid(), $2, 1, $3, $4, 1, 10) RETURNING id",
      [B.tenant, receipt, fx.B.item, fx.B.unit],
    )).rows[0]!.id;
    bRcpt = { receipt, line, kabul, raf };
  }

  // Real package origins, permissions and posting; only the request identity is mocked.
  const receivingA = randomUUID();
  await adm.query("INSERT INTO public.locations (tenant_id,id,warehouse_id,code,name,depth,kind) VALUES($1,$2,$3,$4,'A package receiving',0,'RECEIVING')", [A.tenant, receivingA, A.warehouse, `PA-${rnd()}`]);
  const packageReceipt = async (t: Fx, item: ItemFx, location: string, posted: boolean): Promise<string> => {
    const params = { db: app, principal: { userId: t.admin, mfaVerified: true }, tenantSlug: t.slug, clientKey: randomUUID() };
    const result = await preparePackageReceipt(params, { warehouseId: t.warehouse, receivingLocationId: location, itemId: item.item, unitId: item.unit, kind: "VARIL", packages: { mode: "equal", count: 2, quantity: "200", lotCode: `PKG-${t.label}-${rnd()}`, producedOn: "2026-01-01", expiresOn: "2028-01-01" } });
    const documentId = result.documentId as string;
    if (posted) await postPackageReceipt({ ...params, clientKey: randomUUID() }, { documentId, expectedVersion: 1 });
    return documentId;
  };
  const denied = await mkUser("package-no-permission");
  await adm.query("INSERT INTO public.tenant_memberships(tenant_id,user_id,status,is_owner) VALUES($1,$2,'ACTIVE',false)", [A.tenant, denied.id]);
  packageDocs = {
    draftA: await packageReceipt(A, fx.A, receivingA, false),
    postedA: await packageReceipt(A, fx.A, receivingA, true),
    postedB: await packageReceipt(B, fx.B, bRcpt.kabul, true),
    deniedUser: denied.id,
  };

  // B yöneticisi (meşru) bir davet üretir: hem olumlu kontrol hem de çapraz tenant kabul denemesi için belirteç.
  as(B.admin);
  const email = `t124-invitee-${rnd()}@example.test`;
  const r = await members.inviteMemberAction!({ slug: B.slug, email, roleKey: "PICKER" });
  if (!r.ok) throw new Error(`fixture invite failed: ${r.error.code}`);
  const link = String(r.data.inviteLink ?? "");
  bInvite = { invitationId: String(r.data.invitationId), token: link.slice(link.lastIndexOf("/") + 1), email };
}, 180_000);

afterAll(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await app?.close().catch(() => undefined);
  await adm?.end().catch(() => undefined);
}, 60_000);

function files(dir: string, re: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full, re));
    else if (re.test(name)) out.push(path.relative(SLUG_DIR, full).split(path.sep).join("/"));
  }
  return out.sort();
}

// ---------------------------------------------------------------------------------------------
// Sayfa yükleyicileri
// ---------------------------------------------------------------------------------------------

const LOADERS = [
  // T-903c: every pilot loader must enforce its own tenant boundary.
  "stock/page.tsx",
  "stock/documents/page.tsx",
  "production/page.tsx",
  "shipping/page.tsx",
  "layout.tsx",
  "page.tsx",
  "members/page.tsx",
  // T-997: saha personeli ekle (users.manage; saha giriş listesi sayfanın kendisinde çözülür).
  "members/field/page.tsx",
  // T-998: saha cihazları (users.manage; cihaz listesi sayfanın kendisinde çözülür).
  "members/devices/page.tsx",
  // T-429: ekibe katılma talepleri (users.manage; çapraz tenant 404).
  "members/join/page.tsx",
  "settings/page.tsx",
  "audit/page.tsx",
  "items/page.tsx",
  "warehouses/page.tsx",
  "import/page.tsx",
  // T-428: cari kartlar (üyelik özeti + `listParties`; çapraz tenant 404).
  "parties/page.tsx",
  // T-421: yetki grupları (üyelik özeti + `listGroups`, users.manage; çapraz tenant 404).
  "groups/page.tsx",
  // T-430: Ekip ekranı (listGroups + getJoinOverview, users.manage; çapraz tenant 404).
  "team/page.tsx",
  "warehouses/[warehouseId]/page.tsx",
  // T-304: görev ekranları; üyelik/izin `listTasks`/`listMyTasks`/üyelik özeti ile sayfanın kendisinde çözülür.
  "tasks/page.tsx",
  "field/tasks/page.tsx",
  // T-313: kabul ve yerleştirme ekranları; üyelik özeti + `listInboundReceipts`/`getInboundReceipt`/`listMyTasks` ile sayfanın kendisinde çözülür.
  "receipts/page.tsx",
  "field/receive/page.tsx",
  "field/putaway/page.tsx",
  // T-977: saha toplama/sevk/sayım ve yönetici sayım ekranları; üyelik özeti ile sayfanın kendisinde çözülür (üye değil → 404), veri okuması sonra.
  "field/pick/page.tsx",
  "field/ship/page.tsx",
  "field/count/page.tsx",
  "counts/page.tsx",
] as const;
/**
 * T-304: tenant verisi çizmeyen saha kabuğu sayfaları. Üyelik kararı üst `layout.tsx`'tedir (yukarıdaki LOADERS satırı çapraz tenant
 * için 404 verir); burada kendi başlarına B'ye ait hiçbir şey çizmedikleri ve var olmayan slug ile aynı yapıyı verdikleri sınanır.
 */
const SHELL_LOADERS = ["field/layout.tsx", "field/page.tsx"] as const;
/** T-312: etiket sayfası kaynak (depo) ister; kaynaksız çağrı tenant'a hiç dokunmaz, bu yüzden özel blokta `?warehouse=` ile sınanır. */
const LABELS = "labels/page.tsx" as const;
/** T-216: ürün ayrıntısı ek bir dinamik segment (`itemId`) ister; ortak döngüde değil, aşağıdaki özel bloktadır. */
const ITEM_DETAIL = "items/[itemId]/page.tsx" as const;
const PACKAGE_MOVEMENT_LOADER = "field/packages/page.tsx" as const;
const PACKAGE_LOADERS = ["receipts/packages/page.tsx", "receipts/packages/labels/page.tsx"] as const;
type Loader = (props: {
  params: Promise<{ slug: string; warehouseId?: string; itemId?: string }>;
  searchParams?: Promise<Record<string, string>>;
  children?: unknown;
}) => Promise<unknown>;

/** `[warehouseId]` yükleyicisi için kimlik: verilmezse slug A'nınsa A'nın, değilse B'nin deposu (çapraz tenant denemesi). */
async function runLoader(
  rel: (typeof LOADERS)[number] | typeof ITEM_DETAIL | (typeof SHELL_LOADERS)[number] | typeof LABELS | (typeof PACKAGE_LOADERS)[number] | typeof PACKAGE_MOVEMENT_LOADER,
  slug: string,
  warehouseId?: string,
  itemId?: string,
  search: Record<string, string> = {},
): Promise<{ outcome: "render" | "notFound" | "redirect"; to?: string; value?: unknown }> {
  const mod = (await import(/* @vite-ignore */ path.join(SLUG_DIR, rel))) as { default: Loader };
  const wid = warehouseId ?? (slug === A.slug ? A.warehouse : B.warehouse);
  try {
    const params = itemId === undefined ? { slug, warehouseId: wid } : { slug, warehouseId: wid, itemId };
    const value = await mod.default({ params: Promise.resolve(params), searchParams: Promise.resolve(search), children: null });
    return { outcome: "render", value };
  } catch (e) {
    const k = (e as { kind?: string }).kind;
    if (k === "notFound") return { outcome: "notFound" };
    if (k === "redirect") return { outcome: "redirect", to: (e as { to: string }).to };
    throw e;
  }
}

describe("saha kabuğu ve etiket sayfaları (/t/<slug>)", () => {
  for (const rel of SHELL_LOADERS) {
    it(`@AC-04 sayfa ${rel}: B'nin slug'ıyla da var olmayan slug'la da aynı yapı (yalnızca istenen slug yankılanır); B'ye ait ad/kimlik çizilmez (404 kararı üst layout.tsx'te)`, async () => {
      as(A.admin);
      const cross = await runLoader(rel, B.slug);
      as(A.admin);
      const missingSlug = `yok-${rnd()}`;
      const missing = await runLoader(rel, missingSlug);
      // T-969: field/page.tsx (OKUT) üyeliği kendisi de denetler → üye olmadığı slug ile var olmayan slug aynı 404; layout yalnız çizer.
      expect(cross.outcome).toBe(rel === "field/page.tsx" ? "notFound" : "render");
      // React öğesinin `type` alanı (bileşen/modül nesnesi) döngüsel olabilir; yalnızca çizilen veri (props/anahtarlar) karşılaştırılır.
      const norm = (v: unknown, slug: string): string =>
        JSON.stringify(v, (k, x: unknown) => (k === "type" || k === "_owner" || k === "_store" ? undefined : x)).split(encodeURIComponent(slug)).join("<slug>");
      expect(norm(cross, B.slug)).toEqual(norm(missing, missingSlug));
      expect(norm(cross, B.slug)).not.toContain(B.name);
      expect(norm(cross, B.slug)).not.toContain(B.tenant);
      expect(norm(cross, B.slug)).not.toContain(B.warehouse);
    });
  }

  it("@AC-04 sayfa labels/page.tsx: A kullanıcısı B'nin slug'ı + B deposuyla -> 404 (var olmayan slug ile aynı sonuç); üye olmayan 404; oturumsuz -> /login", async () => {
    as(A.admin);
    const cross = await runLoader(LABELS, B.slug, undefined, undefined, { warehouse: B.warehouse });
    as(A.admin);
    const missing = await runLoader(LABELS, `yok-${rnd()}`, undefined, undefined, { warehouse: B.warehouse });
    expect(cross).toEqual({ outcome: "notFound" });
    expect(cross).toEqual(missing);
    as(outsider.id);
    expect(await runLoader(LABELS, B.slug, undefined, undefined, { warehouse: B.warehouse })).toEqual({ outcome: "notFound" });
    as(null);
    const anon = await runLoader(LABELS, B.slug, undefined, undefined, { warehouse: B.warehouse });
    expect(anon.outcome).toBe("redirect");
    expect(anon.to).toMatch(/^\/login\?next=/);
  });

  it("@AC-04 sayfa labels/page.tsx: A kendi slug'ında B'nin depo kimliğini basamaz -> 404; kendi deposunu çizer (olumlu kontrol)", async () => {
    as(A.admin);
    const cross = await runLoader(LABELS, A.slug, undefined, undefined, { warehouse: B.warehouse });
    expect(cross).toEqual({ outcome: "notFound" });
    // Olumlu kontrol için A'nın deposunda en az bir lokasyon gerekir (etiket kaynağı boşsa 404).
    await adm.query("INSERT INTO public.locations (tenant_id, id, warehouse_id, parent_id, code, name, depth, kind) VALUES ($1, gen_random_uuid(), $2, NULL, $3, 'Etiket Bolge', 0, 'STORAGE')", [A.tenant, A.warehouse, `ZL-${rnd()}`]);
    as(A.admin);
    const own = await runLoader(LABELS, A.slug, undefined, undefined, { warehouse: A.warehouse });
    expect(own.outcome).toBe("render");
    expect(JSON.stringify(own.value)).not.toContain(B.warehouseName);
  });
});

describe("sayfa yükleyicileri (/t/<slug>)", () => {
  it("@AC-04 kapsam: apps/web/app/t/[slug] altındaki her page/layout bu tabloda (yeni yükleyici testsiz kalamaz)", () => {
    expect(files(SLUG_DIR, /^(page|layout)\.[cm]?[jt]sx?$/)).toEqual([...LOADERS, ...SHELL_LOADERS, LABELS, ITEM_DETAIL, ...PACKAGE_LOADERS, PACKAGE_MOVEMENT_LOADER].sort());
  });

  for (const rel of LOADERS) {
    it(`@AC-04 sayfa ${rel}: A kullanıcısı B'nin slug'ıyla -> 404 (ya da hiçbir B verisi çizmeden boş); var olmayan slug ile aynı sonuç`, async () => {
      as(A.admin);
      const cross = await runLoader(rel, B.slug);
      as(A.admin);
      const missing = await runLoader(rel, `yok-${rnd()}`);
      // Ana ekran (page.tsx) 404'ü layout'a bırakır ve üyelik yoksa sessizce boş döner (kendi içeriği yok): çizim değeri null olmalı.
      if (rel === "page.tsx") {
        expect(cross).toEqual({ outcome: "render", value: null });
      } else {
        expect(cross.outcome).toBe("notFound");
      }
      expect(cross).toEqual(missing); // varlık sızmaz: B'nin slug'ı ile hiç var olmayan slug ayırt edilemez
      // B'ye özgü hiçbir şey (ad, kullanıcı adları) sonuçta yok.
      expect(JSON.stringify(cross)).not.toContain(B.name);
    });

    it(`@AC-04 sayfa ${rel}: hiçbir tenant'ın üyesi olmayan oturum B'nin slug'ıyla -> 404; oturumsuz -> /login`, async () => {
      as(outsider.id);
      const r = await runLoader(rel, B.slug);
      if (rel === "page.tsx") expect(r).toEqual({ outcome: "render", value: null });
      else expect(r.outcome).toBe("notFound");
      as(null);
      const anon = await runLoader(rel, B.slug);
      expect(anon.outcome).toBe("redirect");
      expect(anon.to).toMatch(/^\/login\?next=/);
    });

    it(`@AC-04 sayfa ${rel}: olumlu kontrol — A kullanıcısı kendi slug'ında çizer (testin geçersiz kılınmadığının kanıtı)`, async () => {
      as(A.admin);
      const r = await runLoader(rel, A.slug);
      expect(`${r.outcome} ${r.to ?? ""}`).toBe("render ");
      expect(r.value).not.toBeNull();
    });
  }

  it("@AC-04 depo sayfası: A yöneticisi KENDİ slug'ında B'nin depo kimliğini açamaz -> 404 (var olmayan kimlikle aynı), B verisi çizilmez", async () => {
    as(A.admin);
    const cross = await runLoader("warehouses/[warehouseId]/page.tsx", A.slug, B.warehouse);
    as(A.admin);
    const missing = await runLoader("warehouses/[warehouseId]/page.tsx", A.slug, randomUUID());
    expect(cross.outcome).toBe("notFound");
    expect(cross).toEqual(missing);
    expect(JSON.stringify(cross)).not.toContain(B.warehouseName);
    // Depo listesi yalnızca kendi tenant'ının deposunu içerir.
    as(A.admin);
    const list = await runLoader("warehouses/page.tsx", A.slug);
    expect(list.outcome).toBe("render");
    expect(JSON.stringify(list.value)).toContain(A.warehouse);
    expect(JSON.stringify(list.value)).not.toContain(B.warehouse);
    expect(JSON.stringify(list.value)).not.toContain(B.warehouseName);
  });

  it("@AC-04 sayfa üyelik sınırı: B'nin ÜYESİ olan kullanıcı A'nın slug'ında 404; B yöneticisi kendi slug'ında çizer", async () => {
    for (const user of [B.admin, B.manager, B.picker]) {
      as(user);
      expect((await runLoader("layout.tsx", A.slug)).outcome).toBe("notFound");
      as(user);
      expect((await runLoader("members/page.tsx", A.slug)).outcome).toBe("notFound");
    }
    as(B.admin);
    expect((await runLoader("members/page.tsx", B.slug)).outcome).toBe("render");
  });
});

describe("paket kabulü ve etiket yükleyicileri — gerçek DB üyelik/izin/RLS", () => {
  const rendered = (value: unknown): string => JSON.stringify(value, (key, v: unknown) =>
    ["type", "_owner", "_store"].includes(key) ? undefined : v);

  for (const rel of PACKAGE_LOADERS) {
    it(`@AC-04 ${rel}: bayrak kapalıyken yetkili ve oturumsuz istekler 404; veri değişmez`, async () => {
      const beforeA = await snapshot(A), beforeB = await snapshot(B);
      const prior = process.env.PACKAGE_RECEIVING_ENABLED;
      try {
        process.env.PACKAGE_RECEIVING_ENABLED = "false";
        for (const user of [A.admin, null]) {
          as(user, null);
          expect(await runLoader(rel, A.slug, undefined, undefined, { document: packageDocs.postedA })).toEqual({ outcome: "notFound" });
        }
      } finally {
        if (prior === undefined) delete process.env.PACKAGE_RECEIVING_ENABLED;
        else process.env.PACKAGE_RECEIVING_ENABLED = prior;
      }
      expect(await snapshot(A)).toEqual(beforeA);
      expect(await snapshot(B)).toEqual(beforeB);
    });

    it(`@AC-04 ${rel}: açık bayrakta yabancı slug, eksik slug ve üye olmayan kullanıcı aynı 404`, async () => {
      as(A.admin, null);
      const cross = await runLoader(rel, B.slug, undefined, undefined, { document: packageDocs.postedB });
      as(A.admin, null);
      const missing = await runLoader(rel, `yok-${rnd()}`, undefined, undefined, { document: packageDocs.postedB });
      as(outsider.id, null);
      const outsiderResult = await runLoader(rel, B.slug, undefined, undefined, { document: packageDocs.postedB });
      expect(cross).toEqual({ outcome: "notFound" });
      expect(missing).toEqual(cross);
      expect(outsiderResult).toEqual(cross);
      expect(rendered(cross)).not.toContain(B.name);
      expect(rendered(cross)).not.toContain(packageDocs.postedB);
    });

    it(`@AC-04 ${rel}: oturumsuz açık bayrak isteği document içeren kendi dönüş URL'siyle login'e gider`, async () => {
      as(null, null);
      const result = await runLoader(rel, A.slug, undefined, undefined, { document: packageDocs.postedA });
      const route = rel === PACKAGE_LOADERS[0] ? "receipts/packages" : "receipts/packages/labels";
      const returnTo = `/t/${encodeURIComponent(A.slug)}/${route}?${new URLSearchParams({ document: packageDocs.postedA })}`;
      expect(result).toEqual({ outcome: "redirect", to: `/login?next=${encodeURIComponent(returnTo)}` });
    });

    it(`@AC-04 ${rel}: gerçek aktif fakat rolü olmayan üyeye stock.view verilmez, belge verisi çizilmez`, async () => {
      const before = await snapshot(A);
      as(packageDocs.deniedUser, null);
      const denied = await runLoader(rel, A.slug, undefined, undefined, { document: packageDocs.postedA });
      expect(denied.outcome).toBe("render");
      const body = rendered(denied.value);
      expect(body).not.toContain(packageDocs.postedA);
      expect(body).not.toContain("200.000000");
      if (rel === PACKAGE_LOADERS[0]) expect(body).toContain("locked");
      else expect(body).toContain("stockViewRequired"); // T-999c: yetki uyarısı mesaj anahtarıyla çizilir (intl sahte modülü anahtarı döndürür)
      expect(await snapshot(A)).toEqual(before);
    });

    it(`@AC-04 ${rel}: kendi slug'ında yabancı mevcut belge ile olmayan belge ayırt edilemez, etki yok`, async () => {
      const beforeA = await snapshot(A), beforeB = await snapshot(B);
      as(A.admin, null);
      const foreign = await runLoader(rel, A.slug, undefined, undefined, { document: packageDocs.postedB });
      as(A.admin, null);
      const missing = await runLoader(rel, A.slug, undefined, undefined, { document: randomUUID() });
      expect(rendered(foreign)).toEqual(rendered(missing));
      if (rel === PACKAGE_LOADERS[0]) {
        expect(foreign.outcome).toBe("render");
        expect(rendered(foreign.value)).toContain("NOT_FOUND");
      } else expect(foreign).toEqual({ outcome: "notFound" });
      expect(rendered(foreign)).not.toContain(packageDocs.postedB);
      expect(rendered(foreign)).not.toContain(B.name);
      expect(await snapshot(A)).toEqual(beforeA);
      expect(await snapshot(B)).toEqual(beforeB);
    });
  }

  it("@AC-04 paket kabulü: Origin olmayan kendi GET'i DRAFT ve POSTED gerçek kimliklerle çizer, stok yazmaz", async () => {
    const before = await snapshot(A);
    for (const [documentId, status] of [[packageDocs.draftA, "DRAFT"], [packageDocs.postedA, "POSTED"]] as const) {
      as(A.admin, null);
      const own = await runLoader(PACKAGE_LOADERS[0], A.slug, undefined, undefined, { document: documentId });
      expect(own.outcome).toBe("render");
      const props = (own.value as { props: { canWrite: boolean; initial: { documentId: string; documentStatus: string; packages: readonly { id: string; quantity: string }[] } } }).props;
      expect(props.canWrite).toBe(true);
      expect(props.initial.documentId).toBe(documentId);
      expect(props.initial.documentStatus).toBe(status);
      expect(props.initial.packages).toHaveLength(2);
      expect(new Set(props.initial.packages.map(p => p.id)).size).toBe(2);
      expect(props.initial.packages.every(p => p.quantity === "200.000000")).toBe(true);
      expect(rendered(own.value)).not.toContain(packageDocs.postedB);
    }
    expect(await snapshot(A)).toEqual(before);
  });

  it("@AC-04 paket etiketleri: Origin olmayan kendi işlenmiş kabulü gerçek paketlerle çizer, stok yazmaz", async () => {
    const before = await snapshot(A);
    as(A.admin, null);
    const own = await runLoader(PACKAGE_LOADERS[1], A.slug, undefined, undefined, { document: packageDocs.postedA });
    expect(own.outcome).toBe("render");
    expect(rendered(own.value)).toContain(packageDocs.postedA);
    expect(rendered(own.value)).toContain("200.000000");
    expect(rendered(own.value)).not.toContain(packageDocs.postedB);
    expect(rendered(own.value)).not.toContain(B.name);
    expect(await snapshot(A)).toEqual(before);
  });
});

describe("paket hareketi gerçek GET yükleyicisi — T-945", () => {
  const rendered = (value: unknown): string => JSON.stringify(value, (key, v: unknown) => key === "type" || key === "_owner" || key === "_store" ? undefined : v);
  let ownPackage: { id: string; lot_code: string; produced_on: string; expires_on: string; location_id: string; location_code: string; location_name: string; location_kind: string; stock_status: string; quantity: string; version: string };
  let foreignPackage: { id: string; lot_code: string };

  beforeAll(async () => {
    // Oracle reads the existing domain-posted fixtures; no fabricated stock or authorization.
    const own = await adm.query<typeof ownPackage>(`SELECT rp.id,rp.lot_code,rp.produced_on::text,rp.expires_on::text,
      sd.location_id,loc.code AS location_code,loc.name AS location_name,loc.kind AS location_kind,
      sd.stock_status,b.quantity::text,b.version::text
      FROM public.receipt_packages rp
      JOIN public.stock_dimensions sd ON sd.tenant_id=rp.tenant_id AND sd.handling_unit_id=rp.id
      JOIN public.stock_balances b ON b.tenant_id=sd.tenant_id AND b.stock_dimension_id=sd.id AND b.quantity>0
      JOIN public.locations loc ON loc.tenant_id=sd.tenant_id AND loc.id=sd.location_id
      WHERE rp.tenant_id=$1 AND rp.document_id=$2 ORDER BY rp.package_no`, [A.tenant, packageDocs.postedA]);
    expect(own.rows).toHaveLength(2);
    ownPackage = own.rows[0]!;
    const foreign = await adm.query<typeof foreignPackage>("SELECT id,lot_code FROM public.receipt_packages WHERE tenant_id=$1 AND document_id=$2 ORDER BY package_no", [B.tenant, packageDocs.postedB]);
    expect(foreign.rows).toHaveLength(2);
    foreignPackage = foreign.rows[0]!;
  });

  const load = (slug: string, packageId?: string) => runLoader(PACKAGE_MOVEMENT_LOADER, slug, undefined, undefined, packageId === undefined ? {} : { package: packageId });
  const returnTo = () => `/t/${encodeURIComponent(A.slug)}/field/packages?${new URLSearchParams({ package: ownPackage.id })}`;
  const noForeignData = (value: unknown) => {
    for (const privateValue of [B.name, B.tenant, B.warehouse, B.warehouseName, fx.B.item, packageDocs.postedB, foreignPackage.id, foreignPackage.lot_code]) {
      expect(rendered(value)).not.toContain(privateValue);
    }
  };

  it("@AC-04 field/packages: bayrak false yetkili ve anonim gerçek paket GET'ini 404 yapar, etki yok", async () => {
    const beforeA = await snapshot(A), beforeB = await snapshot(B);
    const prior = process.env.PACKAGE_RECEIVING_ENABLED;
    try {
      process.env.PACKAGE_RECEIVING_ENABLED = "false";
      for (const user of [A.admin, null]) {
        as(user, null);
        expect(await load(A.slug, ownPackage.id)).toEqual({ outcome: "notFound" });
      }
    } finally {
      if (prior === undefined) delete process.env.PACKAGE_RECEIVING_ENABLED;
      else process.env.PACKAGE_RECEIVING_ENABLED = prior;
    }
    expect(await snapshot(A)).toEqual(beforeA);
    expect(await snapshot(B)).toEqual(beforeB);
  });

  it("@AC-04 field/packages: anonim GET yerel UUID sorgusunu login dönüşünde korur", async () => {
    const before = await snapshot(A);
    as(null, null);
    expect(await load(A.slug, ownPackage.id)).toEqual({ outcome: "redirect", to: `/login?next=${encodeURIComponent(returnTo())}` });
    as(null, null);
    expect(await load(A.slug)).toEqual({ outcome: "redirect", to: `/login?next=${encodeURIComponent(`/t/${A.slug}/field/packages`)}` });
    expect(await snapshot(A)).toEqual(before);
  });

  it("@AC-04 field/packages: yabancı slug ve üyelik yokluğu aynı 404, tenant/paket verisi yok", async () => {
    const beforeA = await snapshot(A), beforeB = await snapshot(B);
    as(A.admin, null);
    const cross = await load(B.slug, foreignPackage.id);
    as(A.admin, null);
    expect(await load(`yok-${rnd()}`, foreignPackage.id)).toEqual(cross);
    as(outsider.id, null);
    expect(await load(B.slug, foreignPackage.id)).toEqual(cross);
    as(B.admin, null);
    expect(await load(A.slug, ownPackage.id)).toEqual(cross);
    expect(cross).toEqual({ outcome: "notFound" });
    noForeignData(cross);
    expect(await snapshot(A)).toEqual(beforeA);
    expect(await snapshot(B)).toEqual(beforeB);
  });

  it("@AC-04 field/packages: kendi slug'ında gerçek yabancı paket ve eksik UUID aynı maskeli NOT_FOUND, etki yok", async () => {
    const beforeA = await snapshot(A), beforeB = await snapshot(B);
    as(A.admin, null);
    const cross = await load(A.slug, foreignPackage.id);
    as(A.admin, null);
    const missing = await load(A.slug, randomUUID());
    expect(cross.outcome).toBe("render");
    expect(rendered(cross)).toEqual(rendered(missing));
    expect(rendered(cross.value)).toContain("loadError");
    expect(rendered(cross.value)).toContain("NOT_FOUND");
    noForeignData(cross);
    expect(await snapshot(A)).toEqual(beforeA);
    expect(await snapshot(B)).toEqual(beforeB);
  });

  it("@AC-04 field/packages: aktif rolsüz üye kilitli görünüm alır, kendi paket metadata/kimlik verisi yok", async () => {
    const before = await snapshot(A);
    as(packageDocs.deniedUser, null);
    const denied = await load(A.slug, ownPackage.id);
    expect(denied.outcome).toBe("render");
    expect(rendered(denied.value)).toContain("locked");
    for (const privateValue of [ownPackage.id, ownPackage.lot_code, ownPackage.location_id, fx.A.item, packageDocs.postedA, "200.000000"]) {
      expect(rendered(denied.value)).not.toContain(privateValue);
    }
    noForeignData(denied);
    expect(await snapshot(A)).toEqual(before);
  });

  it("@AC-04 field/packages: Origin olmayan kendi GET gerçek QR/güncel bakiye/lokasyon/origin metadata çizer, salt okunur", async () => {
    const beforeA = await snapshot(A), beforeB = await snapshot(B);
    as(A.admin, null);
    const own = await load(A.slug, ownPackage.id);
    expect(own.outcome).toBe("render");
    const props = (own.value as { props: { slug: string; initial: Record<string, unknown> } }).props;
    expect(props.slug).toBe(A.slug);
    expect(props.initial).toMatchObject({
      id: ownPackage.id, qr: `EWMS:PKG:1:${ownPackage.id}`, kind: "VARIL", packageNo: 1,
      itemId: fx.A.item, baseUnitId: fx.A.unit, warehouseId: A.warehouse, warehouseName: A.warehouseName,
      originBaseQuantity: "200.000000", currentBaseQuantity: ownPackage.quantity,
      lotCode: ownPackage.lot_code, producedOn: ownPackage.produced_on, expiresOn: ownPackage.expires_on,
      currentLocation: { id: ownPackage.location_id, code: ownPackage.location_code, name: ownPackage.location_name, kind: ownPackage.location_kind },
      currentStockStatus: ownPackage.stock_status, predecessorVersion: 0, currentBalanceVersion: ownPackage.version,
    });
    expect(props.initial.lotCode).toMatch(/^PKG-A-/);
    expect(props.initial.producedOn).toBe("2026-01-01");
    expect(props.initial.expiresOn).toBe("2028-01-01");
    noForeignData(own);
    expect(await snapshot(A)).toEqual(beforeA);
    expect(await snapshot(B)).toEqual(beforeB);
  });

  it("@AC-04 field/packages: gerçek domain MFA_REQUIRED sorgusu UUID dönüşünü MFA yönlendirmesinde korur, etki yok", async () => {
    const before = await snapshot(A);
    as(A.admin, null);
    h.headers.set("x-test-mfa", "false");
    expect(await load(A.slug, ownPackage.id)).toEqual({ outcome: "redirect", to: `/mfa?next=${encodeURIComponent(returnTo())}` });
    expect(await snapshot(A)).toEqual(before);
  });

  it("@AC-04 field/packages: eksik paket boş tarama ekranı, hatalı UUID 404, GET stok yazmaz", async () => {
    const beforeA = await snapshot(A), beforeB = await snapshot(B);
    as(A.admin, null);
    const scan = await load(A.slug);
    expect(scan.outcome).toBe("render");
    expect((scan.value as { props: { initial: unknown; slug: string } }).props).toEqual({ slug: A.slug, initial: null });
    as(A.admin, null);
    expect(await load(A.slug, "https://foreign.example.test/package")).toEqual({ outcome: "notFound" });
    noForeignData(scan);
    expect(await snapshot(A)).toEqual(beforeA);
    expect(await snapshot(B)).toEqual(beforeB);
  });
});

describe("ürün ayrıntı sayfası (/t/<slug>/items/<itemId>) — T-216", () => {
  let itemA: { id: string; code: string; name: string };
  let itemB: { id: string; code: string; name: string };

  async function mkItem(t: Fx): Promise<{ id: string; code: string; name: string }> {
    const unit = await adm.query<{ id: string }>("INSERT INTO public.units (tenant_id, id, code, name) VALUES ($1, gen_random_uuid(), $2, 'Birim') RETURNING id", [t.tenant, `U${rnd()}`]);
    const code = `ITM-${rnd()}`;
    const name = `Gizli urun ${rnd()}`;
    const r = await adm.query<{ id: string }>(
      "INSERT INTO public.items (tenant_id, id, code, name, base_unit_id) VALUES ($1, gen_random_uuid(), $2, $3, $4) RETURNING id",
      [t.tenant, code, name, (unit.rows[0] as { id: string }).id],
    );
    return { id: (r.rows[0] as { id: string }).id, code, name };
  }

  beforeAll(async () => {
    itemA = await mkItem(A);
    itemB = await mkItem(B);
  }, 60_000);

  it("@AC-04 sayfa items/[itemId]: B'nin slug'ı + B'nin ürünü ile var olmayan slug + var olmayan ürün -> 404 ve birebir aynı yanıt; B verisi yok", async () => {
    as(A.admin);
    const cross = await runLoader(ITEM_DETAIL, B.slug, undefined, itemB.id);
    as(A.admin);
    const missing = await runLoader(ITEM_DETAIL, `yok-${rnd()}`, undefined, randomUUID());
    expect(cross).toEqual({ outcome: "notFound" });
    expect(cross).toEqual(missing);
    expect(JSON.stringify(cross)).not.toContain(itemB.code);
    expect(JSON.stringify(cross)).not.toContain(itemB.name);
  });

  it("@AC-04 sayfa items/[itemId]: A'nın slug'ında B'nin itemId'si -> 404, var olmayan itemId ile aynı yanıt; B ürün verisi taşımaz", async () => {
    as(A.admin);
    const cross = await runLoader(ITEM_DETAIL, A.slug, undefined, itemB.id);
    as(A.admin);
    const missing = await runLoader(ITEM_DETAIL, A.slug, undefined, randomUUID());
    expect(cross).toEqual({ outcome: "notFound" });
    expect(cross).toEqual(missing);
    expect(JSON.stringify(cross)).not.toContain(itemB.code);
    expect(JSON.stringify(cross)).not.toContain(itemB.name);
  });

  it("@AC-04 sayfa items/[itemId]: UUID olmayan kimlik 404; hiçbir tenant'ın üyesi olmayan oturum 404; oturumsuz /login", async () => {
    as(A.admin);
    expect(await runLoader(ITEM_DETAIL, A.slug, undefined, "not-a-uuid")).toEqual({ outcome: "notFound" });
    as(outsider.id);
    expect(await runLoader(ITEM_DETAIL, B.slug, undefined, itemB.id)).toEqual({ outcome: "notFound" });
    as(null);
    const anon = await runLoader(ITEM_DETAIL, B.slug, undefined, itemB.id);
    expect(anon.outcome).toBe("redirect");
    expect(anon.to).toMatch(/^\/login\?next=/);
  });

  it("@AC-04 sayfa items/[itemId]: B üyesi A'nın slug'ında kendi ürün kimliğiyle bile 404", async () => {
    for (const user of [B.admin, B.manager, B.picker]) {
      as(user);
      expect(await runLoader(ITEM_DETAIL, A.slug, undefined, itemB.id)).toEqual({ outcome: "notFound" });
    }
  });

  it("@AC-04 sayfa items ve items/[itemId]: stock.view izni olmayan (rolsüz) üye hata değil kilitli görünüm alır (500 yok)", async () => {
    const u = await mkUser("norole");
    await adm.query("INSERT INTO public.tenant_memberships (tenant_id, user_id, status, is_owner) VALUES ($1, $2, 'ACTIVE', false)", [A.tenant, u.id]);
    for (const [rel, itemId] of [["items/page.tsx", undefined], [ITEM_DETAIL, itemA.id]] as const) {
      as(u.id);
      const r = await runLoader(rel, A.slug, undefined, itemId);
      expect(`${r.outcome} ${r.to ?? ""}`, rel).toBe("render ");
      // Sayfa kilitli görünüm bileşenini (async sunucu bileşeni) döndürür; çizilince neden + sonraki eylem anahtarları görünür.
      const el = r.value as { type: () => Promise<unknown> };
      expect(typeof el.type, rel).toBe("function");
      const json = JSON.stringify(await el.type());
      expect(json, rel).toContain('"locked"');
      expect(json, rel).toContain("lockedAction");
      expect(json, rel).not.toContain(itemA.code);
      expect(json, rel).not.toContain(itemA.name);
    }
  });

  it("@AC-04 sayfa items/[itemId]: olumlu kontrol — A kullanıcısı kendi ürününü kendi slug'ında çizer (testin geçersiz kılınmadığının kanıtı)", async () => {
    as(A.admin);
    const r = await runLoader(ITEM_DETAIL, A.slug, undefined, itemA.id);
    expect(`${r.outcome} ${r.to ?? ""}`).toBe("render ");
    expect(r.value).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Server Action'lar
// ---------------------------------------------------------------------------------------------

type Call = (slug: string, victim: { membership: string; invitation: string }) => Promise<ActionResult>;
const ACTIONS: Record<string, Call> = {
  inviteMemberAction: (slug) => members.inviteMemberAction!({ slug, email: `t124-x-${rnd()}@example.test`, roleKey: "PICKER" }),
  revokeInvitationAction: (slug, v) => members.revokeInvitationAction!({ slug, invitationId: v.invitation }),
  changeRoleAction: (slug, v) => members.changeRoleAction!({ slug, memberId: v.membership, roleKey: "TENANT_ADMIN" }),
  removeMemberAction: (slug, v) => members.removeMemberAction!({ slug, memberId: v.membership }),
  setWarehouseScopeAction: (slug, v) => members.setWarehouseScopeAction!({ slug, memberId: v.membership, all: true }),
  leaveTenantAction: (slug) => members.leaveTenantAction!({ slug }),
  transferOwnershipAction: (slug, v) => members.transferOwnershipAction!({ slug, toMemberId: v.membership }),
  issuePasswordResetLinkAction: (slug, v) => members.issuePasswordResetLinkAction!({ slug, memberId: v.membership }),
  // T-997: saha personeli; hesap açma ön denetimi (yetki/üyelik) hesap açılmadan önce, kod yenileme/kilit açma hedef üyelikle.
  createFieldUserAction: (slug) => members.createFieldUserAction!({ slug, name: "Ele Gecirme", username: `x${rnd()}`.toLowerCase().slice(0, 30), roleKey: "PICKER", warehouseId: null }),
  resetFieldCodeAction: (slug, v) => members.resetFieldCodeAction!({ slug, memberId: v.membership }),
  unlockFieldLoginAction: (slug, v) => members.unlockFieldLoginAction!({ slug, memberId: v.membership }),
  // T-998: cihaz/kayıt kimlikleri B'nin (ya da rastgele) — A bağlamında etkisiz.
  revokeDeviceAction: (slug) => members.revokeDeviceAction!({ slug, deviceId: randomUUID() }),
  startEnrollmentAction: (slug) => members.startEnrollmentAction!({ slug }),
  enrollmentStatusAction: (slug) => members.enrollmentStatusAction!({ slug, enrollmentId: randomUUID() }),
  approveEnrollmentAction: (slug) => members.approveEnrollmentAction!({ slug, enrollmentId: randomUUID(), confirmCode: "123456" }),
  cancelEnrollmentAction: (slug) => members.cancelEnrollmentAction!({ slug, enrollmentId: randomUUID() }),
  // T-429: ekibe katılma (QR bağlantısı, talep onayı / reddi); talep kimlikleri rastgele — A bağlamında etkisiz.
  createJoinLinkAction: (slug) => members.createJoinLinkAction!({ slug }),
  revokeJoinLinkAction: (slug) => members.revokeJoinLinkAction!({ slug }),
  approveJoinAction: (slug) => members.approveJoinAction!({ slug, requestId: randomUUID(), code: "123456", roleKey: "PICKER" }),
  rejectJoinAction: (slug) => members.rejectJoinAction!({ slug, requestId: randomUUID() }),
};

/** T-216: ürün kartı eylemleri; hepsi B'nin birim/ürün/barkod kimlikleriyle çağrılır (A veya B slug'ında). */
const ITEM_ACTIONS: Record<string, Call> = {
  createItemAction: (slug) => itemActions.createItemAction!({ slug, code: `X-${rnd()}`, name: "Ele geçirme", baseUnitId: fx.B.unit }),
  updateItemAction: (slug) => itemActions.updateItemAction!({ slug, itemId: fx.B.item, name: "Ele Gecirildi" }),
  archiveItemAction: (slug) => itemActions.archiveItemAction!({ slug, itemId: fx.B.item }),
  setConversionAction: (slug) => itemActions.setConversionAction!({ slug, itemId: fx.B.item, unitId: fx.B.unit, factor: "12" }),
  addBarcodeAction: (slug) => itemActions.addBarcodeAction!({ slug, itemId: fx.B.item, unitId: null, barcode: `9${rnd()}`, quantity: null }),
  removeBarcodeAction: (slug) => itemActions.removeBarcodeAction!({ slug, barcodeId: fx.B.barcode }),
  createUnitAction: (slug) => itemActions.createUnitAction!({ slug, code: `U${rnd()}`, name: "Ele geçirme birimi" }),
  suggestItemCodeAction: (slug) => itemActions.suggestItemCodeAction!({ slug }),
  searchItemsAction: (slug) => itemActions.searchItemsAction!({ slug, q: "a" }),
};

/** T-304: görev eylemleri; hepsi B'nin görev/üyelik kimliğiyle çağrılır (A veya B slug'ında). */
const TASK_ACTIONS: Record<string, Call> = {
  claimTaskAction: (slug) => taskActions.claimTaskAction!({ slug, taskId: bTask, expectedVersion: 1 }),
  assignTaskAction: (slug, v) => taskActions.assignTaskAction!({ slug, taskId: bTask, membershipId: v.membership, expectedVersion: 1 }),
  cancelTaskAction: (slug) => taskActions.cancelTaskAction!({ slug, taskId: bTask, expectedVersion: 1, reason: "Ele geçirme" }),
  // T-293 (ADR-025): rehberli akış eylemleri; B'nin görev kimliğiyle A bağlamından çağrılır (kimlikler istemciden alınmaz, yalnızca görev kimliği + kod/miktar).
  getTaskProgressAction: (slug) => taskActions.getTaskProgressAction!({ slug, taskId: bTask }),
  recordTaskStepAction: (slug) => taskActions.recordTaskStepAction!({ slug, taskId: bTask, step: "SCAN_ITEM", scannedCode: "8690000000000" }),
  beginSaveAction: (slug) => taskActions.beginSaveAction!({ slug, taskId: bTask }),
  saveTaskAction: (slug) => taskActions.saveTaskAction!({ slug, taskId: bTask }),
  resetTaskProgressAction: (slug) => taskActions.resetTaskProgressAction!({ slug, taskId: bTask }),
  nextTaskAction: (slug) => taskActions.nextTaskAction!({ slug, afterTaskId: bTask }),
};

/**
 * T-313: kabul/yerleştirme eylemleri; hepsi B'nin ürün/depo kimlikleri (ve B'ye ait olmayan rastgele kimlikler) ile çağrılır. Yazma eylemleri
 * `limitVerifiedTenant` ile üyelik çözümünde, okuma eylemleri domain sorgusunda `NOT_FOUND` verir; A slug'ında B kimlikleri etkisizdir.
 */
const RECEIPT_ACTIONS: Record<string, Call> = {
  createReceiptAction: (slug) =>
    receiptActions.createReceiptAction!({ slug, clientKey: randomUUID(), warehouseId: B.warehouse, supplierRef: "Ele geçirme", lines: [{ itemId: fx.B.item, unitId: fx.B.unit, expectedQuantity: "5" }] }),
  receiveGoodsAction: (slug) =>
    receiptActions.receiveGoodsAction!({ slug, clientKey: randomUUID(), receiptId: bRcpt.receipt, lines: [{ lineId: bRcpt.line, received: "5", locationId: bRcpt.kabul }] }),
  approveQualityAction: (slug) => receiptActions.approveQualityAction!({ slug, clientKey: randomUUID(), receiptId: bRcpt.receipt }),
  putawayAction: (slug) =>
    receiptActions.putawayAction!({ slug, clientKey: randomUUID(), sourceLocationId: bRcpt.kabul, targetLocationId: bRcpt.raf, itemId: fx.B.item, quantity: "5" }),
  resolveItemScanAction: (slug) => receiptActions.resolveItemScanAction!({ slug, code: "8000000000000" }),
  resolveLocationScanAction: (slug) => receiptActions.resolveLocationScanAction!({ slug, warehouseId: B.warehouse, code: "A-01" }),
  availableAtLocationAction: (slug) => receiptActions.availableAtLocationAction!({ slug, locationId: bRcpt.kabul, itemId: fx.B.item }),
  itemUnitsAction: (slug) => receiptActions.itemUnitsAction!({ slug, itemId: fx.B.item }),
  compoundQuantityAction: (slug) => receiptActions.compoundQuantityAction!({ slug, itemId: fx.B.item, baseQuantity: "5" }),
};

/** T-977: sayım eylemleri; rastgele kimliklerle çağrılır — üyelik `limitVerifiedTenant`'ta çözülür, B'nin slug'ı ile var olmayan slug ayırt edilemez. */
const COUNT_ACTIONS: Record<string, Call> = {
  startCountAction: (slug) => countActions.startCountAction!({ slug, clientKey: randomUUID(), warehouseId: randomUUID(), codes: ["A-01"], blind: true }),
  recordCountAction: (slug) => countActions.recordCountAction!({ slug, clientKey: randomUUID(), sessionId: randomUUID(), locationId: randomUUID(), itemId: randomUUID(), countedQuantity: "1" }),
  submitCountAction: (slug) => countActions.submitCountAction!({ slug, clientKey: randomUUID(), sessionId: randomUUID() }),
  approveCountAction: (slug) => countActions.approveCountAction!({ slug, clientKey: randomUUID(), sessionId: randomUUID() }),
  postCountAction: (slug) => countActions.postCountAction!({ slug, clientKey: randomUUID(), sessionId: randomUUID() }),
  cancelCountAction: (slug) => countActions.cancelCountAction!({ slug, clientKey: randomUUID(), sessionId: randomUUID(), reason: "Ele geçirme" }),
};

describe("Server Action'lar", () => {
  it("@AC-04 kapsam: members/actions.ts dışa aktarımlarının tamamı tabloda; ayarlar eylemi ayrıca sınanır", () => {
    expect(Object.keys(members).sort()).toEqual(Object.keys(ACTIONS).sort());
    expect(Object.keys(itemActions).sort()).toEqual(Object.keys(ITEM_ACTIONS).sort());
    expect(Object.keys(taskActions).sort()).toEqual(Object.keys(TASK_ACTIONS).sort());
    expect(Object.keys(receiptActions).sort()).toEqual(Object.keys(RECEIPT_ACTIONS).sort());
    expect(Object.keys(countActions).sort()).toEqual(Object.keys(COUNT_ACTIONS).sort());
    expect(Object.keys(settings)).toEqual(["saveSettingsAction"]);
    expect(Object.keys(inviteAccept)).toEqual(["acceptInvitationAction"]);
  });

  // T-977: sayım eylemleri ayrı kullanıcılarla (A/B depo yöneticisi) sınanır: yönetici/okuyucu kullanıcılarının dakikalık yazma kotası (A-41, 120)
  // ortak döngüyü taşırmasın. Kural aynı: başka tenant'ın slug'ı ile var olmayan slug ayırt edilemez, etki yok.
  for (const [name, call] of Object.entries(COUNT_ACTIONS)) {
    it(`@AC-04 ${name}: A depo yöneticisi B'nin slug'ıyla, B depo yöneticisi A'nın slug'ıyla -> NOT_FOUND (var olmayan slug ile aynı yanıt); etki yok`, async () => {
      const victim = { membership: B.managerMembership, invitation: bInvite.invitationId };
      const beforeA = await snapshot(A);
      const beforeB = await snapshot(B);
      as(A.manager);
      const cross = await call(B.slug, victim);
      as(A.manager);
      const missing = await call(`yok-${rnd()}`, victim);
      expect(cross.ok, JSON.stringify(cross)).toBe(false);
      if (!cross.ok) expect(cross.error.code).toBe("NOT_FOUND");
      expect(face(cross)).toEqual(face(missing));
      expect(JSON.stringify(cross)).not.toContain(B.name);
      as(B.manager);
      const reverse = await call(A.slug, victim);
      expect(reverse.ok).toBe(false);
      if (!reverse.ok) expect(reverse.error.code).toBe("NOT_FOUND");
      expect(await snapshot(A)).toEqual(beforeA);
      expect(await snapshot(B)).toEqual(beforeB);
    });
  }

  for (const [name, call] of Object.entries({ ...ACTIONS, ...ITEM_ACTIONS, ...TASK_ACTIONS, ...RECEIPT_ACTIONS })) {
    it(`@AC-04 ${name}: A yöneticisi B'nin slug'ıyla -> NOT_FOUND (var olmayan slug ile aynı yanıt); B'de hiçbir değişiklik yok`, async () => {
      const victim = { membership: B.managerMembership, invitation: bInvite.invitationId };
      const beforeB = await snapshot(B);
      const beforeA = await snapshot(A);
      as(A.admin);
      const cross = await call(B.slug, victim);
      as(A.admin);
      const missing = await call(`yok-${rnd()}`, victim);
      expect(cross.ok, JSON.stringify(cross)).toBe(false);
      if (!cross.ok) expect(cross.error.code).toBe("NOT_FOUND");
      expect(face(cross)).toEqual(face(missing));
      expect(JSON.stringify(cross)).not.toContain(B.slug);
      expect(JSON.stringify(cross)).not.toContain(B.name);
      expect(await snapshot(B)).toEqual(beforeB);
      expect(await snapshot(A)).toEqual(beforeA);
    });

    it(`@AC-04 ${name}: hiçbir tenant'ın üyesi olmayan kullanıcı ve B'nin düşük yetkili üyesi (A slug'ıyla) -> NOT_FOUND/FORBIDDEN, etki yok`, async () => {
      const victim = { membership: A.managerMembership, invitation: bInvite.invitationId };
      const beforeA = await snapshot(A);
      const beforeB = await snapshot(B);
      for (const user of [outsider.id, B.picker, B.admin]) {
        as(user);
        const r = await call(A.slug, victim);
        expect(r.ok, `${name} ${user}`).toBe(false);
        if (!r.ok) expect(["NOT_FOUND", "FORBIDDEN"]).toContain(r.error.code);
      }
      expect(await snapshot(A)).toEqual(beforeA);
      expect(await snapshot(B)).toEqual(beforeB);
    });
  }

  for (const [name, call] of Object.entries(RECEIPT_ACTIONS)) {
    it(`@AC-04 ${name}: A yöneticisi KENDİ slug'ında B'nin GERÇEK kimlikleriyle -> NOT_FOUND (var olmayan kimlikle aynı yanıt); A ve B'de etki yok`, async () => {
      const victim = { membership: B.managerMembership, invitation: bInvite.invitationId };
      const beforeA = await snapshot(A);
      const beforeB = await snapshot(B);
      as(A.admin);
      const own = await call(A.slug, victim);
      expect(own.ok, `${name}: ${JSON.stringify(own)}`).toBe(false);
      if (!own.ok) expect(own.error.code).toBe("NOT_FOUND");
      expect(JSON.stringify(own)).not.toContain(B.slug);
      expect(JSON.stringify(own)).not.toContain(bRcpt.receipt);
      expect(await snapshot(A)).toEqual(beforeA);
      expect(await snapshot(B)).toEqual(beforeB);
    });
  }

  it("@AC-04 saveSettingsAction: A yöneticisi B'nin slug'ıyla ayar değişikliği -> NOT_FOUND ile yönlendirme; B'nin adı/dili/saat dilimi değişmez", async () => {
    const before = await snapshot(B);
    const form = (slug: string): FormData => {
      const f = new FormData();
      f.set("slug", slug);
      f.set("name", "Ele Gecirildi");
      f.set("locale", "en");
      f.set("timeZone", "Europe/Berlin");
      return f;
    };
    const run = async (slug: string): Promise<string> => {
      as(A.admin);
      try {
        await settings.saveSettingsAction(form(slug));
      } catch (e) {
        if ((e as { kind?: string }).kind === "redirect") return (e as { to: string }).to;
        throw e;
      }
      throw new Error("expected redirect");
    };
    const cross = await run(B.slug);
    const missing = await run(`yok-${rnd()}`);
    expect(cross).toBe(`/t/${B.slug}/settings?error=NOT_FOUND`);
    expect(missing.replace(/\/t\/[^/]+/, "")).toBe(cross.replace(/\/t\/[^/]+/, ""));
    expect(await snapshot(B)).toEqual(before);
    // Olumlu kontrol: aynı eylem kendi slug'ında çalışır.
    as(A.admin);
    const ownForm = form(A.slug);
    ownForm.set("name", A.name);
    ownForm.set("locale", "tr");
    ownForm.set("timeZone", "Europe/Istanbul");
    await expect(settings.saveSettingsAction(ownForm)).rejects.toMatchObject({ kind: "redirect", to: `/t/${A.slug}/settings?unchanged=1` });
  });

  it("@AC-04 setSeparationAction (T-416): A yöneticisi B'nin slug'ıyla görev ayrılığını açamaz -> NOT_FOUND ile yönlendirme; B'nin ayarı değişmez", async () => {
    const sod = async (tenant: string): Promise<boolean | undefined> =>
      (await adm.query<{ v: boolean }>("SELECT separation_of_duties AS v FROM public.tenant_settings WHERE tenant_id = $1", [tenant])).rows[0]?.v;
    const before = await sod(B.tenant);
    const run = async (slug: string): Promise<string> => {
      as(A.admin);
      const f = new FormData();
      f.set("slug", slug);
      f.set("enabled", "1");
      try {
        await sodActions.setSeparationAction(f);
      } catch (e) {
        if ((e as { kind?: string }).kind === "redirect") return (e as { to: string }).to;
        throw e;
      }
      throw new Error("expected redirect");
    };
    const cross = await run(B.slug);
    const missing = await run(`yok-${rnd()}`);
    expect(cross).toBe(`/t/${B.slug}/settings?error=NOT_FOUND`);
    expect(missing.replace(/\/t\/[^/]+/, "")).toBe(cross.replace(/\/t\/[^/]+/, ""));
    expect(await sod(B.tenant)).toBe(before);
  });

  it("@AC-04 acceptInvitationAction: B'nin davet belirteciyle A kullanıcısının kabulü -> FORBIDDEN (e-posta uyuşmazlığı); üyelik/kabul oluşmaz", async () => {
    const beforeB = await snapshot(B);
    for (const user of [A.admin, outsider.id]) {
      as(user);
      const r = await inviteAccept.acceptInvitationAction!({ token: bInvite.token });
      expect(r.ok, JSON.stringify(r)).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
      expect(await adm.query("SELECT 1 FROM public.tenant_memberships WHERE tenant_id = $1 AND user_id = $2", [B.tenant, user])).toHaveProperty("rowCount", 0);
    }
    expect(await snapshot(B)).toEqual(beforeB);
    // Kimliği doğrulanmamış kabul de hesap açmadan, parola vermeden hiçbir şey yazmaz (B davetini tüketmez).
    as(null);
    const anon = await inviteAccept.acceptInvitationAction!({ token: bInvite.token });
    expect(anon.ok).toBe(false);
    expect(await snapshot(B)).toEqual(beforeB);
  });

  it("@AC-04 doğrudan B'nin membershipId'siyle A slug'ında komut: changeRole/removeMember/transferOwnership/sıfırlama -> ret, A ve B'de etki yok", async () => {
    const beforeA = await snapshot(A);
    const beforeB = await snapshot(B);
    const target = B.managerMembership;
    as(A.admin);
    const results: [string, ActionResult][] = [];
    results.push(["changeRole", await members.changeRoleAction!({ slug: A.slug, memberId: target, roleKey: "PICKER" })]);
    as(A.admin);
    results.push(["removeMember", await members.removeMemberAction!({ slug: A.slug, memberId: target })]);
    as(A.admin);
    results.push(["transferOwnership", await members.transferOwnershipAction!({ slug: A.slug, toMemberId: target })]);
    as(A.admin);
    results.push(["issuePasswordResetLink", await members.issuePasswordResetLinkAction!({ slug: A.slug, memberId: target })]);
    as(A.admin);
    results.push(["revokeInvitation", await members.revokeInvitationAction!({ slug: A.slug, invitationId: bInvite.invitationId })]);
    for (const [name, r] of results) {
      expect(r.ok, name).toBe(false);
      if (!r.ok) expect(["NOT_FOUND", "FORBIDDEN"], name).toContain(r.error.code);
    }
    expect(await snapshot(A)).toEqual(beforeA);
    expect(await snapshot(B)).toEqual(beforeB);
    // B'nin yöneticisi aynı hedefle B slug'ında çalışabilir (olumlu kontrol: hedef gerçekten geçerli bir üyelik).
    as(B.admin);
    const ok = await members.changeRoleAction!({ slug: B.slug, memberId: target, roleKey: "WAREHOUSE_MANAGER" });
    expect(ok.ok, JSON.stringify(ok)).toBe(true);
  });

  it("@AC-04 Origin/oturum: B slug'ında Origin'siz çağrı FORBIDDEN, oturumsuz UNAUTHENTICATED (slug varlığına bakılmadan; B'ye etki yok)", async () => {
    const beforeB = await snapshot(B);
    as(A.admin, null);
    const noOrigin = await members.changeRoleAction!({ slug: B.slug, memberId: B.managerMembership, roleKey: "TENANT_ADMIN" });
    expect(noOrigin.ok === false && noOrigin.error.code).toBe("FORBIDDEN");
    as(null);
    const anon = await members.changeRoleAction!({ slug: B.slug, memberId: B.managerMembership, roleKey: "TENANT_ADMIN" });
    expect(anon.ok === false && anon.error.code).toBe("UNAUTHENTICATED");
    expect(await snapshot(B)).toEqual(beforeB);
  });
});
