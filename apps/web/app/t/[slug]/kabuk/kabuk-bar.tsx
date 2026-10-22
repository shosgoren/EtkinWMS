"use client";
// T-958 (I-18): Kabuk.dc.html alt cam çubuk + Modüller sayfası BİREBİR — `.dock > .dockin` (Geri · Ana ekran · `.dk.big` ana işlem ·
// Modüller · `.dk-etkin`), `.hback` + `.msheet` (`.mh`, `.srch`, `.mgrid > .mt`, `.soon`, `.mt.plus`, `.mempty`) ve `.toast`.
// Sınıf adları, öğe sırası ve ikon yolları kaynaktan (kabuk-icons.ts); renkler üretilmiş belirteçlerden (kabuk-tokens.ts). CSS
// `design/kabuk.css` (üretilmiş) + `design/kabuk-frame.css` (uygulama uyarlaması: çubuk ekranın altında sabit, ekranlar yer ayırır).
// Tek ortak bileşen: Pano ve yeni tasarım alt ekranları (Ekip, Gruplar, Aktar, Cariler) ana işlemini buraya verir; Modüller listesi
// kiracı düzeninde (sunucuda) üyenin rol/yetki/grup ekranlarından hesaplanır (`modules.ts`) ve bağlamla gelir.
// T-967 (Destek.dc.html): sol yuva her ekranda Geri; ana ekranda pasif `.dk.off` (CSS `design/destek-ek.css`, kap `.dzdx`).
// T-1002 (B-62): Etkin bas-konuş `etkin.tsx` (kabuk bağlamında `etkin: true` iken; aksi halde düğme kaynaktaki gibi çizilir, `aria-disabled`,
// dokununca "yakında" balonu). Arama kutusundaki mikrofon hâlâ "yakında". İlk kullanım rehberi (B-75) için `spot` kancası (kaynak `.touring` / `.spot`).
// T-990 (B-97, kullanıcı 21 Ekim): (1) Geri / Ana ekran / ana işlem bağlantısı / Modüller kutuları Next `Link` — İSTEMCİ İÇİ geçiş (tam
// sayfa yüklemesi yok); yarım işte ortak çıkış koruması tıklamayı yakalar: yarım işte yalnız uygulamanın cam kutusu açılır, tarayıcının "Siteden çıkılsın mı?" penceresi çıkmaz.
// (2) Ana işlem hiçbir zaman sessizce kapalı kalmaz: pasif görünür (`aria-disabled`), dokununca hata sesi + nedenini söyleyen balon
// (`disabledReason`, ör. "Değişiklik yok"). Ortak davranış burada; ekranlar yalnız nedeni verir.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { dz } from "../../../design/kabuk-tokens.ts";
import { KICON } from "../../../design/kabuk-icons.ts";
import type { KabukModule } from "./types.ts";
import { useEtkin } from "./etkin.tsx";
import { useYolSpot } from "../yolculuk/spot.ts";
import { buyukHarf, feedback, kucukHarf } from "@wms/ui";

export interface KabukContextValue {
  /** `/t/<slug>` */
  readonly base: string;
  readonly modules: readonly KabukModule[];
  /** Modüller alt yazısındaki rol adı (ör. "Yönetici"). */
  readonly roleLabel: string;
  /** T-968: kalıp üst çubuğundaki "firma · rol" satırı için çalışma alanı adı. */
  readonly tenantName?: string;
  /** T-971 (B-92): kalıp üst çubuğundaki Hesap menüsünün kişi başlığı (giriş yapan kullanıcının adı). */
  readonly userName?: string;
  /** Toplu yayın (T-967 × T-968): kalıp üst çubuğu Sorun bildir + Destek için çalışma alanı kısa adı ve Sorun bildirme yetkisi. */
  readonly slug?: string;
  readonly canReport?: boolean;
  /** T-981b: kalıp üst çubuğu Excel düğmesi gösterimi — `data`: `data.import` (düğme + dışarı aktar), `master`: ayrıca `settings.manage` (depo/raf içe aktarma). */
  readonly excel?: { readonly data: boolean; readonly master: boolean };
  /** T-979c: üyenin çalışma alanı sayısı (Hesap menüsünde "Çalışma alanı değiştir" yalnız birden fazlaysa). */
  readonly workspaces?: number;
  /** T-1002 (B-62): Etkin sesli komut açık mı (üyelik + `stock.view`; yazma eylemleri kendi izinlerini ayrıca ister). */
  readonly etkin?: boolean;
}

