import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { TASK_KINDS, listMyTasks, type TaskCursor, type TaskKind } from "@wms/domain/operations";
import { AppError } from "@wms/shared/errors";
import { claimTaskAction } from "../../tasks/actions.ts";
import { LICON } from "../../../../design/kalip-icons.ts";
import { kalipDark } from "../../stock/belge-kalip.ts";
import { Ico, KalipBaslik, KalipEkran } from "../../kalip/ekran.tsx";
import { KalipBos, KalipDaha, KalipKartListe } from "../../kalip/liste.tsx";
import { kdz } from "../../kalip/tokens.ts";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const ERROR_KEYS = ["forbidden", "unauthenticated", "not_found", "validation_failed", "validation_failed_document_state", "version_conflict", "rate_limited", "tenant_suspended", "tenant_closing", "internal"];
// T-973 (B-63, I-18): LİSTE kalıbı (KalipListe.dc.html), saha görünümü: tür ikonlu kart (`.uc`), kartın altında tek büyük eylem (Üstlen /
// Başla, `.btn`), sayfalama `.more`. Kart kendisi eylem değildir (düğme adı çakışmaz); alt çubuk ana işlemi OKUT.
const KIND_VISUAL: Record<string, { readonly d: string; readonly color: string }> = {
  PUTAWAY: { d: LICON.moveIn, color: "2F5DA8" },
  PICK: { d: LICON.moveOut, color: "9A5B2E" },
  REPUTAWAY: { d: LICON.transfer, color: "0E7C7B" },
  COUNT: { d: LICON.clip, color: "6C4BD8" },
};
const BTN_STYLE = { width: "100%", minHeight: 56, fontSize: 16 } as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("tasks.field");
  return { title: t("title") };
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function parseCursor(raw: string | undefined): TaskCursor | undefined {
  if (raw === undefined || raw === "") return undefined;
  const i = raw.indexOf("~");
  return i < 0 ? { createdKey: raw, id: "" } : { createdKey: raw.slice(0, i), id: raw.slice(i + 1) };
}

