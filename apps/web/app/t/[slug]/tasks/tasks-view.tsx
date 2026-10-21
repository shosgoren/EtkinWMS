"use client";
// Yönetici görev ekranı (T-304). Yetki ve iş kuralları SUNUCUDADIR: `canManage` yalnızca gösterimdir (kilit + açıklama); eylemler
// sunucuda `document.approve` ister (A-132). Atanabilir kişiler sunucuda hesaplanır (`kinds`: kişinin yapabildiği görev türleri).
// Sunucu reddi neden + sonraki eylemle gösterilir.
// T-971 (B-63, I-18): LİSTE kalıbı (KalipListe.dc.html): tür ve durum süzgeç çipleri (adresi değiştirir: `?kind=` / `?status=`), görev kartları,
// kartın altında Ata / İptal et eylem satırı (kart içine düğme gömülmez), sayfalama `KalipDaha`. Ata / İptal pencereleri (Sheet) korunur.
// T-978: arama (`.lsearch`, GET `q`: ürün kodu/adı, raf, atanan kişi — sunucuda listTasks; çiplerle birlikte çalışır).
// Bilinçli farklar (DESIGN-PARITY, T-971): çip sayıları yok; alt çubuk ana işlemi OKUT (ekranın
// kendi oluşturma işlemi yok — görevler mal kabul / sipariş / sayımdan doğar).
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";
import { Banner } from "@wms/ui";
import { LICON } from "../../../design/kalip-icons.ts";
import { Sheet } from "../easy-setup/sheet.tsx";
import { Ico, KalipBaslik, KalipEkran, tone, useKalipToast } from "../kalip/ekran.tsx";
import { fmtQty } from "../kalip/format.ts";
import { KalipAra, KalipBos, KalipCipler, KalipDaha, KalipKart, KalipKartListe, type KalipCip } from "../kalip/liste.tsx";
import { KalipPencereAlan, KalipPencereDugme, KalipPencereMetin, KalipPencereSecim } from "../kalip/pencere.tsx";
import { kdz } from "../kalip/tokens.ts";
import { assignTaskAction, cancelTaskAction } from "./actions.ts";

export type TaskKindValue = "PUTAWAY" | "PICK" | "REPUTAWAY" | "COUNT";
export type TaskStatusValue = "OPEN" | "ASSIGNED" | "DONE" | "CANCELLED";

export interface TaskView {
  readonly id: string;
  readonly kind: TaskKindValue;
  readonly status: TaskStatusValue;
  readonly version: number;
  readonly quantity: string | null;
  readonly assignedName: string | null;
  readonly assignedMembershipId: string | null;
}
export interface TaskMemberView {
  readonly membershipId: string;
  readonly displayName: string;
  /** Kişinin yapabildiği görev türleri (A-132; sunucuda hesaplandı). */
  readonly kinds: readonly TaskKindValue[];
}
interface ServerError {
  readonly code: string;
  readonly detail?: string | undefined;
  readonly requestId?: string | undefined;
}

const KINDS: readonly TaskKindValue[] = ["PUTAWAY", "PICK", "REPUTAWAY", "COUNT"];
const STATUSES: readonly TaskStatusValue[] = ["OPEN", "ASSIGNED", "DONE", "CANCELLED"];
const KNOWN = ["forbidden", "unauthenticated", "not_found", "validation_failed", "version_conflict", "rate_limited", "tenant_suspended", "tenant_closing", "internal"];

/** Sunucu hatası → `tasks.errors.<anahtar>`; yalnızca bilinen eşlemeler, aksi halde genel `internal`. */
export function taskErrorKey(error: Pick<ServerError, "code" | "detail">): string {
  const base = error.code.toLowerCase();
  const key = KNOWN.includes(base) ? base : "internal";
  return key === "validation_failed" && error.detail === "DOCUMENT_STATE" ? "validation_failed_document_state" : key;
}

