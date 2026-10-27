"use client";
// Ürün ayrıntısı (T-216). Kurallar SUNUCUDADIR: değişmez alanlar (A-87), katsayı biçimi/ölçeği (I-09), barkod belirsizliği (A-69) ve
// yetki domain'de uygulanır; burada yalnızca gösterilir. Katsayı ve miktar alanları DİZGİ olarak kalır (`Number`'a çevrilmez).
// Mobilde kart/liste görünümü (tablo yok → yatay taşma yok). Sunucu reddi neden + sonraki eylemle gösterilir.
// T-968 (B-63): KalipDetay.dc.html detay kalıbı — büyük ikonlu kimlik kartı (ad, kod, etiketler, toplam stok), hızlı işlemler (yalnız
// yetkili: etiket, sayım, transfer), "Nerede?" (depo → raf, minimum), son hareketler (zaman çizgisi); ana işlem DÜZENLE kart bilgileri
// bölümüne götürür. Düzenleme bölümleri (kart, birim katsayıları, barkodlar, arşiv) aynı eylemlerle kalıbın kartlarında.
// Bilinçli farklar: "Sayım" kısayolu ürün sayımı değil görev listesidir (ürüne özel sayım başlatma yok); stok sorgusu okunamazsa
// toplam / Nerede? / hareketler çizilmez (uydurma yok).
// T-990 (B-97): düzenleme, kod değiştirme, birim dönüşümü ve barkod ekleme sayfa içi form/pencere değil TAM EKRAN FORMDUR
// (`KalipFormEkran`; adres `?edit=1` / `?kod=1` / `?conv=1` / `?barcode=1`); yerel açılır liste yok (renkli seçim kutuları / aramalı
// seçim sayfası). Kaydet yalnız değişiklikte etkin, doğrulama ve yarım işte çıkış kutusu ortak kalıptadır. Geri ürün kartına döner.
// Tek soruluk onaylar (arşivle, barkodu kaldır) pencere kalır.
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Banner, feedback } from "@wms/ui";
import { KalipOnay } from "../../kalip/pencere.tsx";
import { LICON } from "../../../../design/kalip-icons.ts";
import { CodeChangedNotice, CodeEditForm } from "../../code-edit-dialog.tsx";
import { KalipMinimum, KalipNerede, KalipUyari, type KalipYer } from "../../kalip/detay.tsx";
import { KalipBilgiIzgara, KalipKartSekmeler, KalipKartSerit, KalipKayitKart, KalipSonHareketler, type KalipBilgi, type KalipEtiket, type KalipHareket, type KalipKartIslem, type KalipKartSekmesi, type KalipSayiKutusu, type StTon } from "../../kalip/kart.tsx";
import { SICON } from "../../../../design/standart-icons.ts";
import type { AlanKurali } from "../../kalip/dogrula.ts";
import { Ico, KalipEkran } from "../../kalip/ekran.tsx";
import { KalipFormEkran, KalipOnizleme, type KaydetSonuc } from "../../kalip/form-ekran.tsx";
import { KalipAlan, KalipGrup, KalipSabit } from "../../kalip/form.tsx";
import { approx, fmtQty, stockTone, sumDecimal } from "../../kalip/format.ts";
import { KalipSecim, KalipSecimGrubu } from "../../kalip/secim.tsx";
import { kdz } from "../../kalip/tokens.ts";
import { addBarcodeAction, archiveItemAction, removeBarcodeAction, setConversionAction, updateItemAction } from "../actions.ts";
import { CARD_VISUAL } from "../card-visual.ts";
import { CARD_TYPES, errorKey, ServerErrorBanner, toServerError } from "../items-view.tsx";
import type { CardType, ServerError, UnitOption } from "../items-view.tsx";

export interface ItemDetailItem {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: "ACTIVE" | "ARCHIVED";
  readonly baseUnitId: string;
  readonly baseUnitCode: string;
  readonly trackingMode: string;
  readonly quantityScale: number;
  readonly pickPolicy: string;
  readonly cardType: CardType;
}
export interface ConversionView {
  readonly unitId: string;
  readonly unitCode: string;
  readonly unitName: string;
  readonly factor: string;
}
export interface BarcodeView {
  readonly id: string;
  readonly barcode: string;
  readonly unitId: string;
  readonly unitCode: string;
  readonly quantity: string;
  readonly ambiguous: boolean;
}

const PICK = ["FIFO", "FEFO"] as const;
type ItemForm = "edit" | "kod" | "conv" | "barcode";
const FORMS: readonly ItemForm[] = ["edit", "kod", "conv", "barcode"];
const c = (hex: string): string => kdz("dzd", hex);
/** Kart içi küçük işlem düğmesi (kaynak `.btn`); kilitliyken soluk. */
const actBtn = (bg: string): CSSProperties => ({ background: c(bg), color: c("FFFFFF"), minHeight: 48 });

/** Ürün kartı stok özeti (sunucu, `getItemStockCard`); okunamadıysa `null` → bölümler çizilmez. */
export interface ItemStockCardView {
  readonly places: readonly { readonly warehouseId: string; readonly warehouseName: string; readonly locationCode: string; readonly quantity: string }[];
  readonly min: string | null;
  readonly moves: readonly { readonly documentId: string; readonly kind: string; readonly number: string | null; readonly occurredAt: string; readonly actorName: string | null; readonly net: string; readonly moved: string; readonly locations: string }[];
}

