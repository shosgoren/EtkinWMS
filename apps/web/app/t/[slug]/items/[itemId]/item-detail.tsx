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
// T-1129 (B-188): hiç kullanılmamış üründe düzenleme formunda temel birim, miktar hassasiyeti ve takip modu seçilebilir (yeni ürün
// formuyla aynı kalıp seçimleri); kullanılmışsa "Değişmeyen bilgiler" kilitli kutusu nedeniyle kalır. Karar sunucuda (domain + 0065).
// T-1116 (B-176; tuval "5 · Ürün kartı" + "5b · Stok ve yer"): şeritte Eldeki · Kullanılabilir · Ayrılmış kutuları (sunucu toplamı);
// sekmeler Genel · Stok ve yer (katlanır pivot `KalipPivot`: Depo › Raf yeri › Lot › Palet › Koli, SKT, durum, toplam şeridi) ·
// Hareketler (son 50 belge + toplam) · Birimler · Barkodlar · Takip (lotlar, seriler) · Paraşüt · Değişiklik geçmişi (`audit.view`).
// Sekme verisi yalnız o sekme açıkken sunucuda okunur (`tabData`). Eski `Banner` ve elle biçimli satırlar kalıp parçalarına geçti
// (`KalipKartNot`, `KalipKartSatirlar`).
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { feedback } from "@wms/ui";
import type { AuditRowView } from "../../audit/audit-view.tsx";
import { KalipOnay } from "../../kalip/pencere.tsx";
import { LICON } from "../../../../design/kalip-icons.ts";
import { CodeChangedNotice, CodeEditForm } from "../../code-edit-dialog.tsx";
import { KalipUyari } from "../../kalip/detay.tsx";
import { KalipBilgiIzgara, KalipKartNot, KalipKartSatirlar, KalipKartSekmeler, KalipKartSerit, KalipKayitKart, KalipSonHareketler, type KalipBilgi, type KalipEtiket, type KalipHareket, type KalipKartIslem, type KalipKartSatiri, type KalipKartSekmesi, type KalipSayiKutusu, type StTon } from "../../kalip/kart.tsx";
import { pivotAgaci, pivotSayilari, type PivotAdim, type PivotDugum, type PivotGirdi } from "../../kalip/pivot.ts";
import { KalipPivot, type KalipPivotDurum } from "../../kalip/pivot.tsx";
import { SICON } from "../../../../design/standart-icons.ts";
import type { AlanKurali } from "../../kalip/dogrula.ts";
import { Ico, KalipEkran } from "../../kalip/ekran.tsx";
import { KalipFormEkran, KalipOnizleme, type KaydetSonuc } from "../../kalip/form-ekran.tsx";
import { KalipAlan, KalipGrup, KalipKilit, KalipSabit } from "../../kalip/form.tsx";
import { approx, fmtGun, fmtQty, stockTone } from "../../kalip/format.ts";
import { KalipSecim, KalipSecimGrubu } from "../../kalip/secim.tsx";
import { KalipKilitliDugme, useKartKilitGerekce } from "../../kalip/kilitli.tsx";
import type { KartYetki as CardRights } from "../../kalip/kart-yetki.ts";
import { kdz } from "../../kalip/tokens.ts";
import { addBarcodeAction, archiveItemAction, loadMoreItemTrackingAction, removeBarcodeAction, setConversionAction, updateItemAction } from "../actions.ts";
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
/** T-1129: sabit alan durumu (`getItemFixedState`); `usage` null = hiç kullanılmamış. */
export interface ItemFixedView {
  readonly usage: string | null;
  readonly sourceLinked: boolean;
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
const TRACKING = ["NONE", "LOT", "SERIAL", "LOT_AND_SERIAL"] as const;
const SCALES = [0, 1, 2, 3, 4, 5, 6] as const;
type ItemForm = "edit" | "kod" | "conv" | "barcode";
const FORMS: readonly ItemForm[] = ["edit", "kod", "conv", "barcode"];
const c = (hex: string): string => kdz("dzd", hex);
/** Kart içi küçük işlem düğmesi (kaynak `.btn`); kilitliyken soluk. */
const actBtn = (bg: string, locked = false): CSSProperties => ({ background: c(bg), color: c("FFFFFF"), minHeight: 48, opacity: locked ? 0.5 : 1 });

/** Ürün kartı stok özeti (sunucu, `getItemStockCard`); okunamadıysa `null` → bölümler çizilmez. */
export interface ItemStockCardView {
  readonly places: readonly { readonly warehouseId: string; readonly warehouseName: string; readonly locationCode: string; readonly quantity: string }[];
  readonly min: string | null;
  readonly moves: readonly ItemMoveView[];
  /** T-1116: kapsamdaki eldeki / ayrılmış / kullanılabilir toplam (decimal dizgi). */
  readonly have: string;
  readonly reserved: string;
  readonly available: string;
}
type ItemMoveView = { readonly documentId: string; readonly kind: string; readonly number: string | null; readonly occurredAt: string; readonly actorName: string | null; readonly net: string; readonly moved: string; readonly locations: string };

/** T-1116: sekme verilerinin görünüm biçimi (`@wms/domain/stock` dönüşleriyle aynı yapı; istemci modülü sunucu paketini içe aktarmaz). */
export interface ItemStockPivot {
  readonly rows: readonly {
    readonly warehouseId: string;
    readonly warehouseName: string;
    readonly locationId: string;
    readonly locationCode: string;
    readonly lotId: string | null;
    readonly lotCode: string | null;
    readonly productionDate: string | null;
    readonly expiryDate: string | null;
    readonly unitId: string | null;
    readonly unitCode: string | null;
    readonly unitKind: "PALET" | "KOLI" | null;
    readonly parentId: string | null;
    readonly parentCode: string | null;
    readonly parentKind: "PALET" | "KOLI" | null;
    readonly status: string;
    readonly quantity: string;
    readonly reserved: string;
  }[];
  readonly truncated: boolean;
}
export interface ItemMovesPage {
  readonly moves: readonly ItemMoveView[];
  readonly total: number;
}
export interface ItemTracking {
  readonly lots: readonly { readonly id: string; readonly lotCode: string; readonly productionDate: string | null; readonly expiryDate: string | null; readonly supplierLot: string | null; readonly quantity: string }[];
  readonly serials: readonly { readonly id: string; readonly serialNo: string; readonly lotCode: string | null; readonly locationCode: string | null; readonly warehouseName: string | null }[];
  readonly lotTotal: number;
  readonly serialTotal: number;
  readonly lotNext: string | null;
  readonly serialNext: string | null;
}

/** T-1116: açık sekmenin sunucu verisi (`page.tsx`); okunamadıysa ilgili alan `null` → sekmede "okunamadı" satırı. */
export type ItemTabData =
  | { readonly kind: "none" }
  | { readonly kind: "stok"; readonly pivot: ItemStockPivot | null }
  | { readonly kind: "hareketler"; readonly page: ItemMovesPage | null }
  | { readonly kind: "takip"; readonly tracking: ItemTracking | null }
  | { readonly kind: "gecmis"; readonly rows: readonly AuditRowView[] | null; readonly more: boolean };

// T-1116 pivot seviyeleri (STANDART §7: depo koyu gri bina, raf yeri gri raf, lot mavi etiket, palet kahve, koli turuncu kutu).
const PIVOT_TUR = {
  depo: { d: SICON.depo, ton: "lacivert" },
  raf: { d: SICON.raf, ton: "gri" },
  lot: { d: SICON.ad, ton: "mavi" },
  palet: { d: SICON.palet, ton: "kahve" },
  koli: { d: SICON.kutu, ton: "turuncu" },
  gevsek: { d: SICON.kutu, ton: "gri" },
} as const satisfies Record<string, { d: string; ton: StTon }>;
const DURUM_TON: Readonly<Record<string, KalipPivotDurum["ton"]>> = { AVAILABLE: "ok", QUARANTINE: "amber", DAMAGED: "kirmizi", BLOCKED: "kirmizi" };

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

/** Sunucu reddi → formda gösterim: alanla ilgili ret o alanın altında, diğerleri genel neden. */
function itemErr(e: ServerError, tr: (k: string) => string, field: (key: string) => string | null): KaydetSonuc {
  const key = errorKey(e);
  const text = `${tr(key)} ${tr(`${key}Action`)}`.trim();
  const alan = field(key);
  if (alan !== null) return { ok: false, alan: { [alan]: text } };
  return { ok: false, mesaj: e.requestId === undefined ? text : `${text} · ${e.requestId}` };
}

/** Ürün kartı düzenleme — TAM EKRAN FORM (`?edit=1`): ad, kart türü ve çıkış kuralı; sabit alanlar (temel birim, hassasiyet, takip)
 * yalnız hiç kullanılmamış üründe seçilebilir (T-1129), aksi kilitli satırlar + neden. */
function ItemEditForm({ slug, dark, item, fixed, units, onBack, onDone }: { slug: string; dark: boolean; item: ItemDetailItem; fixed: ItemFixedView; units: readonly UnitOption[]; onBack: () => void; onDone: () => void }) {
  const t = useTranslations("items");
  const td = useTranslations("items.detail");
  const tk = useTranslations("items.detail.k");
  const terr = useTranslations("items.errors");
  const tc = useTranslations("items.cardType");
  const tp = useTranslations("items.pick");
  const tt = useTranslations("items.tracking");
  const editable = fixed.usage === null;
  const unitEditable = editable && !fixed.sourceLinked;
  const [initial] = useState(() => ({ name: item.name, cardType: item.cardType as string, pick: item.pickPolicy, unitId: item.baseUnitId, scale: String(item.quantityScale), tracking: item.trackingMode }));
  const [v, setV] = useState(initial);
  const set = (k: keyof typeof v, val: string): void => setV((cur) => ({ ...cur, [k]: val }));
  const rules: AlanKurali[] = [{ name: "name", label: t("form.name"), required: true, maxLength: 512 }, ...(unitEditable ? [{ name: "unitId", label: t("form.baseUnit"), required: true }] : [])];
  const vis = CARD_VISUAL[(CARD_TYPES as readonly string[]).includes(v.cardType) ? (v.cardType as CardType) : item.cardType];
  const unitOf = (id: string): UnitOption | undefined => units.find((u) => u.id === id);
  const unitCode = v.unitId === item.baseUnitId ? item.baseUnitCode : (unitOf(v.unitId)?.code ?? item.baseUnitCode);

  async function save(): Promise<KaydetSonuc> {
    const r = await updateItemAction({
      slug,
      itemId: item.id,
      name: v.name,
      pickPolicy: v.pick,
      cardType: v.cardType,
      // T-1129: yalnız değişen sabit alan gönderilir (değişmeyen alan sunucuda kullanım denetimine girmez).
      ...(editable && v.unitId !== initial.unitId ? { baseUnitId: v.unitId } : {}),
      ...(editable && v.scale !== initial.scale ? { quantityScale: Number(v.scale) } : {}),
      ...(editable && v.tracking !== initial.tracking ? { trackingMode: v.tracking } : {}),
    });
    if (!r.ok) {
      const e = toServerError(r.error);
      if (errorKey(e) === "validation_failed_in_use") return { ok: false, mesaj: td("fixedNowLocked") };
      return itemErr(e, (k) => terr(k), (key) => (key === "validation_failed" ? "name" : null));
    }
    return { ok: true };
  }
  const scaleLabel = (n: number): string => (n === 0 ? t("form.scaleInteger") : t("form.scaleDecimals", { count: n }));
  const lockReason = fixed.usage === null ? td("lockedFixed") : td("lockedInUse", { reason: td(`fixedUsage.${fixed.usage}`) });
  const fixedRows = [
    { k: t("form.baseUnit"), v: item.baseUnitCode, d: LICON.tag },
    { k: t("form.scale"), v: scaleLabel(item.quantityScale), d: LICON.gear },
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
      preview={<KalipOnizleme name={v.name} code={item.code} d={vis.d} color={vis.color} kind={tc(v.cardType)} rows={[{ k: t("form.baseUnit"), v: unitCode }, { k: t("form.pick"), v: tp(v.pick) }]} />}
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
      {editable ? (
        <KalipGrup title={tk("fixedEditTitle")} sub={lockReason} d={LICON.tag} color="2F5DA8" testId="item-fixed-edit">
          {unitEditable ? (
            <KalipSecim
              name="unitId"
              label={t("form.baseUnit")}
              hint={t("form.baseUnitHint")}
              value={v.unitId}
              color="2F5DA8"
              list
              placeholder={t("form.baseUnitPlaceholder")}
              icon={{ d: LICON.tag, color: "2F5DA8" }}
              onPick={(id) => set("unitId", id)}
              options={units.map((u) => ({ id: u.id, label: u.code, sub: u.name, keys: [u.name] }))}
              testId="item-base-unit"
            />
          ) : (
            <KalipSabit title={t("form.baseUnit")} d={LICON.tag} color="4E6476" pill={{ label: item.baseUnitCode, ok: true }} aria={`${t("form.baseUnit")}: ${item.baseUnitCode} · ${td("sourceUnitLocked")}`} testId="item-base-unit-locked" />
          )}
          <KalipSecim
            name="scale"
            label={t("form.scale")}
            hint={t("form.scaleHint")}
            value={v.scale}
            color="4E6476"
            list
            icon={{ d: LICON.gear, color: "4E6476" }}
            onPick={(id) => set("scale", id)}
            options={SCALES.map((n) => ({ id: String(n), label: scaleLabel(n) }))}
            testId="item-scale"
          />
          <KalipSecimGrubu name="tracking" label={t("form.tracking")} value={v.tracking} color="6C4BD8" onPick={(id) => set("tracking", id)} options={TRACKING.map((k) => ({ id: k, label: tt(k), d: k === "NONE" ? LICON.close : LICON.tag }))} testId="item-tracking" />
        </KalipGrup>
      ) : (
        <KalipGrup title={tk("fixedTitle")} sub={lockReason} d={LICON.lock} color="4E6476" testId="item-fixed-locked">
          <KalipKilit title={lockReason} sub={td("fixedLockedSub")} />
          {fixedRows.map((f) => (
            <KalipSabit key={f.k} title={f.k} d={f.d} color="4E6476" pill={{ label: f.v, ok: true }} aria={`${f.k}: ${f.v}`} />
          ))}
        </KalipGrup>
      )}
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

/** T-1116 "Stok ve yer" (kaynak `StandartUrunKartiStok.dc.html`): sunucu satırları → Depo › Raf yeri › Lot › Palet › Koli pivotu. */
function StokPivot({ pivot, have, unit }: { pivot: ItemStockPivot; have: string; unit: string }) {
  const tk = useTranslations("items.detail.k");
  const locale = useLocale();
  const fq = (v: string): string => fmtQty(v, locale);
  const paket = (kind: "PALET" | "KOLI" | null): string => (kind === "PALET" ? "palet" : "koli");
  const girdiler: PivotGirdi[] = pivot.rows.map((r) => {
    const yol: PivotAdim[] = [
      { tur: "depo", id: r.warehouseId, etiket: r.warehouseName },
      { tur: "raf", id: r.locationId, etiket: r.locationCode },
    ];
    if (r.lotId !== null) yol.push({ tur: "lot", id: r.lotId, etiket: r.lotCode ?? "", skt: r.expiryDate, ...(r.productionDate === null ? {} : { meta: tk("produced", { date: fmtGun(r.productionDate, locale) }) }) });
    if (r.parentId !== null) yol.push({ tur: paket(r.parentKind), id: r.parentId, etiket: r.parentCode ?? "" });
    if (r.unitId !== null) yol.push({ tur: paket(r.unitKind), id: r.unitId, etiket: r.unitCode ?? "" });
    return { yol, miktar: r.quantity, ayrilmis: r.reserved, durum: r.status };
  });
  const kokler = pivotAgaci(girdiler, (ust) => ({ tur: "gevsek", id: `${ust.tur}:${ust.id}`, etiket: tk("loose") }));
  const say = (m: ReadonlyMap<string, number>, tur: "depo" | "raf" | "lot" | "palet" | "koli"): string | null => {
    const n = m.get(tur) ?? 0;
    if (n === 0) return null;
    const k = { depo: "cntDepo", raf: "cntRaf", lot: "cntLot", palet: "cntPalet", koli: "cntKoli" } as const;
    return tk(k[tur], { n });
  };
  const birlestir = (xs: readonly (string | null)[]): string | null => {
    const v = xs.filter((x): x is string => x !== null);
    return v.length === 0 ? null : v.join(" · ");
  };
  const meta = (d: PivotDugum, alt: ReadonlyMap<string, number>): string | null => {
    if (d.meta !== null) return d.meta;
    if (d.tur === "depo") return birlestir([say(alt, "raf"), say(alt, "lot")]);
    if (d.tur === "raf") return birlestir([say(alt, "palet"), say(alt, "koli")]) ?? (alt.has("lot") ? say(alt, "lot") : tk("loose"));
    if (d.tur === "lot" || d.tur === "palet") return birlestir(d.tur === "lot" ? [say(alt, "palet"), say(alt, "koli")] : [say(alt, "koli")]);
    return null;
  };
  const sayilar = pivotSayilari(kokler);
  return (
    <>
      {pivot.truncated ? <KalipKartNot metin={tk("pivotTruncated", { n: pivot.rows.length })} d={SICON.bilgi} renk="amber" /> : null}
      <KalipPivot
        key={pivot.rows.length}
        testId="item-pivot"
        etiket={tk("pivotTitle")}
        baslik={tk("pivotHead")}
        sutunlar={{ skt: tk("pivotSkt"), durum: tk("pivotStatus"), miktar: tk("pivotQty", { unit }) }}
        kokler={kokler}
        turler={PIVOT_TUR}
        meta={meta}
        durum={(kod) => ({ metin: tk(`st_${kod}`), ton: DURUM_TON[kod] ?? "amber" })}
        ayrilmis={(q) => tk("reservedPill", { q: fq(q) })}
        miktar={fq}
        skt={(g) => fmtGun(g, locale)}
        grupla={{ etiket: tk("pivotGroup"), seviyeler: [{ tur: "depo", etiket: tk("lvlDepo") }, { tur: "raf", etiket: tk("lvlRaf") }, { tur: "lot", etiket: tk("lvlLot") }, { tur: "paket", etiket: tk("lvlPaket") }] }}
        ac={tk("pivotOpen")}
        kapat={tk("pivotClose")}
        toplam={{ etiket: tk("pivotTotal"), ozet: birlestir([say(sayilar, "depo"), say(sayilar, "raf"), say(sayilar, "lot"), say(sayilar, "palet"), say(sayilar, "koli")]) ?? "", miktar: `${fq(have)} ${unit}` }}
      />
    </>
  );
}

/** T-1116 Takip: lotlar ve seriler; her liste kendi "Daha fazla" düğmesiyle sunucudan sonraki sayfayı (keyset) ekler (Codex P2). */
function TakipListesi({ slug, itemId, unit, lotOnly, tracking }: { slug: string; itemId: string; unit: string; lotOnly: boolean; tracking: ItemTracking }) {
  const tk = useTranslations("items.detail.k");
  const locale = useLocale();
  const fq = (v: string): string => fmtQty(v, locale);
  const [lots, setLots] = useState(tracking.lots);
  const [serials, setSerials] = useState(tracking.serials);
  const [next, setNext] = useState<{ readonly lots: string | null; readonly serials: string | null }>({ lots: tracking.lotNext, serials: tracking.serialNext });
  const [busy, setBusy] = useState<"lots" | "serials" | null>(null);
  const [failed, setFailed] = useState(false);
  async function more(part: "lots" | "serials"): Promise<void> {
    const after = next[part];
    if (after === null || busy !== null) return;
    setBusy(part);
    setFailed(false);
    const r = await loadMoreItemTrackingAction({ slug, itemId, part, after });
    setBusy(null);
    if (!r.ok) {
      feedback.error();
      setFailed(true);
      return;
    }
    feedback.minor();
    if (part === "lots") setLots((cur) => [...cur, ...r.data.lots]);
    else setSerials((cur) => [...cur, ...r.data.serials]);
    setNext((cur) => ({ ...cur, [part]: r.data.next }));
  }
  const lotlar: KalipKartSatiri[] = lots.map((l) => ({
    key: l.id,
    baslik: <span className="mono">{l.lotCode}</span>,
    meta: [l.expiryDate === null ? tk("lotNoExpiry") : tk("lotMeta", { expiry: fmtGun(l.expiryDate, locale) }), l.productionDate === null ? null : tk("produced", { date: fmtGun(l.productionDate, locale) }), l.supplierLot === null ? null : tk("lotSupplier", { lot: l.supplierLot })].filter((x) => x !== null).join(" · "),
    deger: `${fq(l.quantity)} ${unit}`,
    d: SICON.ad,
    ton: "mavi",
    testId: "tracking-lot",
  }));
  const seriler: KalipKartSatiri[] = serials.map((x) => ({
    key: x.id,
    baslik: <span className="mono">{x.serialNo}</span>,
    meta: [x.lotCode, x.locationCode === null ? tk("serialNotInStock") : `${x.warehouseName ?? ""} · ${x.locationCode}`].filter((v) => v !== null).join(" · "),
    d: SICON.qr,
    ton: "camgobegi",
    testId: "tracking-serial",
  }));
  const daha = (part: "lots" | "serials", shown: number, total: number) =>
    next[part] === null ? null : (
      <span className="stkdugmeler">
        <small className="stkbos">{tk("shownOf", { shown, total })}</small>
        <button type="button" className="stpv-dugme" onClick={() => void more(part)} disabled={busy !== null} aria-busy={busy === part || undefined} data-testid={`tracking-more-${part}`}>
          {tk("more")}
        </button>
      </span>
    );
  return (
    <div data-testid="item-tracking" className="stkyigin">
      {failed ? <KalipKartNot metin={tk("moreFailed")} d={SICON.uyari} renk="amber" /> : null}
      <b className="stkbas">{tk("lots")}</b>
      <KalipKartSatirlar etiket={tk("lots")} satirlar={lotlar} bos={tk("lotsEmpty")} />
      {daha("lots", lots.length, tracking.lotTotal)}
      {lotOnly && tracking.serialTotal === 0 ? null : (
        <>
          <b className="stkbas">{tk("serials")}</b>
          <KalipKartSatirlar etiket={tk("serials")} satirlar={seriler} bos={tk("serialsEmpty")} />
          {daha("serials", serials.length, tracking.serialTotal)}
        </>
      )}
    </div>
  );
}

export function ItemDetail({
  slug,
  dark,
  rights,
  quick,
  stockCard,
  tabData = { kind: "none" },
  canHistory = false,
  sourceInfo = {},
  fixed,
  units,
  item,
  conversions,
  barcodes,
}: {
  slug: string;
  dark: boolean;
  /** T-1141: kart bölümü yetkileri (yalnız gösterim; karar domain'de). */
  rights: CardRights;
  quick: ItemQuickAccess;
  stockCard: ItemStockCardView | null;
  tabData?: ItemTabData;
  canHistory?: boolean;
  sourceInfo?: Readonly<Record<string, { readonly categoryName?: string | null; readonly gtip?: string | null; readonly unit?: string | null; readonly archived?: boolean | null; readonly lifecycle?: "NONE"|"PENDING"|"ARCHIVED"|"REMOVED"; readonly sourceState?: "ACTIVE"|"ARCHIVED"|"DELETED"; readonly inventoryTracking?: boolean | null }>>;
  fixed: ItemFixedView;
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
  // T-1141: değiştirme (ad, kod, birim dönüşümü, barkod) `items.edit`, arşiv `items.archive`. Yetkisiz işlem gizlenmez: kilitli düğme + neden.
  const writable = rights.edit && active;
  const canArchive = rights.archive && active;
  const kilitGerekce = useKartKilitGerekce("items");
  const editLocked = active && !rights.edit;
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
  // T-1116: toplam sunucunun kapsam toplamıdır (eski: ilk 60 raf yerinin toplamı).
  const totalRaw = stockCard === null ? null : stockCard.have;
  const tn = stockCard === null || totalRaw === null ? "ok" : stockTone(totalRaw, stockCard.min);
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
  const hareket = (m: ItemMoveView): KalipHareket => {
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
  };
  const hareketler: KalipHareket[] = (stockCard?.moves ?? []).map(hareket);
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
    { key: "available", etiket: tk("boxAvailable"), deger: fq(stockCard.available), d: SICON.onay, ton: "ok", testId: "kalip-available" },
    { key: "reserved", etiket: tk("boxReserved"), deger: fq(stockCard.reserved), d: SICON.kilit, ton: "amber", testId: "kalip-reserved" },
    ...(stockCard.min === null ? [] : [{ key: "min", etiket: tk("boxMin"), deger: fq(stockCard.min), d: SICON.uyari, ton: tn === "ok" ? ("ok" as const) : ("amber" as const) }]),
  ];
  // T-1129: kilit yalnız kullanılmış üründe (neden metniyle); bağlı sistemden gelen ürünün birimi ayrıca kilitli.
  const fixedLock = fixed.usage === null ? undefined : td("lockedInUse", { reason: td(`fixedUsage.${fixed.usage}`) });
  const unitLock = fixedLock ?? (fixed.sourceLinked ? td("sourceUnitLocked") : undefined);
  const bilgiler: KalipBilgi[] = [
    { key: "name", etiket: t("form.name"), deger: item.name, d: SICON.ad, ton: "mavi" },
    {
      key: "code",
      etiket: tk("infoCode"),
      deger: <span className="mono">{item.code}</span>,
      d: SICON.barkod,
      ton: "lacivert",
      ...(active
        ? {
            islem: (
              <KalipKilitliDugme kilitli={!writable} gerekce={kilitGerekce("edit")} kilitIkonu={false} onClick={() => open("kod")} aria-label={td("codeEdit.for", { name: item.name })} title={td("codeEdit.button")} data-testid="item-code-edit">
                <Ico d={writable ? SICON.kalem : LICON.lock} size={18} />
              </KalipKilitliDugme>
            ),
          }
        : {}),
    },
    { key: "type", etiket: t("form.cardType"), deger: tc(item.cardType), d: SICON.kutu, ton: tur },
    { key: "unit", etiket: t("form.baseUnit"), deger: unit, d: SICON.birim, ton: "lacivert", ...(unitLock === undefined ? {} : { kilit: unitLock }) },
    { key: "conv", etiket: td("conversionsTitle"), deger: conversions.length === 0 ? tk("none") : conversions.map((cv) => td("conversionLine", { unit: cv.unitCode, factor: cv.factor, base: unit })).join(" · "), d: SICON.cevrim, ton: "mor" },
    { key: "pick", etiket: t("form.pick"), deger: tp(item.pickPolicy), d: SICON.list, ton: "camgobegi" },
    { key: "tracking", etiket: t("form.tracking"), deger: tt(item.trackingMode), d: SICON.qr, ton: "camgobegi", ...(fixedLock === undefined ? {} : { kilit: fixedLock }) },
    { key: "scale", etiket: t("form.scale"), deger: item.quantityScale === 0 ? t("form.scaleInteger") : t("form.scaleDecimals", { count: item.quantityScale }), d: SICON.birim, ton: "gri", ...(fixedLock === undefined ? {} : { kilit: fixedLock }) },
    ...(stockCard?.min === null || stockCard?.min === undefined ? [] : [{ key: "min", etiket: tk("boxMin"), deger: `${fq(stockCard.min)} ${unit}`, d: SICON.uyari, ton: "turuncu" as const }]),
  ];
  const sourceRows: KalipBilgi[] = Object.entries(sourceInfo).sort(([a], [b]) => a.localeCompare(b)).flatMap(([provider, info]) => {
    const name = provider === "PARASUT" ? "Paraşüt" : provider === "LOGO" ? "Logo" : provider;
    const field = (key: string, label: string, value: ReactNode, d: string): KalipBilgi => ({ key: `${provider}-${key}`, etiket: `${name} · ${label}`, deger: value, d, ton: "turuncu", kilit: tsrc("sourceLocked") });
    const flag = (v: boolean | null): string => v === null ? "—" : tsrc(v ? "yes" : "no");
    return [...(info.lifecycle && info.lifecycle!=="NONE"?[field("lifecycle",tsrc("sourceStatus"),tsrc(info.lifecycle==="PENDING"?"pending":info.lifecycle==="REMOVED"?"removed":"archived"),SICON.bilgi)]:[]),field("category", tsrc("category"), info.categoryName ?? "—", SICON.kutu), field("gtip", tsrc("sourceGtip"), info.gtip ?? "—", SICON.list), field("unit", tsrc("sourceUnit"), info.unit ?? "—", SICON.birim), ...(info.archived === undefined ? [] : [field("archived", tsrc("sourceArchived"), flag(info.archived), SICON.bilgi)]), ...(info.inventoryTracking === undefined ? [] : [field("inventory", tsrc("sourceInventory"), flag(info.inventoryTracking), SICON.bilgi)])];
  });
  // T-1116: tuval sırası (Genel · Stok ve yer · Hareketler · Barkodlar · Takip · Paraşüt · Değişiklik geçmişi); Birimler tuvalde yok, eski
  // sekme korunur. Takip yalnız lot/seri izlenen üründe, geçmiş yalnız `audit.view` yetkisinde.
  const sekmeler: KalipKartSekmesi[] = [
    { id: "genel", etiket: tk("tabGeneral"), d: SICON.bilgi, ton: "stok" },
    ...(stockCard === null ? [] : [{ id: "stok", etiket: tk("tabStock"), d: SICON.raf, ton: "lacivert" as const }, { id: "hareketler", etiket: tk("tabMoves"), d: SICON.cevrim, ton: "mor" as const }]),
    { id: "birim", etiket: tk("tabUnits"), d: SICON.birim, ton: "mor" },
    { id: "barkod", etiket: tk("tabBarcodes"), d: SICON.barkod, ton: "mavi" },
    ...(item.trackingMode === "NONE" ? [] : [{ id: "takip", etiket: tk("tabTracking"), d: SICON.takip, ton: "camgobegi" as const }]),
    ...(sourceRows.length === 0 ? [] : [{ id: "erp", etiket: tsrc("sourceTitle"), d: SICON.baglanti, ton: "parasut" as const }]),
    ...(canHistory ? [{ id: "gecmis", etiket: tk("tabHistory"), d: SICON.gecmis, ton: "gri" as const }] : []),
  ];
  const secili = sekmeler.some((s) => s.id === sekme) ? sekme : "genel";
  const sekmeHref = (id: string): string => (id === "genel" ? itemPath : `${itemPath}?sekme=${id}`);

  if (form === "edit") return <ItemEditForm key="edit" slug={slug} dark={dark} item={item} fixed={fixed} units={units} onBack={() => back()} onDone={() => back(td("done.saved"))} />;
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

  const lockReason = editLocked ? kilitGerekce("edit") : td("archivedNote");
  const bildirimler = (
    <>
      {codeChanged ? <CodeChangedNotice from={codeChanged.from} to={item.code === codeChanged.from ? codeChanged.to : item.code} busy={undoing} onUndo={() => void undoCode()} /> : null}
      {notice ? <KalipKartNot metin={notice} d={SICON.onay} renk="ok" testId="item-notice" /> : null}
      {error ? <ServerErrorBanner error={error} returnTo={returnTo} /> : null}
      {editLocked ? <p className="sr">{kilitGerekce("edit")}</p> : null}
      {active ? null : <KalipKartNot metin={td("archivedNote")} d={SICON.arsiv} renk="gri" testId="item-archived-note" />}
    </>
  );
  let ana: ReactNode;
  if (secili === "erp") {
    ana = <KalipBilgiIzgara baslik={tsrc("sourceTitle")} bilgiler={sourceRows} kilitD={SICON.kilit} />;
  } else if (secili === "stok" && stockCard !== null) {
    const pivot = tabData.kind === "stok" ? tabData.pivot : null;
    ana = (
      <div data-testid="item-where" className="stkpvkap">
        {tn !== "ok" && stockCard.min !== null && totalRaw !== null ? <KalipUyari title={tk("belowMin")} sub={tk("belowMinSub", { have: fq(totalRaw), min: fq(stockCard.min), unit })} /> : null}
        {pivot === null ? (
          <KalipKartNot metin={tk("pivotUnread")} d={SICON.uyari} renk="amber" />
        ) : pivot.rows.length === 0 ? (
          <small className="stkbos">{tk("whereEmpty")}</small>
        ) : (
          <StokPivot pivot={pivot} have={stockCard.have} unit={unit} />
        )}
      </div>
    );
  } else if (secili === "hareketler" && stockCard !== null) {
    const page = tabData.kind === "hareketler" ? tabData.page : null;
    ana =
      page === null ? (
        <KalipKartNot metin={tk("movesUnread")} d={SICON.uyari} renk="amber" />
      ) : (
        <div data-testid="item-moves-tab" className="stkyigin">
          <KalipSonHareketler baslik={tk("tabMoves")} tumu={{ href: docs, etiket: tk("movesAll") }} bos={tk("movesNone")} hareketler={page.moves.map(hareket)} kisiEtiket={tk("actor")} />
          {page.total > page.moves.length ? <small className="stkbos">{tk("movesShown", { shown: page.moves.length, total: page.total })}</small> : null}
        </div>
      );
  } else if (secili === "takip") {
    const tr = tabData.kind === "takip" ? tabData.tracking : null;
    ana = tr === null ? <KalipKartNot metin={tk("trackingUnread")} d={SICON.uyari} renk="amber" /> : <TakipListesi key={item.id} slug={slug} itemId={item.id} unit={unit} lotOnly={item.trackingMode === "LOT"} tracking={tr} />;
  } else if (secili === "gecmis") {
    const rows = tabData.kind === "gecmis" ? tabData.rows : null;
    ana =
      rows === null ? (
        <KalipKartNot metin={tk("historyUnread")} d={SICON.uyari} renk="amber" />
      ) : (
        <div data-testid="item-history" className="stkyigin">
          <b className="stkbas">{tk("history")}</b>
          <KalipKartSatirlar
            etiket={tk("history")}
            bos={tk("historyEmpty")}
            satirlar={rows.map((r) => ({ key: r.id, baslik: r.actionLabel, meta: [r.when, r.actor, r.reason].filter((x) => x !== null && x !== "").join(" · "), d: SICON.gecmis, ton: "gri", testId: "history-row" }))}
          />
          {tabData.kind === "gecmis" && tabData.more ? (
            <Link className="stkdaha" href={`/t/${encodeURIComponent(slug)}/audit?q=${encodeURIComponent(item.id)}`} prefetch={false}>
              {tk("historyAll")}
            </Link>
          ) : null}
        </div>
      );
  } else if (secili === "birim") {
    ana = (
      <div id="sec-conv" className="stkyigin">
        <b className="stkbas">{td("conversionsTitle")}</b>
        <small className="stkbos">{td("conversionsHint", { unit })}</small>
        <KalipKartSatirlar
          etiket={td("conversionsTitle")}
          bos={td("conversionsEmpty")}
          satirlar={conversions.map((cv) => ({ key: cv.unitId, baslik: td("conversionLine", { unit: cv.unitCode, factor: cv.factor, base: unit }), d: SICON.cevrim, ton: "mor", testId: "conversion-row" }))}
        />
        {editLocked ? (
          <div>
            <KalipKilitliDugme kilitli gerekce={kilitGerekce("edit")} className="btn" style={actBtn("6C4BD8", true)} data-testid="conversion-add">
              <Ico d={LICON.plus} size={18} />
              {tk("convAdd")}
            </KalipKilitliDugme>
          </div>
        ) : null}
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
      <div id="sec-bc" className="stkyigin">
        <b className="stkbas">{td("barcodesTitle")}</b>
        <small className="stkbos">{td("barcodesHint")}</small>
        <KalipKartSatirlar
          etiket={td("barcodesTitle")}
          bos={td("barcodesEmpty")}
          satirlar={barcodes.map((b) => {
            const alt = (
              <>
                {b.ambiguous ? <KalipUyari title={td("barcodeAmbiguous")} sub={b.barcode} /> : null}
                {writable || editLocked ? (
                  <KalipKilitliDugme
                    kilitli={editLocked}
                    gerekce={kilitGerekce("edit")}
                    className="btn"
                    style={actBtn("C62828", editLocked)}
                    aria-busy={busy === "remove" || undefined}
                    onClick={() => {
                      if (busy === "remove") return;
                      feedback.minor();
                      setRemoving(b);
                    }}
                    aria-label={td("barcodeRemoveFor", { barcode: b.barcode })}
                  >
                    <Ico d={LICON.trash} size={18} />
                    {td("barcodeRemove")}
                  </KalipKilitliDugme>
                ) : null}
              </>
            );
            return {
              key: b.id,
              baslik: <span className="mono">{b.barcode}</span>,
              meta: td("barcodeMeta", { unit: b.unitCode, quantity: b.quantity }),
              d: SICON.barkod,
              ton: "mavi" as const,
              testId: "barcode-row",
              ...(b.ambiguous || writable || editLocked ? { altta: alt } : {}),
            };
          })}
        />
        {active ? (
          <div>
            <KalipKilitliDugme kilitli={editLocked} gerekce={kilitGerekce("edit")} className="btn" style={actBtn("0E7C7B", editLocked)} onClick={() => open("barcode")} data-testid="barcode-add">
              <Ico d={LICON.plus} size={18} />
              {tk("bcAdd")}
            </KalipKilitliDugme>
          </div>
        ) : null}
      </div>
    );
  } else {
    ana = (
      <>
        <KalipBilgiIzgara baslik={td("cardTitle")} bilgiler={bilgiler} kilitD={SICON.kilit} />
        {active ? (
          <div className="stkdugmeler">
            <KalipKilitliDugme kilitli={!writable} gerekce={kilitGerekce("edit")} className="btn" style={actBtn("2F5DA8", !writable)} onClick={() => open("edit")} data-testid="item-edit-open">
              <Ico d={LICON.pencil} size={18} />
              {tk("editAria")}
            </KalipKilitliDugme>
            <KalipKilitliDugme
              kilitli={!canArchive}
              gerekce={kilitGerekce("archive")}
              className="btn"
              style={actBtn("C62828", !canArchive)}
              aria-busy={busy === "archive" || undefined}
              aria-describedby="arsiv-ipucu"
              onClick={() => {
                if (busy === "archive") return;
                feedback.minor();
                setArchiveOpen(true);
              }}
              data-testid="item-archive"
            >
              <Ico d={LICON.trash} size={18} />
              {td("archive")}
            </KalipKilitliDugme>
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
          main: { label: tk("edit"), aria: tk("editAria"), d: LICON.pencil, onClick: () => open("edit"), disabled: !active, locked: editLocked, disabledReason: lockReason, testId: "item-edit" },
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
        open={archiveOpen && canArchive}
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
