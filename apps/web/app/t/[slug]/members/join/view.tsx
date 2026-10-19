"use client";
// T-429 (Ekip.dc.html "Onay bekliyor" + katılma QR'ı; kabuk Giris.dc.html `v.mgr` bandı + `v.dev` ile aynı sınıflar): solda bekleyen katılma
// talepleri (`.shd` + `.rows`; satırda ONAYLA / REDDET), sağda katılma QR'ı kartı (`.kcard`: 7 gün, yenile / kapat) + "Onaysız kimse giremez"
// bandı. Onay: kişinin telefonunda görünen 6 haneli kodu yaz + rol (Toplayıcı / Sayımcı). QR adresi yalnız bu bileşenin belleğinde (yenile
// basılınca üretilir; eskisi o anda geçersiz). Bekleyen talepler 5 sn'de bir yenilenir.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { create as createQr } from "qrcode";
import { DzRoot, useDz } from "../../../../design/dz-root.tsx";
import { C, dz } from "../../../../design/giris-tokens.ts";
import { GICON } from "../../../../design/giris-icons.ts";
import { approveJoinAction, createJoinLinkAction, rejectJoinAction, revokeJoinLinkAction } from "../actions.ts";

export interface JoinPending {
  readonly id: string;
  readonly name: string;
  readonly username: string;
  readonly deviceHint: string | null;
  readonly createdAt: string;
  readonly wrongTries: number;
}

function Ico({ d, size, sw, style }: { d: string; size: number; sw?: number; style?: CSSProperties }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={sw === undefined ? style : { strokeWidth: sw, ...style }}>
      <path d={d} />
    </svg>
  );
}

function Qr({ value, label }: { value: string; label: string }) {
  const qr = useMemo(() => {
    try {
      const m = createQr(value, { errorCorrectionLevel: "M" }).modules;
      const cells: { x: number; y: number }[] = [];
      for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (m.get(y, x)) cells.push({ x, y });
      return { size: m.size, cells };
    } catch {
      return null;
    }
  }, [value]);
  if (qr === null) return null;
  return (
    <div className="qr qrbig" role="img" aria-label={label} data-testid="join-qr">
      <svg viewBox={`0 0 ${qr.size} ${qr.size}`} aria-hidden="true" shapeRendering="crispEdges">
        {qr.cells.map((q) => (
          <rect key={`${q.x}-${q.y}`} x={q.x} y={q.y} width="1" height="1" fill={dz("172E42")} />
        ))}
      </svg>
    </div>
  );
}

type Err = { readonly text: string; readonly reauth: boolean } | null;

