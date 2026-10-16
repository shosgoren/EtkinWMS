"use client";
// I-18 (DESIGN-PARITY): Yonet.dc.html `musteriler` (araç çubuğu: arama + durum sekmeleri, `.tbl` tablo, boş durum) ve `musteri`
// (`.dhead` başlık, eylem düğmeleri, KULLANIM ölçerleri, ABONELİK `.kv`, GEÇMİŞ `.tl`, "Askıya al" ve "Paketi değiştir" pencereleri)
// BİREBİR. Değerler gerçek veridir (yalnız sayılar; tenant içeriği yok). Ödeme alanları ödeme bağlantısı gelene dek dürüst metin taşır
// (I-18 §4: değer uydurulmaz). Yazma işlemleri actions.ts'te (operatör + yakın zamanda doğrulama, veritabanı işlevi).
import { useActionState, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { C, dz } from "../../design/yonet-tokens.ts";
import { YICON } from "../../design/yonet-icons.ts";
import type { CustomerActionState } from "./actions.ts";

export type CustomerStateKey = "ACTIVE" | "TRIAL" | "SUSPENDED" | "OVERDUE";

/** Liste satırı (sunucuda biçimlenmiş metinler). */
export interface CustomerListItem {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly state: CustomerStateKey;
  readonly plan: string;
  readonly users: string;
  readonly warehouses: string;
  readonly items: string;
  readonly last: string;
}

export interface CustomerMeter {
  readonly label: string;
  readonly value: string;
  readonly max: string;
  readonly width: string;
  readonly hot: boolean;
}

export interface PlanOption {
  readonly id: string;
  readonly name: string;
  readonly price: string;
  readonly sum: string;
  readonly rank: number;
}

export interface CustomerDetail {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly since: string;
  readonly initials: string;
  readonly state: CustomerStateKey;
  readonly planLabel: string;
  readonly planId: string | null;
  readonly planRank: number;
  readonly meters: readonly CustomerMeter[];
  readonly sub: readonly { readonly k: string; readonly v: string }[];
  readonly hist: readonly { readonly t: string; readonly l: string }[];
}

export interface MusterilerLabels {
  readonly states: Record<CustomerStateKey, string>;
  readonly searchPlaceholder: string;
  readonly searchLabel: string;
  readonly tabsLabel: string;
  /** Sekme adları (kaynak: Hepsi, Aktif, Deneme, Gecikmede, Askıda). */
  readonly tabs: Record<"all" | CustomerStateKey, string>;
  readonly colFirm: string;
  readonly colState: string;
  readonly colPlan: string;
  readonly colUsers: string;
  readonly colWarehouses: string;
  readonly colItems: string;
  readonly colLast: string;
  readonly empty: string;
  readonly host: string;
  readonly since: string;
  readonly suspend: string;
  readonly resume: string;
  readonly extend: string;
  readonly changePlan: string;
  readonly support: string;
  readonly supportSoon: string;
  readonly usage: string;
  readonly usageNote: string;
  readonly subscription: string;
  readonly subscriptionNote: string;
  readonly history: string;
  readonly historyNote: string;
  readonly historyEmpty: string;
  readonly suspendTitle: string;
  readonly suspendBody: string;
  readonly reason: string;
  readonly reasonPlaceholder: string;
  readonly cancel: string;
  readonly planTitle: string;
  readonly perMonth: string;
  readonly tagNow: string;
  readonly tagUp: string;
  readonly tagDown: string;
  readonly noteUp: string;
  readonly noteDown: string;
  readonly noteSame: string;
  readonly apply: string;
  /** `{code}` yer tutuculu hata metni. */
  readonly error: string;
}

const STATE_STYLE: Record<CustomerStateKey, { background: string; color: string }> = {
  ACTIVE: { background: C["ok-bg"], color: C["ok-fg"] },
  TRIAL: { background: dz("FFE7A8"), color: dz("4A3500") },
  OVERDUE: { background: dz("C62828"), color: dz("FFFFFF") },
  SUSPENDED: { background: C.chip, color: C.fg },
};

function Ico({ d, size, sw, style }: { d: string; size: number; sw?: number; style?: CSSProperties }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={sw === undefined ? style : { strokeWidth: sw, ...style }}>
      <path d={d} />
    </svg>
  );
}

