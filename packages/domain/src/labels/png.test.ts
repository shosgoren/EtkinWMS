import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { normalizeLabelPng } from "./png.ts";
// Independent bit-by-bit CRC fixture encoder, not the production table implementation.
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
function chunk(type:string,body:Buffer){const out=Buffer.alloc(body.length+12);out.writeUInt32BE(body.length);out.write(type,4);body.copy(out,8);let c=0xffffffff;for(const v of out.subarray(4,-4)){c^=v;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;}out.writeUInt32BE((c^0xffffffff)>>>0,out.length-4);return out;}
function image({width=2,height=1,kind=6,depth=8,filter=0,interlace=0,body,extra=Buffer.alloc(0)}:{width?:number;height?:number;kind?:number;depth?:number;filter?:number;interlace?:number;body?:Buffer;extra?:Buffer}={}){
 const h=Buffer.alloc(13);h.writeUInt32BE(width);h.writeUInt32BE(height,4);h[8]=depth;h[9]=kind;h[12]=interlace;
 const raw=body??Buffer.alloc((width*(kind===2?3:4)+1)*height);raw[0]=filter;
 return Buffer.concat([signature,chunk("IHDR",h),extra,chunk("IDAT",deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]);
}
describe("label PNG normalization",()=>{
 it.each([2,6])("accepts static 8bit RGB/RGBA type%i with stable hash and independent bytes",kind=>{
  const original=image({kind}),v=normalizeLabelPng(original);expect(v.width).toBe(2);expect(v.height).toBe(1);expect(v.sha256).toMatch(/^[a-f0-9]{64}$/);expect(normalizeLabelPng(v.png)).toEqual(v);original.fill(0);expect(v.png.subarray(0,8)).toEqual(signature);
 });
 it("removes textual/EXIF metadata and never retains a script/URL",()=>{
  const clean=normalizeLabelPng(image()),dirty=normalizeLabelPng(image({extra:chunk("tEXt",Buffer.from("comment\0<script>https://example.test/secret</script>"))}));
  expect(dirty).toEqual(clean);expect(dirty.png.includes(Buffer.from("secret"))).toBe(false);
 });
 it.each([Buffer.from("<svg><script/></svg>"),Buffer.alloc(131073),"https://example.test/logo.png",null])("rejects wrong input/size/type",v=>expect(()=>normalizeLabelPng(v)).toThrow());
 it("rejects corrupted/truncated/trailing and duplicate-critical data",()=>{
  const v=image(),bad=Buffer.from(v);bad[45]=(bad[45]??0)^1;
  for(const b of [bad,v.subarray(0,-1),Buffer.concat([v,Buffer.from("HTML")]),image({extra:chunk("IHDR",Buffer.alloc(13))}),image({extra:chunk("ABCD",Buffer.alloc(0))})])expect(()=>normalizeLabelPng(b)).toThrow();
 });
 it.each([{width:0},{width:1025},{height:1025},{depth:16},{kind:3},{interlace:1},{filter:5}])("rejects unsupported header/filter %j",opts=>expect(()=>normalizeLabelPng(image(opts))).toThrow());
 it("rejects short/oversized inflated stream, decompression bombs and animations",()=>{
  expect(()=>normalizeLabelPng(image({body:Buffer.alloc(2)}))).toThrow();
  expect(()=>normalizeLabelPng(image({body:Buffer.alloc(5_000_000)}))).toThrow();
  expect(()=>normalizeLabelPng(image({extra:chunk("acTL",Buffer.alloc(8))}))).toThrow();
 });
 it("accepts 1024x1024 bound with bounded output and per-row filter validation",()=>{
  const v=normalizeLabelPng(image({width:1024,height:1024}));expect(v.width*v.height).toBe(1048576);expect(v.png.length).toBeLessThan(131072);
  const raw=Buffer.alloc((1024*4+1)*1024);raw[1024*4+1]=5;expect(()=>normalizeLabelPng(image({width:1024,height:1024,body:raw}))).toThrow();
 });
});
