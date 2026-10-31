// ERP kimlik bilgisi mührü (T-991). Mevcut kalıp: `@wms/shared/seal` AES-256-GCM + `QUEUE_SEAL_KEY` (yeni anahtar yok). AAD = sabit iş türü
// `integration.credentials` + sağlayıcı + tenant kimliği: başka tenant'a / sağlayıcıya kopyalanan kutu açılmaz. Kutu DB'de yalnız
// {v, kid, iv, tag, ct} biçiminde durur (0055 CHECK). Anahtar döndürülürse eski kutu açılmaz (`SealOpenError`) → bağlantı "yeniden bağlan"
// durumuna düşer; düz değer hiçbir yerde tutulmaz.
//
// Saklanan: istemci kimliği/sırrı, yenileme belirteci, erişim belirteci + bitişi. Kullanıcının Paraşüt e-postası/parolası hiçbir aşamada
// alınmaz (T-1139: yalnız OAuth yetki kodu). Değerler loga, audit'e, hata iletisine ve istemciye (ekran) asla gitmez.
import { createSealer, type SealedBox, type Sealer } from "@wms/shared/seal";
import type { Provider } from "./catalog.ts";

export interface ProviderSecrets {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  readonly accessToken: string;
  /** Erişim belirtecinin bitişi (epoch ms, metin). */
  readonly accessExpiresAt: string;
}

const JOB = "integration.credentials";

let cached: { readonly raw: string; readonly sealer: Sealer } | undefined;

/** Ortamdan mühürleyici; anahtar yoksa/yer tutucuysa `SealConfigError` (fail-closed: bağlantı kurulmaz, sır düz yazılmaz). */
export function integrationSealer(env: Readonly<Record<string, string | undefined>> = process.env): Sealer {
  const raw = env.QUEUE_SEAL_KEY ?? "";
  if (cached !== undefined && cached.raw === raw) return cached.sealer;
  const sealer = createSealer(raw);
  cached = { raw, sealer };
  return sealer;
}

export function sealSecrets(sealer: Sealer, tenantId: string, provider: Provider, s: ProviderSecrets): SealedBox {
  return sealer.seal(
    { clientId: s.clientId, clientSecret: s.clientSecret, refreshToken: s.refreshToken, accessToken: s.accessToken, accessExpiresAt: s.accessExpiresAt },
    { jobType: JOB, template: provider, tenantId },
  );
}

/** Kutu açılamazsa `SealOpenError` (ayrıntısız). Eksik alan da açılamaz sayılır. */
export function openSecrets(sealer: Sealer, tenantId: string, provider: Provider, box: unknown): ProviderSecrets {
  const o = sealer.open(box, { jobType: JOB, template: provider, tenantId });
  const need = ["clientId", "clientSecret", "refreshToken", "accessToken", "accessExpiresAt"] as const;
  for (const k of need) if (typeof o[k] !== "string") throw new SecretsShapeError();
  return { clientId: o.clientId as string, clientSecret: o.clientSecret as string, refreshToken: o.refreshToken as string, accessToken: o.accessToken as string, accessExpiresAt: o.accessExpiresAt as string };
}

export class SecretsShapeError extends Error {
  override name = "SecretsShapeError";
  constructor() {
    super("integration secrets are malformed");
  }
}
