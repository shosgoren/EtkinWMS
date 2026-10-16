// I-18 (DESIGN-PARITY): Yonet.dc.html `ozet` BİREBİR (dört gösterge `.kpis`, YAPILACAKLAR `.tl`, SİSTEM `.kv`). Değerler sunucuda gerçek
// veriden hesaplanır (page.tsx); bu bileşen yalnız çizer. Göstergeler yalnız sayıdır (müşteri içeriği yok, ADR-027 §2).
import { Fragment } from "react";
import { C } from "../design/yonet-tokens.ts";

export interface OzetKpi {
  readonly label: string;
  readonly value: number;
  readonly sub: string;
  /** Vurgu rengi (tasarım belirteci, `dz(...)` çıktısı). */
  readonly accent: string;
  readonly icon: string;
}
export interface OzetTodo {
  readonly when: string;
  readonly tag: string;
  readonly bg: string;
  readonly fg: string;
  readonly text: string;
}
export interface OzetHealth {
  readonly k: string;
  readonly v: string;
  readonly color: string;
}

export function OzetView({
  kpis,
  todos,
  todoHead,
  todoCount,
  emptyTodo,
  health,
  healthHead,
  checked,
}: {
  kpis: readonly OzetKpi[];
  todos: readonly OzetTodo[];
  todoHead: string;
  todoCount: string;
  emptyTodo: string;
  health: readonly OzetHealth[];
  healthHead: string;
  checked: string;
}) {
  return (
    <>
      <div className="kpis">
        {kpis.map((k) => (
          <div key={k.label} className="kpi" style={{ background: C.surface }}>
            <span className="kpi-l">
              <i style={{ background: k.accent }}>
                <svg className="ico" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" style={{ strokeWidth: 2.8 }}>
                  <path d={k.icon} />
                </svg>
              </i>
              {k.label}
            </span>
            <span className="kpi-n" style={{ color: k.accent }}>
              {k.value}
            </span>
            <span className="kpi-s">{k.sub}</span>
          </div>
        ))}
      </div>
      <div className="grid2">
        <div className="card" style={{ background: C.surface }}>
          <div className="chd">
            <b>{todoHead}</b>
            <span>{todoCount}</span>
          </div>
          <div className="tl">
            {todos.length === 0 ? (
              <div className="tli">
                <span>{emptyTodo}</span>
              </div>
            ) : (
              todos.map((t, i) => (
                <div key={i} className="tli">
                  <time>{t.when}</time>
                  <span style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1 }}>
                    <span className="chip" style={{ background: t.bg, color: t.fg }}>
                      {t.tag}
                    </span>
                    {t.text}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="card" style={{ background: C.surface }}>
          <div className="chd">
            <b>{healthHead}</b>
            <span>{checked}</span>
          </div>
          <dl className="kv">
            {health.map((h) => (
              <Fragment key={h.k}>
                <dt>{h.k}</dt>
                <dd style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: h.color, flex: "none" }} />
                  {h.v}
                </dd>
              </Fragment>
            ))}
          </dl>
        </div>
      </div>
    </>
  );
}
