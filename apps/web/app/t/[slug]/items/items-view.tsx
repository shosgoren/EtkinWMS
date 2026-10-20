"use client";
// Ürün listesi ekranı (T-216; T-968 liste kalıbı, KalipListe.dc.html). Yetki ve iş kuralları SUNUCUDADIR: `canManage` yalnızca gösterimdir
// (kilit + açıklama); eylemler sunucuda `settings.manage` ister. Kod normalleştirmesi, takip modu ve ölçek kuralları istemcide YOK. Arama
// sunucudadır (GET formu, keyset imleç, OFFSET yok); yazdıkça canlı sonuç (`searchItemsAction`), Enter tek eşleşmede ürünü açar; barkod
// okuyucu (klavye kaması) ve kamera (CameraOverlay, T-286) aynı yolu kullanır. Süzgeç çipleri adresi değiştirir (kart türü / arşivli).
// Bilinçli farklar (DESIGN-PARITY, T-968): "Kritik" çipi yok (sunucu süzgeci yok; sorunlu kart yine dolu renk); çip sayıları yok;
// kart rozeti kapsamdaki depoların eldeki toplamı, trafik ışığı minimum politikasından (yoksa sakin); sesle arama Etkin (B-62) ile.
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Banner, Button, TextField } from "@wms/ui";
import { LICON } from "../../../design/kalip-icons.ts";
import { Sheet } from "../easy-setup/sheet.tsx";
import { isSetupComplete, useSetupProgress, type SetupProgressView } from "../easy-setup/setup-guide.tsx";
import { CameraOverlay } from "../field/receive/receive-flow.tsx";
import { KalipBaslik, KalipEkran, tone, useKalipToast } from "../kalip/ekran.tsx";
import { fmtQty, stockTone } from "../kalip/format.ts";
import { KalipAra, KalipBos, KalipCipler, KalipDaha, KalipKart, KalipKartListe, KalipKurulum, type KalipAdim, type KalipCip } from "../kalip/liste.tsx";
import { CARD_VISUAL } from "./card-visual.ts";
import { createItemAction, createUnitAction, searchItemsAction, suggestItemCodeAction } from "./actions.ts";

/** Sunucu eylem hatası (`ActionResult.error`): yalnızca kod + ayrıntı + istek kimliği kullanılır. */
export interface ServerError {
  readonly code: string;
  readonly detail?: string | undefined;
  readonly requestId?: string | undefined;
}

const KNOWN = ["forbidden", "unauthenticated", "not_found", "validation_failed", "version_conflict", "rate_limited", "tenant_suspended", "tenant_closing", "internal"];
const DETAILED = [
  "forbidden_mfa_required",
  "unauthenticated_recent_auth_required",
  "validation_failed_code_taken",
  "validation_failed_in_use",
  "validation_failed_plan_limit",
  "validation_failed_unit_conversion_invalid",
];

/** Sunucu hatası → `items.errors.<anahtar>` (+ `<anahtar>Action` sonraki eylem). Bilinmeyen kod genel `internal`'a düşer. */
export function errorKey(error: Pick<ServerError, "code" | "detail">): string {
  const base = error.code.toLowerCase();
  const key = KNOWN.includes(base) ? base : "internal";
  if (error.detail !== undefined) {
    const detailed = `${key}_${error.detail.toLowerCase()}`;
    if (DETAILED.includes(detailed)) return detailed;
  }
  return key;
}

export function toServerError(e: ServerError): ServerError {
  return { code: e.code, detail: e.detail, requestId: e.requestId };
}

export const LINK_CLS =
  "inline-flex min-h-12 min-w-12 items-center justify-center rounded-control px-2 text-base font-semibold text-accent-ink underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus";
export const BADGE = "inline-flex items-center rounded-full px-2 text-xs font-bold";
export const SELECT_CLS =
  "min-h-12 w-full min-w-0 rounded-card border-2 border-border-strong bg-surface px-4 text-base text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus";

