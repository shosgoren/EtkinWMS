import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { test } from 'vitest';
import { server } from './server.mjs';

function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
      res.on('error', reject);
    });
    req.setTimeout(2000, () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    req.end();
  });
}

test('malformed request targets return 400 and the same server continues serving', async (t) => {
  t.onTestFinished(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  for (const path of ['//[/', '//%']) {
    const malformed = await get(port, path);
    assert.equal(malformed.status, 400, path);
    assert.deepEqual(JSON.parse(malformed.body), { error: 'Geçersiz istek adresi.' });

    const normal = await get(port, '/');
    assert.equal(normal.status, 200);
    assert.match(normal.body, /<!doctype html>/i);
    assert.equal(server.listening, true);
  }
});