const KIND_VISUAL: Record<TaskKindValue, { readonly d: string; readonly color: string }> = {
  PUTAWAY: { d: LICON.moveIn, color: "2F5DA8" },
  PICK: { d: LICON.moveOut, color: "9A5B2E" },
  REPUTAWAY: { d: LICON.transfer, color: "0E7C7B" },
  COUNT: { d: LICON.clip, color: "6C4BD8" },
};
const STATUS_VISUAL: Record<TaskStatusValue, { readonly d: string; readonly color: string }> = {
  OPEN: { d: LICON.clock, color: "2F5DA8" },
  ASSIGNED: { d: LICON.people, color: "0E7C7B" },
  DONE: { d: LICON.check, color: "2F7D5B" },
  CANCELLED: { d: LICON.close, color: "C62828" },
};

export interface TasksViewProps {
  readonly slug: string;
  readonly dark: boolean;
  readonly canManage: boolean;
  readonly tasks: readonly TaskView[];
  readonly members: readonly TaskMemberView[];
  readonly kindFilter: TaskKindValue | "";
  readonly statusFilter: TaskStatusValue | "";
  /** Sonraki sayfa bağlantısı (keyset imleci sorgu dizesinde); yoksa `null`. */
  readonly nextHref: string | null;
  readonly firstPage: boolean;
  /** T-978: sunucu araması; boş = tümü. */
  readonly search?: string;
}

