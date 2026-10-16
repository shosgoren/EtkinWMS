// İşlemsel e-posta şablonları (T-116): `invitation`, `password_reset`; TR varsayılan, EN. Düz metin + kurumsal HTML (T-412, `layout.ts`).
// Bağlantı dışında kişisel veri yok. Anahtar düzeni `apps/web/messages` ile aynı (`email.<şablon>.<alan>`), ama
// dosya worker'a aittir (tek kaynak ihlali, Faz 1'de kabul; apps/web/messages henüz yok).
import type { MailLocale, MailTemplate } from "@wms/shared/mailer";
import { httpLink, paragraph, renderLayout } from "./layout.js";

export const PRODUCT_NAME = "Etkin WMS";

interface TemplateMessages {
  readonly subject: string;
  readonly title: string;
  readonly intro: string;
  readonly button: string;
  readonly action: string;
  readonly expiry: string;
  readonly ignore: string;
}

export const MESSAGES: Record<MailLocale, { email: Record<MailTemplate, TemplateMessages> }> = {
  tr: {
    email: {
      invitation: {
        subject: `${PRODUCT_NAME} çalışma alanına davet edildiniz`,
        title: "Çalışma alanına davet edildiniz",
        intro: `${PRODUCT_NAME} üzerinde bir çalışma alanına davet edildiniz.`,
        button: "Daveti kabul et",
        action: "Daveti kabul etmek için bağlantıya gidin:",
        expiry: "Bağlantı 72 saat geçerlidir ve yalnızca bir kez kullanılabilir.",
        ignore: "Bu daveti beklemiyorsanız bu e-postayı yok sayabilirsiniz.",
      },
      password_reset: {
        subject: `${PRODUCT_NAME} parola sıfırlama`,
        title: "Parolanızı sıfırlayın",
        intro: `${PRODUCT_NAME} hesabınız için parola sıfırlama talebi alındı.`,
        button: "Yeni parola belirle",
        action: "Yeni parola belirlemek için bağlantıya gidin:",
        expiry: "Bağlantı 30 dakika geçerlidir ve yalnızca bir kez kullanılabilir.",
        ignore: "Bu talebi siz yapmadıysanız bu e-postayı yok sayabilirsiniz.",
      },
    },
  },
  en: {
    email: {
      invitation: {
        subject: `You have been invited to a ${PRODUCT_NAME} workspace`,
        title: "You're invited to a workspace",
        intro: `You have been invited to a workspace on ${PRODUCT_NAME}.`,
        button: "Accept invitation",
        action: "Open the link to accept the invitation:",
        expiry: "The link is valid for 72 hours and can be used once.",
        ignore: "If you were not expecting this invitation, you can ignore this email.",
      },
      password_reset: {
        subject: `${PRODUCT_NAME} password reset`,
        title: "Reset your password",
        intro: `A password reset was requested for your ${PRODUCT_NAME} account.`,
        button: "Choose a new password",
        action: "Open the link to choose a new password:",
        expiry: "The link is valid for 30 minutes and can be used once.",
        ignore: "If you did not request this, you can ignore this email.",
      },
    },
  },
};

export interface RenderedEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export function isMailTemplate(value: string): value is MailTemplate {
  return value === "invitation" || value === "password_reset";
}

export function renderTemplate(template: MailTemplate, locale: MailLocale, link: string): RenderedEmail {
  httpLink(link);
  const href = link;
  const m = MESSAGES[locale].email[template];
  const text = [m.intro, "", m.action, link, "", m.expiry, m.ignore, "", PRODUCT_NAME].join("\n");
  const html = renderLayout({
    locale,
    preheader: m.intro,
    appOrigin: href,
    title: m.title,
    body: paragraph(m.intro),
    button: { href, label: m.button },
    notes: [m.expiry, m.ignore],
  });
  return { subject: m.subject, text, html };
}
