"use client";
// Lokasyon ağacı (T-207). Sunucu düz listeyi `(derinlik, kod, id)` sırasıyla verir (keyset); ağaç `parentId` ile BURADA kurulur
// (yalnızca gösterim). Yetki/iş kuralları sunucudadır: `canManage` yalnızca kilit gösterimidir; tür/derinlik/ebeveyn
// kuralları (ör. TRANSIT yalnızca kök) yeniden yazılmaz, sunucu reddi (`PARENT_INVALID` vb.) gösterilir.
// Düzey etiketleri (Bölge/Raf/Göz) şimdilik sabit i18n varsayılanıdır; tenant terminolojisi okuyucusu Bulgular'da.
// T-990 (B-97): lokasyon ekleme, kod değiştirme ve toplu raf oluşturucu pencere değil TAM EKRAN FORMDUR; adres `?new=1` (kök) /
// `?new=1&parent=<id>` (alt lokasyon) / `?kod=<id>` / `?bulk=1` (rehberin 2. adımı). Geri ağaca döner.
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import { LICON } from "../../../../design/kalip-icons.ts";
import { BulkBuilder } from "../../easy-setup/bulk-builder.tsx";
import { isSetupComplete, useSetupProgress } from "../../easy-setup/setup-guide.tsx";
import { CodeChangedNotice, CodeEditForm } from "../../code-edit-dialog.tsx";
import type { KalipHizliIslem } from "../../kalip/detay.tsx";
import { KalipKartSerit, KalipKayitKart } from "../../kalip/kart.tsx";
import { Ico, KalipEkran, useKalipToast } from "../../kalip/ekran.tsx";
import { KalipOnay } from "../../kalip/pencere.tsx";
import { kdz } from "../../kalip/tokens.ts";
import { archiveLocationAction, createLocationAction, getSetupProgressAction, loadMoreLocationsAction, renameLocationAction, suggestCodeAction } from "../actions.ts";
import { CreateForm, ServerErrorBanner, useErrorText } from "../warehouses-view.tsx";
import type { ServerError } from "../warehouses-view.tsx";
import { feedback } from "@wms/ui";

export const KINDS = ["RECEIVING", "STORAGE", "STAGING", "TRANSIT"] as const;

export interface LocationItem {
  readonly id: string;
  readonly parentId: string | null;
  readonly code: string;
  readonly name: string;
  readonly depth: number;
  readonly kind: string;
  readonly status: "ACTIVE" | "ARCHIVED";
}

export interface TreeCursor {
  readonly depth: number;
  readonly code: string;
  readonly id: string;
}

const TOGGLE =
  "inline-flex size-12 shrink-0 items-center justify-center rounded-control border-2 border-border-strong bg-surface text-lg font-bold text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus";
const c = (hex: string): string => kdz("dzd", hex);
/** Satır eylem düğmesi (kaynak `.btn`, küçük); kilitliyken soluk. */
const actBtn = (bg: string, disabled: boolean): CSSProperties => ({ background: c(bg), color: c("FFFFFF"), minHeight: 48, opacity: disabled ? 0.5 : 1 });
/** Lokasyon türü rengi (kaynak paletinden; yalnız ayırt etmek için, anlamı tür etiketi taşır). */
const KIND_COLOR: Record<string, string> = { RECEIVING: "2F5DA8", STORAGE: "0E7C7B", STAGING: "E56A00", TRANSIT: "6C4BD8" };

/** Bir seferde en çok bu kadar kademe girinti (mobilde yatay taşma olmasın); daha derinde düzey rozeti yol gösterir. */
const MAX_INDENT_STEPS = 4;
const INDENT_PX = 14;

// SSR is a non-interactive preview; enable dialog launchers only after hydration.
const subscribeToClientReady = () => () => {};
const getClientReadySnapshot = () => true;
const getServerReadySnapshot = () => false;

function levelKey(depth: number): "zone" | "rack" | "bin" | "deeper" {
  return depth === 0 ? "zone" : depth === 1 ? "rack" : depth === 2 ? "bin" : "deeper";
}