export interface ItemQuickAccess {
  readonly label: boolean;
  readonly count: boolean;
  readonly transfer: boolean;
}

// Kaynak MV renkleri: giriş yeşil, transfer mor, çıkış turuncu, ters kayıt lacivert; Nerede? depo renkleri sırayla.
const MOVE_VIS = {
  STOCK_IN: { d: LICON.moveIn, ton: "yesil" },
  STOCK_OUT: { d: LICON.moveOut, ton: "turuncu" },
  STOCK_MOVE: { d: LICON.transfer, ton: "mor" },
  REVERSAL: { d: LICON.transfer, ton: "lacivert" },
  // T-977: sayım fark fişi artık arayüzden işlenir; ürün kartı bu belge türünde çökmemeli.
  COUNT_ADJUSTMENT: { d: LICON.clip, ton: "mor" },
} as const satisfies Record<string, { d: string; ton: StTon }>;
const MOVE_FALLBACK = { d: LICON.clip, ton: "gri" } as const;
/** T-1049: kart türü → şerit tonu (CARD_VISUAL renkleriyle aynı aile). */
const TUR_TON: Readonly<Record<CardType, StTon>> = { HM: "kahve", YM: "mor", MM: "yesil", TM: "camgobegi" };
const KNOWN_KINDS: readonly string[] = Object.keys(MOVE_VIS);
const PLACE_COLORS = ["2F5DA8", "0E7C7B", "6C4BD8", "B07D0B", "2F7D5B"] as const;

/** Sunucu reddi → formda gösterim: alanla ilgili ret o alanın altında, diğerleri genel neden. */
function itemErr(e: ServerError, tr: (k: string) => string, field: (key: string) => string | null): KaydetSonuc {
  const key = errorKey(e);
  const text = `${tr(key)} ${tr(`${key}Action`)}`.trim();
  const alan = field(key);
  if (alan !== null) return { ok: false, alan: { [alan]: text } };
  return { ok: false, mesaj: e.requestId === undefined ? text : `${text} · ${e.requestId}` };
}

/** Ürün kartı düzenleme — TAM EKRAN FORM (`?edit=1`): ad, kart türü ve çıkış kuralı; değişmeyen bilgiler kilitli satırlar. */
function ItemEditForm({ slug, dark, item, inUse, onBack, onDone }: { slug: string; dark: boolean; item: ItemDetailItem; inUse: boolean; onBack: () => void; onDone: () => void }) {
  const t = useTranslations("items");
  const td = useTranslations("items.detail");
  const tk = useTranslations("items.detail.k");
  const terr = useTranslations("items.errors");
  const tc = useTranslations("items.cardType");
  const tp = useTranslations("items.pick");
  const tt = useTranslations("items.tracking");
  const [initial] = useState(() => ({ name: item.name, cardType: item.cardType as string, pick: item.pickPolicy }));
  const [v, setV] = useState(initial);
  const set = (k: keyof typeof v, val: string): void => setV((cur) => ({ ...cur, [k]: val }));
  const rules: AlanKurali[] = [{ name: "name", label: t("form.name"), required: true, maxLength: 512 }];
  const vis = CARD_VISUAL[(CARD_TYPES as readonly string[]).includes(v.cardType) ? (v.cardType as CardType) : item.cardType];

  async function save(): Promise<KaydetSonuc> {
    const r = await updateItemAction({ slug, itemId: item.id, name: v.name, pickPolicy: v.pick, cardType: v.cardType });
    if (!r.ok) return itemErr(toServerError(r.error), (k) => terr(k), (key) => (key === "validation_failed" ? "name" : null));
    return { ok: true };
  }
  const scale = item.quantityScale === 0 ? t("form.scaleInteger") : t("form.scaleDecimals", { count: item.quantityScale });
  const fixed = [
    { k: t("form.baseUnit"), v: item.baseUnitCode, d: LICON.tag },
    { k: t("form.scale"), v: scale, d: LICON.gear },
    { k: t("form.tracking"), v: tt(item.trackingMode), d: LICON.lock },
  ];
  return (
    <KalipFormEkran
      dark={dark}
      title={tk("editAria")}
      icon={{ d: vis.d, color: vis.color }}
      subtitle={item.code}
      testId="item-edit-form"
      values={v}
      initial={initial}
      rules={rules}
      onSave={save}
      onDone={onDone}
      onBack={onBack}
      saveAria={td("save")}
      savedText={td("done.saved")}
      preview={<KalipOnizleme name={v.name} code={item.code} d={vis.d} color={vis.color} kind={tc(v.cardType)} rows={[{ k: t("form.baseUnit"), v: item.baseUnitCode }, { k: t("form.pick"), v: tp(v.pick) }]} />}
    >
      <KalipGrup title={tk("editSection")} sub={tk("editSub")} d={vis.d} color={vis.color}>
        <KalipAlan label={`${t("form.name")} *`} name="name" value={v.name} onChange={(e) => set("name", e.target.value)} autoComplete="off" maxLength={512} />
        <KalipSecimGrubu
          name="cardType"
          label={t("form.cardType")}
          hint={t("form.cardTypeHint")}
          value={v.cardType}
          color={vis.color}
          onPick={(id) => set("cardType", id)}
          options={CARD_TYPES.map((k) => ({ id: k, label: tc(k), sub: k, d: CARD_VISUAL[k].d, color: CARD_VISUAL[k].color }))}
          testId="item-card-type"
        />
        <KalipSecimGrubu
          name="pick"
          label={t("form.pick")}
          value={v.pick}
          color="0E7C7B"
          onPick={(id) => set("pick", id)}
          options={PICK.map((k) => ({ id: k, label: tp(k), d: k === "FIFO" ? LICON.arrow : LICON.clock }))}
          testId="item-pick"
        />
      </KalipGrup>
      <KalipGrup title={tk("fixedTitle")} sub={inUse ? td("lockedInUse") : td("lockedFixed")} d={LICON.lock} color="4E6476">
        {fixed.map((f) => (
          <KalipSabit key={f.k} title={f.k} d={f.d} color="4E6476" pill={{ label: f.v, ok: true }} aria={`${f.k}: ${f.v}`} />
        ))}
      </KalipGrup>
    </KalipFormEkran>
  );
}

