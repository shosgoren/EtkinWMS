"use client";
// Ürün listesi ekranı (T-216; T-968 liste kalıbı, KalipListe.dc.html). Yetki ve iş kuralları SUNUCUDADIR: `rights` (T-1141 `cardRights`) yalnızca gösterimdir
// (kilit + açıklama); eylemler sunucuda `items.create` vb. ister. Kod normalleştirmesi, takip modu ve ölçek kuralları istemcide YOK. Arama
// sunucudadır (GET formu, keyset imleç, OFFSET yok); yazdıkça canlı sonuç (`searchItemsAction`), Enter tek eşleşmede ürünü açar; barkod
// okuyucu (klavye kaması) ve kamera (CameraOverlay, T-286) aynı yolu kullanır. Süzgeç çipleri adresi değiştirir (kart türü / arşivli).
// Bilinçli farklar (DESIGN-PARITY, T-968): "Kritik" çipi yok (sunucu süzgeci yok; sorunlu kart yine dolu renk); çip sayıları yok;
// kart rozeti kapsamdaki depoların eldeki toplamı, trafik ışığı minimum politikasından (yoksa sakin); sesle arama Etkin (B-62) ile.
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { FormEvent } from "react";
import { feedback } from "@wms/ui";
import { LICON } from "../../../design/kalip-icons.ts";
import { CameraOverlay } from "../field/receive/receive-flow.tsx";
import { KalipUyari } from "../kalip/detay.tsx";
import { Ico, KalipBaslik, KalipEkran, useKalipToast } from "../kalip/ekran.tsx";
import { fmtQty, stockTone } from "../kalip/format.ts";
import { KalipAra, KalipBos, KalipCipler, KalipKart, KalipKartListe, type KalipCip } from "../kalip/liste.tsx";
import { YolculukGiris } from "../yolculuk/yolculuk.tsx";
import { KalipGorunumSec, KalipSonsuz, KalipSutunSec, KalipTablo, useKalipDerinlik, useKalipGorunum, useKalipSutunlar, type KalipSutun } from "../kalip/tablo.tsx";
import { KalipListeGorsel } from "../kalip/gorsel.tsx";
import type { AlanKurali } from "../kalip/dogrula.ts";
import { KalipFormEkran, KalipOnizleme, type KaydetSonuc } from "../kalip/form-ekran.tsx";
import { KalipAlan, KalipGrup, KalipSabit } from "../kalip/form.tsx";
import { KalipSecim, KalipSecimGrubu } from "../kalip/secim.tsx";
import { useKartKilitGerekce } from "../kalip/kilitli.tsx";
import type { KartYetki as CardRights } from "../kalip/kart-yetki.ts";
import { eskiSurumBildir, eskiSurumMu, eylem } from "../kalip/surum.tsx";
import { ItemFiltersView } from "./filters-view.tsx";
import { extraFilterParams, type ItemExtraFilters } from "./filters.ts";
import { watchListUpdates } from "../kalip/canli-liste.ts";
import { CARD_VISUAL } from "./card-visual.ts";
import { createItemAction, createUnitAction, loadMoreItemsAction, searchItemsAction, suggestItemCodeAction } from "./actions.ts";

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
  // T-1160: ürün görseli ve min / maks.
  "validation_failed_image_invalid",
  "validation_failed_image_too_large",
  "validation_failed_image_limit",
  "validation_failed_min_max_invalid",
  "validation_failed_quantity_scale",
  "validation_failed_image_quota",
  "rate_limited_image_busy",
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

