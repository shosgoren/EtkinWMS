"use client";
// T-430 (I-18): Ekip.dc.html BİREBİR — liste (`.seg3`: KİŞİ · ONAY BEKLİYOR · GRUP ›; `.filt` + `.plist > .pr2`), onay kartı (`.req`: kişi,
// cihaz, kod, `.gpick` grup seçimi, reddet), e-posta daveti (`.lead`, `.fld`, `.gpick`), katılma QR'ı (`.qrcard`, `.qmeta`), "Kişi ekle"
// sayfası (`.scrim > .sheet > .addb`), alt cam çubuk ve kaydedilmemiş iş kutusu. CSS `design/ekip.css` (üretilmiş) + `design/ekip-frame.css`.
// Bilinçli farklar (DESIGN-PARITY): onay kartında kod GÖSTERİLMEZ, yönetici personelin ekranındaki kodu YAZAR (uygulama rolü kodu okuyamaz);
// aktif/pasif anahtarı ve "son görülme" yok (pasif üyelik ayrı iş) — filtre Hepsi / Saha / Ofis; davette ad alanı yok (kişi kabulde yazar);
// Etkin (sesle) T-424; QR adresi yalnız üretildiği anda gösterilir (güvenlik: eskisi yeniden gösterilmez, yenile → yeni QR).
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { create as createQr } from "qrcode";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useModalFocus } from "../kalip/odak.ts";
import { dz } from "../../../design/ekip-tokens.ts";
import { EICON } from "../../../design/ekip-icons.ts";
import { SHICON } from "../../../design/paylas-icons.ts";
import { approveJoinAction, createJoinLinkAction, inviteMemberAction, rejectJoinAction } from "../members/actions.ts";
import { setMemberGroupAction } from "../groups/actions.ts";
import { KabukBar, useKabuk } from "../kabuk/kabuk-bar.tsx";
import { useCikisKorumasi } from "../kalip/cikis.tsx";
import { JoinShareRow, useJoinShare } from "../members/join-share.tsx";
import { UstDugmeler } from "../ust-dugmeler.tsx";
import type { ToastKind } from "../kalip/ekran.tsx";
import { balonGoster, buyukHarf, feedback } from "@wms/ui";

type Role = "TENANT_ADMIN" | "WAREHOUSE_MANAGER" | "PICKER" | "COUNTER" | "READ_ONLY";
export interface TeamPerson {
  readonly id: string;
  readonly name: string;
  readonly isOwner: boolean;
  readonly isField: boolean;
  readonly role: string;
  readonly groupId: string | null;
}
export interface TeamGroup {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  /** Hassas (MFA isteyen) yetki taşır: saha hesabına verilemez. */
  readonly sensitive: boolean;
}
export interface TeamPending {
  readonly id: string;
  readonly name: string;
  readonly username: string;
  readonly deviceHint: string | null;
  readonly createdAt: string;
  readonly wrongTries: number;
}
export interface TeamViewProps {
  readonly slug: string;
  readonly dark: boolean;
  readonly canEditGroups: boolean;
  readonly isDemo: boolean;
  readonly groups: readonly TeamGroup[];
  readonly people: readonly TeamPerson[];
  readonly pending: readonly TeamPending[];
  readonly hasLink: boolean;
}

/** Rol renkleri (kaynak GROUPS). */
const ROLE_COLOR: Readonly<Record<string, string>> = {
  TENANT_ADMIN: "172E42",
  WAREHOUSE_MANAGER: "0E7C7B",
  PICKER: "2F7D5B",
  COUNTER: "2F5DA8",
  READ_ONLY: "6A7F91",
};
const INVITE_ROLES: readonly Role[] = ["WAREHOUSE_MANAGER", "PICKER", "COUNTER", "READ_ONLY"];
type Chip = { key: string; label: string; color: string; role: "PICKER" | "COUNTER"; groupId: string | null };