/** T-979c: görünüm geçişi (eski "Tüm ekranlar" menüsündeki Akış/Genel bakış anahtarı ile aynı çerez sözleşmesi: `view`, 1 yıl). */
export function switchView(base: string, view: "flow" | "cockpit"): void {
  document.cookie = `view=${view}; path=/; max-age=31536000; samesite=lax${window.location.protocol === "https:" ? "; secure" : ""}`;
  window.location.assign(base);
}

const KabukContext = createContext<KabukContextValue | null>(null);

/** Kiracı düzeninin verdiği kabuk bağlamı (yoksa `null`: ör. birim testi). */
export function useKabuk(): KabukContextValue | null {
  return useContext(KabukContext);
}

export function KabukProvider({ value, children }: { value: KabukContextValue; children: ReactNode }) {
  return <KabukContext.Provider value={value}>{children}</KabukContext.Provider>;
}

/** Kaynaktaki çubuk yuvaları (ilk kullanım rehberi `spot` anahtarları, kaynak COL). T-967: Sorun yuvası üst çubuğa taşındı. */
export type KabukSlot = "geri" | "home" | "center" | "mods" | "etkin";

export interface KabukNav {
  readonly href?: string;
  readonly onClick?: () => void;
  readonly aria?: string;
  readonly testId?: string;
}

/** T-979c: orta ana işlem etiketi tek satır, en çok 10 karakter (çubuğun içinde okunur). Uzunsa son kelime (eylem: "ÜRÜN EKLE" → "EKLE"),
 * o da uzunsa ilk 10 karakter. Tam metin erişilebilir addadır (`aria` yoksa özgün etiket). */
export const CAP_MAX = 10;
export function capOf(label: string): string {
  const v = label.trim();
  if (Array.from(v).length <= CAP_MAX) return v;
  const last = v.split(/\s+/).at(-1) ?? v;
  return Array.from(last).length <= CAP_MAX ? last : Array.from(last).slice(0, CAP_MAX).join("");
}

export interface KabukMain {
  /** Altındaki kısa etiket (kaynak `.cap`: OKUT, EKLE, ONAYLA…). */
  readonly label: string;
  readonly aria?: string;
  readonly d: string | readonly string[];
  readonly href?: string;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
  readonly testId?: string;
  /** Bekleyen karar (Ekip/Aktar kaynağındaki sarı `.dk.big.wait`). */
  readonly wait?: boolean;
  /** T-436 (ALTIN-KURAL 6): işlem sürüyor — ikinci dokunuş gönderilmez; 1 sn'den uzun sürerse dönen gösterge. */
  readonly busy?: boolean;
  /** Pasifken dokununca balonda söylenen neden (verilmezse genel metin). */
  readonly disabledReason?: string;
  /** Kaydedilmemiş değişiklik sayısı (ALTIN-KURAL: değişiklik varsa ana işlemde sayı rozeti). */
  readonly badge?: number;
}

export interface KabukBarProps {
  readonly dark: boolean;
  /** Ana ekran (Pano): solda pasif Geri (Destek.dc.html `.dk.off`), Ana ekran seçili. `back` verilirse Geri yine çalışır. */
  readonly home?: boolean;
  /** Geri (kaydedilmemiş iş uyarısı ekranın kendisindedir). Alt ekranda verilmezse kiracı köküne gider. */
  readonly back?: KabukNav;
  /** Ana ekran düğmesi (varsayılan: kiracı köküne bağlantı). */
  readonly homeNav?: KabukNav;
  /** Ekranın ana işlemi; verilmezse OKUT (okutma ekranı). */
  readonly main?: KabukMain | null;
  /** B-75 ilk kullanım rehberi: parlayan yuva (kaynak `.touring` + `.spot`). */
  readonly spot?: KabukSlot | null;
  /** B-62 Etkin: verilince düğme çalışır (bas-konuş); verilmezse "yakında". */
  readonly etkin?: { readonly live: boolean; readonly handlers: Pick<HTMLAttributes<HTMLButtonElement>, "onPointerDown" | "onPointerUp" | "onPointerCancel" | "onKeyDown"> };
}

type Dev = "mobile" | "tablet" | "desktop";
// Kaynak detect() (port.mjs MEDIA ile aynı eşikler).
const MQ_MOBILE = "(max-width: 699.98px)";
const MQ_TABLET = "(min-width: 700px) and (max-width: 1099.98px), (min-width: 700px) and (pointer: coarse)";
function detect(): Dev {
  try {
    if (window.matchMedia(MQ_MOBILE).matches) return "mobile";
    if (window.matchMedia(MQ_TABLET).matches) return "tablet";
  } catch {
    /* matchMedia yok */
  }
  return "desktop";
}
/** Kaynak: telefonda 12, tablette 16, masaüstünde 20 kutu (4 satır); sığmayan "+N daha". */
const CAP: Record<Dev, number> = { mobile: 12, tablet: 16, desktop: 20 };