function View({ slug, tenantName, isDemo, link, pending }: { slug: string; tenantName: string; isDemo: boolean; link: { readonly expiresAt: string } | null; pending: readonly JoinPending[] }) {
  const t = useTranslations("teamJoin");
  const format = useFormatter();
  const { toggleTheme } = useDz();
  const router = useRouter();
  const [url, setUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(link?.expiresAt ?? null);
  const [open, setOpen] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [role, setRole] = useState<"PICKER" | "COUNTER">("PICKER");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Err>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const returnTo = `/t/${slug}/members/join`;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
      router.refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [router]);

  const fail = (detail: string | undefined, code_?: string): Err =>
    detail === "RECENT_AUTH_REQUIRED"
      ? { text: t("errReauth"), reauth: true }
      : detail === "DEMO"
        ? { text: t("errDemo"), reauth: false }
        : detail === "PLAN_LIMIT"
          ? { text: t("errPlan"), reauth: false }
          : code_ === "VERSION_CONFLICT"
            ? { text: t("errGone"), reauth: false }
            : { text: t("errServer"), reauth: false };

  async function newLink(): Promise<void> {
    setBusy(true);
    setErr(null);
    const r = await createJoinLinkAction({ slug });
    setBusy(false);
    if (!r.ok) {
      setErr(fail(r.error.detail, r.error.code));
      return;
    }
    setUrl(r.data.url);
    setExpiresAt(r.data.expiresAt);
  }

  async function closeLink(): Promise<void> {
    setBusy(true);
    const r = await revokeJoinLinkAction({ slug });
    setBusy(false);
    if (!r.ok) {
      setErr(fail(r.error.detail, r.error.code));
      return;
    }
    setUrl(null);
    setExpiresAt(null);
    setNotice(t("linkClosed"));
  }

  async function approve(id: string): Promise<void> {
    setBusy(true);
    setErr(null);
    const r = await approveJoinAction({ slug, requestId: id, code, roleKey: role });
    setBusy(false);
    if (!r.ok) {
      setErr(fail(r.error.detail, r.error.code));
      return;
    }
    if (!r.data.ok) {
      setErr({ text: r.data.issue === "CODE_WRONG" ? t("errCode") : t("errGone"), reauth: false });
      setCode("");
      router.refresh();
      return;
    }
    setOpen(null);
    setCode("");
    setNotice(t("approved", { username: r.data.username }));
    router.refresh();
  }

  async function reject(id: string): Promise<void> {
    setBusy(true);
    const r = await rejectJoinAction({ slug, requestId: id });
    setBusy(false);
    if (!r.ok) {
      setErr(fail(r.error.detail, r.error.code));
      return;
    }
    setOpen(null);
    setNotice(t("rejected"));
    router.refresh();
  }

  const errLine =
    err !== null ? (
      <span className="hint bad" role="alert">
        <Ico d={GICON.warn} size={16} />
        {err.text}
        {err.reauth ? (
          <a href={`/login?reauth=1&next=${encodeURIComponent(returnTo)}`} style={{ textDecoration: "underline", marginLeft: "6px" }}>
            {t("reauthLink")}
          </a>
        ) : null}
      </span>
    ) : null;

  return (
    <div className="mp" style={{ background: C.bg, color: C.fg }}>
      <div className="band" style={{ background: dz("172E42") }}>
        <a className="wb" href={`/t/${slug}/members`} aria-label={t("back")}>
          <Ico d={GICON.back} size={26} sw={3} />
        </a>
        <div className="band-t">
          <b className="band-h">{t("bandH")}</b>
          <span className="band-s">{t("bandS", { tenant: tenantName.toLocaleUpperCase("tr-TR") })}</span>
        </div>
        <button type="button" className="wb" onClick={toggleTheme} aria-label={t("theme")}>
          <Ico d={GICON.theme} size={22} />
        </button>
      </div>
      <div className="lscroll wide">
        <div className="lin">
          <div className="mgrid">
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div className="shd">
                <b>{t("listTitle")}</b>
                <span>{t("listCount", { n: pending.length })}</span>
              </div>
              {notice !== null ? (
                <span className="hint ok" role="status">
                  <Ico d={GICON.check} size={16} />
                  {notice}
                </span>
              ) : null}
              {open === null ? errLine : null}
              {pending.length === 0 ? (
                <p className="ls" style={{ margin: 0 }} data-testid="join-empty">
                  {t("empty")}
                </p>
              ) : null}
              <div className="rows">
                {pending.map((p) => {
                  const when = format.relativeTime(new Date(p.createdAt), now).toLocaleUpperCase("tr-TR");
                  const isOpen = open === p.id;
                  return (
                    <div key={p.id} className="row" style={{ background: C.surface, cursor: "default", flexWrap: "wrap" }} data-testid="join-row">
                      <span className="av" style={{ background: C.chip, color: C.fg }}>
                        <Ico d={GICON.phone} size={24} />
                      </span>
                      <span className="rt">
                        <b>{p.name}</b>
                        <span>{`@${p.username} · ${p.deviceHint ?? t("phone")} · ${when}`}</span>
                      </span>
                      {!isOpen ? (
                        <div className="rbtns">
                          <button type="button" className="sbtn" style={{ background: C.chip, color: C.fg }} onClick={() => void reject(p.id)} disabled={busy || isDemo} aria-label={t("rejectAria", { name: p.name })}>
                            <Ico d={GICON.close} size={20} sw={2.8} />
                            <span className="tx">{t("reject")}</span>
                          </button>
                          <button
                            type="button"
                            className="sbtn"
                            style={{ background: dz("17804F"), color: dz("FFFFFF") }}
                            onClick={() => {
                              setOpen(p.id);
                              setCode("");
                              setErr(null);
                            }}
                            disabled={busy || isDemo}
                            aria-label={t("approveAria", { name: p.name })}
                            data-testid="join-open"
                          >
                            <Ico d={GICON.check} size={20} sw={2.8} />
                            <span className="tx">{t("approve")}</span>
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%" }}>
                          <div className="fl" style={{ width: "100%", textAlign: "left" }}>
                            <label htmlFor={`jc-${p.id}`}>{t("codeLabel")}</label>
                            <div className="inp" style={{ background: C.chip }}>
                              <input
                                id={`jc-${p.id}`}
                                type="text"
                                inputMode="numeric"
                                autoComplete="off"
                                maxLength={6}
                                placeholder="000000"
                                value={code}
                                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                                style={{ fontFamily: "var(--font-plex-mono), monospace", fontSize: "22px", letterSpacing: ".3em", textAlign: "center" }}
                                data-testid="join-code-input"
                              />
                            </div>
                            <span className="hint">{p.wrongTries > 0 ? t("codeTries", { n: 3 - p.wrongTries }) : t("codeHint")}</span>
                          </div>
                          <div className="rbtns" role="radiogroup" aria-label={t("roleLabel")}>
                            {(["PICKER", "COUNTER"] as const).map((r) => (
                              <button
                                key={r}
                                type="button"
                                role="radio"
                                aria-checked={role === r}
                                className="sbtn"
                                style={role === r ? { background: dz("172E42"), color: dz("FFFFFF") } : { background: C.chip, color: C.fg }}
                                onClick={() => setRole(r)}
                                data-role={r}
                              >
                                <Ico d={r === "PICKER" ? GICON.cikis : GICON.sayim} size={20} />
                                <span className="tx">{t(`role.${r}`)}</span>
                              </button>
                            ))}
                          </div>
                          {errLine}
                          <div className="act" style={{ position: "static", padding: 0, boxShadow: "none", width: "100%" }}>
                            <button type="button" className="big ghost" style={{ background: C.chip, color: C.fg }} onClick={() => setOpen(null)} disabled={busy}>
                              {t("cancel")}
                            </button>
                            <button
                              type="button"
                              className="big"
                              style={{ background: dz("17804F"), color: dz("FFFFFF") }}
                              onClick={() => void approve(p.id)}
                              disabled={busy || code.length !== 6}
                              data-testid="join-approve"
                            >
                              <Ico d={GICON.check} size={24} sw={3} />
                              {t("approve")}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div className="kcard" style={{ background: C.surface }}>
                <span className="kick">{t("qrKick")}</span>
                {url !== null ? <Qr value={url} label={t("qrLabel")} /> : null}
                {expiresAt !== null ? (
                  <span className="timer" data-testid="join-expires">
                    {t("validUntil", { when: format.dateTime(new Date(expiresAt), { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) })}
                  </span>
                ) : null}
                <p className="ls" style={{ margin: 0 }}>
                  {isDemo ? t("demoBody") : url !== null ? t("qrBody") : expiresAt !== null ? t("qrHidden") : t("qrNone")}
                </p>
                {open === null && url === null ? errLine : null}
                {!isDemo ? (
                  <div className="act" style={{ position: "static", padding: 0, boxShadow: "none", width: "100%" }}>
                    {expiresAt !== null ? (
                      <button type="button" className="big ghost" style={{ background: C.chip, color: C.fg }} onClick={() => void closeLink()} disabled={busy} data-testid="join-close">
                        {t("close")}
                      </button>
                    ) : null}
                    <button type="button" className="big" style={{ background: dz("172E42"), color: dz("FFFFFF") }} onClick={() => void newLink()} disabled={busy} data-testid="join-new">
                      <Ico d={GICON.renew} size={22} sw={2.6} />
                      {expiresAt !== null ? t("renew") : t("create")}
                    </button>
                  </div>
                ) : null}
                {url !== null ? (
                  <button type="button" className="big ghost" style={{ background: C.chip, color: C.fg, width: "100%" }} onClick={() => window.print()}>
                    <Ico d={GICON.print} size={22} />
                    {t("print")}
                  </button>
                ) : null}
              </div>
              <div className="ban" style={{ background: C.chip }}>
                <Ico d={GICON.lock} size={22} />
                <span>
                  <b>{t("banTitle")}</b>
                  {t("banBody")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function JoinView({
  dark,
  slug,
  tenantName,
  isDemo,
  link,
  pending,
}: {
  dark: boolean;
  slug: string;
  tenantName: string;
  isDemo: boolean;
  link: { readonly expiresAt: string } | null;
  pending: readonly JoinPending[];
}) {
  return (
    <DzRoot dark={dark} scope="dzg" testId="team-join">
      <View slug={slug} tenantName={tenantName} isDemo={isDemo} link={link} pending={pending} />
    </DzRoot>
  );
}
