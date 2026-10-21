import type { CSSProperties } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { buyukHarf } from "@wms/ui";
import type { WorkSectionKey, WorkSummary } from "@wms/domain/operations";
import { DzRoot } from "../../design/dz-root.tsx";
import { C, dz } from "../../design/bakis-tokens.ts";
import { ICON } from "../../design/bakis-icons.ts";
import { HomeControls, HomeOverlays } from "./home-controls.tsx";

// I-18 (docs/design/DESIGN-PARITY.md): Görevlerim = Bakis.dc.html `v.home` BİREBİR. Sınıf adları, öğe sırası, ikon yolları ve metinler kaynaktan;
// CSS `apps/web/app/design/bakis.css` (üretilmiş). Yalnız `{{…}}` bağları gerçek veriye bağlanır (getWorkSummary). Hesaplar kaynaktaki renderVals ile
// aynıdır: halka = biten / tüm iş × 264; bölüm ilerlemesi = (tüm − kalan) / tüm; ACİL = kalan işlerden biri acil.

// Geçici hedefler (DESIGN-PARITY §8): kaynakta bölüm döşemesi ve durum kartları `v.list` (bölüm / durum listesi) ekranını açar. O ekran
// sıradaki işte birebir aktarılana kadar döşemeler mevcut iş ekranlarına gider; durum kartları tıklanmaz (görünüm aynı).
const SECS: ReadonlyArray<{ k: WorkSectionKey; operation?: string; path: string }> = [
  { k: "giris", operation: "receive", path: "/field/receive" },
  { k: "cikis", operation: "shipping", path: "/shipping" },
  { k: "transfer", operation: "transfer", path: "/stock/documents?new=TRANSFER" },
  { k: "uretim", operation: "production", path: "/production" },
  { k: "sayim", path: "/field/tasks" },
];

export interface EasyHomeProps {
  readonly slug: string;
  readonly allowed: { readonly usersManage: boolean; readonly settingsManage: boolean; readonly auditView: boolean; readonly stockView: boolean; readonly stockPost?: boolean };
  readonly summary?: WorkSummary | null;
  readonly firstName?: string;
  readonly dark?: boolean;
  /** Sorun bildirebilir mi (stock.post ya da document.create); değilse eylem çizilmez (I-18 öncelik cümlesi). */
  readonly canReport?: boolean;
}

function Ico({ d, size, sw, className = "ico", style }: { d: string; size: number | string; sw?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={sw === undefined ? style : { strokeWidth: sw, ...style }}>
      <path d={d} />
    </svg>
  );
}

