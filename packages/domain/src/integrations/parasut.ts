// Paraşüt API v4 istemcisi (T-991). Kaynak: https://apidocs.parasut.com/swagger.json (21 Ekim okundu; ayrıntı catalog.ts başında).
//
// GÜVENLİK
// - SSRF: adres sabittir (`https://api.parasut.com`). Kullanıcı adres veremez; şirket numarası ve kaynak kimlikleri yalnız rakamdır ve yola
//   girmeden doğrulanır. Test/yerel sahte sunucu yalnız `PARASUT_BASE_URL` ortam değişkeniyle ve YALNIZ geri döngü adresinde (127.0.0.1,
//   localhost, ::1; http) kabul edilir; başka değer açılışı reddeder (sessiz geri düşüş yok).
// - Sırlar (istemci sırrı, yetki kodu, belirteçler) hata iletisine, loga ve dönüş değerine girmez; hata yalnız sabit kod + HTTP durumu taşır.
//   Yanıt gövdesi en çok 5 MiB okunur; yönlendirme izlenmez (`redirect: "manual"`).
// - Hız sınırı (belge: 10 saniyede 10 istek): istemci örneği başına kayan pencere; 429 gelirse `Retry-After` (en çok 60 sn) ya da 10 sn bekleyip
//   en çok 3 kez yeniden dener (429 davranışı belgede yok; savunmacı). Zaman aşımı istek başına 15 sn.
//
// OAuth2: yetki kodu akışı (bağlanırken bir kez; kod tek kullanımlık) ve yenileme akışı (her yenilemede YENİ yenileme belirteci döner, belge).
// T-1139 (kullanıcı kararı 31 Ekim): parola akışı (`grant_type=password`) koddan kalktı; istemci kullanıcı adı/parolası hiç almaz.
// Gövde `application/x-www-form-urlencoded` (RFC 6749 §4.1.3/§6); belgedeki curl örneği çok parçalı form kullanır — canlı ilk bağlantıda doğrulanacak.
import { AppError } from "@wms/shared/errors";
import { jsonDecimal } from "./decimal-json.ts";

export const PARASUT_BASE_URL = "https://api.parasut.com";
export const PARASUT_PAGE_SIZE = 25;
const MAX_BODY = 5 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const WINDOW_MS = 10_000;
const WINDOW_MAX = 10;
const RETRY_429 = 3;

export type ProviderErrorCode =
  | "AUTH_FAILED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "INVALID"
  | "UNAVAILABLE"
  | "NETWORK"
  | "BAD_RESPONSE"
  | "COMPANY_NOT_FOUND"
  | "CONFIG";

/** Sağlayıcı hatası: yalnız sabit kod + durum (sır/gövde yok). `retryable`: geçici (ağ, 5xx, 429). */
export class ProviderError extends Error {
  override name = "ProviderError";
  readonly code: ProviderErrorCode;
  readonly status: number | null;
  readonly retryable: boolean;
  constructor(code: ProviderErrorCode, status: number | null = null) {
    super(`provider error (${code}${status === null ? "" : ` ${status}`})`);
    this.code = code;
    this.status = status;
    this.retryable = code === "RATE_LIMITED" || code === "UNAVAILABLE" || code === "NETWORK";
  }
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** Sabit adres; `PARASUT_BASE_URL` yalnız geri döngü http(s) adresi olabilir (yerel/test sahte sunucu). */
export function resolveParasutBaseUrl(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const raw = env.PARASUT_BASE_URL?.trim() ?? "";
  if (raw === "") return PARASUT_BASE_URL;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ProviderError("CONFIG");
  }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || !LOOPBACK.has(u.hostname) || u.username !== "" || u.password !== "" || (u.pathname !== "/" && u.pathname !== "")) {
    throw new ProviderError("CONFIG");
  }
  return `${u.protocol}//${u.host}`;
}

const COMPANY_RE = /^[0-9]{1,12}$/;
const ID_RE = /^[0-9]{1,18}$/;

