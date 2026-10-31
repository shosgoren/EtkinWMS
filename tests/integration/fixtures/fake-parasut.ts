// T-991: sahte Paraşüt API v4 sunucusu (gerçek ağ yok). Birim, entegrasyon ve e2e testleri aynı sahteyi kullanır. Yalnız 127.0.0.1'e bağlanır.
// Belgedeki şekiller (https://apidocs.parasut.com/swagger.json): OAuth `POST /oauth/token` (authorization_code / refresh_token; T-1139: parola
// akışı yok, `grant_type=password` 400 alır; yenilemede YENİ yenileme
// belirteci), `GET /v4/me?include=companies`, şirket kapsamında products / contacts / warehouses (GET sayfalı, `filter[...]`, POST),
// shipment_documents POST, stock_updates POST; T-1140: products / contacts / warehouses `PUT /:id` (öznitelik birleştirir, `updated_at` yazar;
// `updateFailure` ile red) + warehouses/:id GET, oluşturulan kayıtta `updated_at`; T-1138: webhooks GET/POST/DELETE + contacts/:id GET + imzalı teslim üretici (`emitWebhook`). Her istek `requests`e yazılır (gövde dahil) — testler sırrın yalnız token ucuna gittiğini denetler.
import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeRecord {
  relationships?: Record<string, unknown>;
  id: string;
  attributes: Record<string, unknown>;
}

export interface FakeRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | null;
  readonly contentType: string | null;
  readonly body: string;
}

export interface FakeParasutOptions {
  readonly clientId?: string;
  readonly clientSecret?: string;
  /** Paraşüt kullanıcı profilindeki e-posta (`/v4/me`); giriş bilgisi değildir. */
  readonly username?: string;
  readonly companyId?: string;
  readonly companyName?: string;
  /** Erişim belirteci ömrü (sn); varsayılan 7200 (belge). */
  readonly expiresIn?: number;
  readonly authorizationCode?:string;
  readonly redirectUri?:string;
  /** T-1133 (yalnız e2e): `redirectUri`ye ek kabul edilen dönüş adresleri (ortak uygulama callback'i, OOB). Varsayılan yok. */
  readonly extraRedirectUris?: readonly string[];
  /**
   * T-1133 (yalnız e2e): aynı sentetik kod paylaşılan sahte sunucuda birden çok koşuda (masaüstü + telefon projesi, ortak + kendi uygulama)
   * kullanılır; tek kullanımlık deneme koruması uygulamanın kendi DB denemesindedir (e2e'de tekrar 400 ayrıca sınanır). Varsayılan tek kullanım.
   */
  readonly reusableCode?: boolean;
  readonly port?: number;
}

