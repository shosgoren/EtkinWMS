// T-945: demo talebi e-posta bildirimi.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { NOTIFY_HOURLY_CAP, RESEND_URL, buildLeadEmail, loadNotifyConfig, notifyLead, resetNotifyCap } from './notify.mjs';

const lead = { id: '11111111-2222-3333-4444-555555555555', createdAt: '2026-10-14T15:00:00.000Z', name: 'Ayşe <b>Kaya</b>', company: 'Deneme\r\nBcc: x@y.z AŞ', email: 'ayse@example.com', sector: 'Üretim', message: 'Çok depo & QR' };

test('ayar yoksa veya alıcı geçersizse bildirim kapalıdır', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notify-'));
  try {
    assert.equal(await loadNotifyConfig({}, dir), null);
    assert.equal(await loadNotifyConfig({ RESEND_API_KEY: 'k', LEAD_NOTIFY_TO: 'geçersiz' }, dir), null);
    await writeFile(join(dir, 'notify.json'), '{bozuk');
    assert.equal(await loadNotifyConfig({}, dir), null);
    await writeFile(join(dir, 'notify.json'), 'null');
    assert.equal(await loadNotifyConfig({}, dir), null);
    const r = await notifyLead(lead, null, () => { throw new Error('çağrılmamalı'); });
    assert.deepEqual(r, { ok: false, status: null });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('ayar dosyadan okunur; ortam değişkeni önceliklidir; varsayılan gönderen kullanılır', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notify-'));
  try {
    await writeFile(join(dir, 'notify.json'), JSON.stringify({ resendApiKey: 'dosya-anahtar', to: 'sahip@example.com' }));
    const fromFile = await loadNotifyConfig({}, dir);
    assert.deepEqual(fromFile, { apiKey: 'dosya-anahtar', to: 'sahip@example.com', from: 'Etkin WMS <onboarding@resend.dev>' });
    const fromEnv = await loadNotifyConfig({ RESEND_API_KEY: 'ortam-anahtar', LEAD_NOTIFY_FROM: 'Satış <satis@etkinyazilim.com>' }, dir);
    assert.equal(fromEnv?.apiKey, 'ortam-anahtar');
    assert.equal(fromEnv?.from, 'Satış <satis@etkinyazilim.com>');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('e-posta içeriği kaçışlıdır, konu tek satırdır, yanıt adresi talep sahibidir', () => {
  const body = buildLeadEmail(lead, { apiKey: 'k', to: 'sahip@example.com', from: 'Etkin WMS <onboarding@resend.dev>' });
  assert.deepEqual(body.to, ['sahip@example.com']);
  assert.doesNotMatch(body.subject, /[\r\n]/);
  assert.match(body.subject, /^Yeni demo talebi: Deneme Bcc: x@y\.z AŞ — Ayşe/);
  assert.equal(body.reply_to, 'ayse@example.com');
  assert.match(body.html, /Ayşe &lt;b&gt;Kaya&lt;\/b&gt;/);
  assert.match(body.html, /Çok depo &amp; QR/);
  assert.doesNotMatch(body.html, /<b>Kaya<\/b>/);
  assert.match(body.text, /Kayıt no: 11111111-2222-3333-4444-555555555555/);
  const spoof = buildLeadEmail({ ...lead, name: 'X\nE-posta: sahte@x.y' }, { apiKey: 'k', to: 'sahip@example.com', from: 'f' });
  assert.equal(spoof.text.split('\n').filter((l) => l.startsWith('E-posta:')).length, 1);
});

test('saatlik üst sınır aşılınca e-posta gönderilmez', async () => {
  resetNotifyCap();
  let n = 0;
  const f = async () => { n++; return { ok: true, status: 200 }; };
  const cfg = { apiKey: 'k', to: 'sahip@example.com', from: 'f' };
  for (let i = 0; i < NOTIFY_HOURLY_CAP + 3; i++) await notifyLead({ ...lead, id: String(i) }, cfg, f);
  assert.equal(n, NOTIFY_HOURLY_CAP);
  resetNotifyCap();
});

test('Resend isteği doğru adrese, anahtarla ve tekrar korumasıyla gider; hata fırlatmaz', async () => {
  resetNotifyCap();
  const calls = [];
  const okFetch = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 }; };
  const cfg = { apiKey: 'gizli', to: 'sahip@example.com', from: 'Etkin WMS <onboarding@resend.dev>' };
  assert.deepEqual(await notifyLead(lead, cfg, okFetch), { ok: true, status: 200 });
  assert.equal(calls[0].url, RESEND_URL);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer gizli');
  assert.equal(calls[0].init.headers['Idempotency-Key'], `lead-${lead.id}`);
  assert.equal(JSON.parse(calls[0].init.body).to[0], 'sahip@example.com');
  assert.deepEqual(await notifyLead(lead, cfg, async () => ({ ok: false, status: 403 })), { ok: false, status: 403 });
  assert.deepEqual(await notifyLead(lead, cfg, async () => { throw new Error('ağ'); }), { ok: false, status: null });
});
