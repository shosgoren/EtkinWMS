"use client";
// Üyeler ekranı (T-119; T-971 liste kalıbı, KalipListe.dc.html). Yetki ve iş kuralları SUNUCUDADIR: burada yalnızca sunucudan gelen durum
// gösterilir (`users.manage` kararı sayfada `listPendingInvitations` sonucundan; sıfırlama uygunluğu `resetLinkAvailable`). Sunucu reddi
// neden ayrıştırılmadan gösterilir (2. tur m6). Üye ve bekleyen davet kartları `.uc` görünümündedir; kart bağlantı değildir (içinde rol
// seçimi, Çıkar, sahiplik devri, sıfırlama bağlantısı, saha kodu, kilit açma, depoları düzenle düğmeleri — `<a>` içine düğme gömülmez).
// Ana işlem ortak alt çubukta "Davet et" (T-990: TAM EKRAN davet formu `InviteForm`, adres `?invite=1`; yetki yoksa ya da hidrasyon
// bitmeden kapalı + neden balonu, T-247). Kart içindeki rol seçimi yerel açılır liste değil: güçlü kenarlıklı tetik düğmesi ortak aramalı
// seçim sayfasını (`KalipSecimSayfasi`) açar; seçilen rol "Rolü uygula" ile onaya gider. Saha personeli / Cihazlar
// `.more` satırı. T-978: arama (`.lsearch`, GET `q`: ad; yöneticide e-posta/kullanıcı adı — sunucuda listMembers). Bilinçli farklar
// (DESIGN-PARITY, T-971): süzgeç çipi yok (üye listesi sayfalanmaz); işlem
// sonucu bildirimi balon (`.toast`), hata kutusu ve tek seferlik bağlantı kutusu mevcut bileşenlerle.
import { useFormatter, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useSyncExternalStore, type CSSProperties } from "react";
import { feedback } from "@wms/ui";
import { LICON } from "../../../design/kalip-icons.ts";
import { Ico, KalipBaslik, KalipEkran, useKalipToast } from "../kalip/ekran.tsx";
import { KalipAra, KalipBos, KalipDaha, KalipKartListe } from "../kalip/liste.tsx";
import { KalipOnay } from "../kalip/pencere.tsx";
import { KalipSecimSayfasi } from "../kalip/secim.tsx";
import { kdz } from "../kalip/tokens.ts";
import { KalipUyari } from "../kalip/uyari.tsx";
import {
  changeRoleAction,
  issuePasswordResetLinkAction,
  removeMemberAction,
  resetFieldCodeAction,
  revokeInvitationAction,
  setWarehouseScopeAction,
  transferOwnershipAction,
  unlockFieldLoginAction,
} from "./actions.ts";
import { InviteForm, LinkBox, ROLE_VISUAL, ServerErrorBanner } from "./invite-dialog.tsx";
import type { ServerError } from "./invite-dialog.tsx";
import { Btn } from "./parts.tsx";

export interface MemberView {
  /** Komutların `memberId`/`toMemberId` alanı üyelik kimliğidir (kullanıcı kimliği değil). */
  readonly membershipId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly roles: readonly string[];
  readonly isOwner: boolean;
  readonly isDemo: boolean;
  readonly resetLinkAvailable: boolean;
  /** T-997: e-postasız saha personeli (iç e-posta gösterilmez). */
  readonly field?: { readonly username: string; readonly active: boolean; readonly pendingUntil: string | null; readonly locked: boolean };
  /** T-417: yalnız yöneticiye gelir. `null` = tüm depolar; dizi = yalnız bu depolar (yeniden etkinleşen üyeliğin eski kısıtı dahil). */
  readonly warehouseIds?: readonly string[] | null;
}

export interface WarehouseOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly archived: boolean;
}

interface ScopeDraft {
  readonly memberId: string;
  readonly all: boolean;
  readonly ids: readonly string[];
}