export function ServerErrorBanner({ error, returnTo }: { error: ServerError; returnTo: string }) {
  const t = useTranslations("items.errors");
  const key = errorKey(error);
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

export interface UnitOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/** Arama sonucu (T-257): `oldCode` doluysa arama ESKİ kodla eşleşti ("bu kod {code} olarak değişti"). */
export interface ItemHit {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly oldCode?: string;
}

export interface ItemListView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: "ACTIVE" | "ARCHIVED";
  readonly baseUnitCode: string;
  readonly cardType: CardType;
  /** Arama eski kodla eşleştiyse o eski kod (T-257). */
  readonly oldCode?: string;
}

/** Kod önerisi yanıt süresi sınırı; aşılırsa kod alanı açılır (T-259). */
const SUGGEST_TIMEOUT_MS = 5000;
const TRACKING = ["NONE", "LOT", "SERIAL", "LOT_AND_SERIAL"] as const;
const PICK = ["FIFO", "FEFO"] as const;
const SCALES = [0, 1, 2, 3, 4, 5, 6] as const;
/** Kart türleri (T-911): sıra ekrandaki sıradır; ilk seçenek üretim firması için en sık kullanılan (hammadde). Kod öneki = tür. */
export const CARD_TYPES = ["HM", "YM", "MM", "TM"] as const;
export type CardType = (typeof CARD_TYPES)[number];

/** Akıllı varsayılan (A-250-5): birim ADET (sektör şablonları temel birim olarak ADET önerir). ADET yoksa SESSİZ SEÇİM YOK (T-259): boş kalır, kullanıcı seçer. */
function defaultUnitId(units: readonly UnitOption[]): string {
  return units.find((u) => u.code.toUpperCase() === "ADET")?.id ?? "";
}

/** Sunucunun `renamedFrom` bilgisini sonuç satırlarına işler; birden çok aday varsa hepsi listelenir (sessiz seçim yok, N-14). */
function withRenamed(data: {
  readonly items: readonly { readonly id: string; readonly code: string; readonly name: string }[];
  readonly renamedFrom: readonly { readonly itemId: string; readonly oldCode: string }[];
}): readonly ItemHit[] {
  const old = new Map(data.renamedFrom.map((r) => [r.itemId, r.oldCode] as const));
  return data.items.map((i) => {
    const oldCode = old.get(i.id);
    return oldCode === undefined ? i : { ...i, oldCode };
  });
}

