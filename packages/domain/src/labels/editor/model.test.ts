import {describe,expect,it} from "vitest";
import {defaultLabelDesign,LABEL_CONTEXTS,LabelDesignError,millimetresToMicrometres,parseLabelDesign,prepareLabelForPrint} from "./model.ts";
const base=()=>JSON.parse(JSON.stringify(defaultLabelDesign("PRODUCT")));
describe("label design contract",()=>{
 it.each(LABEL_CONTEXTS)("builds a valid %s template without creating data identities",context=>{
  const d=defaultLabelDesign(context);expect(parseLabelDesign(d)).toEqual(d);expect(d.elements).toHaveLength(2);
  expect(d.elements[1]).toMatchObject({kind:"qr",locked:true});
 });
 it("returns a fresh whitelisted value independent from caller mutations",()=>{
  const raw=base(),parsed=parseLabelDesign(raw);raw.elements[0].x=90000;expect(parsed.elements[0]?.x).toBe(5000);
 });
 it.each([null,[],{},"html",{schema:2}])("rejects invalid/unsupported document %j",value=>expect(()=>parseLabelDesign(value)).toThrow(LabelDesignError));
 it.each([NaN,Infinity,-1,0,9999,500001,1.5])("rejects invalid width %s",width=>{const d=base();d.width=width;expect(()=>parseLabelDesign(d)).toThrow(LabelDesignError);});
 it("rejects unknown style/script/url fields rather than retaining executable metadata",()=>{
  for(const field of ["script","url","html","tenantId","printer"]){const d=base();d.elements[0][field]="https://invalid.example";expect(()=>parseLabelDesign(d)).toThrow(LabelDesignError);}
 });
 it("rejects duplicate element IDs",()=>{const d=base();d.elements[1].id=d.elements[0].id;expect(()=>parseLabelDesign(d)).toThrow(LabelDesignError);});
 it.each([1,45,360,-90])("rejects unsupported rotation %s",rotation=>{const d=base();d.elements[0].rotation=rotation;expect(()=>parseLabelDesign(d)).toThrow(LabelDesignError);});
 it.each([0,90,180,270])("preserves declared axis-aligned post-rotation bounds at %s",rotation=>{const d=base();d.elements[0].rotation=rotation;expect(parseLabelDesign(d).elements[0]?.rotation).toBe(rotation);});
 it("rejects elements outside the printable margin",()=>{const d=base();d.elements[0].x=99000;expect(()=>parseLabelDesign(d)).toThrowError(expect.objectContaining({reason:"OUTSIDE_LABEL"}));});
 it("requires one unambiguous text binding",()=>{for(const change of [{field:null,text:null},{field:"name",text:"Duplicate"}]){const d=base();Object.assign(d.elements[0],change);expect(()=>parseLabelDesign(d)).toThrow(LabelDesignError);}});
 it("supports static Unicode text without treating markup as executable code",()=>{const d=base();Object.assign(d.elements[0],{field:null,text:'İşlem <logo> & ölçü'});expect(parseLabelDesign(d).elements[0]).toMatchObject({text:'İşlem <logo> & ölçü'});});
 it("refuses cross-context private/customer fields on a product template",()=>{const d=base();d.elements[0].field="customerName";expect(()=>parseLabelDesign(d)).toThrowError(expect.objectContaining({reason:"UNSUPPORTED_FIELD"}));});
 it("prevents substituting a product code for a physical package identity",()=>{const d=JSON.parse(JSON.stringify(defaultLabelDesign("RECEIPT")));d.elements[1].field="barcode";expect(()=>parseLabelDesign(d)).toThrow(LabelDesignError);d.elements.pop();expect(()=>parseLabelDesign(d)).toThrow(LabelDesignError);});
 it("permits existing physical package identity as Code128 but not fabricated EAN13",()=>{const d=JSON.parse(JSON.stringify(defaultLabelDesign("RECEIPT")));Object.assign(d.elements[1],{kind:"barcode",format:"CODE128"});expect(parseLabelDesign(d).elements[1]).toMatchObject({kind:"barcode",field:"packageQr"});d.elements[1].format="EAN13";expect(()=>parseLabelDesign(d)).toThrow(LabelDesignError);});
 it("cannot replace the machine-readable field with arbitrary QR text or URL",()=>{const d=base();d.elements[1].text="new-package";expect(()=>parseLabelDesign(d)).toThrow(LabelDesignError);delete d.elements[1].text;d.elements[1].field="documentNo";expect(()=>parseLabelDesign(d)).toThrow(LabelDesignError);});
 it("rejects squashed or too small QR geometry",()=>{for(const dimensions of [{width:12000,height:10000},{width:9000,height:9000}]){const d=base();Object.assign(d.elements[1],dimensions);expect(()=>parseLabelDesign(d)).toThrowError(expect.objectContaining({reason:"CODE_GEOMETRY"}));}});
 it("rejects any object covering the code quiet-zone box",()=>{const d=base();d.elements[0].width=65000;expect(()=>parseLabelDesign(d)).toThrowError(expect.objectContaining({reason:"CODE_GEOMETRY"}));});
 it("allows a non-overlapping border around the label but not over the QR",()=>{
  const d=base();d.elements.push({id:"border",kind:"frame",x:2000,y:2000,width:96000,height:46000,rotation:0,locked:true,stroke:200});expect(parseLabelDesign(d).elements).toHaveLength(3);
  d.elements[2].x=69000;d.elements[2].y=11000;d.elements[2].width=20000;d.elements[2].height=20000;expect(()=>parseLabelDesign(d)).toThrowError(expect.objectContaining({reason:"CODE_GEOMETRY"}));
 });
 it("stores an asset reference, not a logo URL or arbitrary SVG",()=>{const d=base();d.elements[0]={id:"logo",kind:"logo",x:4000,y:4000,width:30000,height:10000,rotation:0,locked:false,assetId:"550e8400-e29b-41d4-a716-446655440000"};expect(parseLabelDesign(d).elements[0]).toMatchObject({kind:"logo"});d.elements[0].assetId="data:image/svg+xml,<svg/>";expect(()=>parseLabelDesign(d)).toThrow(LabelDesignError);});
 it("enforces bounded object and text counts",()=>{const d=base();d.elements=Array.from({length:61},(_,i)=>({...d.elements[0],id:'el-'+i}));expect(()=>parseLabelDesign(d)).toThrow(LabelDesignError);d.elements=[{...base().elements[0],text:'x'.repeat(1001),field:null}];expect(()=>parseLabelDesign(d)).toThrow(LabelDesignError);});
});
describe("physical millimetres",()=>{
 it.each([["60",60000],["40.25",40250],["1,005",1005],["0.125",125]])("parses %s without losing decimal precision",(input,output)=>expect(millimetresToMicrometres(String(input))).toBe(output));
 it.each(["1e3","-5","1.0001","NaN","Infinity","1 000","0","1001",""])("rejects invalid %s",input=>expect(()=>millimetresToMicrometres(input)).toThrow(LabelDesignError));
});


