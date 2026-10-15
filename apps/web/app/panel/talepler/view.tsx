// I-18 (DESIGN-PARITY): Yonet.dc.html `talepler` BİREBİR (bant, tablo; telefonda kartlara dönen satırlar). Satırlar gerçek veridir
// (wms_platform.demo_requests). Bu bileşen yalnız çizer; kapı ve veri page.tsx'te.
import type { DemoRequestRow } from "@wms/domain/platform/demo-requests";
import { C, dz } from "../../design/yonet-tokens.ts";
import { YICON } from "../../design/yonet-icons.ts";

export interface TaleplerLabels {
  readonly banTitle: string;
  readonly banBody: string;
  readonly colWho: string;
  readonly colSector: string;
  readonly colNeed: string;
  readonly colWhen: string;
  readonly lSector: string;
  readonly lNeed: string;
  readonly lWhen: string;
  readonly reject: string;
  readonly approve: string;
  readonly approved: string;
  readonly rejected: string;
  readonly today: string;
  readonly yesterday: string;
  readonly empty: string;
}

/** Kaynaktaki zaman biçimi: "BUGÜN 14:22", "DÜN 09:10", "12.10 16:45" (İstanbul saati). */
export function whenLabel(at: Date, now: Date, today: string, yesterday: string): string {
  const tz = "Europe/Istanbul";
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const hm = new Intl.DateTimeFormat("tr-TR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
  const d0 = day(at);
  if (d0 === day(now)) return `${today} ${hm}`;
  if (d0 === day(new Date(now.getTime() - 86_400_000))) return `${yesterday} ${hm}`;
  const [, mm, dd] = d0.split("-");
  return `${dd ?? ""}.${mm ?? ""} ${hm}`;
}

export function TaleplerView({
  rows,
  now,
  labels: t,
  errorText,
  action,
}: {
  rows: readonly DemoRequestRow[];
  now: Date;
  labels: TaleplerLabels;
  errorText?: string | undefined;
  action: (form: FormData) => Promise<void>;
}) {
  return (
    <>
      <div className="ban" style={{ background: C.chip }}>
        <svg className="ico" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <path d={YICON.lock} />
        </svg>
        <span>
          <b>{t.banTitle}</b>
          {t.banBody}
        </span>
      </div>
      {errorText !== undefined ? (
        <div className="ban" role="alert" style={{ background: dz("C62828"), color: dz("FFFFFF") }}>
          <span>{errorText}</span>
        </div>
      ) : null}
      <div className="card" style={{ background: C.surface, paddingTop: "8px" }}>
        <div className="tbox">
          <table className="tbl">
            <thead>
              <tr>
                <th>{t.colWho}</th>
                <th>{t.colSector}</th>
                <th>{t.colNeed}</th>
                <th>{t.colWhen}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-status={r.status}>
                  <td>
                    <span className="tname">
                      <b>{r.name}</b>
                      <span>{`${r.company} · ${r.email}`}</span>
                    </span>
                  </td>
                  <td data-l={t.lSector}>{r.sector}</td>
                  <td data-l={t.lNeed} style={{ maxWidth: "320px" }}>
                    {r.message}
                  </td>
                  <td data-l={t.lWhen} className="mono" style={{ fontSize: "13px" }}>
                    {whenLabel(r.receivedAt, now, t.today, t.yesterday)}
                  </td>
                  <td>
                    {r.status === "PENDING" ? (
                      <form action={action} className="acts" style={{ flexWrap: "nowrap" }}>
                        <input type="hidden" name="id" value={r.id} />
                        <button type="submit" name="decision" value="REJECTED" className="btn sm" style={{ background: C.chip }}>
                          {t.reject}
                        </button>
                        <button type="submit" name="decision" value="APPROVED" className="btn sm" style={{ background: dz("17804F"), color: dz("FFFFFF") }}>
                          {t.approve}
                        </button>
                      </form>
                    ) : (
                      <span className="chip" style={r.status === "APPROVED" ? { background: C["ok-bg"], color: C["ok-fg"] } : { background: C.chip, color: C.fg }}>
                        {r.status === "APPROVED" ? t.approved : t.rejected}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 ? <div className="empty">{t.empty}</div> : null}
      </div>
    </>
  );
}
