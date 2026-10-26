"use client";
// T-967 (B-84, I-18): Destek.dc.html C (Destek penceresi) ve D (Gönderildi · Taleplerim) BİREBİR — `.hback` + `.msheet` (`.mh`, `.mgrid.two`
// konu çipleri, `.srch` not, `.vchip` Rehberi aç, otomatik bilgi satırı, GÖNDER) ve Taleplerim sayfası (`.top` + `.pgic`, `.tools`,
// `.rows > .rw` + açılan `.card` ekip yanıtı, `.toast`). Sınıf adları, öğe sırası, ikon yolları ve metinler kaynaktan (destek-icons.ts);
// renkler üretilmiş belirteçlerden (destek-tokens.ts). CSS `design/destek.css` (üretilmiş, kap `.dzt`) + `design/destek-frame.css`.
// Bilinçli farklar (DESIGN-PARITY, T-967): "Ekran görüntüsü ekle" çipi bu turda yok; not mikrofonu "yakında" (Etkin B-62); ekip yanıtı
// kartında "Çözüldü" düğmesi yok (müşteri talep kapatamaz; kapatma operatördedir), yalnız "Yanıtla"; kapalı talebe yanıt yazılmaz.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { dz } from "../../../design/destek-tokens.ts";
import { DICON, DTOPIC, type SupportSubjectKind } from "../../../design/destek-icons.ts";
import { PICON } from "../../../design/pano-icons.ts";
import { SICON } from "../../../design/standart-icons.ts";
import { newSupportCode, ticketNo, whenOf } from "../../../support-format.ts";
import {  } from "../kabuk/kabuk-bar.tsx";
import { listMySupportTicketsAction, markSupportSeenAction, replySupportTicketAction, submitSupportTicketAction, type SupportTicketView } from "../support-actions.ts";
import { balonGoster, feedback } from "@wms/ui";
import { JOURNEY_OPEN_EVENT } from "../yolculuk/steps.ts";

const SUBJECTS: readonly SupportSubjectKind[] = ["BUG", "HOWTO", "IDEA", "OTHER"];
const BODY_MAX = 2000;
const GUIDE_EVENT = "etkinwms:guide-open";
const ST: Record<SupportTicketView["status"], CSSProperties> = {
  OPEN: { background: dz("E56A00"), color: dz("FFFFFF") },
  ANSWERED: { background: dz("0E7C7B"), color: dz("FFFFFF") },
  CLOSED: { background: dz("E3F1E9"), color: dz("17583C") },
};

