"use client";
// Yönetici görev ekranı (T-304). Yetki ve iş kuralları SUNUCUDADIR: `canManage` yalnızca gösterimdir (kilit + açıklama); eylemler
// sunucuda `document.approve` ister (A-132). Atanabilir kişiler sunucuda hesaplanır (`kinds`: kişinin yapabildiği görev türleri).
// Sunucu reddi neden + sonraki eylemle gösterilir.
// T-971 (B-63, I-18): LİSTE kalıbı (KalipListe.dc.html): tür ve durum süzgeç çipleri (adresi değiştirir: `?kind=` / `?status=`), görev kartları,
// kartın altında Ata / İptal et eylem satırı (kart içine düğme gömülmez), sayfalama `KalipDaha`.
// T-990 (B-97): Ata ve İptal et pencere değil TAM EKRAN FORMDUR (`KalipFormEkran`; adres `?assign=<id>` / `?cancel=<id>`, liste süzgeci ve
// sayfa imleci korunur). Kişi seçimi ortak `KalipSecim` (çok kişide aramalı seçim sayfası); iptal gerekçesi zorunlu alan kuralıdır.
// T-978: arama (`.lsearch`, GET `q`: ürün kodu/adı, raf, atanan kişi — sunucuda listTasks; çiplerle birlikte çalışır).
// Bilinçli farklar (DESIGN-PARITY, T-971): çip sayıları yok; alt çubuk ana işlemi OKUT (ekranın
// kendi oluşturma işlemi yok — görevler mal kabul / sipariş / sayımdan doğar).
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Banner, feedback } from "@wms/ui";
import { LICON } from "../../../design/kalip-icons.ts";
import type { AlanKurali } from "../kalip/dogrula.ts";
import { Ico, KalipBaslik, KalipEkran, useKalipToast } from "../kalip/ekran.tsx";
import { KalipFormEkran, KalipOnizleme, type KaydetSonuc } from "../kalip/form-ekran.tsx";
import { KalipAlan, KalipGrup } from "../kalip/form.tsx";
import { fmtQty } from "../kalip/format.ts";
import { KalipAra, KalipBos, KalipCipler, KalipDaha, KalipKart, KalipKartListe, type KalipCip } from "../kalip/liste.tsx";
import { KalipSecim } from "../kalip/secim.tsx";
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
  /** Sunucudan süzgece uyan toplam görev sayısı (ALTIN-KURAL 15); yoksa sayfadaki satır sayısı. */
  readonly total?: number;
}

/** Sunucu reddi → tek satırlık neden (formun altında + balon). */
function useHataMetni(): (error: ServerError) => string {
  const te = useTranslations("tasks.errors");
  return (error) => {
    const k = taskErrorKey(error);
    return `${te(k)} ${te(`${k}Action`)} · ${te("code", { code: error.detail === undefined ? error.code : `${error.code}/${error.detail}` })}${error.requestId ? ` · ${error.requestId}` : ""}`;
  };
}

/** Görevi ata: tam ekran form (kişi seçimi; yeniden atamada açılış değeri mevcut sorumlu). */
function TaskAssignForm({ slug, dark, task, members, onClose }: { slug: string; dark: boolean; task: TaskView; members: readonly TaskMemberView[]; onClose: (msg?: string) => void }) {
  const t = useTranslations("tasks");
  const hata = useHataMetni();
  const router = useRouter();
  const eligible = members.filter((m) => m.kinds.includes(task.kind));
  const [initial] = useState(() => ({ member: task.assignedMembershipId !== null && eligible.some((m) => m.membershipId === task.assignedMembershipId) ? task.assignedMembershipId : "" }));
  const [f, setF] = useState(initial);
  const v = KIND_VISUAL[task.kind];
  const rules: AlanKurali[] = [{ name: "member", label: t("member"), required: true }];
  const who = eligible.find((m) => m.membershipId === f.member)?.displayName ?? "";

  async function save(): Promise<KaydetSonuc> {
    const res = await assignTaskAction({ slug, taskId: task.id, membershipId: f.member, expectedVersion: task.version });
    return res.ok ? { ok: true } : { ok: false, mesaj: hata(res.error) };
  }

  return (
    <KalipFormEkran
      dark={dark}
      title={t("assignTitle")}
      subtitle={t("k.assignSub")}
      icon={{ d: LICON.people, color: "2F5DA8" }}
      testId="task-assign"
      values={f}
      initial={initial}
      rules={rules}
      canEdit={eligible.length > 0}
      lockedTitle={t("noEligible")}
      lockedSub={t("lockedReason")}
      onSave={save}
      onDone={() => {
        onClose(t("done.assigned"));
        router.refresh();
      }}
      onBack={() => onClose()}
      homeHref={`/t/${encodeURIComponent(slug)}`}
      saveShort={t("k.assignShort")}
      saveAria={t("assignTitle")}
      savedText={t("done.assigned")}
      leaveText={t("k.leaveAssign")}
      leaveSaveLabel={t("k.leaveAssignSave")}
      preview={<KalipOnizleme name={t(`kind.${task.kind}`)} code={t(`status.${task.status}`)} d={v.d} color={v.color} kind={t("k.gTask")} rows={who === "" ? [] : [{ k: t("member"), v: who }]} />}
    >
      <KalipGrup title={t(`kind.${task.kind}`)} sub={t(`status.${task.status}`)} d={v.d} color={v.color}>
        {eligible.length === 0 ? (
          <Banner kind="info">{t("noEligible")}</Banner>
        ) : (
          <KalipSecim
            name="member"
            label={t("member")}
            placeholder={t("memberPlaceholder")}
            value={f.member}
            color="2F5DA8"
            icon={{ d: LICON.people, color: "2F5DA8" }}
            onPick={(id) => setF({ member: id })}
            options={eligible.map((m) => ({ id: m.membershipId, label: m.displayName, d: LICON.people, color: "0E7C7B" }))}
            testId="task-assign-member"
          />
        )}
      </KalipGrup>
    </KalipFormEkran>
  );
}

