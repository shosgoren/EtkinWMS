import { getTranslations } from "next-intl/server";
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, ChevronRight, CircleCheck, ClipboardCheck, Clock, Factory, ListChecks, Lock, ScanLine, ShoppingCart } from "@wms/ui";
import type { WorkSectionKey, WorkSummary } from "@wms/domain/operations";
import { designFontVars } from "../../fonts.ts";
import { BrandMark } from "../../brand-mark.tsx";
import { HomeControls } from "./home-controls.tsx";
import type { TaskMenuProps } from "./task-menu.tsx";

// T-988: Görevlerim tasarımı (Bakış) birebir — yerleşim, yazı tipleri (Bricolage Grotesque / Instrument Sans / IBM Plex Mono) ve bölüm renkleri
// globals.css `.gv` bloğundaki belirteçlerdendir. Her sayı `getWorkSummary` gerçek verisidir; karşılığı olmayan alan (öncelik, vardiya, sorun) çizilmez.
// Dört işlem döşemesi (`data-operation`) önceki hedeflere gider; yetki kararı hedef ekran/eylemdedir (görünüm yalnız bayrağa bakar).

const OPERATIONS: ReadonlyArray<{ key: "receive" | "shipping" | "transfer" | "production"; section: WorkSectionKey; path: string; Icon: typeof ShoppingCart }> = [
  { key: "receive", section: "giris", path: "/field/receive", Icon: ArrowDownToLine },
  { key: "shipping", section: "cikis", path: "/shipping", Icon: ShoppingCart },
  { key: "transfer", section: "transfer", path: "/stock/documents?new=TRANSFER", Icon: ArrowLeftRight },
  { key: "production", section: "uretim", path: "/production", Icon: Factory },
];

export interface EasyHomeProps extends TaskMenuProps {
  readonly summary?: WorkSummary | null;
  readonly firstName?: string;
}