function CreateItemDialog({ open, slug, units, returnTo, onClose, onDone }: { open: boolean; slug: string; units: readonly UnitOption[]; returnTo: string; onClose: () => void; onDone: (itemId: string) => void }) {
  const t = useTranslations("items.form");
  const te = useTranslations("easySetup");
  const tt = useTranslations("items.tracking");
  const tp = useTranslations("items.pick");
  const tc = useTranslations("items.cardType");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ServerError | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [touched, setTouched] = useState(false);
  // Gecikmeli öneri yanıtı kapanışın (closure) bayat `touched` değerini görmesin diye ref (T-259 MINOR-2).
  const touchedRef = useRef(false);
  const [codeState, setCodeState] = useState<"loading" | "ready" | "failed">("loading");
  const [unitList, setUnitList] = useState<readonly UnitOption[]>(units);
  const [unitId, setUnitId] = useState(() => defaultUnitId(units));
  const [cardType, setCardType] = useState<CardType>("HM");
  const [scale, setScale] = useState("0");
  const [tracking, setTracking] = useState("NONE");
  const [pick, setPick] = useState("FIFO");
  const [unitOpen, setUnitOpen] = useState(false);
  const [unitCode, setUnitCode] = useState("");
  const [unitName, setUnitName] = useState("");
  const [unitBusy, setUnitBusy] = useState(false);
  const [unitError, setUnitError] = useState<ServerError | null>(null);

  // Her açılışta akıllı varsayılanlar: HM, ADET, 0 ondalık, takip yok, FIFO; sıradaki kod sunucudan hazır gelir.
  // Kod önerisi kart türü önekiyle alınır (`HM-000001`, T-911); tür değişince kullanıcı koda dokunmadıysa öneri yenilenir.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setName("");
    setCode("");
    setTouched(false);
    touchedRef.current = false;
    setUnitList(units);
    setUnitId(defaultUnitId(units));
    setCardType("HM");
    setScale("0");
    setTracking("NONE");
    setPick("FIFO");
    setUnitOpen(false);
    setUnitCode("");
    setUnitName("");
    setUnitError(null);
    // units yalnızca açılışta okunur.
  }, [open, slug]);
  useEffect(() => {
    if (!open || touchedRef.current) return;
    let live = true;
    setCodeState("loading");
    // Öneri hiç dönmezse alan sonsuza dek salt okunur kalmasın: süre dolunca "failed" (kullanıcı kodu kendisi yazar).
    let settled = false;
    const timer = setTimeout(() => {
      if (live && !settled) {
        settled = true;
        setCodeState("failed");
      }
    }, SUGGEST_TIMEOUT_MS);
    void suggestItemCodeAction({ slug, prefix: cardType }).then((r) => {
      if (!live || settled) return;
      settled = true;
      clearTimeout(timer);
      if (r.ok) {
        // Kullanıcı kodu değiştirdiyse (`touched`; silip boş bırakmak dahil) öneri uygulanmaz (N-14: sessiz değişiklik yok).
        if (!touchedRef.current) setCode(r.data.code);
        setCodeState("ready");
      } else setCodeState("failed");
    });
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [open, slug, cardType]);

  async function onAddUnit() {
    setUnitBusy(true);
    setUnitError(null);
    const res = await createUnitAction({ slug, code: unitCode, name: unitName });
    setUnitBusy(false);
    if (!res.ok) {
      setUnitError(toServerError(res.error));
      return;
    }
    const added: UnitOption = { id: (res.data as { unitId: string }).unitId, code: unitCode.trim().toUpperCase(), name: unitName.trim() };
    setUnitList((list) => [...list, added].sort((a, b) => a.code.localeCompare(b.code)));
    setUnitId(added.id);
    setUnitOpen(false);
    setUnitCode("");
    setUnitName("");
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await createItemAction({
      slug,
      code,
      name,
      ...(unitList.length === 0 ? {} : { baseUnitId: unitId }),
      quantityScale: Number(scale),
      trackingMode: tracking,
      pickPolicy: pick,
      cardType,
      autoCode: !touched && codeState === "ready",
    });
    setBusy(false);
    if (!res.ok) {
      setError(toServerError(res.error));
      return;
    }
    onDone((res.data as { itemId: string }).itemId);
  }

  return (
    <Sheet
      open={open}
      title={t("createTitle")}
      titleId="create-item-title"
      onClose={onClose}
      onSubmit={(e) => void onSubmit(e)}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button type="submit" loading={busy} disabled={codeState === "loading"}>
            {t("submit")}
          </Button>
        </>
      }
    >
      <TextField label={t("name")} name="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" required maxLength={512} />
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor="create-card-type" className="text-base font-semibold">
          {t("cardType")}
        </label>
        <span className="text-sm text-ink-muted">{t("cardTypeHint")}</span>
        <select id="create-card-type" name="cardType" value={cardType} onChange={(e) => setCardType(e.target.value as CardType)} className={SELECT_CLS}>
          {CARD_TYPES.map((k) => (
            <option key={k} value={k}>
              {k} · {tc(k)}
            </option>
          ))}
        </select>
      </div>
      <TextField
        label={t("code")}
        hint={codeState === "loading" ? te("code.loading") : codeState === "failed" ? te("code.failed") : touched ? `${te("code.custom")} ${t("codeHint")}` : `${te("code.suggested")} ${t("codeHint")}`}
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
        required
        maxLength={512}
      />
      {unitList.length === 0 ? <Banner kind="info">{te("items.unitAuto")}</Banner> : null}
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor="create-base-unit" className="text-base font-semibold">
          {t("baseUnit")}
        </label>
        <span className="text-sm text-ink-muted">{t("baseUnitHint")}</span>
        {unitList.length > 0 && !unitList.some((u) => u.code.toUpperCase() === "ADET") ? <span className="text-sm font-semibold text-ink">{t("baseUnitChoose")}</span> : null}
        <select id="create-base-unit" name="baseUnitId" required={unitList.length > 0} disabled={unitList.length === 0} value={unitId} onChange={(e) => setUnitId(e.target.value)} className={SELECT_CLS}>
          {unitList.length === 0 ? <option value="">{te("items.unitDefaultOption")}</option> : null}
          {unitList.length > 0 && unitId === "" ? <option value="">{t("baseUnitPlaceholder")}</option> : null}
          {unitList.map((u) => (
            <option key={u.id} value={u.id}>
              {u.code} · {u.name}
            </option>
          ))}
        </select>
        {unitOpen ? (
          <div data-testid="new-unit" className="mt-2 flex min-w-0 flex-col gap-3 rounded-card border-2 border-border p-3">
            <TextField label={t("newUnitCode")} hint={t("newUnitCodeHint")} name="newUnitCode" value={unitCode} onChange={(e) => setUnitCode(e.target.value)} autoComplete="off" autoCapitalize="characters" maxLength={64} />
            <TextField label={t("newUnitName")} name="newUnitName" value={unitName} onChange={(e) => setUnitName(e.target.value)} autoComplete="off" maxLength={200} />
            {unitError ? <ServerErrorBanner error={unitError} returnTo={returnTo} /> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" loading={unitBusy} disabled={unitCode.trim() === "" || unitName.trim() === ""} onClick={() => void onAddUnit()}>
                {t("newUnitAdd")}
              </Button>
              <Button type="button" variant="secondary" disabled={unitBusy} onClick={() => setUnitOpen(false)}>
                {t("cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setUnitOpen(true)} className={`${LINK_CLS} self-start`}>
            {t("newUnit")}
          </button>
        )}
      </div>
      <details className="min-w-0 rounded-card border-2 border-border p-3">
        <summary className="flex min-h-12 cursor-pointer items-center text-base font-semibold">{t("advanced")}</summary>
        <div className="mt-2 flex min-w-0 flex-col gap-4">
          <p className="break-words text-sm text-ink-muted">{t("advancedHint")}</p>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="create-scale" className="text-base font-semibold">
              {t("scale")}
            </label>
            <span className="text-sm text-ink-muted">{t("scaleHint")}</span>
            <select id="create-scale" name="quantityScale" value={scale} onChange={(e) => setScale(e.target.value)} className={SELECT_CLS}>
              {SCALES.map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? t("scaleInteger") : t("scaleDecimals", { count: n })}
                </option>
              ))}
            </select>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="create-tracking" className="text-base font-semibold">
              {t("tracking")}
            </label>
            <select id="create-tracking" name="trackingMode" value={tracking} onChange={(e) => setTracking(e.target.value)} className={SELECT_CLS}>
              {TRACKING.map((k) => (
                <option key={k} value={k}>
                  {tt(k)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="create-pick" className="text-base font-semibold">
              {t("pick")}
            </label>
            <select id="create-pick" name="pickPolicy" value={pick} onChange={(e) => setPick(e.target.value)} className={SELECT_CLS}>
              {PICK.map((k) => (
                <option key={k} value={k}>
                  {tp(k)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </details>
      {error ? <ServerErrorBanner error={error} returnTo={returnTo} /> : null}
    </Sheet>
  );
}

type StepKey = "warehouse" | "locations" | "items";

function setupSteps(slug: string, p: SetupProgressView): { key: StepKey; done: boolean; href: string | null }[] {
  const base = `/t/${encodeURIComponent(slug)}`;
  return [
    { key: "warehouse", done: p.hasWarehouse, href: `${base}/warehouses?new=1` },
    { key: "locations", done: p.hasLocation, href: p.nextWarehouseId === null ? null : `${base}/warehouses/${encodeURIComponent(p.nextWarehouseId)}?bulk=1` },
    { key: "items", done: p.hasItem, href: null },
  ];
}

/** Liste kartının stok rozeti verisi (sunucu: kapsamdaki depoların eldeki toplamı + minimum). */
export interface ItemStockView {
  readonly have: string;
  readonly min: string | null;
}

export function ItemsView({
  slug,
  dark,
  canManage,
  canImport,
  items,
  stock,
  units,
  nextCursor,
  firstPage,
  query,
}: {
  slug: string;
  dark: boolean;
  canManage: boolean;
  canImport: boolean;
  items: readonly ItemListView[];
  stock: Readonly<Record<string, ItemStockView>>;
  units: readonly UnitOption[];
  /** Sonraki sayfa imleci (opak); yoksa `null`. */
  nextCursor: string | null;
  firstPage: boolean;
  query: { readonly q: string; readonly status: "" | "ACTIVE" | "ARCHIVED"; readonly type: "" | CardType };
}) {
  const t = useTranslations("items");
  const tk = useTranslations("items.k");
  const tx = useTranslations("kalip");
  const tc = useTranslations("items.cardType");
  const te = useTranslations("easySetup.items");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const home = `/t/${encodeURIComponent(slug)}`;
  const base = `${home}/items`;
  const [createOpen, setCreateOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const [cam, setCam] = useState(false);
  const progress = useSetupProgress(slug, canManage, version);
  const guide = canManage && progress !== null && !isSetupComplete(progress);
  const { say, node: toast } = useKalipToast("liste");
  const inputRef = useRef<HTMLInputElement>(null);

  // Rehberin büyük düğmesi `?new=1` ile gelir: formu aç, adresi temizle.
  useEffect(() => {
    if (params.get("new") === "1" && canManage) {
      setCreateOpen(true);
      router.replace(pathname);
    }
  }, [params, canManage, pathname, router]);
  const filtered = query.q !== "" || query.status !== "" || query.type !== "";
  const href = (next: { q?: string; status?: string; type?: string; after?: string }): string => {
    const p = new URLSearchParams();
    const q = next.q ?? query.q;
    const status = next.status ?? query.status;
    const type = next.type ?? query.type;
    if (q !== "") p.set("q", q);
    if (status !== "") p.set("status", status);
    if (type !== "") p.set("type", type);
    if (next.after !== undefined) p.set("after", next.after);
    const s = p.toString();
    return s === "" ? base : `${base}?${s}`;
  };

  // Yazdıkça canlı sonuç (sunucu araması, 200 ms bekleme, eski yanıt yok sayılır).
  const [typed, setTyped] = useState(query.q);
  const [live, setLive] = useState<readonly ItemHit[] | null>(null);
  const seq = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const onType = (value: string): void => {
    setTyped(value);
    window.clearTimeout(timer.current);
    const q = value.trim();
    if (q === "" || q === query.q) {
      seq.current++;
      setLive(null);
      return;
    }
    timer.current = window.setTimeout(() => {
      const mine = ++seq.current;
      void searchItemsAction({ slug, q, limit: 8 }).then((r) => {
        if (mine === seq.current) setLive(r.ok ? withRenamed(r.data) : []);
      });
    }, 200);
  };

  const [submitting, setSubmitting] = useState(false);
  /** Enter / okutma: tek eşleşme varsa doğrudan ürünü aç, yoksa/çoksa sonuç listesine git. */
  async function resolve(raw: string, fromScan: boolean): Promise<void> {
    const q = raw.trim();
    if (q === "") {
      router.push(href({ q: "" }));
      return;
    }
    setSubmitting(true);
    const r = await searchItemsAction({ slug, q, limit: 2 });
    setSubmitting(false);
    const hits = r.ok ? withRenamed(r.data) : [];
    if (hits.length === 1 && hits[0] !== undefined) {
      tone("ok");
      router.push(`${base}/${encodeURIComponent(hits[0].id)}`);
      return;
    }
    if (fromScan && hits.length === 0) {
      tone("err");
      say("warn", tk("scanNone", { code: q }));
    } else if (fromScan) say("info", tk("scanMany"));
    seq.current++;
    setLive(null);
    router.push(href({ q }));
  }
  function onSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void resolve(String(new FormData(event.currentTarget).get("q") ?? ""), false);
  }

  const visual = (type: CardType) => CARD_VISUAL[type];
  const chips: KalipCip[] = [
    { id: "all", label: tk("all"), d: LICON.grid, color: "172E42", on: query.type === "" && query.status === "", href: href({ type: "", status: "" }) },
    ...CARD_TYPES.map((k) => ({ id: k, label: tc(k), d: visual(k).d, color: visual(k).color, on: query.type === k, href: href({ type: query.type === k ? "" : k }) })),
    { id: "archived", label: tk("archived"), d: LICON.lock, color: "4E6476", on: query.status === "ARCHIVED", href: href({ status: query.status === "ARCHIVED" ? "" : "ARCHIVED" }) },
  ];

  const tones = items.map((it) => {
    const st = stock[it.id];
    return it.status === "ARCHIVED" || st === undefined ? "ok" : stockTone(st.have, st.min);
  });
  const attention = tones.filter((x) => x !== "ok").length;
  const countLbl = (nextCursor === null ? tk("count", { n: items.length }) : tk("countMore", { n: items.length })) + (attention > 0 && !filtered ? tk("dikkat", { n: attention }) : "");

  const steps = guide && progress !== null ? setupSteps(slug, progress) : [];
  const nextStep = steps.find((s) => !s.done);
  const stepTitle: Record<StepKey, [string, string, string, string, string]> = {
    warehouse: [tk("stepWarehouse"), tk("stepWarehouseSub"), tk("stepWarehouseCta"), "30475A", LICON.depo],
    locations: [tk("stepLocations"), tk("stepLocationsSub"), tk("stepLocationsCta"), "0E7C7B", LICON.raf],
    items: [tk("stepItems"), tk("stepItemsSub"), tk("stepItemsCta"), "2F5DA8", LICON.box],
  };
  const blocked = (): void => {
    tone("err");
    say("warn", nextStep === undefined ? "" : stepTitle[nextStep.key][0]);
  };
  const adimlar: KalipAdim[] = steps.map((s) => {
    const [title, sub, cta, color, d] = stepTitle[s.key];
    const state = s.done ? "done" : s === nextStep ? "now" : "locked";
    const act = state === "locked" ? { onClick: blocked } : s.href === null ? { onClick: () => setCreateOpen(true) } : { href: s.href };
    return { key: s.key, title, sub, cta, color, d, state, ...act };
  });
  const stepNo = nextStep === undefined ? 3 : steps.indexOf(nextStep) + 1;
  const setupSub = tk("setupSub", { step: nextStep?.key === "warehouse" ? tk("setupWarehouse") : nextStep?.key === "locations" ? tk("setupLocations") : tk("setupItems"), n: stepNo });
  const noWarehouse = guide && progress !== null && !progress.hasWarehouse;

  const listRows = live ?? null;
  const showSetup = guide && items.length === 0 && !filtered && live === null;

  return (
    <>
      <KalipEkran
        kind="liste"
        dark={dark}
        title={t("title")}
        icon={{ d: LICON.box, color: "2F5DA8" }}
        testId="items"
        bar={{
          back: { href: home },
          main: noWarehouse
            ? { label: tk("addWarehouse"), aria: tk("stepWarehouse"), d: LICON.plus, href: `${home}/warehouses?new=1`, testId: "items-add" }
            : {
                label: tk("add"),
                aria: tk("addAria"),
                d: LICON.plus,
                disabled: !canManage,
                onClick: () => {
                  tone("tap");
                  setCreateOpen(true);
                },
                testId: "items-add",
              },
        }}
        overlays={toast}
      >
        <KalipAra
          label={t("search.label")}
          placeholder={tk("searchPh")}
          action={base}
          value={typed}
          onChange={onType}
          onSubmit={onSearchSubmit}
          busy={submitting}
          inputRef={inputRef}
          onCamera={() => {
            tone("tap");
            setCam(true);
          }}
          cameraLabel={tk("camera")}
          onMic={() => {
            tone("tap");
            say("info", tx("voiceSoon"));
          }}
          micLabel={tk("mic")}
          micSoon
        />
        <KalipCipler label={tk("filter")} chips={chips} />
        {!canManage ? <p className="sr">{t("lockedReason")}</p> : null}
        {guide && nextStep !== undefined && items.length > 0 ? (
          <KalipDaha href={nextStep.href ?? undefined} onClick={nextStep.href === null ? () => setCreateOpen(true) : undefined} iconD={LICON.clip} testId="setup-row">
            {setupSub}
          </KalipDaha>
        ) : null}

        {listRows !== null ? (
          listRows.length === 0 ? (
            <KalipBos title={tk("noMatch")} hint={tk("noMatchHint")} />
          ) : (
            <KalipKartListe label={te("searchSuggestLabel")} role="listbox" id="items-live">
              {listRows.map((it, i) => (
                <KalipKart
                  key={it.id}
                  index={i}
                  name={it.name}
                  code={it.oldCode === undefined ? it.code : t("renamedNote", { code: it.code, old: it.oldCode })}
                  d={LICON.box}
                  color="2F5DA8"
                  href={`${base}/${encodeURIComponent(it.id)}`}
                  aria={`${it.name} · ${it.code}`}
                  role="option"
                  testId="item-hit"
                />
              ))}
            </KalipKartListe>
          )
        ) : showSetup ? (
          <>
            <KalipKurulum title={tk("setupTitle")} sub={setupSub} steps={adimlar} />
            {canImport ? (
              <KalipDaha href={`${home}/import`} iconD={LICON.excel} iconColor="1E7B45" testId="items-import">
                {tk("import")}
              </KalipDaha>
            ) : null}
          </>
        ) : items.length === 0 ? (
          filtered ? (
            <KalipBos
              title={query.q === "" ? tk("noStatus") : tk("noMatch")}
              hint={query.q === "" ? tk("noStatusHint") : tk("noMatchHint")}
              action={{ label: tk("clear"), href: base }}
            />
          ) : (
            <KalipBos title={t("empty")} hint={canManage ? t("emptyAction") : t("emptyReadOnly")} />
          )
        ) : (
          <>
            <KalipBaslik title={countLbl} hint={tk("hint")} />
            <KalipKartListe label={t("listLabel")}>
              {items.map((it, i) => {
                const v = visual(it.cardType);
                const st = stock[it.id];
                const tn = tones[i] ?? "ok";
                const archived = it.status === "ARCHIVED";
                const state = archived ? tk("archivedTag") : st === undefined ? "" : tn === "crit" ? tk("stockCrit") : tn === "low" ? tk("stockLow") : st.have.replace(/[0.]/g, "") === "" ? tk("stockNone") : tk("stockIn");
                const qty = st === undefined ? "" : fmtQty(st.have, locale);
                const meta = [tc(it.cardType).toLocaleUpperCase(locale === "en" ? "en" : "tr"), tk("unitTag", { unit: it.baseUnitCode })].join(" · ");
                return (
                  <KalipKart
                    key={it.id}
                    index={i}
                    name={it.name}
                    code={it.oldCode === undefined ? it.code : t("renamedNote", { code: it.code, old: it.oldCode })}
                    meta={meta}
                    d={v.d}
                    color={v.color}
                    tone={tn}
                    {...(st === undefined ? {} : { badge: { value: qty, sub: `${it.baseUnitCode} · ${state}` } })}
                    href={`${base}/${encodeURIComponent(it.id)}`}
                    aria={tk("cardAria", { name: it.name, code: it.code, qty, unit: it.baseUnitCode, state })}
                    testId="item-card"
                  >
                    <span hidden data-status={it.status} data-card-type={it.cardType} />
                  </KalipKart>
                );
              })}
            </KalipKartListe>
            {firstPage && nextCursor === null ? null : (
              <nav aria-label={t("paging")} style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {firstPage ? null : (
                  <KalipDaha href={href({})} iconD={LICON.chev}>
                    {t("firstPage")}
                  </KalipDaha>
                )}
                {nextCursor === null ? null : (
                  <KalipDaha href={href({ after: nextCursor })} iconD={LICON.plus}>
                    {t("more")}
                  </KalipDaha>
                )}
              </nav>
            )}
          </>
        )}
      </KalipEkran>

      {cam ? (
        <CameraOverlay
          onCode={(code) => {
            setCam(false);
            void resolve(code, true);
            return true;
          }}
          onClose={() => setCam(false)}
          onManual={() => {
            setCam(false);
            inputRef.current?.focus();
          }}
        />
      ) : null}

      <CreateItemDialog
        open={createOpen}
        slug={slug}
        units={units}
        returnTo={base}
        onClose={() => setCreateOpen(false)}
        onDone={(itemId) => {
          setCreateOpen(false);
          setVersion((n) => n + 1);
          router.push(`${base}/${encodeURIComponent(itemId)}`);
        }}
      />
    </>
  );
}