export function parseCompanyId(raw: unknown): string {
  if (typeof raw !== "string" || !COMPANY_RE.test(raw.trim())) throw new AppError("VALIDATION_FAILED");
  return raw.trim();
}
function id(raw: unknown): string {
  const v = typeof raw === "number" ? String(raw) : raw;
  if (typeof v !== "string" || !ID_RE.test(v)) throw new ProviderError("BAD_RESPONSE");
  return v;
}

export interface FetchLike {
  (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal; redirect: "manual" }): Promise<{
    status: number;
    headers: { get(name: string): string | null };
    text(): Promise<string>;
  }>;
}

export interface ParasutClientOptions {
  readonly baseUrl?: string;
  readonly fetch?: FetchLike;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly timeoutMs?: number;
}

export interface TokenSet {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Bitiş (epoch ms). */
  readonly expiresAt: number;
}

export interface JsonApiResource {
  readonly id: string;
  readonly type: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly relationships: Readonly<Record<string, unknown>>;
}

export interface Page {
  readonly included?: readonly JsonApiResource[];
  readonly items: readonly JsonApiResource[];
  readonly page: number;
  readonly totalPages: number;
}

export interface Company {
  readonly id: string;
  readonly name: string;
}

/** Paraşüt webhook kaydı (T-1138). `encryptionKey` yanıtta varsa; sır olarak işlenir (loga/audit'e girmez). */
export interface WebhookRecord {
  readonly id: string;
  readonly model: string | null;
  readonly action: string | null;
  readonly uri: string | null;
  readonly encryptionKey: string | null;
}

function webhookRecord(r: JsonApiResource): WebhookRecord {
  const a = r.attributes;
  return { id: r.id, model: str(a.model, 40), action: str(a.action, 40), uri: str(a.uri, 2048), encryptionKey: str(a.encryption_key, 512) };
}

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : null);

function resource(raw: unknown): JsonApiResource {
  if (typeof raw !== "object" || raw === null) throw new ProviderError("BAD_RESPONSE");
  const r = raw as Record<string, unknown>;
  const attrs = typeof r.attributes === "object" && r.attributes !== null ? (r.attributes as Record<string, unknown>) : {};
  const rels = typeof r.relationships === "object" && r.relationships !== null ? (r.relationships as Record<string, unknown>) : {};
  if (typeof r.type !== "string") throw new ProviderError("BAD_RESPONSE");
  return { id: id(r.id), type: r.type, attributes: attrs, relationships: rels };
}

/** İstemci: tek bağlantı (şirket) için; hız sınırı örnek başınadır (bir senkron koşusu tek örnek kullanır). */
export class ParasutClient {
  private readonly baseUrl: string;
  private readonly doFetch: FetchLike;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly sent: number[] = [];
  /** Bu örnekte yapılan istek sayısı (test / çalışma özeti). */
  requests = 0;

  constructor(opts: ParasutClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? resolveParasutBaseUrl();
    this.doFetch = opts.fetch ?? ((url, init) => fetch(url, init));
    this.now = opts.now ?? (() => Date.now());
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  }

  private async throttle(): Promise<void> {
    for (;;) {
      const t = this.now();
      while (this.sent.length > 0 && t - (this.sent[0] as number) >= WINDOW_MS) this.sent.shift();
      if (this.sent.length < WINDOW_MAX) {
        this.sent.push(t);
        return;
      }
      await this.sleep(WINDOW_MS - (t - (this.sent[0] as number)) + 5);
    }
  }

