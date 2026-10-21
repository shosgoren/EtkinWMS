"use client";
// I-18 (DESIGN-PARITY): Yonet.dc.html `odemeler` BİREBİR — dört gösterge (`.kpis`), durum sekmeleri, `.tbl` tablo (satırda "Ödendi
// işaretle" ve gecikende "Hatırlat"), fatura bandı; "Ödeme kaydı" ve "Dönem tahakkuku" pencereleri (T-406 tasarım eki). Değerler
// gerçek veridir (wms_platform.charges). "Hatırlat" e-postası kuyruk kurulumu (T-411) gelene dek pasiftir.
import { useActionState, useRef, useState } from "react";
import { useModalFocus } from "../../t/[slug]/kalip/odak.ts";
import { useRouter } from "next/navigation";
import { C, dz } from "../../design/yonet-tokens.ts";
import { YICON } from "../../design/yonet-icons.ts";
import type { PaymentActionState } from "./actions.ts";

export type ChargeStatusKey = "PAID" | "OVERDUE" | "PENDING";

export interface ChargeItem {
  readonly id: string;
  readonly company: string;
  readonly ref: string;
  readonly period: string;
  readonly plan: string;
  readonly amount: string;
  readonly status: ChargeStatusKey;
  readonly invoice: string;
}

export interface PaymentKpi {
  readonly label: string;
  readonly n: string;
  readonly sub: string;
  readonly color: string;
  readonly icon: string;
}

export interface OdemelerLabels {
  readonly states: Record<ChargeStatusKey, string>;
  readonly tabs: Record<"all" | ChargeStatusKey, string>;
  readonly tabsLabel: string;
  readonly colFirm: string;
  readonly colPeriod: string;
  readonly colPlan: string;
  readonly colAmount: string;
  readonly colState: string;
  readonly colInvoice: string;
  readonly empty: string;
  readonly markPaid: string;
  readonly remind: string;
  readonly remindSoon: string;
  readonly banTitle: string;
  readonly banBody: string;
  readonly paidTitle: string;
  readonly paidDate: string;
  readonly method: string;
  readonly methodLabel: string;
  readonly methods: Record<"HAVALE" | "KART" | "NAKIT", string>;
  readonly note: string;
  readonly notePlaceholder: string;
  readonly paidBan: string;
  readonly cancel: string;
  readonly savePaid: string;
  readonly accrueTitle: string;
  readonly accrueBody: string;
  readonly accrue: string;
  /** `{n}` yer tutuculu sonuç metni. */
  readonly accrued: string;
  /** `{code}` yer tutuculu hata metni. */
  readonly error: string;
}

const STATE_STYLE: Record<ChargeStatusKey, { background: string; color: string }> = {
  PAID: { background: C["ok-bg"], color: C["ok-fg"] },
  OVERDUE: { background: dz("C62828"), color: dz("FFFFFF") },
  PENDING: { background: C.chip, color: C.fg },
};

function Ico({ d, size, sw }: { d: string; size: number; sw?: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={sw === undefined ? undefined : { strokeWidth: sw }}>
      <path d={d} />
    </svg>
  );
}

