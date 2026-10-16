// Ayrılmış çalışma alanı adları (bağımlılıksız; `proxy.ts` kısa adres yönlendirmesi de kullanır — T-995).
/**
 * Ayrılmış slug'lar (ADR-016 5. tur eki MINOR-5). Karşılaştırma küçük harfe çevrildikten sonra yapılır; üretilen slug
 * da tabidir. `demo` yalnızca demo tenant'a aittir (DB de `tenants_slug_chk` ile zorlar).
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "demo", "admin", "api", "app", "auth", "login", "logout", "signup", "register", "onboarding", "invite", "invitations",
  "t", "www", "static", "assets", "_next", "health", "status", "support", "help", "docs", "billing", "settings",
  "system", "root", "null", "undefined", "wms", "staging", "prod", "production", "test", "mail",
  // T-995 (ADR-026 §1): kısa adres `wms.etkinyazilim.com/<alan>` uygulama yollarıyla çakışmasın (her üst düzey yol ayrılmış; bekçi testi).
  "activate", "mfa", "reset-password", "operator", "field", "panel", "design", "fonts", "yonet", "manifest", "icon", "apple-icon",
  "favicon", "robots", "sitemap", "privacy", "terms", "pricing", "trial", "account", "accounts", "security",
]);
