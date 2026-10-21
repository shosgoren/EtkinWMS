// T-967 (B-84): panel Destek satır/zaman/cihaz biçimi (sayfa ve müşteri sekmesi ortak). Saf yardımcı + ileti kataloğu okuma.
import { getMessages } from "next-intl/server";
import type { SupportInboxRow } from "@wms/domain/platform/support";
import { buyukHarf } from "@wms/ui";
import { ticketNo, whenOf } from "../../support-format.ts";
import type { NotifyLabels, SupportDetailLabels, SupportLabels, SupportRowItem } from "./view.tsx";

const TZ = "Europe/Istanbul";

export interface DestekMsgs extends SupportLabels, SupportDetailLabels {
  readonly title: string;
  readonly sub: string;
  readonly detailSub: string;
  readonly now: string;
  readonly today: string;
  readonly yesterday: string;
  readonly msgs: string;
  readonly noName: string;
  readonly kRoute: string;
  readonly kVersion: string;
  readonly kCode: string;
  readonly kDevice: string;
  readonly kWorkspace: string;
  readonly hOpened: string;
  readonly hOperator: string;
  readonly hCustomer: string;
  readonly host: string;
  readonly notify: NotifyLabels;
  readonly devices: Readonly<Record<"android" | "iphone" | "ipad" | "windows" | "mac" | "linux" | "other", string>>;
  readonly tabs: { readonly aria: string; readonly genel: string; readonly destek: string; readonly gecmis: string };
  readonly custBanH: string;
  readonly custBanT: string;
}

/** Kaynak: "BUGÜN 10:42", "DÜN 17:20", "18.10 11:30" (İstanbul saati). */
export function panelWhen(at: Date, now: Date, m: Pick<DestekMsgs, "now" | "today" | "yesterday">): string {
  const w = whenOf(at, now, TZ);
  if (w.kind === "now") return m.now;
  if (w.kind === "today") return m.today.replace("{time}", w.time);
  if (w.kind === "yesterday") return m.yesterday.replace("{time}", w.time);
  return `${w.date} ${w.time}`;
}

/** Kaynak CİHAZ satırı ("Android telefon · Chrome"): tarayıcı kimliğinden kaba sınıf; bilinmeyen parça yazılmaz. */
export function deviceOf(ua: string | null, m: Pick<DestekMsgs, "devices">): string {
  if (ua === null || ua.trim() === "") return "—";
  const os = /iPad/.test(ua) ? m.devices.ipad : /iPhone/.test(ua) ? m.devices.iphone : /Android/.test(ua) ? m.devices.android : /Windows/.test(ua) ? m.devices.windows : /Mac OS X|Macintosh/.test(ua) ? m.devices.mac : /Linux/.test(ua) ? m.devices.linux : m.devices.other;
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) || /CriOS\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : null;
  return br === null ? os : `${os} · ${br}`;
}

export function initials(name: string, locale: string): string {
  const words = name.trim().split(/\s+/).filter((w) => w !== "");
  const s = words.length >= 2 ? `${words[0]?.charAt(0) ?? ""}${words[1]?.charAt(0) ?? ""}` : name.trim().slice(0, 2);
  return buyukHarf(s, locale) || "?";
}

/** Gelen kutusu ve müşteri sekmesi satırı. Okunmamış: kapalı olmayan ve son yazan müşteri (operatör yanıtı bekliyor). */
export function rowItem(r: SupportInboxRow, now: Date, m: DestekMsgs): SupportRowItem {
  return {
    id: r.id,
    no: ticketNo(r.number),
    cust: r.tenantName,
    user: r.authorName ?? m.noName,
    sub: m.msgs.replace("{n}", String(r.messageCount)),
    topic: r.subjectKind,
    msg: r.preview,
    when: panelWhen(r.createdAt, now, m),
    status: r.status,
    unread: r.status !== "CLOSED" && r.lastAuthor === "CUSTOMER",
  };
}

export async function destekMsgs(): Promise<DestekMsgs> {
  return ((await getMessages()).panel as unknown as { destek: DestekMsgs }).destek;
}