export function OdemelerView({
  rows,
  kpis,
  tab,
  today,
  accrueOpen,
  labels: t,
  action,
}: {
  rows: readonly ChargeItem[];
  kpis: readonly PaymentKpi[];
  tab: "all" | ChargeStatusKey;
  /** Varsayılan tahsilat tarihi (gg.aa.yyyy). */
  today: string;
  /** Başlıktaki "Dönem tahakkuku" düğmesi `?tahakkuk=1` ile pencereyi açar. */
  accrueOpen: boolean;
  labels: OdemelerLabels;
  action: (prev: PaymentActionState, form: FormData) => Promise<PaymentActionState>;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, {});
  const [pick, setPick] = useState<ChargeItem | null>(null);
  const [way, setWay] = useState<"HAVALE" | "KART" | "NAKIT">("HAVALE");
  const [note, setNote] = useState("");
  const [accrue, setAccrue] = useState(accrueOpen);
  const shown = rows.filter((r) => tab === "all" || r.status === tab);
  const go = (k: "all" | ChargeStatusKey): void => router.push(k === "all" ? "/odemeler" : `/odemeler?d=${k}`);
  const closeAccrue = (): void => {
    setAccrue(false);
    if (accrueOpen) router.replace(tab === "all" ? "/odemeler" : `/odemeler?d=${tab}`);
  };
  // T-1001 (ALTIN-KURAL 11): perdeler Esc ile kapanır, odak içinde kalır ve açan düğmeye döner.
  const pdRef = useRef<HTMLDivElement>(null);
  const acRef = useRef<HTMLDivElement>(null);
  useModalFocus(pick !== null, pdRef, { onClose: () => setPick(null), initial: "first" });
  useModalFocus(accrue, acRef, { onClose: closeAccrue, initial: "first" });
  return (
    <>
      {state.error !== undefined ? (
        <div className="ban" role="alert" style={{ background: dz("C62828"), color: dz("FFFFFF") }}>
          <span>{t.error.replace("{code}", () => state.error ?? "")}</span>
        </div>
      ) : null}
      {state.accrued !== undefined ? (
        <div className="ban" role="status" style={{ background: C["ok-bg"], color: C["ok-fg"] }}>
          <span>{t.accrued.replace("{n}", () => String(state.accrued))}</span>
        </div>
      ) : null}
      <div className="kpis">
        {kpis.map((k) => (
          <div className="kpi" key={k.label} style={{ background: C.surface }}>
            <span className="kpi-l">
              <i style={{ background: dz(k.color) }}>
                <Ico d={k.icon} size={15} sw={2.8} />
              </i>
              {k.label}
            </span>
            <span className="kpi-n" style={{ color: dz(k.color) }}>
              {k.n}
            </span>
            <span className="kpi-s">{k.sub}</span>
          </div>
        ))}
      </div>
      <div className="toolbar">
        <div className="seg" role="tablist" aria-label={t.tabsLabel} style={{ background: C.chip }}>
          {(["all", "PAID", "OVERDUE", "PENDING"] as const).map((k) => (
            <button key={k} type="button" role="tab" className={`segb${k === tab ? " on" : ""}`} aria-selected={k === tab} style={{ background: k === tab ? C.surface : "transparent" }} onClick={() => go(k)}>
              {t.tabs[k]}
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
                <th>{t.colPeriod}</th>
                <th>{t.colPlan}</th>
                <th className="num">{t.colAmount}</th>
                <th>{t.colState}</th>
                <th>{t.colInvoice}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} data-testid="charge-row">
                  <td>
                    <span className="tname">
                      <b>{r.company}</b>
                      <span>{r.ref}</span>
                    </span>
                  </td>
                  <td data-l={t.colPeriod} className="mono" style={{ fontSize: "13px" }}>
                    {r.period}
                  </td>
                  <td data-l={t.colPlan}>{r.plan}</td>
                  <td className="num" data-l={t.colAmount}>
                    ₺{r.amount}
                  </td>
                  <td data-l={t.colState}>
                    <span className="chip" style={STATE_STYLE[r.status]}>
                      {t.states[r.status]}
                    </span>
                  </td>
                  <td data-l={t.colInvoice} className="mono" style={{ fontSize: "13px" }}>
                    {r.invoice}
                  </td>
                  <td>
                    <div className="racts">
                      {r.status !== "PAID" ? (
                        <button
                          type="button"
                          className="btn sm"
                          style={{ background: dz("17804F"), color: dz("FFFFFF") }}
                          onClick={() => {
                            setPick(r);
                            setWay("HAVALE");
                            setNote("");
                          }}
                        >
                          <Ico d={YICON.check} size={18} sw={3} />
                          {t.markPaid}
                        </button>
                      ) : null}
                      {r.status === "OVERDUE" ? (
                        <button type="button" className="btn sm" style={{ background: C.chip }} disabled title={t.remindSoon}>
                          {t.remind}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {shown.length === 0 ? <div className="empty">{t.empty}</div> : null}
      </div>
      <div className="ban" style={{ background: C.chip }}>
        <Ico d={YICON.warn} size={22} />
        <span>
          <b>{t.banTitle}</b>
          {t.banBody}
        </span>
      </div>

      {pick !== null ? (
        <div ref={pdRef} className="scrim" role="dialog" aria-modal="true" aria-labelledby="y-pd">
          <form className="sheet" style={{ background: C.surface, color: C.fg }} action={formAction} onSubmit={() => setPick(null)}>
            <input type="hidden" name="intent" value="PAID" />
            <input type="hidden" name="id" value={pick.id} />
            <input type="hidden" name="method" value={way} />
            <h2 id="y-pd">{`${t.paidTitle} · ${pick.company}`}</h2>
            <p className="mono" style={{ margin: 0, fontSize: "13px", opacity: 0.8, lineHeight: "normal" }}>{`${pick.ref} · ${pick.period} · ${pick.plan} · ₺${pick.amount}`}</p>
            <div className="fl">
              <label htmlFor="y-pdt">{t.paidDate}</label>
              <div className="inp" style={{ background: C.chip }}>
                <input id="y-pdt" name="paidOn" type="text" inputMode="numeric" defaultValue={today} required maxLength={10} />
              </div>
            </div>
            <div className="fl">
              <span className="fll">{t.method}</span>
              <div className="seg" role="radiogroup" aria-label={t.methodLabel} style={{ background: C.chip }}>
                {(["HAVALE", "KART", "NAKIT"] as const).map((m) => (
                  <button key={m} type="button" role="radio" className={`segb${m === way ? " on" : ""}`} aria-checked={m === way} style={{ background: m === way ? C.surface : "transparent" }} onClick={() => setWay(m)}>
                    {t.methods[m]}
                  </button>
                ))}
              </div>
            </div>
            <div className="fl">
              <label htmlFor="y-pnt">{t.note}</label>
              <textarea id="y-pnt" name="note" className="ta" style={{ background: C.chip, minHeight: "72px" }} placeholder={t.notePlaceholder} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="ban" style={{ background: C.chip }}>
              <Ico d={YICON.clock} size={22} />
              <span>{t.paidBan}</span>
            </div>
            <div className="sacts">
              <button type="button" className="btn" style={{ background: C.chip }} onClick={() => setPick(null)}>
                {t.cancel}
              </button>
              <button type="submit" className="btn" style={{ background: dz("17804F"), color: dz("FFFFFF") }} disabled={pending}>
                <Ico d={YICON.check} size={18} sw={3} />
                {t.savePaid}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {accrue ? (
        <div ref={acRef} className="scrim" role="dialog" aria-modal="true" aria-labelledby="y-ac">
          <form className="sheet" style={{ background: C.surface, color: C.fg }} action={formAction} onSubmit={closeAccrue}>
            <input type="hidden" name="intent" value="ACCRUE" />
            <h2 id="y-ac">{t.accrueTitle}</h2>
            <p style={{ margin: 0, font: "500 15px/1.5 'Instrument Sans', sans-serif", opacity: 0.8 }}>{t.accrueBody}</p>
            <div className="sacts">
              <button type="button" className="btn" style={{ background: C.chip }} onClick={closeAccrue}>
                {t.cancel}
              </button>
              <button type="submit" className="btn" style={{ background: dz("172E42"), color: dz("FFFFFF") }} disabled={pending}>
                {t.accrue}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
