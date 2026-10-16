// I-18 (DESIGN-PARITY): Yonet.dc.html `kayit` BİREBİR (PANEL İŞLEMLERİ kartı, SİLİNEMEZ, zaman çizelgesi `.tl`). Satırlar sunucuda
// `platform.*` güvenlik olaylarından biçimlenir (page.tsx).
import { C } from "../../design/yonet-tokens.ts";

export function KayitView({ rows, head, tag, empty }: { rows: readonly { readonly t: string; readonly l: string }[]; head: string; tag: string; empty: string }) {
  return (
    <div className="card" style={{ background: C.surface }}>
      <div className="chd">
        <b>{head}</b>
        <span>{tag}</span>
      </div>
      <div className="tl">
        {rows.length === 0 ? (
          <div className="tli">
            <span>{empty}</span>
          </div>
        ) : (
          rows.map((h, i) => (
            <div key={i} className="tli">
              <time>{h.t}</time>
              <span>{h.l}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
