// Internal-only bridge: /api/public/* is blocked at the public reverse proxy.
import { getAppDb } from '@wms/db';
import { normalizeDemoEmails, parseDemoSubmission, submitDemo, consumeDemoStatus } from '@wms/domain/platform/demo-requests';
import { createSealer } from '@wms/shared/seal';
export const dynamic = 'force-dynamic';
const headers = { 'cache-control':'no-store', 'referrer-policy':'no-referrer', 'x-robots-tag':'noindex' };
export async function POST(request: Request): Promise<Response> {
 try {
  // Bound streaming input before parsing, including when Content-Length is absent.
  const reader=request.body?.getReader();
  if (!reader) return Response.json({error:'invalid'}, {status:400,headers});
  const chunks: Uint8Array[]=[];let size=0;
  for (;;) {const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>16384){await reader.cancel();return Response.json({error:'invalid'},{status:413,headers});}chunks.push(r.value);}
  const raw=JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string,unknown>;
  if(raw.operation==='normalize') return Response.json({emails:await normalizeDemoEmails(getAppDb(),raw.emails)},{headers});
  if(raw.operation==='consume') return Response.json(await consumeDemoStatus(getAppDb(),raw.token),{headers});
  const input=parseDemoSubmission(raw);
  if(!input)return Response.json({error:'invalid'},{status:400,headers});
  const inserted=await submitDemo(getAppDb(),input,createSealer(process.env.QUEUE_SEAL_KEY));
  return Response.json({ok:true,inserted},{headers});
 } catch {return Response.json({error:'unavailable'},{status:503,headers});}
}
