"use client";
// Depo listesi ekranı (T-207). Yetki ve iş kuralları SUNUCUDADIR: `canManage` yalnızca gösterimdir (kilit + açıklama);
// eylemler sunucuda `settings.manage` ister. Kod normalleştirmesi (A-98) istemcide YOK: sunucunun döndürdüğü kod gösterilir.
// Mobilde kart görünümü (tablo yok → yatay taşma yok). Sunucu reddi neden + sonraki eylemle gösterilir.
// T-971 (B-63): LİSTE kalıbı (KalipListe.dc.html). Kart `.uc` bağlantısı "Lokasyonları aç"; kartın altında küçük `.btn` eylem satırı
// (kod değiştir / arşivle — `<a>` içine düğme gömülmez). T-978: arama (`.lsearch`, GET `q`: kod/ad, sunucuda listWarehouses). Bilinçli
// farklar: süzgeç çipi yok (yalnız aktif/arşivli; kart rozeti gösterir); rozet = aktif lokasyon sayısı (sunucu sayımı); bildirimler kalıp balonunda (toast).
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { Banner, feedback } from "@wms/ui";
import { LICON } from "../../../design/kalip-icons.ts";
import { Sheet } from "../easy-setup/sheet.tsx";
import { isSetupComplete, useSetupProgress, type SetupProgressView } from "../easy-setup/setup-guide.tsx";
import { CodeChangedNotice, CodeEditDialog } from "../code-edit-dialog.tsx";
import { Ico, KalipBaslik, KalipEkran, useKalipToast } from "../kalip/ekran.tsx";
import { KalipAra, KalipBos, KalipDaha, KalipKartListe, KalipKurulum, type KalipAdim } from "../kalip/liste.tsx";
import { KalipOnay, KalipPencereAlan, KalipPencereDugme, KalipPencereSecim } from "../kalip/pencere.tsx";
import { kdz } from "../kalip/tokens.ts";
import { archiveWarehouseAction, createWarehouseAction, renameWarehouseAction, suggestCodeAction } from "./actions.ts";

/** Sunucu eylem hatası (`ActionResult.error`): yalnızca kod + ayrıntı + istek kimliği kullanılır. */
export interface ServerError {
  readonly code: string;
  readonly detail?: string | undefined;
  readonly requestId?: string | undefined;
}

const KNOWN = ["idempotency_mismatch", "forbidden", "unauthenticated", "not_found", "validation_failed", "version_conflict", "rate_limited", "tenant_suspended", "tenant_closing", "internal"];
const DETAILED = [
  "forbidden_mfa_required",
  "forbidden_warehouse_out_of_scope",
  "unauthenticated_recent_auth_required",
  "validation_failed_code_taken",
  "validation_failed_code_ambiguous",
  "validation_failed_in_use",
  "validation_failed_plan_limit",
  "validation_failed_parent_invalid",
  "validation_failed_document_too_large",
  "validation_failed_idempotency_key_required",
];

/**
 * Sunucu hatası → `warehouses.errors.<anahtar>` (+ `<anahtar>Action` sonraki eylem). Kod/ayrıntı sunucudan gelir;
 * yalnızca bilinen eşlemeler kullanılır, aksi halde genel `internal`. `IN_USE` metni kapsama göre (depo/lokasyon) ayrışır.
 */
export function errorKey(error: Pick<ServerError, "code" | "detail">, scope: "warehouse" | "location" | "bulk" = "warehouse"): string {
  const base = error.code.toLowerCase();
  const key = KNOWN.includes(base) ? base : "internal";
  if (error.detail !== undefined) {
    const detailed = `${key}_${error.detail.toLowerCase()}`;
    if (DETAILED.includes(detailed)) {
      if (detailed === "validation_failed_in_use" && scope === "location") return "validation_failed_in_use_location";
      if (detailed === "validation_failed_code_taken" && scope === "bulk") return "validation_failed_code_taken_bulk";
      return detailed;
    }
  }
  return key;
}

