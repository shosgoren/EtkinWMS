// T-968: kalıp ekranlarında miktar gösterimi. Miktar PostgreSQL decimal DİZGİSİDİR; kayan noktaya çevrilmeden biçimlenir (I-09):
// sondaki sıfırlar atılır, binlik ayırıcı eklenir (tr: "1.240,5"; en: "1,240.5"). Yalnız gösterimdir; hesap sunucudadır.
export function fmtQty(raw: string, locale: string = "tr"): string {
  const s = raw.trim();
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const [int = "0", frac = ""] = body.split(".");
  const f = frac.replace(/0+$/, "");
  const sep = locale === "en" ? "," : ".";
  const dec = locale === "en" ? "." : ",";
  const grouped = (int.replace(/^0+(?=\d)/, "") || "0").replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  return `${neg ? "−" : ""}${grouped}${f === "" ? "" : `${dec}${f}`}`;
}

/** Eşik karşılaştırması için yaklaşık sayı (yalnız trafik ışığı rengi; otorite değildir). */
export function approx(raw: string | null | undefined): number {
  if (raw === null || raw === undefined) return Number.NaN;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Trafik ışığı (Pano kuralıyla aynı): minimumun %35 altı kritik, minimum altı azaldı. Minimum yoksa sakin. */
export function stockTone(have: string, min: string | null): "ok" | "crit" | "low" {
  const h = approx(have);
  const m = approx(min);
  if (!Number.isFinite(m) || m <= 0 || !Number.isFinite(h)) return "ok";
  if (h < m * 0.35) return "crit";
  if (h < m) return "low";
  return "ok";
}

/** Decimal dizgileri kayan noktasız toplar (6 basamak ölçek; DB `numeric(20, 6)`). Yalnız gösterim. */
export function sumDecimal(values: readonly string[]): string {
  const SCALE = 6;
  let total = 0n;
  for (const raw of values) {
    const v = raw.trim();
    const neg = v.startsWith("-");
    const [i = "0", f = ""] = (neg ? v.slice(1) : v).split(".");
    const n = BigInt((i === "" ? "0" : i) + f.padEnd(SCALE, "0").slice(0, SCALE));
    total += neg ? -n : n;
  }
  const neg = total < 0n;
  const abs = (neg ? -total : total).toString().padStart(SCALE + 1, "0");
  return `${neg ? "-" : ""}${abs.slice(0, -SCALE)}.${abs.slice(-SCALE)}`;
}