export async function EasyOperations({ slug, allowed, summary, firstName }: EasyHomeProps) {
  const t = await getTranslations("home");
  const tg = await getTranslations("home.gv");
  const base = `/t/${encodeURIComponent(slug)}`;
  const active = allowed.stockPost === true;
  const links = [
    { key: "stock", path: "/stock", allowed: allowed.stockView },
    { key: "items", path: "/items", allowed: allowed.stockView },
    { key: "warehouses", path: "/warehouses", allowed: true },
    { key: "tasks", path: "/field/tasks", allowed: allowed.stockView },
    { key: "members", path: "/members", allowed: allowed.usersManage },
    { key: "settings", path: "/settings", allowed: allowed.settingsManage },
    { key: "audit", path: "/audit", allowed: allowed.auditView },
  ] as const;

  const sections = summary?.sections ?? null;
  const sec = (k: WorkSectionKey) => sections?.find((s) => s.key === k);
  const left = sections === null ? null : sections.reduce((a, s) => ({ o: a.o + s.open, k: a.k + s.openLines }), { o: 0, k: 0 });
  const done = sections === null ? null : sections.reduce((a, s) => ({ o: a.o + s.doneToday, k: a.k + s.doneLines }), { o: 0, k: 0 });
  const all = left !== null && done !== null ? left.o + done.o : 0;
  const ringDash = all === 0 || done === null ? 0 : Math.round((done.o / all) * 264);
  const hour = summary?.localHour ?? 12;
  const hello = left !== null && left.o === 0 && (done?.o ?? 0) > 0 ? tg("dayDone", { name: firstName ?? "" }) : tg(hour < 12 ? "morning" : hour < 18 ? "day" : "evening", { name: firstName ?? "" });
  const where = summary?.warehouseName ?? tg("allWarehouses");

  const tile = (key: WorkSectionKey, title: string, unit: string, Icon: typeof ShoppingCart, href: string | null, state: "active" | "locked" | "soon", operation?: string) => {
    const s = sec(key);
    const o = s?.open ?? 0;
    const k = s?.openLines ?? 0;
    const total = s === undefined ? 0 : s.open + s.doneToday;
    const d = s?.doneToday ?? 0;
    const pct = total === 0 ? 0 : Math.round((d / total) * 100);
    const body = (
      <>
        <span className="gv-sic"><Icon className="gv-ico" strokeWidth={2.4} aria-hidden="true" /></span>
        <span className="gv-stt">{title}</span>
        {state === "locked" ? <span className="gv-snote">{t("lockedReason")}</span> : s === undefined ? <span className="gv-snote">{tg("noData")}</span> : (
          <span className="gv-snn"><span><b>{o}</b><small>{unit}</small></span><i aria-hidden="true" /><span><b>{k}</b><small>{tg("lines")}</small></span></span>
        )}
        {state === "active" ? <ChevronRight className="gv-ico gv-sch" strokeWidth={3} aria-hidden="true" /> : state === "locked" ? <Lock className="gv-ico gv-sch" strokeWidth={2.6} aria-hidden="true" /> : <span className="gv-sch gv-soon">{t("soonLabel")}</span>}
        {s === undefined || state === "locked" ? null : <span className="gv-spb"><span className="gv-bar"><span style={{ width: `${pct}%` }} /></span>{tg("progress", { done: d, total })}</span>}
      </>
    );
    const label = s === undefined ? title : tg("tileLabel", { title, open: o, unit, lines: k });
    const common = { className: `gv-sec gv-sec-${key}`, "data-section": key, "data-state": state, ...(operation === undefined ? {} : { "data-operation": operation }) };
    if (state === "active" && href !== null) return <a key={key} {...common} href={href} aria-label={label}>{body}</a>;
    return <div key={key} {...common} role="group" aria-label={state === "locked" ? title : label} aria-disabled="true" tabIndex={state === "locked" ? 0 : undefined}>{body}</div>;
  };

  return (
    <div className={`gv easy-operations ${designFontVars}`} data-testid="easy-operations">
      <h1 className="sr-only">{t("title")}</h1>
      <header className="gv-hd">
        <div className="gv-ring" role="img" aria-label={tg("ringLabel", { done: done?.o ?? 0, all })}>
          <svg viewBox="0 0 100 100" aria-hidden="true"><circle className="gv-ring-track" cx="50" cy="50" r="42" /><circle className="gv-ring-done" cx="50" cy="50" r="42" strokeDasharray={`${ringDash} 264`} /></svg>
          <b aria-hidden="true">{done?.o ?? 0}<small>/ {all}</small></b>
        </div>
        <div className="gv-who">
          <span className="gv-brandl"><BrandMark className="gv-elogo" framed={false} /><b>ETKİN WMS</b></span>
          <p className="gv-whoh">{hello}</p>
          <span className="gv-whos"><Clock className="gv-ico" strokeWidth={2.4} aria-hidden="true" />{where}</span>
        </div>
        <HomeControls />
      </header>

      {left === null || done === null ? null : (
        <section className="gv-stats" aria-label={tg("statsLabel")}>
          <p className="gv-st gv-st-kalan"><span className="gv-stl"><i><ListChecks className="gv-ico" strokeWidth={3} aria-hidden="true" /></i>{tg("left")}</span><span className="gv-stn">{left.o}</span><span className="gv-sts">{tg("linesCount", { n: left.k })}</span></p>
          <p className="gv-st gv-st-biten"><span className="gv-stl"><i><CircleCheck className="gv-ico" strokeWidth={3} aria-hidden="true" /></i>{tg("done")}</span><span className="gv-stn">{done.o}</span><span className="gv-sts">{tg("linesCount", { n: done.k })}</span></p>
        </section>
      )}

      <section aria-labelledby="gv-tasks-title" className="gv-block">
        <div className="gv-shd"><h2 id="gv-tasks-title">{tg("myTasks")}</h2>{left === null ? null : <span>{tg("leftSummary", { o: left.o, k: left.k })}</span>}</div>
        <div className="gv-secs">
          {OPERATIONS.map(({ key, section, path, Icon }) => tile(section, tg(`title.${section}`), tg(`unit.${section}`), Icon, `${base}${path}`, active ? "active" : "locked", key))}
          {tile("sayim", tg("title.sayim"), tg("unit.sayim"), ClipboardCheck, null, "soon")}
        </div>
      </section>

      {active ? (
        <section aria-labelledby="gv-manual-title" className="gv-block gv-quickwrap">
          <div className="gv-shd"><h2 id="gv-manual-title">{tg("manualTitle")}</h2><span>{tg("manualHint")}</span></div>
          <div className="gv-quick">
            <a className="gv-qb gv-qb-in" href={`${base}/stock/documents?new=STOCK_IN`} data-manual="in"><ArrowDownToLine className="gv-ico" strokeWidth={2.8} aria-hidden="true" />{tg("manualIn")}</a>
            <a className="gv-qb gv-qb-out" href={`${base}/stock/documents?new=STOCK_OUT`} data-manual="out"><ArrowUpFromLine className="gv-ico" strokeWidth={2.8} aria-hidden="true" />{tg("manualOut")}</a>
          </div>
        </section>
      ) : null}

      <nav aria-label={t("easy.links")} className="gv-more">
        {links.slice(0, 4).filter((link) => link.allowed).map((link) => <a key={link.key} href={`${base}${link.path}`} className="gv-chip">{t(`easy.${link.key}`)}</a>)}
        {links.slice(4).some((link) => link.allowed) ? (
          <details className="gv-moredet">
            <summary className="gv-chip">{t("easy.links")}</summary>
            <div className="gv-moreinner">{links.slice(4).filter((link) => link.allowed).map((link) => <a key={link.key} href={`${base}${link.path}`} className="gv-chip">{t(`easy.${link.key}`)}</a>)}</div>
          </details>
        ) : null}
      </nav>

      {active ? (
        <nav className="gv-thumb" aria-label={tg("thumbLabel")}>
          <a className="gv-tside gv-tside-in" href={`${base}/stock/documents?new=STOCK_IN`} aria-label={tg("manualIn")}><ArrowDownToLine className="gv-ico" strokeWidth={2.8} aria-hidden="true" />{tg("thumbIn")}</a>
          <a className="gv-tprim" href={`${base}/field`}><ScanLine className="gv-ico" strokeWidth={2.8} aria-hidden="true" />{tg("scanStart")}</a>
          <a className="gv-tside gv-tside-out" href={`${base}/stock/documents?new=STOCK_OUT`} aria-label={tg("manualOut")}><ArrowUpFromLine className="gv-ico" strokeWidth={2.8} aria-hidden="true" />{tg("thumbOut")}</a>
        </nav>
      ) : null}
    </div>
  );
}