/** Kod önerisi yanıt süresi sınırı; aşılırsa kod alanı açılır (T-259). */
const SUGGEST_TIMEOUT_MS = 5000;
const LINK_CLS =
  "inline-flex min-h-12 min-w-12 items-center justify-center rounded-control px-2 text-base font-semibold text-accent-ink underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus";

export function ServerErrorBanner({ error, returnTo, scope = "warehouse" }: { error: ServerError; returnTo: string; scope?: "warehouse" | "location" | "bulk" }) {
  const t = useTranslations("warehouses.errors");
  const key = errorKey(error, scope);
  return (
    <Banner kind="error">
      <p>
        {t(key)} {t(`${key}Action`)}
      </p>
      {error.detail === "MFA_REQUIRED" ? (
        <a className={LINK_CLS} href={`/mfa?next=${encodeURIComponent(returnTo)}`}>
          {t("mfaLink")}
        </a>
      ) : null}
      {error.detail === "RECENT_AUTH_REQUIRED" ? (
        <a className={LINK_CLS} href={`/login?reauth=1&next=${encodeURIComponent(returnTo)}`}>
          {t("loginLink")}
        </a>
      ) : null}
      <p className="mt-1 break-all text-sm">
        {t("code", { code: error.detail === undefined ? error.code : `${error.code}/${error.detail}` })}
        {error.requestId ? ` · ${error.requestId}` : ""}
      </p>
    </Banner>
  );
}

export interface CreateValues {
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  /** Kod kullanıcı tarafından değiştirilmedi (önerilen kod): çakışmada sunucu sıradaki öneriyle yeniden dener (T-250). */
  readonly autoCode: boolean;
}

/**
 * Oluşturma penceresi (depo ve lokasyon ortak, T-250). Açılışta sıradaki kod SUNUCUDAN istenir ve hazır gelir; zorunlu olan yalnızca ad.
 * `submit` sunucu eylemini çağırır; hata pencerede kalır, yazılanlar korunur. Telefonda tam ekran tek sütun, eylem çubuğu altta sabit.
 */
