import { createServer } from 'node:http';
import { readFile, mkdir, appendFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), 'public');
const leadDir = process.env.LEAD_DIR || '/data';
const allowedOrigins = new Set(['https://etkinyazilim.com','https://www.etkinyazilim.com','http://localhost:3200']);
const limits = new Map();
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
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  const json = (status,data) => { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data)); };
  let path;
  try {
    path = new URL(req.url || '/', 'http://local').pathname;
  } catch {
    return json(400,{error:'Geçersiz istek adresi.'});
  }
  if (path === '/api/demo' && req.method === 'POST') {
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
      const lead = validateLead(JSON.parse(body));
      if (!lead) return json(400,{error:'Ad, firma, geçerli e-posta ve iletişim onayını kontrol edin.'});
      await mkdir(leadDir,{recursive:true,mode:0o700});
      await appendFile(resolve(leadDir,'demo-requests.jsonl'),JSON.stringify({id:randomUUID(),createdAt:new Date().toISOString(),...lead})+'\n',{mode:0o600});
      return json(201,{ok:true});
    } catch {return json(503,{error:'Talep kaydedilemedi. Lütfen tekrar deneyin.'});}
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(405,{error:'Yöntem desteklenmiyor.'});
  const files = {'/':'index.html','/styles.css':'styles.css','/app.js':'app.js','/privacy':'privacy.html','/robots.txt':'robots.txt','/sitemap.xml':'sitemap.xml'};
  const file = files[path];
  if (!file) return json(404,{error:'Sayfa bulunamadı.'});
  try {
    const content = await readFile(resolve(publicDir,file));
    const type=file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.txt')?'text/plain':file.endsWith('.xml')?'application/xml':'text/html';
    res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':file==='index.html'?'no-cache':'public, max-age=300'});
    res.end(req.method==='HEAD'?undefined:content);
  } catch {json(503,{error:'Sayfa geçici olarak yüklenemiyor.'});}
});
if (process.argv[1] === fileURLToPath(import.meta.url)) server.listen(Number(process.env.PORT || 3200),'0.0.0.0');
