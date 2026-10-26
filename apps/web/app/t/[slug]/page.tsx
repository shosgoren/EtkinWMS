import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppError } from "@wms/shared/errors";
import { getAppDb } from "@wms/db";
import { getMembershipSummary, listMembers } from "@wms/domain/identity/member-queries";
import { hasPermission } from "@wms/domain/identity/permissions";
import { TASK_KIND_PERMISSION, TASK_LIST_LIMIT_MAX, getBoard, getWorkSummary, type Board, listInboundReceipts, listMyTasks, type WorkSummary } from "@wms/domain/operations";
import { Kokpit, type MyTasksSummary, type NowSummary } from "./kokpit.tsx";
import { EasyOperations } from "./easy-operations.tsx";
import { PanoHome, type PanoRole } from "./pano/pano-home.tsx";
import { PanoBoard, type Assignee, type BoardRole } from "./pano/pano-board.tsx";
import { getSetupJourney } from "@wms/domain/onboarding/journey";
import { toJourneyData } from "./yolculuk/serialize.ts";
import type { JourneyData } from "./yolculuk/steps.ts";
import { temaKoyu } from "../../design/theme.ts";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("home");
  return { title: t("title") };
}

// Tenant ana ekranı (T-122): "Merhaba <ad>, Ne yapmak istiyorsun?" + görev kartları. Üyelik/MFA/askı kararları
// `layout.tsx`'tedir (üye değil → 404, askıda → durum ekranı); burada yalnızca kendi üyeliğimiz özetlenir. Layout karar verdiyse
// çocuk çizilmez, bu yüzden "üyelik yok" durumunda sayfa sessizce boş döner (kendi 404'ünü üretmez).
export default async function TenantHomePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { getAuthService } = await import("../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect(`/login?next=${encodeURIComponent(`/t/${slug}`)}`);
  const summary = await getMembershipSummary({ db: getAppDb(), principal });
  const current = summary.memberships.find((m) => m.slug === slug);
  if (current === undefined) return null;
  const jar = await cookies();
  // T-423: saha (PICKER) ve sayım (COUNTER) rolleri yeni ana ekranı (Pano.dc.html) görür; yönetici ve hesap sahibinin ana ekranı T-422'de.
  const boardRole: BoardRole | null = current.roles.includes("TENANT_ADMIN") ? "owner" : current.roles.includes("WAREHOUSE_MANAGER") ? "manager" : null;
  if (boardRole !== null && jar.get("view")?.value !== "cockpit") {
    // T-422: hesap sahibi / depo yöneticisi panosu. Bölüm hatası ekranı düşürmez: veri yoksa kartlar "veri okunamadı" der.
    const call = { db: getAppDb(), principal, tenantSlug: slug };
    const guard = (e: unknown, what: string): void => {
      if (e instanceof AppError) {
        if (e.code === "NOT_FOUND") notFound();
        if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(`/t/${slug}`)}`);
        if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(`/t/${slug}`)}`);
      }
      console.error(JSON.stringify({ level: "error", msg: `pano ${what} failed`, error: e instanceof Error ? e.name : typeof e, code: e instanceof AppError ? e.code : undefined }));
    };
    let board: Board | null = null;
    let work: WorkSummary | null = null;
    let assignees: Assignee[] = [];
    try {
      board = await getBoard(call);
    } catch (e) {
      guard(e, "board");
    }
    try {
      work = await getWorkSummary(call);
    } catch (e) {
      guard(e, "work summary");
    }
    // T-1006: ilk kurulum yolculuğu kartı (hesap sahibi / depo yöneticisi). Okunamazsa kart çizilmez, pano düşmez.
    let journey: JourneyData | null = null;
    try {
      journey = toJourneyData(await getSetupJourney(call));
    } catch (e) {
      guard(e, "journey");
    }
    const canAssign = hasPermission(current.roles, "document.approve", current.grants);
    if (canAssign) {
      try {
        const members = await listMembers(call, { demoEmailDomain: process.env.DEMO_EMAIL_DOMAIN?.trim().toLowerCase() || null });
        assignees = members
          .filter((x) => x.status === "ACTIVE")
          .map((x) => ({
            membershipId: x.membershipId,
            name: x.displayName,
            kinds: (Object.keys(TASK_KIND_PERMISSION) as Array<keyof typeof TASK_KIND_PERMISSION>).filter((k) => hasPermission(x.roles, TASK_KIND_PERMISSION[k])),
          }))
          .filter((x) => x.kinds.length > 0);
      } catch (e) {
        guard(e, "members");
      }
    }
    return (
      <main className="flex w-full min-w-0 flex-col">
        <PanoBoard
          slug={slug}
          role={boardRole}
          board={board}
          summary={work}
          userName={summary.userName}
          tenantName={current.tenantName}
          dark={temaKoyu(jar)}
          canAssign={canAssign}
          canReport={hasPermission(current.roles, "stock.post", current.grants) || hasPermission(current.roles, "document.create", current.grants)}
          stockPost={hasPermission(current.roles, "stock.post", current.grants)}
          usersManage={hasPermission(current.roles, "users.manage", current.grants)}
          settingsManage={hasPermission(current.roles, "settings.manage", current.grants)}
          assignees={assignees}
          journey={journey}
        />
      </main>
    );
  }
  const panoRole: PanoRole | null =
    current.roles.includes("TENANT_ADMIN") || current.roles.includes("WAREHOUSE_MANAGER") ? null : current.roles.includes("PICKER") ? "field" : current.roles.includes("COUNTER") ? "counter" : null;
  if (panoRole !== null && jar.get("view")?.value !== "cockpit") {
    let work: WorkSummary | null = null;
    try {
      work = await getWorkSummary({ db: getAppDb(), principal, tenantSlug: slug });
    } catch (e) {
      if (e instanceof AppError) {
        if (e.code === "NOT_FOUND") notFound();
        if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(`/t/${slug}`)}`);
        if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(`/t/${slug}`)}`);
      }
      console.error(JSON.stringify({ level: "error", msg: "pano work summary failed", error: e instanceof Error ? e.name : typeof e, code: e instanceof AppError ? e.code : undefined }));
    }
    return (
      <main className="flex w-full min-w-0 flex-col">
        <PanoHome
          slug={slug}
          role={panoRole}
          summary={work}
          userName={summary.userName}
          tenantName={current.tenantName}
          dark={temaKoyu(jar)}
          stockPost={hasPermission(current.roles, "stock.post", current.grants)}
          canReport={hasPermission(current.roles, "stock.post", current.grants) || hasPermission(current.roles, "document.create", current.grants)}
          settingsManage={hasPermission(current.roles, "settings.manage", current.grants)}
          screens={current.screens}
        />
      </main>
    );
  }
  const cockpit = jar.get("view")?.value === "cockpit";
  const firstName = summary.userName.trim().split(/\s+/)[0] ?? summary.userName;
  const allowed = {
    usersManage: hasPermission(current.roles, "users.manage", current.grants),
    settingsManage: hasPermission(current.roles, "settings.manage", current.grants),
    auditView: hasPermission(current.roles, "audit.view", current.grants),
    stockView: hasPermission(current.roles, "stock.view", current.grants),
    stockPost: hasPermission(current.roles, "stock.post", current.grants),
  };
  if (!cockpit) {
    // T-988: Görevlerim ana ekranı (tasarım birebir). Özet okunamazsa ekran düşmez: bölümler "veri yok" der, sayı uydurulmaz.
    let work: WorkSummary | null = null;
    try {
      work = await getWorkSummary({ db: getAppDb(), principal, tenantSlug: slug });
    } catch (e) {
      if (e instanceof AppError) {
        if (e.code === "NOT_FOUND") notFound();
        if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(`/t/${slug}`)}`);
        if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(`/t/${slug}`)}`);
      }
      console.error(JSON.stringify({ level: "error", msg: "home work summary failed", error: e instanceof Error ? e.name : typeof e, code: e instanceof AppError ? e.code : undefined }));
    }
    return (
      <main className="flex w-full min-w-0 flex-col">
        <EasyOperations slug={slug} allowed={allowed} summary={work} firstName={firstName} dark={temaKoyu(jar)} canReport={hasPermission(current.roles, "stock.post", current.grants) || hasPermission(current.roles, "document.create", current.grants)} />
      </main>
    );
  }
  const ts = await getTranslations("serverErrors");
  // Saha rolleri (yönetim yetkisi olmayanlar) için "Görevlerim" özeti: mevcut domain sorgusu (`listMyTasks`: tenant bağlamı, `stock.view`,
  // depo kapsamı domain'de). Sayım yalnız BANA ATANMIŞ (ASSIGNED) görevlerdir; liste tek sayfaya sığmazsa "n+" gösterilir. Hata bu bölümle
  // sınırlıdır (ana ekran düşmez): sunucu hatası + kod gösterilir.
  let myTasks: MyTasksSummary | undefined;
  if (!hasPermission(current.roles, "users.manage", current.grants)) {
    try {
      const mine = await listMyTasks({ db: getAppDb(), principal, tenantSlug: slug }, { limit: TASK_LIST_LIMIT_MAX });
      myTasks = { kind: "count", count: mine.items.filter((x) => x.status === "ASSIGNED").length, more: mine.next !== null };
    } catch (e) {
      if (e instanceof AppError) {
        if (e.code === "NOT_FOUND") notFound();
        if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(`/t/${slug}`)}`);
        if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(`/t/${slug}`)}`);
      }
      console.error(JSON.stringify({ level: "error", msg: "home my tasks failed", error: e instanceof Error ? e.name : typeof e, code: e instanceof AppError ? e.code : undefined }));
      const code = e instanceof AppError ? e.code : "INTERNAL";
      const key = ["FORBIDDEN", "RATE_LIMITED", "TENANT_SUSPENDED", "TENANT_CLOSING", "VALIDATION_FAILED"].includes(code) ? code.toLowerCase() : "internal";
      myTasks = { kind: "error", message: `${ts(key)} ${ts(`${key}Action`)}`, code: ts("code", { code }) };
    }
  }
  // "Şimdi" kartı (T-280, DESIGN_REVIEW §7.4.2): yalnız `stock.post` sahibi için GERÇEK bekleyen işler (mevcut domain okumaları: tenant ve depo kapsamı domain'de).
  // Açık teslim = `listInboundReceipts` (OPEN); yerleştirilecek = `listMyTasks` içindeki PUTAWAY görevleri. Hata: sunucu mesajı + kod (ana ekran düşmez).
  let now: NowSummary | undefined;
  if (hasPermission(current.roles, "stock.post", current.grants)) {
    try {
      const call = { db: getAppDb(), principal, tenantSlug: slug };
      const receipts = await listInboundReceipts(call, { status: "OPEN", limit: 50 });
      const tasks = await listMyTasks(call, { limit: TASK_LIST_LIMIT_MAX });
      const put = tasks.items.filter((x) => x.kind === "PUTAWAY");
      const tn = await getTranslations("home.now");
      const stripZeros = (q: string): string => q.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
      const base = `/t/${encodeURIComponent(slug)}`;
      const rows: Array<NonNullable<Extract<NowSummary, { kind: "rows" }>["rows"]>[number]> = [];
      // Satır tek davranıştır: sayar, kısa "Sıradaki" etiketi verir ve DOĞRUDAN sıradaki işe götürür (teslim → kabul akışı, görev → yerleştirme akışı).
      if (receipts.items.length > 0) {
        rows.push({
          key: "receive",
          count: receipts.items.length,
          more: receipts.next !== null,
          next: receipts.items.slice(0, 2).map((r) => ({ href: `${base}/field/receive?receipt=${encodeURIComponent(r.id)}` as `/${string}`, label: r.number })),
        });
      }
      if (put.length > 0) {
        rows.push({
          key: "putaway",
          count: put.length,
          more: tasks.next !== null,
          next: put.slice(0, 2).map((task) => ({
            href: `${base}/field/putaway?task=${encodeURIComponent(task.id)}` as `/${string}`,
            label: tn("qty", { n: task.quantity === null ? "-" : stripZeros(task.quantity) }),
          })),
        });
      }
      now = rows.length === 0 ? { kind: "empty" } : { kind: "rows", rows };
    } catch (e) {
      if (e instanceof AppError) {
        if (e.code === "NOT_FOUND") notFound();
        if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(`/t/${slug}`)}`);
        if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(`/t/${slug}`)}`);
      }
      console.error(JSON.stringify({ level: "error", msg: "home now failed", error: e instanceof Error ? e.name : typeof e, code: e instanceof AppError ? e.code : undefined }));
      const code = e instanceof AppError ? e.code : "INTERNAL";
      const key = ["FORBIDDEN", "RATE_LIMITED", "TENANT_SUSPENDED", "TENANT_CLOSING", "VALIDATION_FAILED"].includes(code) ? code.toLowerCase() : "internal";
      now = { kind: "error", message: `${ts(key)} ${ts(`${key}Action`)}`, code: ts("code", { code }) };
    }
  }

  return (
    <main className="flex w-full min-w-0 flex-col">
      <Kokpit
        slug={slug}
        dark={temaKoyu(jar)}
        firstName={firstName}
        allowed={allowed}
        {...(myTasks === undefined ? {} : { myTasks })}
        {...(now === undefined ? {} : { now })}
      />
    </main>
  );
}