export interface PendingView {
  readonly invitationId: string;
  readonly email: string;
  readonly role: string;
  readonly expiresAt: string;
  readonly invitedBy: string;
}

const MULTI = "__multi";

type Kind = "role" | "remove" | "transfer" | "reset" | "fieldCode" | "unlock" | "scope";

const FIELD_ROLES: readonly string[] = ["PICKER", "COUNTER"];
interface Confirm {
  readonly kind: Kind;
  readonly member: MemberView;
  readonly roleKey?: string;
  readonly scope?: ScopeDraft;
}

// T-1121: rol seçimi tetiği kalıp aramalı seçim alanı görünümünde (`.fld.ksecb`, eski Tailwind kenarlıklı düğme yerine); satırda
// "Rolü uygula" ile yan yana sığsın diye esnek genişlik.
const SELECT_STYLE: CSSProperties = { flex: "1 1 220px", width: "auto", minWidth: 0 };

const noopSubscribe = (): (() => void) => () => undefined;

const c = (hex: string): string => kdz("dzl", hex);

/** Kart kabı: `.uc` görünümü, bağlantı değil (eylemler içinde). */
const CARD: CSSProperties = { display: "flex", flexDirection: "column", alignItems: "stretch", gap: 10, cursor: "default", transform: "none" };
const HEAD: CSSProperties = { display: "grid", gridTemplateColumns: "auto minmax(0,1fr)", alignItems: "center", gap: 12 };
const ROW: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, minWidth: 0 };
const NOTE: CSSProperties = { margin: 0, fontSize: 13, lineHeight: 1.35, opacity: 0.8, overflowWrap: "anywhere" };

