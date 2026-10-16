// Deneme aktivasyonu e-postaları (T-995, ADR-026 §3.3–3.5). TR varsayılan, EN.
// - `activation`: onaylı demo talebine tek kullanımlık bağlantı (72 saat). Bağlantı dışında kişisel veri: yalnız firma adı (talepten).
// - `welcome`: çalışma alanı hazır; adres, giriş e-postası, saha girişi için alan adı, deneme bitişi. Görünüm Giris.dc.html `v.mail`
//   ile aynı düzen (marka satırı, başlık, bilgi kutusu, düğme). Parola, MFA anahtarı, yedek kod ya da bağlantı belirteci YAZILMAZ.
import type { MailLocale } from "@wms/shared/mailer";
import { PRODUCT_NAME, type RenderedEmail } from "./templates.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function httpsOrHttp(link: string): string {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new Error("email link is not a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("email link must be http(s)");
  return url.toString();
}

/** gg.aa.yyyy (İstanbul saati), tasarımdaki biçim. */
export function trialDate(d: Date): string {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("day")}.${get("month")}.${get("year")}`;
}

const ACT = {
  tr: {
    subject: `${PRODUCT_NAME} deneme alanınız onaylandı`,
    hello: (co: string) => `${co} için demo talebiniz onaylandı.`,
    body: "3 ay boyunca bütün özellikler açık. Çalışma alanınızı açmak için bağlantıya gidin; kurulum dört adım.",
    button: "ÇALIŞMA ALANINI KUR",
    expiry: "Bağlantı 72 saat geçerlidir ve yalnızca bir kez kullanılabilir.",
    ignore: "Bu talebi siz yapmadıysanız bu e-postayı yok sayabilirsiniz.",
  },
  en: {
    subject: `Your ${PRODUCT_NAME} trial is approved`,
    hello: (co: string) => `Your demo request for ${co} has been approved.`,
    body: "All features are available for 3 months. Open the link to set up your workspace; it takes four steps.",
    button: "START WORKSPACE SETUP",
    expiry: "The link is valid for 72 hours and can be used once.",
    ignore: "If you did not make this request, you can ignore this email.",
  },
} as const;

const BRAND_SVG_ALT = "ETKİN WMS";

function shell(locale: MailLocale, inner: string): string {
  return (
    `<!doctype html><html lang="${locale}"><body style="margin:0;padding:24px;background:#F3F1EA;font-family:'Instrument Sans',Arial,sans-serif;color:#172E42">` +
    `<div style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:22px;padding:28px">` +
    `<div style="font:800 15px/1 'Bricolage Grotesque',Arial,sans-serif;letter-spacing:.04em;margin-bottom:18px">${BRAND_SVG_ALT}</div>` +
    inner +
    `</div></body></html>`
  );
}

function button(href: string, label: string): string {
  return (
    `<p style="margin:22px 0 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:#172E42;color:#FFFFFF;` +
    `text-decoration:none;font:800 15px/1 'Bricolage Grotesque',Arial,sans-serif;letter-spacing:.03em;padding:18px 24px;border-radius:15px">` +
    `${escapeHtml(label)}</a></p>`
  );
}

export function renderActivationEmail(locale: MailLocale, link: string, company: string): RenderedEmail {
  const href = httpsOrHttp(link);
  const m = ACT[locale];
  const text = [m.hello(company), m.body, "", href, "", m.expiry, m.ignore, "", PRODUCT_NAME].join("\n");
  const html = shell(
    locale,
    `<p style="font:800 22px/1.2 'Bricolage Grotesque',Arial,sans-serif;margin:0 0 10px">${escapeHtml(m.hello(company))}</p>` +
      `<p style="margin:0">${escapeHtml(m.body)}</p>` +
      button(href, m.button) +
      `<p style="margin:18px 0 0;font-size:13px;word-break:break-all"><a href="${escapeHtml(href)}" style="color:#172E42">${escapeHtml(href)}</a></p>` +
      `<p style="margin:14px 0 0;font-size:13px;opacity:.75">${escapeHtml(m.expiry)}<br>${escapeHtml(m.ignore)}</p>`,
  );
  return { subject: m.subject, text, html };
}

