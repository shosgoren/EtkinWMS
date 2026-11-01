// Isolated synthetic database for immutable label history; no shared schema rollback or cleanup bypass.
import { randomBytes, randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import pg from "pg";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { migrateUp } from "../../../packages/db/src/migrate.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";
export async function labelServiceWorld(){
 const env=readIntEnv(process.env),name=`wms_label_service_${randomBytes(6).toString("hex")}`,base=new pg.Client({connectionString:env.databaseUrlDirect});
 await base.connect();await base.query(`CREATE DATABASE ${name}`);
 const u=new URL(env.databaseUrlDirect);u.pathname=`/${name}`;await migrateUp({url:u.href});
 const adm=new pg.Client({connectionString:u.href});await adm.connect();
 const a=new URL(env.databaseUrl);a.pathname=u.pathname;a.hostname=u.hostname;a.port=u.port;
 const app=createDbClient({url:a.href,poolMax:4,prepare:false}),reg=newRegistry();
 const A=await seedWorld(adm,reg,"LSA"),B=await seedWorld(adm,reg,"LSB");
 const call=(world:TenantWorld=A,userId=world.ownerUserId,mfaVerified=true)=>({db:app,principal:{userId,mfaVerified},tenantSlug:world.slug,requestId:randomUUID()});
 const groups=new Map<string,string>();
 async function grant(world:TenantWorld,grants:readonly string[]){
  let id=groups.get(world.tenantId);
  if(!id){id=randomUUID();await adm.query("INSERT INTO public.permission_groups(tenant_id,id,name,grants,created_by) VALUES($1,$2,'Label test',$3,$4)",[world.tenantId,id,[...grants],world.ownerMembershipId]);await adm.query("INSERT INTO public.member_groups(tenant_id,membership_id,group_id,assigned_by) VALUES($1,$2,$3,$4)",[world.tenantId,world.memberMembershipId,id,world.ownerMembershipId]);groups.set(world.tenantId,id);}
  else await adm.query("UPDATE public.permission_groups SET grants=$1 WHERE tenant_id=$2 AND id=$3",[[...grants],world.tenantId,id]);
 }
 async function dispose(){await app.close();await adm.end();try{await base.query(`DROP DATABASE ${name} WITH (FORCE)`);}finally{await base.end();}}
 return{A,B,app,adm,call,grant,dispose};
}
export function tinyLabelPng(){
 const chunk=(type:string,data:Buffer)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);let crc=0xffffffff;for(const v of b.subarray(4,-4)){crc^=v;for(let k=0;k<8;k++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;}b.writeUInt32BE((crc^0xffffffff)>>>0,b.length-4);return b;};
 const h=Buffer.alloc(13);h.writeUInt32BE(1);h.writeUInt32BE(1,4);h[8]=8;h[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",h),chunk("IDAT",deflateSync(Buffer.from([0,12,34,56,255]))),chunk("IEND",Buffer.alloc(0))]);
}