// "Görevlerim" (T-304): sunucu bileşeni, 375 px tek sütun. "Üstlen" sunucu eylemidir (`claimTaskAction`: yetki ve sürüm denetimi domain'de);
// hata `?error=` ile geri gösterilir. "Başla": ilgili akış ekranı (T-313…T-316) gelene kadar KİLİTLİ + açıklama (sahte bağlantı yok, G-07).
export default async function FieldTasksPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const afterRaw = first(sp.after);
  const errorRaw = first(sp.error) ?? "";
  const t = await getTranslations("tasks");
  const te = await getTranslations("tasks.errors");
  const base = `/t/${encodeURIComponent(slug)}/field/tasks`;
  const { getAuthService } = await import("../../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect(`/login?next=${encodeURIComponent(base)}`);

  let page: Awaited<ReturnType<typeof listMyTasks>>;
  const after = parseCursor(afterRaw);
  try {
    page = await listMyTasks({ db: getAppDb(), principal, tenantSlug: slug }, { limit: PAGE_SIZE, ...(after === undefined ? {} : { after }) });
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === "NOT_FOUND" || e.code === "VALIDATION_FAILED") notFound();
      if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(base)}`);
      if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(base)}`);
    }
    throw e;
  }

  async function claim(formData: FormData) {
    "use server";
    const res = await claimTaskAction({ slug, taskId: String(formData.get("taskId") ?? ""), expectedVersion: Number(formData.get("version")) });
    if (res.ok) redirect(`${base}?claimed=1`);
    const key = res.error.code.toLowerCase() === "validation_failed" && res.error.detail === "DOCUMENT_STATE" ? "validation_failed_document_state" : res.error.code.toLowerCase();
    redirect(`${base}?error=${encodeURIComponent(key)}`);
  }

  const errorKey = errorRaw === "" ? null : ERROR_KEYS.includes(errorRaw) ? errorRaw : "internal";
  const kindOf = (k: TaskKind) => ((TASK_KINDS as readonly string[]).includes(k) ? t(`kind.${k}`) : k);
  const dark = await kalipDark();
  const fieldHome = `/t/${encodeURIComponent(slug)}/field`;
  // T-977: Başla → görevin saha akışı (yerleştirme, toplama, oturumlu sayım). Toplama eksiğinden doğan oturumsuz sayım görevi kilitli kalır (önce yönetici sayım başlatır).
  const startHref = (task: { readonly id: string; readonly kind: string; readonly sourceKind: string | null }): string | null => {
    const q = `task=${encodeURIComponent(task.id)}`;
    if (task.kind === "PUTAWAY") return `${fieldHome}/putaway?${q}`;
    if (task.kind === "PICK") return `${fieldHome}/pick?${q}`;
    if (task.kind === "COUNT" && task.sourceKind === "COUNT_SESSION") return `${fieldHome}/count?${q}`;
    return null;
  };

  return (
    <KalipEkran kind="liste" dark={dark} title={t("field.title")} icon={{ d: LICON.clip, color: "6C4BD8" }} testId="field-tasks" bar={{ back: { href: fieldHome } }}>
      <p className="sr">{t("field.intro")}</p>
      {first(sp.claimed) === "1" ? (
        <p role="status" className="rounded-card bg-success-bg px-4 py-3 text-base font-semibold text-success-ink">
          {t("field.claimed")}
        </p>
      ) : null}
      {errorKey === null ? null : (
        <p role="alert" className="rounded-card bg-danger-bg px-4 py-3 text-base font-semibold text-danger-ink">
          {te(errorKey)} {te(`${errorKey}Action`)}
        </p>
      )}
      {page.items.length === 0 ? (
        <KalipBos title={t("field.empty.title")} hint={t("field.empty.action")} iconD={LICON.clip} testId="field-tasks-empty" />
      ) : (
        <>
          <KalipBaslik title={t("field.title")} hint={t("field.intro")} />
          <KalipKartListe label={t("field.listLabel")}>
            {page.items.map((task, i) => {
              const v = KIND_VISUAL[task.kind] ?? { d: LICON.clip, color: "6C4BD8" };
              const mine = task.status === "ASSIGNED";
              return (
                <div key={task.id} role="listitem" data-testid="field-task" data-task-id={task.id} style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                  <div className="uc" style={{ animationDelay: `${i * 30}ms` }}>
                    <span className="uic" style={{ background: kdz("dzl", v.color) }}>
                      <Ico d={v.d} size={26} />
                    </span>
                    <span className="ut">
                      <h2 style={{ margin: 0, font: "inherit" }}>
                        <b>{kindOf(task.kind)}</b>
                      </h2>
                      <small className="mono">{mine ? t("field.mine") : t("field.available")}</small>
                    </span>
                    {task.quantity === null ? null : (
                      <span className="qb">
                        <b>{task.quantity}</b>
                        <small>{t("qtySub")}</small>
                      </span>
                    )}
                  </div>
                  {task.status === "OPEN" ? (
                    <form action={claim}>
                      <input type="hidden" name="taskId" value={task.id} />
                      <input type="hidden" name="version" value={task.version} />
                      <button type="submit" className="btn y" style={BTN_STYLE}>
                        <Ico d={LICON.people} size={20} />
                        {t("field.claim")}
                      </button>
                    </form>
                  ) : startHref(task) !== null ? (
                    <Link href={startHref(task) ?? ""} className="btn n" style={{ ...BTN_STYLE, textDecoration: "none" }} data-testid="field-task-start">
                      <Ico d={LICON.arrow} size={20} />
                      {t("field.start")}
                    </Link>
                  ) : (
                    <>
                      <button type="button" disabled aria-describedby={`start-${task.id}`} className="btn n" style={{ ...BTN_STYLE, opacity: 0.6 }}>
                        <Ico d={LICON.lock} size={20} />
                        {t("field.start")}
                      </button>
                      <small id={`start-${task.id}`} style={{ overflowWrap: "anywhere" }}>
                        {task.kind === "COUNT" ? t("field.countNoSession") : t("field.startLocked")}
                      </small>
                    </>
                  )}
                </div>
              );
            })}
          </KalipKartListe>
        </>
      )}
      {page.next === null ? null : (
        <KalipDaha href={`${base}?after=${encodeURIComponent(`${page.next.createdKey}~${page.next.id}`)}`} iconD={LICON.plus}>
          {t("field.more")}
        </KalipDaha>
      )}
    </KalipEkran>
  );
}