/** Birim dönüşümü ekle/güncelle — TAM EKRAN FORM (`?conv=1`). Katsayı DİZGİ olarak iletilir (I-09); biçim/ölçek denetimi sunucuda. */
function ConversionForm({ slug, dark, item, units, conversions, onBack, onDone }: { slug: string; dark: boolean; item: ItemDetailItem; units: readonly UnitOption[]; conversions: readonly ConversionView[]; onBack: () => void; onDone: () => void }) {
  const td = useTranslations("items.detail");
  const tk = useTranslations("items.detail.k");
  const terr = useTranslations("items.errors");
  const [initial] = useState(() => ({ unitId: units[0]?.id ?? "", factor: "" }));
  const [v, setV] = useState(initial);
  const set = (k: keyof typeof v, val: string): void => setV((cur) => ({ ...cur, [k]: val }));
  const rules: AlanKurali[] = [
    { name: "unitId", label: td("conversionUnit"), required: true },
    { name: "factor", label: td("conversionFactor", { base: item.baseUnitCode }), required: true, kind: "decimal", maxLength: 64 },
  ];
  const unit = units.find((u) => u.id === v.unitId);
  const existing = conversions.find((x) => x.unitId === v.unitId);
  async function save(): Promise<KaydetSonuc> {
    const r = await setConversionAction({ slug, itemId: item.id, unitId: v.unitId, factor: v.factor });
    if (!r.ok) return itemErr(toServerError(r.error), (k) => terr(k), (key) => (key === "validation_failed" || key === "validation_failed_unit_conversion_invalid" ? "factor" : null));
    return { ok: true };
  }
  return (
    <KalipFormEkran
      dark={dark}
      title={td("conversionsTitle")}
      icon={{ d: LICON.grid, color: "6C4BD8" }}
      subtitle={`${item.name} · ${item.code}`}
      testId="conversion-form"
      values={v}
      initial={initial}
      rules={rules}
      onSave={save}
      onDone={onDone}
      onBack={onBack}
      saveAria={td("conversionSave")}
      savedText={td("done.conversion")}
      preview={
        <KalipOnizleme
          name={item.name}
          code={unit === undefined || v.factor.trim() === "" ? item.code : td("conversionLine", { unit: unit.code, factor: v.factor.trim(), base: item.baseUnitCode })}
          d={LICON.grid}
          color="6C4BD8"
          kind={tk("convSub")}
          rows={existing === undefined ? [] : [{ k: existing.unitCode, v: td("conversionLine", { unit: existing.unitCode, factor: existing.factor, base: item.baseUnitCode }) }]}
        />
      }
    >
      <KalipGrup title={td("conversionsTitle")} sub={td("conversionsHint", { unit: item.baseUnitCode })} d={LICON.grid} color="6C4BD8">
        <KalipSecim
          name="unitId"
          label={td("conversionUnit")}
          value={v.unitId}
          color="6C4BD8"
          list
          icon={{ d: LICON.tag, color: "6C4BD8" }}
          onPick={(id) => set("unitId", id)}
          options={units.map((u) => ({ id: u.id, label: u.code, sub: u.name, keys: [u.name] }))}
          testId="conversion-unit"
        />
        <KalipAlan
          label={`${td("conversionFactor", { base: item.baseUnitCode })} *`}
          hint={td("conversionFactorHint")}
          name="factor"
          value={v.factor}
          onChange={(e) => set("factor", e.target.value)}
          inputMode="decimal"
          autoComplete="off"
          maxLength={64}
        />
      </KalipGrup>
    </KalipFormEkran>
  );
}

