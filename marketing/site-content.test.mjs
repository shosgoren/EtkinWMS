// T-407: satış sitesi panelden yayınlanan içeriği iç uçtan okur, sıkı doğrular, kaçışlayarak yerleştirir; önizleme sırrı yalnız başlıkla
// iletilir ve önizleme yanıtı önbelleğe/arama motoruna/Referer'a kapalıdır. Uç yoksa sayfa tasarım metniyle sunulur.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, request } from 'node:http';
import { afterAll, beforeAll, test } from 'vitest';

let content = null;
let seenPreview = [];
let up = true;
const upstream = createServer((req, res) => {
  seenPreview.push(req.headers['x-site-preview'] ?? null);
  if (!up) { res.writeHead(503); res.end(); return; }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ site: content }));
});
let mod;
let port = 0;

const plan = (over = {}) => ({ name: 'Başlangıç', recommended: false, price: '1490', limits: { admins: 2, field: 0, warehouses: 1, items: 500 },
  features: { qr: true, ship: false, prod: false, api: false }, ...over });
const site = (over = {}) => ({ version: 1, preview: false, title1: 'Yeni başlık', title2: 'vurgu', subtitle: 'Alt metin', plans: [plan()], ...over });

function get(path) {
  return new Promise((done, fail) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => done({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', fail);
    });
    req.setTimeout(4000, () => req.destroy(new Error('Request timed out')));
    req.on('error', fail);
    req.end();
  });
}
const block = (html) => /<script type="application\/json" id="site-content">([^<]*)<\/script>/.exec(html)?.[1];

beforeAll(async () => {
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  process.env.SITE_CONTENT_URL = `http://127.0.0.1:${upstream.address().port}/api/public/site`;
  mod = await import('./server.mjs');
  mod.server.listen(0, '127.0.0.1');
  await once(mod.server, 'listening');
  port = mod.server.address().port;
});
afterAll(async () => {
  await new Promise((done) => { mod.server.close(() => done()); mod.server.closeAllConnections(); });
  await new Promise((done) => { upstream.close(() => done()); upstream.closeAllConnections(); });
});

test('doğrulama: köşeli ayraç, denetim karakteri, biçimsiz fiyat/sınır, 12+ paket reddedilir; geçerli içerik yalnız bilinen alanlarla döner', () => {
  assert.equal(mod.validSite(site({ title1: '<img src=x onerror=alert(1)>' })), null);
  assert.equal(mod.validSite(site({ subtitle: 'a\u0007b' })), null);
  assert.equal(mod.validSite(site({ title2: '' })), null);
  assert.equal(mod.validSite(site({ plans: [plan({ price: '1e9' })] })), null);
  assert.equal(mod.validSite(site({ plans: [plan({ name: '<b>x</b>' })] })), null);
  assert.equal(mod.validSite(site({ plans: [plan({ limits: { admins: -1, field: 0, warehouses: 1, items: 1 } })] })), null);
  assert.equal(mod.validSite(site({ plans: Array.from({ length: 13 }, () => plan()) })), null);
  const ok = mod.validSite({ ...site(), extra: 'x', plans: [{ ...plan(), extra: 'y' }] });
  assert.deepEqual(Object.keys(ok).sort(), ['plans', 'subtitle', 'title1', 'title2']);
  assert.deepEqual(Object.keys(ok.plans[0]).sort(), ['features', 'limits', 'name', 'price', 'recommended']);
});

test('yerleştirme: kahraman metni kaçışlı, veri bloğunda < > & kaçışlı (doğrulamayı geçse bile)', () => {
  const html = '<html><head></head><body><div id="dc-root"><h1 class="htitle" x="1">\n<span class="scanreveal" a><span>Eski</span></span>\n<span class="scanreveal" b><span>eski</span></span></h1><p class="cine-sub"><span>eski alt</span></p></div><template id="dc-tpl"><p class="cine-sub"><span>{{t.heroSub}}</span></p></template></body></html>';
  const out = mod.injectSite(html, { title1: 'A & "B"', title2: "C'", subtitle: 'x</script><b>', plans: [] });
  assert.match(out, /<span>A &amp; &quot;B&quot;<\/span>/);
  assert.match(out, /<span>C&#39;<\/span>/);
  assert.match(out, /<p class="cine-sub"><span>x&lt;\/script&gt;&lt;b&gt;<\/span><\/p>/);
  // Şablon (istemci çizimi) değişmez.
  assert.match(out, /<template id="dc-tpl"><p class="cine-sub"><span>\{\{t\.heroSub\}\}<\/span>/);
  const data = block(out);
  assert.ok(data !== undefined && !/[<>&]/.test(data));
  assert.equal(JSON.parse(data).subtitle, 'x</script><b>');
  assert.equal(mod.injectSite(html, null), html);
});

test("ana sayfa yayındaki içeriği sunar; önizleme sırrı yalnız başlıkla iletilir, önizleme yanıtı önbelleksiz/noindex/Referer'sız", async () => {
  content = site({ title1: 'Panelden gelen başlık' });
  seenPreview = [];
  const home = await get('/');
  assert.equal(home.status, 200);
  assert.match(home.body, /<span>Panelden gelen başlık<\/span>/);
  assert.equal(JSON.parse(block(home.body)).plans[0].price, '1490');
  assert.equal(home.headers['x-robots-tag'], undefined);

  const token = 'A'.repeat(43);
  content = site({ title1: 'Önizlenen taslak', preview: true });
  const pv = await get(`/?onizleme=${token}`);
  assert.match(pv.body, /<span>Önizlenen taslak<\/span>/);
  assert.equal(pv.headers['cache-control'], 'no-store');
  assert.equal(pv.headers['x-robots-tag'], 'noindex, nofollow');
  assert.equal(pv.headers['referrer-policy'], 'no-referrer');
  assert.ok(seenPreview.includes(token));

  // Biçimsiz sır iletilmez (yayındaki içerik, önbellekten).
  seenPreview = [];
  const bad = await get('/?onizleme=../../x');
  assert.equal(bad.status, 200);
  assert.ok(!seenPreview.some((v) => v !== null));
  assert.equal(bad.headers['cache-control'], 'no-store');
});

test('uç biçimsiz içerik dönerse ya da düşerse sayfa tasarım metniyle (ya da son iyi içerikle) sunulur', async () => {
  content = site({ title1: '<script>alert(1)</script>' });
  const r = await mod.siteContent('B'.repeat(43));
  assert.equal(r, null);
  up = false;
  const pv = await get(`/?onizleme=${'C'.repeat(43)}`);
  assert.equal(pv.status, 200);
  assert.equal(block(pv.body), undefined);
  assert.match(pv.body, /Girişten sevkiyata kesintisiz kontrolün/);
  up = true;
});
