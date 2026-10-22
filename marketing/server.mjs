import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { resolve, dirname, extname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { legacyDemo, demoBridge } from './demo-bridge.mjs';
import { loadNotifyConfig, notifyLead } from './notify.mjs';

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), 'public');
const leadDir = process.env.LEAD_DIR || '/data';
// T-994: talep kaydı ayrı dizinde (worker yalnız bunu salt okunur bağlar); bildirim ayarı (notify.json) LEAD_DIR'de kalır.
const demoLeadsDir = process.env.DEMO_LEADS_DIR || leadDir;
const allowedOrigins = new Set(['https://etkinyazilim.com','https://www.etkinyazilim.com','http://localhost:3200']);
const limits = new Map();
// T-941: yayımlanan dosyalar açılışta public/ altından bir kez listelenir; yalnız bu harita sunulur.
// Nokta ile başlayan adlar ve bilinmeyen uzantılar sunulmaz; istek yolu dosya sistemine hiç ulaşmaz.
const TYPES = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.txt':'text/plain; charset=utf-8','.xml':'application/xml; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff':'font/woff'};
export function publicFiles(dir = publicDir) {
  const files = {'/':'index.html','/privacy':'privacy.html','/demo-status':'demo-status.html'};
  const walk = (d) => {
    for (const entry of readdirSync(d,{withFileTypes:true})) {
      if (entry.name.startsWith('.')) continue;
      const full = resolve(d,entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && TYPES[extname(entry.name)] && !entry.name.endsWith('.html')) files['/'+relative(dir,full).split(sep).join('/')] = relative(dir,full);
    }
  };
  walk(dir);
  return files;
}
const files = publicFiles();

