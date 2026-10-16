// Deneme aktivasyonu e-postaları (T-995, ADR-026 §3.3–3.5). TR varsayılan, EN.
// - `activation`: onaylı demo talebine tek kullanımlık bağlantı (72 saat). Bağlantı dışında kişisel veri: yalnız firma adı (talepten).
// - `welcome`: çalışma alanı hazır; adres, giriş e-postası, saha girişi için alan adı, deneme bitişi. Görünüm Giris.dc.html `v.mail`
//   ile aynı düzen (T-412 kurumsal kabuk: `layout.ts`). Parola, MFA anahtarı, yedek kod ya da bağlantı belirteci YAZILMAZ.
import type { MailLocale } from "@wms/shared/mailer";
import { PRODUCT_NAME, type RenderedEmail } from "./templates.js";
import { httpLink, infoTable, paragraph, renderLayout } from "./layout.js";

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
    button: "Çalışma alanını kur",
    expiry: "Bağlantı 72 saat geçerlidir ve yalnızca bir kez kullanılabilir.",
    ignore: "Bu talebi siz yapmadıysanız bu e-postayı yok sayabilirsiniz.",
  },
  en: {
    subject: `Your ${PRODUCT_NAME} trial is approved`,
    hello: (co: string) => `Your demo request for ${co} has been approved.`,
    body: "All features are available for 3 months. Open the link to set up your workspace; it takes four steps.",
    button: "Create your workspace",
    expiry: "The link is valid for 72 hours and can be used once.",
    ignore: "If you did not make this request, you can ignore this email.",
  },
} as const;

export function renderActivationEmail(locale: MailLocale, link: string, company: string): RenderedEmail {
  const href = httpLink(link);
  const m = ACT[locale];
  const text = [m.hello(company), m.body, "", href, "", m.expiry, m.ignore, "", PRODUCT_NAME].join("\n");
  const html = renderLayout({
    locale,
    preheader: m.body,
    appOrigin: href,
    title: m.hello(company),
    body: paragraph(m.body),
    button: { href, label: m.button },
    notes: [m.expiry, m.ignore],
  });
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
    button: "Çalışma alanını aç",
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
    button: "Open workspace",
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
  const base = httpLink(input.appBaseUrl).replace(/\/+$/, "");
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
  const html = renderLayout({
    locale: input.locale,
    preheader: m.intro,
    appOrigin: base,
    title: m.title(input.company),
    body: paragraph(m.intro),
    button: { href, label: m.button },
    after: infoTable(rows) + paragraph(m.secrets),
  });
  return { subject: m.subject, text, html };
}
