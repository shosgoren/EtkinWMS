// T-431: demo talebi ucu kaydın kimliğini döner (site "Talep no" olarak kısa halini gösterir); başka alan dönmez.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, test } from 'vitest';

const dir = mkdtempSync(join(tmpdir(), 'etkin-demo-'));
process.env.LEAD_DIR = dir;
process.env.DEMO_LEADS_DIR = dir;
delete process.env.RESEND_API_KEY;
const recorded = new Map();
const ids = new Set();
const internal = createServer(async (req,res) => {
 let body='';for await(const chunk of req)body+=chunk;
 const data=JSON.parse(body);
 if(data.operation==='normalize'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({emails:data.emails.map(email=>email.trim().toLowerCase())}));return;}
 if(data.legacy)recorded.set(data.legacy.email.trim().toLowerCase(),data.legacy);
 const inserted=!recorded.has(data.email)&&!ids.has(data.requestId);
 ids.add(data.requestId);if(inserted)recorded.set(data.email,data);
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,inserted}));
});
internal.listen(0,'127.0.0.1');await once(internal,'listening');
process.env.SITE_CONTENT_URL=`http://127.0.0.1:${internal.address().port}/api/public/site`;
const { server } = await import('./server.mjs');
let port = 0;

function post(body, origin = 'http://localhost:3200') {
  return new Promise((done, fail) => {
    const req = request({ hostname: '127.0.0.1', port, path: '/api/demo', method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'X-Forwarded-For': '203.0.113.9' } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => done({ status: res.statusCode, body: JSON.parse(text || '{}') }));
      res.on('error', fail);
    });
    req.setTimeout(2000, () => req.destroy(new Error('Request timed out')));
    req.on('error', fail);
    req.end(JSON.stringify(body));
  });
}

beforeAll(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  port = server.address().port;
});
afterAll(() => new Promise((done, fail) => {
  server.close((error) => { rmSync(dir, { recursive: true, force: true }); return error ? fail(error) : done(); });
  server.closeAllConnections();
  internal.close();internal.closeAllConnections();
}));

test('first, normalized duplicate, retry and historical JSONL have indistinguishable responses', async () => {
 const payload={requestId:'11111111-1111-4111-8111-111111111111',name:'Synthetic',company:'Synthetic',email:'person@example.test',sector:'',message:'',website:'',consent:true};
 const first=await post(payload);
 assert.deepEqual(first,{status:202,body:{ok:true}});
 assert.deepEqual(await post(payload),first);
 assert.deepEqual(await post({...payload,requestId:'22222222-2222-4222-8222-222222222222',email:' PERSON@EXAMPLE.TEST '}),first);
 assert.equal(recorded.size,1);
 const legacy={id:'33333333-3333-4333-8333-333333333333',createdAt:new Date().toISOString(),name:'Legacy',company:'Legacy',email:'old@example.test',sector:'',message:''};
 const file=join(dir,'demo-requests.jsonl');const content=JSON.stringify(legacy)+'\n';writeFileSync(file,content);
 assert.deepEqual(await post({...payload,requestId:'44444444-4444-4444-8444-444444444444',email:' OLD@EXAMPLE.TEST '}),first);
 assert.equal(recorded.get('old@example.test').id,legacy.id);
 assert.equal(readFileSync(file,'utf8'),content);
 const bad=await post({...payload,email:'bad'});assert.equal(bad.status,400);
 const foreign=await post(payload,'https://evil.example');assert.equal(foreign.status,403);
});