export function MembersView({
  slug,
  dark,
  selfUserId,
  members,
  pending,
  roleKeys,
  warehouses = [],
  scopeEnabled = false,
  q = "",
}: {
  slug: string;
  dark: boolean;
  selfUserId: string;
  members: readonly MemberView[];
  /** `null`: yönetim yetkisi yok. */
  pending: readonly PendingView[] | null;
  roleKeys: readonly string[];
  /** T-417: yöneticiye depo seçenekleri (arşivliler dahil). */
  warehouses?: readonly WarehouseOption[];
  /** `WAREHOUSE_SCOPE_ENABLED`: kapalıysa kısıt kaydedilir ama uygulanmaz; ekran bunu söyler. */
  scopeEnabled?: boolean;
  /** T-978: sunucu araması; boş = tümü. */
  q?: string;
}) {
  const t = useTranslations("members");
  const tr = useTranslations("roles");
  const tku = useTranslations("kural");
  const format = useFormatter();
  const router = useRouter();
  const params = useSearchParams();
  const canManage = pending !== null;
  const home = `/t/${encodeURIComponent(slug)}`;
  const inviting = canManage && params.get("invite") === "1";
  const [rolePick, setRolePick] = useState<MemberView | null>(null);
  // T-247: sunucu HTML'i hidrasyondan önce tıklanabilir görünür; o tıklama React'e ulaşmaz (staging'de yavaş JS yüklemesinde
  // davet diyaloğu açılmıyordu). Düğme hidrasyon bitene kadar devre dışı: sunucuda/ilk çizimde false, istemcide true.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [revoking, setRevoking] = useState<PendingView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ServerError | null>(null);
  const [resetUnavailable, setResetUnavailable] = useState(false);
  const [resetLink, setResetLink] = useState<{ name: string; link: string } | null>(null);
  const [fieldCode, setFieldCode] = useState<{ name: string; code: string } | null>(null);
  const selfIsOwner = members.some((x) => x.userId === selfUserId && x.isOwner);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [scopeDraft, setScopeDraft] = useState<ScopeDraft | null>(null);
  const { say, node: toast } = useKalipToast("liste");
  const whName = (id: string) => {
    const w = warehouses.find((x) => x.id === id);
    return w === undefined ? t("scope.unknown") : w.archived ? t("scope.archived", { name: w.name }) : w.name;
  };
  const returnTo = `/t/${slug}/members`;
  const listHref = q === "" ? returnTo : `${returnTo}?q=${encodeURIComponent(q)}`;

  const roleName = (keys: readonly string[]) => keys.map((k) => tr(k)).join(", ");
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  const notify = (text: string): void => {
    say("ok", text);
  };

  function fail(res: { error: { code: string; detail?: string | undefined; requestId: string } }, kind?: Kind) {
    feedback.error();
    // Sıfırlama reddi: neden ayrıştırılmaz, nötr metin (2. tur m6); kimlik/oturum/MFA yönlendirmeleri korunur.
    if (kind === "reset" && res.error.code === "FORBIDDEN" && res.error.detail === undefined) {
      setResetUnavailable(true);
      return;
    }
    setError({ code: res.error.code, detail: res.error.detail, requestId: res.error.requestId });
  }

  async function run() {
    if (confirm === null) return;
    const { kind, member } = confirm;
    setBusy(true);
    setError(null);
    setResetUnavailable(false);
    setResetLink(null);
    setFieldCode(null);
    if (kind === "fieldCode") {
      const res = await resetFieldCodeAction({ slug, memberId: member.membershipId });
      setBusy(false);
      setConfirm(null);
      if (!res.ok) return fail(res);
      setFieldCode({ name: member.displayName, code: res.data.code });
      router.refresh();
      return;
    }
    if (kind === "unlock") {
      const res = await unlockFieldLoginAction({ slug, memberId: member.membershipId });
      setBusy(false);
      setConfirm(null);
      if (!res.ok) return fail(res);
      notify(t("done.unlock"));
      router.refresh();
      return;
    }
    if (kind === "scope") {
      const s = confirm.scope;
      if (s === undefined) return;
      const res = await setWarehouseScopeAction(
        s.all ? { slug, memberId: member.membershipId, all: true } : { slug, memberId: member.membershipId, warehouseIds: [...s.ids] },
      );
      setBusy(false);
      setConfirm(null);
      if (!res.ok) return fail(res);
      setScopeDraft(null);
      notify(t(res.data.changed ? "done.scope" : "done.scopeUnchanged"));
      router.refresh();
      return;
    }
    if (kind === "reset") {
      const res = await issuePasswordResetLinkAction({ slug, memberId: member.membershipId });
      setBusy(false);
      setConfirm(null);
      if (!res.ok) return fail(res, kind);
      setResetLink({ name: member.displayName, link: res.data.resetLink });
      return;
    }
    const res =
      kind === "role"
        ? await changeRoleAction({ slug, memberId: member.membershipId, roleKey: confirm.roleKey })
        : kind === "remove"
          ? await removeMemberAction({ slug, memberId: member.membershipId })
          : await transferOwnershipAction({ slug, toMemberId: member.membershipId });
    setBusy(false);
    setConfirm(null);
    if (!res.ok) return fail(res);
    notify(t(`done.${kind}`));
    router.refresh();
  }

  async function revoke() {
    if (revoking === null) return;
    setBusy(true);
    setError(null);
    const res = await revokeInvitationAction({ slug, invitationId: revoking.invitationId });
    setBusy(false);
    setRevoking(null);
    if (!res.ok) return fail(res);
    notify(t("pending.revoked"));
    router.refresh();
  }

  const confirmText = confirm
    ? {
        title: t(`confirm.${confirm.kind}.title`),
        description: t(`confirm.${confirm.kind}.description`, {
          name: confirm.member.displayName,
          role: confirm.roleKey === undefined ? "" : tr(confirm.roleKey),
          scope: confirm.scope === undefined ? "" : confirm.scope.all ? t("scope.allShort") : confirm.scope.ids.map(whName).join(", "),
        }),
        button: t(`confirm.${confirm.kind}.button`),
      }
    : { title: "", description: "", button: "" };

  if (inviting) {
    return <InviteForm slug={slug} dark={dark} roleKeys={roleKeys} onClose={() => router.push(listHref)} onInvited={() => router.refresh()} />;
  }

  const pickRoles = rolePick === null ? [] : roleKeys.filter((r) => rolePick.field === undefined || FIELD_ROLES.includes(r));

  return (
    <>
      <KalipEkran
        kind="liste"
        dark={dark}
        title={t("title")}
        icon={{ d: LICON.people, color: "2F5DA8" }}
        testId="members"
        bar={{
          back: { href: home },
          main: {
            label: t("k.inviteShort"),
            aria: t("invite"),
            d: LICON.plus,
            disabled: !canManage || !hydrated,
            disabledReason: canManage ? t("k.wait") : t("lockedReason"),
            onClick: () => {
              feedback.minor();
              router.push(`${listHref}${listHref.includes("?") ? "&" : "?"}invite=1`);
            },
            testId: "members-invite",
          },
        }}
        overlays={toast}
      >
        {canManage ? null : (
          <p id="invite-locked" style={NOTE}>
            {t("lockedReason")}
          </p>
        )}
        {canManage ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <KalipDaha href={`/t/${slug}/members/field`} iconD={LICON.plus} iconColor="0E7C7B" testId="members-add-field">
              {t("addField")}
            </KalipDaha>
            <KalipDaha href={`/t/${slug}/members/devices`} iconD={LICON.key} iconColor="30475A" testId="members-devices">
              {t("devices")}
            </KalipDaha>
          </div>
        ) : null}

        {error ? <ServerErrorBanner error={error} returnTo={returnTo} /> : null}
        {resetUnavailable ? (
          <KalipUyari tone="hata">
            <p>{t("unavailableReason")}</p>
          </KalipUyari>
        ) : null}
        {fieldCode ? (
          <LinkBox title={`${t("linkBox.fieldCodeTitle")} · ${fieldCode.name}`} link={fieldCode.code} warning={t("linkBox.fieldCodeWarning")} onDismiss={() => setFieldCode(null)} />
        ) : null}
        {resetLink ? (
          <LinkBox title={`${t("linkBox.resetTitle")} · ${resetLink.name}`} link={resetLink.link} warning={t("linkBox.resetWarning")} onDismiss={() => setResetLink(null)} />
        ) : null}

        <KalipAra label={t("search")} placeholder={t("searchPlaceholder")} action={`/t/${slug}/members`} defaultValue={q} />
        <KalipBaslik title={t("k.count", { n: members.length })} hint={t("intro")} />
        {members.length === 0 && q !== "" ? (
          <KalipBos title={tku("notFoundSearch")} hint={t("noMatchHint")} action={{ label: t("clearSearch"), href: `/t/${slug}/members`, kind: "clear" }} />
        ) : members.length === 0 ? (
          <KalipBos
            title={t("empty")}
            hint={t("emptyAction")}
            iconD={LICON.people}
            action={
              canManage
                ? {
                    label: t("inviteFirst"),
                    kind: "add",
                    onClick: () => {
                      feedback.minor();
                      router.push(`${listHref}${listHref.includes("?") ? "&" : "?"}invite=1`);
                    },
                  }
                : { label: tku("home"), href: home, kind: "go" }
            }
          />
        ) : (
          <KalipKartListe label={t("membersList")}>
            {members.map((m, i) => {
              const self = m.userId === selfUserId;
              // T-413: firma sahibinin rolü/üyeliği sunucuda kilitli (OWNER_ROLE/LAST_OWNER) — ekranda da kilitli; sahiplik devri yalnız sahibe.
              // Demo satırı: rol/çıkarma/devir için ayrı nötr metin; sıfırlama kilidi 2. tur m6 metninde kalır.
              const lockText = !canManage ? t("lockedReason") : m.isDemo ? t("demoLocked") : m.isOwner ? t("ownerLocked") : null;
              const resetLocked = !canManage || m.isDemo || !m.resetLinkAvailable;
              const resetText = !canManage ? t("lockedReason") : m.isDemo || !m.resetLinkAvailable ? t("unavailableReason") : null;
              // Birden çok rolü olan üye: seçici "birden çok rol" gösterir; tek rol seçilip uygulanırsa roller o role iner (sunucu kuralı).
              const current = m.roles.length > 1 ? MULTI : (m.roles[0] ?? "");
              const selected = draft[m.userId] ?? current;
              const noteId = `lock-${m.userId}`;
              const desc = lockText === null ? undefined : noteId;
              const color = m.isOwner ? "B07D0B" : m.isDemo ? "4E6476" : m.field ? "0E7C7B" : "2F5DA8";
              const sub =
                m.field && m.field.username === ""
                  ? null
                  : m.field
                    ? `@${m.field.username} · ${m.field.active ? t("fieldActive") : m.field.pendingUntil !== null ? t("fieldPending", { until: when(m.field.pendingUntil) }) : t("fieldNoCode")}`
                    : m.email;
              return (
                <div key={m.userId} role="listitem" data-testid="member-card" className="uc" style={{ ...CARD, animationDelay: `${i * 30}ms` }}>
                  <div style={HEAD}>
                    <span className="uic" style={{ background: c(color) }}>
                      <Ico d={m.isOwner ? LICON.key : LICON.people} size={26} />
                    </span>
                    <span className="ut">
                      <b>{m.displayName}</b>
                      {sub === null ? null : (
                        <small className="mono" title={sub}>
                          {sub}
                        </small>
                      )}
                      <small className="um">
                        {roleName(m.roles)} · {t("statusActive")}
                      </small>
                    </span>
                  </div>
                  {m.isOwner || self || m.isDemo || m.field ? (
                    <div style={ROW}>
                      {m.isOwner ? <span className="pill warn">{t("ownerBadge")}</span> : null}
                      {self ? <span className="pill ok">{t("selfBadge")}</span> : null}
                      {m.isDemo ? <span className="pill" style={{ background: c("EEF1F4"), color: c("4E6476") }}>{t("demoBadge")}</span> : null}
                      {m.field ? <span className="pill ok">{t("fieldBadge")}</span> : null}
                      {m.field?.locked ? <span className="pill" style={{ background: c("C62828"), color: c("FFFFFF") }}>{t("fieldLocked")}</span> : null}
                    </div>
                  ) : null}
                  {m.warehouseIds === undefined ? null : (
                    <p style={NOTE} data-testid="member-scope">
                      {m.roles.includes("TENANT_ADMIN") ? t("scope.admin") : m.warehouseIds === null ? t("scope.all") : t("scope.only", { names: m.warehouseIds.map(whName).join(", ") })}
                    </p>
                  )}
                  {self ? null : (
                    <div role="group" aria-label={t("actionsFor", { name: m.displayName })} style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                      <div style={ROW}>
                        <button
                          type="button"
                          aria-label={`${t("role")} · ${m.displayName}: ${selected === MULTI ? roleName(m.roles) : tr(selected)}`}
                          aria-haspopup="listbox"
                          aria-expanded={rolePick?.userId === m.userId}
                          className="fld ksecb"
                          style={SELECT_STYLE}
                          disabled={lockText !== null}
                          aria-describedby={desc}
                          onClick={() => {
                            feedback.minor();
                            setRolePick(m);
                          }}
                          data-testid="member-role"
                          data-value={selected}
                        >
                          <span>{t("role")}</span>
                          <em style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <Ico d={(ROLE_VISUAL[selected] ?? { d: LICON.people }).d} size={18} />
                            {selected === MULTI ? roleName(m.roles) : tr(selected)}
                          </em>
                          <Ico d={LICON.chev} size={20} className="ico chev" />
                        </button>
                        <Btn kind="n" scope="dzl" d={LICON.check} disabled={lockText !== null || selected === current || selected === MULTI} aria-describedby={desc} onClick={() => setConfirm({ kind: "role", member: m, roleKey: selected })}>
                          {t("applyRole")}
                        </Btn>
                      </div>
                      <div style={ROW}>
                        <Btn kind="danger" scope="dzl" d={LICON.trash} disabled={lockText !== null} aria-describedby={desc} onClick={() => setConfirm({ kind: "remove", member: m })}>
                          {t("remove")}
                        </Btn>
                        {!selfIsOwner || m.isOwner || m.field ? null : (
                          <Btn kind="soft" scope="dzl" d={LICON.key} disabled={lockText !== null} aria-describedby={desc} onClick={() => setConfirm({ kind: "transfer", member: m })}>
                            {t("transfer")}
                          </Btn>
                        )}
                        {m.field ? (
                          <>
                            <Btn kind="soft" scope="dzl" d={LICON.key} disabled={lockText !== null} aria-describedby={desc} onClick={() => setConfirm({ kind: "fieldCode", member: m })}>
                              {t("fieldNewCode")}
                            </Btn>
                            {m.field.locked ? (
                              <Btn kind="soft" scope="dzl" d={LICON.lock} disabled={lockText !== null} aria-describedby={desc} onClick={() => setConfirm({ kind: "unlock", member: m })}>
                                {t("fieldUnlock")}
                              </Btn>
                            ) : null}
                          </>
                        ) : (
                          <Btn kind="soft" scope="dzl" d={LICON.shield} disabled={resetLocked} aria-describedby={resetText === null ? undefined : `${noteId}-reset`} onClick={() => setConfirm({ kind: "reset", member: m })}>
                            {t("resetLink")}
                          </Btn>
                        )}
                      </div>
                      {m.warehouseIds === undefined || m.roles.includes("TENANT_ADMIN") || m.isDemo ? null : scopeDraft?.memberId === m.membershipId ? (
                        <fieldset data-testid="scope-editor" style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, margin: 0, padding: 12, border: `2px solid ${c("C9D6E0")}`, borderRadius: 16 }}>
                          <legend style={{ padding: "0 4px", fontWeight: 800 }}>{t("scope.legend", { name: m.displayName })}</legend>
                          {scopeEnabled ? null : <p style={NOTE}>{t("scope.disabled")}</p>}
                          <label style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 48 }}>
                            <input type="checkbox" style={{ width: 24, height: 24 }} checked={scopeDraft.all} onChange={(e) => setScopeDraft({ ...scopeDraft, all: e.target.checked })} />
                            {t("scope.allOption")}
                          </label>
                          {warehouses.map((w) => (
                            <label key={w.id} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 48, minWidth: 0 }}>
                              <input
                                type="checkbox"
                                style={{ width: 24, height: 24 }}
                                disabled={scopeDraft.all || (w.archived && !scopeDraft.ids.includes(w.id))}
                                checked={!scopeDraft.all && scopeDraft.ids.includes(w.id)}
                                onChange={(e) =>
                                  setScopeDraft({
                                    ...scopeDraft,
                                    ids: e.target.checked ? [...scopeDraft.ids, w.id] : scopeDraft.ids.filter((x) => x !== w.id),
                                  })
                                }
                              />
                              <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{`${w.code} · ${whName(w.id)}`}</span>
                            </label>
                          ))}
                          {!scopeDraft.all && scopeDraft.ids.length === 0 ? <p style={NOTE}>{t("scope.pickOne")}</p> : null}
                          <div style={ROW}>
                            <Btn kind="n" scope="dzl" d={LICON.check} disabled={!scopeDraft.all && scopeDraft.ids.length === 0} onClick={() => setConfirm({ kind: "scope", member: m, scope: scopeDraft })}>
                              {t("scope.save")}
                            </Btn>
                            <Btn kind="soft" scope="dzl" onClick={() => setScopeDraft(null)}>
                              {t("confirmCancel")}
                            </Btn>
                          </div>
                        </fieldset>
                      ) : (
                        <div style={ROW}>
                          <Btn kind="soft" scope="dzl" d={LICON.depo} disabled={lockText !== null} aria-describedby={desc} onClick={() => setScopeDraft({ memberId: m.membershipId, all: m.warehouseIds === null, ids: m.warehouseIds ?? [] })}>
                            {t("scope.edit")}
                          </Btn>
                        </div>
                      )}
                      {lockText === null ? null : (
                        <p id={noteId} style={NOTE}>
                          {lockText}
                        </p>
                      )}
                      {resetText === null || m.field ? null : (
                        <p id={`${noteId}-reset`} style={NOTE}>
                          {resetText}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </KalipKartListe>
        )}

        <section aria-label={t("pending.title")} style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0, flex: "none" }}>
          <KalipBaslik title={t("pending.title")} hint={pending === null ? undefined : t("k.pendingCount", { n: pending.length })} />
          {pending === null ? (
            <p style={NOTE}>{t("pending.locked")}</p>
          ) : pending.length === 0 ? (
            <p style={NOTE}>{t("pending.empty")}</p>
          ) : (
            <KalipKartListe label={t("pending.title")}>
              {pending.map((p, i) => (
                <div key={p.invitationId} role="listitem" data-testid="pending-card" className="uc" style={{ ...CARD, animationDelay: `${i * 30}ms` }}>
                  <div style={HEAD}>
                    <span className="uic" style={{ background: c("E56A00") }}>
                      <Ico d={LICON.clock} size={26} />
                    </span>
                    <span className="ut">
                      <b title={p.email}>{p.email}</b>
                      <small className="mono">
                        {tr(p.role)} · {t("pending.expires", { date: when(p.expiresAt) })}
                      </small>
                      <small className="um">{t("pending.invitedBy", { name: p.invitedBy })}</small>
                    </span>
                  </div>
                  <div style={ROW}>
                    <Btn kind="soft" scope="dzl" d={LICON.close} onClick={() => setRevoking(p)}>
                      {t("pending.revoke")}
                    </Btn>
                  </div>
                </div>
              ))}
            </KalipKartListe>
          )}
        </section>
      </KalipEkran>

      <KalipSecimSayfasi
        open={rolePick !== null}
        title={rolePick === null ? t("role") : `${t("role")} · ${rolePick.displayName}`}
        icon={{ d: LICON.shield, color: "2F5DA8" }}
        value={rolePick === null ? "" : (draft[rolePick.userId] ?? (rolePick.roles.length > 1 ? MULTI : (rolePick.roles[0] ?? "")))}
        options={pickRoles.map((r) => ({ id: r, label: tr(r), d: (ROLE_VISUAL[r] ?? { d: LICON.people }).d, color: (ROLE_VISUAL[r] ?? { color: "2F5DA8" }).color }))}
        scan={false}
        onPick={(id) => {
          if (rolePick !== null) setDraft({ ...draft, [rolePick.userId]: id });
        }}
        onClose={() => setRolePick(null)}
        testId="member-role-sheet"
      />
      <KalipOnay
        open={confirm !== null}
        title={confirmText.title}
        description={confirmText.description}
        confirmLabel={confirmText.button}
        cancelLabel={t("confirmCancel")}
        variant={confirm?.kind === "remove" ? "danger" : "primary"}
        loading={busy}
        onConfirm={() => void run()}
        onCancel={() => setConfirm(null)}
      />
      <KalipOnay
        open={revoking !== null}
        title={t("pending.revokeTitle")}
        description={t("pending.revokeDescription", { email: revoking?.email ?? "" })}
        confirmLabel={t("pending.revoke")}
        cancelLabel={t("confirmCancel")}
        loading={busy}
        onConfirm={() => void revoke()}
        onCancel={() => setRevoking(null)}
      />
    </>
  );
}