export interface FakeParasut {
  readonly url: string;
  readonly opts: Required<Omit<FakeParasutOptions, "port" | "extraRedirectUris" | "reusableCode">>;
  readonly companies: {id:string;name:string}[];
  readonly products: FakeRecord[];
  readonly categories: FakeRecord[];
  readonly contacts: FakeRecord[];
  readonly warehouses: FakeRecord[];
  readonly shipments: { body: unknown }[];
  readonly stockUpdates: { body: unknown }[];
  readonly requests: FakeRequest[];
  /** T-1138: webhook kayıtları (`encryption_key` sahte sunucuda tutulur; gerçek Paraşüt davranışı UNKNOWN). */
  readonly webhooks: FakeRecord[];
  /** Anahtar kipi: "ours" = istekteki anahtarı saklar ve yanıtta döndürmez; "assign" = alanı reddeder (422), kendi anahtarını atar ve döndürür. */
  webhookKeyMode: "ours" | "assign";
  /** Webhook POST'una hata (ör. 500) — kayıt kurulamazsa 30 sn tarama sürer. */
  webhookFailure: number | null;
  /** Bu kadar başarılı webhook POST'undan sonra `webhookFailure` (yoksa 500) döner (kısmi kayıt; PR 273 P3). */
  webhookFailAfter: number | null;
  /** İmzalı teslim üretir (kayıtlı anahtarla; HMAC-SHA256(anahtar, data) onaltılık — VARSAYIM) ve hedef adrese POST eder. */
  emitWebhook(target: string, ev: { readonly model: "product" | "contact"; readonly action: "create" | "update" | "delete"; readonly id: string; readonly eventDate?: string; readonly key?: string; readonly companyId?: string; readonly signature?: string; readonly fetchInit?: Record<string, unknown> }): Promise<{ status: number; body: string }>;
  /** Sonraki N isteğe 429 döner (ilk istekte `Retry-After: 1`). */
  rateLimitNext: number;
  /** İrsaliye POST yanıt durumu (ör. 500, 422) ya da "drop" (bağlantıyı yanıtsız kapatır). */
  shipmentFailure: number | "drop" | null;
  /** T-1135: stok güncelleme POST yanıt durumu (ör. 422) — null ise kabul. */
  stockFailure: number | null;
  /** T-1135: bu ürün kimliklerinden birini içeren stok güncellemesi 422 alır (satır bazlı kesin red). */
  readonly stockRejectProducts: Set<string>;
  /** T-1140: kart düzenleme (PUT) yanıt durumu (ör. 422) — null ise kabul. */
  updateFailure: number | null;
  /** T-1140: PUT ile gelen düzenlemeler (sıralı). */
  readonly updates: { kind: string; id: string; attributes: Record<string, unknown> }[];
  /** Geçerli yenileme belirteci (döner). */
  refreshToken: string;
  accessToken: string;
  /** T-1139: test için yeni tek kullanımlık yetki kodu (yetki kodu akışıyla birden çok bağlantı kuran testler; her kod bir kez geçer). */
  mintAuthorizationCode(): string;
  /** Erişim belirtecini geçersiz kılar (401 → yenileme). */
  expireAccess(): void;
  /** Yenileme belirtecini iptal eder (yenileme 400 invalid_grant). */
  revokeRefresh(): void;
  close(): Promise<void>;
}

let seq = 1000;
const nextId = (): string => String(++seq);

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

/** Sentetik varsayılan bilgiler (sır değildir; e2e formu bunlarla doldurur). */
export const FAKE_PARASUT_DEFAULTS = Object.freeze({
  clientId: "fake-client",
  clientSecret: "fake-client-secret-value",
  username: "muhasebe@example.test",
  companyId: "115",
  companyName: "Örnek Muhasebe A.Ş",
  expiresIn: 7200,
  authorizationCode:"fake-authorization-code",
  redirectUri:"https://wms.example.test/api/integrations/parasut/callback",
});

