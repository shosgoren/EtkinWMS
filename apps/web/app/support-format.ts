// T-967 (B-84): destek talebi numarası ve göreli zaman (Destek.dc.html / YonetDestek.dc.html: "DST-0142", "ŞİMDİ", "BUGÜN 09:12",
// "DÜN 17:20", "17.10"). Saf yardımcı: kiracı ekranı (tarayıcı saati) ve panel (İstanbul saati) aynı kuralı kullanır.

/** Kaynaktaki talep numarası biçimi. */
export function ticketNo(n: number): string {
  return `DST-${String(n).padStart(4, "0")}`;
}

export interface When {
  readonly kind: "now" | "today" | "yesterday" | "date";
  /** SS:DD */
  readonly time: string;
  /** GG.AA */
  readonly date: string;
}

function parts(d: Date, timeZone: string | undefined): Record<string, string> {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  return Object.fromEntries(p.map((x) => [x.type, x.value]));
}

const dayNo = (p: Record<string, string>): number => Math.round(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / 86_400_000);

export function whenOf(at: Date, now: Date, timeZone?: string): When {
  const p = parts(at, timeZone);
  const time = `${p.hour}:${p.minute}`;
  const date = `${p.day}.${p.month}`;
  if (Math.abs(now.getTime() - at.getTime()) < 60_000) return { kind: "now", time, date };
  const diff = dayNo(parts(now, timeZone)) - dayNo(p);
  if (diff <= 0) return { kind: "today", time, date };
  if (diff === 1) return { kind: "yesterday", time, date };
  return { kind: "date", time, date };
}

/** Kısa kimlik (ör. "MOT-7K2Q"): talepte "destek kodu" olarak gider; kullanıcı ve operatör aynı kodu görür. */
export function newSupportCode(slug: string, rand: () => number = Math.random): string {
  const A = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  const head = slug.replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase().padEnd(3, "X");
  let tail = "";
  for (let i = 0; i < 4; i++) tail += A.charAt(Math.floor(rand() * A.length));
  return `${head}-${tail}`;
}