export function TasksView({ slug, dark, canManage, tasks, members, kindFilter, statusFilter, nextHref, firstPage, search = "" }: TasksViewProps) {
  const t = useTranslations("tasks");
  const te = useTranslations("tasks.errors");
  const router = useRouter();
  const locale = useLocale();
  const home = `/t/${encodeURIComponent(slug)}`;
  const base = `${home}/tasks`;
  const { say, node: toast } = useKalipToast("liste");
  const [assigning, setAssigning] = useState<TaskView | null>(null);
  const [cancelling, setCancelling] = useState<TaskView | null>(null);
  const [memberId, setMemberId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ServerError | null>(null);

  const eligible = assigning === null ? [] : members.filter((m) => m.kinds.includes(assigning.kind));

  function close() {
    if (busy) return;
    setAssigning(null);
    setCancelling(null);
    setMemberId("");
    setReason("");
  }

  async function finish(res: { ok: true } | { ok: false; error: ServerError }, done: string) {
    setBusy(false);
    setAssigning(null);
    setCancelling(null);
    setMemberId("");
    setReason("");
    if (!res.ok) {
      tone("err");
      setError({ code: res.error.code, detail: res.error.detail, requestId: res.error.requestId });
      return;
    }
    tone("ok");
    say("ok", done);
    router.refresh();
  }

  async function submitAssign(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (assigning === null || memberId === "") return;
    setBusy(true);
    setError(null);
    await finish(await assignTaskAction({ slug, taskId: assigning.id, membershipId: memberId, expectedVersion: assigning.version }), t("done.assigned"));
  }

  async function submitCancel(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (cancelling === null || reason.trim() === "") return;
    setBusy(true);
    setError(null);
    await finish(await cancelTaskAction({ slug, taskId: cancelling.id, expectedVersion: cancelling.version, reason }), t("done.cancelled"));
  }

  const key = error === null ? "" : taskErrorKey(error);
  const href = (next: { kind?: string; status?: string }): string => {
    const p = new URLSearchParams();
    const k = next.kind ?? kindFilter;
    const st = next.status ?? statusFilter;
    if (k !== "") p.set("kind", k);
    if (st !== "") p.set("status", st);
    if (search !== "") p.set("q", search);
    const q = p.toString();
    return q === "" ? base : `${base}?${q}`;
  };
  const kindChips: KalipCip[] = [
    { id: "all", label: t("filters.all"), d: LICON.grid, color: "172E42", on: kindFilter === "", href: href({ kind: "" }) },
    ...KINDS.map((k) => ({ id: k, label: t(`kind.${k}`), d: KIND_VISUAL[k].d, color: KIND_VISUAL[k].color, on: kindFilter === k, href: href({ kind: kindFilter === k ? "" : k }) })),
  ];
  const statusChips: KalipCip[] = [
    { id: "all", label: t("filters.all"), d: LICON.grid, color: "172E42", on: statusFilter === "", href: href({ status: "" }) },
    ...STATUSES.map((st) => ({ id: st, label: t(`status.${st}`), d: STATUS_VISUAL[st].d, color: STATUS_VISUAL[st].color, on: statusFilter === st, href: href({ status: statusFilter === st ? "" : st }) })),
  ];
  const filtered = kindFilter !== "" || statusFilter !== "" || search !== "";
  const openAssign = (task: TaskView): void => {
    tone("tap");
    setError(null);
    setAssigning(task);
  };
  const openCancel = (task: TaskView): void => {
    tone("tap");
    setError(null);
    setCancelling(task);
  };

  return (
    <>
      <KalipEkran kind="liste" dark={dark} title={t("title")} icon={{ d: LICON.clip, color: "6C4BD8" }} testId="tasks" bar={{ back: { href: home } }} overlays={toast}>
        <p className="sr">{t("intro")}</p>
        <KalipAra
          label={t("search")}
          placeholder={t("searchPlaceholder")}
          action={base}
          defaultValue={search}
          below={
            <>
              {kindFilter === "" ? null : <input type="hidden" name="kind" value={kindFilter} />}
              {statusFilter === "" ? null : <input type="hidden" name="status" value={statusFilter} />}
            </>
          }
        />
        <KalipCipler label={t("filters.kind")} chips={kindChips} />
        <KalipCipler label={t("filters.status")} chips={statusChips} />
        {canManage && kindFilter === "COUNT" ? (
          // T-977 (B-51): sayım görevleri sayım oturumundan doğar; oturum başlatma, fark onayı ve fiş yönetici sayım ekranındadır.
          <KalipDaha href={`/t/${encodeURIComponent(slug)}/counts`} iconD={LICON.clip} testId="tasks-counts">
            {t("countSessions")}
          </KalipDaha>
        ) : null}
        {canManage ? null : (
          <div id="task-locked">
            <Banner kind="info">{t("lockedReason")}</Banner>
          </div>
        )}
        {error === null ? null : (
          <Banner kind="error">
            <p>
              {te(key)} {te(`${key}Action`)}
            </p>
            <p className="mt-1 break-all text-sm">
              {te("code", { code: error.detail === undefined ? error.code : `${error.code}/${error.detail}` })}
              {error.requestId ? ` · ${error.requestId}` : ""}
            </p>
          </Banner>
        )}
        {tasks.length === 0 ? (
          <KalipBos title={t("empty.title")} hint={t("empty.action")} iconD={LICON.clip} {...(filtered ? { action: { label: t("clear"), href: base } } : {})} />
        ) : (
          <>
            <KalipBaslik title={t("count", { n: tasks.length })} hint={t("hint")} />
            <KalipKartListe label={t("listLabel")}>
              {tasks.map((task, i) => {
                const open = task.status === "OPEN" || task.status === "ASSIGNED";
                const v = KIND_VISUAL[task.kind];
                const who = task.assignedMembershipId === null ? t("unassigned") : task.assignedName === null ? t("assigneeUnknown") : t("assignee", { name: task.assignedName });
                const qty = task.quantity === null ? null : fmtQty(task.quantity, locale);
                return (
                  <div key={task.id} role="listitem" data-testid="task-row" data-task-id={task.id} data-status={task.status} style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                    <KalipKart
                      role={null}
                      index={i}
                      name={t(`kind.${task.kind}`)}
                      code={t(`status.${task.status}`).toLocaleUpperCase(locale === "en" ? "en" : "tr")}
                      meta={who}
                      d={v.d}
                      color={v.color}
                      {...(qty === null ? {} : { badge: { value: qty, sub: t("qtySub") } })}
                      aria={[t(`kind.${task.kind}`), t(`status.${task.status}`), who, qty === null ? null : t("quantity", { quantity: qty })].filter((x): x is string => x !== null).join(" · ")}
                      onClick={() => {
                        if (open && canManage) openAssign(task);
                        else {
                          tone("tap");
                          say("info", `${t(`kind.${task.kind}`)} · ${t(`status.${task.status}`)} · ${who}`);
                        }
                      }}
                    />
                    {open ? (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button type="button" className="btn n" disabled={!canManage} aria-describedby={canManage ? undefined : "task-locked"} onClick={() => openAssign(task)} style={{ flex: 1 }}>
                          <Ico d={LICON.people} size={18} />
                          {task.status === "OPEN" ? t("assign") : t("reassign")}
                        </button>
                        <button type="button" className="btn" disabled={!canManage} aria-describedby={canManage ? undefined : "task-locked"} onClick={() => openCancel(task)} style={{ flex: 1, background: kdz("dzl", "C62828"), color: kdz("dzl", "FFFFFF") }}>
                          <Ico d={LICON.close} size={18} />
                          {t("cancel")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </KalipKartListe>
          </>
        )}
        {firstPage && nextHref === null ? null : (
          <nav aria-label={t("paging")} style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {firstPage ? null : (
              <KalipDaha href={href({})} iconD={LICON.chev}>
                {t("firstPage")}
              </KalipDaha>
            )}
            {nextHref === null ? null : (
              <KalipDaha href={nextHref} iconD={LICON.plus}>
                {t("nextPage")}
              </KalipDaha>
            )}
          </nav>
        )}
      </KalipEkran>

      <Sheet
        open={assigning !== null}
        title={t("assignTitle")}
        titleId="task-assign-title"
        icon={{ d: LICON.people, color: "2F5DA8" }}
        busy={busy}
        onClose={close}
        onSubmit={(e) => void submitAssign(e)}
        footer={
          <>
            <KalipPencereDugme kind="cancel" onClick={close} disabled={busy}>
              {t("back")}
            </KalipPencereDugme>
            <KalipPencereDugme type="submit" loading={busy} disabled={memberId === ""}>
              {t("submit")}
            </KalipPencereDugme>
          </>
        }
      >
        {assigning === null ? null : <KalipPencereMetin strong>{t(`kind.${assigning.kind}`)}</KalipPencereMetin>}
        {eligible.length === 0 ? (
          <Banner kind="info">{t("noEligible")}</Banner>
        ) : (
          <KalipPencereSecim label={t("member")} name="membershipId" value={memberId} onChange={(e) => setMemberId(e.target.value)} required>
            <option value="">{t("memberPlaceholder")}</option>
            {eligible.map((m) => (
              <option key={m.membershipId} value={m.membershipId}>
                {m.displayName}
              </option>
            ))}
          </KalipPencereSecim>
        )}
      </Sheet>

      <Sheet
        open={cancelling !== null}
        title={t("cancelTitle")}
        titleId="task-cancel-title"
        icon={{ d: LICON.close, color: "C62828" }}
        busy={busy}
        onClose={close}
        onSubmit={(e) => void submitCancel(e)}
        footer={
          <>
            <KalipPencereDugme kind="cancel" onClick={close} disabled={busy}>
              {t("back")}
            </KalipPencereDugme>
            <KalipPencereDugme type="submit" kind="danger" loading={busy} disabled={reason.trim() === ""}>
              {t("confirmCancel")}
            </KalipPencereDugme>
          </>
        }
      >
        {cancelling === null ? null : <KalipPencereMetin strong>{t(`kind.${cancelling.kind}`)}</KalipPencereMetin>}
        <KalipPencereAlan label={t("reasonLabel")} hint={t("reasonHint")} name="reason" value={reason} onChange={(e) => setReason(e.target.value)} autoComplete="off" required maxLength={500} />
      </Sheet>
    </>
  );
}
