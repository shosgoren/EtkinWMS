// Kurumsal e-posta düzeni (T-412): bütün işlemsel e-postalar aynı kabuğu kullanır. Görünüm Giris.dc.html `v.mail` ile aynı:
// lacivert marka bandı (logo + "Etkin WMS" + site adresi), sarı vurgu çizgisi, gövde, tek düğme, bilgi kutusu, şirket alt bilgisi.
// E-posta istemcileri için: tablo düzeni, satır içi stil, web yazı tipi yok (Arial yedek). Logo, uygulamanın herkese açık
// `/apple-icon` PNG'si (SVG Gmail'de görünmez). Ham bağlantı HTML'de düğmenin altına YAZILMAZ; yalnız düz metin sürümünde bulunur.
import type { MailLocale } from "@wms/shared/mailer";

export const MAIL_COLORS = {
  navy: "#172E42",
  yellow: "#F4C542",
  page: "#F3F1EA",
  card: "#FFFFFF",
  box: "#F3F1EA",
  muted: "#5B6E7F",
  line: "#E4DFD3",
} as const;

const FONT = "'Helvetica Neue',Helvetica,Arial,sans-serif";
const SITE = "https://etkinyazilim.com";
const SITE_LABEL = "etkinyazilim.com";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Yalnız http(s) kabul edilir (javascript: vb. reddedilir); normalleştirilmiş adres döner. */
export function httpLink(link: string): string {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new Error("email link is not a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("email link must be http(s)");
  return url.toString();
}

const FOOT = {
  tr: {
    tagline: "Depo ve stok yönetimi",
    auto: "Bu e-posta otomatik olarak gönderilmiştir.",
  },
  en: {
    tagline: "Warehouse and stock management",
    auto: "This email was sent automatically.",
  },
} as const;

export interface MailLayoutInput {
  readonly locale: MailLocale;
  /** Gelen kutusu önizleme satırı (görünmez). */
  readonly preheader: string;
  /** Uygulama kökü; logo bu kökten yüklenir. */
  readonly appOrigin: string;
  readonly title: string;
  /** Hazır (kaçışlı) HTML paragraflar/bloklar. */
  readonly body: string;
  readonly button?: { readonly href: string; readonly label: string };
  /** Düğmeden sonra gelen hazır (kaçışlı) HTML (ör. bilgi kutusu). */
  readonly after?: string;
  /** Düğmenin altındaki bilgi kutusu satırları (düz metin). */
  readonly notes?: readonly string[];
}

export function paragraph(text: string): string {
  return `<p style="margin:0 0 14px;font:400 16px/1.6 ${FONT};color:${MAIL_COLORS.navy}">${escapeHtml(text)}</p>`;
}

export function infoTable(rows: readonly (readonly [string, string])[]): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:${MAIL_COLORS.box};border-radius:12px;margin:4px 0 18px">` +
    rows
      .map(
        ([k, v], i) =>
          `<tr><td style="padding:12px 16px;${i > 0 ? `border-top:1px solid ${MAIL_COLORS.line};` : ""}">` +
          `<div style="font:700 11px/1.3 ${FONT};letter-spacing:.08em;color:${MAIL_COLORS.muted}">${escapeHtml(k)}</div>` +
          `<div style="margin-top:4px;font:600 16px/1.4 ${FONT};color:${MAIL_COLORS.navy};overflow-wrap:anywhere">${escapeHtml(v)}</div></td></tr>`,
      )
      .join("") +
    `</table>`
  );
}

export function renderLayout(input: MailLayoutInput): string {
  const c = MAIL_COLORS;
  const origin = new URL(httpLink(input.appOrigin)).origin;
  const logo = `${origin}/apple-icon`;
  const f = FOOT[input.locale];
  if (input.button !== undefined) httpLink(input.button.href);
  const button =
    input.button === undefined
      ? ""
      : `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:10px 0 24px"><tr><td style="background:${c.navy};border-radius:10px">` +
        `<a href="${escapeHtml(input.button.href)}" style="display:inline-block;padding:16px 30px;font:700 15px/1 ${FONT};letter-spacing:.02em;color:#FFFFFF;text-decoration:none;border-radius:10px">` +
        `${escapeHtml(input.button.label)}</a></td></tr></table>`;
  const notes =
    input.notes === undefined || input.notes.length === 0
      ? ""
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${c.line}"><tr><td style="padding:18px 0 0;font:400 13px/1.6 ${FONT};color:${c.muted}">` +
        input.notes.map(escapeHtml).join("<br>") +
        `</td></tr></table>`;
  return (
    `<!doctype html><html lang="${input.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light"><title>${escapeHtml(input.title)}</title></head>` +
    `<body style="margin:0;padding:0;background:${c.page}">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(input.preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.page}"><tr><td align="center" style="padding:28px 12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${c.card};border-radius:16px;overflow:hidden">` +
    // Marka bandı
    `<tr><td style="background:${c.navy};padding:20px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>` +
    `<td style="vertical-align:middle"><img src="${escapeHtml(logo)}" width="40" height="40" alt="Etkin WMS" style="display:inline-block;vertical-align:middle;border:0;border-radius:9px">` +
    `<span style="display:inline-block;vertical-align:middle;margin-left:12px;font:800 20px/1 ${FONT};color:#FFFFFF;letter-spacing:.01em">Etkin WMS</span></td>` +
    `<td align="right" style="vertical-align:middle;font:600 12px/1 ${FONT};color:#C9D3DC;letter-spacing:.04em">${SITE_LABEL}</td>` +
    `</tr></table></td></tr>` +
    `<tr><td style="background:${c.yellow};height:4px;line-height:4px;font-size:0">&nbsp;</td></tr>` +
    // Gövde
    `<tr><td style="padding:34px 28px 30px">` +
    `<h1 style="margin:0 0 16px;font:800 24px/1.25 ${FONT};color:${c.navy}">${escapeHtml(input.title)}</h1>` +
    input.body +
    button +
    (input.after ?? "") +
    notes +
    `</td></tr>` +
    // Alt bilgi
    `<tr><td style="background:${c.box};padding:20px 28px;border-top:1px solid ${c.line}">` +
    `<p style="margin:0 0 4px;font:700 13px/1.5 ${FONT};color:${c.navy}">Etkin Yazılım · <span style="font-weight:400">${escapeHtml(f.tagline)}</span></p>` +
    `<p style="margin:0;font:400 12px/1.6 ${FONT};color:${c.muted}"><a href="${SITE}" style="color:${c.navy};text-decoration:underline">${SITE_LABEL}</a> · ${escapeHtml(f.auto)}</p>` +
    `</td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}
