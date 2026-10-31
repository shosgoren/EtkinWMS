// T-1139 (kullanıcı kararı 31 Ekim, "eski yöntem olmasın"): entegrasyon testlerinin Paraşüt bağlantı kurulumu — tek yol OAuth yetki kodu
// (eski e-posta + parola yardımcısının yerine). Gerçek domain yolu: beginParasutOAuth → completeParasutOAuth (tek şirket kendiliğinden seçilir;
// birden çok şirkette selectParasutOAuthCompany). Uygulama: varsayılan ortak uygulama (`deps.oauth`, sürüm SHARED_OAUTH_CONFIG_VERSION, kiracı
// satırı yok); `ownApp: true` kiracının kendi uygulamasını (Gelişmiş) kaydeder. Her bağlantı sahte sunucudan yeni tek kullanımlık kod alır.
//
// İlk OAuth bağlantısı ürün çekmeyi kendiliğinden açar (ürün kuralı, connections.ts `autoProducts`). Başka davranışı sınayan testlerin eski
// başlangıcı (bütün akışlar kapalı) için `productsOff: true` akışı yine domain yoluyla (setIntegrationFlow, audit'li) kapatır.
import {
  ParasutClient,
  beginParasutOAuth,
  completeParasutOAuth,
  saveParasutOAuthSettings,
  selectParasutOAuthCompany,
  setIntegrationFlow,
  type ConnectionCallParams,
  type IntegrationDeps,
  type OAuthConfig,
} from "../../../packages/domain/src/integrations/index.ts";
import type { FakeParasut } from "./fake-parasut.ts";

export type OAuthConnectResult = { readonly ok: true; readonly label: string } | { readonly ok: false; readonly reason: string };

export interface OAuthConnectOptions {
  /** Birden çok şirket varsa seçilecek şirket (varsayılan sahte sunucunun şirketi). */
  readonly companyId?: string;
  /** Yetki kodu (varsayılan: sahte sunucudan yeni geçerli kod). Hatalı kod senaryosu için. */
  readonly code?: string;
  /** Kiracının kendi uygulamasını kaydet (Gelişmiş) ve onunla bağlan. Varsayılan: ortak uygulama. */
  readonly ownApp?: boolean;
  /** İlk bağlantının açtığı ürün çekmeyi kapat (bütün akışlar kapalı başlangıç). */
  readonly productsOff?: boolean;
}

/** Sahte sunucunun kabul ettiği ortak uygulama yapılandırması (sürüm verilmez → ortak sürüm). */
export function fakeSharedOAuth(fake: FakeParasut): OAuthConfig {
  return { clientId: fake.opts.clientId, clientSecret: fake.opts.clientSecret, redirectUri: fake.opts.redirectUri };
}

/** OAuth ile bağlan (gerçek domain akışı). Dönüş eski yardımcıyla aynı biçim: `{ ok: true, label }` ya da `{ ok: false, reason }`. */
export async function connectParasutOAuth(
  params: ConnectionCallParams,
  deps: IntegrationDeps & { readonly client: ParasutClient },
  fake: FakeParasut,
  options: OAuthConnectOptions = {},
): Promise<OAuthConnectResult> {
  let d: IntegrationDeps & { oauth?: OAuthConfig };
  if (options.ownApp === true) {
    await saveParasutOAuthSettings(params, { clientId: fake.opts.clientId, clientSecret: fake.opts.clientSecret, callbackUrl: fake.opts.redirectUri }, deps);
    d = deps;
  } else {
    d = { ...deps, oauth: fakeSharedOAuth(fake) };
  }
  const begun = await beginParasutOAuth(params, d);
  if (!begun.ok) return { ok: false, reason: begun.reason };
  let r = await completeParasutOAuth(params, { binding: begun.binding, code: options.code ?? fake.mintAuthorizationCode() }, d);
  if (r.ok && r.status === "SELECT") r = await selectParasutOAuthCompany(params, { binding: begun.binding, companyId: options.companyId ?? fake.opts.companyId }, d);
  if (!r.ok) return { ok: false, reason: r.reason };
  if (r.status !== "CONNECTED") throw new Error("OAuth bağlantısı tamamlanmadı");
  if (options.productsOff === true) {
    const off = await setIntegrationFlow(params, { provider: "PARASUT", flow: "PRODUCTS", enabled: false, direction: "PULL" }, deps);
    if (!off.ok) throw new Error(`ürün akışı kapatılamadı: ${off.reason}`);
  }
  return { ok: true, label: r.label };
}
