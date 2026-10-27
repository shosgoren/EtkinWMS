// T-979 (B-94, I-18): Kokpit ("Genel bakış") ana ekranı LİSTE kalıbında (KalipListe.dc.html). Eski döşeme ızgarası (`task-menu.tsx`,
// `more-sheet.tsx`) kaldırıldı; içerik ve sözleşme aynı: "Şimdi" (gerçek bekleyen işler, `now-*` test kimlikleri), "Görevlerim" özeti
// (`my-tasks-card` / `my-tasks-empty`), işler listesi ("İşler"; durum `data-state`: active | locked | soon — kilitli/yakında işler kart
// olarak görünür, gerekçeleriyle), (T-1045: "Bugün yaptıklarım" kaldırıldı, tuvalde yok). Sunucu bileşeni: izin kararı çağıran sayfadan (`allowed`) gelir ve yalnız
// gösterimdir; asıl yetki hedef sayfa/eylemde sunucuda denetlenir. Sahte veri yok (G-07). Renkler liste kalıbı kaynağından (`kdz`).
import Link from "next/link";
import type { CSSProperties } from "react";
import { getTranslations } from "next-intl/server";
import { Banner } from "@wms/ui";
import { LICON } from "../../design/kalip-icons.ts";
import { Ico, KalipBaslik, KalipEkran } from "./kalip/ekran.tsx";
import { KalipBos, KalipKartListe } from "./kalip/liste.tsx";
import { kdz } from "./kalip/tokens.ts";

/** Saha rolleri için "Görevlerim" özeti (gerçek `listMyTasks` sayımı). Hata: sunucu mesajı + kod (yutulmaz). */
export type MyTasksSummary =
  | { readonly kind: "count"; readonly count: number; readonly more: boolean }
  | { readonly kind: "error"; readonly message: string; readonly code: string };

/** "Şimdi" (T-280): yetkili olunan işlerde GERÇEK bekleyen iş sayıları; satır yalnız sayı > 0 ise vardır. */
export type NowSummary =
  | {
      readonly kind: "rows";
      readonly rows: ReadonlyArray<{
        readonly key: "receive" | "putaway";
        readonly count: number;
        readonly more: boolean;
        /** Sıradaki en çok 2 gerçek iş (doğrudan bağlantı + kısa etiket). */
        readonly next: ReadonlyArray<{ readonly href: `/${string}`; readonly label: string }>;
      }>;
    }
  | { readonly kind: "empty" }
  | { readonly kind: "error"; readonly message: string; readonly code: string };

export type TaskKey = "members" | "settings" | "audit" | "items" | "warehouses" | "receive" | "count" | "lookup" | "undo";

/** İşler — sıra kaynağı: saha işleri önce, yönetim işleri sonra. `href` yoksa iş henüz yoktur ("Yakında"). */
const TASKS: ReadonlyArray<{ readonly key: TaskKey; readonly d: string; readonly color: string }> = [
  { key: "receive", d: LICON.moveIn, color: "2F7D5B" },
  { key: "count", d: LICON.clip, color: "6C4BD8" },
  { key: "lookup", d: LICON.koli, color: "9A5B2E" },
  { key: "warehouses", d: LICON.depo, color: "30475A" },
  { key: "items", d: LICON.box, color: "2F5DA8" },
  { key: "undo", d: LICON.clock, color: "E56A00" },
  { key: "audit", d: LICON.shield, color: "172E42" },
  { key: "members", d: LICON.people, color: "2F5DA8" },
  { key: "settings", d: LICON.gear, color: "4E6476" },
];

export interface KokpitProps {
  readonly slug: string;
  readonly dark: boolean;
  readonly firstName: string;
  readonly allowed: { readonly usersManage: boolean; readonly settingsManage: boolean; readonly auditView: boolean; readonly stockView: boolean; readonly stockPost: boolean };
  readonly myTasks?: MyTasksSummary;
  readonly now?: NowSummary;
}

