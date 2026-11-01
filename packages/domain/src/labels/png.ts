// Bounded static RGB/RGBA PNG normalizer. PNG3: https://www.w3.org/TR/png-3/
// Browser normalizes JPEG/WebP to PNG before upload. Server independently validates every byte boundary,
// CRC, header, scanline and decompression bound, then rewrites IHDR/IDAT/IEND only (no metadata/SVG/URL).
import { createHash } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import { AppError } from "@wms/shared/errors";

export const LABEL_LOGO_MAX_BYTES = 131072;
export const LABEL_LOGO_MAX_PIXELS = 1024;
const SIGNATURE = Buffer.from([137,80,78,71,13,10,26,10]);
const CRC_TABLE = Uint32Array.from({length:256},(_,n)=>{
  let c=n;for(let k=0;k<8;k++)c=(c&1)!==0?0xedb88320^(c>>>1):c>>>1;return c>>>0;
});
function crc(bytes: Uint8Array): number {
  let n=0xffffffff;for(const b of bytes)n=(CRC_TABLE[(n^b)&255]??0)^(n>>>8);return(n^0xffffffff)>>>0;
}
function invalid(): never { throw new AppError("VALIDATION_FAILED"); }
function chunk(type:string,data:Buffer):Buffer {
  const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(type,4,4,"ascii");data.copy(out,8);out.writeUInt32BE(crc(out.subarray(4,out.length-4)),out.length-4);return out;
}
export interface CanonicalLabelLogo { readonly png:Buffer; readonly width:number; readonly height:number; readonly sha256:string }
export function normalizeLabelPng(input: unknown): CanonicalLabelLogo {
  if(!Buffer.isBuffer(input)||input.length<67||input.length>LABEL_LOGO_MAX_BYTES||!input.subarray(0,8).equals(SIGNATURE))return invalid();
  let pos=8, header:Buffer|undefined, width=0,height=0,channels=0,seenData=false,endedData=false,ended=false;
  const data:Buffer[]=[];
  while(pos<input.length){
    if(pos+12>input.length)return invalid();
    const length=input.readUInt32BE(pos);if(length>LABEL_LOGO_MAX_BYTES||pos+12+length>input.length)return invalid();
    if(!input.subarray(pos+4,pos+8).every(b=>(b>=65&&b<=90)||(b>=97&&b<=122)))return invalid();
    const type=input.toString("ascii",pos+4,pos+8),body=input.subarray(pos+8,pos+8+length);
    if(!/^[A-Za-z]{4}$/.test(type)||crc(input.subarray(pos+4,pos+8+length))!==input.readUInt32BE(pos+8+length))return invalid();
    if(header===undefined){
      if(type!=="IHDR"||length!==13)return invalid();
      width=body.readUInt32BE(0);height=body.readUInt32BE(4);channels=body[9]===6?4:body[9]===2?3:0;
      if(width<1||height<1||width>LABEL_LOGO_MAX_PIXELS||height>LABEL_LOGO_MAX_PIXELS||body[8]!==8||channels===0||body[10]!==0||body[11]!==0||body[12]!==0)return invalid();
      header=Buffer.from(body);
    }else if(type==="IDAT"){
      if(endedData)return invalid();seenData=true;data.push(body);
    }else if(type==="IEND"){
      if(!seenData||length!==0||pos+12!==input.length)return invalid();ended=true;
    }else{
      // Reject unknown critical chunks and animation. Strip all ancillary data, including EXIF/text/profiles.
      if(type==="IHDR"||type[0]===type[0]?.toUpperCase()||["acTL","fcTL","fdAT"].includes(type))return invalid();
      if(seenData)endedData=true;
    }
    pos+=length+12;
    if(ended)break;
  }
  if(!header||!ended||!seenData)return invalid();
  const stride=width*channels+1,expected=stride*height;
  let raw:Buffer;
  try{raw=inflateSync(Buffer.concat(data),{maxOutputLength:expected});}catch{return invalid();}
  if(raw.length!==expected)return invalid();
  for(let y=0;y<height;y++)if((raw[y*stride]??255)>4)return invalid();
  const png=Buffer.concat([SIGNATURE,chunk("IHDR",header),chunk("IDAT",deflateSync(raw,{level:9})),chunk("IEND",Buffer.alloc(0))]);
  if(png.length>LABEL_LOGO_MAX_BYTES)return invalid();
  return{png,width,height,sha256:createHash("sha256").update(png).digest("hex")};
}
