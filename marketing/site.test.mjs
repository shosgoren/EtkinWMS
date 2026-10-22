// T-941: yeni satış sitesi — yayımlanan dosyalar, eski sitenin kalıntısı ve dönüştürücü.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, test } from 'vitest';
import { server, publicFiles } from './server.mjs';
import { transformComponent } from './src/transform.mjs';

const here = dirname(fileURLToPath(import.meta.url));
let port = 0;

function get(path) {
  return new Promise((done, fail) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => done({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', fail);
    });
    req.setTimeout(2000, () => req.destroy(new Error('Request timed out')));
    req.on('error', fail);
    req.end();
  });
}

beforeAll(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  port = server.address().port;
});
afterAll(() => new Promise((done, fail) => {
  server.close((error) => error ? fail(error) : done());
  server.closeAllConnections();
}));

test('ana sayfa yeni siteyi ön-çizilmiş olarak sunar; eski site dosyaları yoktur', async () => {
  const home = await get('/');
  assert.equal(home.status, 200);
  assert.match(home.headers['content-type'], /^text\/html/);
  assert.equal(home.headers['cache-control'], 'no-cache');
  assert.match(home.body, /<div id="dc-root">\s*<div/);
  assert.match(home.body, /Girişten sevkiyata kesintisiz kontrolün/);
  assert.match(home.body, /<script src="\/site\.js" defer><\/script>/);
  assert.doesNotMatch(home.body, /Stok belli|İşler yolunda|\/app\.js|fonts\.googleapis|\/_blob\//);
  for (const old of ['/app.js']) assert.equal((await get(old)).status, 404, old);
});

test('sayfaların başvurduğu her yerel dosya doğru türle sunulur', async () => {
  const types = { css: /^text\/css/, js: /^text\/javascript/, webp: /^image\/webp$/, woff: /^font\/woff$/, svg: /^image\/svg\+xml$/, png: /^image\/png$/, jpg: /^image\/jpeg$/ };
  for (const pagePath of ['/', '/privacy']) {
    const page = await get(pagePath);
    assert.equal(page.status, 200, pagePath);
    const refs = new Set([...page.body.matchAll(/(?:src|href)="(\/[^"#?]*)"/g)].map((m) => m[1]).filter((u) => u !== '/' && u !== '/privacy'));
    const css = [...page.body.matchAll(/href="(\/[^"]+\.css)"/g)].map((m) => m[1]);
    for (const sheet of css) for (const m of (await get(sheet)).body.matchAll(/url\((\/[^)]+)\)/g)) refs.add(m[1]);
    assert.ok(refs.size > 3, pagePath);
    for (const ref of refs) {
      const res = await get(ref);
      assert.equal(res.status, 200, ref);
      const ext = ref.split('.').pop() || '';
      if (types[ext]) assert.match(res.headers['content-type'], types[ext], ref);
    }
  }
});

test('arama motoru etiketleri: kanonik adres, paylaşım görseli ve tek varlık tanımı', async () => {
  const home = (await get('/')).body;
  assert.match(home, /<link rel="canonical" href="https:\/\/etkinyazilim\.com\/">/);
  assert.match(home, /<meta property="og:image" content="https:\/\/etkinyazilim\.com\/img\/og-etkin-wms\.jpg">/);
  const ld = /<script type="application\/ld\+json">([^<]+)<\/script>/.exec(home);
  assert.ok(ld, 'JSON-LD yok');
  const graph = JSON.parse(ld[1])['@graph'];
  const types = graph.map((n) => n['@type']);
  assert.deepEqual(types, ['Organization', 'WebSite', 'SoftwareApplication']);
  assert.equal(graph[0].url, 'https://etkinyazilim.com/');
  for (const path of ['/img/og-etkin-wms.jpg', '/img/logo-512.png']) {
    const res = await get(path);
    assert.equal(res.status, 200, path);
  }
  assert.doesNotMatch(JSON.stringify(graph), /"(offers|price|aggregateRating|review)"/);
});

test('güvenlik başlıkları: betik yalnız self, dış kaynak yok', async () => {
  const csp = String((await get('/')).headers['content-security-policy']);
  assert.match(csp, /script-src 'self';/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe/);
  assert.match(csp, /font-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /https?:/);
});

test('yalnız yayımlanan dosyalar sunulur; kaynak, gizli ve üst dizin yolları 404', async () => {
  for (const path of ['/../server.mjs', '/%2e%2e/server.mjs', '/server.mjs', '/build.mjs', '/src/landing.dc.html', '/index.html', '/privacy.html', '/.env', '/img/', '/fonts']) {
    assert.equal((await get(path)).status, 404, path);
  }
  const files = publicFiles(resolve(here, 'public'));
  for (const [route, file] of Object.entries(files)) {
    assert.ok(!route.includes('..') && !file.startsWith('.') && !file.includes('/.'), route);
    if (route !== '/' && route !== '/privacy' && route !== '/demo-status') assert.ok(!file.endsWith('.html'), route);
  }
  assert.equal(files['/'], 'index.html');
  assert.equal(files['/site.js'], 'site.js');
});

test('üretilmiş site.js eval/new Function içermez ve kaynakla aynı dönüştürmeyi taşır', () => {
  const site = readFileSync(resolve(here, 'public/site.js'), 'utf8');
  assert.doesNotMatch(site, /\beval\(|new Function\(/);
  assert.doesNotMatch(site, /\bvar self = this\b/);
  assert.match(site, /window\.EtkinDCComponent = Component;/);
});

test('dönüştürücü anonim işlevleri ok işlevine çevirir ve self takma adını kaldırır', () => {
  const code = 'class C { m() { var self = this; setTimeout(function (a, b) { self.n(a, b); }, 1); return { go: function () { self.setState({ x: 1 }); } }; } }';
  const out = transformComponent(code);
  assert.equal(out, 'class C { m() {  setTimeout((a, b) => { this.n(a, b); }, 1); return { go: () => { this.setState({ x: 1 }); } }; } }');
  assert.throws(() => transformComponent('const f = function () { return this.x; };'), /this\/arguments/);
  assert.throws(() => transformComponent('const f = function () { return arguments.length; };'), /this\/arguments/);
});