/** Barkod ekle — TAM EKRAN FORM (`?barcode=1`). Okutma metin girişidir (el okuyucusu alana yazar). */
function BarcodeForm({ slug, dark, item, units, onBack, onDone }: { slug: string; dark: boolean; item: ItemDetailItem; units: readonly UnitOption[]; onBack: () => void; onDone: () => void }) {
  const td = useTranslations("items.detail");
  const tk = useTranslations("items.detail.k");
  const terr = useTranslations("items.errors");
  const [initial] = useState(() => ({ barcode: "", unitId: "", quantity: "" }));
  const [v, setV] = useState(initial);
  const set = (k: keyof typeof v, val: string): void => setV((cur) => ({ ...cur, [k]: val }));
  const rules: AlanKurali[] = [
    { name: "barcode", label: td("barcodeValue"), required: true, maxLength: 512 },
    { name: "quantity", label: td("barcodeQuantity"), kind: "decimal", maxLength: 64 },
  ];
  const unit = units.find((u) => u.id === v.unitId);
  async function save(): Promise<KaydetSonuc> {
    const q = v.quantity.trim();
    const r = await addBarcodeAction({ slug, itemId: item.id, unitId: v.unitId === "" ? null : v.unitId, barcode: v.barcode, quantity: q === "" ? null : q });
    if (!r.ok) return itemErr(toServerError(r.error), (k) => terr(k), (key) => (key === "validation_failed" || key === "validation_failed_code_taken" ? "barcode" : null));
    return { ok: true };
  }
  return (
    <KalipFormEkran
      dark={dark}
      title={td("barcodesTitle")}
      icon={{ d: LICON.cam, color: "0E7C7B" }}
      subtitle={`${item.name} · ${item.code}`}
      testId="barcode-form"
      values={v}
      initial={initial}
      rules={rules}
      onSave={save}
      onDone={onDone}
      onBack={onBack}
      saveAria={td("barcodeAdd")}
      preview={
        <KalipOnizleme
          name={item.name}
          code={v.barcode}
          d={LICON.cam}
          color="0E7C7B"
          kind={tk("bcSub")}
          rows={[{ k: td("barcodeUnit"), v: unit === undefined ? item.baseUnitCode : unit.code }, { k: td("barcodeQuantity"), v: v.quantity.trim() === "" ? "1" : v.quantity.trim() }]}
        />
      }
    >
      <KalipGrup title={td("barcodesTitle")} sub={td("barcodesHint")} d={LICON.cam} color="0E7C7B">
        <KalipAlan label={`${td("barcodeValue")} *`} hint={td("barcodeValueHint")} name="barcode" value={v.barcode} onChange={(e) => set("barcode", e.target.value)} autoComplete="off" autoCapitalize="off" maxLength={512} />
        <KalipSecim
          name="unitId"
          label={td("barcodeUnit")}
          value={v.unitId}
          color="0E7C7B"
          list
          icon={{ d: LICON.tag, color: "0E7C7B" }}
          onPick={(id) => set("unitId", id)}
          options={[{ id: "", label: td("barcodeUnitBase", { unit: item.baseUnitCode }) }, ...units.map((u) => ({ id: u.id, label: u.code, sub: u.name, keys: [u.name] }))]}
          testId="barcode-unit"
        />
        <KalipAlan label={td("barcodeQuantity")} hint={td("barcodeQuantityHint")} name="quantity" value={v.quantity} onChange={(e) => set("quantity", e.target.value)} inputMode="decimal" autoComplete="off" maxLength={64} />
      </KalipGrup>
    </KalipFormEkran>
  );
}