export function LocationTree({
  slug,
  dark,
  warehouseId,
  warehouseName,
  warehouseCode,
  warehouseActive,
  canManage,
  initialItems,
  initialNext,
  activeTotal,
}: {
  slug: string;
  dark: boolean;
  warehouseId: string;
  warehouseName: string;
  warehouseCode: string;
  warehouseActive: boolean;
  canManage: boolean;
  initialItems: readonly LocationItem[];
  initialNext: TreeCursor | null;
  /** Sunucudan depodaki toplam aktif lokasyon sayısı (ALTIN-KURAL 15); yoksa yüklenenlerden sayılır ("N+"). */
  activeTotal?: number;
}) {
  const t = useTranslations("warehouses.tree");
  const tk = useTranslations("warehouses.kind");
  const tw = useTranslations("warehouses");
  const tl = useTranslations("warehouses.loc");
  const tb = useTranslations("easySetup.bulk");
  const te = useTranslations("easySetup");
  const router = useRouter();
  const params = useSearchParams();
  const base = `/t/${encodeURIComponent(slug)}/warehouses`;
  const returnTo = `${base}/${encodeURIComponent(warehouseId)}`;

  const [items, setItems] = useState<readonly LocationItem[]>(initialItems);
  const [next, setNext] = useState<TreeCursor | null>(initialNext);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(initialItems.filter((i) => i.parentId === null).map((i) => i.id)));
  const [archiving, setArchiving] = useState<LocationItem | null>(null);
  const [codeChanged, setCodeChanged] = useState<{ readonly id: string; readonly from: string; readonly to: string } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<{ error: ServerError; scope: "warehouse" | "location" } | null>(null);
  const { say, node: toast } = useKalipToast("detay");
  /** Başarı bildirimi: kalıp balonu + onay sesi (görsel + sesli geri bildirim). `null` = bildirim yok. */
  const setNotice = (text: string | null): void => {
    if (text === null) return;
    say("ok", text);
  };
  const fail = (e: { error: ServerError; scope: "warehouse" | "location" }): void => {
    feedback.error();
    setError(e);
  };
  const writable = canManage && warehouseActive;
  const clientReady = useSyncExternalStore(subscribeToClientReady, getClientReadySnapshot, getServerReadySnapshot);
  const canOpenDialogs = writable && clientReady;
  const [version, setVersion] = useState(0);
  const progress = useSetupProgress(slug, canManage, version);
  const guide = canManage && progress !== null && !isSetupComplete(progress);

  const errText = useErrorText();
  const go = (qs: string): void => router.push(qs === "" ? returnTo : `${returnTo}?${qs}`);
  const toTree = (): void => go("");
  const bulkOpen = params.get("bulk") === "1" && writable;
  const parentId = params.get("parent");
  const parentItem = parentId === null ? undefined : items.find((i) => i.id === parentId && i.status === "ACTIVE");
  const parent: { readonly id: string | null; readonly label: string } | undefined =
    params.get("new") !== "1" || !writable ? undefined : parentItem !== undefined ? { id: parentItem.id, label: `${parentItem.name} (${parentItem.code})` } : parentId === null ? { id: null, label: warehouseName } : undefined;
  const kodId = params.get("kod");
  const editing = kodId === null || !writable ? undefined : items.find((i) => i.id === kodId && i.status === "ACTIVE");

  // `router.refresh()` sonrası sunucu verisi yeni gelir: yerel (daha fazla yüklenmiş) liste sunucuyla eşitlenir.
  useEffect(() => {
    setItems(initialItems);
    setNext(initialNext);
  }, [initialItems, initialNext]);

  // T-1040 (kullanıcı 26 Ekim): arşivli raf ağaçta görünmez; yalnız "Arşivli rafları göster" açıkken (işlem düğmesi yine yok).
  const [showArchived, setShowArchived] = useState(false);
  const archivedCount = items.filter((i) => i.status !== "ACTIVE").length;
  const children = useMemo(() => {
    const m = new Map<string | null, LocationItem[]>();
    for (const it of items) {
      if (!showArchived && it.status !== "ACTIVE") continue;
      const list = m.get(it.parentId) ?? [];
      list.push(it);
      m.set(it.parentId, list);
    }
    return m;
  }, [items, showArchived]);

  const visible = useMemo(() => {
    const out: LocationItem[] = [];
    const walk = (parentId: string | null) => {
      for (const it of children.get(parentId) ?? []) {
        out.push(it);
        if (expanded.has(it.id)) walk(it.id);
      }
    };
    walk(null);
    return out;
  }, [children, expanded]);

  function toggle(id: string) {
    const n = new Set(expanded);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setExpanded(n);
  }

  async function changeCode(id: string, code: string) {
    const r = await renameLocationAction({ slug, locationId: id, code });
    return r.ok ? ({ ok: true, changed: r.data.changed } as const) : ({ ok: false, error: { code: r.error.code, detail: r.error.detail, requestId: r.error.requestId } } as const);
  }
  /** "Geri al" (N-03): eski koda dönüş aynı sunucu komutudur. */
  async function undoCode() {
    if (codeChanged === null) return;
    setUndoing(true);
    setError(null);
    const r = await changeCode(codeChanged.id, codeChanged.from);
    setUndoing(false);
    if (!r.ok) {
      fail({ error: r.error, scope: "location" });
      return;
    }
    setCodeChanged(null);
    setNotice(t("done.codeUndone"));
    router.refresh();
  }

  async function archive() {
    if (archiving === null) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await archiveLocationAction({ slug, locationId: archiving.id });
    setBusy(false);
    setArchiving(null);
    if (!res.ok) {
      fail({ error: { code: res.error.code, detail: res.error.detail, requestId: res.error.requestId }, scope: "location" });
      return;
    }
    setNotice(t("done.archived"));
    router.refresh();
  }

  async function loadMore() {
    if (next === null) return;
    setMore(true);
    setError(null);
    const res = await loadMoreLocationsAction({ slug, warehouseId, after: next });
    setMore(false);
    if (!res.ok) {
      fail({ error: { code: res.error.code, detail: res.error.detail, requestId: res.error.requestId }, scope: "location" });
      return;
    }
    setItems((cur) => [...cur, ...res.data.items.map((i) => ({ id: i.id, parentId: i.parentId, code: i.code, name: i.name, depth: i.depth, kind: i.kind, status: i.status }))]);
    setNext(res.data.next);
  }

  const lockText = !canManage ? tw("lockedReason") : !warehouseActive ? t("warehouseArchived") : null;

  const activeCount = items.filter((i) => i.status === "ACTIVE").length;
  const countText = activeTotal !== undefined ? String(activeTotal) : next === null ? String(activeCount) : `${activeCount}+`;
  const openRoot = (): void => {
    feedback.minor();
    go("new=1");
  };
  const openBulk = (): void => {
    feedback.minor();
    go("bulk=1");
  };
  const quick: KalipHizliIslem[] = canOpenDialogs
    ? [
        {
          key: "bulk",
          label: tb("open"),
          d: LICON.raf,
          color: "0E7C7B",
          onClick: openBulk,
        },
      ]
    : [];
  // Kurulum sürüyorsa sıradaki adım tek satır (ağaç ekranında rehberin kısa hâli): raflar → oluşturucu, ürün → ürün formu.
  const guideNext = !guide || progress === null ? null : !progress.hasLocation ? "locations" : !progress.hasItem ? "items" : null;

  if (bulkOpen) {
    return (
      <BulkBuilder
        dark={dark}
        slug={slug}
        warehouseId={warehouseId}
        warehouseName={warehouseName}
        returnTo={returnTo}
        onBack={toTree}
        onDone={async (r) => {
          setNotice(r.replayed ? tb("doneReplayed", { count: r.created }) : tb("done", { count: r.created, first: r.first, last: r.last }));
          setVersion((n) => n + 1);
          // Rehberin 3. adımı: ürün yoksa ürün formuna git.
          const p = await getSetupProgressAction({ slug }).catch(() => null);
          if (p !== null && p.ok && !p.data.hasItem) router.push(`/t/${encodeURIComponent(slug)}/items?new=1`);
          else {
            toTree();
            router.refresh();
          }
        }}
      />
    );
  }
  if (parent !== undefined) {
    return (
      <CreateForm
        key={parent.id ?? "root"}
        dark={dark}
        title={parent.id === null ? t("createRootTitle") : t("createChildTitle")}
        intro={t("parentIs", { parent: parent.label })}
        kinds={KINDS}
        returnTo={returnTo}
        scope="location"
        testId="location-form"
        suggest={async () => {
          const r = await suggestCodeAction({ slug, kind: "location", warehouseId });
          return r.ok ? r.data.code : null;
        }}
        onBack={toTree}
        onDone={() => {
          setVersion((n) => n + 1);
          // Yeni alt lokasyon görünsün: ebeveyn açılır.
          const pid = parent.id;
          if (pid !== null) setExpanded((cur) => new Set(cur).add(pid));
          setNotice(t("done.created"));
          toTree();
          router.refresh();
        }}
        submit={async (v) => {
          const res = await createLocationAction({ slug, warehouseId, parentId: parent.id, code: v.code, name: v.name, kind: v.kind, autoCode: v.autoCode });
          return res.ok ? { ok: true, data: res.data } : { ok: false, error: { code: res.error.code, detail: res.error.detail, requestId: res.error.requestId } };
        }}
      />
    );
  }
  if (editing !== undefined) {
    return (
      <CodeEditForm
        key={editing.id}
        dark={dark}
        subject={editing.name}
        current={editing.code}
        icon={{ d: LICON.raf, color: KIND_COLOR[editing.kind] ?? "0E7C7B" }}
        onBack={toTree}
        submit={(code) => changeCode(editing.id, code)}
        errorText={(e) => errText(e, "location")}
        renderError={(e) => <ServerErrorBanner error={e} returnTo={returnTo} scope="location" />}
        onDone={(r) => {
          setError(null);
          if (r.changed) setCodeChanged({ id: editing.id, from: r.from, to: r.to });
          else setNotice(t("done.codeSame"));
          toTree();
          router.refresh();
        }}
      />
    );
  }

  return (
    <>
      {/* SSR önizlemesi etkileşimsizdir: `data-location-tree-ready` hidrasyondan sonra true; o zamana dek pencere açan düğmeler kapalı. */}
      <div data-location-tree-ready={clientReady} style={{ display: "contents" }}>
        <KalipEkran
          kind="detay"
          dark={dark}
          title={t("title")}
          icon={{ d: LICON.raf, color: "0E7C7B" }}
          heading={false}
          excel={{ kind: "locations", warehouseId }}
          testId="location-tree"
          bar={{
            back: { href: base, aria: t("back") },
            main: { label: tw("k.addLoc"), aria: t("addRoot"), d: LICON.plus, disabled: !canOpenDialogs, disabledReason: lockText ?? t("addWait"), onClick: openRoot, testId: "location-add" },
          }}
          overlays={toast}
        >
          {/* T-1051 (STANDART §3): depo kartı kayıt kartı kalıbında — şerit (ad, kod, durum, raf yeri sayısı, hızlı işlem) + raf yeri ağacı. */}
          <KalipKayitKart
            testId="warehouse-kart"
            serit={
              <KalipKartSerit
                etiket={tw("k.hero")}
                ad={warehouseName}
                d={LICON.depo}
                tur={warehouseActive ? "lacivert" : "gri"}
                etiketler={[
                  { metin: warehouseCode, mono: true, testId: "kalip-code" },
                  warehouseActive ? { metin: tw("status.ACTIVE"), ton: "ok" } : { metin: tw("status.ARCHIVED"), ton: "kirmizi" },
                ]}
                kutular={[
                  { key: "locs", etiket: tw("k.boxLocs"), deger: countText, d: LICON.raf, ton: "camgobegi", testId: "kalip-total" },
                  ...(archivedCount === 0 ? [] : [{ key: "archived", etiket: tw("k.boxArchived"), deger: String(archivedCount), d: LICON.lock, ton: "gri" as const }]),
                ]}
                islemler={quick.map((q) => ({ key: q.key, etiket: q.label, d: q.d, ton: "camgobegi" as const, ...(q.onClick === undefined ? {} : { onClick: q.onClick }), testId: `kart-islem-${q.key}` }))}
                islemEtiket={tw("k.quick")}
              >
                {lockText === null ? null : (
                  <small id="tree-locked" className="stkbos">
                    {lockText}
                  </small>
                )}
              </KalipKartSerit>
            }
            ana={
              <>
                {guideNext === null ? null : guideNext === "locations" ? (
                  <button type="button" className="more" data-testid="setup-row" onClick={() => (canOpenDialogs ? openBulk() : undefined)} disabled={!canOpenDialogs}>
                    <i>
                      <Ico d={LICON.clip} size={20} />
                    </i>
                    {tw("k.next", { step: te("guide.locations.title") })}
                  </button>
                ) : (
                  <Link className="more" data-testid="setup-row" href={`/t/${encodeURIComponent(slug)}/items?new=1`}>
                    <i>
                      <Ico d={LICON.clip} size={20} />
                    </i>
                    {tw("k.next", { step: te("guide.items.title") })}
                  </Link>
                )}
                {codeChanged ? <CodeChangedNotice from={codeChanged.from} to={codeChanged.to} busy={undoing} onUndo={() => void undoCode()} /> : null}
                {error ? <ServerErrorBanner error={error.error} returnTo={returnTo} scope={error.scope} /> : null}
                <div data-testid="location-tree-card" className="flex min-w-0 flex-col gap-3">
                  <b className="stkbas">{t("title")}</b>
                {archivedCount === 0 ? null : (
                  <button
                    type="button"
                    className="btn"
                    style={{ ...actBtn("4E6476", false), alignSelf: "flex-start" }}
                    aria-pressed={showArchived}
                    onClick={() => {
                      feedback.minor();
                      setShowArchived((v) => !v);
                    }}
                    data-testid="location-archived-toggle"
                  >
                    <Ico d={LICON.lock} size={18} />
                    {showArchived ? t("hideArchived") : t("showArchived", { n: archivedCount })}
                  </button>
                )}
                {visible.length === 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-testid="location-empty">
                    <p style={{ margin: 0 }}>
                      <b style={{ display: "block" }}>{t("empty")}</b>
                      <small className="mono">{writable ? t("emptyAction") : t("emptyReadOnly")}</small>
                    </p>
                    {/* ALTIN-KURAL 8: boş listede sıradaki adım — yazabilen için ilk lokasyonu ekle (+), diğerine depo listesine dön (→). */}
                    {writable ? (
                      <button type="button" className="btn" style={actBtn("0E7C7B", !canOpenDialogs)} disabled={!canOpenDialogs} onClick={openRoot} data-testid="kalip-empty-action">
                        <Ico d={LICON.plus} size={18} />
                        {t("addFirst")}
                      </button>
                    ) : (
                      <Link className="btn" style={{ ...actBtn("172E42", false), textDecoration: "none" }} href={base} data-testid="kalip-empty-action">
                        <Ico d={LICON.arrow} size={18} />
                        {t("back")}
                      </Link>
                    )}
                  </div>
                ) : (
                  <ul className="whl" role="tree" aria-label={t("label")} style={{ margin: 0, padding: 0, listStyle: "none" }}>
                    {visible.map((it) => {
                      const hasChildren = (children.get(it.id) ?? []).length > 0;
                      const open = expanded.has(it.id);
                      const active = it.status === "ACTIVE";
                      const noteId = lockText === null ? undefined : "tree-locked";
                      return (
                        <li
                          key={it.id}
                          role="treeitem"
                          aria-level={it.depth + 1}
                          aria-expanded={hasChildren ? open : undefined}
                          data-testid="location-row"
                          data-status={it.status}
                          className="whr"
                          style={{ marginLeft: Math.min(it.depth, MAX_INDENT_STEPS) * INDENT_PX, opacity: active ? 1 : 0.7 }}
                        >
                          {hasChildren ? (
                            <button type="button" className={TOGGLE} aria-label={t(open ? "collapse" : "expand", { name: it.name })} aria-expanded={open} onClick={() => toggle(it.id)}>
                              {open ? "−" : "+"}
                            </button>
                          ) : (
                            <span className="dot" style={{ background: c(KIND_COLOR[it.kind] ?? "4E6476") }} />
                          )}
                          {/* T-1082: satır raf yeri kartını açar (raftakiler, son hareketler). */}
                          <Link
                            href={`/t/${encodeURIComponent(slug)}/warehouses/${encodeURIComponent(warehouseId)}/locations/${encodeURIComponent(it.id)}`}
                            prefetch={false}
                            style={{ minWidth: 0, minHeight: 44, display: "flex", flexDirection: "column", justifyContent: "center", textDecoration: "none", color: "inherit" }}
                            aria-label={tl("open", { name: it.name })}
                            data-testid="location-open"
                          >
                            <b>{it.name}</b>
                            <small>
                              {it.code} · {tk(it.kind)} · {t(`level.${levelKey(it.depth)}`)}
                            </small>
                          </Link>
                          <span className={`pill ${active ? "ok" : "warn"}`}>{active ? tw("status.ACTIVE") : tw("status.ARCHIVED")}</span>
                          {active ? (
                            <span role="group" aria-label={tw("actionsFor", { name: it.name })} style={{ gridColumn: "1 / -1", display: "flex", flexWrap: "wrap", gap: 6 }}>
                              <button
                                type="button"
                                className="btn"
                                style={actBtn("0E7C7B", !canOpenDialogs)}
                                disabled={!canOpenDialogs}
                                aria-describedby={noteId}
                                onClick={() => {
                                  feedback.minor();
                                  go(`new=1&parent=${encodeURIComponent(it.id)}`);
                                }}
                              >
                                <Ico d={LICON.plus} size={18} />
                                {t("addChild")}
                              </button>
                              <button
                                type="button"
                                className="btn"
                                style={actBtn("172E42", !canOpenDialogs)}
                                disabled={!canOpenDialogs}
                                aria-describedby={noteId}
                                aria-label={tw("codeEdit.for", { name: it.name })}
                                onClick={() => {
                                  feedback.minor();
                                  go(`kod=${encodeURIComponent(it.id)}`);
                                }}
                              >
                                <Ico d={LICON.pencil} size={18} />
                                {tw("codeEdit.button")}
                              </button>
                              <button
                                type="button"
                                className="btn"
                                style={actBtn("C62828", !canOpenDialogs)}
                                disabled={!canOpenDialogs}
                                aria-describedby={noteId}
                                onClick={() => {
                                  feedback.minor();
                                  setArchiving(it);
                                }}
                              >
                                <Ico d={LICON.trash} size={18} />
                                {t("archive")}
                              </button>
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {next === null ? null : (
                  <button type="button" className="more" onClick={() => void loadMore()} disabled={more} aria-busy={more} data-testid="location-more">
                    <i>
                      <Ico d={LICON.plus} size={20} />
                    </i>
                    {t("more")}
                  </button>
                )}
                </div>
              </>
            }
          />
        </KalipEkran>
      </div>

      <KalipOnay
        open={archiving !== null}
        title={t("confirmArchive.title", { name: archiving?.name ?? "" })}
        description={t("confirmArchive.description", { name: archiving?.name ?? "", code: archiving?.code ?? "" })}
        confirmLabel={t("confirmArchive.button")}
        cancelLabel={tw("form.cancel")}
        loading={busy}
        onConfirm={() => void archive()}
        onCancel={() => setArchiving(null)}
      />
    </>
  );
}
