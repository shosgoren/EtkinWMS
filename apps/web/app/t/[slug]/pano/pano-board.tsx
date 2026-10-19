// T-422 (I-18): Pano.dc.html hesap sahibi (`isOwner`) ve depo yöneticisi (`isManager`) ana ekranı BİREBİR — sınıf adları, öğe sırası, ikon
// yolları kaynaktan; sayılar `getBoard` + `getWorkSummary` (uydurma yok, G-07). Tanımlar board.ts başlığında. Karşılığı olmayan kaynak düğmeleri
// (Hepsini listeye ekle, Depo yöneticisine öne al, Listeyi gör) ilgili ekranlara bağlantıdır; satın alma listesi özelliği yoktur.
import type { CSSProperties, ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import type { Board, WorkSummary } from "@wms/domain/operations";
import { dz } from "../../../design/pano-tokens.ts";
import { PICON } from "../../../design/pano-icons.ts";
import { PanoShell, type PanoLink } from "./pano-shell.tsx";
import { AssignWho, type AssignCandidate } from "./assign-who.tsx";

export type BoardRole = "owner" | "manager";

export interface Assignee {
  readonly membershipId: string;
  readonly name: string;
  /** Üstlenebildiği görev türleri (TASK_KIND_PERMISSION). */
  readonly kinds: readonly string[];
}

export interface PanoBoardProps {
  readonly slug: string;
  readonly role: BoardRole;
  readonly board: Board | null;
  readonly summary: WorkSummary | null;
  readonly userName: string;
  readonly tenantName: string;
  readonly dark: boolean;
  readonly canAssign: boolean;
  readonly canReport: boolean;
  readonly stockPost: boolean;
  readonly usersManage: boolean;
  readonly settingsManage: boolean;
  readonly assignees: readonly Assignee[];
}

const AV = ["2F7D5B", "0E7C7B", "2F5DA8", "6C4BD8", "B5552B", "172E42"] as const;

function Svg({ size, children, style }: { size: number; children: ReactNode; style?: CSSProperties }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={style}>
      {children}
    </svg>
  );
}
const P = ({ d }: { d: string }) => <path d={d} />;

