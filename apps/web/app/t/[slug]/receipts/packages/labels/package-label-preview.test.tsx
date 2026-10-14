import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReceiptPackageDto } from "../actions.ts";
import { PackageLabelPages, PackageLabelPreview } from "./package-label-preview.tsx";
import { generatePackageQrs, type PackageLabelMetadata } from "./package-labels.ts";
const id = "11111111-1111-4111-8111-111111111111";
const p: ReceiptPackageDto = { id, qr: `EWMS:PKG:1:${id}`, packageNo: 1, kind: "VARIL", receiptLineId: id, documentLineId: id, itemId: id, itemCode: "HM-000001", itemName: '<script>alert("x")</script>', unitId: id, unitCode: "KG", unitName: "Kilogram", quantity: "200.000", conversionFactor: "1", baseQuantity: "200.000", receivingLocationId: id, stockStatus: "QUARANTINE", lotId: id, lotCode: '<img src=x onerror="alert(1)">', producedOn: "2026-10-01", expiresOn: "2027-10-01" };
describe("package label preview", () => {
  it("initial QR generation disables print and renders no empty printable sheet", () => {
    const html = renderToStaticMarkup(<PackageLabelPreview packages={[p]} />);
    expect(html).toContain("disabled"); expect(html).toContain("QR kodları hazırlanıyor");
    expect(html).not.toContain("package-label-sheet");
    expect(html).toContain("min-height:56px"); expect(html).toContain("min-h-[48px]");
    expect(html).toContain("<summary"); expect(html).toContain("Yazdırma yardımı");
  });
  it("renders escaped names/lot, accepted quantity, dates, separate numbering, and quarantine", async () => {
    const html = renderToStaticMarkup(<PackageLabelPages packages={[p]} qrs={await generatePackageQrs([p])} width={100} height={75} />);
    expect(html).toContain("&lt;script&gt;"); expect(html).toContain("&lt;img");
    expect(html).not.toContain("<script>"); expect(html).not.toContain("<img");
    expect(html).toContain("Paket miktarı: 200.000 KG"); expect(html).toContain("Paket 1 / 1");
    expect(html).toContain("2026-10-01"); expect(html).toContain("2027-10-01");
    expect(html).toContain(id); expect(html).toContain("Karantina"); expect(html).toContain('fill="var(--color-surface)"'); expect(html).toContain('fill="var(--color-ink)"');
  });
  it("renders all normal short metadata at the shared 100 × 50 mm roll size", async () => {
    const short = { ...p, itemName: "Rubber", lotCode: "LOT-1" };
    const html = renderToStaticMarkup(<PackageLabelPages packages={[short]} qrs={await generatePackageQrs([short])} width={100} height={50} />);
    expect(html).toContain("width:100mm;height:50mm");
    expect(html).toContain("Rubber"); expect(html).toContain("Lot: LOT-1");
    expect(html).toContain("Paket miktarı: 200.000 KG"); expect(html).toContain("height:28mm");
    expect(html).not.toContain("max-height");
  });
  it("renders no partial sheet for missing or failed QR", async () => {
    const qrs = await generatePackageQrs([p]);
    for (const incomplete of [[], [{ ...qrs[0]!, path: "" }], [{ ...qrs[0]!, id: "wrong" }]]) {
      expect(renderToStaticMarkup(<PackageLabelPages packages={[p]} qrs={incomplete} width={100} height={75} />)).toBe("");
    }
  });
});

it("renders production output metadata and reprints the same QR without receipt-only identities", async () => {
 const output:PackageLabelMetadata={id,qr:`EWMS:PKG:1:${id}`,packageNo:1,kind:"KOLI",itemCode:"MM-000001",itemName:"Output",quantity:"50.000000",unitCode:"KG",stockStatus:"AVAILABLE",lotCode:"OUTPUT-1",producedOn:"2026-10-14",expiresOn:"2027-10-14"};
 const first=await generatePackageQrs([output]),second=await generatePackageQrs([output]);
 expect(second).toEqual(first);expect(first[0]?.id).toBe(id);
 const html=renderToStaticMarkup(<PackageLabelPages packages={[output]} qrs={first} width={100} height={50} />);
 expect(html).toContain("MM-000001");expect(html).toContain("Paket miktarı: 50.000000 KG");expect(html).toContain("OUTPUT-1");expect(html).toContain("2026-10-14");expect(html).toContain("AVAILABLE");
 expect(output).not.toHaveProperty("receiptLineId");expect(output).not.toHaveProperty("receivingLocationId");expect(output).not.toHaveProperty("warehouseId");
});
