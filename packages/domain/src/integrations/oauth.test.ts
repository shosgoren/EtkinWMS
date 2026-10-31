// T-1133: ortak Paraşüt uygulaması — ortam okuması ve çözüm sırası (kiracının kendi uygulaması → ortak → yok). Sentetik değerler.
import { describe, expect, it } from "vitest";
import { PARASUT_CALLBACK_PATH, SHARED_OAUTH_CONFIG_VERSION, oauthApplicationOrigin, parasutOAuthConfig, pickOAuthConfig, type OAuthConfig } from "./oauth.ts";

const env = (over: Record<string, string | undefined> = {}) => ({ BETTER_AUTH_URL: "https://wms.example.test", PARASUT_OAUTH_CLIENT_ID: "shared-id", PARASUT_OAUTH_CLIENT_SECRET: "shared-secret", ...over });

describe("parasutOAuthConfig (ortak uygulama)", () => {
  it("reads id/secret from env and derives the callback from the application origin", () => {
    expect(parasutOAuthConfig(env())).toEqual({ clientId: "shared-id", clientSecret: "shared-secret", redirectUri: `https://wms.example.test${PARASUT_CALLBACK_PATH}`, version: SHARED_OAUTH_CONFIG_VERSION });
  });
  it("trims surrounding whitespace", () => {
    expect(parasutOAuthConfig(env({ PARASUT_OAUTH_CLIENT_ID: "  shared-id\n", PARASUT_OAUTH_CLIENT_SECRET: " shared-secret " }))?.clientId).toBe("shared-id");
  });
  it.each([
    ["missing id", { PARASUT_OAUTH_CLIENT_ID: undefined }],
    ["empty secret", { PARASUT_OAUTH_CLIENT_SECRET: "   " }],
    ["inner space", { PARASUT_OAUTH_CLIENT_ID: "a b" }],
    ["control char", { PARASUT_OAUTH_CLIENT_SECRET: "a\u0000b" }],
    ["too long", { PARASUT_OAUTH_CLIENT_SECRET: "x".repeat(201) }],
    ["no origin", { BETTER_AUTH_URL: undefined }],
    ["http origin", { BETTER_AUTH_URL: "http://wms.example.test" }],
    ["origin with path", { BETTER_AUTH_URL: "https://wms.example.test/app" }],
    ["origin with credentials", { BETTER_AUTH_URL: "https://u:p@wms.example.test" }],
  ])("is closed (null) when %s", (_n, over) => {
    expect(parasutOAuthConfig(env(over))).toBeNull();
  });
  it("allows loopback http only for local development", () => {
    expect(oauthApplicationOrigin({ BETTER_AUTH_URL: "http://localhost:3000" })).toBe("http://localhost:3000");
    expect(parasutOAuthConfig(env({ BETTER_AUTH_URL: "http://localhost:3000" }))?.redirectUri).toBe(`http://localhost:3000${PARASUT_CALLBACK_PATH}`);
  });
});

describe("pickOAuthConfig (çözüm sırası)", () => {
  const own: OAuthConfig = { clientId: "own", clientSecret: "own-s", redirectUri: "https://customer.example.test/cb", version: "11111111-1111-4111-8111-111111111111" };
  const shared = parasutOAuthConfig(env());
  it("tenant's own application wins over the shared one", () => expect(pickOAuthConfig(own, shared)).toBe(own));
  it("falls back to the shared application", () => expect(pickOAuthConfig(null, shared)).toBe(shared));
  it("is null when neither exists", () => expect(pickOAuthConfig(null, null)).toBeNull());
});