/** Görevi iptal et: tam ekran form (zorunlu gerekçe; denetim kaydına yazılır). */
function TaskCancelForm({ slug, dark, task, onClose }: { slug: string; dark: boolean; task: TaskView; onClose: (msg?: string) => void }) {
  const t = useTranslations("tasks");
  const hata = useHataMetni();
  const router = useRouter();
  const [initial] = useState({ reason: "" });
  const [f, setF] = useState(initial);
  const v = KIND_VISUAL[task.kind];
  const rules: AlanKurali[] = [{ name: "reason", label: t("reasonLabel"), required: true, maxLength: 500 }];

  async function save(): Promise<KaydetSonuc> {
    const res = await cancelTaskAction({ slug, taskId: task.id, expectedVersion: task.version, reason: f.reason });
    return res.ok ? { ok: true } : { ok: false, mesaj: hata(res.error) };
  }

  return (
    <KalipFormEkran
      dark={dark}
      title={t("cancelTitle")}
      subtitle={t("k.cancelSub")}
      icon={{ d: LICON.close, color: "C62828" }}
      testId="task-cancel"
      values={f}
      initial={initial}
      rules={rules}
      onSave={save}
      onDone={() => {
        onClose(t("done.cancelled"));
        router.refresh();
      }}
      onBack={() => onClose()}
      homeHref={`/t/${encodeURIComponent(slug)}`}
      saveShort={t("k.cancelShort")}
      saveAria={t("confirmCancel")}
      savedText={t("done.cancelled")}
      leaveText={t("k.leaveCancel")}
      leaveSaveLabel={t("k.leaveCancelSave")}
      preview={<KalipOnizleme name={t(`kind.${task.kind}`)} code={t(`status.${task.status}`)} d={v.d} color={v.color} kind={t("k.gTask")} />}
    >
      <KalipGrup title={t(`kind.${task.kind}`)} sub={t(`status.${task.status}`)} d={v.d} color="C62828">
        <KalipAlan label={`${t("reasonLabel")} *`} hint={t("reasonHint")} name="reason" value={f.reason} onChange={(e) => setF({ reason: e.target.value })} autoComplete="off" maxLength={500} multiline />
      </KalipGrup>
    </KalipFormEkran>
  );
}

export function TasksView({ slug, dark, canManage, tasks, members, kindFilter, statusFilter, nextHref, firstPage, search = "", total }: TasksViewProps) {
  const t = useTranslations("tasks");
  const tk = useTranslations("kural");
  const router = useRouter();
  const params = useSearchParams();
  const locale = useLocale();
  const home = `/t/${encodeURIComponent(slug)}`;
  const base = `${home}/tasks`;
  const { say, node: toast } = useKalipToast("liste");

  // Liste adresi (süzgeç + sayfa imleci korunur; form parametreleri düşer).
  const listQs = (() => {
    const p = new URLSearchParams(params.toString());
    p.delete("assign");
    p.delete("cancel");
    return p.toString();
  })();
  const listHref = listQs === "" ? base : `${base}?${listQs}`;
  const go = (param: "assign" | "cancel", task: TaskView): void => {
    feedback.minor();
    const p = new URLSearchParams(listQs);
    p.set(param, task.id);
    router.push(`${base}?${p.toString()}`);
  };
  const close = (msg?: string): void => {
    router.push(listHref);
    if (msg !== undefined) {
      say("ok", msg);
    }
  };
  const assignId = params.get("assign");
  const cancelId = params.get("cancel");
  const isOpen = (x: TaskView): boolean => x.status === "OPEN" || x.status === "ASSIGNED";
  const assigning = canManage && assignId !== null ? tasks.find((x) => x.id === assignId && isOpen(x)) : undefined;
  const cancelling = canManage && cancelId !== null ? tasks.find((x) => x.id === cancelId && isOpen(x)) : undefined;
  if (assigning !== undefined) return <TaskAssignForm key={assigning.id} slug={slug} dark={dark} task={assigning} members={members} onClose={close} />;
  if (cancelling !== undefined) return <TaskCancelForm key={cancelling.id} slug={slug} dark={dark} task={cancelling} onClose={close} />;

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
  const openAssign = (task: TaskView): void => go("assign", task);
  const openCancel = (task: TaskView): void => go("cancel", task);

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
        {canManage && (assignId ?? cancelId) !== null ? <Banner kind="info">{t("k.notFound")}</Banner> : null}
        {tasks.length === 0 ? (
          <KalipBos
            title={filtered ? tk("notFoundSearch") : t("empty.title")}
            hint={t("empty.action")}
            iconD={LICON.clip}
            action={filtered ? { label: t("clear"), href: base, kind: "clear" } : { label: tk("home"), href: home, kind: "go" }}
          />
        ) : (
          <>
            <KalipBaslik title={t("count", { n: total ?? tasks.length })} hint={t("hint")} />
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
                          feedback.minor();
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

    </>
  );
}