export function MusterilerList({
  rows,
  counts,
  tab,
  q,
  labels: t,
}: {
  rows: readonly CustomerListItem[];
  counts: Record<"all" | CustomerStateKey, number>;
  tab: "all" | CustomerStateKey;
  q: string;
  labels: MusterilerLabels;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(q);
  const ql = query.trim().toLocaleLowerCase("tr");
  const shown = rows.filter((r) => (tab === "all" || r.state === tab) && (ql === "" || `${r.name} ${r.slug}`.toLocaleLowerCase("tr").includes(ql)));
  const tabs = (["all", "ACTIVE", "TRIAL", "OVERDUE", "SUSPENDED"] as const).map((k) => [k, `${t.tabs[k]} · ${counts[k]}`] as const);
  const go = (k: "all" | CustomerStateKey): void => {
    const p = new URLSearchParams();
    if (k !== "all") p.set("d", k);
    if (query.trim() !== "") p.set("q", query.trim());
    router.push(`/musteriler${p.size > 0 ? `?${p.toString()}` : ""}`);
  };
  return (
    <>
      <div className="toolbar">
        <div className="search" style={{ background: C.surface }}>
          <Ico d={YICON.search} size={20} style={{ opacity: 0.6 }} />
          <input type="search" placeholder={t.searchPlaceholder} aria-label={t.searchLabel} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="seg" role="tablist" aria-label={t.tabsLabel} style={{ background: C.chip }}>
          {tabs.map(([k, l]) => (
            <button key={k} type="button" role="tab" className={`segb${k === tab ? " on" : ""}`} aria-selected={k === tab} style={{ background: k === tab ? C.surface : "transparent" }} onClick={() => go(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="card" style={{ background: C.surface, paddingTop: "8px" }}>
        <div className="tbox">
          <table className="tbl">
            <thead>
              <tr>
                <th>{t.colFirm}</th>
                <th>{t.colState}</th>
                <th>{t.colPlan}</th>
                <th className="num">{t.colUsers}</th>
                <th className="num">{t.colWarehouses}</th>
                <th className="num">{t.colItems}</th>
                <th>{t.colLast}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="rowlink" onClick={() => router.push(`/musteriler?m=${encodeURIComponent(r.id)}`)} data-testid="customer-row">
                  <td>
                    <span className="tname">
                      <b>
                        <a href={`/musteriler?m=${encodeURIComponent(r.id)}`} style={{ color: "inherit", textDecoration: "none" }}>
                          {r.name}
                        </a>
                      </b>
                      <span>{`${t.host}/${r.slug}`}</span>
                    </span>
                  </td>
                  <td data-l={t.colState}>
                    <span className="chip" style={STATE_STYLE[r.state]}>
                      {t.states[r.state]}
                    </span>
                  </td>
                  <td data-l={t.colPlan}>{r.plan}</td>
                  <td className="num" data-l={t.colUsers}>
                    {r.users}
                  </td>
                  <td className="num" data-l={t.colWarehouses}>
                    {r.warehouses}
                  </td>
                  <td className="num" data-l={t.colItems}>
                    {r.items}
                  </td>
                  <td data-l={t.colLast} className="mono" style={{ fontSize: "13px" }}>
                    {r.last}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {shown.length === 0 ? <div className="empty">{t.empty}</div> : null}
      </div>
    </>
  );
}

export function MusteriDetail({
  cu,
  plans,
  labels: t,
  action,
}: {
  cu: CustomerDetail;
  plans: readonly PlanOption[];
  labels: MusterilerLabels;
  action: (prev: CustomerActionState, form: FormData) => Promise<CustomerActionState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [sheet, setSheet] = useState<"suspend" | "plan" | null>(null);
  const [why, setWhy] = useState("");
  const [pick, setPick] = useState<string | null>(cu.planId);
  const picked = plans.find((p) => p.id === pick);
  const note = picked === undefined || picked.id === cu.planId ? t.noteSame : picked.rank > cu.planRank ? t.noteUp : t.noteDown;
  const close = (): void => {
    setSheet(null);
    setWhy("");
    setPick(cu.planId);
  };
  return (
    <>
      {state.error !== undefined ? (
        <div className="ban" role="alert" style={{ background: dz("C62828"), color: dz("FFFFFF") }}>
          <span>{t.error.replace("{code}", state.error)}</span>
        </div>
      ) : null}
      <div className="card" style={{ background: C.surface }}>
        <div className="dhead">
          <span className="av" style={{ background: dz("FFE7A8"), color: dz("4A3500") }}>
            {cu.initials}
          </span>
          <div className="dname">
            <b>{cu.name}</b>
            <span>{`${t.host}/${cu.slug} · ${t.since} ${cu.since}`}</span>
          </div>
          <span className="chip" style={STATE_STYLE[cu.state]}>
            {t.states[cu.state]}
          </span>
        </div>
        <form className="acts" action={formAction}>
          <input type="hidden" name="id" value={cu.id} />
          {cu.state !== "SUSPENDED" ? (
            <button type="button" className="btn sm" style={{ background: dz("C62828"), color: dz("FFFFFF") }} onClick={() => setSheet("suspend")}>
              <Ico d={YICON.pause} size={18} sw={2.8} />
              {t.suspend}
            </button>
          ) : (
            <button type="submit" name="intent" value="RESUME" className="btn sm" style={{ background: dz("17804F"), color: dz("FFFFFF") }} disabled={pending}>
              <Ico d={YICON.play} size={18} sw={2.8} />
              {t.resume}
            </button>
          )}
          {cu.state === "TRIAL" ? (
            <button type="submit" name="intent" value="EXTEND" className="btn sm" style={{ background: C.chip }} disabled={pending}>
              <Ico d={YICON.clock} size={18} />
              {t.extend}
            </button>
          ) : null}
          <button type="button" className="btn sm" style={{ background: C.chip }} onClick={() => setSheet("plan")}>
            <Ico d={YICON.pk} size={18} />
            {t.changePlan}
          </button>
          <button type="button" className="btn sm" style={{ background: C.chip }} disabled title={t.supportSoon} aria-describedby="y-support-soon">
            <Ico d={YICON.eye} size={18} />
            {t.support}
            <span id="y-support-soon" hidden>
              {t.supportSoon}
            </span>
          </button>
        </form>
      </div>
      <div className="grid2">
        <div className="card" style={{ background: C.surface }}>
          <div className="chd">
            <b>{`${t.usage} · ${cu.planLabel}`}</b>
            <span>{t.usageNote}</span>
          </div>
          {cu.meters.map((m) => (
            <div className="meter" key={m.label}>
              <div className="meter-t">
                <b>{m.label}</b>
                <span>{`${m.value} / ${m.max}`}</span>
              </div>
              <div className="bar" style={{ background: C.track }}>
                <i style={{ width: m.width, background: dz(m.hot ? "C62828" : "17804F") }} />
              </div>
            </div>
          ))}
        </div>
        <div className="card" style={{ background: C.surface }}>
          <div className="chd">
            <b>{t.subscription}</b>
            <span>{t.subscriptionNote}</span>
          </div>
          <dl className="kv">
            {cu.sub.map((s) => (
              <div key={s.k} style={{ display: "contents" }}>
                <dt>{s.k}</dt>
                <dd>{s.v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      <div className="card" style={{ background: C.surface }}>
        <div className="chd">
          <b>{t.history}</b>
          <span>{t.historyNote}</span>
        </div>
        <div className="tl">
          {cu.hist.length === 0 ? (
            <div className="tli">
              <time>—</time>
              <span>{t.historyEmpty}</span>
            </div>
          ) : (
            cu.hist.map((h, i) => (
              <div className="tli" key={`${h.t}-${i}`}>
                <time>{h.t}</time>
                <span>{h.l}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {sheet === "suspend" ? (
        <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="y-sh">
          <form className="sheet" style={{ background: C.surface, color: C.fg }} action={formAction} onSubmit={() => setSheet(null)}>
            <input type="hidden" name="id" value={cu.id} />
            <h2 id="y-sh">{t.suspendTitle.replace("{name}", cu.name)}</h2>
            <p style={{ margin: 0, font: "500 15px/1.5 'Instrument Sans', sans-serif", opacity: 0.8 }}>{t.suspendBody}</p>
            <div className="fl">
              <label htmlFor="y-why">{t.reason}</label>
              <textarea id="y-why" name="reason" className="ta" style={{ background: C.chip }} placeholder={t.reasonPlaceholder} value={why} maxLength={300} onChange={(e) => setWhy(e.target.value)} />
            </div>
            <div className="sacts">
              <button type="button" className="btn" style={{ background: C.chip }} onClick={close}>
                {t.cancel}
              </button>
              <button type="submit" name="intent" value="SUSPEND" className="btn" style={{ background: dz("C62828"), color: dz("FFFFFF") }} disabled={why.trim() === "" || pending}>
                {t.suspend}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {sheet === "plan" ? (
        <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="y-pl">
          <form className="sheet" style={{ background: C.surface, color: C.fg }} action={formAction} onSubmit={() => setSheet(null)}>
            <input type="hidden" name="id" value={cu.id} />
            <input type="hidden" name="plan" value={pick ?? ""} />
            <h2 id="y-pl">{`${t.planTitle} · ${cu.name}`}</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }} role="radiogroup" aria-labelledby="y-pl">
              {plans.map((p) => {
                const sel = p.id === pick;
                const tag = p.id === cu.planId ? t.tagNow : p.rank > cu.planRank ? t.tagUp : t.tagDown;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className="tg"
                    style={{ background: sel ? dz("172E42") : C.chip, color: sel ? dz("FFFFFF") : C.fg }}
                    role="radio"
                    aria-checked={sel}
                    onClick={() => setPick(p.id)}
                  >
                    <span>
                      <b style={{ display: "block", font: "800 17px/1.2 'Bricolage Grotesque', sans-serif" }}>{p.name}</b>
                      <span className="mono" style={{ fontSize: "12px", opacity: 0.75 }}>{`₺${p.price} ${t.perMonth} · ${p.sum}`}</span>
                    </span>
                    <span className="chip" style={{ background: sel ? dz("F4C542") : C.surface, color: sel ? dz("1A1300") : C.fg }}>
                      {tag}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="ban" style={{ background: C.chip }}>
              <Ico d={YICON.clock} size={22} />
              <span>{note}</span>
            </div>
            <div className="sacts">
              <button type="button" className="btn" style={{ background: C.chip }} onClick={close}>
                {t.cancel}
              </button>
              <button type="submit" name="intent" value="PLAN" className="btn" style={{ background: dz("172E42"), color: dz("FFFFFF") }} disabled={pick === null || pick === cu.planId || pending}>
                {t.apply}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