export function ItemDetail({
  slug,
  dark,
  canManage,
  quick,
  stockCard,
  sourceInfo = {},
  inUse,
  units,
  item,
  conversions,
  barcodes,
}: {
  slug: string;
  dark: boolean;
  canManage: boolean;
  quick: ItemQuickAccess;
  stockCard: ItemStockCardView | null;
  sourceInfo?: Readonly<Record<string, { readonly categoryName?: string | null; readonly gtip?: string | null; readonly unit?: string | null; readonly archived?: boolean | null; readonly lifecycle?: "NONE"|"PENDING"|"ARCHIVED"|"REMOVED"; readonly sourceState?: "ACTIVE"|"ARCHIVED"|"DELETED"; readonly inventoryTracking?: boolean | null }>>;
  inUse: boolean;
  units: readonly UnitOption[];
  item: ItemDetailItem;
  conversions: readonly ConversionView[];
  barcodes: readonly BarcodeView[];
}) {
  const t = useTranslations("items");
  const td = useTranslations("items.detail");
  const tsrc = useTranslations("items.productLabels");
  const tt = useTranslations("items.tracking");
  const tp = useTranslations("items.pick");
  const tc = useTranslations("items.cardType");
  const tk = useTranslations("items.detail.k");
  const terr = useTranslations("items.errors");
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const base = `/t/${encodeURIComponent(slug)}/items`;
  const itemPath = `${base}/${encodeURIComponent(item.id)}`;
  // T-1049: açık sekme adreste (`?sekme=`); formdan dönüş aynı sekmeye.
  const sekme = params.get("sekme") ?? "genel";
  const returnTo = sekme === "genel" ? itemPath : `${itemPath}?sekme=${encodeURIComponent(sekme)}`;
  const active = item.status === "ACTIVE";
  const writable = canManage && active;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ServerError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [removing, setRemoving] = useState<BarcodeView | null>(null);
  const [codeChanged, setCodeChanged] = useState<{ readonly from: string; readonly to: string } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const otherUnits = units.filter((u) => u.id !== item.baseUnitId);
  // Açık tam ekran form adresten okunur (yalnız yazma yetkisi ve aktif ürün; yoksa kart görünür).
  const form = writable ? (FORMS.find((f) => params.get(f) === "1") ?? null) : null;
  const open = (f: ItemForm): void => {
    feedback.minor();
    setError(null);
    router.push(`${returnTo}${returnTo.includes("?") ? "&" : "?"}${f}=1`);
  };
  /** Formdan karta dönüş: başarıda bildirim + sunucu verisini yenile. */
  const back = (doneText?: string): void => {
    if (doneText !== undefined) {
      feedback.ok();
      setError(null);
      setNotice(doneText);
    }
    router.push(returnTo);
    if (doneText !== undefined) router.refresh();
  };

  /** Ortak eylem sarmalayıcısı: hata banner'da kalır; başarıda bildirim + sunucu verisini yenile. */
  async function run(name: string, doneKey: string, call: () => Promise<{ ok: true } | { ok: false; error: ServerError }>): Promise<boolean> {
    setBusy(name);
    setError(null);
    setNotice(null);
    const res = await call();
    setBusy(null);
    if (!res.ok) {
      feedback.error();
      setError(toServerError(res.error));
      return false;
    }
    feedback.ok();
    setNotice(td(doneKey));
    router.refresh();
    return true;
  }

  async function changeCode(code: string) {
    const r = await updateItemAction({ slug, itemId: item.id, code });
    return r.ok ? ({ ok: true, changed: r.data.changed } as const) : ({ ok: false, error: toServerError(r.error) } as const);
  }
  /** "Geri al" (N-03): eski koda dönüş aynı sunucu komutudur; eski kod başkasına verildiyse sunucu reddi gösterilir. */
  async function undoCode() {
    if (codeChanged === null) return;
    setUndoing(true);
    setError(null);
    const r = await changeCode(codeChanged.from);
    setUndoing(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setCodeChanged(null);
    setNotice(td("done.codeUndone"));
    router.refresh();
  }

  async function onRemove() {
    if (removing === null) return;
    const target = removing;
    setRemoving(null);
    await run("remove", "done.barcodeRemoved", async () => {
      const r = await removeBarcodeAction({ slug, barcodeId: target.id });
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    });
  }
  async function onArchive() {
    setArchiveOpen(false);
    await run("archive", "done.archived", async () => {
      const r = await archiveItemAction({ slug, itemId: item.id });
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    });
  }

  // T-968 (KalipDetay): toplam, "Nerede?" ve son hareketler gerçek stok sorgusundan (kapsamdaki depolar). Veri yoksa bölüm çizilmez.
  const vis = CARD_VISUAL[item.cardType];
  const tur = TUR_TON[item.cardType];
  const unit = item.baseUnitCode;
  const fq = (v: string): string => fmtQty(v, locale);
  const totalRaw = stockCard === null ? null : sumDecimal(stockCard.places.map((p) => p.quantity));
  const tn = stockCard === null || totalRaw === null ? "ok" : stockTone(totalRaw, stockCard.min);
  const byWh = new Map<string, { name: string; rows: { code: string; q: string }[] }>();
  for (const p of stockCard?.places ?? []) {
    const w = byWh.get(p.warehouseId) ?? { name: p.warehouseName, rows: [] };
    w.rows.push({ code: p.locationCode, q: p.quantity });
    byWh.set(p.warehouseId, w);
  }
  const totalN = Math.max(approx(totalRaw), approx(stockCard?.min), 0);
  const places: KalipYer[] = [...byWh.entries()].map(([id, w], i) => {
    const sum = sumDecimal(w.rows.map((r) => r.q));
    const share = (q: string): number => (totalN > 0 ? Math.max(0, approx(q)) / totalN : 0);
    return {
      key: id,
      name: w.name,
      meta: tk("racks", { n: w.rows.length, codes: w.rows.map((r) => r.code).join(", ") }),
      qty: `${fq(sum)} ${unit}`,
      share: share(sum),
      color: PLACE_COLORS[i % PLACE_COLORS.length] ?? "2F5DA8",
      racks: w.rows.map((r) => ({ code: r.code, qty: `${fq(r.q)} ${unit}`, share: share(r.q) })),
    };
  });
  const when = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const day = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(now) - day(d)) / 86400000);
    const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    return diff <= 0 ? tk("whenToday", { time }) : diff === 1 ? tk("whenYesterday", { time }) : tk("whenDays", { n: diff });
  };
  const docs = `/t/${encodeURIComponent(slug)}/stock/documents`;
  const hareketler: KalipHareket[] = (stockCard?.moves ?? []).map((m) => {
    // Belge türü listesi dışındaki tür (ileride eklenecek) çökme yerine genel "Hareket" olarak gösterilir.
    const known = KNOWN_KINDS.includes(m.kind);
    const v = known ? MOVE_VIS[m.kind as keyof typeof MOVE_VIS] : MOVE_FALLBACK;
    const kindName = known ? tk(`kind_${m.kind}`) : tk("kind_OTHER");
    const yer = m.kind === "STOCK_MOVE";
    const q = yer ? fq(m.moved) : approx(m.net) > 0 ? `+${fq(m.net)}` : fq(m.net);
    return {
      key: m.documentId,
      baslik: kindName,
      no: m.number,
      meta: [when(m.occurredAt), m.locations].filter((x) => x !== "").join(" · "),
      miktar: q,
      yon: yer ? "yer" : approx(m.net) > 0 ? "giris" : "cikis",
      d: v.d,
      ton: v.ton,
      kisi: m.actorName,
      href: `${docs}?id=${encodeURIComponent(m.documentId)}`,
      aria: tk("moveOpen", { kind: kindName, no: m.number ?? "" }).trim(),
    };
  });
  // T-1040: arşivli ürünle işlem yapılmaz (kullanıcı 26 Ekim) — etiket / sayım / transfer kısa yolları çizilmez.
  const islemler: KalipKartIslem[] = !active ? [] : [
    ...(quick.label ? [{ key: "label", etiket: tk("qLabelShort"), d: SICON.yazici, ton: "stok" as const, href: `/t/${encodeURIComponent(slug)}/labels?item=${encodeURIComponent(item.id)}` }] : []),
    ...(quick.count ? [{ key: "count", etiket: tk("qCount"), d: SICON.sayim, ton: "mavi" as const, href: `/t/${encodeURIComponent(slug)}/field/tasks` }] : []),
    ...(quick.transfer ? [{ key: "transfer", etiket: tk("qTransfer"), d: SICON.cevrim, ton: "mor" as const, href: `${docs}?new=TRANSFER` }] : []),
  ];
  const etiketler: KalipEtiket[] = [
    { metin: item.code, mono: true, testId: "kalip-code" },
    { metin: tc(item.cardType), testId: "card-type" },
    { metin: unit },
    { metin: item.pickPolicy },
    ...(item.trackingMode === "NONE" ? [] : [{ metin: tt(item.trackingMode) }]),
    active ? { metin: t("status.ACTIVE"), ton: "ok" as const } : { metin: t("status.ARCHIVED"), ton: "kirmizi" as const },
  ];
  const kutular: KalipSayiKutusu[] = stockCard === null || totalRaw === null ? [] : [
    { key: "have", etiket: tk("boxHave"), deger: fq(totalRaw), d: SICON.kutu, ton: tn === "crit" ? "kirmizi" : "stok", testId: "kalip-total" },
    ...(stockCard.min === null ? [] : [{ key: "min", etiket: tk("boxMin"), deger: fq(stockCard.min), d: SICON.uyari, ton: tn === "ok" ? ("ok" as const) : ("amber" as const) }]),
    { key: "places", etiket: tk("boxPlaces"), deger: String(stockCard.places.length), d: SICON.raf, ton: "lacivert" },
  ];
  const fixedLock = inUse ? td("lockedInUse") : td("lockedFixed");
  const bilgiler: KalipBilgi[] = [
    { key: "name", etiket: t("form.name"), deger: item.name, d: SICON.ad, ton: "mavi" },
    {
      key: "code",
      etiket: tk("infoCode"),
      deger: <span className="mono">{item.code}</span>,
      d: SICON.barkod,
      ton: "lacivert",
      ...(writable
        ? {
            islem: (
              <button type="button" onClick={() => open("kod")} aria-label={td("codeEdit.for", { name: item.name })} title={td("codeEdit.button")}>
                <Ico d={SICON.kalem} size={18} />
              </button>
            ),
          }
        : {}),
    },
    { key: "type", etiket: t("form.cardType"), deger: tc(item.cardType), d: SICON.kutu, ton: tur },
    { key: "unit", etiket: t("form.baseUnit"), deger: unit, d: SICON.birim, ton: "lacivert", kilit: fixedLock },
    { key: "conv", etiket: td("conversionsTitle"), deger: conversions.length === 0 ? tk("none") : conversions.map((cv) => td("conversionLine", { unit: cv.unitCode, factor: cv.factor, base: unit })).join(" · "), d: SICON.cevrim, ton: "mor" },
    { key: "pick", etiket: t("form.pick"), deger: tp(item.pickPolicy), d: SICON.list, ton: "camgobegi" },
    { key: "tracking", etiket: t("form.tracking"), deger: tt(item.trackingMode), d: SICON.qr, ton: "camgobegi", kilit: fixedLock },
    { key: "scale", etiket: t("form.scale"), deger: item.quantityScale === 0 ? t("form.scaleInteger") : t("form.scaleDecimals", { count: item.quantityScale }), d: SICON.birim, ton: "gri", kilit: fixedLock },
    ...(stockCard?.min === null || stockCard?.min === undefined ? [] : [{ key: "min", etiket: tk("boxMin"), deger: `${fq(stockCard.min)} ${unit}`, d: SICON.uyari, ton: "turuncu" as const }]),
  ];
  const sourceRows: KalipBilgi[] = Object.entries(sourceInfo).sort(([a], [b]) => a.localeCompare(b)).flatMap(([provider, info]) => {
    const name = provider === "PARASUT" ? "Paraşüt" : provider === "LOGO" ? "Logo" : provider;
    const field = (key: string, label: string, value: ReactNode, d: string): KalipBilgi => ({ key: `${provider}-${key}`, etiket: `${name} · ${label}`, deger: value, d, ton: "turuncu", kilit: tsrc("sourceLocked") });
    const flag = (v: boolean | null): string => v === null ? "—" : tsrc(v ? "yes" : "no");
    return [...(info.lifecycle && info.lifecycle!=="NONE"?[field("lifecycle",tsrc("sourceStatus"),tsrc(info.lifecycle==="PENDING"?"pending":info.lifecycle==="REMOVED"?"removed":"archived"),SICON.bilgi)]:[]),field("category", tsrc("category"), info.categoryName ?? "—", SICON.kutu), field("gtip", tsrc("sourceGtip"), info.gtip ?? "—", SICON.list), field("unit", tsrc("sourceUnit"), info.unit ?? "—", SICON.birim), ...(info.archived === undefined ? [] : [field("archived", tsrc("sourceArchived"), flag(info.archived), SICON.bilgi)]), ...(info.inventoryTracking === undefined ? [] : [field("inventory", tsrc("sourceInventory"), flag(info.inventoryTracking), SICON.bilgi)])];
  });
  const sekmeler: KalipKartSekmesi[] = [
    { id: "genel", etiket: tk("tabGeneral"), d: SICON.bilgi, ton: "stok" },
    ...(stockCard === null ? [] : [{ id: "stok", etiket: tk("tabStock"), d: SICON.raf, ton: "lacivert" as const }]),
    { id: "birim", etiket: tk("tabUnits"), d: SICON.cevrim, ton: "mor" },
    { id: "barkod", etiket: tk("tabBarcodes"), d: SICON.barkod, ton: "mavi" },
    ...(sourceRows.length === 0 ? [] : [{ id: "erp", etiket: tsrc("sourceTitle"), d: SICON.cevrim, ton: "turuncu" as const }]),
  ];
  const secili = sekmeler.some((s) => s.id === sekme) ? sekme : "genel";
  const sekmeHref = (id: string): string => (id === "genel" ? itemPath : `${itemPath}?sekme=${id}`);

  if (form === "edit") return <ItemEditForm key="edit" slug={slug} dark={dark} item={item} inUse={inUse} onBack={() => back()} onDone={() => back(td("done.saved"))} />;
  if (form === "conv") return <ConversionForm key="conv" slug={slug} dark={dark} item={item} units={otherUnits} conversions={conversions} onBack={() => back()} onDone={() => back(td("done.conversion"))} />;
  if (form === "barcode") return <BarcodeForm key="barcode" slug={slug} dark={dark} item={item} units={otherUnits} onBack={() => back()} onDone={() => back(td("done.barcodeAdded"))} />;
  if (form === "kod") {
    return (
      <CodeEditForm
        key="kod"
        dark={dark}
        subject={item.name}
        current={item.code}
        icon={{ d: vis.d, color: vis.color }}
        onBack={() => back()}
        submit={changeCode}
        errorText={(e) => {
          const key = errorKey(e);
          return `${terr(key)} ${terr(`${key}Action`)}`.trim();
        }}
        renderError={(e) => <ServerErrorBanner error={e} returnTo={returnTo} />}
        onDone={(r) => {
          setError(null);
          if (r.changed) {
            feedback.ok();
            setNotice(null);
            setCodeChanged({ from: r.from, to: r.to });
            back();
            router.refresh();
          } else back(td("done.codeSame"));
        }}
      />
    );
  }

  const lockReason = canManage ? td("archivedNote") : t("lockedReason");
  const bildirimler = (
    <>
      {codeChanged ? <CodeChangedNotice from={codeChanged.from} to={item.code === codeChanged.from ? codeChanged.to : item.code} busy={undoing} onUndo={() => void undoCode()} /> : null}
      {notice ? <Banner kind="info">{notice}</Banner> : null}
      {error ? <ServerErrorBanner error={error} returnTo={returnTo} /> : null}
      {canManage ? null : <p className="sr">{t("lockedReason")}</p>}
      {active ? null : <Banner kind="info">{td("archivedNote")}</Banner>}
    </>
  );
  let ana: ReactNode;
  if (secili === "erp") {
    ana = <KalipBilgiIzgara baslik={tsrc("sourceTitle")} bilgiler={sourceRows} kilitD={SICON.kilit} />;
  } else if (secili === "stok" && stockCard !== null) {
    ana = (
      <div data-testid="item-where" className="flex min-w-0 flex-col gap-3">
        <b className="stkbas">{tk("where")}</b>
        {tn !== "ok" && stockCard.min !== null && totalRaw !== null ? <KalipUyari title={tk("belowMin")} sub={tk("belowMinSub", { have: fq(totalRaw), min: fq(stockCard.min), unit })} /> : null}
        {places.length === 0 ? <small className="stkbos">{tk("whereEmpty")}</small> : <KalipNerede places={places} />}
        {stockCard.min === null ? null : <KalipMinimum label={tk("min", { min: fq(stockCard.min), unit })} state={tn === "ok" ? tk("minOk") : tk("minLow")} ok={tn === "ok"} />}
      </div>
    );
  } else if (secili === "birim") {
    ana = (
      <div id="sec-conv" className="flex min-w-0 flex-col gap-3">
        <b className="stkbas">{td("conversionsTitle")}</b>
        <p className="break-words text-sm text-ink-muted">{td("conversionsHint", { unit })}</p>
        {conversions.length === 0 ? (
          <p className="break-words text-base text-ink-muted">{td("conversionsEmpty")}</p>
        ) : (
          <ul className="m-0 flex min-w-0 list-none flex-col gap-2 p-0">
            {conversions.map((cv) => (
              <li key={cv.unitId} data-testid="conversion-row" className="min-w-0 break-words rounded-card border-2 border-border p-3 text-base text-ink">
                {td("conversionLine", { unit: cv.unitCode, factor: cv.factor, base: unit })}
              </li>
            ))}
          </ul>
        )}
        {writable ? (
          <div>
            <button
              type="button"
              className="btn"
              style={{ ...actBtn("6C4BD8"), opacity: otherUnits.length === 0 ? 0.5 : 1 }}
              aria-disabled={otherUnits.length === 0 ? true : undefined}
              aria-describedby={otherUnits.length === 0 ? "conv-none" : undefined}
              onClick={() => {
                if (otherUnits.length === 0) {
                  feedback.error();
                  setNotice(tk("convNoUnit"));
                  return;
                }
                open("conv");
              }}
              data-testid="conversion-add"
            >
              <Ico d={LICON.plus} size={18} />
              {tk("convAdd")}
            </button>
            {otherUnits.length === 0 ? (
              <small id="conv-none" className="sr">
                {tk("convNoUnit")}
              </small>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  } else if (secili === "barkod") {
    ana = (
      <div id="sec-bc" className="flex min-w-0 flex-col gap-3">
        <b className="stkbas">{td("barcodesTitle")}</b>
        <p className="break-words text-sm text-ink-muted">{td("barcodesHint")}</p>
        {barcodes.length === 0 ? (
          <p className="break-words text-base text-ink-muted">{td("barcodesEmpty")}</p>
        ) : (
          <ul className="m-0 flex min-w-0 list-none flex-col gap-2 p-0">
            {barcodes.map((b) => (
              <li key={b.id} data-testid="barcode-row" className="flex min-w-0 flex-col gap-2 rounded-card border-2 border-border p-3">
                <span className="min-w-0 break-all text-base font-semibold text-ink">{b.barcode}</span>
                <span className="min-w-0 break-words text-sm text-ink-muted">{td("barcodeMeta", { unit: b.unitCode, quantity: b.quantity })}</span>
                {b.ambiguous ? <KalipUyari title={td("barcodeAmbiguous")} sub={b.barcode} /> : null}
                {writable ? (
                  <div>
                    <button
                      type="button"
                      className="btn"
                      style={actBtn("C62828")}
                      disabled={busy === "remove"}
                      onClick={() => {
                        feedback.minor();
                        setRemoving(b);
                      }}
                      aria-label={td("barcodeRemoveFor", { barcode: b.barcode })}
                    >
                      <Ico d={LICON.trash} size={18} />
                      {td("barcodeRemove")}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {writable ? (
          <div>
            <button type="button" className="btn" style={actBtn("0E7C7B")} onClick={() => open("barcode")} data-testid="barcode-add">
              <Ico d={LICON.plus} size={18} />
              {tk("bcAdd")}
            </button>
          </div>
        ) : null}
      </div>
    );
  } else {
    ana = (
      <>
        <KalipBilgiIzgara baslik={td("cardTitle")} bilgiler={bilgiler} kilitD={SICON.kilit} />
        {writable ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn" style={actBtn("2F5DA8")} onClick={() => open("edit")} data-testid="item-edit-open">
              <Ico d={LICON.pencil} size={18} />
              {tk("editAria")}
            </button>
            <button
              type="button"
              className="btn"
              style={actBtn("C62828")}
              disabled={busy === "archive"}
              aria-busy={busy === "archive" || undefined}
              aria-describedby="arsiv-ipucu"
              onClick={() => {
                feedback.minor();
                setArchiveOpen(true);
              }}
            >
              <Ico d={LICON.trash} size={18} />
              {td("archive")}
            </button>
            <small id="arsiv-ipucu" className="sr">
              {td("archiveHint")}
            </small>
          </div>
        ) : null}
      </>
    );
  }
  return (
    <>
      <KalipEkran
        kind="detay"
        dark={dark}
        title={tk("screenTitle")}
        icon={{ d: LICON.box, color: "2F5DA8" }}
        heading={false}
        testId="item-detail"
        bar={{
          back: { href: base, aria: td("back") },
          main: { label: tk("edit"), aria: tk("editAria"), d: LICON.pencil, onClick: () => open("edit"), disabled: !writable, disabledReason: lockReason, testId: "item-edit" },
        }}
      >
        <KalipKayitKart
          testId="item-kart"
          serit={<KalipKartSerit etiket={tk("hero")} ad={item.name} d={vis.d} tur={tur} etiketler={etiketler} kutular={kutular} islemler={islemler} islemEtiket={tk("quick")} />}
          sekmeler={<KalipKartSekmeler etiket={tk("tabs")} sekmeler={sekmeler} secili={secili} href={sekmeHref} />}
          ana={
            <>
              {bildirimler}
              {ana}
            </>
          }
          {...(secili === "genel" && stockCard !== null
            ? {
                yan: (
                  <div data-testid="item-moves" className="contents">
                    <KalipSonHareketler baslik={tk("moves")} tumu={{ href: docs, etiket: tk("movesAll") }} bos={tk("movesNone")} hareketler={hareketler} kisiEtiket={tk("actor")} />
                  </div>
                ),
              }
            : {})}
        />
      </KalipEkran>

      <KalipOnay
        open={archiveOpen}
        title={td("confirmArchive.title", { name: item.name })}
        description={td("confirmArchive.description", { name: item.name, code: item.code })}
        confirmLabel={td("confirmArchive.button")}
        cancelLabel={t("form.cancel")}
        variant="danger"
        onConfirm={() => void onArchive()}
        onCancel={() => setArchiveOpen(false)}
      />
      <KalipOnay
        open={removing !== null}
        title={td("confirmRemove.title")}
        description={td("confirmRemove.description", { barcode: removing?.barcode ?? "" })}
        confirmLabel={td("confirmRemove.button")}
        cancelLabel={t("form.cancel")}
        variant="danger"
        onConfirm={() => void onRemove()}
        onCancel={() => setRemoving(null)}
      />
    </>
  );
}
