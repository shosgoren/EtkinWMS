// T-431: demo talebi ucu kaydın kimliğini döner (site "Talep no" olarak kısa halini gösterir); başka alan dönmez.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, test } from 'vitest';

const dir = mkdtempSync(join(tmpdir(), 'etkin-demo-'));
process.env.LEAD_DIR = dir;
process.env.DEMO_LEADS_DIR = dir;
delete process.env.RESEND_API_KEY;
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
}));

test('başarılı talep 201 ve kaydın kimliğini döner; eksik bilgi 400, yabancı köken 403', async () => {
  const ok = await post({ name: 'Ayşe', company: 'Örnek', email: 'ayse@ornek.com', sector: 'Diğer', message: '', website: '', consent: true });
  assert.equal(ok.status, 201);
  assert.deepEqual(Object.keys(ok.body).sort(), ['id', 'ok']);
  assert.equal(ok.body.ok, true);
  assert.match(ok.body.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  const lines = readFileSync(join(dir, 'demo-requests.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].id, ok.body.id);

  const bad = await post({ name: 'Ayşe', company: '', email: 'x', consent: true });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.id, undefined);
  const foreign = await post({ name: 'Ayşe', company: 'Örnek', email: 'ayse@ornek.com', consent: true }, 'https://evil.example');
  assert.equal(foreign.status, 403);
});