export function CreateDialog({
  open,
  title,
  intro,
  kinds,
  returnTo,
  scope,
  defaultName = "",
  suggest,
  onClose,
  onDone,
  submit,
}: {
  open: boolean;
  title: string;
  intro?: ReactNode;
  /** Verilirse tür seçimi gösterilir (değerler domain `LocationKindValue`). */
  kinds?: readonly string[];
  returnTo: string;
  scope: "warehouse" | "location";
  /** Ad alanının önerilen başlangıç değeri (akıllı varsayılan). */
  defaultName?: string;
  /** Sıradaki kodu sunucudan ister; başarısızsa `null` (kullanıcı kodu kendisi yazar). */
  suggest: () => Promise<string | null>;
  onClose: () => void;
  onDone: (result: unknown) => void;
  submit: (v: CreateValues) => Promise<{ ok: true; data?: unknown } | { ok: false; error: ServerError }>;
}) {
  const t = useTranslations("warehouses.form");
  const te = useTranslations("easySetup.code");
  const tk = useTranslations("warehouses.kind");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ServerError | null>(null);
  const [name, setName] = useState(defaultName);
  const [code, setCode] = useState("");
  const [kind, setKind] = useState("STORAGE");
  const [touched, setTouched] = useState(false);
  // Gecikmeli öneri yanıtı kapanışın (closure) bayat `touched` değerini görmesin diye ref (T-259 MINOR-2).
  const touchedRef = useRef(false);
  const [codeState, setCodeState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    if (!open) return;
    let live = true;
    setError(null);
    setName(defaultName);
    setKind("STORAGE");
    setTouched(false);
    touchedRef.current = false;
    setCode("");
    setCodeState("loading");
    // Öneri hiç dönmezse alan sonsuza dek salt okunur kalmasın: süre dolunca "failed" (kullanıcı kodu kendisi yazar).
    let settled = false;
    const timer = setTimeout(() => {
      if (live && !settled) {
        settled = true;
        setCodeState("failed");
      }
    }, SUGGEST_TIMEOUT_MS);
    void suggest().then((c) => {
      if (!live || settled) return;
      settled = true;
      clearTimeout(timer);
      if (c === null) setCodeState("failed");
      else {
        // Kullanıcı kodu değiştirdiyse (`touched`; silip boş bırakmak dahil) öneri uygulanmaz (N-14: sessiz değişiklik yok).
        if (!touchedRef.current) setCode(c);
        setCodeState("ready");
      }
    });
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // `suggest`/`defaultName` her açılışta okunur; kimlikleri değişse de form yeniden başlamaz.
  }, [open]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await submit({ code, name, kind, autoCode: !touched && codeState === "ready" });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onDone(res.data);
  }

  return (
    <Sheet
      open={open}
      title={title}
      titleId="create-dialog-title"
      icon={scope === "warehouse" ? { d: LICON.depo, color: "2F5DA8" } : { d: LICON.raf, color: "2F7D5B" }}
      busy={busy}
      onClose={onClose}
      onSubmit={(e) => void onSubmit(e)}
      footer={
        <>
          <KalipPencereDugme kind="cancel" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </KalipPencereDugme>
          <KalipPencereDugme type="submit" loading={busy} disabled={codeState === "loading"}>
            {t("submit")}
          </KalipPencereDugme>
        </>
      }
    >
      {intro ? <div className="kpt">{intro}</div> : null}
      <KalipPencereAlan label={t("name")} name="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" required maxLength={512} />
      <KalipPencereAlan
        label={t("code")}
        hint={codeState === "loading" ? te("loading") : codeState === "failed" ? te("failed") : touched ? `${te("custom")} ${t("codeHint")}` : `${te("suggested")} ${t("codeHint")}`}
        name="code"
        value={code}
        readOnly={codeState === "loading"}
        aria-busy={codeState === "loading"}
        onChange={(e) => {
          touchedRef.current = true;
          setTouched(true);
          setCode(e.target.value);
        }}
        autoComplete="off"
        autoCapitalize="characters"
        required
        maxLength={512}
      />
      {kinds === undefined ? null : (
        <KalipPencereSecim label={t("kind")} id="create-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {tk(k)}
            </option>
          ))}
        </KalipPencereSecim>
      )}
      {error ? <ServerErrorBanner error={error} returnTo={returnTo} scope={scope} /> : null}
    </Sheet>
  );
}


export interface WarehouseView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: "ACTIVE" | "ARCHIVED";
  /** Aktif lokasyon sayısı; `capped` ise gerçek sayı en az bu kadardır ("N+"). */
  readonly locationCount: number;
  readonly locationCountCapped: boolean;
}

const c = (hex: string): string => kdz("dzl", hex);
/** Kart eylem satırı düğmesi (kaynak `.btn`, küçük); kilitliyken soluk. */
const actBtn = (bg: string, disabled: boolean): CSSProperties => ({ background: c(bg), color: c("FFFFFF"), minHeight: 48, opacity: disabled ? 0.5 : 1 });

type StepKey = "warehouse" | "locations" | "items";

function setupSteps(slug: string, p: SetupProgressView): { key: StepKey; done: boolean; href: string | null }[] {
  const base = `/t/${encodeURIComponent(slug)}`;
  return [
    { key: "warehouse", done: p.hasWarehouse, href: null },
    { key: "locations", done: p.hasLocation, href: p.nextWarehouseId === null ? null : `${base}/warehouses/${encodeURIComponent(p.nextWarehouseId)}?bulk=1` },
    { key: "items", done: p.hasItem, href: `${base}/items?new=1` },
  ];
}