const c = (hex: string): string => kdz("dzl", hex);
const ROW: CSSProperties = { textDecoration: "none" };

export async function Kokpit({ slug, dark, firstName, allowed, myTasks, now }: KokpitProps) {
  const t = await getTranslations("home");
  const base = `/t/${encodeURIComponent(slug)}` as const;
  const hrefs: Partial<Record<TaskKey, { readonly ok: boolean; readonly href: `/${string}` }>> = {
    members: { ok: allowed.usersManage, href: `${base}/members` },
    settings: { ok: allowed.settingsManage, href: `${base}/settings` },
    audit: { ok: allowed.auditView, href: `${base}/audit` },
    items: { ok: allowed.stockView, href: `${base}/items` },
    lookup: { ok: allowed.stockView, href: `${base}/stock` },
    // Okuma `stock.view` (her rol); yazma kilidi hedef sayfada gösterilir.
    warehouses: { ok: true, href: `${base}/warehouses` },
    // Saha kabulü: yazma `stock.post`; yetkisiz kullanıcıya bağlantı verilmez (kilit + gerekçe).
    receive: { ok: allowed.stockPost, href: `${base}/field/receive` },
  };
  const active = TASKS.filter((d) => hrefs[d.key]?.ok === true);
  const locked = TASKS.filter((d) => hrefs[d.key] !== undefined && hrefs[d.key]?.ok !== true);
  const soon = TASKS.filter((d) => hrefs[d.key] === undefined);
  // Saha rolünde (Görevlerim özeti var) önce bana atanmış iş: atanmış iş varsa "Şimdi" çizilmez; yoksa ve yetkili olunan açık iş varsa
  // "Şimdi" satırları boş Görevlerim kutusunun yerini alır (T-280 K-2). Yönetici (özet yok) "Şimdi"yi her zaman görür (boş durum dahil).
  const showNow = now !== undefined && (myTasks === undefined || (myTasks.kind === "count" && myTasks.count === 0 && now.kind !== "empty"));
  let i = 0;
  const icon = (d: string, color: string) => (
    <span className="uic" style={{ background: c(color) }}>
      <Ico d={d} size={26} />
    </span>
  );

  return (
    // T-1045 (STANDART §1, tuval StandartAnaEkran): ana ekran adı üst çubukta "Merhaba <ad>"; sabit açıklama ve "Bugün yaptıkların" yok.
    <KalipEkran kind="liste" dark={dark} title={t("hello", { name: firstName })} icon={{ d: LICON.grid, color: "172E42" }} testId="kokpit" bar={{ home: true }}>

      {now === undefined || !showNow ? null : (
        <section aria-label={t("now.title")} className="now-card" data-testid="now-card" data-state={now.kind} style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <KalipBaslik title={t("now.title")} />
          {now.kind === "error" ? (
            <Banner kind="warning">
              <p>{now.message}</p>
              <p>{now.code}</p>
            </Banner>
          ) : now.kind === "empty" ? (
            <p data-testid="now-empty" className="kknote">
              {t("now.empty")}
            </p>
          ) : (
            <KalipKartListe label={t("now.title")}>
              {now.rows.map((r) => {
                const shown = r.more ? `${r.count}+` : String(r.count);
                const first = r.next[0];
                const second = r.next[1];
                const color = r.key === "receive" ? "2F7D5B" : "0E7C7B";
                return (
                  <div key={r.key} role="listitem" style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                    <Link
                      className="uc"
                      style={{ ...ROW, animationDelay: `${i++ * 30}ms` }}
                      href={first?.href ?? (r.key === "receive" ? `${base}/field/receive` : `${base}/field/tasks`)}
                      data-testid={`now-${r.key}`}
                      data-count={r.count}
                    >
                      {icon(r.key === "receive" ? LICON.moveIn : LICON.transfer, color)}
                      <span className="ut">
                        <b className="now-label">{t(`now.${r.key}`, { count: shown })}</b>
                        {first === undefined ? null : (
                          <small className="mono" data-testid={`now-${r.key}-next`}>
                            {t("now.next", { label: first.label })}
                          </small>
                        )}
                      </span>
                      <span className="qb">
                        <b>{shown}</b>
                        <small>
                          <Ico d={LICON.chev} size={14} />
                        </small>
                      </span>
                    </Link>
                    {second === undefined ? null : (
                      <Link className="uc" style={ROW} href={second.href} data-testid={`now-${r.key}-extra`}>
                        {icon(LICON.arrow, color)}
                        <span className="ut">
                          <b>{t("now.then", { label: second.label })}</b>
                        </span>
                      </Link>
                    )}
                  </div>
                );
              })}
            </KalipKartListe>
          )}
        </section>
      )}

      {myTasks === undefined ? null : myTasks.kind === "error" ? (
        <Banner kind="warning">
          <p>{myTasks.message}</p>
          <p>{myTasks.code}</p>
        </Banner>
      ) : myTasks.count > 0 ? (
        <Link className="uc" style={ROW} href={`${base}/field/tasks`} data-testid="my-tasks-card">
          {icon(LICON.clip, "6C4BD8")}
          <span className="ut">
            <b>{t("myTasks.assigned", { count: myTasks.more ? `${myTasks.count}+` : String(myTasks.count) })}</b>
            <small className="mono">{t("myTasks.title")}</small>
          </span>
          <span className="qb">
            <b>{myTasks.more ? `${myTasks.count}+` : myTasks.count}</b>
            <small>
              <Ico d={LICON.chev} size={14} />
            </small>
          </span>
        </Link>
      ) : showNow ? null : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <KalipBos title={t("myTasks.empty")} iconD={LICON.clip} testId="my-tasks-empty" />
          <Link className="btn n" href={`${base}/field`} style={{ ...ROW, minHeight: 56 }}>
            <Ico d={LICON.arrow} size={18} />
            {t("myTasks.start")}
          </Link>
        </div>
      )}

      <KalipBaslik title={t("tasksLabel")} />
      <KalipKartListe label={t("tasksLabel")}>
        {active.map((d) => (
          <div key={d.key} role="listitem" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          {/* Kullanıcı kararı (27 Ekim): düğmelerin altında açıklama yazısı yok; açıklama yalnız ekran okuyucuya (aria-label). */}
          <Link className="uc" style={{ ...ROW, animationDelay: `${i++ * 30}ms` }} href={hrefs[d.key]?.href ?? base} data-state="active" data-task={d.key} aria-label={`${t(`tasks.${d.key}.title`)} · ${t(`tasks.${d.key}.description`)}`}>
            {icon(d.d, d.color)}
            <span className="ut">
              <b>{t(`tasks.${d.key}.title`)}</b>
            </span>
            <span className="qb">
              <b>
                <Ico d={LICON.chev} size={20} />
              </b>
            </span>
          </Link>
          </div>
        ))}
        {locked.map((d) => (
          <div key={d.key} role="listitem" className="uc" aria-disabled="true" aria-label={`${t(`tasks.${d.key}.title`)} · ${t("lockedReason")}`} data-state="locked" data-task={d.key} style={{ opacity: 0.72 }}>
            {icon(LICON.lock, "6A7F91")}
            <span className="ut">
              <b>{t(`tasks.${d.key}.title`)}</b>
            </span>
          </div>
        ))}
        {soon.map((d) => (
          <div key={d.key} role="listitem" className="uc" aria-disabled="true" aria-label={`${t(`tasks.${d.key}.title`)} · ${t("soonLabel")} · ${t("soonWarehouse")}`} data-state="soon" data-task={d.key} style={{ opacity: 0.72 }}>
            {icon(d.d, "6A7F91")}
            <span className="ut">
              <b>{t(`tasks.${d.key}.title`)}</b>
            </span>
            <span className="pill warn">{t("soonLabel")}</span>
          </div>
        ))}
      </KalipKartListe>

    </KalipEkran>
  );
}