export async function startFakeParasut(options: FakeParasutOptions = {}): Promise<FakeParasut> {
  const { port: _port, extraRedirectUris = [], reusableCode = false, ...given } = options;
  void _port;
  const opts = { ...FAKE_PARASUT_DEFAULTS, ...given };
  let tokenSeq = 0;
  /** Geçerli yetki kodları; kullanılan kod (reusableCode değilse) silinir. */
  const codes = new Set<string>([opts.authorizationCode]);
  const issue = (): { access_token: string; refresh_token: string } => {
    tokenSeq += 1;
    state.accessToken = `acc-${tokenSeq}-${Math.random().toString(36).slice(2)}`;
    state.refreshToken = `ref-${tokenSeq}-${Math.random().toString(36).slice(2)}`;
    return { access_token: state.accessToken, refresh_token: state.refreshToken };
  };
  const state: FakeParasut = {
    url: "",
    opts,
    companies:[{id:opts.companyId,name:opts.companyName}],
    products: [], categories: [], webhooks: [], webhookKeyMode: "ours", webhookFailure: null, webhookFailAfter: null,
    async emitWebhook(target, ev) {
      const hook = state.webhooks.find((w) => w.attributes.model === ev.model && w.attributes.action === ev.action);
      const key = ev.key ?? (hook?.attributes.encryption_key as string | undefined) ?? "";
      const col = ev.model === "product" ? state.products : state.contacts;
      const rec = col.find((r) => r.id === ev.id);
      const at = ev.eventDate ?? new Date().toISOString();
      const data = JSON.stringify({ id: ev.id, data: { id: ev.id, type: `${ev.model}s`, attributes: { ...(rec?.attributes ?? {}), updated_at: at } }, included: [] });
      const body = new URLSearchParams({ company_id: ev.companyId ?? opts.companyId, resource: ev.model, action: ev.action, event_date: at, data }).toString();
      const signature = ev.signature ?? createHmac("sha256", key).update(data).digest("hex");
      const res = await fetch(target, { method: "POST", headers: { "content-type": "www-url-encoded", signature }, body, ...(ev.fetchInit ?? {}) });
      return { status: res.status, body: await res.text() };
    },
    contacts: [],
    warehouses: [],
    shipments: [],
    stockUpdates: [],
    requests: [],
    rateLimitNext: 0,
    shipmentFailure: null,
    stockFailure: null,
    stockRejectProducts: new Set<string>(),
    updateFailure: null,
    updates: [],
    refreshToken: "",
    accessToken: "",
    mintAuthorizationCode() {
      const code = `code-${tokenSeq}-${Math.random().toString(36).slice(2)}`;
      codes.add(code);
      return code;
    },
    expireAccess() {
      state.accessToken = `expired-${Math.random()}`;
    },
    revokeRefresh() {
      state.refreshToken = `revoked-${Math.random()}`;
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
  const collections: Record<string, FakeRecord[]> = { products: state.products, contacts: state.contacts, warehouses: state.warehouses };

  const server: Server = createServer(async (req, res) => {
    const body = await readBody(req);
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    state.requests.push({ method: req.method ?? "", path: `${url.pathname}${url.search}`, authorization: req.headers.authorization ?? null, contentType: req.headers["content-type"] ?? null, body });
    const send = (status: number, json: unknown, headers: Record<string, string> = {}): void => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(json === undefined ? "" : JSON.stringify(json));
    };
    if (state.rateLimitNext > 0) {
      state.rateLimitNext -= 1;
      send(429, { errors: [{ title: "Too many requests" }] }, { "retry-after": "1" });
      return;
    }
    if (req.method === "POST" && url.pathname === "/oauth/token") {
      const f = new URLSearchParams(body);
      if (f.get("client_id") !== opts.clientId || f.get("client_secret") !== opts.clientSecret) return send(401, { error: "invalid_client" });
      if(f.get("grant_type")==="authorization_code") {
        const redirect=f.get("redirect_uri");
        const code=f.get("code");
        if(code===null||!codes.has(code)||redirect===null||(redirect!==opts.redirectUri&&!extraRedirectUris.includes(redirect)))return send(400,{error:"invalid_grant"});
        if(!reusableCode)codes.delete(code);
        return send(200,{...issue(),token_type:"bearer",expires_in:opts.expiresIn});
      }
      if (f.get("grant_type") === "refresh_token") {
        if (f.get("refresh_token") !== state.refreshToken) return send(400, { error: "invalid_grant" });
        return send(200, { ...issue(), token_type: "bearer", expires_in: opts.expiresIn });
      }
      return send(400, { error: "unsupported_grant_type" });
    }
    // T-1138: yalnız sahte sunucuda test denetimi (e2e spec'i global-setup sürecindeki sahteye buradan erişir; gerçek Paraşüt'te yok).
    if (url.pathname === "/__fake/webhooks" && req.method === "GET") return send(200, { data: state.webhooks });
    if (url.pathname === "/__fake/products" && req.method === "POST") {
      const rec = JSON.parse(body) as FakeRecord;
      const i = state.products.findIndex((r) => r.id === rec.id);
      if (i < 0) state.products.push(rec);
      else state.products[i] = rec;
      return send(200, { data: rec });
    }
    if (req.headers.authorization !== `Bearer ${state.accessToken}` || state.accessToken === "") return send(401, { errors: [{ title: "Unauthorized" }] });
    if (req.method === "GET" && url.pathname === "/v4/me") {
      return send(200, { data: { id: "9", type: "users", attributes: { name: "Muhasebe", email: opts.username } }, included: state.companies.map(c=>({id:c.id,type:"companies",attributes:{name:c.name}})) });
    }
    const product = /^\/v4\/([0-9]+)\/products\/([0-9]+)$/.exec(url.pathname);
    if (req.method === "GET" && product !== null) {
      if (product[1] !== opts.companyId) return send(404, {errors:[{title:"Not found"}]});
      const row = state.products.find(r => r.id === product[2]);
      return row === undefined ? send(404,{errors:[{title:"Not found"}]}) : send(200,{data:{...row,type:"products",relationships:row.relationships??{}},included:url.searchParams.get("include")==="category"?state.categories.map((r)=>({id:r.id,type:"item_categories",attributes:r.attributes})):[]});
    }
    const contact = /^\/v4\/([0-9]+)\/contacts\/([0-9]+)$/.exec(url.pathname);
    if (req.method === "GET" && contact !== null) {
      if (contact[1] !== opts.companyId) return send(404, { errors: [{ title: "Not found" }] });
      const row = state.contacts.find((r) => r.id === contact[2]);
      return row === undefined ? send(404, { errors: [{ title: "Not found" }] }) : send(200, { data: { ...row, type: "contacts", relationships: row.relationships ?? {} } });
    }
    const whOne = /^\/v4\/([0-9]+)\/warehouses\/([0-9]+)$/.exec(url.pathname);
    if (req.method === "GET" && whOne !== null) {
      if (whOne[1] !== opts.companyId) return send(404, { errors: [{ title: "Not found" }] });
      const row = state.warehouses.find((r) => r.id === whOne[2]);
      return row === undefined ? send(404, { errors: [{ title: "Not found" }] }) : send(200, { data: { ...row, type: "warehouses", relationships: row.relationships ?? {} } });
    }
    const cardOne = /^\/v4\/([0-9]+)\/(products|contacts|warehouses)\/([0-9]+)$/.exec(url.pathname);
    if (req.method === "PUT" && cardOne !== null) {
      if (cardOne[1] !== opts.companyId) return send(404, { errors: [{ title: "Not found" }] });
      const kind = cardOne[2] as string;
      const row = (collections[kind] ?? []).find((r) => r.id === cardOne[3]);
      if (row === undefined) return send(404, { errors: [{ title: "Not found" }] });
      if (state.updateFailure !== null) return send(state.updateFailure, { errors: [{ title: "Rejected" }] });
      let b: { data?: { id?: unknown; type?: unknown; attributes?: Record<string, unknown> } } = {};
      try { b = JSON.parse(body) as typeof b; } catch { return send(400, { errors: [{ title: "Bad JSON" }] }); }
      const a = b.data?.attributes ?? {};
      if (String(b.data?.id) !== row.id || b.data?.type !== kind || ("name" in a && (typeof a.name !== "string" || a.name === ""))) return send(422, { errors: [{ title: "invalid" }] });
      state.updates.push({ kind, id: row.id, attributes: a });
      row.attributes = { ...row.attributes, ...a, updated_at: new Date().toISOString() };
      return send(200, { data: { id: row.id, type: kind, attributes: row.attributes, relationships: row.relationships ?? {} } });
    }
    const hookOne = /^\/v4\/([0-9]+)\/webhooks\/([0-9]+)$/.exec(url.pathname);
    if (req.method === "DELETE" && hookOne !== null) {
      if (hookOne[1] !== opts.companyId) return send(404, { errors: [{ title: "Not found" }] });
      const i = state.webhooks.findIndex((w) => w.id === hookOne[2]);
      if (i < 0) return send(404, { errors: [{ title: "Not found" }] });
      state.webhooks.splice(i, 1);
      res.writeHead(204);
      res.end();
      return;
    }
    if (url.pathname === `/v4/${opts.companyId}/webhooks`) {
      const view = (w: FakeRecord) => ({ id: w.id, type: "webhooks", attributes: { model: w.attributes.model, action: w.attributes.action, uri: w.attributes.uri, ...(state.webhookKeyMode === "assign" ? { encryption_key: w.attributes.encryption_key } : {}) } });
      if (req.method === "GET") return send(200, { data: state.webhooks.map(view), meta: { current_page: 1, total_pages: 1, total_count: state.webhooks.length } });
      if (req.method === "POST") {
        if (state.webhookFailure !== null && state.webhookFailAfter === null) return send(state.webhookFailure, { errors: [{ title: "Rejected" }] });
        if (state.webhookFailAfter !== null) {
          if (state.webhookFailAfter <= 0) return send(state.webhookFailure ?? 500, { errors: [{ title: "Rejected" }] });
          state.webhookFailAfter -= 1;
        }
        let b: { data?: { attributes?: Record<string, unknown> } } = {};
        try { b = JSON.parse(body) as typeof b; } catch { return send(400, { errors: [{ title: "Bad JSON" }] }); }
        const a = b.data?.attributes ?? {};
        if (!["product", "contact", "sales_invoice", "shipment_document", "employee", "stock_movement"].includes(String(a.model)) || !["create", "update", "delete"].includes(String(a.action)) || typeof a.uri !== "string") return send(422, { errors: [{ title: "invalid" }] });
        if (state.webhookKeyMode === "assign" && "encryption_key" in a) return send(422, { errors: [{ title: "encryption_key is not permitted" }] });
        const key = state.webhookKeyMode === "assign" ? `assigned-${nextId()}-${Math.random().toString(36).slice(2)}` : String(a.encryption_key ?? "");
        const rec = { id: nextId(), attributes: { model: a.model, action: a.action, uri: a.uri, encryption_key: key } };
        state.webhooks.push(rec);
        return send(201, { data: view(rec) });
      }
    }
    const m = /^\/v4\/([0-9]+)\/([a-z_]+)$/.exec(url.pathname);
    if (m === null || m[1] !== opts.companyId) return send(404, { errors: [{ title: "Not found" }] });
    const kind = m[2] as string;
    const col = collections[kind];
    if (req.method === "GET" && col !== undefined) {
      let rows = col;
      for (const [k, v] of url.searchParams) {
        const f = /^filter\[(\w+)\]$/.exec(k);
        if (f !== null) rows = rows.filter((r) => r.attributes[f[1] as string] === v);
      }
      const size = Math.min(25, Number(url.searchParams.get("page[size]") ?? "15"));
      const page = Number(url.searchParams.get("page[number]") ?? "1");
      const slice = rows.slice((page - 1) * size, page * size);
      return send(200, { data: slice.map((r) => ({ id: r.id, type: kind, attributes: r.attributes, relationships: r.relationships ?? {} })), included: kind === "products" && url.searchParams.get("include") === "category" ? state.categories.map((r) => ({ id: r.id, type: "item_categories", attributes: r.attributes })) : [], meta: { current_page: page, total_pages: Math.max(1, Math.ceil(rows.length / size)), total_count: rows.length } });
    }
    let parsed: { data?: { attributes?: Record<string, unknown> } } = {};
    try {
      parsed = JSON.parse(body) as typeof parsed;
    } catch {
      return send(400, { errors: [{ title: "Bad JSON" }] });
    }
    if (req.method === "POST" && col !== undefined) {
      const attrs = parsed.data?.attributes ?? {};
      if (typeof attrs.name !== "string" || attrs.name === "") return send(422, { errors: [{ title: "name required" }] });
      const rec = { id: nextId(), attributes: { ...attrs, updated_at: new Date().toISOString() } };
      col.push(rec);
      return send(201, { data: { id: rec.id, type: kind, attributes: rec.attributes } });
    }
    if (req.method === "POST" && kind === "shipment_documents") {
      if (state.shipmentFailure === "drop") {
        req.socket.destroy();
        return;
      }
      if (typeof state.shipmentFailure === "number") return send(state.shipmentFailure, { errors: [{ title: "Rejected" }] });
      state.shipments.push({ body: parsed });
      return send(201, { data: { id: nextId(), type: "shipment_documents", attributes: parsed.data?.attributes ?? {} } });
    }
    if (req.method === "POST" && kind === "stock_updates") {
      if (state.stockFailure !== null) return send(state.stockFailure, { errors: [{ title: "Rejected" }] });
      const details = ((parsed as { data?: { relationships?: { details?: { data?: { relationships?: { product?: { data?: { id?: string } } } }[] } } } }).data?.relationships?.details?.data ?? []);
      if (details.some((d) => state.stockRejectProducts.has(String(d.relationships?.product?.data?.id)))) return send(422, { errors: [{ title: "Rejected product" }] });
      state.stockUpdates.push({ body: parsed });
      return send(201, { data: { id: nextId(), type: "stock_updates", attributes: {} } });
    }
    send(404, { errors: [{ title: "Not found" }] });
  });
  await new Promise<void>((r) => server.listen(options.port ?? 0, "127.0.0.1", () => r()));
  (state as { url: string }).url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return state;
}
