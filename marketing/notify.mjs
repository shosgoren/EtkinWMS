// T-945: demo talebi e-posta bildirimi (Resend HTTP API; ek bağımlılık yok).
// Ayar sırası: ortam (RESEND_API_KEY, LEAD_NOTIFY_TO, LEAD_NOTIFY_FROM) → `${LEAD_DIR}/notify.json`
// ({"resendApiKey": "...", "to": "...", "from": "..."}; yalnız işletmecinin yazdığı, 0600 dosya).
// Anahtar yoksa bildirim kapalıdır; talep kaydı her durumda önce dosyaya yazılır, e-posta hatası kaydı bozmaz.
// Gizli değer loga, yanıta veya hata mesajına yazılmaz.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Etkin WMS <onboarding@resend.dev>';
const ADDRESS_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

/** Tüm IP'ler için saatlik e-posta üst sınırı (çok IP'li sele karşı; aşan talepler yine dosyaya kaydedilir). */
export const NOTIFY_HOURLY_CAP = 20;
const sent = [];
function takeGlobalSlot(now = Date.now()) {
  while (sent.length && now - sent[0] > 3600000) sent.shift();
  if (sent.length >= NOTIFY_HOURLY_CAP) return false;
  sent.push(now);
  return true;
}
export function resetNotifyCap() {
  sent.length = 0;
}

/** @param {Record<string, string | undefined>} env @param {string} leadDir */
export async function loadNotifyConfig(env, leadDir) {
  let file = {};
  try {
    const parsed = JSON.parse(await readFile(resolve(leadDir, 'notify.json'), 'utf8'));
    file = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    file = {};
  }
  const pick = (a, b) => (typeof a === 'string' && a.trim() ? a.trim() : typeof b === 'string' && b.trim() ? b.trim() : '');
  const apiKey = pick(env.RESEND_API_KEY, file.resendApiKey);
  const to = pick(env.LEAD_NOTIFY_TO, file.to);
  const from = pick(env.LEAD_NOTIFY_FROM, file.from) || DEFAULT_FROM;
  if (!apiKey || !ADDRESS_RE.test(to)) return null;
  return { apiKey, to, from };
}

/** @param {string} s */
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
/** @param {string} s */
const oneLine = (s) => s.replace(/[\r\n\t]+/g, ' ').trim();

/**
 * @param {{ id: string, createdAt: string, name: string, company: string, email: string, sector: string, message: string }} lead
 * @param {{ apiKey: string, to: string, from: string }} config
 */
export function buildLeadEmail(lead, config) {
  const rows = [
    ['Ad', oneLine(lead.name)],
    ['Firma', oneLine(lead.company)],
    ['E-posta', oneLine(lead.email)],
    ['Sektör', oneLine(lead.sector) || '—'],
    ['İhtiyaç', lead.message || '—'],
    ['Zaman', lead.createdAt],
    ['Kayıt no', lead.id],
  ];
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n') + '\n\nYanıtla dediğinizde e-posta doğrudan talep sahibine gider.';
  const html =
    '<div style="font-family:Arial,sans-serif;font-size:15px;color:#172E42">' +
    '<h2 style="margin:0 0 12px">Yeni demo talebi</h2><table cellpadding="6" style="border-collapse:collapse">' +
    rows.map(([k, v]) => `<tr><td style="color:#4C6275;vertical-align:top"><b>${esc(k)}</b></td><td style="white-space:pre-wrap">${esc(String(v))}</td></tr>`).join('') +
    '</table><p style="color:#4C6275;font-size:13px">Yanıtla dediğinizde e-posta doğrudan talep sahibine gider.</p></div>';
  const body = {
    from: config.from,
    to: [config.to],
    subject: oneLine(`Yeni demo talebi: ${lead.company} — ${lead.name}`).slice(0, 200),
    text,
    html,
  };
  if (ADDRESS_RE.test(lead.email)) body.reply_to = lead.email;
  return body;
}

/**
 * Bildirimi gönderir; hiçbir zaman fırlatmaz. Sonuç yalnız durum kodu taşır.
 * @param {{ id: string, createdAt: string, name: string, company: string, email: string, sector: string, message: string }} lead
 * @param {{ apiKey: string, to: string, from: string } | null} config
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ ok: boolean, status: number | null, capped?: boolean }>}
 */
export async function notifyLead(lead, config, fetchImpl = fetch) {
  if (!config) return { ok: false, status: null };
  if (!takeGlobalSlot()) return { ok: false, status: null, capped: true };
  try {
    const res = await fetchImpl(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `lead-${lead.id}` },
      body: JSON.stringify(buildLeadEmail(lead, config)),
      signal: AbortSignal.timeout(8000),
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: null };
  }
}