function Ico({ d, size, className = "ico" }: { d: string | readonly string[]; size: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {(typeof d === "string" ? [d] : d).map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}

function GridIco({ size }: { size: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.8" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8" />
    </svg>
  );
}

function MicIco({ size }: { size: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d={KICON.micB} />
    </svg>
  );
}

function SearchIco() {
  return (
    <svg className="ico" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d={KICON.searchTail} />
    </svg>
  );
}

/** Düz sol tıklama mı (yeni sekme / indirme istekleri tarayıcıya bırakılır)? */
function plainClick(e: MouseEvent<HTMLElement>): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

/**
 * Bağlantı ya da düğme (aynı sınıf ve içerik). Bağlantı Next `Link`'tir: hidrasyondan önce doğal gezinme, sonra istemci içi geçiş (tam sayfa
 * yüklemesi yok). Yarım iş varken tıklamayı ortak çıkış koruması (kalip/cikis.tsx, belge düzeyinde yakalama) durdurur ve cam kutuyu açar.
 */
function Slot({ nav, className, aria, testId, k, current, children }: { nav: KabukNav; className: string; aria: string; testId: string; k: KabukSlot; current?: boolean; children: ReactNode }) {
  const common = { className, "aria-label": nav.aria ?? aria, "data-testid": nav.testId ?? testId, "data-k": k, "aria-current": current === true ? ("page" as const) : undefined };
  const href = nav.href;
  return href !== undefined && nav.onClick === undefined ? (
    <Link href={href} prefetch={false} {...common} style={{ textDecoration: "none" }} onClick={(e) => plainClick(e) && feedback.minor()}>
      {children}
    </Link>
  ) : (
    <button type="button" {...common} onClick={nav.onClick}>
      {children}
    </button>
  );
}


export function KabukBar({ dark, home = false, back, homeNav, main, spot: spotProp = null, etkin }: KabukBarProps) {
  // T-1006: ekran spot vermediyse kurulum yolculuğunun ipucu kartının yuvası (yolculuk/spot.ts).
  const yolSpot = useYolSpot();
  const spot = spotProp ?? yolSpot;
  const t = useTranslations("kabuk");
  const locale = useLocale(); // T-436 (ALTIN-KURAL 16): kullanıcının dili
  const ctx = useContext(KabukContext);
  const base = ctx?.base ?? "/";
  const modules = ctx?.modules ?? [];
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [dev, setDev] = useState<Dev>("mobile");
  const modsBtn = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  // T-1002 (B-62): ekran kendi `etkin` işleyicisini vermediyse kabuk bağlamındaki ortak Etkin denetleyicisi.
  const etk = useEtkin({
    enabled: etkin === undefined && ctx?.etkin === true && ctx.slug !== undefined,
    base,
    slug: ctx?.slug ?? "",
    modules: modules.map((m) => ({ id: m.id, name: t(`mod.${m.id}.name`), href: m.href })),
  });
  const etkinBtn = etkin ?? (ctx?.etkin === true && ctx.slug !== undefined ? { live: etk.live, handlers: etk.handlers } : undefined);


  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setPage(0);
    modsBtn.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    setDev(detect());
    // Odak sayfaya (telefonda klavye kendiliğinden açılmasın); Tab arama kutusundan başlar.
    sheet.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Odak tuzağı: Tab sayfa içinde döner.
  const trap = (e: KeyboardEvent<HTMLElement>): void => {
    if (e.key !== "Tab" || sheet.current === null) return;
    const f = [...sheet.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input")];
    if (f.length === 0) return;
    const first = f[0]!;
    const last = f[f.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const soon = (name: string): void => {
    feedback.minor();
    feedback.info(t("soonToast", { name }));
  };

  // Kaynak renderVals: arama (ad + alt yazı, kullanıcının dilinde küçük harf), sayfa sınırı ve "+N daha" / "İlk sayfa" kutusu.
  const named = modules.map((m) => ({ ...m, name: t(`mod.${m.id}.name`), sub: t(`mod.${m.id}.sub`) }));
  const ql = kucukHarf(q, locale).trim();
  const list = ql === "" ? named : named.filter((m) => kucukHarf(`${m.name} ${m.sub}`, locale).includes(ql));
  const cap = CAP[dev];
  let shown = list;
  let plus: { first: true; n: number } | { first: false } | null = null;
  if (list.length > cap) {
    if (page === 0) {
      shown = list.slice(0, cap - 1);
      plus = { first: true, n: list.length - (cap - 1) };
    } else {
      shown = list.slice(cap - 1, cap - 1 + cap - 1);
      plus = { first: false };
    }
  }
  const roleLabel = buyukHarf(ctx?.roleLabel ?? "", locale);
  const modsSub = t("sub", { role: roleLabel, n: modules.length }) + (plus !== null && !plus.first ? t("page2") : "");

  const sp = (k: KabukSlot): string => (spot === k ? " spot" : "");
  const center: KabukMain = main ?? { label: t("scanShort"), aria: t("scan"), d: KICON.scan, href: `${base}/field`, testId: "kabuk-scan" };
  const centerCls = `dk big${center.wait === true ? " wait" : ""}${sp("center")}`;
  const centerInner = (
    <>
      {center.busy === true ? <span className="kyuk" aria-hidden="true" /> : <Ico d={center.d} size={30} />}
      <span className="cap" aria-hidden={capOf(center.label) === center.label ? undefined : true}>
        {capOf(center.label)}
      </span>
      {center.badge !== undefined && center.badge > 0 ? (
        <span className="kbadge" aria-hidden="true" data-testid="kabuk-main-badge">
          {center.badge}
        </span>
      ) : null}
    </>
  );

  return (
    <div className={`dzk dzdx${dark ? " dz-dark" : ""}`} data-testid="kabuk">
      <div className={`wrap${spot !== null ? " touring" : ""}`}>
        <div className="app">
          <nav className="dock" aria-label={t("dock")} data-testid="kabuk-dock">
            <div className="dockin">
              {home && back === undefined ? (
                // T-967 (Destek.dc.html): ana ekranda Geri yeri korunur, pasif (`.dk.off`); sarı "?" Sorun üst çubuğa taşındı.
                <button type="button" className={`dk off${sp("geri")}`} aria-label={t("back")} aria-disabled="true" tabIndex={-1} data-testid="kabuk-back" data-k="geri">
                  <Ico d={KICON.back} size={26} />
                  <span>{t("backShort")}</span>
                </button>
              ) : (
                <Slot nav={back ?? { href: base }} className={`dk${sp("geri")}`} aria={t("back")} testId="kabuk-back" k="geri">
                  <Ico d={KICON.back} size={26} />
                  <span>{t("backShort")}</span>
                </Slot>
              )}
              <Slot nav={homeNav ?? { href: base }} className={`dk${home && !open ? " cur" : ""}${sp("home")}`} aria={t("home")} testId="kabuk-home" k="home" current={home}>
                <Ico d={[KICON.homeA, KICON.homeB, KICON.homeC]} size={26} />
                <span>{t("homeShort")}</span>
              </Slot>
              {center.href !== undefined && center.onClick === undefined && center.disabled !== true && center.busy !== true ? (
                <Link href={center.href} prefetch={false} className={centerCls} aria-label={center.aria ?? center.label} data-testid={center.testId ?? "kabuk-main"} data-k="center" data-tour="main" style={{ textDecoration: "none" }} onClick={(e) => plainClick(e) && feedback.minor()}>
                  {centerInner}
                </Link>
              ) : (
                <button
                  type="button"
                  className={centerCls}
                  aria-label={center.aria ?? center.label}
                  aria-disabled={center.disabled === true ? true : undefined}
                  aria-busy={center.busy === true || undefined}
                  onClick={() => {
                    if (center.busy === true) return;
                    if (center.disabled === true) {
                      // Sessiz kapalı düğme yok: hata sesi + neden balonu.
                      feedback.error(center.disabledReason ?? t("mainOff"));
                      return;
                    }
                    center.onClick?.();
                  }}
                  data-testid={center.testId ?? "kabuk-main"}
                  data-k="center" data-tour="main"
                >
                  {centerInner}
                </button>
              )}
              <button
                ref={modsBtn}
                type="button"
                className={`dk${open ? " cur" : ""}${sp("mods")}`}
                aria-label={t("mods")}
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={() => {
                  feedback.minor();
                  if (open) close();
                  else setOpen(true);
                }}
                data-testid="kabuk-mods"
                data-k="mods"
              >
                <GridIco size={26} />
                <span>{t("modsShort")}</span>
              </button>
              {etkinBtn === undefined ? (
                <button type="button" className={`dk-etkin${sp("etkin")}`} aria-label={t("etkinSoon")} aria-disabled="true" onClick={() => soon(t("etkinName"))} data-testid="kabuk-etkin" data-k="etkin">
                  <span className="mr" aria-hidden="true" />
                  <span className="mr b" aria-hidden="true" />
                  <span className="orb">
                    <MicIco size={22} />
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  className={`dk-etkin${etkinBtn.live ? " live" : ""}${sp("etkin")}`}
                  aria-label={t("etkin")}
                  aria-pressed={etkinBtn.live}
                  onContextMenu={(e) => e.preventDefault()}
                  {...etkinBtn.handlers}
                  data-testid="kabuk-etkin"
                  data-k="etkin"
                >
                  <span className="mr" aria-hidden="true" />
                  <span className="mr b" aria-hidden="true" />
                  <span className="orb">
                    <MicIco size={22} />
                  </span>
                </button>
              )}
            </div>
          </nav>

          {open ? (
            <>
              <button type="button" className="hback" aria-label={t("closeMods")} tabIndex={-1} onClick={close} data-testid="kabuk-mods-back" />
              <section ref={sheet} className="msheet" role="dialog" aria-modal="true" aria-label={t("mods")} tabIndex={-1} onKeyDown={trap} data-testid="kabuk-sheet">
                <div className="mh">
                  <span className="gi">
                    <GridIco size={20} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <b>{t("mods")}</b>
                    <small>{modsSub}</small>
                  </span>
                  <button type="button" className="x" aria-label={t("close")} onClick={close} data-testid="kabuk-mods-close">
                    <Ico d={KICON.close} size={20} />
                  </button>
                </div>
                <label className="srch">
                  <SearchIco />
                  <span className="sr">{t("search")}</span>
                  <input
                    ref={search}
                    type="search"
                    placeholder={t("searchPh")}
                    value={q}
                    onChange={(e) => {
                      setQ(e.target.value);
                      setPage(0);
                    }}
                    data-testid="kabuk-search"
                  />
                  <button type="button" className="smic" aria-label={t("sayModule")} aria-disabled="true" onClick={() => soon(t("etkinName"))}>
                    <MicIco size={20} />
                  </button>
                </label>
                <div className="mgrid" role="list">
                  {shown.map((m, i) => {
                    const isSoon = m.href === null;
                    const inner = (
                      <>
                        <span className="mi" style={{ background: dz(m.color) }}>
                          <Ico d={m.d} size={22} />
                        </span>
                        <span className="mtx">
                          <b>{m.name}</b>
                          <small>{m.sub}</small>
                        </span>
                        {isSoon ? <span className="soon">{t("soon")}</span> : null}
                      </>
                    );
                    const style: CSSProperties = { animationDelay: `${i * 18}ms` };
                    return isSoon ? (
                      <button key={m.id} type="button" role="listitem" className="mt soonT" style={style} aria-label={t("soonAria", { name: m.name, sub: m.sub })} onClick={() => soon(m.name)} data-module={m.id} data-soon="true">
                        {inner}
                      </button>
                    ) : (
                      <Link
                        key={m.id}
                        role="listitem"
                        href={m.href ?? base}
                        prefetch={false}
                        className="mt"
                        style={{ ...style, textDecoration: "none" }}
                        aria-label={t("tileAria", { name: m.name, sub: m.sub })}
                        onClick={(e) => {
                          if (!plainClick(e)) return;
                          feedback.minor();
                          if (m.view !== undefined) {
                            // T-979c görünüm geçişi (Akış / Genel bakış). Yarım işte ortak çıkış kutusu bağlantıyı yakalama evresinde durdurur (T-990).
                            e.preventDefault();
                            switchView(base, m.view);
                          }
                          setOpen(false);
                          setQ("");
                          setPage(0);
                        }}
                        data-module={m.id}
                        data-view={m.view}
                      >
                        {inner}
                      </Link>
                    );
                  })}
                  {plus !== null ? (
                    <button
                      type="button"
                      role="listitem"
                      className="mt plus"
                      aria-label={plus.first ? t("moreAria", { n: plus.n }) : t("firstAria")}
                      onClick={() => {
                        feedback.minor();
                        setPage(plus.first ? 1 : 0);
                      }}
                      data-testid="kabuk-more"
                    >
                      <span className="mi">
                        <Ico d={plus.first ? KICON.plus : KICON.back} size={22} />
                      </span>
                      <span className="mtx">
                        <b>{plus.first ? t("more", { n: plus.n }) : t("first")}</b>
                        <small>{t("moreSub")}</small>
                      </span>
                    </button>
                  ) : null}
                  {list.length === 0 ? (
                    <div className="mempty">
                      <SearchIco />
                      {t("none")}
                    </div>
                  ) : null}
                </div>
              </section>
            </>
          ) : null}
          {etk.overlay}
        </div>
      </div>
    </div>
  );
}