  /**
   * `lockSafe` (yenileme, satır kilidi altında): pencere beklemesi ve 429 yeniden denemesi YOK — kilit en çok tek istek zaman aşımı kadar
   * (15 sn) tutulur (güvenlik incelemesi MAJOR-1). Pencereye yine sayılır.
   */
  private async request(method: string, path: string, opts: { token?: string; json?: unknown; form?: Record<string, string>; lockSafe?: boolean } = {}): Promise<{ status: number; body: unknown }> {
    for (let attempt = 0; ; attempt++) {
      if (opts.lockSafe === true) this.sent.push(this.now());
      else await this.throttle();
      this.requests++;
      const headers: Record<string, string> = { Accept: "application/json" };
      let body: string | undefined;
      if (opts.token !== undefined) headers.Authorization = `Bearer ${opts.token}`;
      if (opts.json !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(opts.json);
      } else if (opts.form !== undefined) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        body = new URLSearchParams(opts.form).toString();
      }
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await this.doFetch(`${this.baseUrl}${path}`, { method, headers, body, signal: AbortSignal.timeout(this.timeoutMs), redirect: "manual" });
      } catch {
        throw new ProviderError("NETWORK"); // kök hata adresi/başlık taşıyabilir: yayılmaz
      }
      if (res.status === 429 && attempt < RETRY_429 && opts.lockSafe !== true) {
        const ra = Number(res.headers.get("retry-after"));
        await this.sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 60) * 1000 : WINDOW_MS);
        continue;
      }
      const declared = Number(res.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > MAX_BODY) throw new ProviderError("BAD_RESPONSE", res.status);
      let text: string;
      try {
        text = await res.text();
      } catch {
        throw new ProviderError("NETWORK");
      }
      if (text.length > MAX_BODY) throw new ProviderError("BAD_RESPONSE", res.status);
      let parsed: unknown = null;
      if (text.trim() !== "") {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
      }
      return { status: res.status, body: parsed };
    }
  }

  private static fail(status: number, auth = false): ProviderError {
    if (status === 401 || (auth && status === 400)) return new ProviderError("AUTH_FAILED", status);
    if (status === 403) return new ProviderError("FORBIDDEN", status);
    if (status === 404) return new ProviderError("NOT_FOUND", status);
    if (status === 429) return new ProviderError("RATE_LIMITED", status);
    if (status === 400 || status === 422) return new ProviderError("INVALID", status);
    if (status >= 500) return new ProviderError("UNAVAILABLE", status);
    return new ProviderError("BAD_RESPONSE", status);
  }

  private tokens(body: unknown): TokenSet {
    const b = (body ?? {}) as Record<string, unknown>;
    const access = str(b.access_token, 4096);
    const refresh = str(b.refresh_token, 4096);
    const exp = typeof b.expires_in === "number" && b.expires_in > 0 ? b.expires_in : 7200;
    if (access === null || refresh === null) throw new ProviderError("BAD_RESPONSE");
    // 60 sn pay: bitişe yakın belirteç kullanılmaz.
    return { accessToken: access, refreshToken: refresh, expiresAt: this.now() + Math.max(60, exp - 60) * 1000 };
  }

  /** Authorization code is single-use; no automatic token-request retry. */
  async authorizationCodeGrant(input: { readonly clientId: string; readonly clientSecret: string; readonly code: string; readonly redirectUri: string }): Promise<TokenSet> {
    const r = await this.request("POST", "/oauth/token", {
      form: { grant_type: "authorization_code", client_id: input.clientId, client_secret: input.clientSecret, code: input.code, redirect_uri: input.redirectUri },
      lockSafe: true,
    });
    if (r.status !== 200) throw ParasutClient.fail(r.status, true);
    return this.tokens(r.body);
  }

  /** Yenileme akışı: yeni erişim + YENİ yenileme belirteci (eskisi bir daha kullanılmaz). */
  async refreshGrant(input: { readonly clientId: string; readonly clientSecret: string; readonly refreshToken: string }): Promise<TokenSet> {
    const r = await this.request("POST", "/oauth/token", {
      form: { grant_type: "refresh_token", client_id: input.clientId, client_secret: input.clientSecret, refresh_token: input.refreshToken },
      lockSafe: true,
    });
    if (r.status !== 200) throw ParasutClient.fail(r.status, true);
    return this.tokens(r.body);
  }

  /** `GET /v4/me?include=companies`: kullanıcının şirketleri (bağlantı sınaması). */
  async companies(token: string): Promise<readonly Company[]> {
    const r = await this.request("GET", "/v4/me?include=companies", { token });
    if (r.status !== 200) throw ParasutClient.fail(r.status);
    const inc = (r.body as { included?: unknown } | null)?.included;
    if (!Array.isArray(inc)) return [];
    const out: Company[] = [];
    for (const raw of inc) {
      const o = raw as { type?: unknown; id?: unknown; attributes?: { name?: unknown } };
      if (o?.type !== "companies") continue;
      const cid = typeof o.id === "number" ? String(o.id) : o.id;
      if (typeof cid !== "string" || !COMPANY_RE.test(cid)) continue;
      out.push({ id: cid, name: str(o.attributes?.name, 120) ?? cid });
    }
    return out;
  }

  /** Şirket kapsamında liste sayfası (`page[size]` en çok 25, `sort=id`). */
  async list(token: string, companyId: string, kind: "products" | "contacts" | "warehouses", page: number): Promise<Page> {
    const cid = parseCompanyId(companyId);
    if (!Number.isInteger(page) || page < 1 || page > 100_000) throw new AppError("VALIDATION_FAILED");
    const r = await this.request("GET", `/v4/${cid}/${kind}?sort=id&page%5Bnumber%5D=${page}&page%5Bsize%5D=${PARASUT_PAGE_SIZE}${kind === "products" ? "&include=category" : ""}`, { token });
    if (r.status !== 200) throw ParasutClient.fail(r.status);
    const b = (r.body ?? {}) as { data?: unknown; included?: unknown; meta?: { total_pages?: unknown } };
    if (!Array.isArray(b.data)) throw new ProviderError("BAD_RESPONSE", r.status);
    const total = typeof b.meta?.total_pages === "number" && Number.isInteger(b.meta.total_pages) && b.meta.total_pages >= 0 ? b.meta.total_pages : page;
    return { items: b.data.map(resource), included: Array.isArray(b.included) ? b.included.map(resource) : [], page, totalPages: total };
  }

  /** 404 means absent only; the caller must separately prove company/catalog access before reconciling deletion. */
  async product(token: string, companyId: string, productId: string): Promise<JsonApiResource | null> {
    return (await this.productDetail(token, companyId, productId))?.item ?? null;
  }

  /** T-1138: ürün + `included` (kategori adı için; webhook yeniden okuması kaynak bilgisini eksik yazmasın). */
  async productDetail(token: string, companyId: string, productId: string): Promise<{ readonly item: JsonApiResource; readonly included: readonly JsonApiResource[] } | null> {
    const cid = parseCompanyId(companyId), pid = id(productId);
    const r = await this.request("GET", `/v4/${cid}/products/${pid}?include=category`, { token });
    if (r.status === 404) return null;
    if (r.status !== 200) throw ParasutClient.fail(r.status);
    const b = (r.body ?? {}) as { data?: unknown; included?: unknown };
    const item = resource(b.data);
    if (item.id !== pid || item.type !== "products") throw new ProviderError("BAD_RESPONSE", r.status);
    return { item, included: Array.isArray(b.included) ? b.included.map(resource) : [] };
  }

  /** Cari kartı kimliğiyle (T-1138 webhook yeniden okuması). 404 yalnız "yok" demektir. */
  async contact(token: string, companyId: string, contactId: string): Promise<JsonApiResource | null> {
    const cid = parseCompanyId(companyId), xid = id(contactId);
    const r = await this.request("GET", `/v4/${cid}/contacts/${xid}`, { token });
    if (r.status === 404) return null;
    if (r.status !== 200) throw ParasutClient.fail(r.status);
    const item = resource((r.body as { data?: unknown } | null)?.data);
    if (item.id !== xid || item.type !== "contacts") throw new ProviderError("BAD_RESPONSE", r.status);
    return item;
  }

  // --- webhook (T-1138) ---------------------------------------------------------------------------------------------------------------
  // Paraşüt belgesi: webhook kaynağı `model` (product, contact, …), `action` (create, update, delete), `uri`; teslimde `Signature` başlığı.
  // Anahtar atama biçimi belgede kesin değil: istek `encryption_key` taşır, yanıtta varsa yanıttaki kullanılır (ikisi de desteklenir).
  /** Şirketin webhook kayıtları (en çok 4 sayfa). Anahtar yanıtta yoksa `encryptionKey` null. */
  async listWebhooks(token: string, companyId: string): Promise<readonly WebhookRecord[]> {
    const cid = parseCompanyId(companyId);
    const out: WebhookRecord[] = [];
    for (let page = 1; page <= 4; page++) {
      const r = await this.request("GET", `/v4/${cid}/webhooks?page%5Bnumber%5D=${page}&page%5Bsize%5D=${PARASUT_PAGE_SIZE}`, { token });
      if (r.status !== 200) throw ParasutClient.fail(r.status);
      const b = (r.body ?? {}) as { data?: unknown; meta?: { total_pages?: unknown } };
      if (!Array.isArray(b.data)) throw new ProviderError("BAD_RESPONSE", r.status);
      for (const raw of b.data) out.push(webhookRecord(resource(raw)));
      const total = typeof b.meta?.total_pages === "number" ? b.meta.total_pages : page;
      if (b.data.length === 0 || page >= total) break;
    }
    return out;
  }

  /** Webhook kaydı aç; yanıtta anahtar varsa döner (Paraşüt atadıysa bizimkini değil onu kullanırız). Boş anahtar: alan gönderilmez. */
  async createWebhook(token: string, companyId: string, w: { readonly model: string; readonly action: string; readonly uri: string; readonly encryptionKey: string }): Promise<WebhookRecord> {
    const cid = parseCompanyId(companyId);
    const r = await this.request("POST", `/v4/${cid}/webhooks`, { token, json: { data: { type: "webhooks", attributes: { model: w.model, action: w.action, uri: w.uri, ...(w.encryptionKey === "" ? {} : { encryption_key: w.encryptionKey }) } } } });
    if (r.status !== 201 && r.status !== 200) throw ParasutClient.fail(r.status);
    return webhookRecord(resource((r.body as { data?: unknown } | null)?.data));
  }

  /** Webhook kaydını sil; 404 (zaten yok) başarı sayılır. */
  async deleteWebhook(token: string, companyId: string, webhookId: string): Promise<void> {
    const cid = parseCompanyId(companyId), wid = id(webhookId);
    const r = await this.request("DELETE", `/v4/${cid}/webhooks/${wid}`, { token });
    if (r.status === 404 || r.status === 204 || r.status === 200) return;
    throw ParasutClient.fail(r.status);
  }

  /** Ürün koduna göre ara (`filter[code]`): Etkin -> Paraşüt gönderiminde çift kayıt açmamak için. */
  async findProductByCode(token: string, companyId: string, code: string): Promise<JsonApiResource | null> {
    const cid = parseCompanyId(companyId);
    const r = await this.request("GET", `/v4/${cid}/products?filter%5Bcode%5D=${encodeURIComponent(code)}&page%5Bsize%5D=2`, { token });
    if (r.status !== 200) throw ParasutClient.fail(r.status);
    const data = (r.body as { data?: unknown } | null)?.data;
    if (!Array.isArray(data)) throw new ProviderError("BAD_RESPONSE", r.status);
    const exact = data.map(resource).filter((p) => p.attributes.code === code);
    return exact.length === 1 ? (exact[0] as JsonApiResource) : null;
  }

  /** Cari: vergi numarasına (yoksa ada) göre ara (`filter[tax_number]` / `filter[name]`). */
  async findContact(token: string, companyId: string, by: { readonly taxNumber?: string | null; readonly name: string }): Promise<JsonApiResource | null> {
    const cid = parseCompanyId(companyId);
    const q = by.taxNumber ? `filter%5Btax_number%5D=${encodeURIComponent(by.taxNumber)}` : `filter%5Bname%5D=${encodeURIComponent(by.name)}`;
    const r = await this.request("GET", `/v4/${cid}/contacts?${q}&page%5Bsize%5D=2`, { token });
    if (r.status !== 200) throw ParasutClient.fail(r.status);
    const data = (r.body as { data?: unknown } | null)?.data;
    if (!Array.isArray(data)) throw new ProviderError("BAD_RESPONSE", r.status);
    const rows = data.map(resource).filter((c) => (by.taxNumber ? c.attributes.tax_number === by.taxNumber : c.attributes.name === by.name));
    return rows.length === 1 ? (rows[0] as JsonApiResource) : null;
  }

  /** Depo: ada göre ara (`filter[name]`). */
  async findWarehouse(token: string, companyId: string, name: string): Promise<JsonApiResource | null> {
    const cid = parseCompanyId(companyId);
    const r = await this.request("GET", `/v4/${cid}/warehouses?filter%5Bname%5D=${encodeURIComponent(name)}&page%5Bsize%5D=2`, { token });
    if (r.status !== 200) throw ParasutClient.fail(r.status);
    const data = (r.body as { data?: unknown } | null)?.data;
    if (!Array.isArray(data)) throw new ProviderError("BAD_RESPONSE", r.status);
    const rows = data.map(resource).filter((w) => w.attributes.name === name);
    return rows.length === 1 ? (rows[0] as JsonApiResource) : null;
  }

  private async create(token: string, companyId: string, kind: string, data: unknown): Promise<string> {
    const cid = parseCompanyId(companyId);
    const r = await this.request("POST", `/v4/${cid}/${kind}`, { token, json: { data } });
    if (r.status !== 201 && r.status !== 200) throw ParasutClient.fail(r.status);
    return resource((r.body as { data?: unknown } | null)?.data).id;
  }

  async createProduct(token: string, companyId: string, p: { readonly code: string; readonly name: string; readonly unit: string | null }): Promise<string> {
    return this.create(token, companyId, "products", { type: "products", attributes: { code: p.code, name: p.name, ...(p.unit === null ? {} : { unit: p.unit }), inventory_tracking: true } });
  }

  async createContact(
    token: string,
    companyId: string,
    c: { readonly name: string; readonly accountType: "customer" | "supplier"; readonly taxNumber: string | null; readonly taxOffice: string | null; readonly email: string | null; readonly phone: string | null; readonly city: string | null; readonly address: string | null; readonly shortName?: string | null; readonly district?: string | null },
  ): Promise<string> {
    const attrs: Record<string, unknown> = { name: c.name, account_type: c.accountType, contact_type: "company" };
    // T-1117: kısa ad ve ilçe (`0064_party_details`) doluysa gönderilir.
    for (const [k, v] of [["tax_number", c.taxNumber], ["tax_office", c.taxOffice], ["email", c.email], ["phone", c.phone], ["city", c.city], ["district", c.district ?? null], ["address", c.address], ["short_name", c.shortName ?? null]] as const) if (v !== null) attrs[k] = v;
    return this.create(token, companyId, "contacts", { type: "contacts", attributes: attrs });
  }

  async createWarehouse(token: string, companyId: string, w: { readonly name: string }): Promise<string> {
    return this.create(token, companyId, "warehouses", { type: "warehouses", attributes: { name: w.name } });
  }

  /** Depo kartı kimliğiyle (T-1140 iki yönlü eşitleme). 404 yalnız "yok" demektir. */
  async warehouse(token: string, companyId: string, warehouseId: string): Promise<JsonApiResource | null> {
    const cid = parseCompanyId(companyId), wid = id(warehouseId);
    const r = await this.request("GET", `/v4/${cid}/warehouses/${wid}`, { token });
    if (r.status === 404) return null;
    if (r.status !== 200) throw ParasutClient.fail(r.status);
    const item = resource((r.body as { data?: unknown } | null)?.data);
    if (item.id !== wid || item.type !== "warehouses") throw new ProviderError("BAD_RESPONSE", r.status);
    return item;
  }

  // --- düzeltme gönderimi (T-1140) --------------------------------------------------------------------------------------------------
  // Paraşüt v4 belgesi kart düzenlemeyi `PUT /v4/{şirket}/{kaynak}/{kimlik}` ile tanımlar (JSON:API `data.id` + `data.type` + `attributes`);
  // yanıt güncel kaynaktır. Gönderilen alanlar oluşturma eşleyicileriyle (createProduct/createContact/createWarehouse) aynı kümeden seçilir;
  // boş (null) alan GÖNDERİLMEZ (Paraşüt'teki değeri silmeyiz). Gerçek hesapta alan kabulü ve yanıt biçimi UNKNOWN (BACKLOG).
  private async update(token: string, companyId: string, kind: "products" | "contacts" | "warehouses", externalId: string, attributes: Record<string, unknown>): Promise<JsonApiResource> {
    const cid = parseCompanyId(companyId), xid = id(externalId);
    const r = await this.request("PUT", `/v4/${cid}/${kind}/${xid}`, { token, json: { data: { id: xid, type: kind, attributes } } });
    if (r.status !== 200) throw ParasutClient.fail(r.status);
    const item = resource((r.body as { data?: unknown } | null)?.data);
    if (item.id !== xid || item.type !== kind) throw new ProviderError("BAD_RESPONSE", r.status);
    return item;
  }

  /** Ürün: yalnız ad (kod iki tarafta eşleme anahtarıdır, birim kart açıldıktan sonra değişmez — I-09). */
  async updateProduct(token: string, companyId: string, externalId: string, p: { readonly name: string }): Promise<JsonApiResource> {
    return this.update(token, companyId, "products", externalId, { name: p.name });
  }

  /** Cari: ad + createContact'taki iletişim/vergi alanları (dolu olanlar). Cari türü (`account_type`) gönderilmez (Etkin'de BOTH olabilir). */
  async updateContact(
    token: string,
    companyId: string,
    externalId: string,
    c: { readonly name: string; readonly taxNumber: string | null; readonly taxOffice: string | null; readonly email: string | null; readonly phone: string | null; readonly city: string | null; readonly district: string | null; readonly address: string | null; readonly shortName: string | null },
  ): Promise<JsonApiResource> {
    const attrs: Record<string, unknown> = { name: c.name };
    for (const [k, v] of [["tax_number", c.taxNumber], ["tax_office", c.taxOffice], ["email", c.email], ["phone", c.phone], ["city", c.city], ["district", c.district], ["address", c.address], ["short_name", c.shortName]] as const) if (v !== null) attrs[k] = v;
    return this.update(token, companyId, "contacts", externalId, attrs);
  }

  async updateWarehouse(token: string, companyId: string, externalId: string, w: { readonly name: string }): Promise<JsonApiResource> {
    return this.update(token, companyId, "warehouses", externalId, { name: w.name });
  }

  /**
   * Satış irsaliyesi (`inflow: false`). Stok hareketi yalnız ürün + miktar taşır (belgede depo ilişkisi yok; Paraşüt'ün depo seçimi canlıda
   * doğrulanacak). Cari ilişki türü belgede `contact` yazıyor, okuma modelinde `contacts`; JSON:API çoğul türü gönderilir (doğrulanacak).
   */
  async createShipmentDocument(
    token: string,
    companyId: string,
    d: { readonly issueDate: string; readonly shipmentDate: string; readonly description: string; readonly procurementNumber: string; readonly contactId: string; readonly lines: readonly { readonly productId: string; readonly quantity: string }[] },
  ): Promise<string> {
    // T-1135 (I-09): miktar ondalık metin olarak gelir; JSON sayısına yalnız burada, float aritmetiği olmadan dönüştürülür (`jsonDecimal`).
    return this.create(token, companyId, "shipment_documents", {
      type: "shipment_documents",
      attributes: { issue_date: d.issueDate, shipment_date: d.shipmentDate, inflow: false, description: d.description, procurement_number: d.procurementNumber },
      relationships: {
        contact: { data: { id: id(d.contactId), type: "contacts" } },
        stock_movements: { data: d.lines.map((l) => ({ type: "stock_movements", attributes: { quantity: jsonDecimal(l.quantity) }, relationships: { product: { data: { id: id(l.productId), type: "products" } } } })) },
      },
    });
  }

  /** Stok güncelleme fişi: ürün + depo başına yeni toplam (mutlak değer → tekrar gönderim aynı sonucu verir). Toplam ondalık metindir (I-09). */
  async createStockUpdate(token: string, companyId: string, details: readonly { readonly productId: string; readonly warehouseId: string; readonly total: string }[]): Promise<string> {
    return this.create(token, companyId, "stock_updates", {
      type: "stock_updates",
      relationships: {
        details: {
          data: details.map((x) => ({
            type: "stock_update_details",
            attributes: { new_total_inventory: jsonDecimal(x.total) },
            relationships: { product: { data: { id: id(x.productId), type: "products" } }, warehouse: { data: { id: id(x.warehouseId), type: "warehouses" } } },
          })),
        },
      },
    });
  }
}
