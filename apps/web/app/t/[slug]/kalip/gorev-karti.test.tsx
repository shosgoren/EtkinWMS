import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
// KalipKart'ın gerçek işaretlemesini korur; üst çubuğun oturum/eylem bağımlılıkları bu sunum testine girmez.
vi.mock("./ekran.tsx", () => ({ Ico: () => <svg aria-hidden="true" />, MicIco: () => <svg aria-hidden="true" /> }));
import { KalipGorevKarti, type KalipGorevBilgi } from "./gorev-karti.tsx";

const task: KalipGorevBilgi = {
  itemName: "EPDM Granül", itemCode: "HM-0042", warehouseName: "Ana depo",
  locationCode: "A-01", locationName: "Hammadde rafı", quantity: "1240.500000",
};
const render = (value: KalipGorevBilgi, locale = "tr") => renderToStaticMarkup(
  <KalipGorevKarti task={value} kind="Toplama" status="Sana atanmış" quantityLabel="MİKTAR" locale={locale} d="M0 0" color="2F5DA8" />,
);

describe("görev kartının görünür iş bilgisi", () => {
  it("ürün, görev, depo ve rafı mobilde gizlenen meta kullanmadan gösterir", () => {
    const html = render(task);
    expect(html).toContain('<b>EPDM Granül</b>');
    expect(html).toContain('HM-0042 · Toplama · Sana atanmış</small>');
    expect(html).toContain('<small title="Ana depo">Ana depo</small>');
    expect(html).toContain('<small title="A-01 · Hammadde rafı">A-01 · Hammadde rafı</small>');
    expect(html).not.toContain('class="um"');
    expect(html).not.toContain("<button");
    expect(html).toContain('<b>1.240,5</b>');
    expect(render(task, "en")).toContain('<b>1,240.5</b>');
  });

  it("ürün ve raf olmayan görevde yalnız türü ve mevcut depoyu gösterir", () => {
    const html = render({ ...task, itemName: null, itemCode: null, locationName: null, locationCode: null, quantity: null });
    expect(html).toContain('<b>Toplama</b>');
    expect(html).toContain('<small title="Ana depo">Ana depo</small>');
    expect(html).not.toContain("HM-0042");
    expect(html).not.toContain("A-01");
    expect(html).not.toContain('class="qb"');
  });

  it("sunucudan gelen adları metin olarak kaçışlar", () => {
    const html = render({ ...task, itemName: "<script>ürün</script>", warehouseName: 'Depo "B"' });
    expect(html).toContain("&lt;script&gt;ürün&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('title="Depo &quot;B&quot;"');
  });
});
