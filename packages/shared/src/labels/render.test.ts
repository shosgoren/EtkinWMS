import { describe,expect,it } from "vitest";
import { defaultLabelDesign,type LabelDesign,type LabelElement,LabelDesignError } from "./model.ts";
import { encodeLabelEan13,renderLabelSvg,LabelRenderError,type LabelRenderValues } from "./render.ts";
const values:Record<LabelDesign["context"],LabelRenderValues>={
 PRODUCT:{name:"Kauçuk & <ürün>",code:"SBR",unit:"KG",barcode:"ETK-001"},
 RECEIPT:{name:"Granül",packageQr:"EWMS:PKG:1:11111111-1111-4111-8111-111111111111",quantity:"200",unit:"KG",lot:"LOT-1"},
 LOCATION:{locationCode:"A-01",locationName:"Raf",warehouseName:"Merkez"},
 SHIPMENT:{name:"Granül",packageQr:"EWMS:PKG:1:22222222-2222-4222-8222-222222222222",documentNo:"SVK-001"},
};
const one=(e:LabelElement):LabelDesign=>({schema:1,context:"PRODUCT",width:100000,height:50000,margin:2000,elements:[e]});
const barcode:Extract<LabelElement,{kind:"barcode"}>={id:"bar",kind:"barcode",field:"barcode",format:"CODE128",x:5000,y:5000,width:80000,height:35000,rotation:0,locked:false};
const text:Extract<LabelElement,{kind:"text"}>={id:"txt",kind:"text",field:null,text:"Etkin",fontSize:4000,bold:false,align:"start",x:5000,y:5000,width:70000,height:12000,rotation:0,locked:false};
function issue(run:()=>unknown,reason:string,id?:string){try{run();throw new Error("Expected render rejection");}catch(e){expect(e).toBeInstanceOf(LabelRenderError);expect(e).toMatchObject({reason,...(id===undefined?{}:{elementId:id})});}}
describe("same-model physical label renderer",()=>{
 it.each(["PRODUCT","RECEIPT","LOCATION","SHIPMENT"] as const)("renders %s at exact dimensions with real QR quiet zone and deterministic content",context=>{
  const d=defaultLabelDesign(context),svg=renderLabelSvg(d,values[context]);expect(svg).toContain('width="100mm" height="50mm"');expect(svg).toContain('viewBox="0 0 100000 50000"');expect(svg).toContain('M4 4h1v1h-1z');expect(svg).toBe(renderLabelSvg(d,values[context]));expect(svg).not.toContain("<script");
 });
 it("different existing package identities produce different codes; reprint preserves the same matrix",()=>{
  const d=defaultLabelDesign("RECEIPT"),first=renderLabelSvg(d,values.RECEIPT),second=renderLabelSvg(d,{...values.RECEIPT,packageQr:"EWMS:PKG:1:33333333-3333-4333-8333-333333333333"});
  expect(first).not.toBe(second);expect(first).toBe(renderLabelSvg(d,values.RECEIPT));
 });
 it("escapes all dynamic/static text and never emits arbitrary HTML/SVG",()=>{
  const svg=renderLabelSvg(one({...text,text:'<script id="x">alert(1)</script> & "'}),{});
  expect(svg).toContain("&lt;script");expect(svg).not.toContain('<script id=');expect(svg).toContain("&amp;");
  expect(renderLabelSvg(defaultLabelDesign("PRODUCT"),values.PRODUCT)).toContain("&amp;");
 });
 it("missing or foreign-context values do not create a fake code or print a partial label",()=>{
  issue(()=>renderLabelSvg(defaultLabelDesign("RECEIPT"),{name:"No package"}),"MISSING_VALUE","code");
  issue(()=>renderLabelSvg(defaultLabelDesign("PRODUCT"),{...values.PRODUCT,price:"5"} as LabelRenderValues),"BAD_VALUE");
  issue(()=>renderLabelSvg(defaultLabelDesign("PRODUCT"),{...values.PRODUCT,barcode:"x".repeat(257)}),"BAD_VALUE","code");
 });
 it.each([203,300,600] as const)("validates physical code size and calibration at %i DPI",dpi=>{
  const d=defaultLabelDesign("PRODUCT");expect(renderLabelSvg(d,values.PRODUCT,{dpi})).toContain("shape-rendering");
  issue(()=>renderLabelSvg(d,values.PRODUCT,{dpi,offsetX:10000}),"CALIBRATION_OUTSIDE","code");
 });
 it("small QR can be inspected in the editor but is rejected at print geometry",()=>{
  const d=defaultLabelDesign("RECEIPT"),small={...d,elements:d.elements.filter(e=>e.kind==="qr").map(e=>({...e,width:10000,height:10000}))};
  const dense={...values.RECEIPT,packageQr:"EWMS:PKG:1:"+"a".repeat(200)};
  expect(renderLabelSvg(small,dense,{preview:true})).toContain("<path");issue(()=>renderLabelSvg(small,dense),"NEEDS_SPACE","code");
 });
 it("genuine EAN13 checksum and exact 95-module structure; no GTIN generation",()=>{
  const bits=encodeLabelEan13("4006381333931");expect(bits).toHaveLength(95);expect(bits.slice(0,3)).toBe("101");expect(bits.slice(45,50)).toBe("01010");expect(bits.slice(-3)).toBe("101");
  expect(encodeLabelEan13("0000000000000")).toBe("101"+"0001101".repeat(6)+"01010"+"1110010".repeat(6)+"101");
  for(const bad of ["4006381333930","400638133393","40063813339311","ETK-001","٤٠٠٦٣٨١٣٣٣٩٣١"])issue(()=>encodeLabelEan13(bad),"BAD_VALUE");
 });
 it("EAN13 keeps supplied digits, guard extension and human interpretation; rejects tiny output",()=>{
  const d=one({...barcode,format:"EAN13"});expect(renderLabelSvg(d,{barcode:"4006381333931"})).toContain("4006381333931");
  issue(()=>renderLabelSvg(one({...barcode,format:"EAN13",height:8000}),{barcode:"4006381333931"}),"NEEDS_SPACE","bar");
  issue(()=>renderLabelSvg(one({...barcode,format:"EAN13",width:10000}),{barcode:"4006381333931"}),"NEEDS_SPACE","bar");
 });
 it("Code128 and QR preserve values rather than truncating or replacing unsupported characters",()=>{
  expect(renderLabelSvg(one(barcode),{barcode:"AB12345"})).toContain("AB12345");
  issue(()=>renderLabelSvg(one(barcode),{barcode:"ÜRÜN"}),"BAD_VALUE","bar");
  expect(renderLabelSvg(defaultLabelDesign("PRODUCT"),{...values.PRODUCT,barcode:"ÜRÜN"})).toContain("<path");
  issue(()=>renderLabelSvg(one({...barcode,height:5000}),{barcode:"AB12345"}),"NEEDS_SPACE","bar");
 });
 it("text wraps or fits completely; content is never silently cut",()=>{
  const long="Uzun ürün adı ".repeat(10),svg=renderLabelSvg(one({...text,text:long,width:70000,height:30000}),{});expect(svg).toContain("ürün");expect(svg).not.toContain("…");
  issue(()=>renderLabelSvg(one({...text,text:"WWWWWWWW",width:2000,height:1000}),{}),"TEXT_OVERFLOW","txt");
 });
 it.each([0,90,180,270] as const)("rotation%i preserves the validated bounding box",rotation=>{
  const d=one({...text,rotation,width:rotation===90||rotation===270?12000:70000,height:rotation===90||rotation===270?30000:12000});const svg=renderLabelSvg(d,{});expect(svg).toContain('translate(5000 5000)');if(rotation!==0)expect(svg).toContain(`rotate(${rotation})`);
 });
 it("logo references cannot become remote URLs, SVG or script payloads",()=>{
  const id="11111111-1111-4111-8111-111111111111",logo:LabelElement={id:"logo",kind:"logo",assetId:id,x:5000,y:5000,width:20000,height:10000,rotation:0,locked:false};
  for(const uri of [undefined,"https://example.test/logo.png","data:image/svg+xml,<svg/>",'data:image/png;base64,abc" onload="x'])issue(()=>renderLabelSvg(one(logo),{},{assets:uri===undefined?{}:{[id]:uri}}),"MISSING_LOGO","logo");
  // Image bytes are separately canonicalized at the server upload boundary; here only the whitelisted URI can render.
  const uri="data:image/png;base64,iVBORw0KGgo=";expect(renderLabelSvg(one(logo),{},{assets:{[id]:uri}})).toContain('preserveAspectRatio="xMidYMid meet"');
 });
 it("frame strokes stay inside their box; lines cannot spill outside an unmodelled boundary",()=>{
  expect(renderLabelSvg(one({id:"frame",kind:"frame",x:5000,y:5000,width:40000,height:20000,stroke:1000,rotation:0,locked:false}),{})).toContain('x="500" y="500" width="39000" height="19000"');
  expect(()=>renderLabelSvg(one({id:"line",kind:"line",x:5000,y:5000,width:40000,height:1000,stroke:2000,rotation:0,locked:false}),{})).toThrow(LabelDesignError);
  expect(renderLabelSvg(one({id:"line",kind:"line",x:5000,y:5000,width:40000,height:1000,stroke:1000,rotation:0,locked:false}),{})).toContain('x1="500" y1="500" x2="39500" y2="500"');
 });
});
