"use client";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { LICON } from "../../../design/kalip-icons.ts";
import { KalipFormEkran } from "../kalip/form-ekran.tsx";
import { KalipAlan, KalipGrup } from "../kalip/form.tsx";
import { KalipSecimGrubu, KalipSekme } from "../kalip/secim.tsx";
import { KalipDaha } from "../kalip/liste.tsx";
import { extraFilterParams, type ItemExtraFilters } from "./filters.ts";

export function ItemFiltersView({ dark, initial, back, onDone, onBack }: { dark: boolean; initial: ItemExtraFilters; back: string; onDone: (href: string) => void; onBack: () => void }) {
  const t = useTranslations("items.productLabels");
  const tracking = useTranslations("items.tracking");
  const [value, setValue] = useState(initial);
  const [topic, setTopic] = useState("category");
  const target = useRef(back);
  return <KalipFormEkran dark={dark} title={t("filter")} icon={{ d: LICON.search, color: "2F5DA8" }} testId="item-filters" values={value} initial={initial} rules={[]} saveShort={t("apply")} saveAria={t("apply")} savedText={t("applied")} onBack={onBack} onDone={() => onDone(target.current)} onSave={async () => {
    const url = new URL(back, "https://wms.invalid");
    for (const key of ["category", "tracking", "barcode", "after", "filters"]) url.searchParams.delete(key);
    extraFilterParams(value, url.searchParams);
    target.current = `${url.pathname}${url.search}`;
    return { ok: true };
  }} footer={<KalipDaha iconD={LICON.close} onClick={() => setValue({ category: "", tracking: "", barcode: "" })}>{t("clear")}</KalipDaha>}>
    <KalipGrup title={t("filter")} d={LICON.search} color="2F5DA8">
      <KalipSekme label={t("filter")} current={topic} color="2F5DA8" onGo={(href) => setTopic(href.slice(1))} items={(["category", "tracking", "barcode"] as const).map((id) => ({ id, label: t(id), d: id === "category" ? LICON.grid : id === "tracking" ? LICON.tag : LICON.cam, href: `#${id}`, color: "2F5DA8", taslak: true }))} />
      {topic === "category" ? <KalipAlan name="category" label={t("category")} value={value.category} maxLength={200} onChange={(e) => setValue({ ...value, category: e.target.value })} /> : topic === "tracking" ? <KalipSecimGrubu label={t("tracking")} value={value.tracking} color="2F5DA8" onPick={(id) => setValue({ ...value, tracking: id as ItemExtraFilters["tracking"] })} options={[{ id: "", label: t("all"), d: LICON.grid }, ...(["NONE", "LOT", "SERIAL", "LOT_AND_SERIAL"] as const).map((id) => ({ id, label: tracking(id), d: LICON.tag }))]} /> : <KalipSecimGrubu label={t("barcode")} value={value.barcode} color="2F5DA8" onPick={(id) => setValue({ ...value, barcode: id as ItemExtraFilters["barcode"] })} options={[{ id: "", label: t("all"), d: LICON.grid }, { id: "PRESENT", label: t("barcodePresent"), d: LICON.check }, { id: "MISSING", label: t("barcodeMissing"), d: LICON.close }]} />}
    </KalipGrup>
  </KalipFormEkran>;
}