export async function EasyOperations({ slug, allowed, summary, firstName, dark = false, canReport = false }: EasyHomeProps) {
  const t = await getTranslations("home");
  const tg = await getTranslations("home.gv");
  const locale = await getLocale(); // T-1001 (ALTIN-KURAL 16): kullanıcının dili
  const base = `/t/${encodeURIComponent(slug)}`;
  const name = firstName ?? "";
  const sections = summary?.sections ?? [];
  const sec = (k: WorkSectionKey) => sections.find((s) => s.key === k);

  // Kaynak `tot`: tüm iş = kalan + sorunlu + biten; halka 264 birimlik çevre.
  const tot = { allO: 0, doneO: 0, leftO: 0, leftK: 0, probO: 0, probK: 0, doneK: 0 };
  for (const s of sections) {
    tot.leftO += s.open;
    tot.leftK += s.openLines;
    tot.doneO += s.doneToday;
    tot.doneK += s.doneLines;
    tot.probO += s.problems;
    tot.probK += s.problemLines;
  }
  tot.probO += summary?.generalProblems ?? 0;
  tot.allO = tot.leftO + tot.doneO + tot.probO;
  const ring = tot.allO === 0 ? 0 : Math.round((tot.doneO / tot.allO) * 264);
  const manual = summary?.manualToday ?? 0;
  const hour = summary?.localHour ?? 12;
  const hello = tot.leftO === 0 && tot.allO > 0 ? tg("dayDone", { name }) : tg(hour < 12 ? "morning" : hour < 18 ? "day" : "evening", { name });
  const where = buyukHarf(summary?.warehouseName ?? tg("allWarehouses"), locale);
  const whos = summary === null || summary === undefined ? where : tg("shift", { start: summary.shift.start, end: summary.shift.end, where });
  const active = allowed.stockPost === true;

  const stats = [
    { k: "kalan", l: tg("left"), n: tot.leftO, sub: tg("linesCount", { n: tot.leftK }), a: C.kalan, d: ICON.list },
    { k: "biten", l: tg("done"), n: tot.doneO + manual, sub: tg("linesCount", { n: tot.doneK }) + (manual > 0 ? tg("manualSuffix", { n: manual }) : ""), a: C.biten, d: ICON.check },
    { k: "sorun", l: tg("problem"), n: tot.probO, sub: tg("linesCount", { n: tot.probK }), a: C.sorun, d: ICON.warn },
  ] as const;

  return (
    <DzRoot dark={dark} testId="easy-operations" overlays={<HomeOverlays slug={slug} canReport={canReport} />}>
      <div className="page" style={{ background: C.bg, color: C.fg }}>
        <h1 className="sr-only">{t("title")}</h1>
        <div className="scroll">
          <div className="inner">
            <div className="hd">
              <div className="ring" role="img" aria-label={tg("ringLabel", { done: tot.doneO, all: tot.allO })}>
                <svg viewBox="0 0 100 100" aria-hidden="true">
                  <circle cx="50" cy="50" r="42" fill="none" stroke={C.track} strokeWidth="11" />
                  <circle className="rp" cx="50" cy="50" r="42" fill="none" stroke={dz("17804F")} strokeWidth="11" strokeLinecap="round" strokeDasharray={`${ring} 264`} />
                </svg>
                <b>
                  {tot.doneO}
                  <small>/ {tot.allO}</small>
                </b>
              </div>
              <div className="who">
                <span className="brandl">
                  <svg className="elogo" width="18" height="18" viewBox="0 0 120 120" aria-hidden="true" style={{ flex: "none", display: "block" }}>
                    <rect x="4" y="4" width="112" height="112" rx="28" fill={C.surface} />
                    <path d={ICON.logo} fill="none" stroke={C.fg} strokeWidth="13" strokeLinecap="round" />
                    <circle r="12" fill={dz("F2C53D")} stroke={C.surface} strokeWidth="4">
                      <animateMotion dur="3.2s" repeatCount="indefinite" path={ICON.logo} />
                    </circle>
                  </svg>
                  <b className="brandn">ETKİN WMS</b>
                </span>
                <b className="whoh">{hello}</b>
                <span className="whos">
                  <Ico d={ICON.clock} size={14} />
                  {whos}
                </span>
              </div>
              <HomeControls />
            </div>

            <div className="stats" role="group" aria-label={tg("statsLabel")}>
              {stats.map((sc) => (
                <div key={sc.k} role="group" className="st" style={{ background: C.surface }} aria-label={`${sc.l} ${sc.n}`} data-stat={sc.k}>
                  <span className="stl">
                    <i style={{ background: sc.a }}>
                      <Ico d={sc.d} size={14} sw={3} />
                    </i>
                    {sc.l}
                  </span>
                  <span className="stn" style={{ color: sc.a }}>
                    {sc.n}
                  </span>
                  <span className="sts">{sc.sub}</span>
                </div>
              ))}
            </div>

            <div className="shd">
              <b>{tg("myTasks")}</b>
              <span>{tg("leftSummary", { o: tot.leftO, k: tot.leftK })}</span>
            </div>
            <div className="secs">
              {SECS.map((x, i) => {
                const s = sec(x.k);
                const o = s?.open ?? 0;
                const k = s?.openLines ?? 0;
                const all = s === undefined ? 0 : s.open + s.problems + s.doneToday;
                const done = all - o;
                const pct = all === 0 ? 0 : Math.round((done / all) * 100);
                const title = tg(`title.${x.k}`);
                const unit = tg(`unit.${x.k}`);
                // Yazma yetkisi olmayan rol (salt okunur) işlem ekranına gidemez: aynı görünümde tıklanmaz döşeme (Sayım listesi herkese açık).
                const live = active || x.operation === undefined;
                const props = {
                  className: "sec",
                  "data-section": x.k,
                  "data-operation": x.operation,
                  "data-state": live ? "active" : "locked",
                  style: { background: C[`${x.k}-t`], color: C[`${x.k}-ink`], animationDelay: `${i * 60}ms` },
                  "aria-label": tg("tileLabel", { title, open: o, unit, lines: k }),
                };
                const body = (
                  <>
                    <span className="sic" style={{ background: C[`${x.k}-s`], color: C.txt }}>
                      <Ico d={ICON[x.k]} size={32} sw={2.4} />
                    </span>
                    <span className="stt">{title}</span>
                    <span className="snn">
                      <span>
                        <b>{o}</b>
                        <small>{unit}</small>
                      </span>
                      <i />
                      <span>
                        <b>{k}</b>
                        <small>{tg("lines")}</small>
                      </span>
                    </span>
                    <Ico d={ICON.chevron} size={28} sw={3} className="ico sch" />
                    <span className="spb">
                      <span className="bar" style={{ background: C["sec-track"] }}>
                        <span style={{ width: `${pct}%`, background: C[`${x.k}-a`] }} />
                      </span>
                      {tg("progress", { done, total: all })}
                    </span>
                    {s?.urgent === true ? (
                      <span className="sbadge">
                        <Ico d={ICON.bolt} size={12} sw={3} />
                        {tg("urgent")}
                      </span>
                    ) : null}
                  </>
                );
                return live ? (
                  <a key={x.k} href={`${base}${x.path}`} {...props}>
                    {body}
                  </a>
                ) : (
                  <div key={x.k} role="group" aria-disabled="true" {...props}>
                    {body}
                  </div>
                );
              })}
            </div>

            {active ? (
              <>
                <div className="shd qhd">
                  <b>{tg("manualTitle")}</b>
                  <span>{tg("manualHint")}</span>
                </div>
                <div className="quick">
                  <a className="qb" href={`${base}/stock/documents?new=STOCK_IN`} style={{ color: C.in }} data-manual="in">
                    <Ico d={ICON.inn} size={22} sw={2.8} />
                    {tg("manualIn")}
                  </a>
                  <a className="qb" href={`${base}/stock/documents?new=STOCK_OUT`} style={{ color: C.out }} data-manual="out">
                    <Ico d={ICON.out} size={22} sw={2.8} />
                    {tg("manualOut")}
                  </a>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <nav className="thumb" style={{ background: C.surface, color: C.fg }} aria-label={tg("thumbLabel")}>
        <div className="trow">
          {active ? (
            <a className="tside" href={`${base}/stock/documents?new=STOCK_IN`} style={{ background: C["tin-bg"], color: C.in }} aria-label={tg("manualIn")}>
              <Ico d={ICON.inn} size={26} sw={2.8} />
              {tg("thumbIn")}
            </a>
          ) : (
            <span className="tside off" style={{ background: C["tin-bg"], color: C.in }} aria-hidden="true">
              <Ico d={ICON.inn} size={26} sw={2.8} />
              {tg("thumbIn")}
            </span>
          )}
          <a className="tprim" href={`${base}/field`} style={{ background: C["prim-bg"], color: C["prim-fg"] }}>
            <Ico d={ICON.scan} size={26} sw={2.8} />
            {tot.leftO > 0 ? tg("scanStart") : tg("dayComplete")}
          </a>
          {active ? (
            <a className="tside" href={`${base}/stock/documents?new=STOCK_OUT`} style={{ background: C["tout-bg"], color: C.out }} aria-label={tg("manualOut")}>
              <Ico d={ICON.out} size={26} sw={2.8} />
              {tg("thumbOut")}
            </a>
          ) : (
            <span className="tside off" style={{ background: C["tout-bg"], color: C.out }} aria-hidden="true">
              <Ico d={ICON.out} size={26} sw={2.8} />
              {tg("thumbOut")}
            </span>
          )}
        </div>
      </nav>
    </DzRoot>
  );
}
