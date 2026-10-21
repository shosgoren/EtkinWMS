// İşlem kaydı satır biçimi (T-408): `platform.*` olayı → "Operatör · …" metni. Saf yardımcı (sayfa ve birim testi).
import type { PanelEvent } from "@wms/domain/platform/events";
import { tarih, tarihBicimi } from "@wms/ui";

const TZ = "Europe/Istanbul";

export interface KayitMsgs {
  readonly title: string;
  readonly sub: string;
  readonly head: string;
  readonly tag: string;
  readonly empty: string;
  readonly op: string;
  readonly sys: string;
  readonly unknown: string;
  readonly published: string;
  readonly methods: Readonly<Record<string, string>>;
  readonly monthNames: readonly string[];
  readonly kinds: Readonly<Record<string, string>>;
}

function fill(s: string, v: Readonly<Record<string, string | number>>): string {
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));
}

// T-1001 (ALTIN-KURAL 16): biçim dili çağıranın verdiği kullanıcı dili (`locale`); verilmezse ürünün varsayılan dili.
const WHEN: Intl.DateTimeFormatOptions = { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false };
const DATE: Intl.DateTimeFormatOptions = { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" };

export function stamp(d: Date, locale: string): string {
  const p = tarihBicimi(locale, WHEN).formatToParts(d);
  const g = (k: string): string => p.find((x) => x.type === k)?.value ?? "";
  return `${g("day")}.${g("month")} ${g("hour")}:${g("minute")}`;
}

/** Olay → tek satır metin (tasarım: "Operatör · Satış sayfası … yayınlandı"). Bilinmeyen tür ham adıyla gösterilir (kayıt gizlenmez). */
export function describe(e: PanelEvent, t: KayitMsgs, locale: string): string {
  const period = e.info.period;
  const month = period !== undefined && /^\d{4}-\d{2}/.test(period) ? `${t.monthNames[Number(period.slice(5, 7)) - 1] ?? ""} ${period.slice(0, 4)}` : "";
  const trial = e.info.trialEndsAt === undefined || Number.isNaN(Date.parse(e.info.trialEndsAt)) ? "" : tarih(new Date(e.info.trialEndsAt), locale, DATE);
  const tpl = t.kinds[e.kind.replace(/^platform\./, "")];
  const body =
    tpl === undefined
      ? e.kind
      : fill(tpl, {
          company: e.company ?? t.unknown,
          plan: e.plan ?? t.unknown,
          version: e.info.version ?? "",
          published: e.info.published === true ? t.published : "",
          month,
          count: e.info.count ?? 0,
          method: e.info.method === undefined ? "" : (t.methods[e.info.method] ?? e.info.method),
          reason: e.info.reason ?? "",
          trial,
        }).trim();
  return `${e.byOperator ? t.op : t.sys} · ${body}`;
}