function Ico({ d, size, className = "ico" }: { d: string | readonly string[]; size: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {(typeof d === "string" ? [d] : d).map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}

/** Kaynaktaki kulaklık ikonu (`cup`: üst çubukta dolgu sınıfı). */
export function HelpIco({ size, cup = false, mic = true }: { size: number; cup?: boolean; mic?: boolean }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={DICON.helpBand} />
      <path className={cup ? "cup" : undefined} d={DICON.helpCups} />
      {mic ? <path d={DICON.helpMic} /> : null}
    </svg>
  );
}

export function IssueIco({ size }: { size: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {/* T-1042 (STANDART.md §1): Sorun bildir her üst çubukta bayrak. */}
      <path d={SICON.flag} />
    </svg>
  );
}

function MicIco({ size }: { size: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d={DICON.micB} />
    </svg>
  );
}

export interface SupportState {
  readonly tickets: readonly SupportTicketView[] | null;
  readonly unread: number;
  /** Yeniden yükler; talep sayısını döndürür (okunamazsa `null`). */
  readonly reload: () => Promise<number | null>;
  readonly markSeen: () => void;
}

/** Taleplerim + okunmamış ekip yanıtı sayısı (açılışta bir kez; gönderim/yanıt sonrası yeniden). `auto: false` = açılışta yükleme yok
 *  (kalıp ekranları: her ekran açılışında sunucu eylemi çağrılmaz, işlem hız sınırı bütçesi harcanmaz; Destek'e dokununca yüklenir). */
export function useSupport(slug: string, auto = true): SupportState {
  const [tickets, setTickets] = useState<readonly SupportTicketView[] | null>(null);
  const [unread, setUnread] = useState(0);
  const reload = useCallback(async () => {
    try {
      const r = await listMySupportTicketsAction({ slug });
      if (r.ok) {
        setTickets(r.data.tickets);
        setUnread(r.data.unread);
        return r.data.tickets.length;
      }
    } catch {
      /* bağlantı yok: rozet çizilmez, pencere yine açılır */
    }
    return null;
  }, [slug]);
  useEffect(() => {
    if (auto) void reload();
  }, [reload, auto]);
  const markSeen = useCallback(() => {
    setUnread(0);
    void markSupportSeenAction({ slug }).catch(() => undefined);
  }, [slug]);
  return { tickets, unread, reload, markSeen };
}

export interface SupportToast {
  readonly kind: "ok" | "err";
  readonly text: string;
}

/** T-436 (ALTIN-KURAL 5): ortak balon (kök düzendeki tek katman; kendi sesini çalar). */
function useToast(): [null, (t: SupportToast) => void] {
  const say = useCallback((t: SupportToast) => balonGoster({ tur: t.kind, metin: t.text }), []);
  return [null, say];
}

/** Odak tuzağı: Tab pencere içinde döner. */
function trapTab(e: KeyboardEvent<HTMLElement>, root: HTMLElement | null): void {
  if (e.key !== "Tab" || root === null) return;
  const f = [...root.querySelectorAll<HTMLElement>("button:not([disabled]), input, textarea, [tabindex='0']")];
  if (f.length === 0) return;
  const first = f[0]!;
  const last = f[f.length - 1]!;
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/** C · Destek penceresi. */
export function SupportSheet({ slug, dark, appVersion, onClose, onSent }: { slug: string; dark: boolean; appVersion: string | null; onClose: () => void; onSent: (code: string) => void }) {
  const t = useTranslations("destek");
  const [topic, setTopic] = useState<SupportSubjectKind | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code] = useState(() => newSupportCode(slug));
  const [route, setRoute] = useState<string | null>(null);
  const [, say] = useToast();
  const sheet = useRef<HTMLElement>(null);

  useEffect(() => {
    setRoute(window.location.pathname);
    sheet.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const body = note.trim();
  const ready = topic !== null && body !== "" && !busy;
  const send = async (): Promise<void> => {
    if (topic === null || body === "") return;
    setBusy(true);
    setError(null);
    try {
      const r = await submitSupportTicketAction({ slug, subjectKind: topic, body, context: { route, appVersion, supportCode: code } });
      if (r.ok) {
        feedback.ok();
        onSent(code);
        return;
      }
      feedback.error();
      setError(r.error.code === "RATE_LIMITED" ? t("rateLimited") : t("failed"));
    } catch {
      feedback.error();
      setError(t("failed"));
    }
    setBusy(false);
  };

  return (
    <div className={`dzt${dark ? " dz-dark" : ""}`} data-testid="support-layer">
      <div className="wrap">
        <div className="app">
          <button type="button" className="hback" aria-label={t("backdrop")} tabIndex={-1} onClick={onClose} />
          <section ref={sheet} className="msheet" role="dialog" aria-modal="true" aria-label={t("title")} tabIndex={-1} onKeyDown={(e) => trapTab(e, sheet.current)} data-testid="support-sheet">
            <div className="mh">
              <span className="gi" style={{ background: dz("0E7C7B"), color: dz("FFFFFF") }}>
                <HelpIco size={20} />
              </span>
              <span style={{ minWidth: 0 }}>
                <b>{t("title")}</b>
                <small>{t("sub")}</small>
              </span>
              <button type="button" className="x" aria-label={t("close")} onClick={onClose} data-testid="support-close">
                <Ico d={DICON.close} size={20} />
              </button>
            </div>
            <div className="mgrid two" role="radiogroup" aria-label={t("topic")} style={{ gridTemplateRows: "repeat(2, 60px)" }}>
              {SUBJECTS.map((k, i) => {
                const on = topic === k;
                return (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    className={`mt${on ? " on" : ""}`}
                    aria-checked={on}
                    style={{ animationDelay: `${i * 18}ms` }}
                    onClick={() => {
                      feedback.minor();
                      setTopic(k);
                    }}
                    data-topic={k}
                  >
                    <span className="mi" style={{ background: dz(DTOPIC[k].color) }}>
                      <Ico d={DTOPIC[k].d} size={22} />
                    </span>
                    <span className="mtx">
                      <b>{t(`topics.${k}.name`)}</b>
                      <small>{t(`topics.${k}.sub`)}</small>
                    </span>
                  </button>
                );
              })}
            </div>
            <label className="srch">
              <Ico d={[DICON.pen, DICON.penTip]} size={20} />
              <span className="sr">{t("note")}</span>
              <input type="text" placeholder={t("notePh")} value={note} maxLength={BODY_MAX} onChange={(e) => setNote(e.target.value)} data-testid="support-note" />
              <button
                type="button"
                className="smic"
                aria-label={t("sayNote")}
                aria-disabled="true"
                onClick={() => {
                  feedback.minor();
                  say({ kind: "err", text: t("voiceSoon") });
                }}
              >
                <MicIco size={20} />
              </button>
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button
                type="button"
                className="vchip"
                onClick={() => {
                  feedback.minor();
                  onClose();
                  // T-1006: hesap sahibi / yöneticide "Rehberi aç" kurulum yolculuğunu açar (dinleyen olayı iptal eder); diğerlerinde eski rehber.
                  const handled = !window.dispatchEvent(new Event(JOURNEY_OPEN_EVENT, { cancelable: true }));
                  if (!handled) window.dispatchEvent(new Event(GUIDE_EVENT));
                }}
                data-testid="support-guide"
              >
                <i>
                  <svg className="ico" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="9.5" />
                    <path d={DICON.guideQ} />
                    <path d={DICON.guideDot} />
                  </svg>
                </i>
                {t("guide")}
              </button>
            </div>
            <p className="vhint mono" style={{ margin: 0, textAlign: "left", fontSize: 10, color: dz("9FB2C2") }} data-testid="support-auto">
              {t("auto", { route: route ?? t("unknown"), version: appVersion ?? t("unknown"), code })}
            </p>
            {error === null ? null : (
              <p role="alert" className="vhint" style={{ margin: 0, textAlign: "left", color: dz("F4C542") }}>
                {error}
              </p>
            )}
            <button
              type="button"
              className="btn go"
              style={{ width: "100%", minHeight: 64, fontSize: 18, background: dz("0E7C7B"), boxShadow: `0 10px 22px -10px ${dz("14,124,123,.8")}` }}
              onClick={() => void send()}
              disabled={!ready}
              data-testid="support-send"
            >
              <Ico d={DICON.send} size={24} />
              {t("send")}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

/** D · Taleplerim (Gönderildi bildirimi ve ekip yanıtı). */
export function SupportList({
  slug,
  dark,
  state,
  sentCode,
  canReport,
  team,
  onIssue,
  onNew,
  onTeam,
  onClose,
}: {
  slug: string;
  dark: boolean;
  state: SupportState;
  /** Yeni gönderilen talebin destek kodu (kaynak "Gönderildi · DMO-7K2Q"). */
  sentCode: string | null;
  canReport: boolean;
  team: boolean;
  onIssue: () => void;
  onNew: () => void;
  onTeam: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("destek");
  const tp = useTranslations("pano");
  const tickets = state.tickets ?? [];
  const [open, setOpen] = useState<string | null>(() => tickets.find((k) => k.unreadReply)?.id ?? null);
  const [writing, setWriting] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [, say] = useToast();
  const [now, setNow] = useState(() => new Date());
  const { markSeen, unread } = state;

  useEffect(() => {
    setNow(new Date());
    if (unread > 0) markSeen();
  }, [unread, markSeen]);
  useEffect(() => {
    if (sentCode !== null) say({ kind: "ok", text: t("sent", { code: sentCode }) });
  }, [sentCode, say, t]);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const when = (iso: string): string => {
    const w = whenOf(new Date(iso), now);
    return w.kind === "now" ? t("now") : w.kind === "today" ? t("today", { time: w.time }) : w.kind === "yesterday" ? t("yesterday", { time: w.time }) : w.date;
  };
  const toggle = (id: string): void => {
    feedback.minor();
    setOpen((o) => (o === id ? null : id));
    setWriting(null);
    setReply("");
  };
  const sendReply = async (id: string): Promise<void> => {
    const body = reply.trim();
    if (body === "") return;
    setBusy(true);
    try {
      const r = await replySupportTicketAction({ slug, ticketId: id, body });
      if (r.ok) {
        feedback.ok();
        say({ kind: "ok", text: t("replySent") });
        setWriting(null);
        setReply("");
        await state.reload();
      } else {
        feedback.error();
        say({ kind: "err", text: r.error.code === "VERSION_CONFLICT" ? t("closedNote") : r.error.code === "RATE_LIMITED" ? t("rateLimited") : t("failed") });
      }
    } catch {
      feedback.error();
      say({ kind: "err", text: t("failed") });
    }
    setBusy(false);
  };

  return (
    <div className={`dzt${dark ? " dz-dark" : ""}`} data-testid="support-layer">
      <div className="wrap">
        <div className="app pg" role="dialog" aria-label={t("listTitle")} data-testid="support-list">
          <header className="top">
            <div className="brand">
              <span className="pgic" style={{ background: dz("0E7C7B") }}>
                <HelpIco size={22} />
              </span>
              <span style={{ minWidth: 0 }}>
                <b>{t("listTitle")}</b>
                <small>{t("listSub", { n: tickets.length })}</small>
              </span>
            </div>
            <nav className="tools" aria-label={tp("tools")}>
              {canReport ? (
                <button type="button" className="tb tb-issue" aria-label={t("issue")} title={t("issueTitle")} onClick={onIssue}>
                  <IssueIco size={24} />
                </button>
              ) : null}
              <button type="button" className="tb tb-help on" aria-label={t("helpNew")} title={t("helpTitle")} onClick={onNew}>
                <HelpIco size={24} cup />
              </button>
              <button type="button" className="tb tb-team" style={{ "--i": dz("6C4BD8") } as CSSProperties} aria-label={team ? tp("teamAria") : tp("accountAria")} onClick={onTeam}>
                <svg className="ico" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                  {team ? (
                    <path d={PICON.team} />
                  ) : (
                    <>
                      <circle cx="12" cy="8" r="3.5" />
                      <path d={DICON.person} />
                    </>
                  )}
                </svg>
              </button>
            </nav>
          </header>
          <main className="inner">
            <div className="rows">
              {tickets.length === 0 ? (
                <p className="vhint" style={{ margin: 0, color: dz("4E6476") }}>
                  {state.tickets === null ? t("loadFailed") : t("empty")}
                </p>
              ) : null}
              {tickets.map((k) => {
                const isOpen = open === k.id;
                const last = k.messages[k.messages.length - 1];
                const fromTeam = last !== undefined && last.authorKind === "OPERATOR";
                return (
                  <div key={k.id} style={{ display: "contents" }}>
                    <div
                      className="rw"
                      role="button"
                      tabIndex={0}
                      aria-expanded={isOpen}
                      onClick={() => toggle(k.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggle(k.id);
                        }
                      }}
                      data-ticket={k.id}
                    >
                      <span className="ic" style={{ background: dz(DTOPIC[k.subjectKind].color) }}>
                        <Ico d={DTOPIC[k.subjectKind].d} size={22} />
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <b>{k.body.split("\n")[0]}</b>
                        <small>{`${ticketNo(k.number)} · ${when(k.createdAt)}`}</small>
                      </span>
                      <span className="pill" style={ST[k.status]}>
                        {t(`st.${k.status}`)}
                      </span>
                    </div>
                    {isOpen ? (
                      <section className="card" aria-label={t("replyAria")} style={{ animation: "none" }}>
                        <div className="ch">
                          <span className="ok">
                            <HelpIco size={22} mic={false} />
                          </span>
                          <span style={{ minWidth: 0 }}>
                            <b>{fromTeam ? t("team") : t("you")}</b>
                            <small>{fromTeam ? t("replied", { when: when(last.createdAt) }) : t("delivered", { when: when(last?.createdAt ?? k.createdAt) })}</small>
                          </span>
                        </div>
                        <p className="quote">{last?.body ?? k.body}</p>
                        {k.status === "CLOSED" ? null : writing === k.id ? (
                          <>
                            <label className="srch">
                              <Ico d={[DICON.pen, DICON.penTip]} size={20} />
                              <span className="sr">{t("reply")}</span>
                              <input type="text" placeholder={t("replyPh")} value={reply} maxLength={BODY_MAX} onChange={(e) => setReply(e.target.value)} autoFocus data-testid="support-reply-text" />
                            </label>
                            <div className="acts" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
                              <button type="button" className="btn go" onClick={() => void sendReply(k.id)} disabled={busy || reply.trim() === ""} data-testid="support-reply-send">
                                <Ico d={DICON.send} size={22} />
                                {t("replySend")}
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="acts" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
                            <button
                              type="button"
                              className="btn fix"
                              onClick={() => {
                                feedback.minor();
                                setWriting(k.id);
                              }}
                              data-testid="support-reply"
                            >
                              <Ico d={DICON.reply} size={20} />
                              {t("reply")}
                            </button>
                          </div>
                        )}
                        <span className="say">
                          <i>
                            <Ico d={DICON.speaker} size={14} />
                          </i>
                          {t("ring")}
                        </span>
                      </section>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