function Ico({ d, size, style }: { d: readonly string[] | string; size: number; style?: CSSProperties }) {
  const list = typeof d === "string" ? [d] : d;
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={style}>
      {list.map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}

function QrSvg({ value, label }: { value: string; label: string }) {
  const qr = useMemo(() => {
    try {
      const m = createQr(value, { errorCorrectionLevel: "M" }).modules;
      let d = "";
      for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (m.get(y, x)) d += `M${x} ${y}h1v1h-1z`;
      return { size: m.size, d };
    } catch {
      return null;
    }
  }, [value]);
  if (qr === null) return null;
  return (
    <svg className="qr" viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges" role="img" aria-label={label} data-testid="team-qr">
      <rect width={qr.size} height={qr.size} fill={dz("FFFFFF")} />
      <path d={qr.d} fill={dz("172E42")} />
    </svg>
  );
}

export function TeamView({ slug, dark, canEditGroups, isDemo, groups, people, pending, hasLink }: TeamViewProps) {
  const t = useTranslations("ekip");
  const locale = useLocale(); // T-436 (ALTIN-KURAL 16): kullanıcının dili
  const tk = useTranslations("kalip");
  const router = useRouter();
  const base = `/t/${encodeURIComponent(slug)}`;
  const [view, setView] = useState<"list" | "invite" | "qr">("list");
  const [tab, setTab] = useState<"people" | "pend">(pending.length > 0 ? "pend" : "people");
  const [filter, setFilter] = useState<"all" | "field" | "office">("all");
  const [add, setAdd] = useState(false);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [invRole, setInvRole] = useState<Role | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  // T-436 (ALTIN-KURAL 11): Esc kapatır, odak perdede kalır, kapanınca açan düğmeye döner.
  const addRef = useRef<HTMLElement>(null);
  useModalFocus(add, addRef, { onClose: () => setAdd(false), initial: "first" });
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);
  // T-990 (ALTIN-KURAL "Form doğrulama"): davet alanlarının hatası alanın altında; kırmızı çerçeve + sarsılma + balon + ses.
  const [fieldErr, setFieldErr] = useState<{ email?: string; role?: string }>({});
  const [shake, setShake] = useState(0);
  const tenantName = useKabuk()?.tenantName ?? slug;

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [router]);
  // T-436 (ALTIN-KURAL 5): ortak balon (kendi sesini çalar; bilgi balonu sessiz).
  const flash = (m: string, tur: ToastKind = "ok"): void => balonGoster({ tur, metin: m });
  // T-986b: paylaşma satırı ve PAYLAŞ ana işleminin balonu (sarı = kilit/uyarı, kırmızı = hata).
  const say = useCallback((kind: ToastKind, m: string): void => balonGoster({ tur: kind, metin: m }), []);
  const { share, rowRef } = useJoinShare({ url: qrUrl, tenantName, isDemo, say });

  const groupOf = (id: string | null): TeamGroup | undefined => (id === null ? undefined : groups.find((g) => g.id === id));
  const labelOf = (p: TeamPerson): { text: string; color: string } => {
    const g = groupOf(p.groupId);
    if (g !== undefined) return { text: g.name, color: g.color.replace("#", "").toUpperCase() };
    return { text: t(`role.${p.role}`), color: ROLE_COLOR[p.role] ?? "6A7F91" };
  };
  const shown = people.filter((p) => filter === "all" || (filter === "field" ? p.isField : !p.isField));
  const nField = people.filter((p) => p.isField).length;
  const req = pending[0];
  const chips: Chip[] = [
    { key: "PICKER", label: t("role.PICKER"), color: ROLE_COLOR.PICKER ?? "2F7D5B", role: "PICKER", groupId: null },
    { key: "COUNTER", label: t("role.COUNTER"), color: ROLE_COLOR.COUNTER ?? "2F5DA8", role: "COUNTER", groupId: null },
    ...(canEditGroups
      ? groups.filter((g) => !g.sensitive).map((g) => ({ key: g.id, label: g.name, color: g.color.replace("#", "").toUpperCase(), role: "PICKER" as const, groupId: g.id }))
      : []),
  ];
  const chosen = req === undefined ? undefined : chips.find((c) => c.key === pick[req.id]);
  const pendDirty = view === "list" && tab === "pend" && req !== undefined && (chosen !== undefined || code !== "");
  const dirty = (view === "invite" && (email.trim() !== "" || invRole !== null) && inviteLink === null) || pendDirty;

  function errText(codeName: string, detail?: string): string {
    if (detail === "RECENT_AUTH_REQUIRED") return t("err.reauth");
    if (detail === "PLAN_LIMIT") return t("err.plan");
    if (codeName === "FORBIDDEN") return isDemo ? t("err.demo") : t("err.forbidden");
    if (codeName === "VERSION_CONFLICT") return t("err.gone");
    return t("err.server");
  }

  async function approve(): Promise<boolean> {
    if (req === undefined) return false;
    if (chosen === undefined) {
      feedback.error();
      flash(t("pickGroupFirst"), "warn");
      return false;
    }
    if (!/^\d{6}$/.test(code)) {
      feedback.error();
      setIssue(t("codeMissing"));
      return false;
    }
    setBusy(true);
    setIssue(null);
    try {
      const r = await approveJoinAction({ slug, requestId: req.id, code, roleKey: chosen.role });
      if (!r.ok) {
        feedback.error();
        setIssue(errText(r.error.code, r.error.detail));
        return false;
      }
      if (!r.data.ok) {
        feedback.error();
        setCode("");
        setIssue(r.data.issue === "CODE_WRONG" ? t("codeWrong", { n: Math.max(0, 2 - req.wrongTries) }) : t("err.gone"));
        router.refresh();
        return false;
      }
      if (chosen.groupId !== null) {
        const g = await setMemberGroupAction({ slug, memberId: r.data.membershipId, groupId: chosen.groupId });
        if (!g.ok || !g.data.ok) flash(t("groupNotSet", { group: chosen.label }), "warn");
      }
      feedback.ok();
      flash(t("approved", { name: req.name, group: chosen.label }));
      setCode("");
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function reject(): Promise<void> {
    if (req === undefined) return;
    setBusy(true);
    const r = await rejectJoinAction({ slug, requestId: req.id });
    setBusy(false);
    if (!r.ok) {
      setIssue(errText(r.error.code, r.error.detail));
      return;
    }
    feedback.error();
    flash(t("rejected", { name: req.name }));
    setCode("");
    router.refresh();
  }

  async function invite(): Promise<boolean> {
    const fe: { email?: string; role?: string } = {};
    if (email.trim() === "") fe.email = tk("vRequired");
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) fe.email = tk("vEmail");
    if (invRole === null) fe.role = tk("vRequired");
    if (fe.email !== undefined || fe.role !== undefined) {
      setFieldErr(fe);
      setShake((n) => n + 1);
      const missing = [fe.email === tk("vRequired") ? t("emailLabel") : null, fe.role !== undefined ? t("whichGroup") : null].filter((x): x is string => x !== null);
      const invalid = fe.email === tk("vEmail") ? [t("emailLabel")] : [];
      flash([missing.length > 0 ? tk("vMissing", { n: missing.length, list: missing.join(", ") }) : null, invalid.length > 0 ? tk("vInvalid", { n: invalid.length, list: invalid.join(", ") }) : null].filter((x) => x !== null).join(" · "), "err");
      window.requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(fe.email !== undefined ? '[data-testid="team-email"]' : '[data-alan="role"] button');
        el?.scrollIntoView({ block: "center" });
        el?.focus({ preventScroll: true });
      });
      return false;
    }
    setFieldErr({});
    setBusy(true);
    setIssue(null);
    try {
      const r = await inviteMemberAction({ slug, email: email.trim(), roleKey: invRole });
      if (!r.ok) {
        feedback.error();
        setIssue(errText(r.error.code, r.error.detail));
        return false;
      }
      feedback.ok();
      if (r.data.inviteLink !== undefined) {
        setInviteLink(r.data.inviteLink);
        return false;
      }
      flash(t("invited", { group: t(`role.${invRole}`) }));
      setEmail("");
      setInvRole(null);
      setView("list");
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function newQr(): Promise<void> {
    setBusy(true);
    setIssue(null);
    const r = await createJoinLinkAction({ slug });
    setBusy(false);
    if (!r.ok) {
      feedback.error();
      setIssue(errText(r.error.code, r.error.detail));
      return;
    }
    feedback.ok();
    setQrUrl(r.data.url);
    flash(t("qrReady"));
  }

  const go = (v: "list" | "invite" | "qr"): void => {
    setAdd(false);
    setIssue(null);
    setInviteLink(null);
    setView(v);
  };

  let mainLabel = t("main.add");
  let mainIcon: string | readonly string[] = EICON.plus;
  let main: () => void = () => setAdd(true);
  let mainCls = "dk big scan";
  if (view === "list" && tab === "pend" && req !== undefined) {
    const ok = chosen !== undefined;
    mainLabel = ok ? t("main.approve") : t("main.pickGroup");
    mainIcon = ok ? EICON.check : EICON.ask;
    main = () => void approve();
    mainCls = `dk big scan${ok ? "" : " wait"}`;
  }
  if (view === "invite") {
    mainLabel = t("main.invite");
    mainIcon = EICON.send;
    main = () => void invite();
    if (isDemo) {
      // Ana işlem sessiz kapanmaz (ALTIN-KURAL): demoda pasif görünür, dokununca neden + hata sesi.
      mainCls = "dk big scan wait";
      main = () => {
        say("warn", t("err.demo"));
      };
    }
  }
  if (view === "qr") {
    // T-986b: QR hazırsa (ve demoda, kilitli) ana işlem PAYLAŞ; değilse QR OLUŞTUR.
    const sharing = qrUrl !== null || isDemo;
    mainLabel = sharing ? t("main.share") : t("main.qrCreate");
    mainIcon = sharing ? [SHICON.shareA, SHICON.shareB] : EICON.renew;
    main = sharing ? share : () => void newQr();
    if (isDemo) mainCls = "dk big scan wait";
  }
  const titles = { list: [t("title"), t("sub.list")], invite: [t("inviteTitle"), t("sub.invite")], qr: [t("qrTitle"), t("sub.qr")] } as const;
  const discard = (): void => {
    setPick({});
    setCode("");
    setEmail("");
    setInvRole(null);
  };
  // T-990: tek ortak çıkış kutusu (cikis.tsx). Yarım davet / bekleyen onay varken Geri, Ana ekran, Modüller ve bağlantılar yalnız bunu açar.
  const korunan = useCikisKorumasi(dirty, {
    dark,
    title: view === "invite" ? t("cf.inviteTitle") : t("cf.pendTitle"),
    text: view === "invite" ? t("cf.inviteText") : t("cf.pendText", { name: req?.name ?? "" }),
    saveLabel: view === "invite" ? t("cf.inviteSave") : t("cf.pendSave"),
    onSave: () => (view === "invite" ? invite() : approve()),
  });
  const back = (): void => {
    korunan.sor(() => {
      discard();
      go("list");
    });
  };

  return (
    <>
    <div className={`dze${dark ? " dz-dark" : ""}`} data-testid="team">
      <div className="wrap">
        <div className="appzone">
          <div className="app">
            <header className="top">
              <span className="brand">
                <span className="alic" style={{ background: dz("6C4BD8"), width: 44, height: 44, borderRadius: 14, flex: "none" }}>
                  <svg className="ico" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="9" cy="8" r="3.5" />
                    <path d={EICON.teamA} />
                    <path d={EICON.teamB} />
                    <path d={EICON.teamC} />
                  </svg>
                </span>
                <span style={{ minWidth: 0 }}>
                  <b>{titles[view][0]}</b>
                  <small>{titles[view][1]}</small>
                </span>
              </span>
              <span className="net" style={{ position: "static", flex: "none" }} title={t("online")}>
                <i />
              </span>
              <UstDugmeler dark={dark} />
            </header>

            <main className="inner">
              {issue !== null ? (
                <div className="memo" role="alert" data-testid="team-issue">
                  <span className="mic" style={{ background: dz("C62828"), color: dz("FFFFFF") }}>
                    <Ico d={EICON.warn} size={18} />
                  </span>
                  <span>
                    {issue}
                    {issue === t("err.reauth") ? (
                      <>
                        {" "}
                        <a href={`/login?reauth=1&next=${encodeURIComponent(`${base}/team`)}`} style={{ textDecoration: "underline" }}>
                          {t("reauthLink")}
                        </a>
                      </>
                    ) : null}
                  </span>
                </div>
              ) : null}

              {view === "list" ? (
                <>
                  <div className="seg3" role="tablist">
                    <button type="button" className={`sg3${tab === "people" ? " on" : ""}`} role="tab" aria-selected={tab === "people"} onClick={() => setTab("people")} data-testid="team-tab-people">
                      <b>{people.length}</b> {t("tabPeople")}
                    </button>
                    <button
                      type="button"
                      className={`sg3${tab === "pend" ? " on" : ""}${pending.length > 0 ? " warn" : ""}`}
                      role="tab"
                      aria-selected={tab === "pend"}
                      onClick={() => setTab("pend")}
                      data-testid="team-tab-pend"
                    >
                      <b>{pending.length}</b> {t("tabPend")}
                      {pending.length > 0 ? <i className="pdot" /> : null}
                    </button>
                    <Link href={`${base}/groups`} className="sg3" style={{ textDecoration: "none" }} role="tab" data-testid="team-tab-groups">
                      <b>{groups.length}</b> {t("tabGroups")}
                    </Link>
                  </div>

                  {tab === "people" ? (
                    <>
                      <div className="filt">
                        {(
                          [
                            ["all", t("filterAll")],
                            ["field", t("filterField", { n: nField })],
                            ["office", t("filterOffice", { n: people.length - nField })],
                          ] as const
                        ).map(([id, label]) => (
                          <button key={id} type="button" className={`fc${filter === id ? " on" : ""}`} onClick={() => setFilter(id)}>
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="plist" role="list" data-testid="team-people">
                        {shown.map((p) => {
                          const l = labelOf(p);
                          return (
                            <div key={p.id} className="pr2" role="listitem">
                              <span className="av" style={{ background: dz(l.color) }}>
                                {buyukHarf(p.name.trim()[0] ?? "?", locale)}
                              </span>
                              <span className="pt">
                                <b>{p.name}</b>
                                <small>{`${buyukHarf(l.text, locale)} · ${p.isOwner ? t("owner") : p.isField ? t("field") : t("office")}`}</small>
                              </span>
                              <span className="gch" style={{ background: dz(l.color) }}>
                                {buyukHarf(l.text, locale)}
                              </span>
                            </div>
                          );
                        })}
                        <Link href={`${base}/members`} className="pmore" style={{ textDecoration: "none" }} data-testid="team-manage">
                          {t("manageMore")}
                        </Link>
                      </div>
                    </>
                  ) : null}

                  {tab === "pend" && req !== undefined ? (
                    <div className="req" data-testid="team-req">
                      <div className="rqh">
                        <span className="av" style={{ background: dz("6A7F91"), width: 52, height: 52, fontSize: 18 }}>
                          {buyukHarf(req.name.trim()[0] ?? "?", locale)}
                        </span>
                        <span className="pt" style={{ flex: 1 }}>
                          <b style={{ fontSize: 20 }}>{req.name}</b>
                          <small>{t("reqUser", { user: req.username })}</small>
                        </span>
                        <span className="rqn">{`1/${pending.length}`}</span>
                      </div>
                      <div className="dev">
                        <span className="dic2">
                          <svg className="ico" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                            <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
                            <path d={EICON.phoneDot} />
                          </svg>
                        </span>
                        <span className="pt">
                          <b>{req.deviceHint ?? t("phone")}</b>
                          <small>{t("viaQr")}</small>
                        </span>
                      </div>
                      <label className="code">
                        <span style={{ flex: 1 }}>
                          <small>{t("codeLabel")}</small>
                          <input
                            inputMode="numeric"
                            autoComplete="off"
                            maxLength={6}
                            placeholder="000000"
                            value={code}
                            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                            aria-label={t("codeLabel")}
                            data-testid="team-code"
                          />
                        </span>
                        <em>{req.wrongTries > 0 ? t("codeTries", { n: 3 - req.wrongTries }) : t("codeHint")}</em>
                      </label>
                      <div className="shd" style={{ margin: "2px 2px 0" }}>
                        <b>{t("whichGroup")}</b>
                        <span>{t("tapPick")}</span>
                      </div>
                      <div className="gpick">
                        {chips.map((c) => {
                          const on = pick[req.id] === c.key;
                          return (
                            <button
                              key={c.key}
                              type="button"
                              className={`gp${on ? " on" : ""}`}
                              style={on ? { background: dz(c.color) } : undefined}
                              onClick={() => {
                                feedback.ok();
                                setPick({ ...pick, [req.id]: c.key });
                              }}
                              data-chip={c.key}
                            >
                              {c.label}
                            </button>
                          );
                        })}
                      </div>
                      <button type="button" className="rej" onClick={() => void reject()} disabled={busy} data-testid="team-reject">
                        <Ico d={EICON.close} size={18} />
                        {t("reject")}
                      </button>
                    </div>
                  ) : null}
                  {tab === "pend" && req === undefined ? (
                    <div className="done" data-testid="team-none">
                      <span className="dring">
                        <Ico d={EICON.check} size={56} />
                      </span>
                      <b>{t("noneTitle")}</b>
                      <small>{hasLink ? t("noneSub") : t("noneNoQr")}</small>
                    </div>
                  ) : null}
                </>
              ) : null}

              {view === "invite" ? (
                <>
                  <div className="lead">
                    <b>{t("inviteLead")}</b>
                    <small>{t("inviteSub")}</small>
                  </div>
                  <label key={`e${fieldErr.email === undefined ? "" : shake}`} className={`fld${fieldErr.email === undefined ? "" : " bad"}`} data-alan="email">
                    <span>{t("emailLabel")}</span>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setFieldErr((cur) => ({ ...cur, email: undefined }));
                      }}
                      aria-label={t("emailLabel")}
                      aria-invalid={fieldErr.email === undefined ? undefined : true}
                      aria-describedby={fieldErr.email === undefined ? undefined : "team-email-err"}
                      autoComplete="off"
                      data-testid="team-email"
                    />
                  </label>
                  {fieldErr.email === undefined ? null : (
                    <small id="team-email-err" className="kerr" role="alert" data-testid="err-email">
                      {fieldErr.email}
                    </small>
                  )}
                  <div className="shd" style={{ margin: "2px 2px 0" }}>
                    <b>{t("whichGroup")}</b>
                    <span>{t("tapPick")}</span>
                  </div>
                  <div key={`r${fieldErr.role === undefined ? "" : shake}`} className={`gpick${fieldErr.role === undefined ? "" : " bad"}`} role="radiogroup" aria-label={t("whichGroup")} data-alan="role">
                    {INVITE_ROLES.map((r) => {
                      const on = invRole === r;
                      return (
                        <button
                          key={r}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          className={`gp${on ? " on" : ""}`}
                          style={on ? { background: dz(ROLE_COLOR[r] ?? "6A7F91") } : undefined}
                          onClick={() => {
                            setInvRole(r);
                            setFieldErr((cur) => ({ ...cur, role: undefined }));
                          }}
                          data-role={r}
                        >
                          {t(`role.${r}`)}
                        </button>
                      );
                    })}
                  </div>
                  {fieldErr.role === undefined ? null : (
                    <small className="kerr" role="alert" data-testid="err-role">
                      {fieldErr.role}
                    </small>
                  )}
                  {inviteLink !== null ? (
                    <div className="memo" data-testid="team-invite-link">
                      <span className="mic" style={{ background: dz("F4C542"), color: dz("1A1300") }}>
                        <Ico d={EICON.warn} size={18} />
                      </span>
                      <span>
                        {t("inviteLinkBody")}
                        <br />
                        <code style={{ wordBreak: "break-all", userSelect: "all" }}>{inviteLink}</code>
                      </span>
                    </div>
                  ) : (
                    <div className="memo">
                      <span className="mic" style={{ background: dz("E6EEF8"), color: dz("1F4A8A") }}>
                        <Ico d={[EICON.mailA, EICON.mailB]} size={18} />
                      </span>
                      <span>{t("inviteMemo")}</span>
                    </div>
                  )}
                </>
              ) : null}

              {view === "qr" ? (
                <>
                  <div className="qrcard">
                    <div className="qrhead">
                      <b>{t("qrHead")}</b>
                      <small>{t("qrHeadSub")}</small>
                    </div>
                    {qrUrl !== null ? <QrSvg value={qrUrl} label={t("qrLabel")} /> : <p style={{ margin: 0, textAlign: "center" }}>{hasLink ? t("qrHidden") : t("qrNone")}</p>}
                    <ol className="qsteps">
                      <li>
                        <i>1</i>
                        {t("qs1")}
                      </li>
                      <li>
                        <i>2</i>
                        {t("qs2")}
                      </li>
                      <li>
                        <i>3</i>
                        {t("qs3")}
                      </li>
                    </ol>
                  </div>
                  <div className="qmeta">
                    <span className="okpill">
                      <svg className="ico" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                        <path d={EICON.clockA} />
                        <circle cx="12" cy="12" r="9" />
                      </svg>
                      {t("valid7")}
                    </span>
                    <button type="button" className="qnew" onClick={() => void newQr()} disabled={busy || isDemo} data-testid="team-qr-new">
                      <Ico d={EICON.renew} size={16} />
                      {t("qrNew")}
                    </button>
                  </div>
                  <JoinShareRow url={qrUrl} tenantName={tenantName} isDemo={isDemo} say={say} dark={dark} rowRef={rowRef} />
                </>
              ) : null}
            </main>


            {add ? (
              <div className="scrim" onClick={() => setAdd(false)}>
                <section ref={addRef} className="sheet" role="dialog" aria-label={t("addTitle")} onClick={(e) => e.stopPropagation()}>
                  <div className="sh">
                    <span>
                      <b>{t("addTitle")}</b>
                      <small>{t("addSub")}</small>
                    </span>
                  </div>
                  <button type="button" className="addb" onClick={() => go("qr")} data-testid="team-add-qr">
                    <span className="kic" style={{ background: dz("2F7D5B") }}>
                      <Ico d={EICON.qr} size={28} />
                    </span>
                    <span className="kt">
                      <b>{t("addField")}</b>
                    </span>
                  </button>
                  <button type="button" className="addb" onClick={() => go("invite")} data-testid="team-add-invite">
                    <span className="kic" style={{ background: dz("2F5DA8") }}>
                      <Ico d={[EICON.mailA, EICON.mailB]} size={28} />
                    </span>
                    <span className="kt">
                      <b>{t("addOffice")}</b>
                    </span>
                  </button>
                </section>
              </div>
            ) : null}

          </div>
        </div>
      </div>
    </div>
    {korunan.kutu}
    {/* T-958: ortak alt cam çubuk (Kabuk.dc.html): Geri · Ana ekran · ekranın ana işlemi · Modüller · Etkin. */}
    <KabukBar
      dark={dark}
      back={view === "list" ? { href: base, aria: t("backHome"), testId: "team-back" } : { onClick: back, aria: t("back"), testId: "team-back" }}
      homeNav={{ href: base, aria: t("home"), testId: "team-home" }}
      main={{ label: mainLabel, d: mainIcon, onClick: main, disabled: busy, testId: "team-main", wait: mainCls.includes(" wait") }}
    />
    </>
  );
}