export function WarehousesView({
  slug,
  dark,
  canManage,
  warehouses,
  nextAfter,
  firstPage,
  q = "",
}: {
  slug: string;
  dark: boolean;
  canManage: boolean;
  warehouses: readonly WarehouseView[];
  /** Sonraki sayfa imleci (son görülen kod); yoksa `null`. */
  nextAfter: string | null;
  firstPage: boolean;
  /** T-978: sunucu araması (kod/ad); boş = tümü. */
  q?: string;
}) {
  const t = useTranslations("warehouses");
  const tk = useTranslations("warehouses.k");
  const te = useTranslations("easySetup");
  const locale = useLocale();
  const router = useRouter();
  const home = `/t/${encodeURIComponent(slug)}`;
  const base = `${home}/warehouses`;
  const [createOpen, setCreateOpen] = useState(false);
  const [archiving, setArchiving] = useState<WarehouseView | null>(null);
  const [editing, setEditing] = useState<WarehouseView | null>(null);
  const [codeChanged, setCodeChanged] = useState<{ readonly id: string; readonly from: string; readonly to: string } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ServerError | null>(null);
  const [version, setVersion] = useState(0);
  const progress = useSetupProgress(slug, canManage, version);
  const guide = canManage && progress !== null && !isSetupComplete(progress);
  const pathname = usePathname();
  const params = useSearchParams();
  const { say, node: toast } = useKalipToast("liste");
  const ok = (text: string): void => {
    feedback.ok();
    say("ok", text);
  };
  const fail = (e: ServerError): void => {
    feedback.error();
    setError(e);
  };

  // Rehberin büyük düğmesi `?new=1` ile gelir: formu aç, adresi temizle (yenilemede yeniden açılmasın).
  useEffect(() => {
    if (params.get("new") === "1" && canManage) {
      setCreateOpen(true);
      router.replace(pathname);
    }
  }, [params, canManage, pathname, router]);

  async function changeCode(id: string, code: string) {
    const r = await renameWarehouseAction({ slug, warehouseId: id, code });
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
      fail(r.error);
      return;
    }
    setCodeChanged(null);
    ok(t("done.codeUndone"));
    router.refresh();
  }

  async function archive() {
    if (archiving === null) return;
    setBusy(true);
    setError(null);
    const res = await archiveWarehouseAction({ slug, warehouseId: archiving.id });
    setBusy(false);
    setArchiving(null);
    if (!res.ok) {
      fail({ code: res.error.code, detail: res.error.detail, requestId: res.error.requestId });
      return;
    }
    ok(t("done.archived"));
    router.refresh();
  }

  const openCreate = (): void => {
    feedback.minor();
    setCreateOpen(true);
  };

  // Kurulum rehberi (KalipKurulum): şimdiki adım dolu renk; depo adımı bu ekranın formunu açar.
  const steps = guide && progress !== null ? setupSteps(slug, progress) : [];
  const nextStep = steps.find((s) => !s.done);
  const stepText: Record<StepKey, [string, string, string, string, string]> = {
    warehouse: [tk("stepWarehouse"), tk("stepWarehouseSub"), tk("stepWarehouseCta"), "30475A", LICON.depo],
    locations: [tk("stepLocations"), tk("stepLocationsSub"), tk("stepLocationsCta"), "0E7C7B", LICON.raf],
    items: [tk("stepItems"), tk("stepItemsSub"), tk("stepItemsCta"), "2F5DA8", LICON.box],
  };
  const blocked = (): void => {
    feedback.error();
    say("warn", nextStep === undefined ? "" : stepText[nextStep.key][0]);
  };
  const adimlar: KalipAdim[] = steps.map((s) => {
    const [title, sub, cta, color, d] = stepText[s.key];
    const state = s.done ? "done" : s === nextStep ? "now" : "locked";
    const act = state === "locked" || (s.key !== "warehouse" && s.href === null) ? { onClick: blocked } : s.href === null ? { onClick: openCreate } : { href: s.href };
    return { key: s.key, title, sub, cta, color, d, state, ...act };
  });
  const stepNo = nextStep === undefined ? 3 : steps.indexOf(nextStep) + 1;
  const setupSub = tk("setupSub", { step: nextStep?.key === "warehouse" ? tk("setupWarehouse") : nextStep?.key === "locations" ? tk("setupLocations") : tk("setupItems"), n: stepNo });
  const showSetup = guide && warehouses.length === 0 && firstPage && q === "";
  const countLbl = nextAfter === null && firstPage ? tk("count", { n: warehouses.length }) : tk("countMore", { n: warehouses.length });
  const lockedId = "warehouse-locked";

  return (
    <>
      <KalipEkran
        kind="liste"
        dark={dark}
        title={t("title")}
        icon={{ d: LICON.depo, color: "30475A" }}
        testId="warehouses"
        bar={{
          back: { href: home },
          main: { label: tk("add"), aria: t("create"), d: LICON.plus, disabled: !canManage, onClick: openCreate, testId: "warehouses-add" },
        }}
        overlays={toast}
      >
        {!canManage ? (
          <p className="sr" id={lockedId}>
            {t("lockedReason")}
          </p>
        ) : null}
        {codeChanged ? <CodeChangedNotice from={codeChanged.from} to={codeChanged.to} busy={undoing} onUndo={() => void undoCode()} /> : null}
        {error ? <ServerErrorBanner error={error} returnTo={base} /> : null}
        {guide && nextStep !== undefined && !showSetup ? (
          <KalipDaha
            {...(nextStep.key === "warehouse" ? { onClick: openCreate } : nextStep.href === null ? { onClick: blocked } : { href: nextStep.href })}
            iconD={LICON.clip}
            testId="setup-row"
          >
            {setupSub}
          </KalipDaha>
        ) : null}

        {showSetup ? null : <KalipAra label={t("search")} placeholder={t("searchPlaceholder")} action={base} defaultValue={q} />}
        {showSetup ? (
          <KalipKurulum title={tk("setupTitle")} sub={setupSub} steps={adimlar} testId="setup-guide" />
        ) : warehouses.length === 0 && q !== "" ? (
          <KalipBos title={t("noMatch")} hint={t("noMatchHint")} action={{ label: t("clearSearch"), href: base }} />
        ) : warehouses.length === 0 ? (
          <KalipBos title={t("empty")} hint={canManage ? t("emptyAction") : t("emptyReadOnly")} iconD={LICON.depo} />
        ) : (
          <>
            <KalipBaslik title={countLbl} hint={tk("hint")} />
            <KalipKartListe label={t("listLabel")}>
              {warehouses.map((w, i) => {
                const active = w.status === "ACTIVE";
                const count = w.locationCountCapped ? `${w.locationCount}+` : String(w.locationCount);
                const countText = w.locationCountCapped ? t("locationCountCapped", { count: w.locationCount }) : t("locationCount", { count: w.locationCount });
                const state = active ? t("status.ACTIVE") : t("status.ARCHIVED");
                return (
                  <div key={w.id} role="listitem" data-testid="warehouse-card" data-status={w.status} style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                    <a className="uc" style={{ animationDelay: `${i * 30}ms` }} href={`${base}/${encodeURIComponent(w.id)}`} aria-label={tk("cardAria", { name: w.name, code: w.code, count: countText, state })}>
                      <span className="uic" style={{ background: c(active ? "30475A" : "4E6476") }}>
                        <Ico d={LICON.depo} size={26} />
                      </span>
                      <span className="ut">
                        <b>{w.name}</b>
                        <small className="mono">{w.code}</small>
                        <span style={{ display: "flex", marginTop: 4 }}>
                          <span className={`pill ${active ? "ok" : "warn"}`}>{state.toLocaleUpperCase(locale === "en" ? "en" : "tr")}</span>
                        </span>
                      </span>
                      <span className="qb">
                        <b>{count}</b>
                        <small>{tk("locSub")}</small>
                      </span>
                    </a>
                    {active ? (
                      <div role="group" aria-label={t("actionsFor", { name: w.name })} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        <button
                          type="button"
                          className="btn"
                          style={actBtn("172E42", !canManage)}
                          disabled={!canManage}
                          aria-describedby={canManage ? undefined : lockedId}
                          aria-label={t("codeEdit.for", { name: w.name })}
                          onClick={() => {
                            feedback.minor();
                            setEditing(w);
                          }}
                        >
                          <Ico d={LICON.pencil} size={18} />
                          {t("codeEdit.button")}
                        </button>
                        <button
                          type="button"
                          className="btn"
                          style={actBtn("C62828", !canManage)}
                          disabled={!canManage}
                          aria-describedby={canManage ? undefined : lockedId}
                          onClick={() => {
                            feedback.minor();
                            setArchiving(w);
                          }}
                        >
                          <Ico d={LICON.trash} size={18} />
                          {t("archive")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </KalipKartListe>
          </>
        )}
        {firstPage && nextAfter === null ? null : (
          <nav aria-label={t("paging")} style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {firstPage ? null : (
              <KalipDaha href={q === "" ? base : `${base}?q=${encodeURIComponent(q)}`} iconD={LICON.chev}>
                {t("firstPage")}
              </KalipDaha>
            )}
            {nextAfter === null ? null : (
              <KalipDaha href={`${base}?${q === "" ? "" : `q=${encodeURIComponent(q)}&`}after=${encodeURIComponent(nextAfter)}`} iconD={LICON.plus}>
                {t("more")}
              </KalipDaha>
            )}
          </nav>
        )}
      </KalipEkran>

      <CreateDialog
        open={createOpen}
        title={t("createTitle")}
        returnTo={base}
        scope="warehouse"
        defaultName={progress !== null && !progress.hasWarehouse ? te("form.defaultWarehouseName") : ""}
        suggest={async () => {
          const r = await suggestCodeAction({ slug, kind: "warehouse" });
          return r.ok ? r.data.code : null;
        }}
        onClose={() => setCreateOpen(false)}
        onDone={(data) => {
          setCreateOpen(false);
          ok(t("done.created"));
          setVersion((n) => n + 1);
          // İlk depo: doğrudan raf oluşturucuya git (rehberin 2. adımı).
          const id = (data as { warehouseId?: string } | undefined)?.warehouseId;
          if (progress !== null && !progress.hasLocation && id !== undefined) router.push(`${base}/${encodeURIComponent(id)}?bulk=1`);
          else router.refresh();
        }}
        submit={async (v) => {
          const res = await createWarehouseAction({ slug, code: v.code, name: v.name, autoCode: v.autoCode });
          return res.ok ? { ok: true, data: res.data } : { ok: false, error: { code: res.error.code, detail: res.error.detail, requestId: res.error.requestId } };
        }}
      />
      <CodeEditDialog
        open={editing !== null}
        subject={editing?.name ?? ""}
        current={editing?.code ?? ""}
        titleId="code-edit-warehouse-title"
        onClose={() => setEditing(null)}
        submit={(code) => (editing === null ? Promise.resolve({ ok: false, error: { code: "NOT_FOUND" } } as const) : changeCode(editing.id, code))}
        renderError={(e) => <ServerErrorBanner error={e} returnTo={base} />}
        onDone={(r) => {
          const id = editing?.id;
          setEditing(null);
          setError(null);
          if (r.changed && id !== undefined) {
            feedback.ok();
            setCodeChanged({ id, from: r.from, to: r.to });
          } else ok(t("done.codeSame"));
          router.refresh();
        }}
      />
      <KalipOnay
        open={archiving !== null}
        title={t("confirmArchive.title", { name: archiving?.name ?? "" })}
        description={t("confirmArchive.description", { name: archiving?.name ?? "", code: archiving?.code ?? "" })}
        confirmLabel={t("confirmArchive.button")}
        cancelLabel={t("form.cancel")}
        loading={busy}
        onConfirm={() => void archive()}
        onCancel={() => setArchiving(null)}
      />
    </>
  );
}
