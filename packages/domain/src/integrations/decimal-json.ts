// T-1135 (I-09): ondalık metin → JSON sayısı, float aritmetiği OLMADAN. Miktarlar DB'den `numeric::text` gelir ve sağlayıcı istemcisine
// metin olarak taşınır; JSON gövdesine yalnız en son serileştirme adımında burada dönüştürülür. Paraşüt şeması sayı ister (`quantity`,
// `new_total_inventory`); metin gönderilmez.
//
// Kural: en çok 14 tam + 6 ondalık basamak (DB numeric(20,6)); başka biçim (üstel, boş, harf, çift işaret) VALIDATION_FAILED. Kanonik biçim:
// gereksiz sondaki sıfırlar ve nokta atılır, "-0" → "0". Çıktı: `JSON.rawJSON` varsa (Node ≥ 21) kanonik metin JSON gövdesine birebir yazılır
// (kesin); yoksa yalnız Number'ın kısa gösterimi kanonik metne BİREBİR eşitse Number döner (yuvarlama kanıtlanmış yok), değilse ret.
import { AppError } from "@wms/shared/errors";

export const JSON_DECIMAL_RE = /^-?[0-9]{1,14}(\.[0-9]{1,6})?$/;

/** Kanonik ondalık metin (I-09): doğrulanmış, sondaki sıfırlar atılmış. */
export function canonicalDecimal(raw: string): string {
  const t = raw.trim();
  if (!JSON_DECIMAL_RE.test(t)) throw new AppError("VALIDATION_FAILED", { detail: "QUANTITY_SCALE" });
  const neg = t.startsWith("-");
  const [intPartRaw, fracRaw = ""] = (neg ? t.slice(1) : t).split(".") as [string, string?];
  const intPart = intPartRaw.replace(/^0+(?=\d)/, "");
  const frac = fracRaw.replace(/0+$/, "");
  const body = frac === "" ? intPart : `${intPart}.${frac}`;
  if (body === "0") return "0";
  return neg ? `-${body}` : body;
}

type RawJsonFactory = (text: string) => unknown;
const rawJson: RawJsonFactory | null = typeof (JSON as unknown as { rawJSON?: unknown }).rawJSON === "function" ? ((JSON as unknown as { rawJSON: RawJsonFactory }).rawJSON) : null;

/**
 * JSON gövdesine yazılacak sayı değeri. `JSON.stringify` bu değeri kanonik ondalık metin olarak basar. Float aritmetiği yoktur; Number yolu
 * yalnız kayıpsızlığı kanıtlanınca kullanılır.
 */
export function jsonDecimal(raw: string, factory: RawJsonFactory | null = rawJson): unknown {
  const canon = canonicalDecimal(raw);
  if (factory !== null) return factory(canon);
  const n = Number(canon);
  if (!Number.isFinite(n) || String(n) !== canon) throw new AppError("VALIDATION_FAILED", { detail: "QUANTITY_SCALE" });
  return n;
}