// T-407 (ADR-027 §6): panelden yayınlanan satış sayfası içeriği (ana başlık, vurgulu satır, alt metin, fiyat bölümü paketleri).
// Web uygulamasının iç ucundan (`SITE_CONTENT_URL`, ör. http://web:3000/api/public/site) okunur; ayar yoksa ya da uç yanıt vermezse
// sayfa tasarımdaki metinle sunulur (fiyat bölümü görünmez). Yanıt sıkı biçimde doğrulanır; metin HTML'e kaçışlanarak, istemciye
// çalıştırılmayan JSON veri bloğu olarak (`<` `>` `&` kaçışlı) girer. Önizleme sırrı (`?onizleme=`) yalnız başlıkla iletilir, önbelleğe
// alınmaz; önizleme yanıtı arama motorlarına kapalı ve Referer'sızdır.
const siteContentUrl = (process.env.SITE_CONTENT_URL || '').trim();
const SITE_TTL_MS = 30000;
const PREVIEW_TOKEN = /^[A-Za-z0-9_-]{43}$/;
let siteCache = { at: 0, site: null };
const str = (v, min, max) => typeof v === 'string' && v.length >= min && v.length <= max && !/[\u0000-\u001f\u007f<>]/.test(v);
const int = (v) => Number.isSafeInteger(v) && v >= 0 && v <= 10000000;
/** Uçtan gelen içeriği doğrular; biçim dışıysa `null` (sayfa tasarım metniyle sunulur). */
export function validSite(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!str(raw.title1, 1, 80) || !str(raw.title2, 1, 60) || !str(raw.subtitle, 1, 400) || !Array.isArray(raw.plans) || raw.plans.length > 12) return null;
  const plans = [];
  for (const p of raw.plans) {
    if (!p || typeof p !== 'object' || !str(p.name, 1, 60) || typeof p.price !== 'string' || !/^\d{1,7}(?:\.\d{1,2})?$/.test(p.price)) return null;
    const l = p.limits || {}, f = p.features || {};
    if (![l.admins, l.field, l.warehouses, l.items].every(int) || ![f.qr, f.ship, f.prod, f.api].every((b) => typeof b === 'boolean')) return null;
    plans.push({ name: p.name, recommended: p.recommended === true, price: p.price,
      limits: { admins: l.admins, field: l.field, warehouses: l.warehouses, items: l.items }, features: { qr: f.qr, ship: f.ship, prod: f.prod, api: f.api } });
  }
  return { title1: raw.title1, title2: raw.title2, subtitle: raw.subtitle, plans };
}
async function fetchSite(preview) {
  if (!siteContentUrl) return { ok: true, site: null };
  try {
    const res = await fetch(siteContentUrl, { headers: preview ? { 'x-site-preview': preview } : {}, signal: AbortSignal.timeout(1500), redirect: 'error' });
    if (!res.ok) return { ok: false, site: null };
    const body = await res.json();
    return { ok: true, site: validSite(body && body.site) };
  } catch {
    return { ok: false, site: null };
  }
}
/** Yayındaki içerik (30 sn önbellek; uç hata verirse son iyi değer). Önizleme sırrı varsa önbelleksiz. */
export async function siteContent(preview) {
  if (preview) return (await fetchSite(preview)).site;
  const now = Date.now();
  if (now - siteCache.at < SITE_TTL_MS) return siteCache.site;
  const r = await fetchSite(null);
  siteCache = { at: now, site: r.ok ? r.site : siteCache.site };
  return siteCache.site;
}
// İnceleme m1/n1: önizleme (önbelleksiz) istekleri süreç genelinde 10 dakikada en çok 60 (sabit bellek; IP başına tablo yok, IP değiştirerek
// büyütülemez). Aşımda yayındaki içerik sunulur. Önizleme yalnız operatör içindir; veritabanı yükü web tarafında ayrıca sınırlıdır.
let previewWindow = { at: 0, n: 0 };
function previewAllowed() {
  const now = Date.now();
  if (now - previewWindow.at >= 600000) previewWindow = { at: now, n: 0 };
  previewWindow.n++;
  return previewWindow.n <= 60;
}
const escapeHtml = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const jsonBlock = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
/** Ön-çizilmiş sayfaya içeriği yerleştirir: kahraman metni (JS'siz ziyaretçi ve titremesiz açılış) + istemci için veri bloğu. */
export function injectSite(html, site) {
  if (!site) return html;
  const cut = html.indexOf('<template id="dc-tpl">');
  if (cut < 0) return html;
  let root = html.slice(0, cut);
  root = root.replace(/(<h1 class="htitle"[^>]*>\s*<span class="scanreveal"[^>]*><span>)[^<]*(<\/span><\/span>\s*<span class="scanreveal"[^>]*><span>)[^<]*(<\/span>)/,
    (_m, a, b, c) => a + escapeHtml(site.title1) + b + escapeHtml(site.title2) + c);
  root = root.replace(/(<p class="cine-sub"><span>)[^<]*(<\/span>)/, (_m, a, b) => a + escapeHtml(site.subtitle) + b);
  root = root.replace('</head>', `<script type="application/json" id="site-content">${jsonBlock(site)}</script>\n</head>`);
  return root + html.slice(cut);
}
export function validateLead(data) {
  if (!data || typeof data !== 'object') return null;
  const clean = (key, max) => typeof data[key] === 'string' ? data[key].trim().slice(0,max) : '';
  const lead = { name:clean('name',100), company:clean('company',150), email:clean('email',254), sector:clean('sector',100), message:clean('message',2000) };
  if (!lead.name || !lead.company || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email) || data.consent !== true || clean('website',200)) return null;
  return lead;
}
export const server = createServer(async (req,res) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  // style-src 'unsafe-inline': yeni sayfa tasarım şablonunda satır içi style öznitelikleri kullanır (T-941). Betik yine yalnız 'self'.
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
  const json = (status,data) => { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data)); };
  let path;
  try {
    path = new URL(req.url || '/', 'http://local').pathname;
  } catch {
    return json(400,{error:'Geçersiz istek adresi.'});
  }
  if ((path === '/api/demo' || path === '/api/demo-status') && req.method === 'POST') {
    if (!allowedOrigins.has(req.headers.origin || '')) return json(403,{error:'İstek doğrulanamadı.'});
    const ip = req.headers['x-forwarded-for']?.toString().split(',').at(-1)?.trim() || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    for (const [key,value] of limits) if (now-value.at > 3600000) limits.delete(key);
    const count = limits.get(ip) || {at:now,n:0};
    if (count.n >= 5) return json(429,{error:'Lütfen daha sonra tekrar deneyin.'});
    count.n++;limits.set(ip,count);
    try {
      let size=0,body='';
      for await (const chunk of req) {size+=chunk.length;if(size>8192)return json(413,{error:'Mesaj çok uzun.'});body+=chunk.toString();}
      const input = JSON.parse(body);
      if(path === '/api/demo-status') {
        const result=await demoBridge(siteContentUrl,{operation:'consume',token:input.token});
        const status=['pending','setup','ready','in_progress'].includes(result.status)?result.status:'invalid';
        const href=status==='setup' && /^[A-Za-z0-9_-]{43}$/.test(result.activationToken||'') ? `https://wms.etkinyazilim.com/activate/${result.activationToken}` : status==='ready'?'https://wms.etkinyazilim.com/login':null;
        return json(200,{status,href});
      }
      const lead = validateLead(input);
      if (!lead) return json(400,{error:'Ad, firma, geçerli e-posta ve iletişim onayını kontrol edin.'});
      const requestId=typeof input.requestId==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId)?input.requestId:randomUUID();
      const normalize=async(emails)=>(await demoBridge(siteContentUrl,{operation:'normalize',emails})).emails;
      [lead.email]=await normalize([lead.email]);
      const legacy=await legacyDemo(resolve(demoLeadsDir,'demo-requests.jsonl'),lead.email,normalize);
      const result=await demoBridge(siteContentUrl,{...lead,requestId,locale:input.locale==='en'?'en':'tr',legacy});
      if(result.ok!==true)throw new Error('demo backend unavailable');
      const record={id:requestId,createdAt:new Date().toISOString(),...lead};
      // T-945: kayıt yazıldıktan sonra e-posta bildirimi; sonucu yanıtı bekletmez ve kaydı etkilemez.
      if(result.inserted===true) loadNotifyConfig(process.env, leadDir).then((config) => notifyLead(record, config)).then((r) => {
        if (r.status !== null && !r.ok) console.error(`lead-notify failed status=${r.status}`);
        if (r.capped) console.error('lead-notify skipped hourly-cap');
      }).catch(() => console.error('lead-notify failed'));
      // Identical response for first submission, duplicate email and retry; no historical ID or status.
      return json(202,{ok:true});
    } catch {return json(503,{error:'İşlem sonucu doğrulanamadı. Lütfen tekrar deneyin.'});}
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(405,{error:'Yöntem desteklenmiyor.'});
  const file = Object.hasOwn(files,path) ? files[path] : undefined;
  if (!file) return json(404,{error:'Sayfa bulunamadı.'});
  try {
    let content = await readFile(resolve(publicDir,file));
    if(file==='demo-status.html'){res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Robots-Tag','noindex');}
    const type = TYPES[extname(file)] || 'application/octet-stream';
    let cache = file.endsWith('.html') ? 'no-cache' : /^(img|fonts)\//.test(file) ? 'public, max-age=86400' : 'public, max-age=300';
    if (file === 'index.html') {
      const raw = new URL(req.url || '/', 'http://local').searchParams.get('onizleme');
      const preview = raw !== null && PREVIEW_TOKEN.test(raw) && previewAllowed() ? raw : null;
      content = Buffer.from(injectSite(content.toString('utf8'), await siteContent(preview)), 'utf8');
      if (raw !== null) {
        cache = 'no-store';
        res.setHeader('X-Robots-Tag','noindex, nofollow');
        res.setHeader('Referrer-Policy','no-referrer');
      }
    }
    res.writeHead(200,{'Content-Type':type,'Cache-Control':file==='demo-status.html'?'no-store':cache});
    res.end(req.method==='HEAD'?undefined:content);
  } catch {json(503,{error:'Sayfa geçici olarak yüklenemiyor.'});}
});
if (process.argv[1] === fileURLToPath(import.meta.url)) server.listen(Number(process.env.PORT || 3200),'0.0.0.0');