// T-1117 (kullanıcı 28 Ekim: eski tasarım öğesi kalmasın): sunucu hatası eski `@wms/ui` Banner değil, kalıbın kırmızı uyarı bandı
// (`KalipUyari`): başlık = ne oldu + sonraki eylem, alt satır = destek kodu; MFA / yeniden giriş bağlantıları bandın içinde.
export function ServerErrorBanner({ error, returnTo }: { error: ServerError; returnTo: string }) {
  const t = useTranslations("items.errors");
  const key = errorKey(error);
  const kod = `${t("code", { code: error.detail === undefined ? error.code : `${error.code}/${error.detail}` })}${error.requestId ? ` · ${error.requestId}` : ""}`;
  const link =
    error.detail === "MFA_REQUIRED" ? (
      <a href={`/mfa?next=${encodeURIComponent(returnTo)}`}>{t("mfaLink")}</a>
    ) : error.detail === "RECENT_AUTH_REQUIRED" ? (
      <a href={`/login?reauth=1&next=${encodeURIComponent(returnTo)}`}>{t("loginLink")}</a>
    ) : undefined;
  return (
    <KalipUyari title={`${t(key)} ${t(`${key}Action`)}`} sub={kod} alert>
      {link}
    </KalipUyari>
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
  readonly sourceDisposition?: "NONE"|"PENDING"|"ARCHIVED"|"REMOVED";
  readonly baseUnitCode: string;
  readonly cardType: CardType;
  /** Arama eski kodla eşleştiyse o eski kod (T-257). */
  readonly oldCode?: string;
  /** T-1117: listenin "Barkod" sütunu — ürünün ilk barkodu (temel birimdeki önce); yoksa alan yok. */
  readonly barcode?: string;
  /** T-1160: "Görsel" sütunu — kapak küçük resmi (`data:` adresi) ve görsel sayısı; görselsiz üründe yok. */
  readonly image?: { readonly thumb: string | null; readonly count: number };
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

/** Sunucu hatası → formda gösterim: kod çakışması kod alanının altında, diğerleri genel neden. */
function itemSaveError(e: ServerError, tr: (k: string) => string): KaydetSonuc {
  const key = errorKey(e);
  const text = `${tr(key)} ${tr(`${key}Action`)}`.trim();
  if (key === "validation_failed_code_taken") return { ok: false, alan: { code: text } };
  return { ok: false, mesaj: e.requestId === undefined ? text : `${text} · ${e.requestId}` };
}

/**
 * Yeni ürün — TAM EKRAN FORM (T-990; adres `?new=1`). Akıllı varsayılanlar: kart türü HM, birim ADET (yoksa sessiz seçim yok), 0 ondalık,
 * takip yok, FIFO; kod sunucudan önerilir (tür önekiyle, `HM-000001`). Kart türü/birim/takip/toplama renkli seçim kutuları ya da aramalı
 * seçim sayfası (yerel açılır liste yok). Doğrulama, çıkış kutusu ve Kaydet ortak `KalipFormEkran`'dadır.
 */
function ItemForm({ slug, dark, units, onBack, onDone }: { slug: string; dark: boolean; units: readonly UnitOption[]; onBack: () => void; onDone: (itemId: string) => void }) {
  const t = useTranslations("items.form");
  const terr = useTranslations("items.errors");
  const te = useTranslations("easySetup");
  const tt = useTranslations("items.tracking");
  const tp = useTranslations("items.pick");
  const tc = useTranslations("items.cardType");
  const initialV = { name: "", code: "", cardType: "HM" as CardType, unitId: defaultUnitId(units), scale: "0", tracking: "NONE", pick: "FIFO" };
  const [initial, setInitial] = useState(initialV);
  const [v, setV] = useState(initialV);
  const [touched, setTouched] = useState(false);
  // Gecikmeli öneri yanıtı kapanışın (closure) bayat `touched` değerini görmesin diye ref (T-259 MINOR-2).
  const touchedRef = useRef(false);
  const [codeState, setCodeState] = useState<"loading" | "ready" | "failed">("loading");
  const [unitList, setUnitList] = useState<readonly UnitOption[]>(units);
  const [unitOpen, setUnitOpen] = useState(false);
  const [unitCode, setUnitCode] = useState("");
  const [unitName, setUnitName] = useState("");
  const [unitBusy, setUnitBusy] = useState(false);
  const [unitError, setUnitError] = useState<string | null>(null);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]): void => setV((cur) => ({ ...cur, [k]: val }));

  // Kod önerisi kart türü önekiyle alınır (`HM-000001`, T-911); tür değişince kullanıcı koda dokunmadıysa öneri yenilenir.
  // T-990 kök neden: çağrı reddedilirse (yayından sonra eski sayfa: "Server Action not found") `.then` hiç çalışmıyor, 5 sn sonra
  // yanıltıcı "öneri alınamadı" yazıyordu. Ret yakalanır; eski sürümse "Uygulama güncellendi — Yenile" penceresi açılır.
  const cardType = v.cardType;
  useEffect(() => {
    if (touchedRef.current) return;
    let live = true;
    setCodeState("loading");
    let settled = false;
    const timer = setTimeout(() => {
      if (live && !settled) {
        settled = true;
        setCodeState("failed");
      }
    }, SUGGEST_TIMEOUT_MS);
    const done = (code: string | null): void => {
      if (!live || settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === null) {
        setCodeState("failed");
        return;
      }
      // Kullanıcı kodu değiştirdiyse öneri uygulanmaz (N-14: sessiz değişiklik yok). Öneri "değişiklik" sayılmaz: başlangıç da güncellenir.
      if (!touchedRef.current) {
        setV((cur) => ({ ...cur, code }));
        setInitial((cur) => ({ ...cur, code }));
      }
      setCodeState("ready");
    };
    suggestItemCodeAction({ slug, prefix: cardType }).then(
      (r) => done(r.ok ? r.data.code : null),
      (e: unknown) => {
        if (eskiSurumMu(e)) eskiSurumBildir();
        done(null);
      },
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [slug, cardType]);

  async function onAddUnit(): Promise<void> {
    if (unitCode.trim() === "" || unitName.trim() === "") {
      feedback.error();
      setUnitError(te("form.required"));
      return;
    }
    setUnitBusy(true);
    setUnitError(null);
    const res = await eylem(() => createUnitAction({ slug, code: unitCode, name: unitName }));
    setUnitBusy(false);
    if (res === null || !res.ok) {
      feedback.error();
      setUnitError(res === null ? terr("internal") : `${terr(errorKey(res.error))} ${terr(`${errorKey(res.error)}Action`)}`);
      return;
    }
    feedback.ok();
    const added: UnitOption = { id: (res.data as { unitId: string }).unitId, code: unitCode.trim().toUpperCase(), name: unitName.trim() };
    setUnitList((list) => [...list, added].sort((a, b) => a.code.localeCompare(b.code)));
    set("unitId", added.id);
    setUnitOpen(false);
    setUnitCode("");
    setUnitName("");
  }

  async function save(): Promise<KaydetSonuc> {
    const res = await createItemAction({
      slug,
      code: v.code,
      name: v.name,
      ...(unitList.length === 0 ? {} : { baseUnitId: v.unitId }),
      quantityScale: Number(v.scale),
      trackingMode: v.tracking,
      pickPolicy: v.pick,
      cardType: v.cardType,
      autoCode: !touched && codeState === "ready",
    });
    if (!res.ok) return itemSaveError(toServerError(res.error), (k) => terr(k));
    created.current = (res.data as { itemId: string }).itemId;
    return { ok: true };
  }
  const created = useRef<string | null>(null);

  const rules: AlanKurali[] = [
    { name: "name", label: t("name"), required: true, maxLength: 512 },
    { name: "cardType", label: t("cardType"), required: true },
    { name: "code", label: t("code"), required: true, maxLength: 512 },
    ...(unitList.length === 0 ? [] : [{ name: "unitId", label: t("baseUnit"), required: true }]),
  ];
  const vis = CARD_VISUAL[v.cardType];
  const unit = unitList.find((u) => u.id === v.unitId);
  const codeHint =
    codeState === "loading" ? te("code.loading") : codeState === "failed" ? te("code.failed") : touched ? `${te("code.custom")} ${t("codeHint")}` : `${te("code.suggested")} ${t("codeHint")}`;
  return (
    <KalipFormEkran
      dark={dark}
      title={t("createTitle")}
      icon={{ d: vis.d, color: vis.color }}
      testId="item-form"
      values={v}
      initial={initial}
      rules={rules}
      onSave={save}
      onDone={() => {
        if (created.current !== null) onDone(created.current);
      }}
      onBack={onBack}
      preview={
        <KalipOnizleme
          name={v.name}
          code={v.code}
          d={vis.d}
          color={vis.color}
          kind={tc(v.cardType)}
          rows={unit === undefined ? [] : [{ k: t("baseUnit"), v: `${unit.code} · ${unit.name}` }]}
        />
      }
    >
      <KalipGrup title={t("createTitle")} sub={t("cardTypeHint")} d={vis.d} color={vis.color}>
        <KalipAlan label={`${t("name")} *`} name="name" value={v.name} onChange={(e) => set("name", e.target.value)} autoComplete="off" maxLength={512} />
        <KalipSecimGrubu
          name="cardType"
          label={t("cardType")}
          value={v.cardType}
          color={vis.color}
          onPick={(id) => set("cardType", id as CardType)}
          options={CARD_TYPES.map((k) => ({ id: k, label: tc(k), sub: k, d: CARD_VISUAL[k].d, color: CARD_VISUAL[k].color }))}
          testId="item-card-type"
        />
        <KalipAlan
          label={`${t("code")} *`}
          hint={codeHint}
          name="code"
          value={v.code}
          readOnly={codeState === "loading"}
          aria-busy={codeState === "loading"}
          onChange={(e) => {
            touchedRef.current = true;
            setTouched(true);
            set("code", e.target.value);
          }}
          autoComplete="off"
          maxLength={512}
        />
      </KalipGrup>
      <KalipGrup title={t("baseUnit")} sub={t("baseUnitHint")} d={LICON.tag} color="2F5DA8">
        {unitList.length === 0 ? (
          <KalipSabit title={te("items.unitDefaultOption")} d={LICON.tag} color="2F5DA8" pill={{ label: te("items.unitAuto"), ok: true }} aria={te("items.unitAuto")} />
        ) : (
          <KalipSecim
            name="unitId"
            label={t("baseUnit")}
            {...(unitList.some((u) => u.code.toUpperCase() === "ADET") ? {} : { hint: t("baseUnitChoose") })}
            value={v.unitId}
            color="2F5DA8"
            placeholder={t("baseUnitPlaceholder")}
            icon={{ d: LICON.tag, color: "2F5DA8" }}
            onPick={(id) => set("unitId", id)}
            options={unitList.map((u) => ({ id: u.id, label: u.code, sub: u.name, keys: [u.name] }))}
            testId="item-base-unit"
          />
        )}
        {unitOpen ? (
          <div data-testid="new-unit" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <KalipAlan label={t("newUnitCode")} hint={t("newUnitCodeHint")} error={unitError ?? undefined} name="newUnitCode" value={unitCode} onChange={(e) => setUnitCode(e.target.value)} autoComplete="off" autoCapitalize="characters" maxLength={64} />
            <KalipAlan label={t("newUnitName")} name="newUnitName" value={unitName} onChange={(e) => setUnitName(e.target.value)} autoComplete="off" maxLength={200} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn n" disabled={unitBusy} onClick={() => setUnitOpen(false)}>
                {t("cancel")}
              </button>
              <button type="button" className="btn" aria-busy={unitBusy || undefined} onClick={() => void onAddUnit()}>
                <Ico d={LICON.plus} size={18} />
                {t("newUnitAdd")}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn n" onClick={() => setUnitOpen(true)} style={{ alignSelf: "flex-start" }}>
            <Ico d={LICON.plus} size={18} />
            {t("newUnit")}
          </button>
        )}
      </KalipGrup>
      <KalipGrup title={t("advanced")} sub={t("advancedHint")} d={LICON.gear} color="4E6476">
        <KalipSecim
          name="scale"
          label={t("scale")}
          hint={t("scaleHint")}
          value={v.scale}
          color="4E6476"
          list
          icon={{ d: LICON.gear, color: "4E6476" }}
          onPick={(id) => set("scale", id)}
          options={SCALES.map((n) => ({ id: String(n), label: n === 0 ? t("scaleInteger") : t("scaleDecimals", { count: n }) }))}
          testId="item-scale"
        />
        <KalipSecimGrubu name="tracking" label={t("tracking")} value={v.tracking} color="6C4BD8" onPick={(id) => set("tracking", id)} options={TRACKING.map((k) => ({ id: k, label: tt(k), d: k === "NONE" ? LICON.close : LICON.tag }))} testId="item-tracking" />
        <KalipSecimGrubu name="pick" label={t("pick")} value={v.pick} color="0E7C7B" onPick={(id) => set("pick", id)} options={PICK.map((k) => ({ id: k, label: tp(k), d: k === "FIFO" ? LICON.arrow : LICON.clock }))} testId="item-pick" />
      </KalipGrup>
    </KalipFormEkran>
  );
}


/** Liste kartının stok rozeti verisi (sunucu: kapsamdaki depoların eldeki toplamı + minimum). */
/** T-1047: liste görünümü satırı (kartla aynı hesap). */
interface ItemsSatir {
  readonly it: ItemListView;
  readonly st: ItemStockView | undefined;
  readonly tn: "ok" | "crit" | "low";
  readonly archived: boolean;
  readonly state: string;
  readonly qty: string;
  /** T-1117: kullanılabilir miktar (biçimli). */
  readonly avail: string;
}

export interface ItemStockView {
  readonly have: string;
  readonly min: string | null;
  /** T-1117: kullanılabilir miktar (stok özetiyle aynı tanım; decimal metni). */
  readonly available: string;
}

export function ItemsView({
  slug,
  dark,
  rights,
  items: ilkItems,
  stock: ilkStock,
  units,
  nextCursor,
  total,
  query,
}: {
  slug: string;
  dark: boolean;
  /** T-1141: kart bölümü yetkileri (yalnız gösterim; karar domain'de). */
  rights: CardRights;
  items: readonly ItemListView[];
  stock: Readonly<Record<string, ItemStockView>>;
  units: readonly UnitOption[];
  /** Sonraki sayfa imleci (opak); yoksa `null`. */
  nextCursor: string | null;
  /** Sunucudan süzgece uyan toplam ürün sayısı (ALTIN-KURAL 15). */
  total?: number;
  /** T-1055'ten beri yalnız eski `?after=` adresleri için (kaydırmalı listede kullanılmaz). */
  firstPage?: boolean;
  query: { readonly q: string; readonly status: "" | "ACTIVE" | "ARCHIVED" | "REMOVED"; readonly type: "" | CardType } & ItemExtraFilters;
}) {
  const t = useTranslations("items");
  const tk = useTranslations("items.k");
  const tp = useTranslations("items.productLabels");
  const tx = useTranslations("kalip");
  const tc = useTranslations("items.cardType");
  const te = useTranslations("easySetup.items");
  const tr = useTranslations("kural");
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const home = `/t/${encodeURIComponent(slug)}`;
  const base = `${home}/items`;

  const [cam, setCam] = useState(false);
  const { say, node: toast } = useKalipToast("liste");
  const inputRef = useRef<HTMLInputElement>(null);
  const [gorunum, setGorunum] = useKalipGorunum("items");
  // T-1055: kaydırınca eklenen sayfalar (sunucunun ilk sayfasının devamı). Süzgeç / arama değişince (yeni ilk sayfa) sıfırlanır.
  const [ek, setEk] = useState<{ readonly bas: readonly ItemListView[]; readonly rows: readonly ItemListView[]; readonly stock: Readonly<Record<string, ItemStockView>>; readonly cursor: string | null }>({ bas: ilkItems, rows: [], stock: {}, cursor: nextCursor });
  const guncel = ek.bas === ilkItems ? ek : { bas: ilkItems, rows: [], stock: {}, cursor: nextCursor };
  if (guncel !== ek) setEk(guncel);
  // Sonraki sayfalar arada kaymış olabilir (ör. bir ürün arşivlendi): aynı ürün iki kez çizilmez.
  const items = useMemo(() => {
    const ilk = new Set(ilkItems.map((i) => i.id));
    return [...ilkItems, ...guncel.rows.filter((r) => !ilk.has(r.id))];
  }, [ilkItems, guncel.rows]);
  const stock = useMemo(() => ({ ...ilkStock, ...guncel.stock }), [ilkStock, guncel.stock]);
  const sonrakiImlec = guncel.cursor;
  const dahaYukle = useCallback(async (): Promise<boolean> => {
    if (sonrakiImlec === null) return true;
    const r = await loadMoreItemsAction({ slug, q: query.q, status: query.status, cardType: query.type, category: query.category, tracking: query.tracking, barcode: query.barcode, after: sonrakiImlec });
    if (!r.ok) return false;
    setEk((o) => (o.bas !== ilkItems ? o : { bas: o.bas, rows: [...o.rows, ...r.data.rows], stock: { ...o.stock, ...r.data.stock }, cursor: r.data.nextCursor }));
    return true;
  }, [sonrakiImlec, slug, query.q, query.status, query.type, query.category, query.tracking, query.barcode, ilkItems]);
  // Kayda girip geri dönünce aynı uzunluk (sunucudan taze; yalnız sayı hatırlanır).
  useKalipDerinlik(items.length, sonrakiImlec !== null, dahaYukle);
  const sutunlar = useMemo<readonly KalipSutun<ItemsSatir>[]>(
    () => [
      // T-1160 (tuval `StandartUrunlerListe.dc.html` "Görsel" sütunu): kapak küçük resmi, birden çok görselde nokta göstergesi; görselsiz
      // satırda aynı hizada "+". Satırın kendisi ürün kartını açar (iç içe bağlantı yok).
      { id: "image", baslik: tk("colImage"), deger: (r) => <KalipListeGorsel gorsel={r.it.image} etiket={r.it.image === undefined ? tk("imageNone") : tk("imageCount", { n: r.it.image.count })} />, sirala: (r) => r.it.image?.count ?? 0 },
      { id: "code", baslik: tk("colCode"), sabit: true, deger: (r) => (r.it.oldCode === undefined ? r.it.code : t("renamedNote", { code: r.it.code, old: r.it.oldCode })), sirala: (r) => r.it.code },
      { id: "name", baslik: tk("colName"), sabit: true, deger: (r) => <span className="ktad" title={r.it.name}>{r.it.name}</span>, sirala: (r) => r.it.name },
      { id: "type", baslik: tk("colType"), deger: (r) => tc(r.it.cardType), sirala: (r) => r.it.cardType },
      { id: "unit", baslik: tk("colUnit"), deger: (r) => r.it.baseUnitCode, sirala: (r) => r.it.baseUnitCode },
      { id: "have", baslik: tk("colHave"), sayi: true, deger: (r) => r.qty, sirala: (r) => Number(r.st?.have ?? 0) },
      // T-1117 (tuval `StandartUrunlerListe.dc.html` Sütunlar: "Eldeki · Kullanılabilir" açık, "Barkod" kapalı).
      { id: "available", baslik: tk("colAvailable"), sayi: true, deger: (r) => r.avail, sirala: (r) => Number(r.st?.available ?? 0) },
      { id: "barcode", baslik: tk("colBarcode"), varsayilan: false, deger: (r) => r.it.barcode ?? "", sirala: (r) => r.it.barcode ?? "" },
      { id: "state", baslik: tk("colState"), deger: (r) => (r.state === "" ? null : <span className={`ktpill ${r.archived ? "" : r.tn}`}>{r.state}</span>), sirala: (r) => r.state },
    ],
    [t, tk, tc],
  );
  const sutunSecim = useKalipSutunlar<ItemsSatir>("items", sutunlar);

  // T-990: ekleme tam ekran formdur; adres `?new=1` (rehberin büyük düğmesi de buraya gelir). Geri listeye döner.
  const canCreate = rights.create;
  const kilitGerekce = useKartKilitGerekce("items");
  const creating = params.get("new") === "1" && canCreate;
  const openCreate = (): void => {
    feedback.minor();
    router.push(`${base}?new=1`);
  };
  const filtered = query.q !== "" || query.status !== "" || query.type !== "" || query.category !== "" || query.tracking !== "" || query.barcode !== "";
  const href = (next: { q?: string; status?: string; type?: string; after?: string }): string => {
    const p = extraFilterParams(query);
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
      void searchItemsAction({ slug, q, limit: 8, category: query.category, tracking: query.tracking, barcode: query.barcode, ...(query.type === "" ? {} : { cardType: query.type }), status: query.status || "ACTIVE" }).then((r) => {
        if (mine === seq.current) setLive(r.ok ? withRenamed(r.data) : []);
      });
    }, 200);
  };

  const [submitting, setSubmitting] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const filtersOpen = params.get("filters") === "1";
  useEffect(() => {
    if (creating || filtersOpen || cam || submitting || refreshing || typed !== query.q || guncel.rows.length > 0) return;
    return watchListUpdates({
      visibility: document, connection: window,
      available: () => document.visibilityState === "visible" && navigator.onLine
        && !document.querySelector('[role="dialog"],input:focus,textarea:focus,[contenteditable="true"]:focus'),
      refresh: () => startRefresh(() => router.refresh()),
    });
  }, [creating, filtersOpen, cam, submitting, refreshing, typed, query.q, guncel.rows.length, router]);

  /** Enter / okutma: tek eşleşme varsa doğrudan ürünü aç, yoksa/çoksa sonuç listesine git. */
  async function resolve(raw: string, fromScan: boolean): Promise<void> {
    const q = raw.trim();
    if (q === "") {
      router.push(href({ q: "" }));
      return;
    }
    setSubmitting(true);
    const r = await searchItemsAction({ slug, q, limit: 2, category: query.category, tracking: query.tracking, barcode: query.barcode, ...(query.type === "" ? {} : { cardType: query.type }), status: query.status || "ACTIVE" });
    setSubmitting(false);
    const hits = r.ok ? withRenamed(r.data) : [];
    if (hits.length === 1 && hits[0] !== undefined) {
      feedback.ok();
      router.push(`${base}/${encodeURIComponent(hits[0].id)}`);
      return;
    }
    if (fromScan && hits.length === 0) {
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
  const filteredHref = href({});
  const labelsParams = new URLSearchParams(filteredHref.split("?")[1] ?? "");
  labelsParams.set("products", "1");
  const chips: KalipCip[] = [
    { id: "filters", label: tp("filter"), d: LICON.search, color: "2F5DA8", on: query.category !== "" || query.tracking !== "" || query.barcode !== "", href: `${filteredHref}${filteredHref.includes("?") ? "&" : "?"}filters=1` },
    { id: "qr-labels", label: tp("print"), d: LICON.printer, color: "3B6A9E", on: false, href: `${home}/labels?${labelsParams.toString()}` },
    { id: "all", label: tk("all"), d: LICON.grid, color: "172E42", on: query.type === "" && query.status === "", href: href({ type: "", status: "" }) },
    // Kaynaktaki 2. çip (Kritik) yerinde Arşivli: telefonda ilk 4 çip görünür (kaynak `.fch:nth-child(n+5)` gizli); tür sırası kaynaktaki gibi HM · MM · YM.
    { id: "archived", label: tk("archived"), d: LICON.lock, color: "4E6476", on: query.status === "ARCHIVED", href: href({ status: query.status === "ARCHIVED" ? "" : "ARCHIVED" }) },
    {id:"removed",label:tk("removed"),d:LICON.lock,color:"4E6476",on:query.status==="REMOVED",href:href({status:query.status==="REMOVED"?"":"REMOVED"})},
    ...(["HM", "MM", "YM", "TM"] as const).map((k) => ({ id: k, label: tc(k), d: visual(k).d, color: visual(k).color, on: query.type === k, href: href({ type: query.type === k ? "" : k }) })),
  ];

  const tones = items.map((it) => {
    const st = stock[it.id];
    return it.sourceDisposition==="PENDING"?"low":it.status === "ARCHIVED" || st === undefined ? "ok" : stockTone(st.have, st.min);
  });
  const attention = tones.filter((x) => x !== "ok").length;
  const countLbl = (total !== undefined ? tk("count", { n: total }) : sonrakiImlec === null ? tk("count", { n: items.length }) : tk("countMore", { n: items.length })) + (attention > 0 && !filtered ? tk("dikkat", { n: attention }) : "");
  // T-1047 (STANDART §2): liste görünümü ortak tablo (`kalip/tablo.tsx`); satır = kartla aynı bilgi ve hedef.
  const satirlar = items.map((it, i): ItemsSatir => {
    const st = stock[it.id];
    const tn = tones[i] ?? "ok";
    const archived = it.status === "ARCHIVED";
    const state = it.sourceDisposition==="REMOVED"?tk("removedTag"):it.sourceDisposition==="PENDING"?tk("pendingTag"):archived ? tk("archivedTag") : st === undefined ? "" : tn === "crit" ? tk("stockCrit") : tn === "low" ? tk("stockLow") : st.have.replace(/[0.]/g, "") === "" ? tk("stockNone") : tk("stockIn");
    return { it, st, tn, archived, state, qty: st === undefined ? "" : fmtQty(st.have, locale), avail: st === undefined ? "" : fmtQty(st.available, locale) };
  });


  if (params.get("filters") === "1") return <ItemFiltersView dark={dark} initial={{ category: query.category, tracking: query.tracking, barcode: query.barcode }} back={filteredHref} onDone={(target) => router.push(target)} onBack={() => router.push(filteredHref)} />;

  if (creating) {
    return (
      <ItemForm
        slug={slug}
        dark={dark}
        units={units}
        onBack={() => router.push(base)}
        onDone={(itemId) => router.push(`${base}/${encodeURIComponent(itemId)}`)}
      />
    );
  }

  // T-1055: sayfa satırı yok; listenin içinde en altta, görünür olmaya yaklaşınca sonraki 50 ürün.
  const sonsuz = <KalipSonsuz devam={sonrakiImlec !== null} yukle={dahaYukle} metin={countLbl} testId="items-sonsuz" />;
  const listRows = live ?? null;

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
          main: {
            label: tk("add"),
            aria: tk("addAria"),
            d: LICON.plus,
            locked: !canCreate,
            disabledReason: kilitGerekce("create"),
            onClick: openCreate,
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
            feedback.minor();
            setCam(true);
          }}
          cameraLabel={tk("camera")}
          onMic={() => {
            feedback.minor();
            say("info", tx("voiceSoon"));
          }}
          micLabel={tk("mic")}
          micSoon
        />
        {/* T-1047 (STANDART §2): süzgeç çipleri + Sütunlar + Kart/Liste aynı satırda. */}
        <div className="ktbar">
          <KalipCipler label={tk("filter")} chips={chips} />
          <span className="kttools">
            {gorunum === "liste" ? <KalipSutunSec sutunlar={sutunlar} secim={sutunSecim} /> : null}
            <KalipGorunumSec value={gorunum} onChange={setGorunum} />
          </span>
        </div>
        {!canCreate ? <p className="sr">{kilitGerekce("create")}</p> : null}
        {/* T-1054: eski "depo → raf → ürün" kutusu yerine asıl kurulum yolculuğu (entegrasyon → ürün → depo/raf → cari …); bitince çıkmaz. */}
        <YolculukGiris dark={dark} />

        {listRows !== null ? (
          listRows.length === 0 ? (
            <KalipBos
              title={tr("notFoundSearch")}
              hint={tk("noMatchHint")}
              action={{
                label: tk("clear"),
                kind: "clear",
                onClick: () => {
                  seq.current++;
                  setTyped("");
                  setLive(null);
                  if (query.q !== "") router.push(href({ q: "" }));
                  else inputRef.current?.focus();
                },
              }}
            />
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
        ) : items.length === 0 ? (
          filtered ? (
            <KalipBos
              title={tr("notFoundSearch")}
              hint={query.q === "" ? tk("noStatusHint") : tk("noMatchHint")}
              action={{ label: tk("clear"), href: base, kind: "clear" }}
            />
          ) : (
            <>
              <KalipBos
                title={t("empty")}
                hint={canCreate ? t("emptyAction") : t("emptyReadOnly")}
                iconD={LICON.box}
                action={
                  canCreate
                    ? {
                        label: tk("stepItemsCta"),
                        kind: "add",
                        onClick: openCreate,
                      }
                    : { label: tr("home"), href: home, kind: "go" }
                }
              />
            </>
          )
        ) : (
          <>
            <KalipBaslik title={countLbl} />
            {gorunum === "liste" ? (
              <KalipTablo<ItemsSatir>
                label={t("listLabel")}
                sutunlar={sutunSecim.gorunur}
                satirlar={satirlar}
                anahtar={(r) => r.it.id}
                href={(r) => `${base}/${encodeURIComponent(r.it.id)}`}
                satirAria={(r) => tk("cardAria", { name: r.it.name, code: r.it.code, qty: r.qty, unit: r.it.baseUnitCode, state: r.state })}
                testId="items-table"
                sonu={sonsuz}
              />
            ) : (
              <>
            <KalipKartListe label={t("listLabel")}>
              {items.map((it, i) => {
                const v = visual(it.cardType);
                const st = stock[it.id];
                const tn = tones[i] ?? "ok";
                const archived = it.status === "ARCHIVED";
                const state = it.sourceDisposition==="REMOVED"?tk("removedTag"):it.sourceDisposition==="PENDING"?tk("pendingTag"):archived ? tk("archivedTag") : st === undefined ? "" : tn === "crit" ? tk("stockCrit") : tn === "low" ? tk("stockLow") : st.have.replace(/[0.]/g, "") === "" ? tk("stockNone") : tk("stockIn");
                const qty = st === undefined ? "" : fmtQty(st.have, locale);
                const meta = [...(it.sourceDisposition==="PENDING"&&st===undefined?[tk("pendingTag")]:[]),tc(it.cardType).toLocaleUpperCase(locale === "en" ? "en" : "tr"), tk("unitTag", { unit: it.baseUnitCode })].join(" · ");
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
              {sonsuz}
            </KalipKartListe>
              </>
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

    </>
  );
}
