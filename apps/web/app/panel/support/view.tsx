"use client";
// T-967 (B-84, I-18): YonetDestek.dc.html — E (gelen kutusu: arama + durum sekmeleri, `.tbl`, `.unr` okunmamış noktası, bilgi bandı),
// F (talep detayı: mesaj kartı, YANIT `.ta` + Kapat / Yanıtı gönder, OTOMATİK BİLGİLER `.kv`, DESTEK ERİŞİMİ, GEÇMİŞ `.tl`), G (müşteri
// detayındaki Destek sekmesi tablosu) ve Ayarlar · bildirim kartı. Yonet görsel dili ve panel bileşenleri; CSS `design/yonet.css` +
// `design/yonet-destek.css` (kap `.dzyd`). Değerler gerçek veridir (sunucuda biçimlenir).
// Bilinçli farklar (DESIGN-PARITY, T-967): "Erişim iste" pasif (destek erişimi akışı yok); ekran görüntüsü yer tutucusu yok (bu turda
// ekran görüntüsü alınmaz); KULLANICI · ROL sütununda rol yok (talepte rol tutulmaz) — yerine mesaj sayısı; "Panel rozeti" salt durum.
import { useActionState, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { C, dz } from "../../design/yonet-tokens.ts";
import { dz as dzd } from "../../design/yonet-destek-tokens.ts";
import { YICON } from "../../design/yonet-icons.ts";
import { YDICON, YDTOPIC } from "../../design/yonet-destek-icons.ts";
import type { SupportActionState } from "./actions.ts";

export type SupportStatusKey = "OPEN" | "ANSWERED" | "CLOSED";
export type SupportTopicKey = keyof typeof YDTOPIC;

/** Satır (sunucuda biçimlenmiş metinler). */
export interface SupportRowItem {
  readonly id: string;
  readonly no: string;
  readonly cust: string;
  readonly user: string;
  readonly sub: string;
  readonly topic: SupportTopicKey;
  readonly msg: string;
  readonly when: string;
  readonly status: SupportStatusKey;
  readonly unread: boolean;
}

export interface SupportLabels {
  readonly searchPh: string;
  readonly searchAria: string;
  readonly filterAria: string;
  readonly fAll: string;
  readonly fOpen: string;
  readonly fAnswered: string;
  readonly fClosed: string;
  readonly thCust: string;
  readonly thUser: string;
  readonly thTopic: string;
  readonly thMsg: string;
  readonly thWhen: string;
  readonly thStatus: string;
  readonly unread: string;
  readonly empty: string;
  readonly banH: string;
  readonly banT: string;
  readonly topics: Readonly<Record<SupportTopicKey, string>>;
  readonly st: Readonly<Record<SupportStatusKey, string>>;
}

export function statusStyle(s: SupportStatusKey): { bg: string; fg: string } {
  if (s === "OPEN") return { bg: dzd("E56A00"), fg: dz("FFFFFF") };
  if (s === "ANSWERED") return { bg: C["ok-bg"], fg: C["ok-fg"] };
  return { bg: C.chip, fg: C.fg };
}

function Ico({ d, size, sw, style }: { d: string; size: number; sw?: number; style?: CSSProperties }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={sw === undefined ? style : { ...style, strokeWidth: sw }}>
      <path d={d} />
    </svg>
  );
}

/** Ek kaynak kabı (`.dzyd`): okunmamış noktası ve konu renkleri; düzen akışını değiştirmez. */
export function DestekScope({ children }: { children: ReactNode }) {
  return (
    <div className="dzyd" style={{ display: "contents" }}>
      {children}
    </div>
  );
}

export function TopicChip({ topic, label }: { topic: SupportTopicKey; label: string }) {
  return (
    <span className="chip" style={{ background: C.chip }}>
      <Ico d={YDTOPIC[topic].d} size={14} style={{ color: dzd(YDTOPIC[topic].color) }} />
      {label}
    </span>
  );
}