export async function PanoBoard(p: PanoBoardProps) {
  const t = await getTranslations("pano");
  const tg = await getTranslations("home.gv");
  const base = `/t/${encodeURIComponent(p.slug)}`;
  const b = p.board;
  const firstName = p.userName.trim().split(/\s+/)[0] ?? p.userName;
  const hour = b?.localHour ?? p.summary?.localHour ?? 12;
  const greet = tg(hour < 12 ? "morning" : hour < 18 ? "day" : "evening", { name: firstName });
  const owner = p.role === "owner";
  const roleTitle = owner ? t("ownerTitle") : t("managerTitle");
  const where = (b?.warehouseName ?? tg("allWarehouses")).toLocaleUpperCase("tr");
  const brandSub = `${p.tenantName.toLocaleUpperCase("tr")} · ${roleTitle.toLocaleUpperCase("tr")}`;
  const ini = (firstName.trim()[0] ?? "?").toLocaleUpperCase("tr");
  const onField = b?.team.filter((x) => x.state !== "AWAY").length ?? 0;

  const tasks = b?.tasks ?? { done: 0, assigned: 0, unassigned: 0 };
  const total = tasks.done + tasks.assigned + tasks.unassigned;
  const subline = b === null ? tg("noData") : owner ? t("ownerSub", { wh: b.warehouseCount, people: onField }) : t("managerSub", { total, asg: tasks.done + tasks.assigned, un: tasks.unassigned });
  const C = 94.25;
  const arc = (x: number): string => `${Math.max(0.01, total === 0 ? 0 : (x / total) * C).toFixed(2)} ${C}`;

  const halo: PanoLink[] = [
    owner
      ? { k: "reports", label: t("h.reports"), color: "0E7C7B", d: PICON.reports, href: `${base}/stock` }
      : { k: "plan", label: t("h.plan"), color: "2F7D5B", d: PICON.plan, href: `${base}/tasks?status=OPEN` },
    { k: "label", label: t("h.label"), color: "172E42", d: PICON.label, href: `${base}/labels` },
    ...(p.stockPost
      ? [
          { k: "in", label: t("manualIn"), color: "2F7D5B", d: PICON.giris, href: `${base}/stock/documents?new=STOCK_IN` },
          { k: "out", label: t("h.manualOut"), color: "B5552B", d: PICON.manualOut, href: `${base}/stock/documents?new=STOCK_OUT` },
        ]
      : []),
    { k: "team", label: t("h.team"), color: "6C4BD8", d: PICON.teamH, href: `${base}/members` },
  ];
  const teamLinks: PanoLink[] = [
    { k: "users", label: t("m.users"), color: "6C4BD8", d: PICON.team, href: `${base}/members` },
    ...(p.usersManage ? [{ k: "pending", label: t("m.pending"), color: "E56A00", d: PICON.clock, href: `${base}/members/devices` }] : []),
    ...(p.usersManage ? [{ k: "join", label: t("m.join"), color: "2F7D5B", d: PICON.plus, href: `${base}/members/join` }] : []),
    ...(p.usersManage ? [{ k: "groups", label: t("m.groups"), color: "0E7C7B", d: PICON.shieldCheck, href: `${base}/groups` }] : []),
  ];

  const shd = (title: string, right: ReactNode, cls = "shd") => (
    <div className={cls}>
      <b>{title}</b>
      <span>{right}</span>
    </div>
  );
  const live = p.summary === null ? null : (() => {
    const sec = (k: string) => p.summary?.sections.find((s) => s.key === k);
    return [
      { k: "in", color: "2F7D5B", n: sec("giris")?.doneLines ?? 0, l: t("live.in"), icon: <><P d={PICON.liveIn} /><P d={PICON.liveInB} /></> },
      { k: "out", color: "B5552B", n: sec("cikis")?.doneLines ?? 0, l: t("live.out"), icon: <><P d={PICON.liveOut} /><P d={PICON.liveOutB} /></> },
      { k: "tr", color: "6C4BD8", n: sec("transfer")?.doneToday ?? 0, l: t("live.transfer"), icon: <P d={PICON.transfer} /> },
      { k: "cnt", color: "2F5DA8", n: sec("sayim")?.open ?? 0, l: t("live.count"), icon: <><rect x="6" y="4" width="12" height="17" rx="2" /><P d={PICON.clipB} /></> },
    ];
  })();

  return (
    <PanoShell
      slug={p.slug}
      dark={p.dark}
      brandSub={brandSub}
      team
      me={{ ini, name: p.userName, group: roleTitle.toLocaleUpperCase("tr") + (owner ? "" : ` · ${where}`), color: owner ? "172E42" : "0E7C7B" }}
      halo={halo}
      teamLinks={teamLinks}
      settingsHref={p.settingsManage ? `${base}/settings` : undefined}
      scanHref={`${base}/field`}
      canReport={p.canReport}
      bell={b === null ? undefined : { n: b.criticalCount + b.problems, href: owner ? "#pano-alerts" : `${base}/tasks` }}
    >
      <div className="hello">
        <div className="hl">
          {!owner ? (
            <div className="hring" role="img" aria-label={t("ringManagerAria", { total, done: tasks.done, asg: tasks.assigned, un: tasks.unassigned })} data-testid="pano-ring">
              <svg viewBox="0 0 36 36" aria-hidden="true">
                <circle cx="18" cy="18" r="15" fill="none" stroke={dz("23,46,66,.12")} strokeWidth="4" />
                <circle cx="18" cy="18" r="15" fill="none" stroke={dz("9FD3B8")} strokeWidth="4" strokeLinecap="round" transform="rotate(-90 18 18)" style={{ strokeDasharray: arc(tasks.done + tasks.assigned) }} />
                <circle cx="18" cy="18" r="15" fill="none" stroke={dz("2F7D5B")} strokeWidth="4" strokeLinecap="round" transform="rotate(-90 18 18)" style={{ strokeDasharray: arc(tasks.done) }} />
              </svg>
              <b>
                {tasks.done}
                <small>/{total}</small>
              </b>
            </div>
          ) : null}
          <div style={{ minWidth: 0 }}>
            <h1>{greet}</h1>
            <p>{subline}</p>
          </div>
        </div>
      </div>

      {b === null ? null : owner ? (
        <>
          {shd(t("reports"), t("reportsHint"))}
          <div className="rep" role="list" aria-label={t("reportsAria")} data-testid="pano-reports">
            <a href={`${base}/stock`} className="rp" role="listitem" style={{ background: dz("C62828"), animationDelay: "0s", textDecoration: "none" }} data-report="critical">
              <span className="n">{b.criticalCount}</span>
              <span className="alic rich"><Svg size={26}><P d={PICON.box} /></Svg></span>
              <b>{t("r.critical")}</b>
              <small>{b.criticalCount > 0 ? t("r.criticalSub") : t("r.none")}</small>
            </a>
            <a href={`${base}/shipping`} className="rp" role="listitem" style={{ background: dz("E56A00"), animationDelay: ".05s", textDecoration: "none" }} data-report="orders">
              <span className="n">{b.orderCount}</span>
              <span className="alic rich"><Svg size={26}><P d={PICON.truck} /></Svg></span>
              <b>{t("r.orders")}</b>
              <small>{b.orderCount > 0 ? t("r.ordersSub", { d: b.oldestOrderDays }) : t("r.none")}</small>
            </a>
            <a href={`${base}/stock`} className="rp calm" role="listitem" style={{ "--c": dz("0E7C7B"), "--t": dz("0E7C7B"), animationDelay: ".1s", textDecoration: "none" } as CSSProperties} data-report="turn">
              <span className="n">{b.fast[0]?.times ?? 0}×</span>
              <span className="alic rich"><Svg size={26}><P d={PICON.turn} /></Svg></span>
              <b>{t("r.turn")}</b>
              <small>{t("r.turnSub")}</small>
            </a>
            <a href={`${base}/stock`} className="rp calm" role="listitem" style={{ "--c": dz("172E42"), "--t": dz("172E42"), animationDelay: ".15s", textDecoration: "none" } as CSSProperties} data-report="buy">
              <span className="n">{b.buyCount}</span>
              <span className="alic rich"><Svg size={26}><P d={PICON.cikis} /></Svg></span>
              <b>{t("r.buy")}</b>
              <small>{t("r.buySub")}</small>
            </a>
            <a href={`${base}/tasks?kind=COUNT`} className="rp calm" role="listitem" style={{ "--c": dz("2F5DA8"), "--t": dz("2F5DA8"), animationDelay: ".2s", textDecoration: "none" } as CSSProperties} data-report="count">
              <span className="n">{b.countReview}</span>
              <span className="alic rich"><Svg size={26}><P d={PICON.clip} /></Svg></span>
              <b>{t("r.count")}</b>
              <small>{t("r.countSub")}</small>
            </a>
            <a href={`${base}/stock`} className="rp all" role="listitem" style={{ textDecoration: "none" }}>
              <span className="alic" style={{ background: dz("EEF1F4"), color: dz("172E42") }}><Svg size={22}><P d={PICON.reports} /></Svg></span>
              <b>{t("r.all")}</b>
              <small style={{ color: dz("4E6476") }}>{t("r.allSub")}</small>
            </a>
          </div>

          {shd(t("alerts"), <><span className="dotlive" />{t("liveNow")}</>, "shd alerts-hd")}
          <div className="alerts" id="pano-alerts">
            <a href={`${base}/stock`} className="al" style={{ background: dz("C62828"), animationDelay: "0s", textDecoration: "none" }}>
              {b.criticalCount > 0 ? <span className="pulse" /> : null}
              <span className="alic"><Svg size={28}><P d={PICON.boxA} /><P d={PICON.boxB} /><P d={PICON.boxC} /></Svg></span>
              <span className="txt"><span className="n">{b.criticalCount}</span><span className="t">{t("a.critical")}</span><span className="s">{t("r.criticalSub")}</span></span>
            </a>
            <a href={`${base}/shipping`} className="al" style={{ background: dz("E56A00"), animationDelay: ".06s", textDecoration: "none" }}>
              {b.orderCount > 0 ? <span className="pulse" /> : null}
              <span className="alic"><Svg size={28}><P d={PICON.truckA} /><circle cx="6.5" cy="17.5" r="2" /><circle cx="16.5" cy="17.5" r="2" /><P d={PICON.truckB} /></Svg></span>
              <span className="txt"><span className="n">{b.orderCount}</span><span className="t">{t("a.orders")}</span><span className="s">{b.orderCount > 0 ? t("r.ordersSub", { d: b.oldestOrderDays }) : t("r.none")}</span></span>
            </a>
            <a href={`${base}/tasks?kind=COUNT`} className="al" style={{ background: dz("2F5DA8"), animationDelay: ".12s", textDecoration: "none" }}>
              <span className="alic"><Svg size={28}><rect x="6" y="4" width="12" height="17" rx="2" /><P d={PICON.clipA} /><P d={PICON.clipB} /></Svg></span>
              <span className="txt"><span className="n">{b.countReview}</span><span className="t">{t("a.count")}</span><span className="s">{t("r.countSub")}</span></span>
            </a>
            <a href={`${base}/tasks`} className="al" style={{ background: dz("6C4BD8"), animationDelay: ".18s", textDecoration: "none" }}>
              <span className="alic"><Svg size={28}><P d={PICON.warnA} /><P d={PICON.warnB} /></Svg></span>
              <span className="txt">
                <span className="n">{b.problems}</span>
                <span className="t">{t("a.problems")}</span>
                <span className="s">{b.lastProblem === null ? t("r.none") : `${tg(`problemSheet.reasons.${b.lastProblem.reason}`)} · ${t("minutes", { n: b.lastProblem.minutes })}`}</span>
              </span>
            </a>
          </div>

          <div className="grid2">
            <section className="card" aria-labelledby="buy-t">
              <div className="ch">
                <i style={{ background: dz("C62828") }}><Svg size={24}><P d={PICON.cartA} /><circle cx="9.5" cy="19.5" r="1.5" /><circle cx="17.5" cy="19.5" r="1.5" /></Svg></i>
                <span><b id="buy-t">{t("buyTitle")}</b><small>{t("buyHint")}</small></span>
              </div>
              {b.buy.length === 0 ? <p className="meta" style={{ margin: 0 }}>{t("buyEmpty")}</p> : null}
              {b.buy.map((x) => {
                const pct = Math.max(6, Math.min(100, Math.round((Number(x.have) / Number(x.min)) * 100)));
                return (
                  <div className="row" key={x.itemId}>
                    <span className="nm">{x.name}</span>
                    <span className="act"><a className="btn g" href={`${base}/items/${encodeURIComponent(x.itemId)}`} style={{ textDecoration: "none" }}>+{x.suggest} {x.unit}</a></span>
                    <span className="meter">
                      <span className="bar"><span style={{ width: `${pct}%`, background: dz(x.critical ? "C62828" : "E56A00") }} /></span>
                      <span className="mono" style={{ fontSize: 11, fontWeight: 600 }}>{x.have} / {x.min}</span>
                    </span>
                  </div>
                );
              })}
            </section>

            <section className="card" aria-labelledby="late-t">
              <div className="ch">
                <i style={{ background: dz("E56A00") }}><Svg size={24}><circle cx="12" cy="13" r="8" /><P d={PICON.lateA} /></Svg></i>
                <span><b id="late-t">{t("ordersTitle")}</b><small>{t("ordersHint")}</small></span>
              </div>
              {b.orders.length === 0 ? <p className="meta" style={{ margin: 0 }}>{t("ordersEmpty")}</p> : null}
              {b.orders.map((o) => (
                <div className="row" key={o.id}>
                  <span className="nm">{o.customer === "" ? o.number : o.customer}</span>
                  <span className="act" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                    <span className={o.days >= 3 ? "late" : "late amb"}>{t("days", { n: o.days })}</span>
                  </span>
                  <span className="meta">{o.number} · {t("linesN", { n: o.lines })} · {o.urgent ? tg("urgent") : t("waitShip")}</span>
                </div>
              ))}
              <a className="btn n" href={`${base}/shipping`} style={{ alignSelf: "flex-start", textDecoration: "none" }}>{t("ordersOpen")}</a>
            </section>
          </div>

          <section className="card turn-card" aria-labelledby="turn-t">
            <div className="ch">
              <i style={{ background: dz("0E7C7B") }}><Svg size={24}><P d={PICON.turnA} /><P d={PICON.turnB} /></Svg></i>
              <span><b id="turn-t">{t("turnTitle")}</b><small>{t("turnHint")}</small></span>
            </div>
            <div className="turn">
              <div className="tc" style={{ background: dz("E3F1E9"), color: dz("17583C") }}>
                <b><Svg size={20}><P d={PICON.up} /><P d={PICON.upB} /></Svg>{t("fast")}</b>
                {b.fast.length === 0 ? <span className="tl">{t("turnEmpty")}</span> : null}
                {b.fast.map((f) => (
                  <span className="tl" key={f.itemId}>
                    <span style={{ minWidth: 0, flex: "0 1 46%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                    <span className="bar"><span style={{ width: `${Math.round((f.times / Math.max(1, b.fast[0]?.times ?? 1)) * 100)}%`, background: dz("17804F") }} /></span>
                    <em>{f.times}×</em>
                  </span>
                ))}
              </div>
              <div className="tc" style={{ background: dz("F8EADF"), color: dz("8A3E10") }}>
                <b><Svg size={20}><P d={PICON.down} /><P d={PICON.downB} /></Svg>{t("slow")}</b>
                {b.slow.length === 0 ? <span className="tl">{t("turnEmpty")}</span> : null}
                {b.slow.map((f) => (
                  <span className="tl" key={f.itemId}>
                    <span style={{ minWidth: 0, flex: "0 1 46%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                    <span className="bar"><span style={{ width: `${Math.round((f.times / Math.max(1, b.fast[0]?.times ?? 1)) * 100)}%`, background: dz("B85A14") }} /></span>
                    <em>{f.times}×</em>
                  </span>
                ))}
              </div>
              <div className="tc" style={{ background: dz("172E42"), color: dz("FFFFFF") }}>
                <b><Svg size={20}><P d={PICON.boxA} /><P d={PICON.idleB} /></Svg>{t("idle")}</b>
                <span className="big">{t("itemsN", { n: b.idleItems })}</span>
                <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: dz("C9D6E0") }}>{t("idleHint")}</span>
                <a className="btn y" href={`${base}/stock`} style={{ alignSelf: "flex-start", textDecoration: "none" }}>{t("idleOpen")}</a>
              </div>
            </div>
          </section>
        </>
      ) : (
        <>
          <div className="quick">
            <a href={`${base}/tasks?status=OPEN`} className={`qt${tasks.unassigned > 0 ? " hot" : ""}`} style={{ "--q": dz("2F7D5B"), textDecoration: "none" } as CSSProperties} data-quick="plan">
              <span className="alic"><Svg size={26}><rect x="3" y="4" width="18" height="16" rx="2" /><P d={PICON.calA} /><P d={PICON.calB} /></Svg></span>
              <b>{t("q.plan")}</b>
              <small>{tasks.unassigned > 0 ? t("q.planSub", { n: tasks.unassigned }) : t("q.planNone")}</small>
            </a>
            <a href={`${base}/labels`} className="qt" style={{ "--q": dz("172E42"), textDecoration: "none" } as CSSProperties} data-quick="label">
              <span className="alic"><Svg size={26}><P d={PICON.printA} /><rect x="3" y="9" width="18" height="8" rx="2" /><P d={PICON.printB} /></Svg></span>
              <b>{t("q.label")}</b>
              <small>{t("q.labelSub")}</small>
            </a>
            <a href={`${base}/stock`} className="qt" style={{ "--q": dz("0E7C7B"), textDecoration: "none" } as CSSProperties} data-quick="reports">
              <span className="alic"><Svg size={26}><P d={PICON.reports} /></Svg></span>
              <b>{t("q.reports")}</b>
              <small>{where}</small>
            </a>
          </div>
          <div className="grid2">
            <section className="card" aria-labelledby="plan-t">
              <div className="ch">
                <i style={{ background: dz("2F7D5B") }}><Svg size={24}><P d={PICON.listA} /><P d={PICON.listB} /></Svg></i>
                <span><b id="plan-t">{t("todoTitle")}</b><small>{t("todoHint")}</small></span>
              </div>
              {b.todo.length === 0 ? <p className="meta" style={{ margin: 0 }}>{t("todoEmpty")}</p> : null}
              {b.todo.map((x) => {
                const who: AssignCandidate[] = p.assignees
                  .filter((a) => a.kinds.includes(x.kind))
                  .slice(0, 3)
                  .map((a) => ({ membershipId: a.membershipId, name: a.name, ini: (a.name.trim()[0] ?? "?").toLocaleUpperCase("tr"), color: AV[p.assignees.indexOf(a) % AV.length] ?? "172E42" }));
                return (
                  <div className="row" key={x.id}>
                    <span className="nm">{t(`kind.${x.kind}`)}{x.itemName === null ? "" : ` · ${x.itemName}`}</span>
                    {p.canAssign && who.length > 0 ? <AssignWho slug={p.slug} taskId={x.id} version={x.version} who={who} /> : <span className="act" />}
                    <span className="meta">{[x.locationCode, x.quantity === null ? null : t("qty", { n: x.quantity })].filter((v) => v !== null).join(" · ") || t("kind.hint")}</span>
                  </div>
                );
              })}
            </section>
            <section className="card" aria-labelledby="team-t">
              <div className="ch">
                <i style={{ background: dz("6C4BD8") }}><Svg size={24}><circle cx="9" cy="8" r="3.5" /><P d={PICON.teamA} /><P d={PICON.teamB} /></Svg></i>
                <span><b id="team-t">{t("teamTitle")}</b><small><span className="dotlive" />{t("liveShort")}</small></span>
              </div>
              {b.team.slice(0, 6).map((x, i) => {
                const st: readonly [string, string] = ({ SCANNING: ["E3F1E9", "17583C"], ASSIGNED: ["E6EEF8", "1F4A8A"], IDLE: ["FFF3D1", "6B4A00"], AWAY: ["FBE3E3", "9A1F1F"] } as const)[x.state];
                const group = x.state === "ASSIGNED" || x.state === "SCANNING" ? t("tasksN", { n: x.assigned }) : x.state === "IDLE" ? t("idleMin", { n: x.idleMinutes ?? 0 }) : t("notToday");
                return (
                  <div className="person" key={x.membershipId}>
                    <span className="av" style={{ background: dz(AV[i % AV.length] ?? "172E42") }}>{(x.name.trim()[0] ?? "?").toLocaleUpperCase("tr")}</span>
                    <span style={{ minWidth: 0 }}><b>{x.name}</b><small>{x.roles.map((r) => t(`role.${r}`)).join(", ")} · {group}</small></span>
                    <span className="st" style={{ background: dz(st[0]), color: dz(st[1]) }}>{t(`state.${x.state}`)}</span>
                  </div>
                );
              })}
            </section>
          </div>
        </>
      )}

      {live === null ? null : (
        <>
          {shd(t("liveTitle"), <><span className="dotlive" />{t("liveShort")}</>, "shd live-hd")}
          <div className="live">
            {live.map((x) => (
              <div className="lv" key={x.k}>
                <i style={{ background: dz(x.color) }}><Svg size={22}>{x.icon}</Svg></i>
                <span><b>{x.n}</b><small>{x.l}</small></span>
              </div>
            ))}
          </div>
        </>
      )}
    </PanoShell>
  );
}
