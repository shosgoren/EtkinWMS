import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
// Read the complete legacy spool without persisting another copy or exposing historical identifiers.
export async function legacyDemo(file,email,normalize){
 const stream=createReadStream(file,{encoding:'utf8'});
 const lines=createInterface({input:stream,crlfDelay:Infinity});
 let match=null,batch=[];
 const inspect=async()=>{
  const normalized=await normalize(batch.map(row=>row.email));
  batch.forEach((row,i)=>{if(normalized[i]===email)match??=row;});batch=[];
 };
 try {
  for await(const line of lines){
   if(!line.trim())continue;
   const row=JSON.parse(line);
   if(typeof row.email==='string'){batch.push(row);if(batch.length===16)await inspect();}
  }
  if(batch.length)await inspect();
 }catch(error){if(error.code!=='ENOENT')throw error;}
 finally{lines.close();stream.destroy();}
 return match;
}
export async function demoBridge(siteContentUrl,payload){
 if(!siteContentUrl)throw new Error('demo backend unavailable');
 const url=new URL('/api/public/demo',siteContentUrl);
 const response=await fetch(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error('demo backend unavailable');
 return response.json();
}
