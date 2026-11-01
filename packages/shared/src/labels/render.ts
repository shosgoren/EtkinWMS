// One geometry/encoder for browser preview, browser print and print-to-PDF. No DOM, DB, fetch or identity generation.
// Existing GTIN only; POS EAN13 nominal/max module0.330/0.660mm (100–200%): https://www.gs1ie.org/standards/data-carriers/barcodes/ean-13/
// Quiet zones/nominal EAN13 geometry: https://ref.gs1.org/standards/genspecs/24.0.0/
import { create } from "qrcode";
import { AppError } from "../errors.ts";
import { CONTEXT_FIELDS, parseLabelDesign, type LabelDesign, type LabelElement, type LabelField } from "./model.ts";
import { encodeCode128 } from "./code128.ts";
export type LabelRenderValues=Readonly<Partial<Record<LabelField,string>>>;
export type LabelRenderReason="MISSING_VALUE"|"BAD_VALUE"|"NEEDS_SPACE"|"MISSING_LOGO"|"TEXT_OVERFLOW"|"CALIBRATION_OUTSIDE"|"TOO_COMPLEX";
export class LabelRenderError extends AppError {
 constructor(readonly reason:LabelRenderReason,readonly elementId?:string){super("VALIDATION_FAILED");}
}
export interface LabelRenderOptions {
 readonly dpi?:203|300|600;readonly offsetX?:number;readonly offsetY?:number;
 /** Editor only. Actual print callers must never take this flag from request input. */
 readonly preview?:boolean;
 /** Trusted canonical PNG data URIs loaded by the authorized server asset boundary. Never request-supplied URLs. */
 readonly assets?:Readonly<Record<string,string>>;
}
const bad=(reason:LabelRenderReason,id?:string):never=>{throw new LabelRenderError(reason,id);};
const xml=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"})[c]??"");
const n=(v:number)=>String(Number(v.toFixed(3)));
const L=["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
const PARITY=["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];
/** Encodes a supplied, checksum-valid 13 digit value; never allocates a GTIN. */
export function encodeLabelEan13(value:string):string {
 if(!/^\d{13}$/.test(value))return bad("BAD_VALUE");
 const digits=Array.from(value,Number),sum=digits.slice(0,12).reduce((a,d,i)=>a+d*(i%2===0?1:3),0);
 if((10-sum%10)%10!==digits[12])return bad("BAD_VALUE");
 const parity=PARITY[digits[0]??-1];if(!parity)return bad("BAD_VALUE");
 const right=(d:number)=>(L[d]??"").replace(/[01]/g,c=>c==="0"?"1":"0");
 let bits="101";
 for(let i=1;i<=6;i++){const d=digits[i]??-1;bits+=parity[i-1]==="L"?L[d]:right(d).split("").reverse().join("");}
 bits+="01010";for(let i=7;i<=12;i++)bits+=right(digits[i]??-1);return bits+"101";
}
function dataOf(design:LabelDesign,raw:LabelRenderValues):LabelRenderValues {
 if(raw===null||typeof raw!=="object"||Array.isArray(raw)||Object.keys(raw).some(k=>!(CONTEXT_FIELDS[design.context] as readonly string[]).includes(k)))return bad("BAD_VALUE");
 for(const value of Object.values(raw))if(typeof value!=="string"||value.length>512||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))return bad("BAD_VALUE");
 return raw;
}
function codeValue(e:LabelElement&{field:LabelField},data:LabelRenderValues):string {
 const value=data[e.field];if(!value)return bad("MISSING_VALUE",e.id);
 if(new TextEncoder().encode(value).length>256)return bad("BAD_VALUE",e.id);return value;
}
const graphemes=(value:string)=>typeof Intl.Segmenter==="function"?Array.from(new Intl.Segmenter(undefined,{granularity:"grapheme"}).segment(value),x=>x.segment):Array.from(value);
// Conservative advances prevent silent clipping, including wide/emoji/combining graphemes. Font shaping stays with the browser.
const advance=(g:string)=>/\p{Extended_Pictographic}/u.test(g)?2:/^[ilI.,'`!:;| ]$/.test(g)?.4:/^[MW@#%]$/.test(g)?1.05:/[^\u0000-\u024f]/.test(g)?1.1:.7;
function wrap(value:string,size:number,width:number):string[]{
 const lines:string[]=[];
 for(const paragraph of value.replace(/\r\n?/g,"\n").replace(/\t/g,"    ").split("\n")){
  let line="",used=0;
  for(const g of graphemes(paragraph)){const a=advance(g)*size;if(a>width)return[];if(used+a>width){lines.push(line);line="";used=0;}line+=g;used+=a;}
  lines.push(line);
 }
 return lines;
}
function textSvg(e:Extract<LabelElement,{kind:"text"}>,data:LabelRenderValues,w:number,h:number,preview:boolean):string {
 const value=e.field===null?(e.text??""):(data[e.field]??"");if(value==="")return"";
 let size=e.fontSize,lines=wrap(value,size,w);
 const minimum=Math.min(e.fontSize,2000);
 while((lines.length===0||lines.length*size*1.25>h)&&size>minimum){size=Math.max(minimum,Math.floor(size*.9));lines=wrap(value,size,w);}
 if(lines.length===0||lines.length*size*1.25>h){if(!preview)return bad("TEXT_OVERFLOW",e.id);size=Math.max(500,Math.floor(Math.min(w/(graphemes(value).length*1.1),h)));lines=[value.replace(/\s+/g," ")];}
 const x=e.align==="start"?0:e.align==="middle"?w/2:w;
 return `<text font-family="Arial, sans-serif" font-size="${size}" font-weight="${e.bold?700:400}" text-anchor="${e.align}" fill="#000">${lines.map((line,i)=>`<tspan x="${n(x)}" y="${n(size*(1+i*1.25))}">${xml(line)}</tspan>`).join("")}</text>`;
}
function qrSvg(e:Extract<LabelElement,{kind:"qr"}>,value:string,w:number,h:number,dot:number,preview:boolean):string {
 let qr;try{qr=create(value,{errorCorrectionLevel:"M"});}catch{return bad("BAD_VALUE",e.id);}
 const total=qr.modules.size+8,step=preview?Math.min(w,h)/total:Math.floor(Math.min(w,h)/(total*dot))*dot;
 if(step<=0||(!preview&&step<250))return bad("NEEDS_SPACE",e.id);
 const x=preview?(w-step*total)/2:Math.floor((w-step*total)/2/dot)*dot,y=preview?(h-step*total)/2:Math.floor((h-step*total)/2/dot)*dot;
 const paths:string[]=[];
 for(let r=0;r<qr.modules.size;r++)for(let c=0;c<qr.modules.size;c++)if(qr.modules.get(r,c))paths.push(`M${c+4} ${r+4}h1v1h-1z`);
 return `<rect width="${n(w)}" height="${n(h)}" fill="#fff"/><g transform="translate(${n(x)} ${n(y)}) scale(${n(step)})"><path fill="#000" shape-rendering="crispEdges" d="${paths.join("")}"/></g>`;
}
function barcodeSvg(e:Extract<LabelElement,{kind:"barcode"}>,value:string,w:number,h:number,dot:number,preview:boolean):string {
 const ean=e.format==="EAN13",quiet=ean?11:10;let bits:string;
 try{if(ean)bits=encodeLabelEan13(value);else{const encoded=encodeCode128(value);bits=encoded.widths.map((width,i)=>(i%2===0?"1":"0").repeat(width)).join("");}}catch{return bad("BAD_VALUE",e.id);}
 const cells=bits.length+quiet*2,reserve=preview&&h<5000?0:4000;
 const targetHeight=ean?(22850/330+5):0;
 let step=preview?w/cells:Math.min(Math.floor(w/cells/dot),ean?Math.min(Math.floor((h-reserve)/targetHeight/dot),Math.floor(660/dot)):Math.floor(1000/dot))*dot;
 if(preview&&ean)step=Math.min(step,660,Math.max(1,(h-reserve)/targetHeight));
 if(step<=0||(!preview&&(step<(ean?330:250)||(!ean&&h-reserve<8000))))return bad("NEEDS_SPACE",e.id);
 const bodyHeight=ean?Math.max(1,22850*step/330):h-reserve;
 if(!preview&&bodyHeight+(ean?5*step:0)+reserve>h+.001)return bad("NEEDS_SPACE",e.id);
 const x=(w-cells*step)/2,top=ean?Math.max(0,(h-bodyHeight-5*step-reserve)/2):0,rects:string[]=[];
 for(let i=0;i<bits.length;i++)if(bits[i]==="1"){const guard=ean&&(i<3||(i>=45&&i<50)||i>=92);rects.push(`<rect x="${n(x+(i+quiet)*step)}" y="${n(top)}" width="${n(step)}" height="${n(bodyHeight+(guard?5*step:0))}"/>`);}
 const caption=reserve===0?"":`<text x="${n(w/2)}" y="${n(ean?top+bodyHeight+5*step+reserve-500:h-500)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${Math.min(2800,w/(Math.max(1,value.length)*.7))}" fill="#000">${xml(value)}</text>`;
 return `<rect width="${n(w)}" height="${n(h)}" fill="#fff"/><g fill="#000" shape-rendering="crispEdges">${rects.join("")}</g>${caption}`;
}
function rotation(e:LabelElement):string {
 if(e.rotation===90)return`translate(${e.width} 0) rotate(90)`;
 if(e.rotation===180)return`translate(${e.width} ${e.height}) rotate(180)`;
 if(e.rotation===270)return`translate(0 ${e.height}) rotate(270)`;return"";
}
export function renderLabelSvg(raw:unknown,values:LabelRenderValues,options:LabelRenderOptions={}):string {
 const preview=options.preview===true,design=parseLabelDesign(raw,preview?"DRAFT":"PUBLISH"),data=dataOf(design,values);
 const dpi=options.dpi??203,x=options.offsetX??0,y=options.offsetY??0;
 if(![203,300,600].includes(dpi)||![x,y].every(v=>Number.isSafeInteger(v)&&Math.abs(v)<=10000))return bad("BAD_VALUE");
 const parts:string[]=[];
 for(const e of design.elements){
  if(e.x+x<0||e.y+y<0||e.x+x+e.width>design.width||e.y+y+e.height>design.height)return bad("CALIBRATION_OUTSIDE",e.id);
  const swap=e.rotation===90||e.rotation===270,w=swap?e.height:e.width,h=swap?e.width:e.height;let body="";
  if(e.kind==="text")body=textSvg(e,data,w,h,preview);
  else if(e.kind==="qr")body=qrSvg(e,codeValue(e,data),w,h,25400/dpi,preview);
  else if(e.kind==="barcode")body=barcodeSvg(e,codeValue(e,data),w,h,25400/dpi,preview);
  else if(e.kind==="logo"){
   const uri=options.assets?.[e.assetId];if(typeof uri!=="string"||uri.length>175000||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(uri))return bad("MISSING_LOGO",e.id);
   body=`<image width="${n(w)}" height="${n(h)}" preserveAspectRatio="xMidYMid meet" href="${xml(uri)}"/>`;
  }else{
   if(e.stroke>Math.min(w,h))return bad("NEEDS_SPACE",e.id);
   body=e.kind==="frame"?`<rect x="${n(e.stroke/2)}" y="${n(e.stroke/2)}" width="${n(w-e.stroke)}" height="${n(h-e.stroke)}" fill="none" stroke="#000" stroke-width="${e.stroke}"/>`:`<line x1="${n(e.stroke/2)}" y1="${n(h/2)}" x2="${n(w-e.stroke/2)}" y2="${n(h/2)}" stroke="#000" stroke-width="${e.stroke}"/>`;
  }
  parts.push(`<g data-element="${xml(e.id)}" transform="translate(${e.x+x} ${e.y+y}) ${rotation(e)}">${body}</g>`);
 }
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${design.width/1000}mm" height="${design.height/1000}mm" viewBox="0 0 ${design.width} ${design.height}" role="img"><title>Etkin WMS</title><rect width="100%" height="100%" fill="#fff"/>${parts.join("")}</svg>`;
 if(svg.length>2_000_000)return bad("TOO_COMPLEX");return svg;
}
