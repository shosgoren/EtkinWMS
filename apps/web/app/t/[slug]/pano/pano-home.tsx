// T-423 (I-18): Pano.dc.html saha personeli (`isField`: `.hello` + `.tsum` + `.tasks > .tk`) ve sayım kullanıcısı (`isCounter`: `.counthero`)
// ana ekranı BİREBİR. Sayılar `getWorkSummary`'den (uydurma yok, G-07); hesaplar kaynaktaki renderVals ile aynı:
// halka = biten / tüm iş (yay 94.25 birim), kart ilerlemesi = (tüm − kalan) / tüm, ACİL = kalan işlerden biri acil.
// Yalnız işi olan bölümlerin kartı çizilir (kaynak: grubun izin verdiği görev ekranları); hiç iş yoksa kaynaktaki kapalı kart (`.tk.off`)
// "bugün görevin yok" der. Yetki grupları (T-421) gelene kadar kapalı kartın "GRUBUN …" satırı çizilmez.
import Link from "next/link";
import type { CSSProperties } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { buyukHarf } from "@wms/ui";
import type { WorkSectionKey, WorkSummary } from "@wms/domain/operations";
import { dz } from "../../../design/pano-tokens.ts";
import { PICON } from "../../../design/pano-icons.ts";
import { appVersionOf } from "./app-version.ts";
import { PanoShell } from "./pano-shell.tsx";

/** Kaynak kart renkleri: Giriş ve Çıkış kaynaktaki kartın aynısı; diğerleri kaynağın paletinden (Transfer mor, Üretim kiremit, Sayım mavi). */
const TILE: Record<WorkSectionKey, { bg: string; ink: string; ic: string }> = {
  giris: { bg: "E3F1E9", ink: "1D5A40", ic: "2F7D5B" },
  cikis: { bg: "DFF0EF", ink: "16585A", ic: "24787A" },
  transfer: { bg: "E6EBEF", ink: "30475A", ic: "6C4BD8" },
  uretim: { bg: "F8EADF", ink: "8A3E10", ic: "B5552B" },
  sayim: { bg: "E6EEF8", ink: "1F4A8A", ic: "2F5DA8" },
};

const SECS: ReadonlyArray<{ k: WorkSectionKey; operation?: string; path: string }> = [
  { k: "giris", operation: "receive", path: "/field/receive" },
  { k: "cikis", operation: "shipping", path: "/shipping" },
  { k: "transfer", operation: "transfer", path: "/stock/documents?new=TRANSFER" },
  { k: "uretim", operation: "production", path: "/production" },
  { k: "sayim", path: "/field/tasks" },
];

export type PanoRole = "field" | "counter";

export interface PanoHomeProps {
  readonly slug: string;
  readonly role: PanoRole;
  readonly summary: WorkSummary | null;
  readonly userName: string;
  readonly tenantName: string;
  readonly dark: boolean;
  readonly stockPost: boolean;
  readonly canReport: boolean;
  readonly settingsManage: boolean;
  /** T-421: üyenin özel grubunun görünür ekranları (`null` = rolün varsayılanı, hepsi). */
  readonly screens?: readonly string[] | null;
}

/** İş bölümü → yetki grubundaki ekran anahtarı (Gruplar.dc.html SCREENS). */
const SCREEN_OF: Readonly<Record<WorkSectionKey, string>> = { giris: "receive", cikis: "pick", transfer: "transfer", uretim: "prod", sayim: "count" };

function Ico({ d, size, className = "ico", style }: { d: string; size: number; className?: string; style?: CSSProperties }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={style}>
      <path d={d} />
    </svg>
  );
}