const WEL = {
  tr: {
    subject: `${PRODUCT_NAME} çalışma alanınız hazır`,
    title: (co: string) => `Hoş geldiniz, ${co}`,
    intro: "Çalışma alanınız kuruldu. Bu bilgileri kolay bulmanız için saklayın.",
    address: "ADRES",
    login: "GİRİŞ E-POSTASI",
    field: "SAHA GİRİŞİ",
    fieldValue: (slug: string) => `Çalışma alanı: ${slug}`,
    trial: "DENEME",
    trialValue: (d: string) => `${d} tarihine kadar`,
    secrets: "Parolanız ve doğrulama kodlarınız bu e-postada yer almaz. Parolanızı unutursanız giriş ekranındaki \"Parolamı unuttum\" bağlantısını kullanın.",
    button: "ÇALIŞMA ALANINI AÇ",
  },
  en: {
    subject: `Your ${PRODUCT_NAME} workspace is ready`,
    title: (co: string) => `Welcome, ${co}`,
    intro: "Your workspace has been set up. Keep this information somewhere easy to find.",
    address: "ADDRESS",
    login: "SIGN-IN EMAIL",
    field: "FIELD SIGN-IN",
    fieldValue: (slug: string) => `Workspace: ${slug}`,
    trial: "TRIAL",
    trialValue: (d: string) => `until ${d}`,
    secrets: "Your password and verification codes are not included in this email. If you forget your password, use \"Forgot password\" on the sign-in screen.",
    button: "OPEN WORKSPACE",
  },
} as const;

export interface WelcomeEmailInput {
  readonly locale: MailLocale;
  /** Uygulama kökü, ör. https://wms.etkinyazilim.com */
  readonly appBaseUrl: string;
  readonly company: string;
  readonly slug: string;
  readonly email: string;
  readonly trialEndsAt: Date | null;
}

export function renderWelcomeEmail(input: WelcomeEmailInput): RenderedEmail {
  const m = WEL[input.locale];
  const base = httpsOrHttp(input.appBaseUrl).replace(/\/+$/, "");
  const href = `${base}/${encodeURIComponent(input.slug)}`;
  const host = new URL(base).host;
  const shown = `${host}/${input.slug}`;
  const rows: [string, string][] = [
    [m.address, shown],
    [m.login, input.email],
    [m.field, m.fieldValue(input.slug)],
  ];
  if (input.trialEndsAt !== null) rows.push([m.trial, m.trialValue(trialDate(input.trialEndsAt))]);
  const text = [
    m.title(input.company),
    m.intro,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    m.secrets,
    "",
    href,
    "",
    PRODUCT_NAME,
  ].join("\n");
  const kv =
    `<table role="presentation" style="width:100%;border-collapse:collapse;background:#F3F1EA;border-radius:16px;margin:16px 0 0">` +
    rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:10px 14px;font:600 11.5px/1.2 'IBM Plex Mono',monospace;letter-spacing:.04em;white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td>` +
          `<td style="padding:10px 14px;font:600 15px/1.3 'Instrument Sans',Arial,sans-serif;word-break:break-all">${escapeHtml(v)}</td></tr>`,
      )
      .join("") +
    `</table>`;
  const html = shell(
    input.locale,
    `<p style="font:800 24px/1.15 'Bricolage Grotesque',Arial,sans-serif;margin:0 0 10px">${escapeHtml(m.title(input.company))}</p>` +
      `<p style="margin:0">${escapeHtml(m.intro)}</p>` +
      kv +
      `<p style="margin:16px 0 0">${escapeHtml(m.secrets)}</p>` +
      button(href, m.button),
  );
  return { subject: m.subject, text, html };
}