it("retains temporarily overlapping or empty drafts but never prints them",()=>{
 const overlap=base();overlap.elements[0].width=65000;expect(parseLabelDesign(overlap,"DRAFT").elements).toHaveLength(2);expect(()=>prepareLabelForPrint(overlap,[])).toThrow(LabelDesignError);
 const empty={...base(),elements:[]};expect(parseLabelDesign(empty,"DRAFT").elements).toHaveLength(0);expect(()=>parseLabelDesign(empty)).toThrow(LabelDesignError);
 const receipt=JSON.parse(JSON.stringify(defaultLabelDesign("RECEIPT")));receipt.elements.pop();expect(parseLabelDesign(receipt,"DRAFT").elements).toHaveLength(1);expect(()=>parseLabelDesign(receipt)).toThrow(LabelDesignError);
});
it("required tracking data cannot be replaced by a static label",()=>{
 const d=JSON.parse(JSON.stringify(defaultLabelDesign("RECEIPT")));d.elements[0].text="LOT-STATIC";d.elements[0].field=null;
 expect(()=>prepareLabelForPrint(d,["lot"])).toThrow(LabelDesignError);d.elements[0].text=null;d.elements[0].field="lot";
 expect(prepareLabelForPrint(d,["lot"]).context).toBe("RECEIPT");expect(()=>prepareLabelForPrint(d,["customerName"])).toThrow(LabelDesignError);
});
it("rejects prototype-like IDs and strokes extending beyond their box",()=>{
 for(const id of ["__proto__","constructor","prototype"]){const d=base();d.elements[0].id=id;expect(()=>parseLabelDesign(d)).toThrow(LabelDesignError);}
 const d=base();d.elements=[{id:"frame",kind:"frame",x:5000,y:5000,width:100,height:100,rotation:0,locked:false,stroke:2000}];expect(()=>parseLabelDesign(d)).toThrow(LabelDesignError);
});