/** E ve G tablosu. `withCustomer`: gelen kutusunda MÜŞTERİ sütunu (G'de yok, numara kullanıcı satırına iner). */
export function SupportTable({ rows, labels: t, withCustomer }: { rows: readonly SupportRowItem[]; labels: SupportLabels; withCustomer: boolean }) {
  const router = useRouter();
  const go = (id: string): void => router.push(`/support?t=${encodeURIComponent(id)}`);
  return (
    <div className="tbox">
      <table className="tbl">
        <thead>
          <tr>
            {withCustomer ? <th>{t.thCust}</th> : null}
            <th>{t.thUser}</th>
            <th>{t.thTopic}</th>
            <th>{t.thMsg}</th>
            <th>{t.thWhen}</th>
            <th>{t.thStatus}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const st = statusStyle(r.status);
            const dot = r.unread ? <span className="unr" aria-label={t.unread} /> : null;
            return (
              <tr
                key={r.id}
                className="rowlink"
                onClick={() => go(r.id)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") go(r.id);
                }}
                data-ticket={r.id}
              >
                {withCustomer ? (
                  <td>
                    <span className="tname">
                      <b>
                        {dot}
                        {r.cust}
                      </b>
                      <span>{r.no}</span>
                    </span>
                  </td>
                ) : null}
                <td>
                  <span className="tname">
                    <b style={{ font: "700 14.5px/1.2 var(--font-instrument), sans-serif" }}>
                      {withCustomer ? null : dot}
                      {r.user}
                    </b>
                    <span>{withCustomer ? r.sub : `${r.sub} · ${r.no}`}</span>
                  </span>
                </td>
                <td>
                  <TopicChip topic={r.topic} label={t.topics[r.topic]} />
                </td>
                <td style={{ maxWidth: withCustomer ? 360 : 420 }}>{r.msg}</td>
                <td className="mono" style={{ fontSize: 13, whiteSpace: "nowrap" }}>
                  {r.when}
                </td>
                <td>
                  <span className="chip" style={{ background: st.bg, color: st.fg }}>
                    {t.st[r.status]}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export type InboxFilter = "ALL" | SupportStatusKey;

/** E · Destek gelen kutusu. */
export function SupportInbox({ rows, filter, q: q0, labels: t, settings }: { rows: readonly SupportRowItem[]; filter: InboxFilter; q: string; labels: SupportLabels; settings: ReactNode }) {
  const router = useRouter();
  const [q, setQ] = useState(q0);
  const cnt = (s: SupportStatusKey): number => rows.filter((r) => r.status === s).length;
  const ql = q.toLocaleLowerCase("tr").trim();
  const shown = rows.filter((r) => (filter === "ALL" || r.status === filter) && (ql === "" || `${r.cust} ${r.user} ${r.no} ${r.msg}`.toLocaleLowerCase("tr").includes(ql)));
  const filters: ReadonlyArray<[InboxFilter, string]> = [
    ["ALL", `${t.fAll} · ${rows.length}`],
    ["OPEN", `${t.fOpen} · ${cnt("OPEN")}`],
    ["ANSWERED", `${t.fAnswered} · ${cnt("ANSWERED")}`],
    ["CLOSED", `${t.fClosed} · ${cnt("CLOSED")}`],
  ];
  return (
    <DestekScope>
      <div className="toolbar">
        <div className="search" style={{ background: C.surface }}>
          <Ico d={YICON.search} size={20} style={{ opacity: 0.6 }} />
          <input type="search" placeholder={t.searchPh} aria-label={t.searchAria} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="seg" role="tablist" aria-label={t.filterAria} style={{ background: C.chip }}>
          {filters.map(([k, l]) => {
            const on = k === filter;
            return (
              <button key={k} type="button" role="tab" className={`segb${on ? " on" : ""}`} aria-selected={on} style={{ background: on ? C.surface : "transparent" }} onClick={() => router.push(k === "ALL" ? "/support" : `/support?s=${k}`)}>
                {l}
              </button>
            );
          })}
        </div>
      </div>
      <div className="card" style={{ background: C.surface, paddingTop: 8 }}>
        <SupportTable rows={shown} labels={t} withCustomer />
        {shown.length === 0 ? <div className="empty">{t.empty}</div> : null}
      </div>
      <div className="ban" style={{ background: C.chip }}>
        <Ico d={YDICON.bell} size={22} />
        <span>
          <b>{t.banH}</b>
          {t.banT}
        </span>
      </div>
      {settings}
    </DestekScope>
  );
}

export interface NotifyLabels {
  readonly head: string;
  readonly headNote: string;
  readonly badge: string;
  readonly whatsapp: string;
  readonly connected: string;
  readonly notConnected: string;
  readonly note: string;
}

/** Ayarlar · bildirim kartı (kaynak "BİLDİRİM · YENİ DESTEK TALEBİ"). Panel rozeti her zaman açıktır (asıl kayıt); salt durum. */
export function NotifySettings({ whatsapp, labels: t }: { whatsapp: boolean; labels: NotifyLabels }) {
  return (
    <div className="card" style={{ background: C.surface }} data-testid="support-notify">
      <div className="chd">
        <b>{t.head}</b>
        <span>{t.headNote}</span>
      </div>
      <div className="tg" style={{ background: C.chip, cursor: "default" }} role="switch" aria-checked="true" aria-readonly="true">
        {t.badge}
        <span className="sw on" style={{ background: dz("17804F") }}>
          <i />
        </span>
      </div>
      <div className="tg" style={{ background: C.chip, cursor: "default" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <svg className="ico" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" style={{ color: dz("17804F") }}>
            <path d={YDICON.waBubble} />
            <path d={YDICON.waPhone} />
          </svg>
          {t.whatsapp}
        </span>
        <span className="chip" style={whatsapp ? { background: C["ok-bg"], color: C["ok-fg"] } : { background: dz("FFE7A8"), color: dz("4A3500") }} data-testid="support-whatsapp">
          {whatsapp ? t.connected : t.notConnected}
        </span>
      </div>
      <span className="kpi-s">{t.note}</span>
    </div>
  );
}

export interface SupportDetailItem {
  readonly id: string;
  readonly status: SupportStatusKey;
  readonly initials: string;
  readonly author: string;
  readonly authorSub: string;
  readonly topic: SupportTopicKey;
  readonly body: string;
  readonly info: readonly { readonly k: string; readonly v: string; readonly mono: boolean }[];
  readonly hist: readonly { readonly t: string; readonly l: string }[];
}

export interface SupportDetailLabels {
  readonly topics: Readonly<Record<SupportTopicKey, string>>;
  readonly reply: string;
  readonly replyNote: string;
  readonly replyAria: string;
  readonly replyPh: string;
  readonly close: string;
  readonly reopen: string;
  readonly send: string;
  readonly auto: string;
  readonly autoNote: string;
  readonly access: string;
  readonly accessTag: string;
  readonly accessH: string;
  readonly accessT: string;
  readonly askAccess: string;
  readonly askSoon: string;
  readonly hist: string;
  readonly histNote: string;
  readonly error: string;
  readonly sent: string;
}

/** F · Talep detayı. */
export function SupportDetail({
  tk,
  labels: t,
  reply,
  status,
}: {
  tk: SupportDetailItem;
  labels: SupportDetailLabels;
  reply: (prev: SupportActionState, form: FormData) => Promise<SupportActionState>;
  status: (prev: SupportActionState, form: FormData) => Promise<SupportActionState>;
}) {
  const [rs, replyAction, replying] = useActionState(reply, {});
  const [ss, statusAction, changing] = useActionState(status, {});
  const [text, setText] = useState("");
  const err = rs.error ?? ss.error;
  return (
    <DestekScope>
      {err !== undefined ? (
        <div className="ban" role="alert" style={{ background: dz("C62828"), color: dz("FFFFFF") }}>
          <span>{t.error.replace("{code}", () => err)}</span>
        </div>
      ) : null}
      <div className="grid2">
        <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          <div className="card" style={{ background: C.surface }}>
            <div className="dhead">
              <span className="av" style={{ background: dzd("2F7D5B"), color: dz("FFFFFF") }}>
                {tk.initials}
              </span>
              <div className="dname">
                <b style={{ fontSize: 20 }}>{tk.author}</b>
                <span>{tk.authorSub}</span>
              </div>
              <TopicChip topic={tk.topic} label={t.topics[tk.topic]} />
            </div>
            <p style={{ margin: 0, font: "600 16px/1.5 var(--font-instrument), sans-serif", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{tk.body}</p>
          </div>
          <div className="card" style={{ background: C.surface }}>
            <div className="chd">
              <b>{t.reply}</b>
              <span>{t.replyNote}</span>
            </div>
            <form
              action={(f) => {
                replyAction(f);
                setText("");
              }}
              style={{ display: "flex", flexDirection: "column", gap: 14 }}
            >
              <input type="hidden" name="id" value={tk.id} />
              <textarea className="ta" name="body" style={{ background: C.chip }} aria-label={t.replyAria} placeholder={t.replyPh} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} data-testid="support-reply-body" />
              {rs.ok === true ? (
                <span className="kpi-s" role="status">
                  {t.sent}
                </span>
              ) : null}
              <div className="sacts">
                <button
                  type="submit"
                  formAction={statusAction}
                  name="status"
                  value={tk.status === "CLOSED" ? "OPEN" : "CLOSED"}
                  className="btn"
                  style={{ background: C.chip }}
                  disabled={changing}
                  data-testid="support-status"
                >
                  <Ico d={YDICON.check} size={18} sw={2.8} />
                  {tk.status === "CLOSED" ? t.reopen : t.close}
                </button>
                <button type="submit" className="btn" style={{ background: dz("17804F"), color: dz("FFFFFF") }} disabled={replying || text.trim() === "" || tk.status === "CLOSED"} data-testid="support-reply-send">
                  <Ico d={YDICON.send} size={18} sw={2.6} />
                  {t.send}
                </button>
              </div>
            </form>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          <div className="card" style={{ background: C.surface }}>
            <div className="chd">
              <b>{t.auto}</b>
              <span>{t.autoNote}</span>
            </div>
            <dl className="kv">
              {tk.info.map((i) => (
                <div key={i.k} style={{ display: "contents" }}>
                  <dt>{i.k}</dt>
                  <dd className={i.mono ? "mono" : undefined} style={i.mono ? { fontSize: 13 } : undefined}>
                    {i.v}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="card" style={{ background: C.surface }}>
            <div className="chd">
              <b>{t.access}</b>
              <span>{t.accessTag}</span>
            </div>
            <div className="ban" style={{ background: C.chip }}>
              <Ico d={YDICON.lock} size={22} />
              <span>
                <b>{t.accessH}</b>
                {t.accessT}
              </span>
            </div>
            <button type="button" className="btn" style={{ background: dz("172E42"), color: dz("FFFFFF") }} disabled title={t.askSoon} aria-describedby="y-ask-soon" data-testid="support-ask-access">
              <Ico d={YDICON.eye} size={18} />
              {t.askAccess}
              <span id="y-ask-soon" hidden>
                {t.askSoon}
              </span>
            </button>
          </div>
          <div className="card" style={{ background: C.surface }}>
            <div className="chd">
              <b>{t.hist}</b>
              <span>{t.histNote}</span>
            </div>
            <div className="tl">
              {tk.hist.map((h, i) => (
                <div className="tli" key={`${h.t}-${i}`}>
                  <time>{h.t}</time>
                  <span style={{ overflowWrap: "anywhere" }}>{h.l}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </DestekScope>
  );
}