export async function PanoHome({ slug, role, summary, userName, tenantName, dark, stockPost, canReport: canReportRole, settingsManage, screens = null }: PanoHomeProps) {
  const canReport = canReportRole && (screens === null || screens.includes("problem"));
  const t = await getTranslations("pano");
  const tg = await getTranslations("home.gv");
  const th = await getTranslations("home");
  const locale = await getLocale(); // T-436 (ALTIN-KURAL 16): kullanıcının dili
  const base = `/t/${encodeURIComponent(slug)}`;
  const firstName = userName.trim().split(/\s+/)[0] ?? userName;
  const sections = (summary?.sections ?? []).filter((s) => screens === null || screens.includes(SCREEN_OF[s.key]));
  const sec = (k: WorkSectionKey) => sections.find((s) => s.key === k);

  let leftO = 0;
  let leftK = 0;
  let doneO = 0;
  let probO = summary?.generalProblems ?? 0;
  for (const s of sections) {
    if (role === "counter" && s.key !== "sayim") continue;
    leftO += s.open;
    leftK += s.openLines;
    doneO += s.doneToday;
    probO += s.problems;
  }
  const allO = leftO + doneO + (probO - (summary?.generalProblems ?? 0));
  // T-1050 (STANDART §1, tuval "Merhaba Evren"): her ana ekranda aynı selam (kokpit ile aynı).
  const greet = th("hello", { name: firstName });
  const where = buyukHarf(summary?.warehouseName ?? tg("allWarehouses"), locale);
  const subline = role === "counter" ? t("counterSub") : summary === null ? where : tg("shift", { start: summary.shift.start, end: summary.shift.end, where });
  const roleTitle = role === "counter" ? t("counterTitle") : t("fieldTitle");
  const brandSub = `${buyukHarf(tenantName, locale)} · ${buyukHarf(roleTitle, locale)}`;
  const ini = buyukHarf(firstName.trim()[0] ?? "?", locale);


  // Kaynak toplam iş halkası (yalnız saha): biten / tüm, atanmış yay = tüm (saha için tüm işler kendisine görünen işlerdir).
  const C = 94.25;
  const arc = (n: number): string => `${Math.max(0.01, allO === 0 ? 0 : (n / allO) * C).toFixed(2)} ${C}`;

  const visible = SECS.filter((x) => {
    const s = sec(x.k);
    return s !== undefined && s.open + s.problems + s.doneToday > 0;
  });

  return (
    <PanoShell
      slug={slug}
      dark={dark}
      brandSub={brandSub}
      greet={greet}
      team={false}
      me={{ ini, name: userName, group: buyukHarf(roleTitle, locale), color: role === "counter" ? "2F5DA8" : "2F7D5B" }}
      settingsHref={settingsManage ? `${base}/settings` : undefined}
      scanHref={`${base}/field`}
      canReport={canReport}
      appVersion={appVersionOf()}
    >
      <div className="hello">
        <div className="hl">
          {role === "field" ? (
            <div className="hring" role="img" aria-label={t("ringAria", { done: doneO, total: allO })} data-testid="pano-ring">
              <svg viewBox="0 0 36 36" aria-hidden="true">
                <circle cx="18" cy="18" r="15" fill="none" stroke={dz("23,46,66,.12")} strokeWidth="4" />
                <circle cx="18" cy="18" r="15" fill="none" stroke={dz("9FD3B8")} strokeWidth="4" strokeLinecap="round" transform="rotate(-90 18 18)" style={{ strokeDasharray: arc(allO) }} />
                <circle cx="18" cy="18" r="15" fill="none" stroke={dz("2F7D5B")} strokeWidth="4" strokeLinecap="round" transform="rotate(-90 18 18)" style={{ strokeDasharray: arc(doneO) }} />
              </svg>
              <b>
                {doneO}
                <small>/{allO}</small>
              </b>
            </div>
          ) : null}
          <div style={{ minWidth: 0 }}>
            <h1>{greet}</h1>
            <p>{subline}</p>
          </div>
        </div>
      </div>

      {role === "counter" ? (
        <div className="counthero" data-testid="pano-counthero">
          <span className="alic">
            <svg className="ico" width="38" height="38" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="6" y="4" width="12" height="17" rx="2" />
              <path d="M9 4V2.8h6V4" />
              <path d="m9 13 2 2 4-4" />
            </svg>
          </span>
          <span style={{ flex: 1, minWidth: 200 }}>
            <b>{leftO > 0 ? t("countHero", { n: leftO }) : t("countNone")}</b>
            <small>{t("countHint")}</small>
          </span>
          {leftO > 0 ? (
            <Link href={`${base}/field/tasks`} className="btn y" style={{ minHeight: 60, fontSize: 16, padding: "0 24px", display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
              {t("countStart")}
            </Link>
          ) : null}
        </div>
      ) : (
        <>
          <div className="tsum">
            <span className="tsx">
              <b>{t("tsum", { o: leftO, k: leftK })}</b>
              <small>{t("tsumSub", { d: doneO, p: probO })}</small>
            </span>
          </div>
          <div className="tasks" data-count={visible.length}>
            {visible.map((x) => {
              const s = sec(x.k)!;
              const all = s.open + s.problems + s.doneToday;
              const done = all - s.open;
              const pct = all === 0 ? 0 : Math.round((done / all) * 100);
              const c = TILE[x.k];
              const title = t(`task.${x.k}`);
              const unit = tg(`unit.${x.k}`);
              const live = stockPost || x.operation === undefined;
              const body = (
                <>
                  <span className="tki" style={{ background: dz(c.ic) }}>
                    <Ico d={PICON[x.k]} size={26} />
                  </span>
                  <span className="tkb">
                    <span className="tkt">
                      {title}
                      {s.urgent ? (
                        <span className="tacil">
                          <Ico d={PICON.bolt} size={13} />
                          {tg("urgent")}
                        </span>
                      ) : null}
                    </span>
                    <span className="tkn">
                      <span>
                        <b>{s.open}</b>
                        <small>{unit}</small>
                      </span>
                      <i />
                      <span>
                        <b>{s.openLines}</b>
                        <small>{tg("lines")}</small>
                      </span>
                    </span>
                  </span>
                  <Ico d={PICON.chevron} size={22} className="ico tkc" />
                  <span className="tkp">
                    <span className="bar">
                      <span style={{ width: `${pct}%`, background: dz(c.ic) }} />
                    </span>
                    <em>{tg("progress", { done, total: all })}</em>
                  </span>
                </>
              );
              const props = {
                className: "tk",
                style: { background: dz(c.bg), color: dz(c.ink), textDecoration: "none" },
                "data-section": x.k,
                "aria-label": tg("tileLabel", { title, open: s.open, unit, lines: s.openLines }),
              };
              return live ? (
                <Link key={x.k} href={`${base}${x.path}`} {...props}>
                  {body}
                </Link>
              ) : (
                <div key={x.k} role="group" aria-disabled="true" {...props}>
                  {body}
                </div>
              );
            })}
            {visible.length === 0 ? (
              <div className="tk off" data-testid="pano-empty">
                <span className="tki" style={{ background: dz("B9C3CC") }}>
                  <Ico d={PICON.shield} size={24} />
                </span>
                <span className="tkb">
                  <span className="tkt">{summary === null ? tg("noData") : t("noTasks")}</span>
                  <small className="tko">{t("noTasksHint")}</small>
                </span>
              </div>
            ) : null}
          </div>
        </>
      )}
    </PanoShell>
  );
}
