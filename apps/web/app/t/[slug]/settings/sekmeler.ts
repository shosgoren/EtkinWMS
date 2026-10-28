// T-1046 (STANDART §5 ayar kalıbı, tuval StandartAyarlar): Ayarlar sekmeleri tek yerde — Firma · Kullanıcılar ve yetki · Entegrasyonlar ·
// Görünüm. Ayarlar ve Bağlantılar (Entegrasyonlar) ekranı aynı şeridi çizer. Veri ayarı olmayan sekme (İş akışı, Etiket ve yazıcı) ayarı
// kodlanınca eklenir; boş sekme gösterilmez.
// T-1112 (tuval StandartAyarlarEntegrasyon): Entegrasyonlar sekmesi ERP ekranını (`/integrations`, alt bölümlü) açar; Excel aktarımı oradaki
// "Bağlantı ve veri kaynağı" bölümünden. ERP yetkisi (settings.manage) olmayan (yalnız Excel aktarım yetkili) kişide sekme Excel ekranına gider.
import { LICON } from "../../../design/kalip-icons.ts";
import type { KalipSekmeItem } from "../kalip/secim.tsx";

export type AyarSekmesi = "firma" | "kullanici" | "entegrasyon" | "gorunum";

export function ayarSekmesi(raw: string | null | undefined): Exclude<AyarSekmesi, "entegrasyon"> {
  return raw === "kullanici" || raw === "gorunum" ? raw : "firma";
}

export function ayarSekmeleri(base: string, t: (key: "tabFirma" | "tabUsers" | "tabInteg" | "tabLook") => string, erp = true): KalipSekmeItem[] {
  return [
    { id: "firma", label: t("tabFirma"), d: LICON.workspace, color: "0F6E8C", href: `${base}/settings`, taslak: true },
    { id: "kullanici", label: t("tabUsers"), d: LICON.people, color: "6C4BD8", href: `${base}/settings?sekme=kullanici`, taslak: true },
    { id: "entegrasyon", label: t("tabInteg"), d: LICON.transfer, color: "E56A00", href: erp ? `${base}/integrations` : `${base}/settings/baglantilar` },
    { id: "gorunum", label: t("tabLook"), d: LICON.sun, color: "B07D0B", href: `${base}/settings?sekme=gorunum`, taslak: true },
  ];
}

/** Aynı Ayarlar ekranının sekmesi mi (tek taslak, tek Kaydet)? Öyleyse sekme geçişi kaydedilmemiş işi sormaz ve silmez; taslak sekmeler
 *  arasında korunur. Entegrasyonlar ayrı ekrandır: oraya geçişte ortak çıkış koruması sorar. */
export function ayniTaslakSekmesi(href: string, base: string): boolean {
  return href === `${base}/settings` || href.startsWith(`${base}/settings?`);
}
