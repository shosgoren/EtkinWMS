import { test,expect } from 'vitest';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legacyDemo } from './demo-bridge.mjs';
test('legacy normalization batches remain within the private route byte limit, including long Unicode emails',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'demo-legacy-'));
 try{
  const rows=Array.from({length:40},(_,i)=>({id:String(i),email:'界'.repeat(220)+i+'@example.test'}));
  const content=rows.map(row=>JSON.stringify(row)).join('\n');const file=join(dir,'legacy.jsonl');await writeFile(file,content);
  const sizes=[];
  const match=await legacyDemo(file,rows[39].email,async emails=>{sizes.push(Buffer.byteLength(JSON.stringify({operation:'normalize',emails})));return emails;});
  expect(match).toEqual(rows[39]);expect(sizes).toHaveLength(3);expect(Math.max(...sizes)).toBeLessThan(16384);
 }finally{await rm(dir,{recursive:true,force:true});}
});
