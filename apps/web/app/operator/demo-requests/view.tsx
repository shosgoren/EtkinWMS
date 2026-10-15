// I-18 (DESIGN-PARITY): Giris.dc.html `v.mgr` + `v.op` BİREBİR. Sınıf adları, öğe sırası, ikon yolları ve metinler kaynaktan; CSS
// `app/design/giris.css` (üretilmiş). Satırlar gerçek veridir; bu bileşen yalnız çizer (yetki ve veri page.tsx'te).
import { getTranslations } from "next-intl/server";
import type { DemoRequestRow } from "@wms/domain/platform/demo-requests";
import { DzRoot } from "../../design/dz-root.tsx";
import { C, dz } from "../../design/giris-tokens.ts";
import { GICON } from "../../design/giris-icons.ts";
import { ThemeButton } from "./theme-button.tsx";

const TONE: ReadonlyArray<readonly [string, string]> = [
  ["FFE7A8", "4A3500"],
  ["CFE8DA", "0F3D27"],
  ["DCE4F8", "1C2E5C"],
  ["F6D9C9", "5C2410"],
];

function Ico({ d, size, sw }: { d: string; size: number; sw?: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={sw === undefined ? undefined : { strokeWidth: sw }}>
      <path d={d} />
    </svg>
  );
}

/** Kaynaktaki zaman biçimi: "BUGÜN 14:22", "DÜN 09:10", "12.10 16:45" (İstanbul saati). */
function whenLabel(at: Date, now: Date, today: string, yesterday: string): string {
  const tz = "Europe/Istanbul";
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const hm = new Intl.DateTimeFormat("tr-TR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
  const d0 = day(at);
  if (d0 === day(now)) return `${today} ${hm}`;
  if (d0 === day(new Date(now.getTime() - 86_400_000))) return `${yesterday} ${hm}`;
  const [, mm, dd] = d0.split("-");
  return `${dd ?? ""}.${mm ?? ""} ${hm}`;
}

export interface DemoRequestsViewProps {
  readonly rows: readonly DemoRequestRow[];
  readonly now: Date;
  readonly dark: boolean;
  readonly errorCode?: string | undefined;
  readonly action: (form: FormData) => Promise<void>;
}

export async function DemoRequestsView({ rows, now, dark, errorCode, action }: DemoRequestsViewProps) {
  const t = await getTranslations("operator");
  const pending = rows.filter((r) => r.status === "PENDING").length;
  return (
    <DzRoot dark={dark} scope="dzg" testId="operator-demo-requests">
      <div className="mp" style={{ background: C.bg, color: C.fg }}>
        <div className="band" style={{ background: dz("3D2A6B") }}>
          <a className="wb" href="/" aria-label={t("back")}>
            <Ico d={GICON.back} size={26} sw={3} />
          </a>
          <div className="band-t">
            <h1 className="sr-only">{t("title")}</h1>
            <b className="band-h" aria-hidden="true">
              {t("title")}
            </b>
            <span className="band-s">{t("band")}</span>
          </div>
          <ThemeButton label={t("theme")} />
        </div>
        <div className="lscroll wide">
          <div className="lin">
            <div className="ban" style={{ background: C.chip }}>
              <Ico d={GICON.lock} size={22} />
              <span>
                <b>{t("onlyTitle")}</b>
                {t("onlyBody")}
              </span>
            </div>
            {errorCode !== undefined ? (
              <div className="ban" role="alert" style={{ background: dz("C62828"), color: dz("FFFFFF") }}>
                <span>{t("error", { code: errorCode })}</span>
              </div>
            ) : null}
            <div className="shd">
              <b>{t("pending")}</b>
              <span>{t("count", { n: pending })}</span>
            </div>
            <div className="rows">
              {rows.map((r, i) => {
                const tone = TONE[i % TONE.length] ?? TONE[0];
                const s = `${r.company} · ${r.email} · ${whenLabel(r.receivedAt, now, t("today"), t("yesterday"))}`;
                return (
                  <div key={r.id} className="row" style={{ background: C.surface, cursor: "default" }} data-status={r.status}>
                    <span className="av" style={{ background: dz(tone?.[0] ?? "FFE7A8"), color: dz(tone?.[1] ?? "4A3500") }}>
                      {String(i + 1)}
                    </span>
                    <span className="rt">
                      {/* Kaynak çalışma zamanı `{{…}}` bağını `<span>` içine alır; `.rt span` kuralı ada da uygulanır (onaylı görünüm). */}
                      <b>
                        <span>{r.name}</span>
                      </b>
                      <span>
                        <span>{s}</span>
                      </span>
                    </span>
                    {r.status === "PENDING" ? (
                      <form action={action} className="rbtns">
                        <input type="hidden" name="id" value={r.id} />
                        <button type="submit" name="decision" value="REJECTED" className="sbtn" style={{ background: C.chip }} aria-label={t("reject")}>
                          <Ico d={GICON.close} size={20} sw={2.8} />
                          <span className="tx">{t("reject")}</span>
                        </button>
                        <button type="submit" name="decision" value="APPROVED" className="sbtn" style={{ background: dz("17804F"), color: dz("FFFFFF") }} aria-label={t("approve")}>
                          <Ico d={GICON.check} size={20} sw={2.8} />
                          <span className="tx">{t("approve")}</span>
                        </button>
                      </form>
                    ) : (
                      <span
                        className="chip"
                        style={r.status === "APPROVED" ? { background: C["ok-bg"], color: C["ok-fg"] } : { background: C.chip, color: C.fg }}
                      >
                        {r.status === "APPROVED" ? t("approved") : t("rejected")}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </DzRoot>
  );
}
